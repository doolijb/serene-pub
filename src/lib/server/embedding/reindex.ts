/**
 * What moving the embedding star costs, and what it does.
 *
 * ## The consequence lives with the star, not with the screens
 *
 * An embedding endpoint is chosen the way every other connection is chosen, with
 * `connections:setDefault`. Moving THAT star has to stop the queue, unload the
 * backend, drop the stale vectors, forget the failure and cooldown state, and
 * start again — because every stored vector came from the model the star named a
 * moment ago. Those five steps live here and the handler calls them, so a screen
 * that can move a star cannot forget one.
 *
 * ## Keyed on the model IDENTITY, never on the connection id
 *
 * Two rows can name the same endpoint and the same model, and they produce
 * byte-identical vectors. Re-indexing on an id change would be hours of work to
 * arrive exactly where it started — and pressing the star twice on one row (it
 * is a button; people do) must be a no-op. `EmbeddingTarget.modelId` is the same
 * string that is written into every embedded row's `embedding_model` column, so
 * comparing it is comparing the only thing that matters.
 *
 * ## Unstarring does not destroy an index
 *
 * Turning embeddings off is not a decision to throw the index away: unstarring
 * stops the queue and leaves every row exactly where it is, so starring the same
 * connection again costs nothing. The clear happens only when there is a NEW
 * target whose identity differs.
 */

import { resolveEmbeddingTarget } from "./target"
import { clearEmbeddedVectors, countEmbeddedRows } from "./vectors"
import { unloadEmbeddingModel } from "./index"

export interface EmbeddingStarChange {
	/** True when the model identity moved and the vectors were rebuilt. */
	reindexed: boolean
	/** How many rows were cleared. Zero on an unstar, and on a no-op. */
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
export async function currentEmbeddingModelId(db: Db): Promise<string | null> {
	return (await resolveEmbeddingTarget(db))?.modelId ?? null
}

/**
 * How many rows a switch would re-index, for the confirmation that precedes it.
 *
 * Its own export (rather than the client computing it from the queue's pending
 * count) because the two are different numbers: the queue counts what is NOT
 * embedded, and the warning is about what IS. Quoting the queue's figure would
 * tell somebody with a fully indexed library that nothing was about to happen.
 *
 * ⚠ No rate estimate accompanies it, deliberately. The queue measures no
 * throughput — there is no rolling rate anywhere in `vectorizationQueue` — and a
 * made-up "roughly N minutes" on a screen whose entire job is to state the cost
 * accurately would be the one number on it that was invented.
 */
export async function embeddingReindexCost(db: Db): Promise<{ rows: number }> {
	return { rows: await countEmbeddedRows(db) }
}

/**
 * Apply the consequence of the embedding star having just moved.
 *
 * `before` is what `currentEmbeddingModelId` answered before the write. Returns
 * what happened, so a handler can say it.
 *
 * ⚠ Order is load-bearing: the queue STOPS before the clear. A pass still
 * running would write vectors back in behind the delete, under the old model,
 * and they would sit there looking current until something else re-embedded
 * them.
 */
export async function applyEmbeddingStarChange(
	db: Db,
	before: string | null
): Promise<EmbeddingStarChange> {
	const after = await currentEmbeddingModelId(db)
	if (after === before)
		return { reindexed: false, cleared: 0, modelId: after }

	// Imported here rather than at module scope: `vectorizationQueue` pulls in
	// the indexing lane and the whole ranking graph behind it, and this module is
	// reached from `connections:setDefault` — a handler that runs for every star
	// of every modality.
	const {
		stopVectorization,
		startVectorizationQueue,
		clearVectorizationFailureTracking,
		clearInlineEmbedCooldown
	} = await import("./vectorizationQueue")

	stopVectorization()
	unloadEmbeddingModel("the embedding connection changed")

	if (!after) {
		// Unstarred: embeddings are off. The vectors stay — see the header.
		return { reindexed: false, cleared: 0, modelId: null }
	}

	const cleared = await clearEmbeddedVectors(db)
	// A different model may be exactly what fixes an item that was failing (a
	// dimension mismatch, a model that refused a long input), so nothing stays
	// excluded from picking until the next full restart.
	clearVectorizationFailureTracking()
	clearInlineEmbedCooldown()
	void startVectorizationQueue({ startFromBeginning: true })
	return { reindexed: true, cleared, modelId: after }
}
