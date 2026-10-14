/**
 * The boot one-shot that moves `connection_defaults` into **default loadouts**
 * (I12). Precedent: `pipelines/boot/spritePickerMove.ts` — a data move done at
 * boot rather than in SQL, because which loadout a row becomes is decided by
 * core's declarations (`CORE_LOADOUTS[].defaultFor`), which no migration can
 * read.
 *
 * Each row becomes the default loadout for its `(input, output)`:
 *   · the core loadout declared for that transform (Reply ↔ `text->text`,
 *     Images ↔ `text->image`, Narration, Embeddings, Entities), when it is not
 *     already some transform's default;
 *   · else a `pub` loadout named after the transform (Vision, say).
 * The row's three values are copied verbatim — including a null sampling,
 * which means "let the backend decide" and must not be replaced by the core
 * loadout's seeded preset.
 *
 * A transform that already HAS a default loadout keeps it (the move ran, or a
 * person set one since), and the old row is dropped either way. Dropping is
 * what makes this a one-shot: `connection_defaults` is read by nothing after
 * this lane (`connections/capabilityDefaults.ts` reads loadouts only), and a
 * row left behind would be re-moved over a person's later choice.
 *
 * Runs after `seedCoreLoadouts` and before the seeded sampling defaults are
 * registered (`db/defaults.ts`), so an upgraded install's rows win over a
 * fresh install's first-run seeding.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { isTransformId, type TransformId } from "@serene-pub/sdk"
import { transformIdOf } from "$lib/shared/capabilities/sides"
import { defaultLoadoutFor } from "$lib/server/loadouts"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

export interface ConnectionDefaultsMoveReport {
	/** Rows that became (or filled) a default loadout. */
	moved: number
	/** Rows dropped because the transform already had a default loadout. */
	kept: number
	/** Rows whose sides name no transform — dropped, they matched nothing. */
	dropped: number
}

export async function moveConnectionDefaultsToLoadouts(
	db: Db
): Promise<ConnectionDefaultsMoveReport> {
	const report: ConnectionDefaultsMoveReport = { moved: 0, kept: 0, dropped: 0 }
	const rows = await db.select().from(schema.connectionDefaults)
	for (const row of rows) {
		const transform = transformIdOf(row)
		const where = and(
			eq(schema.connectionDefaults.input, row.input),
			eq(schema.connectionDefaults.output, row.output)
		)
		if (!isTransformId(transform)) {
			await db.delete(schema.connectionDefaults).where(where)
			report.dropped++
			continue
		}
		if (await defaultLoadoutFor(db, transform)) {
			report.kept++
		} else {
			// The claim path: core's declared default for the transform, or a
			// pub loadout named after it — and all three values verbatim.
			await setCapabilityDefault(db, transform as TransformId, {
				connectionId: row.connectionId ?? null,
				connectionModelId: row.connectionModelId ?? null,
				samplingConfigId: row.samplingConfigId ?? null
			})
			report.moved++
		}
		await db.delete(schema.connectionDefaults).where(where)
	}
	return report
}
