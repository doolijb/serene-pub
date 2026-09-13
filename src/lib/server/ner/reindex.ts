/**
 * What moving the entity star costs, and what it does.
 *
 * ## The consequence lives with the star, not with the screens
 *
 * An entity model is chosen the way every other connection is chosen, with
 * `connections:setDefault`. Moving THAT star has to stop the lane, unload the
 * model, drop the annotations, forget a remembered load failure, and start
 * again — because every stored annotation was written by whichever extractor was
 * in force when the lane reached that row. Those steps live here and the handler
 * calls them, so a screen that can move a star cannot forget one.
 *
 * ## Why the freshness triple cannot do this on its own
 *
 * A row is re-annotated when its text moves, its lorebook's vocabulary moves, or
 * `EXTRACTOR_VERSION` moves. A star change moves none of the three: the same
 * code, over the same text, against the same names, with a different model
 * behind it. So the rows would sit there looking current for ever, which is the
 * silent-wrongness the annotation design forbids. Bumping `EXTRACTOR_VERSION`
 * instead was the alternative and is worse — it would re-annotate every install,
 * including the ones that have never starred anything.
 *
 * ## Keyed on the model IDENTITY, never on the connection id
 *
 * Two rows can name the same model and produce identical annotations.
 * Re-annotating on an id change would be a full sweep to arrive exactly where it
 * started — and pressing the star twice on one row (it is a button; people do)
 * must be a no-op.
 *
 * ## Unstarring does not destroy the corpus
 *
 * Turning the model off is not a decision to throw work away: unstarring stops
 * the model and leaves every row where it is, so re-starring the same connection
 * costs nothing. The rows keep their model-tier entities, which remain true
 * statements about the text; they are replaced by lexical ones the next time
 * their content or vocabulary moves. The clear happens only when there is a NEW
 * model whose identity differs.
 */

import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveNerTarget } from "./target"
import { unloadNerModel } from "./index"
import { forgetNerLoadFailure } from "./broker"

export interface NerStarChange {
	/** True when the model identity moved and the annotations were dropped. */
	reannotated: boolean
	/** How many annotated rows were cleared. Zero on an unstar, and on a no-op. */
	cleared: number
	/** The identity now in force, or null with no star. */
	modelId: string | null
}

/**
 * What the star currently resolves to, as the identity to compare against.
 *
 * Read BEFORE the write by anything that is about to move the star; the
 * comparison is the whole of the decision below.
 */
export async function currentNerModelId(db: Db): Promise<string | null> {
	return (await resolveNerTarget(db))?.modelId ?? null
}

/**
 * How many rows a switch would re-scan, for the confirmation that precedes it.
 *
 * Annotated PARENTS — entries and messages — rather than annotation rows. A
 * person recognises "1,204 rows" as their lore and their transcript; the entity
 * rows underneath are several times that number and describe nothing anybody can
 * point at.
 *
 * ⚠ No time estimate accompanies it, deliberately. Nothing in the lane measures
 * throughput, and a made-up "roughly N minutes" on a screen whose whole job is
 * to state the cost accurately would be the one number on it that was invented.
 */
export async function nerReannotateCost(db: Db): Promise<{ rows: number }> {
	const [entries] = await db
		.select({
			n: sql<number>`count(distinct ${schema.entryAnnotations.entryId})`
		})
		.from(schema.entryAnnotations)
	const [messages] = await db
		.select({
			n: sql<number>`count(distinct ${schema.messageAnnotations.messageId})`
		})
		.from(schema.messageAnnotations)
	return { rows: Number(entries?.n ?? 0) + Number(messages?.n ?? 0) }
}

/**
 * Apply the consequence of the entity star having just moved.
 *
 * `before` is what `currentNerModelId` answered before the write. Returns what
 * happened, so a handler can say it.
 *
 * ⚠ Order is load-bearing: the lane STOPS before the clear. A pass still running
 * would write annotations back in behind the delete, under the old model, and
 * they would sit there looking current until something else re-annotated them.
 */
export async function applyNerStarChange(
	db: Db,
	before: string | null
): Promise<NerStarChange> {
	const after = await currentNerModelId(db)
	if (after === before)
		return { reannotated: false, cleared: 0, modelId: after }

	// Imported here rather than at module scope: the lane pulls in the whole
	// ranking graph behind it, and this module is reached from
	// `connections:setDefault` — a handler that runs for every star of every
	// modality.
	const { annotationLane } = await import("$lib/server/annotations/queue")

	annotationLane.stop()
	unloadNerModel("the entity connection changed")
	// A different model may be exactly what a remembered failure was about, so
	// nothing stays degraded across a switch.
	forgetNerLoadFailure()

	if (!after) {
		// Unstarred: the lane runs on the lexical tiers. The rows stay — see the
		// header.
		annotationLane.start()
		return { reannotated: false, cleared: 0, modelId: null }
	}

	const cost = await nerReannotateCost(db)
	// Both tables, because both are annotated by the same lane under the same
	// extractor and a half-cleared corpus is one where two rows disagree about
	// what a name is.
	await db.delete(schema.entryAnnotations)
	await db.delete(schema.messageAnnotations)
	annotationLane.start()
	return { reannotated: true, cleared: cost.rows, modelId: after }
}
