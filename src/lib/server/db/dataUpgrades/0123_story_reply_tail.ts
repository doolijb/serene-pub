/**
 * 0123 — **Story's reply tail, once, after the junction** (RF fix 3,
 * 2026-10-23). No shape change (the anchor migration is drizzle's custom
 * file). D7 (0120) put the reply's save and sprite steps inside the `reply`
 * junction's `prose` branch, and the `changes` branch carried its own copy of
 * each — two **Closest sprite** settings for one step (owner, 2026-10-23:
 * "careful about hidden behavior … why do we have duplicate sprites in the
 * pipeline?"). Story's reply (`core:spec/story-respond` 1.21.0, edited in
 * place) now keeps only what differs inside the branches — the model calls
 * and what reads their answers — and runs ONE tail after the junction at the
 * top-level keys it had before D7:
 *
 * | before | after |
 * |---|---|
 * | `reply.prose.save` | `save` |
 * | `reply.prose.spritePick` | `spritePick` |
 * | `reply.prose.spriteShow` | `spriteShow` |
 * | `reply.changes.commit.applied.apply` | `commit.applied.apply` |
 *
 * The first three are 0120's own table reversed, `generate` kept where 0120
 * put it (`reply.prose.generate`: the prose call stays in its branch). The
 * commit left the `changes` branch with them, after the save. Everything
 * stored by node key moves (`moveNodeKeys`: overrides, rebinds, config values
 * and notices, registration values); a row already at the new address wins.
 *
 * ⚠ Never merged: the `changes` branch's own copies (`reply.changes.save`,
 * `.spritePick`, `.spriteShow`, and the Review arm `reply.changes.commit.
 * reviewed.propose`, which never ran) have no step to move to and are left
 * as they are — a config value there is culled with a notice when the boot
 * reconciles configs, a session's override there is read by nothing. Folding
 * them into the one step would be two settings made into one, unasked.
 */
import type { DataUpgradeContext } from "./index"
import { REPLY_PROSE_KEYS, STORY_RESPOND } from "./0120_rulesets_reply_changes"
import { moveNodeKeys, type NodeKeyMoveReport } from "./nodeKeyMove"

/** Old node key → new, frozen here: 0120's table reversed (less `generate`), and the commit. */
export const REPLY_TAIL_KEYS: Readonly<Record<string, string>> = Object.freeze({
	...Object.fromEntries(
		Object.entries(REPLY_PROSE_KEYS)
			.filter(([before]) => before !== "generate")
			.map(([before, after]) => [after, before])
	),
	"reply.changes.commit.applied.apply": "commit.applied.apply"
})

/** The move — `moveNodeKeys` over Story's reply with `REPLY_TAIL_KEYS`. */
export async function replyTailUpgrade(tx: MigrationTx): Promise<NodeKeyMoveReport> {
	return moveNodeKeys(tx, STORY_RESPOND, REPLY_TAIL_KEYS)
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	const r = await replyTailUpgrade(tx)
	const moved = r.overrides + r.rebinds + r.configValues + r.notices + r.registrations
	if (moved || r.dropped)
		console.log(
			`[0123] Story's reply tail back after the junction: ${r.overrides} overrides, ${r.rebinds} rebinds, ${r.configValues} config values, ${r.notices} notices, ${r.registrations} registrations moved; ${r.dropped} superseded`
		)
}
