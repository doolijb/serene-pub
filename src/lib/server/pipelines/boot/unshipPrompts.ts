/**
 * A shipped prompt the catalog stopped shipping stays, as an ordinary row.
 *
 * The seed pass (`seedPrompts.ts`) inserts and corrects what `CORE_PROMPTS`
 * declares and never culls what it stopped declaring, so an install that
 * booted a build which shipped a row keeps it forever: immutable, matched by
 * its seed key, and offered as a default wherever its `defaultForSpecs`
 * claim said. Owner ruling 2026-10-13: a row the catalog stops shipping is
 * kept, and treated as one a person created — never a default, never
 * protected.
 *
 * So a core-seeded row whose seed key the catalog does not carry is made
 * what a person's row is wherever it shows: not immutable (editable and
 * deletable in Admin › Prompts, listed under *Also fits* rather than *Serene
 * Pub ships*), and no default claim. Its name, prose and pool are kept, and
 * every configuration that picked it keeps its pick — the row is still there.
 *
 * ⚠ Its seed key and template id are KEPT, and that is load-bearing. The
 * pool's names are unique (`pipeline_prompts_pool_name_idx`), so a row that
 * lost its key would make the seed pass insert a second row of the same name
 * the day the catalog ships that key again — a downgrade and upgrade, or a
 * stale SDK build booting a newer data dir — and the unique index would stop
 * the boot. Keyed, the seed pass finds the row and adopts it back
 * (`seedPrompts.ts` restores `isImmutable`); a package that refers to the
 * prompt by its template id keeps resolving. Nothing reads a prompt's seed
 * key as "shipped": the picker's group and the editor's lock read
 * `isImmutable` alone.
 *
 * The retired genres' rows are not this module's: `retiredGenres.ts`
 * deletes those, and runs first.
 */

import { and, eq, isNull, like, notInArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_PROMPTS } from "@serene-pub/core-catalog"

export interface UnshipPromptsReport {
	/** Rows demoted this boot — zero on every boot but the first after a cut. */
	demoted: string[]
}

/**
 * Demote every core-seeded prompt row whose seed key the catalog does not
 * ship. `shipped` is the catalog's keys; a test passes a smaller list.
 * Idempotent: a demoted row is not immutable, so it is not selected
 * again.
 */
export async function unshipPrompts(
	db: Db,
	shipped: readonly string[] = CORE_PROMPTS.map((p) => p.seedKey)
): Promise<UnshipPromptsReport> {
	const rows = await db
		.update(schema.pipelinePrompts)
		.set({
			isImmutable: false,
			defaultForSpecs: [],
			updatedAt: new Date()
		})
		.where(
			and(
				isNull(schema.pipelinePrompts.ownerPluginId),
				eq(schema.pipelinePrompts.isImmutable, true),
				like(schema.pipelinePrompts.seedKey, "pipeline-prompt:core:%"),
				notInArray(schema.pipelinePrompts.seedKey, [...shipped])
			)
		)
		.returning({ name: schema.pipelinePrompts.name })
	return { demoted: rows.map((r) => r.name) }
}
