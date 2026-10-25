/**
 * 🚧 Annex revision points (DC walk 6, 2026-10-17): the session annex as it
 * stood when each line of the story was written, so a revision — `overwrite`
 * (the turn deleted) or `branch` (the session forked before it) — puts the
 * annex back where it stood at the revision point instead of keeping what the
 * revised-away turn wrote (Dungeon Crawler's `dungeon-crawler-progress`: its
 * last telling, its leads).
 *
 * Why here and not a genre declaration: no annex declaration says which keys
 * follow the timeline (a `revisable` flag would be the SDK's to add, and it
 * would still need the value at the revision point — this record). So every
 * key is put back. The smaller of the two fixes the brief offered, chosen
 * over a per-row snapshot in `metadata` because message metadata reaches
 * every member's screen, and the annex holds what only pipelines may read
 * (a secret goal): the record lives IN the annex, under its own owner, which
 * no declaration covers — pipelines only, never in a person's view
 * (`annexViews.ts`, R59) — and which no owner's write touches (each write
 * replaces its own owner's document alone, `host.ts`).
 *
 * Shape: `annex[REVISION_POINTS_OWNER][<message id>] = <the annex minus this
 * owner>`, taken as the row is inserted (`insertLegacy`), so a row's point is
 * the annex just BEFORE it — what its turn then changed is after it. Only a
 * story line takes one: a table row (`metadata.anchorMessageId`) belongs to
 * its anchor's turn. Bounded to the newest `REVISION_POINT_LIMIT` rows; a
 * revision further back than that leaves the annex as it is (the old
 * behaviour).
 */

import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The annex owner the points live under. Never declared, so never seen. */
export const REVISION_POINTS_OWNER = "core:revision-points"

/** How many rows back a revision can put the annex back to. */
export const REVISION_POINT_LIMIT = 16

type Annex = Record<string, unknown>
type Points = Record<string, Annex>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** The annex without its revision points. */
export function annexWithoutPoints(annex: unknown): Annex {
	if (!isPlainObject(annex)) return {}
	const { [REVISION_POINTS_OWNER]: _points, ...rest } = annex
	return rest
}

/** The points an annex holds, by message id. */
export function pointsOf(annex: unknown): Points {
	if (!isPlainObject(annex)) return {}
	const held = annex[REVISION_POINTS_OWNER]
	return isPlainObject(held) ? (held as Points) : {}
}

/** Whether a row is a story line (takes a point) rather than a table row. */
export function takesRevisionPoint(metadata: unknown): boolean {
	if (!isPlainObject(metadata)) return true
	return typeof metadata.anchorMessageId !== "number"
}

/**
 * The points with `messageId`'s added — the annex as it stands now — and the
 * oldest dropped past the limit. Pure.
 */
export function withPoint(annex: unknown, messageId: number): Points {
	const points: Points = { ...pointsOf(annex), [String(messageId)]: annexWithoutPoints(annex) }
	const ids = Object.keys(points)
		.map(Number)
		.filter(Number.isSafeInteger)
		.sort((a, b) => a - b)
	const keep = new Set(ids.slice(-REVISION_POINT_LIMIT).map(String))
	return Object.fromEntries(Object.entries(points).filter(([k]) => keep.has(k)))
}

/**
 * The annex at the revision point: the point of the earliest line revised
 * away (the smallest id past `forkMessageId`), or null when none was kept.
 * Pure.
 */
export function annexAtFork(annex: unknown, forkMessageId: number): Annex | null {
	const points = pointsOf(annex)
	const after = Object.keys(points)
		.map(Number)
		.filter((id) => Number.isSafeInteger(id) && id > forkMessageId)
		.sort((a, b) => a - b)
	if (!after.length) return null
	return structuredClone(points[String(after[0])]) as Annex
}

/**
 * 🚧 The keys that never follow the story (PLAN-dc-after-walk2 Q1-4): a
 * person's preference about the session — `core.retake-quietly`, "Don't ask
 * again" on Regenerate. A revision put it back with the rest, so the very
 * Regenerate that had been asked not to ask asked again next time.
 */
const TIMELESS: Readonly<Record<string, readonly string[]>> = Object.freeze({ core: ["retake-quietly"] })

/**
 * The annex at a revision point, with each timeless key as it stands NOW.
 * Pure. 🚧 Also what **Forward** puts back (RF fix 5, `sessions/rewind.ts`):
 * the annex Back read, a person's timeless preference as it stands.
 */
export function keepTimeless(at: Annex, now: unknown): Annex {
	const current = isPlainObject(now) ? now : {}
	const out: Annex = { ...at }
	for (const [owner, keys] of Object.entries(TIMELESS)) {
		const then = isPlainObject(out[owner]) ? { ...(out[owner] as Record<string, unknown>) } : {}
		const held = isPlainObject(current[owner]) ? (current[owner] as Record<string, unknown>) : {}
		for (const key of keys) {
			if (key in held) then[key] = structuredClone(held[key])
			else delete then[key]
		}
		if (Object.keys(then).length) out[owner] = then
		else delete out[owner]
	}
	return out
}

/**
 * The annex a revision leaves: the document at the revision point, with the
 * points up to the fork kept (their ids moved by `remap` when given — a
 * branch's copies — and dropped when a copy is missing). Unchanged, but for
 * the points, when no point was kept past the fork. Pure.
 */
export function revisedAnnex(
	annex: unknown,
	forkMessageId: number,
	remap?: ReadonlyMap<number, number>
): Annex {
	const at = annexAtFork(annex, forkMessageId)
	const base = at ? keepTimeless(at, annex) : annexWithoutPoints(annex)
	const kept: Points = {}
	for (const [key, value] of Object.entries(pointsOf(annex))) {
		const id = Number(key)
		if (!Number.isSafeInteger(id) || id > forkMessageId) continue
		const moved = remap ? remap.get(id) : id
		if (moved === undefined) continue
		kept[String(moved)] = value
	}
	return Object.keys(kept).length ? { ...base, [REVISION_POINTS_OWNER]: kept } : base
}

/**
 * Take the point for a row just inserted: the annex as it stands, before the
 * row's turn writes anything. Nothing for a session with an empty annex (a
 * Chat), nor for a table row. Under the annex's own lock (`host.ts`), and on
 * this owner's path alone, so it never races an owner's write.
 */
export async function takeRevisionPoint(
	db: Db,
	row: { id: number; sessionId: number; metadata?: unknown }
): Promise<void> {
	if (!takesRevisionPoint(row.metadata)) return
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${row.sessionId})`)
		const [current] = await tx
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, row.sessionId))
			.limit(1)
		if (!current) return
		if (!Object.keys(annexWithoutPoints(current.annex)).length) return
		const points = withPoint(current.annex, row.id)
		await tx.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("annex")} = jsonb_set(
				coalesce(${schema.sessions.annex}, '{}'::jsonb),
				ARRAY[${REVISION_POINTS_OWNER}]::text[],
				${JSON.stringify(points)}::jsonb,
				true
			)
			where ${schema.sessions.id} = ${row.sessionId}
		`)
	})
}

/**
 * `overwrite`: the session's annex put back to the point of the earliest
 * line being deleted (`firstRevisedId`). Run inside the delete's transaction.
 * Whether anything moved.
 */
export async function reviseAnnexInPlace(
	tx: Db,
	sessionId: number,
	firstRevisedId: number
): Promise<boolean> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`)
	const [current] = await tx
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!current || annexAtFork(current.annex, firstRevisedId - 1) === null) return false
	await tx
		.update(schema.sessions)
		.set({ annex: revisedAnnex(current.annex, firstRevisedId - 1) as any })
		.where(eq(schema.sessions.id, sessionId))
	return true
}
