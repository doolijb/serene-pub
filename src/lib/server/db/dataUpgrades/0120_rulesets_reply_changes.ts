/**
 * 0120 — **Story's reply onto its `reply.prose` branch** (PLAN-rulesets-
 * functions D7, merge lane M1, 2026-10-23). No shape change (the anchor
 * migration is drizzle's custom file). Story's reply (`core:spec/story-
 * respond`, 1.21.0 edited in place) moved its words' steps into the `reply`
 * junction's `prose` branch, beside *Replies carry changes*:
 *
 * | before | after |
 * |---|---|
 * | `generate` | `reply.prose.generate` |
 * | `save` | `reply.prose.save` |
 * | `spritePick` | `reply.prose.spritePick` |
 * | `spriteShow` | `reply.prose.spriteShow` |
 *
 * Everything stored by node key for that pipeline moves with them: the
 * session's and the pub's overrides (`pipeline_node_overrides`), a node's
 * rebind (`pipeline_node_rebinds`), a config's values and notices
 * (`pipeline_config_values`, `pipeline_config_notices`) and a registration's
 * values (`registrations.values`, keyed by node). Where the new address
 * already holds a row, that row stands and the old one goes. Another
 * pipeline's rows (a fork has node keys of its own), a run's history and an
 * author preset's version rows are left as they are.
 *
 * Raw SQL through `tx`; idempotent — a second run finds no old key.
 *
 * ⏳ RF fix 3 (2026-10-23): `save`, `spritePick` and `spriteShow` left the
 * branch again — one tail after the junction — and 0123 moves them back
 * (`REPLY_TAIL_KEYS`). This table stays as it ran.
 */
import type { DataUpgradeContext } from "./index"
import { moveNodeKeys, type NodeKeyMoveReport } from "./nodeKeyMove"

/** The pipeline whose node keys moved, frozen here. */
export const STORY_RESPOND = "core:spec/story-respond"

/** Old node key → new, frozen here. */
export const REPLY_PROSE_KEYS: Readonly<Record<string, string>> = Object.freeze({
	generate: "reply.prose.generate",
	save: "reply.prose.save",
	spritePick: "reply.prose.spritePick",
	spriteShow: "reply.prose.spriteShow"
})

/** What the upgrade did, table by table — for the log and the test. */
export type ReplyProseReport = NodeKeyMoveReport

/** The move, through the SQL 0123 shares (`nodeKeyMove.ts`). */
export async function replyProseUpgrade(tx: MigrationTx): Promise<ReplyProseReport> {
	return moveNodeKeys(tx, STORY_RESPOND, REPLY_PROSE_KEYS)
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const r = await replyProseUpgrade(tx)
	const moved = r.overrides + r.rebinds + r.configValues + r.notices + r.registrations
	if (moved || r.dropped)
		console.log(
			`[0120] Story's reply onto reply.prose: ${r.overrides} overrides, ${r.rebinds} rebinds, ${r.configValues} config values, ${r.notices} notices, ${r.registrations} registrations moved; ${r.dropped} superseded`
		)
}
