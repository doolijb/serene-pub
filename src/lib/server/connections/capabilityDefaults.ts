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
 * `default_connection_id` / `default_sampling_id` on `system_settings` are
 * deliberately still there and still read by the legacy generation path. This
 * table was seeded from them and is what the pipeline path uses.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { S } from "@serene-pub/sdk"

export interface CapabilityDefault {
	connectionId: number | null
	samplingConfigId: number | null
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
	for (const r of rows)
		out[r.capability] = {
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
		.where(eq(schema.connectionDefaults.capability, capability))
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
			capability,
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
		.where(eq(schema.connectionDefaults.capability, capability))
}

/**
 * `sampling_configs.shape` is still a shape id (`core:shape/image-gen@1`); the
 * default it registers is keyed by capability. The translation lives in
 * `$lib/shared` so the sampling sidebar reads the same three comparisons this
 * file does — it cannot import from here, and when it had its own copy the two
 * disagreed about TTS.
 */
export { capabilityForSamplingShape } from "$lib/shared/capabilities/samplingShape"
