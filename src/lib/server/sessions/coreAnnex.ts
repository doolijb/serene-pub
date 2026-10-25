/**
 * 🚧 **The core runtime keys** (pr-6s2 C4, ruled 2026-10-24: "`sessions.metadata`
 * runtime keys → annex owner `core`"; shapes: ~/.claude/plans/briefs/pr6s2-G-shapes.md
 * §G-1).
 *
 * Core keeps four pieces of runtime state on its own annex owner, `core`,
 * beside core's DECLARED annex fields (`retake-quietly`, `story-goals`, …) in
 * the same owner document:
 *
 *  - `turnOrder` — `TurnOrderV1`, written by `writeTurnOrder` alone;
 *  - `turnTally` — `TurnTallyV1`, written by `writeLaneTally` / `writeTurnTally`;
 *  - `laneReads` — `{ "<userId>": { "<canonical lane>": <message id> } }`,
 *    written by `markLaneRead`;
 *  - `rulesetDecks` — `{ [methodKey]: DeckState }`, written by the ruleset
 *    resolver's `writeDecks`.
 *
 * They are runtime state, never a story change:
 *
 *  1. written by the host's own helpers, never through `writeAnnexDocument`
 *     — so no annex delta, no `annex-changed`, no annex view push;
 *  2. never retracted: when Back, Forward or a branch's `annexAt` lands a
 *     `core` document, these keys keep the values they hold NOW
 *     (`TIMELESS.core` in `annexChanges.ts`);
 *  3. never on a pipeline's read (`annexForPipelines`, `ownerDocForPipelines`)
 *     and never a pipeline's to write (undeclared, so `annexWriteRefusals`
 *     refuses them, and a replace keeps them);
 *  4. every write takes the annex's one lock (`lockSessionAnnex`) inside its
 *     own transaction and writes ONE key (`coreAnnexSetSql`).
 *
 * A leaf module: drizzle and the schema only (annexChanges.ts imports this).
 */

import { eq, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The annex owner core keeps its own document under. */
export const CORE_ANNEX_OWNER = "core"

/** 🚧 The core runtime keys, in the `core` owner's document. */
export const CORE_RUNTIME_KEYS = Object.freeze(["turnOrder", "turnTally", "laneReads", "rulesetDecks"] as const)

export type CoreRuntimeKey = (typeof CORE_RUNTIME_KEYS)[number]

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

const RUNTIME: ReadonlySet<string> = new Set(CORE_RUNTIME_KEYS)

/** The `core` owner's document out of an annex value already read; `{}` when absent or not a plain object. Pure. */
export function coreAnnexIn(annex: unknown): Record<string, unknown> {
	if (!isPlainObject(annex)) return {}
	const doc = annex[CORE_ANNEX_OWNER]
	return isPlainObject(doc) ? doc : {}
}

/** One session's `core` document (one indexed read of `sessions.annex`); null when the session is gone. */
export async function readCoreAnnex(db: Db, sessionId: number): Promise<Record<string, unknown> | null> {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	return coreAnnexIn(row.annex)
}

/** SQL (jsonb): the stored value of one key — `sessions.annex -> 'core' -> <key>`; SQL NULL when absent. */
export function coreAnnexKeySql(key: CoreRuntimeKey): SQL {
	return sql`(coalesce(${schema.sessions.annex}, '{}'::jsonb) -> ${CORE_ANNEX_OWNER}::text -> ${key}::text)`
}

/** SQL (jsonb): the `core` document as stored, `{}` when absent or not an object. */
const coreDocSql = (): SQL =>
	sql`(CASE WHEN jsonb_typeof(${schema.sessions.annex} -> ${CORE_ANNEX_OWNER}::text) = 'object' THEN ${schema.sessions.annex} -> ${CORE_ANNEX_OWNER}::text ELSE '{}'::jsonb END)`

/**
 * SQL (jsonb): `sessions.annex` with `core.<key>` set to `value` (a jsonb SQL
 * expression), or removed when `value` is null — every other key and owner
 * untouched; a `core` that is not an object is treated as `{}`. For
 * `set annex = ${coreAnnexSetSql(…)}`.
 */
export function coreAnnexSetSql(key: CoreRuntimeKey, value: SQL | null): SQL {
	const next = value === null ? sql`(${coreDocSql()} - ${key}::text)` : sql`(${coreDocSql()} || jsonb_build_object(${key}::text, ${value}))`
	return sql`jsonb_set(coalesce(${schema.sessions.annex}, '{}'::jsonb), ARRAY[${CORE_ANNEX_OWNER}]::text[], ${next}, true)`
}

/** The annex's one lock (`pg_advisory_xact_lock(hashtext('annex'), sessionId)`), inside the caller's transaction. */
export async function lockSessionAnnex(tx: Db, sessionId: number): Promise<void> {
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`)
}

/** One owner's document as a pipeline may see it — `core`'s without the four runtime keys; any other owner's as it is. Pure. */
export function ownerDocForPipelines(owner: string, doc: Record<string, unknown>): Record<string, unknown> {
	if (owner !== CORE_ANNEX_OWNER) return doc
	if (!Object.keys(doc).some((k) => RUNTIME.has(k))) return doc
	return Object.fromEntries(Object.entries(doc).filter(([k]) => !RUNTIME.has(k)))
}

/**
 * The annex as a pipeline may see it: `core` without the four runtime keys
 * (dropped when that leaves it empty); every other owner untouched. Pure.
 */
export function annexForPipelines(annex: Record<string, unknown>): Record<string, unknown> {
	const doc = annex[CORE_ANNEX_OWNER]
	if (!isPlainObject(doc)) return annex
	const kept = ownerDocForPipelines(CORE_ANNEX_OWNER, doc)
	if (kept === doc) return annex
	// The owners in their stored order, `core` in its place (or gone).
	const out: Record<string, unknown> = {}
	for (const [owner, value] of Object.entries(annex))
		if (owner !== CORE_ANNEX_OWNER) out[owner] = value
		else if (Object.keys(kept).length) out[owner] = kept
	return out
}
