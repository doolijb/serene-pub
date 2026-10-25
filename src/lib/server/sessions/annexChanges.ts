/**
 * 🚧 **Annex deltas** (pr-6 B5, ruled 2026-10-24: "Annex revision points →
 * message-anchored annex changes (pass 2); `rewind_taken.turn.annex` goes
 * with them"; shapes: ~/.claude/plans/briefs/pr6-A-shapes.md §A-4).
 *
 * Every write of one owner's annex document by `set-session-annex` /
 * `set-annex-field` records what the document and its audiences were before
 * and after, anchored to the turn's message (`annex_deltas`). Back takes the
 * deltas of the rows it takes by the one retraction rule — the owner's
 * document goes back, unless a later delta of that owner stands (later
 * writer wins) — and Forward lands them again. The settle line drops the
 * deltas below it. A write with no anchor records none: it is permanent at
 * once, as every unanchored session fact is.
 *
 * Wired at `retractStateAnchoredTo`, `restoreRetractedState` and the host's
 * `writeAnnexDocument`.
 */

import { and, desc, eq, gt, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { AnnexDeltaSide } from "$lib/server/db/schema"
import { CORE_RUNTIME_KEYS } from "./coreAnnex"
import { migrateOwnerDocument, ownerVersionOf } from "$lib/server/plugins/annexMigrate"

export type { AnnexDeltaSide } from "$lib/server/db/schema"

/** One delta Back took, for Forward: the row, and whether the owner's document was put back to its `before`. */
export interface AnnexDeltaTaken {
	row: typeof schema.annexDeltas.$inferSelect
	reverted: boolean
}

/** The legacy key (data written before pr-6), stripped by readers. */
export const LEGACY_REVISION_POINTS_OWNER = "core:revision-points"

type Annex = Record<string, unknown>

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** The annex without the legacy revision-points key (`{}` for a non-object). */
export function annexWithoutPoints(annex: unknown): Annex {
	if (!isPlainObject(annex)) return {}
	const { [LEGACY_REVISION_POINTS_OWNER]: _points, ...rest } = annex
	return rest
}

/**
 * 🚧 The keys that never follow the story: a person's preference about the
 * session (`core.retake-quietly`, "Don't ask again" on Regenerate) and the
 * core runtime keys (`coreAnnex.ts`). Back, Forward and a branch's `annexAt`
 * leave them as they stand now.
 */
const TIMELESS: Readonly<Record<string, readonly string[]>> = Object.freeze({ core: ["retake-quietly", ...CORE_RUNTIME_KEYS] })

/** One owner's document to land, its timeless keys as they stand now. Null = the owner's key goes. */
function withTimeless(
	owner: string,
	document: Record<string, unknown> | null,
	current: unknown
): Record<string, unknown> | null {
	const keys = TIMELESS[owner]
	if (!keys) return document
	const held = isPlainObject(current) ? current : {}
	const out: Record<string, unknown> = document ? { ...document } : {}
	for (const key of keys) {
		if (key in held) out[key] = structuredClone(held[key])
		else delete out[key]
	}
	if (document === null && !Object.keys(out).length) return null
	return out
}

const lockAnnex = (tx: Db, sessionId: number) =>
	tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`)

/** Land one owner's side (document and audiences) on the session, single-key, timeless keys kept. */
async function landOwner(tx: Db, sessionId: number, owner: string, side: AnnexDeltaSide) {
	const [current] = await tx
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!current) return
	const held = isPlainObject(current.annex) ? current.annex[owner] : undefined
	const document = withTimeless(owner, side.document, held)
	const annexExpr =
		document === null
			? sql`coalesce(${schema.sessions.annex}, '{}'::jsonb) - ${owner}::text`
			: sql`jsonb_set(coalesce(${schema.sessions.annex}, '{}'::jsonb), ARRAY[${owner}]::text[], ${JSON.stringify(document)}::jsonb, true)`
	const audiencesExpr =
		side.audiences === null
			? sql`coalesce(${schema.sessions.annexAudiences}, '{}'::jsonb) - ${owner}::text`
			: sql`jsonb_set(coalesce(${schema.sessions.annexAudiences}, '{}'::jsonb), ARRAY[${owner}]::text[], ${JSON.stringify(side.audiences)}::jsonb, true)`
	await tx.execute(sql`
		update ${schema.sessions}
		set ${sql.identifier("annex")} = ${annexExpr},
		${sql.identifier("annex_audiences")} = ${audiencesExpr}
		where ${schema.sessions.id} = ${sessionId}
	`)
}

/** Whether a delta of this session and owner with a greater id stands (outside `except`). */
async function laterDeltaStands(
	tx: Db,
	sessionId: number,
	owner: string,
	id: number,
	except: readonly number[] = []
): Promise<boolean> {
	const rows = await tx
		.select({ id: schema.annexDeltas.id })
		.from(schema.annexDeltas)
		.where(
			and(
				eq(schema.annexDeltas.sessionId, sessionId),
				eq(schema.annexDeltas.owner, owner),
				gt(schema.annexDeltas.id, id)
			)
		)
	return rows.some((r) => !except.includes(r.id))
}

/**
 * The host's write (`writeAnnexDocument`, inside its transaction, after the
 * annex's `jsonb_set`): one delta for one owner. No anchor (`messageId`
 * null) records nothing.
 */
export async function recordAnnexDelta(
	tx: Db,
	d: {
		sessionId: number
		messageId: number | null
		owner: string
		ownerVersion: string | null
		before: AnnexDeltaSide
		after: AnnexDeltaSide
		runId: string | null
	}
): Promise<void> {
	if (d.messageId === null) return
	await tx.insert(schema.annexDeltas).values({
		sessionId: d.sessionId,
		messageId: d.messageId,
		owner: d.owner,
		ownerVersion: d.ownerVersion,
		before: d.before,
		after: d.after,
		runId: d.runId
	})
}

/**
 * The one rule's annex half: every delta anchored to `messageId`, newest
 * first, taken; the owner's document and audiences go back to `before` only
 * when no later delta of that owner stands (later writer wins); `core`'s
 * `retake-quietly` keeps its current value.
 */
export async function retractAnnexDeltasAnchoredTo(tx: Db, messageId: number): Promise<AnnexDeltaTaken[]> {
	const [anchor] = await tx
		.select({ sessionId: schema.sessionMessages.sessionId })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!anchor) return []
	const sessionId = anchor.sessionId
	await lockAnnex(tx, sessionId)
	const rows = await tx
		.select()
		.from(schema.annexDeltas)
		.where(eq(schema.annexDeltas.messageId, messageId))
		.orderBy(desc(schema.annexDeltas.id))
	const taken: AnnexDeltaTaken[] = []
	for (const row of rows) {
		// Deleted as it is taken, so an older delta of this same turn sees only
		// what truly stands after it.
		await tx.delete(schema.annexDeltas).where(eq(schema.annexDeltas.id, row.id))
		const reverted = !(await laterDeltaStands(tx, sessionId, row.owner, row.id))
		if (reverted) await landOwner(tx, sessionId, row.owner, row.before)
		taken.push({ row, reverted })
	}
	return taken
}

/** Forward: what `retractAnnexDeltasAnchoredTo` took, landed again. */
export async function restoreAnnexDeltas(tx: Db, taken: readonly AnnexDeltaTaken[]): Promise<void> {
	if (!taken.length) return
	const oldestFirst = [...taken].reverse()
	const sessionId = oldestFirst[0].row.sessionId
	await lockAnnex(tx, sessionId)
	for (const { row } of oldestFirst) {
		await tx.insert(schema.annexDeltas).values(row).onConflictDoNothing()
	}
	const takenIds = oldestFirst.map((t) => t.row.id)
	for (const { row, reverted } of oldestFirst) {
		if (!reverted) continue
		if (await laterDeltaStands(tx, row.sessionId, row.owner, row.id, takenIds)) continue
		let document = row.after.document
		if (row.ownerVersion !== null) {
			const now = await ownerVersionOf(tx, row.owner)
			if (now !== null && now !== row.ownerVersion)
				document = await migrateOwnerDocument(
					tx,
					row.owner,
					row.sessionId,
					row.after.document ?? {},
					row.ownerVersion
				)
		}
		await landOwner(tx, row.sessionId, row.owner, { document, audiences: row.after.audiences })
	}
}

/**
 * The session's annex as it stood at `forkMessageId` — every delta anchored
 * after it reverted, newest first. For a branch's copy. A pure read.
 */
export async function annexAt(db: Db, sessionId: number, forkMessageId: number): Promise<Annex> {
	const [session] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const out: Annex = isPlainObject(session?.annex) ? structuredClone(session.annex) : {}
	const rows = await db
		.select()
		.from(schema.annexDeltas)
		.where(and(eq(schema.annexDeltas.sessionId, sessionId), gt(schema.annexDeltas.messageId, forkMessageId)))
		.orderBy(desc(schema.annexDeltas.id))
	for (const row of rows) {
		const kept = withTimeless(row.owner, row.before.document, out[row.owner])
		if (kept === null) delete out[row.owner]
		else out[row.owner] = kept
	}
	return out
}
