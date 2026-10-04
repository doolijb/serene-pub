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
 * the model and leaves every row where it is. The rows keep their model-tier
 * entities, which remain true statements about the text; they are replaced by
 * lexical ones the next time their content or vocabulary moves.
 *
 * ⚠ **Compared against the rows, not against the star before the write** (the
 * embedding star's A10 rule). After an unstar the star before is nothing, so
 * "did the star's model change?" answers yes to a re-star of the very model the
 * corpus was built with. Every row records the model whose spans it holds
 * (`entity_model`, NULL for a lexical pass), so a star move clears exactly the
 * rows the newly starred model did not write: none on a re-star of the same
 * model, the lexical rows written while it was off, and everything another
 * model wrote.
 */

import { isNull, ne, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveNerTarget } from "./target"
import { unloadNerModel } from "./index"
import { forgetNerLoadFailure } from "./broker"

export interface NerStarChange {
	/** True when annotations the new model did not write were dropped. */
	reannotated: boolean
	/** How many annotated rows were cleared. Zero on an unstar, on a no-op,
	 *  and on a re-star of the model the rows were annotated with. */
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
 * With `keepModel` — the model about to be starred — only the rows it did not
 * write, which are the rows `applyNerStarChange` clears. Without it, every
 * annotated row.
 *
 * ⚠ No time estimate accompanies it, deliberately. Nothing in the lane measures
 * throughput, and a made-up "roughly N minutes" on a screen whose whole job is
 * to state the cost accurately would be the one number on it that was invented.
 */
export async function nerReannotateCost(
	db: Db,
	opts: { keepModel?: string | null } = {}
): Promise<{ rows: number }> {
	const keep = opts.keepModel ?? null
	const [entries] = await db
		.select({
			n: sql<number>`count(distinct ${schema.entryAnnotations.entryId})`
		})
		.from(schema.entryAnnotations)
		.where(
			keep == null
				? undefined
				: notWrittenBy(schema.entryAnnotations.entityModel, keep)
		)
	const [messages] = await db
		.select({
			n: sql<number>`count(distinct ${schema.messageAnnotations.messageId})`
		})
		.from(schema.messageAnnotations)
		.where(
			keep == null
				? undefined
				: notWrittenBy(schema.messageAnnotations.entityModel, keep)
		)
	return { rows: Number(entries?.n ?? 0) + Number(messages?.n ?? 0) }
}

/** An annotation the model `keep` did not write — a lexical one included. */
const notWrittenBy = (
	column:
		| typeof schema.entryAnnotations.entityModel
		| typeof schema.messageAnnotations.entityModel,
	keep: string
) => or(isNull(column), ne(column, keep))

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

	// Only what the model now starred did not write: a re-star of the model
	// the corpus was built with clears nothing. Both tables, because both are
	// annotated by the same lane under the same extractor and a half-cleared
	// corpus is one where two rows disagree about what a name is.
	const cost = await nerReannotateCost(db, { keepModel: after })
	await db
		.delete(schema.entryAnnotations)
		.where(notWrittenBy(schema.entryAnnotations.entityModel, after))
	await db
		.delete(schema.messageAnnotations)
		.where(notWrittenBy(schema.messageAnnotations.entityModel, after))
	annotationLane.start()
	return { reannotated: cost.rows > 0, cleared: cost.rows, modelId: after }
}
