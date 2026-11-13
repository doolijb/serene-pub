/**
 * 🚧 **Annex changes, per key** (pr-6 B5, reshaped by ST3, 2026-11-11: "the
 * annex becomes purely the modders' home"). Every write of one owner's annex
 * document by `set-session-annex` / `set-annex-field` files one
 * `session_imprints` row per key whose value or audience changed (kind `annex`,
 * key `<owner>/<key>`, `sessions/sessionImprints.ts`), anchored to the turn's
 * message. Back and a replacement take those rows by the one retraction rule
 * (a later row of the same key stands: later writer wins) and Forward puts
 * them back; the settle line settles them. A write with no anchor files none:
 * it is permanent at once, as every unanchored session fact is.
 *
 * This module holds what is left of the old whole-document deltas: the
 * timeless keys, the legacy revision-points key, and `annexAt`, a branch's
 * annex as of the fork, folded key by key.
 */

import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { unwrap } from "$lib/server/lorebooks/imprints"
import { sessionImprintsAfter } from "./sessionImprints"

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
 * session (`core.retake-quietly`, "Don't ask again" on Regenerate). A write of
 * one files no imprint; Back, Forward and a branch's `annexAt` leave it as it
 * stands now.
 */
const TIMELESS: Readonly<Record<string, readonly string[]>> = Object.freeze({ core: ["retake-quietly"] })

/** Whether this owner's key never follows the story (no imprint is filed for it). */
export const isTimelessAnnexKey = (owner: string, key: string): boolean => TIMELESS[owner]?.includes(key) ?? false

/**
 * The session's annex as it stood at `forkMessageId`: the current annex, then
 * every `annex` imprint row anchored after it, newest first, sets its key back
 * to its `before` (removed when absent; an owner whose document empties is
 * removed). Timeless keys are never touched. For a branch's copy. A pure read.
 */
export async function annexAt(db: Db, sessionId: number, forkMessageId: number): Promise<Annex> {
	const [session] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const out: Annex = isPlainObject(session?.annex) ? structuredClone(session.annex) : {}
	const rows = await sessionImprintsAfter(db, sessionId, forkMessageId)
	for (const row of rows) {
		if (row.subjectKind !== "annex") continue
		const at = row.subjectKey.lastIndexOf("/")
		const owner = row.subjectKey.slice(0, at)
		const key = row.subjectKey.slice(at + 1)
		if (isTimelessAnnexKey(owner, key)) continue
		const before = unwrap(row.before)
		const doc = isPlainObject(out[owner]) ? { ...(out[owner] as Record<string, unknown>) } : {}
		if (before === undefined) delete doc[key]
		else doc[key] = structuredClone(before)
		if (Object.keys(doc).length) out[owner] = doc
		else delete out[owner]
	}
	return out
}
