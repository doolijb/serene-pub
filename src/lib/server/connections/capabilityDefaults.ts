/**
 * The instance's default connection and sampling config, per capability.
 *
 * These used to be columns on `system_settings` — one pair for text, and 0172
 * added a second pair for images. That does not scale: the capability space is
 * open, so a plugin introducing a transform would mean a migration, and the
 * table would grow a column pair for every modality anyone ever adds.
 *
 * So: one row per capability (0175). Only TRANSFORMS are ever registered —
 * "the default connection for text→image" is a sensible thing to want, and
 * "the default connection for JSON schema" is not, because a feature qualifies
 * a request rather than being something a node goes shopping for.
 *
 * ⚠ Until 0181 this header said `default_connection_id` / `default_sampling_id`
 * on `system_settings` were "deliberately still there and still read by the
 * legacy generation path". They were, and both paths wrote both, and readers
 * checked the table first and the column only when the row was ABSENT — never
 * when it was merely STALE. Two spellings of one fact, which is how a star press
 * landed in the column, lost to a seeded row, and left the pipeline running on
 * yesterday's connection while every legacy screen showed today's. The columns
 * are gone (0181); this table is the only store.
 *
 * **Reading is not choosing.** Nothing here selects a connection — these are
 * lookups, and a capability with no row is a capability nothing will run. The
 * chain that decides (`capability default → pipeline config → session override`)
 * is `capabilityTarget.ts`, and it is the only caller that should be turning an
 * absent row into a sentence.
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
import { S, type TransformId } from "@serene-pub/sdk"
import { sidesOf, transformIdOf } from "$lib/shared/capabilities/sides"

export interface CapabilityDefault {
	connectionId: number | null
	samplingConfigId: number | null
}

/**
 * The `WHERE` that addresses one capability's row.
 *
 * Exported because the int tests need it too, and the alternative is each of
 * them hand-spelling `and(eq(input, …), eq(output, …))` — six copies of the
 * storage layout in files whose subject is not the storage layout. Built from
 * `sidesOf` like every write is, so a test cannot assert against a row shape
 * this file does not actually produce.
 */
export const byCapability = (capability: string) => {
	const { input, output } = sidesOf(capability as TransformId)
	return and(
		eq(schema.connectionDefaults.input, input),
		eq(schema.connectionDefaults.output, output)
	)
}

/**
 * Every registered default, as a map.
 *
 * One query rather than one per capability: the config world needs all of them
 * to build `activeConnection`, and the picker needs them to mark which entry is
 * the default.
 */
export async function capabilityDefaults(
	db: any
): Promise<Record<string, CapabilityDefault>> {
	const rows = await db.select().from(schema.connectionDefaults)
	const out: Record<string, CapabilityDefault> = {}
	// Keyed by the transform id, still — the columns are the storage form and
	// this map is the in-memory one. `transformIdOf` never throws, so one junk
	// row lands as a junk key nothing matches rather than taking every good
	// default in this same query down with it.
	for (const r of rows)
		out[transformIdOf(r)] = {
			connectionId: r.connectionId ?? null,
			samplingConfigId: r.samplingConfigId ?? null
		}
	return out
}

export async function capabilityDefault(
	db: any,
	capability: string
): Promise<CapabilityDefault | undefined> {
	const [row] = await db
		.select()
		.from(schema.connectionDefaults)
		.where(byCapability(capability))
		.limit(1)
	return row
		? {
				connectionId: row.connectionId ?? null,
				samplingConfigId: row.samplingConfigId ?? null
			}
		: undefined
}

/**
 * Set one half of a capability's default, leaving the other alone.
 *
 * Half at a time because the two are chosen from different screens — a
 * connection in Connections, a sampling config in Sampling — and a writer that
 * insisted on both would have each screen clobbering the other's choice.
 */
export async function setCapabilityDefault(
	db: any,
	capability: string,
	patch: Partial<CapabilityDefault>
): Promise<void> {
	const existing = await capabilityDefault(db, capability)
	if (!existing) {
		await db.insert(schema.connectionDefaults).values({
			// The pair, not the id. `sidesOf` refuses anything that is not a
			// transform, which is the guard `connections:setDefault` does not
			// have on the clearing path — see the header of `sides.ts`.
			...sidesOf(capability as TransformId),
			connectionId: patch.connectionId ?? null,
			samplingConfigId: patch.samplingConfigId ?? null
		})
		return
	}
	await db
		.update(schema.connectionDefaults)
		.set({
			...(patch.connectionId !== undefined
				? { connectionId: patch.connectionId }
				: {}),
			...(patch.samplingConfigId !== undefined
				? { samplingConfigId: patch.samplingConfigId }
				: {})
		})
		.where(byCapability(capability))
}

/**
 * `sampling_configs.shape` is still a shape id (`core:shape/image-gen@1`); the
 * default it registers is keyed by capability. The translation lives in
 * `$lib/shared` so the sampling sidebar reads the same three comparisons this
 * file does — it cannot import from here, and when it had its own copy the two
 * disagreed about TTS.
 */
export { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
