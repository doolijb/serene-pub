/**
 * Test seam: a default-flagged loadout row from the `(input, output)` shape the
 * `connection_defaults` table used — so an int test that seeded a transform
 * default by hand reads the same after I12 moved the store to `loadouts`.
 */

import { isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { transformIdOf } from "$lib/shared/capabilities/sides"

export function defaultLoadoutRow(r: {
	input: string
	output: string
	connectionId?: number | null
	connectionModelId?: number | null
	samplingConfigId?: number | null
}): typeof schema.loadouts.$inferInsert {
	const transform = transformIdOf({ input: r.input, output: r.output })
	return {
		owner: "pub",
		slug: `default-${transform.replace(/[^a-z0-9]+/g, "-")}`,
		name: `Default ${transform}`,
		transform,
		defaultForInput: r.input,
		defaultForOutput: r.output,
		connectionId: r.connectionId ?? null,
		connectionModelId: r.connectionModelId ?? null,
		samplingConfigId: r.samplingConfigId ?? null
	}
}

/** The `WHERE` that keeps only default-flagged loadouts (the old table's rows). */
export const isDefaultLoadout = isNotNull(schema.loadouts.defaultForInput)
