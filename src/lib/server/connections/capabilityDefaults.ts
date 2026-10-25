/**
 * The instance's default connection and sampling config, per capability.
 *
 * A column pair on `system_settings` does not scale: the capability space is
 * open, so a plugin introducing a transform would mean a migration, and the
 * table would grow a column pair for every modality anyone ever adds.
 *
 * So: one row per capability (0175). Only TRANSFORMS are ever registered —
 * "the default connection for text→image" is a sensible thing to want, and
 * "the default connection for JSON schema" is not, because a feature qualifies
 * a request rather than being something a node goes shopping for.
 *
 * ⚠ `system_settings.default_connection_id` / `default_sampling_id` do not
 * exist and must not come back. Two spellings of one fact is how a star press
 * lands in one, is lost to a seeded row, and leaves the pipeline running on a
 * stale connection while every reader checking the other spelling sees
 * today's. This table is the only store.
 *
 * **Reading is not choosing.** Nothing here selects a connection — these are
 * lookups, and a capability with no row is a capability nothing will run. The
 * chain that decides (`capability default → pipeline config`; a session names
 * no connection) is `capabilityTarget.ts`, and it is the only caller that
 * should be turning an absent row into a sentence.
 *
 * ## This file is the storage boundary, and the only one (0183)
 *
 * The table is keyed by the transform's two SIDES — `input` and `output`,
 * comma-delimited `IoKind` lists — while everything above this file speaks the
 * transform ID, `text+image->text`. The id is the canonical in-memory form:
 * `capabilityDefaults()` returns a map keyed by it, node `requires` name it,
 * `TRANSFORMS` is keyed by it. Nothing outside this file and
 * `$lib/shared/capabilities/sides.ts` needs to know the column shape, and
 * nothing should learn it — a second place that spells the pair is a second
 * place that can spell it differently, which on a PRIMARY KEY means a row
 * nothing ever matches again.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { S, capabilityLabel, type TransformId } from "@serene-pub/sdk"
import { sidesOf } from "$lib/shared/capabilities/sides"
import {
	defaultLoadoutFor,
	defaultLoadouts,
	freePubSlug,
	mergeChain,
	type LoadoutRow
} from "$lib/server/loadouts"
import { coreDefaultSeedFor } from "$lib/server/loadouts/seed"

export interface CapabilityDefault {
	connectionId: number | null
	/**
	 * WHICH MODEL on that endpoint (0114). NULL means its default model.
	 *
	 * Half of a PAIR, and it only ever travels with the `connectionId` beside
	 * it — a model id means nothing without the endpoint it belongs to. That is
	 * why `setCapabilityDefault` writes them together and why
	 * `resolveCapabilityTarget` takes the model from whichever TIER won the
	 * connection rather than walking the two independently.
	 */
	connectionModelId: number | null
	samplingConfigId: number | null
}

/**
 * ## Since I12 the store is `loadouts` (0103)
 *
 * A transform's default is the **default loadout** — the `loadouts` row whose
 * `(default_for_input, default_for_output)` names it. `connection_defaults` is
 * unread: the boot one-shot (`loadouts/fromConnectionDefaults.ts`)
 * moves its rows here. Everything above this file still speaks
 * `CapabilityDefault` — the boundary moved, the shape did not.
 *
 * A default loadout that is MERGED into another reads as its root's values:
 * merging is a run-time redirect, and the default is a run-time read.
 */

/**
 * The `WHERE` that addresses one capability's default loadout. Exported for
 * the int tests, built from `sidesOf` like every write.
 */
export const byCapability = (capability: string) => {
	const { input, output } = sidesOf(capability as TransformId)
	return and(
		eq(schema.loadouts.defaultForInput, input),
		eq(schema.loadouts.defaultForOutput, output)
	)
}

const valuesOf = (row: LoadoutRow): CapabilityDefault => ({
	connectionId: row.connectionId ?? null,
	connectionModelId: row.connectionModelId ?? null,
	samplingConfigId: row.samplingConfigId ?? null
})

/** The default loadout's values, through its merges. */
async function effectiveValues(db: Db, row: LoadoutRow): Promise<CapabilityDefault> {
	if (row.mergedInto == null) return valuesOf(row)
	const chain = await mergeChain(db, row)
	return valuesOf(chain[chain.length - 1]!)
}

/**
 * Every registered default, as a map keyed by transform id.
 *
 * One query rather than one per capability: the config world needs all of them
 * to build `activeConnection`, and the picker needs them to mark which entry is
 * the default.
 */
export async function capabilityDefaults(
	db: Db
): Promise<Record<string, CapabilityDefault>> {
	const out: Record<string, CapabilityDefault> = {}
	for (const [transform, row] of await defaultLoadouts(db))
		out[transform] = await effectiveValues(db, row)
	return out
}

export async function capabilityDefault(
	db: Db,
	capability: string
): Promise<CapabilityDefault | undefined> {
	const row = await defaultLoadoutFor(db, capability)
	return row ? effectiveValues(db, row) : undefined
}

/**
 * The loadout that becomes a transform's default the first time one is set:
 * core's declared default for it (Reply for `text->text`) while that row is
 * not already some other transform's default, else a new `pub` loadout named
 * after the transform. Never a row id from a list — by seed key.
 */
async function claimDefaultLoadout(db: Db, capability: string): Promise<LoadoutRow> {
	const { input, output } = sidesOf(capability as TransformId)
	const seedKey = await coreDefaultSeedFor(capability)
	if (seedKey) {
		const coreRow = async () =>
			(
				await db
					.select()
					.from(schema.loadouts)
					.where(eq(schema.loadouts.seedKey, seedKey))
					.limit(1)
			)[0]
		// A writer that runs before boot's seed pass (the 0.5.3 attic) still
		// claims core's row rather than minting a pub one beside it.
		let core = await coreRow()
		if (!core) {
			const { seedCoreLoadouts } = await import("$lib/server/loadouts/seed")
			await seedCoreLoadouts(db)
			core = await coreRow()
		}
		if (core && core.defaultForInput == null) {
			const [claimed] = await db
				.update(schema.loadouts)
				.set({ defaultForInput: input, defaultForOutput: output, updatedAt: new Date() })
				.where(eq(schema.loadouts.id, core.id))
				.returning()
			return claimed!
		}
	}
	const name = capabilityLabel(capability as TransformId)
	const [made] = await db
		.insert(schema.loadouts)
		.values({
			owner: "pub",
			slug: await freePubSlug(db, name),
			name,
			description: null,
			transform: capability,
			defaultForInput: input,
			defaultForOutput: output
		})
		.returning()
	return made!
}

/**
 * Set one half of a capability's default, leaving the other alone.
 *
 * Half at a time because the two are chosen from different screens — a
 * connection in Connections, a sampling config in Sampling — and a writer that
 * insisted on both would have each screen clobbering the other's choice.
 *
 * Writes the default LOADOUT's own row (never its merge parent's: a merged
 * default keeps its own values, ignored while merged, readable on unmerge).
 */
export async function setCapabilityDefault(
	db: Db,
	capability: string,
	patch: Partial<CapabilityDefault>
): Promise<void> {
	// 🚧 R56: what a model is set for is what is served.
	;(await import("$lib/server/pipelines/registrations/unserved")).invalidateUnserved()
	const existing = await defaultLoadoutFor(db, capability)
	if (!existing) {
		// `sidesOf` (inside the claim) refuses anything that is not a
		// transform, which is the guard `connections:setDefault` does not have
		// on the clearing path — see the header of `sides.ts`.
		const row = await claimDefaultLoadout(db, capability)
		// "No row" became "a row": the first write states all three halves,
		// exactly as the insert into `connection_defaults` did.
		await db
			.update(schema.loadouts)
			.set({
				connectionId: patch.connectionId ?? null,
				connectionModelId: patch.connectionModelId ?? null,
				samplingConfigId: patch.samplingConfigId ?? null,
				updatedAt: new Date()
			})
			.where(eq(schema.loadouts.id, row.id))
		return
	}
	await db
		.update(schema.loadouts)
		.set({
			// ⚠ The model rides with the CONNECTION and not on its own. A caller
			// that named an endpoint and said nothing about a model means "its
			// default", never "keep the model the previous endpoint had" — that
			// second reading would leave a registration pointing at a model row
			// belonging to a different connection, which is a pair no picker can
			// display and no run can resolve. So writing `connectionId` always
			// writes `connectionModelId` too, even when the caller omitted it.
			...(patch.connectionId !== undefined
				? {
						connectionId: patch.connectionId,
						connectionModelId: patch.connectionModelId ?? null
					}
				: patch.connectionModelId !== undefined
					? { connectionModelId: patch.connectionModelId }
					: {}),
			...(patch.samplingConfigId !== undefined
				? { samplingConfigId: patch.samplingConfigId }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(schema.loadouts.id, existing.id))
}

/**
 * `sampling_configs.shape` is still a shape id (`core:shape/image-gen@1`); the
 * default it registers is keyed by capability. The translation lives in
 * `$lib/shared` so the sampling sidebar reads the same three comparisons this
 * file does — it cannot import from here, and when it had its own copy the two
 * disagreed about TTS.
 */
export { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
