/**
 * ⏳ **The per-workflow sampling configs go** (ruling 13 of
 * DESIGN-image-generation §7.1, reversed 2026-10-12). Owner: *"Why do we have
 * a bunch of 'workflow' sampling configs? I never asked for this."*
 *
 * From 2026-10-11 every ComfyUI workflow, the starters included, seeded a
 * *Default* sampling config of its own shape (`core:shape/workflow-<id>@1`,
 * seed key `workflow:<id>:default`). A workflow's dials are now its own
 * variables with defaults, set in the workflow editor, and a loadout may
 * override them — so these rows drive nothing. This removes:
 *
 *  - every row whose `seed_key` starts with `workflow:` (the seeded
 *    *Default*s), and
 *  - every row still speaking a workflow shape — a copy a person made of
 *    one. No picker offers that shape any more and the write path refuses
 *    it, so such a row could only list under a heading nothing reads.
 *
 * A job default or loadout that named one falls back to unset
 * (`ON DELETE SET NULL`). Idempotent: a second boot finds nothing, and logs
 * nothing. Never a migration (rows, not schema). Delete this module once a
 * release has shipped it.
 */

import { like, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { RETIRED_WORKFLOW_SEED_KEY_PREFIX } from "$lib/shared/imageGen/workflowShape"

/** Deletes the retired rows; returns how many went. */
export async function removeWorkflowSamplingConfigs(db: Db): Promise<number> {
	const gone = await db
		.delete(schema.samplingConfigs)
		.where(
			or(
				like(schema.samplingConfigs.seedKey, `${RETIRED_WORKFLOW_SEED_KEY_PREFIX}%`),
				like(schema.samplingConfigs.shape, "core:shape/workflow-%")
			)
		)
		.returning({ id: schema.samplingConfigs.id })
	if (gone.length)
		console.log(
			`[sampling] Removed ${gone.length} per-workflow sampling config(s); a workflow's dials are set in its editor now.`
		)
	return gone.length
}
