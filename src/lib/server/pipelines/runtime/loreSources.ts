/**
 * 🚧 **Lore sources** (pr-6 lane C1): the messages a generated lore write was
 * written from. The host half of `sources` on the lore outlets — ids out of
 * the value a run wired, the five checks, and the `lore_sources` row.
 *
 * ⚠ Not a retrieval source, not `lorebook_entries.source_message_id` (an
 * entry's timeline anchor in a session's notes), not
 * `core:query/summarize-source@1`.
 */
import { and, count, eq, gt, inArray } from "drizzle-orm"
import { channelLoreRole } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { liveMessageWhere } from "$lib/server/messages/store"
import { HostScopeError, type HostScope } from "$lib/server/pipelines/runtime/host"

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v)

/**
 * The message ids a `sources` value names: rows with a numeric `id`, units
 * with a numeric `messageId`, scenes with a `messages` array of rows —
 * flattened, deduplicated, ascending. Anything else contributes nothing.
 */
export function loreSourceIdsOf(value: unknown): number[] {
	const out = new Set<number>()
	const visit = (v: unknown, depth: number): void => {
		if (Array.isArray(v)) {
			for (const item of v) visit(item, depth)
			return
		}
		if (!v || typeof v !== "object") return
		const o = v as Record<string, unknown>
		// A scene names its messages, not itself: its own `id` is not one.
		// `graph-scenes@1` rows are scene rows carrying `selectedMessageIds`
		// (supervisor C, 2026-10-25: §C-1 said `messages`; the read carries ids).
		if (depth === 0 && Array.isArray(o.selectedMessageIds)) {
			for (const id of o.selectedMessageIds) if (isId(id)) out.add(id)
			return
		}
		if (depth === 0 && Array.isArray(o.messages)) {
			for (const m of o.messages) visit(m, 1)
			return
		}
		if (isId(o.id)) out.add(o.id)
		else if (isId(o.messageId)) out.add(o.messageId)
	}
	visit(value, 0)
	return [...out].sort((a, b) => a - b)
}

/** Remember every message id a read handed this run (the read frontier). */
export function noteMessagesRead(
	scope: { readMessageIds?: Set<number> },
	rows: readonly unknown[]
): void {
	if (!Array.isArray(rows)) return
	for (const row of rows) {
		if (!row || typeof row !== "object") continue
		const o = row as Record<string, unknown>
		const id = isId(o.id) ? o.id : isId(o.messageId) ? o.messageId : null
		if (id === null) continue
		if (!scope.readMessageIds) scope.readMessageIds = new Set()
		scope.readMessageIds.add(id)
	}
}

/**
 * The five checks on a `sources` value, before the write's transaction. The
 * first four refuse (`HostScopeError`); the fifth only notes.
 */
export async function checkLoreSources(
	db: Db,
	scope: Pick<HostScope, "sessionId" | "minAge" | "readMessageIds">,
	nodeKey: string,
	value: unknown
): Promise<{ ids: number[]; notes: string[] }> {
	const ids = loreSourceIdsOf(value)
	if (!ids.length)
		throw new HostScopeError(
			`${nodeKey}: sources names no messages, so there is nothing this was written from — leave sources off for a change in the story.`
		)
	const sessionId = scope.sessionId
	if (sessionId === undefined)
		throw new HostScopeError(
			`${nodeKey} has no session to read sources in — the run was started without a session scope`
		)
	const m = schema.sessionMessages
	const rows = await db
		.select({ id: m.id, channel: m.channel })
		.from(m)
		.where(and(eq(m.sessionId, sessionId), inArray(m.id, ids), liveMessageWhere()))
	const byId = new Map(rows.map((r) => [r.id, r.channel]))
	for (const id of ids)
		if (!byId.has(id))
			throw new HostScopeError(
				`${nodeKey}: message ${id} is not in this session's live story, so this cannot be written from it.`
			)

	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(db, session?.genreId ?? STANDARD_GENRE_ID)
	for (const id of ids) {
		const channel = byId.get(id)!
		if (channelLoreRole(genre?.shape, channel) === "never")
			throw new HostScopeError(
				`${nodeKey}: message ${id} is on '${channel}', which this genre never makes lore of.`
			)
	}

	const minAge = scope.minAge ?? 0
	if (minAge > 0) {
		for (const id of ids) {
			const channel = byId.get(id)!
			const [newer] = await db
				.select({ n: count() })
				.from(m)
				.where(
					and(
						eq(m.sessionId, sessionId),
						eq(m.channel, channel),
						gt(m.id, id),
						liveMessageWhere()
					)
				)
			if (Number(newer?.n ?? 0) < minAge)
				throw new HostScopeError(
					`${nodeKey}: message ${id} is one of the newest ${minAge} lines of '${channel}', which a routine leaves alone until play has moved past them.`
				)
		}
	}

	const unread = ids.filter((id) => !scope.readMessageIds?.has(id))
	return {
		ids,
		notes: unread.length
			? [`sources names message ${unread.join(", ")} this run never read`]
			: []
	}
}

/**
 * One `lore_sources` row for a subject a generated write made or changed.
 * `from` = min, `through` = max of `ids`. Call with the writer's `tx`.
 */
export async function recordLoreSources(
	tx: Db,
	row: {
		sessionId: number
		runId: string | null
		lorebookId: number
		subjectKind: "entry" | "relationship" | "scene"
		subjectId: number
		ids: readonly number[]
	}
): Promise<{ fromMessageId: number; throughMessageId: number }> {
	const fromMessageId = Math.min(...row.ids)
	const throughMessageId = Math.max(...row.ids)
	await tx.insert(schema.loreSources).values({
		sessionId: row.sessionId,
		runId: row.runId,
		lorebookId: row.lorebookId,
		subjectKind: row.subjectKind,
		subjectId: row.subjectId,
		fromMessageId,
		throughMessageId
	})
	return { fromMessageId, throughMessageId }
}
