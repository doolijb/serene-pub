import type { WidgetRequests } from "@serene-pub/sdk"
import { CREATE_SESSION_PERSONA_DESCRIPTION_MAX, CREATE_SESSION_PERSONA_NAME_MAX } from "@serene-pub/sdk"
import { awaitReply } from "$lib/client/utils/awaitReply"
import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
import { openSessionPage } from "$lib/client/shell/openJumpHit"
import { interestKey } from "$lib/shared/sockets/interest"
import { declaredFieldRefusal } from "$lib/shared/sessions/declaredFieldRefusal"

/**
 * 🚧 M2c: the four navigation requests an applet makes. `open-session` and
 * `open-sessions` are `ui` requests; `create-session` and `delete-session` are
 * `applet` requests. Each is answered in words or not at all: a session the
 * person cannot open, or a genre the asking package does not own, is refused.
 * The app keeps the last word: a create is shown for the person to press Start,
 * a delete is confirmed by the Sessions view's own dialog.
 * 🚧 M3b: a `create-session` may carry a `persona`, a draft the start form offers
 * as a new persona; nothing is made until the person's Start.
 */
type PanelsLike = {
	digest: Record<string, any>
	openPanel: (args: { key: string; toggle?: boolean }) => void
	[key: string]: any
}

export interface SessionRead {
	id: number
	userId?: number
	genreId?: string | null
}

export interface NavigationDeps {
	panelsCtx: PanelsLike
	/** The viewer's user id (null when unknown). */
	viewerId?: () => number | null
	/** One session by id, with the access check; null when the person may not see it. */
	readSession?: (id: number) => Promise<SessionRead | null>
	/** Every offered genre id (`sessions:genres`). */
	readGenreIds?: () => Promise<string[]>
	/** 🚧 M2d (★48): the field keys one genre declares (`sessions:genres`); null when the genre is not in the list. */
	readGenreFieldKeys?: (genreId: string) => Promise<string[] | null>
}

type From = { owner: string }

/** Largest `fields` object an applet may prefill with. */
export const MAX_FIELDS_BYTES = 64 * 1024

const notOpenable = "That session cannot be opened."

async function readSessionOverSocket(id: number): Promise<SessionRead | null> {
	const res = await awaitReply({
		socket: useTypedSocket(),
		event: "sessions:get",
		errorEvent: "sessions:get:error",
		params: { id, limit: 1 },
		replyKey: interestKey("sessions:get", id),
		match: (r) => r?.sessionId === id || (r?.session as any)?.id === id,
		timeoutMs: 15_000
	})
	const s = res.session as any
	return s ? { id: s.id, userId: s.userId, genreId: s.genreId } : null
}

async function readGenreIdsOverSocket(): Promise<string[]> {
	const res = await awaitReply({
		socket: useTypedSocket(),
		event: "sessions:genres",
		errorEvent: "sessions:genres:error" as never,
		params: {} as never,
		match: () => true,
		timeoutMs: 15_000
	})
	return (res.genres ?? []).map((g: any) => g.genreId as string)
}

async function readGenreFieldKeysOverSocket(genreId: string): Promise<string[] | null> {
	const res = await awaitReply({
		socket: useTypedSocket(),
		event: "sessions:genres",
		errorEvent: "sessions:genres:error" as never,
		params: {} as never,
		match: () => true,
		timeoutMs: 15_000
	})
	const row = (res.genres ?? []).find((g: any) => g.genreId === genreId) as any
	return row ? Object.keys(row.shape?.fields ?? {}) : null
}

function ownsGenre(owner: string, genreId: string): boolean {
	return owner !== "core" && genreId.startsWith(`${owner}:`)
}

function ownGenre(owner: string, genre: unknown): string {
	if (typeof genre !== "string" || !ownsGenre(owner, genre))
		throw new Error(`'${String(genre)}' is not one of this package's genres.`)
	return genre
}

function sessionIdOf(params: { sessionId?: unknown }): number {
	const id = Number(params?.sessionId)
	if (!Number.isInteger(id) || id <= 0) throw new Error(notOpenable)
	return id
}

async function readOpenable(id: number, deps: NavigationDeps): Promise<SessionRead> {
	let row: SessionRead | null = null
	try {
		row = await (deps.readSession ?? readSessionOverSocket)(id)
	} catch {
		row = null
	}
	if (!row) throw new Error(notOpenable)
	return row
}

export async function answerOpenSession(
	params: WidgetRequests["open-session"]["params"],
	_from: From,
	deps: NavigationDeps
): Promise<void> {
	const id = sessionIdOf(params)
	await readOpenable(id, deps)
	// Resolves once navigation starts; the opener is not awaited.
	void openSessionPage(deps.panelsCtx as any, id)
}

export async function answerOpenSessions(
	params: WidgetRequests["open-sessions"]["params"],
	from: From,
	deps: NavigationDeps
): Promise<void> {
	let genres: string[]
	if (params?.genre != null) genres = [ownGenre(from.owner, params.genre)]
	else {
		const all = await (deps.readGenreIds ?? readGenreIdsOverSocket)()
		genres = all.filter((g) => ownsGenre(from.owner, g))
	}
	deps.panelsCtx.digest.sessionsGenres = genres
	deps.panelsCtx.openPanel({ key: "sessions", toggle: false })
}

/** The persona draft a `create-session` carries, checked and trimmed; undefined when absent. Refuses in words. */
function personaDraft(raw: unknown): { name: string; description?: string } | undefined {
	if (raw === undefined) return undefined
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("The persona must be an object with a name.")
	try {
		JSON.stringify(raw)
	} catch {
		throw new Error("The persona must be plain JSON.")
	}
	const { name, description } = raw as { name?: unknown; description?: unknown }
	const trimmedName = typeof name === "string" ? name.trim() : ""
	if (!trimmedName) throw new Error("The persona needs a name.")
	if (trimmedName.length > CREATE_SESSION_PERSONA_NAME_MAX)
		throw new Error(`The persona's name is longer than ${CREATE_SESSION_PERSONA_NAME_MAX} characters.`)
	if (description !== undefined && typeof description !== "string")
		throw new Error("The persona's description must be text.")
	const trimmedDescription = description?.trim()
	if (trimmedDescription && trimmedDescription.length > CREATE_SESSION_PERSONA_DESCRIPTION_MAX)
		throw new Error(
			`The persona's description is longer than ${CREATE_SESSION_PERSONA_DESCRIPTION_MAX.toLocaleString("en")} characters.`
		)
	return trimmedDescription ? { name: trimmedName, description: trimmedDescription } : { name: trimmedName }
}

export async function answerCreateSession(
	params: WidgetRequests["create-session"]["params"],
	from: From,
	deps: NavigationDeps
): Promise<void> {
	const genreId = ownGenre(from.owner, params?.genre)
	const fields = params?.fields
	if (fields !== undefined) {
		if (fields === null || typeof fields !== "object" || Array.isArray(fields))
			throw new Error("The session's fields must be a plain object.")
		let size: number
		try {
			size = JSON.stringify(fields).length
		} catch {
			throw new Error("The session's fields must be plain JSON.")
		}
		if (size > MAX_FIELDS_BYTES) throw new Error("The session's fields are too large.")
		// 🚧 M2d (★48): refused here, at the request, not only at Start, in the server's own sentence — one source,
		// `declaredFieldRefusal` (`src/lib/shared/sessions`, M2e). A genre not in the list refuses its first key the same way.
		// A failed read is not caught: the error propagates (the reply's own words), as it does for `open-sessions`.
		if (Object.keys(fields).length > 0) {
			const declared = await (deps.readGenreFieldKeys ?? readGenreFieldKeysOverSocket)(genreId)
			const refusal = declaredFieldRefusal(fields, declared, genreId)
			if (refusal) throw new Error(refusal)
		}
	}
	const lorebookId = params?.lorebookId
	if (lorebookId != null && !Number.isInteger(lorebookId))
		throw new Error("That lorebook cannot be used.")
	const persona = personaDraft(params?.persona)
	deps.panelsCtx.digest.createSession = {
		genreId,
		fields: fields as Record<string, unknown> | undefined,
		lorebookId: lorebookId ?? undefined,
		...(persona ? { persona } : {}),
		fromApplet: from.owner
	}
	deps.panelsCtx.openPanel({ key: "sessions", toggle: false })
}

export async function answerDeleteSession(
	params: WidgetRequests["delete-session"]["params"],
	from: From,
	deps: NavigationDeps
): Promise<void> {
	const id = sessionIdOf(params)
	const row = await readOpenable(id, deps)
	const viewer = deps.viewerId?.() ?? null
	if (viewer === null || row.userId !== viewer)
		throw new Error("Only the person's own sessions can be deleted.")
	if (!row.genreId || !ownsGenre(from.owner, row.genreId))
		throw new Error("That session does not belong to this package's genres.")
	deps.panelsCtx.digest.deleteSessionId = id
	deps.panelsCtx.digest.deleteSessionFromApplet = from.owner
	deps.panelsCtx.openPanel({ key: "sessions", toggle: false })
}
