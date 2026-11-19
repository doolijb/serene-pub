/**
 * Who reads a reply's compiled prompt (`debugMeta`).
 *
 * Owner rulings — G5 (2026-11-16): "The session's owner and administrators
 * only." G6 (2026-11-16): "In another person's session an administrator is a
 * guest." D64 (2026-11-17): "we shouldn't allow non admins to see the full
 * diags anyway, could be considered semi sensitive." DG1 (2026-11-17): "Regular
 * users see the error and a basic generic user friendly description of the
 * problem". So a reply's prompt is read by an administrator who is in the
 * session, as its owner or as a guest; nobody else, a non-administrator owner
 * included.
 *
 * Enforced at the server: a payload bound for anyone else goes through
 * {@link withoutDebugMeta} first. {@link readsPrompt} is the one decision.
 */

import { and, eq, inArray } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"

/**
 * The ids among `userIds` who read this session's reply prompts, and the
 * session's owner (read for the decision already; `null` when the session is
 * gone).
 */
export async function promptReaders(
	sessionId: number,
	userIds: number[]
): Promise<{ readers: Set<number>; ownerId: number | null }> {
	const readers = new Set<number>()
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { readers, ownerId: null }
	if (!userIds.length) return { readers, ownerId: session.userId }
	const admins = await db
		.select({ id: schema.users.id })
		.from(schema.users)
		.where(and(inArray(schema.users.id, userIds), eq(schema.users.isAdmin, true)))
	const guests = new Set(
		(
			await db
				.select({ userId: schema.sessionGuests.userId })
				.from(schema.sessionGuests)
				.where(eq(schema.sessionGuests.sessionId, sessionId))
		).map((g) => g.userId)
	)
	for (const { id } of admins)
		if (id === session.userId || guests.has(id)) readers.add(id)
	return { readers, ownerId: session.userId }
}

/** May `userId` receive the prompts of `sessionId`'s replies? */
export async function readsPrompt(sessionId: number, userId: number): Promise<boolean> {
	return (await promptReaders(sessionId, [userId])).readers.has(userId)
}

type Row = { debugMeta?: unknown; embeddingModel?: unknown } & Record<string, any>

const carries = (row: unknown): row is Row =>
	!!row &&
	typeof row === "object" &&
	"debugMeta" in row &&
	(row as Row).debugMeta != null

const stripRow = <R>(row: R): R => (carries(row) ? { ...row, debugMeta: null } : row)

/** A row shaping: which rows it changes, and the changed row. */
type RowShaping = { applies: (row: unknown) => boolean; apply: (row: any) => any }

/** The rows with `shaping` applied; the same array when no row needs it. */
function shapeRows(rows: unknown, shaping: RowShaping): unknown {
	if (!Array.isArray(rows) || !rows.some(shaping.applies)) return rows
	return rows.map((row) => (shaping.applies(row) ? shaping.apply(row) : row))
}

/**
 * The payload with `shaping` applied to every row it names. The **same
 * reference** comes back when no row needs it. Understands an array of rows,
 * `{ sessionMessage }`, `{ rows }`, `{ messages }` and
 * `{ session: { sessionMessages } }`; anything else is returned unchanged.
 */
function shapePayload<T>(payload: T, shaping: RowShaping): T {
	if (Array.isArray(payload)) return shapeRows(payload, shaping) as T
	if (!payload || typeof payload !== "object") return payload
	const p = payload as Record<string, any>
	let out: Record<string, any> | null = null
	const set = (key: string, value: unknown) => {
		out ??= { ...p }
		out[key] = value
	}
	if ("sessionMessage" in p && shaping.applies(p.sessionMessage))
		set("sessionMessage", shaping.apply(p.sessionMessage))
	for (const key of ["rows", "messages"]) {
		const next = shapeRows(p[key], shaping)
		if (next !== p[key]) set(key, next)
	}
	const inner = p.session
	if (inner && typeof inner === "object") {
		const next = shapeRows(inner.sessionMessages, shaping)
		if (next !== inner.sessionMessages)
			set("session", { ...inner, sessionMessages: next })
	}
	return (out ?? payload) as T
}

const NO_PROMPT: RowShaping = {
	applies: carries,
	apply: (row) => ({ ...row, debugMeta: null })
}

/**
 * The payload with every row's `debugMeta` set to `null` (the key stays, so a
 * row has the shape of a reply with no recorded prompt). The **same reference**
 * comes back when no row carries one. Understands an array of rows,
 * `{ sessionMessage }`, `{ rows }`, `{ messages }` and
 * `{ session: { sessionMessages } }`; anything else is returned unchanged.
 */
export function withoutDebugMeta<T>(payload: T): T {
	return shapePayload(payload, NO_PROMPT)
}

/** A line's vectors against the active embedding model, as a reader who is not an administrator is sent it. */
export type EmbeddingState = "current" | "stale" | "none"

const carriesModel = (row: unknown): row is Row =>
	!!row &&
	typeof row === "object" &&
	typeof (row as Row).embeddingModel === "string" &&
	(row as Row).embeddingModel !== ""

/**
 * Reads the active embedding model's id at most once, and only when asked.
 * One per push or page, so a payload with no embedded row costs no statement.
 */
export function activeEmbeddingModelOnce(): () => Promise<string | null> {
	let pending: Promise<string | null> | null = null
	return () =>
		(pending ??= (async () => {
			const { resolveEmbeddingTarget } = await import("$lib/server/embedding/target")
			return (await resolveEmbeddingTarget(db))?.modelId ?? null
		})())
}

/**
 * The payload as a reader who is not an administrator is sent it (owner ruling
 * DG6, 2026-11-17: "Send regular users the mark's state only, worked out on
 * the server"): each embedded row carries `embeddingState` and its
 * `embeddingModel` set to `null`. A row with no embedding carries neither, which
 * reads as `none`. The **same reference** comes back when no row is embedded,
 * and then `active` is never called.
 */
export async function withEmbeddingState<T>(
	payload: T,
	active: () => Promise<string | null>
): Promise<T> {
	let any = false
	shapePayload(payload, {
		applies: (row) => (any ||= carriesModel(row)),
		apply: (row) => row
	})
	if (!any) return payload
	const model = await active()
	return shapePayload(payload, {
		applies: carriesModel,
		apply: (row) => ({
			...row,
			embeddingModel: null,
			embeddingState: (row.embeddingModel === model ? "current" : "stale") satisfies EmbeddingState
		})
	})
}

const carriesSuggestion = (row: unknown): boolean => {
	const error = (row as Row | null | undefined)?.error
	return (
		!!error &&
		typeof error === "object" &&
		typeof error.plainMessage === "string" &&
		error.message !== error.plainMessage
	)
}

/**
 * The payload as an administrator is sent it: a failed reply's message is the
 * plain sentence without the suggestion to ask an administrator (the reason
 * sits under it). A row stored without `plainMessage` is sent as stored. The
 * **same reference** comes back when no row needs it.
 */
export function withoutAdministratorSuggestion<T>(payload: T): T {
	return shapePayload(payload, {
		applies: carriesSuggestion,
		apply: (row) => ({ ...row, error: { ...row.error, message: row.error.plainMessage } })
	})
}

/** The half of `socket.user` the shaping reads. */
export type EmbeddingReader = { isAdmin?: boolean | null } | null | undefined

/**
 * {@link withEmbeddingState} for one reader: an administrator's payload comes
 * back with the suggestion to ask an administrator taken out of a failed
 * reply's message (no read).
 */
export async function withEmbeddingStateFor<T>(
	payload: T,
	reader: EmbeddingReader,
	active: () => Promise<string | null> = activeEmbeddingModelOnce()
): Promise<T> {
	return reader?.isAdmin
		? withoutAdministratorSuggestion(payload)
		: withEmbeddingState(payload, active)
}

/**
 * The row as `userId` is sent it in their own reply: a reply's compiled prompt
 * (`debugMeta`) goes to {@link readsPrompt} readers alone, and a reader who is
 * not an administrator is sent the embedding state, not the model id. No read
 * when the row carries neither.
 */
export async function rowShownTo<R extends { sessionId: number; debugMeta?: unknown }>(
	row: R,
	userId: number,
	reader: EmbeddingReader
): Promise<R> {
	const shown =
		row.debugMeta == null || (await readsPrompt(row.sessionId, userId))
			? row
			: withoutDebugMeta({ sessionMessage: row }).sessionMessage
	return (await withEmbeddingStateFor({ sessionMessage: shown }, reader))
		.sessionMessage
}
