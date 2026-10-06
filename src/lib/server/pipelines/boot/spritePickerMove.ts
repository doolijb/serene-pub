/**
 * ⏳ **The sprite picker's settings follow it to its new node key** (plan
 * PLAN-embeddings-ner-connections D4, ruled 2026-10-05 with D-b).
 *
 * From 2026-09-24 to 2026-10-05 the picker sat inside a sprite tail a
 * core-catalog wrapper appended to four reply specs — respond (now
 * chat-respond), tool-loop, narrate-character (now chat-side-character) and
 * guide-respond — at `spriteTail.show.spritePick`
 * (`SPRITE_PICKER_NODE_KEY_V0`). The owner ruled it in-pipeline ("not a
 * wrapper"): each reply spec now writes the step out itself, and the picker's
 * key is `spritePick` (`SPRITE_PICKER_NODE_KEY`). Its settings — "Choose
 * sprites", stickiness and the floor — are stored by node key, so without a
 * move every one would be left at an address nothing reads.
 *
 * What moves, on those four specs only, from the old key to the new:
 *
 *  - **session overrides** (`pipeline_node_overrides`) — a session's own
 *    settings, the case the ruling names;
 *  - **session rebinds** (`pipeline_node_rebinds`, session scope) — whether
 *    one still wins is decided where it always is, at load
 *    (`applyNodeRebinds`: offered, shape-compatible, may stand in). An
 *    instance-scope rebind is an administrator's choice and is re-made in the
 *    admin swap list, as `moveSpeakerRebinds` leaves them;
 *  - **config values** (`pipeline_config_values`) — a named config's tuning
 *    of the same three settings. Left behind, `reconcileConfigs` would cull
 *    them as orphaned on this very boot, with a notice, which is a person's
 *    setting lost to a rename.
 *
 * ## The rules
 *
 * - A value already at the new address **wins** (`ON CONFLICT DO NOTHING`):
 *   a later choice is never overwritten by an earlier one. The old row is
 *   deleted either way — the node it names does not exist any more.
 * - `updated_by` and `updated_at` travel with the row, so the move does not
 *   claim the person's choice as the system's.
 *
 * ## Why a boot step, and why BEFORE the catalog seed
 *
 * The precedent (`moveSpeakerRebinds`) is a boot-seed post-step, not a
 * migration, because its rows point at a spec the seed creates. Here the spec
 * is the same one — only the node key moves — so nothing needs to be seeded
 * first, and the order runs the other way on purpose: `seedCoreSpecs`
 * publishes the new version and reconciles configs against it, culling every
 * config value at an address the new version does not declare. Moved first,
 * those values are at `spritePick` when the reconcile looks.
 *
 * Idempotent and re-runnable: a second boot finds nothing at the old key.
 * Delete this module, and `SPRITE_PICKER_NODE_KEY_V0` with it, once a release
 * has shipped the move.
 */

import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** What one boot's sprite picker move did. */
export interface SpritePickerMoveReport {
	/** Rows moved to the new key this boot, per table. */
	moved: { overrides: number; rebinds: number; configValues: number }
	/** Old rows dropped because the new address already held a value. */
	kept: number
}

export async function moveSpritePickerSettings(
	db: Db
): Promise<SpritePickerMoveReport> {
	const {
		SPRITE_PICKER_NODE_KEY,
		SPRITE_PICKER_NODE_KEY_V0,
		CHAT_RESPOND_SPEC_ID,
		TOOL_LOOP_SPEC_ID,
		CHAT_SIDE_CHARACTER_SPEC_ID,
		GUIDE_RESPOND_SPEC_ID
	} = await import("@serene-pub/core-catalog")
	const report: SpritePickerMoveReport = {
		moved: { overrides: 0, rebinds: 0, configValues: 0 },
		kept: 0
	}
	// The four specs the retired wrapper wrapped — never every spec: a key a
	// plugin's spec happens to spell the same way is that plugin's. Two of
	// them were renamed the same day (`respond` → `chat-respond`,
	// `narrate-character` → `chat-side-character`), and the boot pass that
	// renames the rows is not ordered against this one, so each is found by
	// either spelling: the row id is the same, only its slug moves.
	const specRows = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(
			inArray(schema.pipelineSpecs.slug, [
				CHAT_RESPOND_SPEC_ID,
				"core:spec/respond",
				TOOL_LOOP_SPEC_ID,
				CHAT_SIDE_CHARACTER_SPEC_ID,
				"core:spec/narrate-character",
				GUIDE_RESPOND_SPEC_ID
			])
		)
	const specIds = specRows.map((r) => r.id)
	if (!specIds.length) return report

	const overrides = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				inArray(schema.pipelineNodeOverrides.specId, specIds),
				eq(
					schema.pipelineNodeOverrides.nodeKey,
					SPRITE_PICKER_NODE_KEY_V0
				)
			)
		)
	for (const { id, ...row } of overrides) {
		const written = await db
			.insert(schema.pipelineNodeOverrides)
			.values({ ...row, nodeKey: SPRITE_PICKER_NODE_KEY })
			.onConflictDoNothing()
			.returning({ id: schema.pipelineNodeOverrides.id })
		if (written.length) report.moved.overrides++
		else report.kept++
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.id, id))
	}

	const rebinds = await db
		.select()
		.from(schema.pipelineNodeRebinds)
		.where(
			and(
				inArray(schema.pipelineNodeRebinds.specId, specIds),
				eq(schema.pipelineNodeRebinds.scopeKind, "session"),
				eq(
					schema.pipelineNodeRebinds.nodeKey,
					SPRITE_PICKER_NODE_KEY_V0
				)
			)
		)
	for (const { id, ...row } of rebinds) {
		const written = await db
			.insert(schema.pipelineNodeRebinds)
			.values({ ...row, nodeKey: SPRITE_PICKER_NODE_KEY })
			.onConflictDoNothing()
			.returning({ id: schema.pipelineNodeRebinds.id })
		if (written.length) report.moved.rebinds++
		else report.kept++
		await db
			.delete(schema.pipelineNodeRebinds)
			.where(eq(schema.pipelineNodeRebinds.id, id))
	}

	const configIds = (
		await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(inArray(schema.pipelineConfigs.specId, specIds))
	).map((r) => r.id)
	const values = configIds.length
		? await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(
					and(
						inArray(
							schema.pipelineConfigValues.configId,
							configIds
						),
						eq(
							schema.pipelineConfigValues.nodeKey,
							SPRITE_PICKER_NODE_KEY_V0
						)
					)
				)
		: []
	for (const { id, ...row } of values) {
		const written = await db
			.insert(schema.pipelineConfigValues)
			.values({ ...row, nodeKey: SPRITE_PICKER_NODE_KEY })
			.onConflictDoNothing()
			.returning({ id: schema.pipelineConfigValues.id })
		if (written.length) report.moved.configValues++
		else report.kept++
		await db
			.delete(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.id, id))
	}

	const { overrides: o, rebinds: r, configValues: c } = report.moved
	if (o || r || c || report.kept)
		console.log(
			`[pipelines] moved the sprite picker's settings to '${SPRITE_PICKER_NODE_KEY}': ` +
				`${o} session setting(s), ${r} session rebind(s), ${c} config value(s)` +
				(report.kept
					? `; ${report.kept} already set at the new key, kept`
					: "")
		)
	return report
}
