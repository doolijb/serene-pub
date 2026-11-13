/**
 * The boot pass that folds a `pub` default loadout the one-shot minted onto
 * the core loadout that has since shipped for its transform (owner ruling
 * 2026-11-11: "merge in").
 *
 * Why it exists: `fromConnectionDefaults.ts` gives a transform core ships no
 * default for a `pub` loadout named after it. Vision was that transform until
 * `core:loadout/vision@1` shipped (2026-11-10). An install upgraded before
 * then kept its `pub:loadout/vision` as the default, so core's row seeded
 * unclaimed beside it: two tiles named **Vision**, the core one reading
 * "Unfilled — falls back to Vision" and never able to become the default.
 *
 * What it does, per core declaration with `defaultFor`: when the transform's
 * default is a `pub` row in the one-shot's own shape (named by the transform's
 * label, no description, not merged) and core's row is unclaimed, the pub
 * row's pair, sampling, workflow and claim move onto core's row; loadouts
 * merged into the pub row and voices filed under it follow; the pub row goes.
 * A pub default a person renamed or described is theirs and is left alone.
 *
 * Idempotent: the second boot finds no such pub row and changes nothing
 * (`foldPubDefaults.int.test.ts`). References by id in pipeline values
 * (`pub:loadout/vision`) resolve as a missing loadout does — to the
 * transform's default, which is now the same pair on core's row.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { capabilityLabel, type TransformId } from "@serene-pub/sdk"
import { sidesOf } from "$lib/shared/capabilities/sides"

export interface FoldReport {
	/** Transforms whose pub default was folded onto core's row. */
	folded: string[]
}

export async function foldPubDefaultsOntoCore(db: Db): Promise<FoldReport> {
	const { CORE_LOADOUTS } = await import("@serene-pub/core-catalog")
	const report: FoldReport = { folded: [] }
	for (const decl of CORE_LOADOUTS) {
		if (!decl.defaultFor) continue
		const { input, output } = sidesOf(decl.transform as TransformId)
		const [pub] = await db
			.select()
			.from(schema.loadouts)
			.where(
				and(
					eq(schema.loadouts.owner, "pub"),
					eq(schema.loadouts.defaultForInput, input),
					eq(schema.loadouts.defaultForOutput, output)
				)
			)
		if (!pub) continue
		// The one-shot's shape only: a person's own pub default is theirs.
		if (
			pub.name !== capabilityLabel(decl.transform as TransformId) ||
			pub.description != null ||
			pub.mergedInto != null
		)
			continue
		const [core] = await db
			.select()
			.from(schema.loadouts)
			.where(eq(schema.loadouts.seedKey, decl.id))
		if (!core || core.defaultForInput != null) continue

		await db.transaction(async (tx) => {
			// The claim must leave the pub row before core's row takes it:
			// a default is one row per transform.
			await tx
				.update(schema.loadouts)
				.set({ defaultForInput: null, defaultForOutput: null })
				.where(eq(schema.loadouts.id, pub.id))
			await tx
				.update(schema.loadouts)
				.set({
					connectionId: pub.connectionId,
					connectionModelId: pub.connectionModelId,
					samplingConfigId: pub.samplingConfigId,
					workflowId: pub.workflowId,
					workflowValues: pub.workflowValues,
					defaultVoiceId: pub.defaultVoiceId,
					otherSpeakersVoiceId: pub.otherSpeakersVoiceId,
					defaultForInput: input,
					defaultForOutput: output,
					updatedAt: new Date()
				})
				.where(eq(schema.loadouts.id, core.id))
			await tx
				.update(schema.loadouts)
				.set({ mergedInto: core.id })
				.where(eq(schema.loadouts.mergedInto, pub.id))
			await tx
				.update(schema.voicebankVoices)
				.set({ loadoutId: core.id })
				.where(eq(schema.voicebankVoices.loadoutId, pub.id))
			await tx.delete(schema.loadouts).where(eq(schema.loadouts.id, pub.id))
		})
		report.folded.push(decl.transform)
		console.log(
			`[loadouts] folded the pub ${pub.name} default onto ${decl.id} (${decl.transform})`
		)
	}
	return report
}
