/**
 * 🚧 **Archive, Unarchive and Close out** (pr-6, rulings R-k and R-d; shapes §B-5, §B-6). Owner of the session only.
 *
 * `closeOutSession` is the orchestration that needs `emitToUser` — it files the closing scene(s)
 * (`fileClosingScenes`) and summarizes them through the session's close-out registration, held for review — so it
 * lives here and not in `sessions/closeOut.ts` (domain modules never import sockets/).
 */
import { sessionEvents, minAgeOf } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { archiveSession, unarchiveSession, SessionArchiveRefusal } from "$lib/server/sessions/archive"
import { closeOutRegistrationOf, closeOutStretchOf } from "$lib/server/sessions/closeOut"
import { sessionBusy } from "$lib/server/sessions/rewind"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { CLOSE_OUT_REFUSALS } from "$lib/shared/sessions/archive"
import { fileClosingScenes, runSceneSummaries } from "./scenes"

/** Close out (§B-6): refusals in order — missing, notOwner, notRegistered, busy, nothing; then the scenes, then their summaries in the background through the registration. */
export async function closeOutSession(opts: {
	sessionId: number
	userId: number
	emitToUser: (event: string, data: any) => void | Promise<void>
}): Promise<{ sceneIds: number[] } | { refused: string }> {
	const { sessionId, userId, emitToUser } = opts
	const handle = db as unknown as Db
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return { refused: CLOSE_OUT_REFUSALS.missing }
	if (!access.isOwner) return { refused: CLOSE_OUT_REFUSALS.notOwner }
	const reg = await closeOutRegistrationOf(handle, sessionId)
	if (!reg) return { refused: CLOSE_OUT_REFUSALS.notRegistered }
	if (await sessionBusy(handle, sessionId)) return { refused: CLOSE_OUT_REFUSALS.busy }
	const stretch = await closeOutStretchOf(handle, sessionId)
	if (!stretch) return { refused: CLOSE_OUT_REFUSALS.nothing }
	const sceneIds = await fileClosingScenes(
		userId,
		{ sessionId, fromMessageId: stretch.fromMessageId, throughMessageId: stretch.throughMessageId },
		emitToUser
	)
	void runSceneSummaries(sceneIds, userId, emitToUser, {
		via: { specId: reg.pipeline, registrationKey: reg.key, minAge: minAgeOf(reg) }
	})
	return { sceneIds }
}

/** A refusal reaches `<event>:error` as its own sentence. */
const sentenceOf = (e: unknown): never => {
	throw e instanceof SessionArchiveRefusal ? new Error(e.message, { cause: e }) : (e as Error)
}

/** The three pushes after Archive / Unarchive: the session to its members, every member's list, the row. */
async function tellMembers(io: any, sessionId: number, userId: number): Promise<void> {
	try {
		const { pushSessionToParticipants, relistSessionMembers } = await import("./sessions")
		await pushSessionToParticipants(io, sessionId, userId)
		await relistSessionMembers(io, sessionId)
		broadcastSessionRow(io, sessionId)
	} catch (err) {
		console.warn("[archive] members were not told:", err)
	}
}

const echo = (p: unknown) => ({ sessionId: (p as any)?.sessionId })

export const sessionsArchiveHandler: Handler<
	Sockets.Sessions.Archive.Params,
	Sockets.Sessions.Archive.Response
> = refusable(
	"sessions:archive",
	async (socket, params: Sockets.Sessions.Archive.Params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const { archivedAt } = await archiveSession(db as unknown as Db, { sessionId, userId }).catch(sentenceOf)
		// After the commit: the session's own event (unarchive raises none).
		try {
			const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
			await emitSessionEvent(db as unknown as Db, {
				sessionId,
				userId,
				event: sessionEvents.sessionArchived,
				payload: {
					event: sessionEvents.sessionArchived,
					sessionId,
					at: Date.now(),
					cause: { kind: "settings", userId }
				},
				io: socket.io
			})
		} catch (err) {
			console.warn("[archive] session-archived emit failed:", err)
		}
		// The close-out runs once; a refusal (nothing to close out, none registered) never fails the archive.
		let closeOut: { sceneIds: number[] } | null = null
		try {
			const done = await closeOutSession({ sessionId, userId, emitToUser })
			closeOut = "sceneIds" in done ? done : null
		} catch (err) {
			console.warn("[archive] the close-out did not run:", err)
		}
		const res: Sockets.Sessions.Archive.Response = {
			sessionId,
			archivedAt: archivedAt.toISOString(),
			closeOut
		}
		emitToUser("sessions:archive", res)
		await tellMembers(socket.io, sessionId, userId)
		return res
	},
	"The session could not be archived.",
	undefined,
	echo
)

export const sessionsUnarchiveHandler: Handler<
	Sockets.Sessions.Unarchive.Params,
	Sockets.Sessions.Unarchive.Response
> = refusable(
	"sessions:unarchive",
	async (socket, params: Sockets.Sessions.Unarchive.Params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		await unarchiveSession(db as unknown as Db, { sessionId, userId }).catch(sentenceOf)
		const res: Sockets.Sessions.Unarchive.Response = { sessionId }
		emitToUser("sessions:unarchive", res)
		await tellMembers(socket.io, sessionId, userId)
		return res
	},
	"The session could not be unarchived.",
	undefined,
	echo
)

export const sessionsCloseOutHandler: Handler<
	Sockets.Sessions.CloseOut.Params,
	Sockets.Sessions.CloseOut.Response
> = refusable(
	"sessions:closeOut",
	async (socket, params: Sockets.Sessions.CloseOut.Params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const done = await closeOutSession({ sessionId, userId, emitToUser })
		if ("refused" in done) throw new Error(done.refused)
		const res: Sockets.Sessions.CloseOut.Response = { sessionId, sceneIds: done.sceneIds }
		emitToUser("sessions:closeOut", res)
		return res
	},
	"The session could not be closed out.",
	undefined,
	echo
)

export function registerSessionArchiveHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
): void {
	register(socket, sessionsArchiveHandler, emitToUser)
	register(socket, sessionsUnarchiveHandler, emitToUser)
	register(socket, sessionsCloseOutHandler, emitToUser)
}
