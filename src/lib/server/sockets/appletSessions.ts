/**
 * 🚧 (M2c) The applet's session doors: `appletApi:librarySessions`,
 * `appletApi:updateSession`, and the judgement `sessions:create` / `sessions:delete`
 * make when they arrive `fromApplet`.
 *
 * Genre-scoped by declaration (plan §8): every operation is filtered to the
 * package's OWN declared genres (`door.ownGenres`) AND the acting person's own
 * sessions — never other genres', never another person's. Create and delete
 * stay person-confirmed: the app's own start form / confirm dialog asks; these
 * only refuse what an extension may not reach. Updating goes through
 * `sessions:update` itself, so its pushes, ledger and own-book overlay are the
 * app's own, with the extension named in the ledger cause.
 */
import { and, desc, eq, inArray, lt, or } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { openAppletDoor, libraryGrantRefusal, sessionGenreRefusal, type AppletDoor } from "$lib/server/plugins/appletDoor"
import { personMay } from "$lib/server/auth/actingPerson"
import { askerOf, refusable } from "./refusable"
import { markAppletCall } from "./appletCause"
import { declaredFieldRefusal } from "$lib/shared/sessions/declaredFieldRefusal"

type Emit = (event: string, data: any) => void
type Row = import("@serene-pub/sdk").AppletSessionV1

const UNREACHABLE = "That session is not one this extension can reach."
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

const rowOf = (r: { id: number; name: string | null; genreId: string; updatedAt: Date | null }): Row => ({
	id: r.id,
	name: r.name,
	genreId: r.genreId,
	updatedAt: r.updatedAt ? r.updatedAt.getTime() : 0
})

const COLUMNS = {
	id: schema.sessions.id,
	name: schema.sessions.name,
	genreId: schema.sessions.genreId,
	updatedAt: schema.sessions.updatedAt,
	userId: schema.sessions.userId
}

const encodeCursor = (r: { id: number; updatedAt: Date | null }) =>
	Buffer.from(`${r.updatedAt ? r.updatedAt.getTime() : 0}.${r.id}`).toString("base64url")

function decodeCursor(raw: string): { at: Date; id: number } {
	const m = /^(\d{1,16})\.(\d{1,12})$/.exec(Buffer.from(raw, "base64url").toString("utf8"))
	if (!m) throw new Error("That cursor is not one this extension was given.")
	return { at: new Date(Number(m[1])), id: Number(m[2]) }
}

/** The one session an extension may reach: the person's own, of one of its genres. Null when not. */
async function reachableSession(db: Db, door: AppletDoor, sessionId: unknown) {
	if (!Number.isInteger(sessionId)) return null
	const [s] = await db.select(COLUMNS).from(schema.sessions).where(eq(schema.sessions.id, sessionId as number)).limit(1)
	if (!s || sessionGenreRefusal(door, s.genreId)) return null
	// Owner only: personMay write on a session is the owner's alone.
	const may = await personMay(db, door.person, "write", { kind: "session", id: s.id })
	return may.ok ? s : null
}

/** The keys the genre declares as fields; null when the genre is not registered. */
async function declaredFieldKeys(db: Db, genreId: string): Promise<string[] | null> {
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genre = await getSessionGenre(db, genreId)
	return genre ? Object.keys(((genre.shape as { fields?: Record<string, unknown> } | undefined)?.fields ?? {})) : null
}

/** A lorebook an extension may attach: its grant reads books and the person may read this one. */
async function bookRefusal(db: Db, door: AppletDoor, lorebookId: unknown): Promise<string | null> {
	if (!Number.isInteger(lorebookId)) return "The lorebook is named by its number."
	const grant = libraryGrantRefusal(door, "lorebooks", "read")
	if (grant) return grant
	const may = await personMay(db, door.person, "read", { kind: "lorebook", id: lorebookId as number })
	return may.ok ? null : may.reason
}

/** `sessions:create` from an extension's start form: null to go on, else the sentence. */
export async function appletCreateRefusal(
	db: Db,
	userId: number,
	params: Sockets.Sessions.Create.Params
): Promise<string | null> {
	let door: AppletDoor
	try {
		door = await openAppletDoor(db, userId, params.fromApplet?.pluginId)
	} catch (e) {
		return (e as Error).message
	}
	if ((params.mode ?? "new") !== "new" && params.mode !== "new-world")
		return "An extension can only start a new session."
	const session = params.session as { genreId?: string; presetId?: number | null; genreFields?: unknown; lorebookId?: number | null }
	// A preset names the genre (the server derives it from the preset), so judge the preset's.
	let genreId = session.genreId
	if (session.presetId != null) {
		const [preset] = await db
			.select({ genreId: schema.sessionPresets.genreId })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, session.presetId))
			.limit(1)
		genreId = preset?.genreId
	}
	const refused = sessionGenreRefusal(door, genreId)
	if (refused) return refused
	const fieldRefusal = declaredFieldRefusal(session.genreFields, await declaredFieldKeys(db, genreId!), genreId!)
	if (fieldRefusal) return fieldRefusal
	if (session.lorebookId != null) return bookRefusal(db, door, session.lorebookId)
	if (params.starterKit != null) return libraryGrantRefusal(door, "lorebooks", "read")
	return null
}

/** `sessions:delete` confirmed from an extension's launcher: null to go on, else the sentence. */
export async function appletDeleteRefusal(
	db: Db,
	userId: number,
	params: Sockets.Sessions.Delete.Params
): Promise<string | null> {
	let door: AppletDoor
	try {
		door = await openAppletDoor(db, userId, params.fromApplet?.pluginId)
	} catch (e) {
		return (e as Error).message
	}
	return (await reachableSession(db, door, params.id)) ? null : UNREACHABLE
}

export const pluginsLibrarySessions: Handler<
	Sockets.PluginSessions.ListParams,
	Sockets.PluginSessions.ListResponse
> = refusable(
	"appletApi:librarySessions",
	async (socket, params, emitToUser) => {
		const door = await openAppletDoor(db, socket.user?.id, (params as { pluginId?: unknown } | undefined)?.pluginId)
		if (!door.ownGenres.length) throw new Error("That extension has not been given leave to reach any sessions.")
		let result: Sockets.PluginSessions.ListResult
		if (params.sessionId !== undefined) {
			if (params.genre !== undefined) {
				const refused = sessionGenreRefusal(door, params.genre)
				if (refused) throw new Error(refused)
			}
			const s = await reachableSession(db, door, params.sessionId)
			if (!s || (params.genre !== undefined && s.genreId !== params.genre)) throw new Error(UNREACHABLE)
			result = { rows: [rowOf(s)] }
		} else {
			let genres = door.ownGenres
			if (params.genre !== undefined) {
				const refused = sessionGenreRefusal(door, params.genre)
				if (refused) throw new Error(refused)
				genres = [params.genre]
			}
			const limit = Number.isFinite(params.limit)
				? Math.min(MAX_LIMIT, Math.max(1, Math.floor(params.limit as number)))
				: DEFAULT_LIMIT
			if (params.cursor !== undefined && typeof params.cursor !== "string")
				throw new Error("That cursor is not one this extension was given.")
			const after = params.cursor !== undefined ? decodeCursor(params.cursor) : null
			const rows = await db
						.select(COLUMNS)
						.from(schema.sessions)
						.where(
							and(
								eq(schema.sessions.userId, door.person.userId),
								inArray(schema.sessions.genreId, genres),
								after
									? or(
											lt(schema.sessions.updatedAt, after.at),
											and(eq(schema.sessions.updatedAt, after.at), lt(schema.sessions.id, after.id))
										)
									: undefined
							)
						)
						.orderBy(desc(schema.sessions.updatedAt), desc(schema.sessions.id))
						.limit(limit + 1)
			const page = rows.slice(0, limit)
			result = {
				rows: page.map(rowOf),
				...(rows.length > limit ? { nextCursor: encodeCursor(page[page.length - 1]) } : {})
			}
		}
		const response = { pluginId: door.pluginId, result, ...askerOf(params) }
		emitToUser("appletApi:librarySessions", response)
		return response
	},
	"The extension's sessions could not be reached.",
	undefined,
	(raw) => ({ ...askerOf(raw), pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId })
)

export const pluginsUpdateSession: Handler<
	Sockets.PluginSessions.UpdateParams,
	Sockets.PluginSessions.UpdateResponse
> = refusable(
	"appletApi:updateSession",
	async (socket, params, emitToUser) => {
		const door = await openAppletDoor(db, socket.user?.id, (params as { pluginId?: unknown } | undefined)?.pluginId)
		const s = await reachableSession(db, door, params.sessionId)
		if (!s) throw new Error(UNREACHABLE)
		if (params.name !== undefined && typeof params.name !== "string") throw new Error("A session's name is text.")
		const fieldRefusal = declaredFieldRefusal(params.fields, await declaredFieldKeys(db, s.genreId), s.genreId)
		if (fieldRefusal) throw new Error(fieldRefusal)
		if (params.lorebookId != null) {
			const refused = await bookRefusal(db, door, params.lorebookId)
			if (refused) throw new Error(refused)
		} else if (params.lorebookId !== undefined && params.lorebookId !== null) {
			throw new Error("The lorebook is named by its number.")
		}
		const session: Record<string, unknown> = { id: s.id }
		if (params.name !== undefined) session.name = params.name
		if (params.lorebookId !== undefined) session.lorebookId = params.lorebookId
		if (params.fields !== undefined) session.genreFields = params.fields
		if (Object.keys(session).length > 1) {
			// The session's tags ride along unchanged: the app's update replaces the set it is given.
			const tags = await db
				.select({ name: schema.tags.name })
				.from(schema.sessionTags)
				.innerJoin(schema.tags, eq(schema.tags.id, schema.sessionTags.tagId))
				.where(and(eq(schema.sessionTags.sessionId, s.id), eq(schema.tags.userId, door.person.userId)))
			const { sessionsUpdateHandler } = await import("./sessions")
			const call = markAppletCall({ session, tags: tags.map((t) => t.name) } as Sockets.Sessions.Update.Params, door.pluginId)
			// Its own refusal is answered below as ours, not twice.
			await sessionsUpdateHandler.handler(socket, call, (e: string, d: any) =>
				e === "sessions:update:error" ? undefined : emitToUser(e, d)
			)
		}
		const [after] = await db.select(COLUMNS).from(schema.sessions).where(eq(schema.sessions.id, s.id)).limit(1)
		const response = { pluginId: door.pluginId, result: rowOf(after), ...askerOf(params) }
		emitToUser("appletApi:updateSession", response)
		return response
	},
	"The session could not be changed.",
	undefined,
	(raw) => ({ ...askerOf(raw), pluginId: (raw as { pluginId?: unknown } | undefined)?.pluginId })
)

export function registerAppletSessionHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsLibrarySessions, emitToUser)
	register(socket, pluginsUpdateSession, emitToUser)
}
