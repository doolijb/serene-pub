/**
 * The stars with a consequence, applied around whatever write might move them.
 *
 * Two stars carry stored work: the embedding star (every vector was made by the
 * model it names) and the entity star (every annotation was written by its
 * extractor). When what either one RESOLVES to changes, the work has to follow —
 * `applyEmbeddingStarChange` and `applyNerStarChange` say how. Pressing the star
 * is only one of the writes that move it:
 *
 *   · `connections:setDefault` and Admin → Defaults (`connectionDefaults:set`);
 *   · editing the starred connection — its address or type is half of the
 *     embedding identity (`api::<baseUrl>::<model>`);
 *   · renaming the starred model's identifier (`connections:updateModel`);
 *   · deleting the connection or the model, directly or by forgetting a model
 *     deleted from its host — the registration is released by cascade.
 *
 * Every one of those writes runs inside `withStarConsequences`, so none of them
 * can forget the consequence. A door without it leaves the old model loaded
 * and the queue running under it while the index is re-embedded or stranded.
 *
 * ⚠ The identity is read BEFORE the write, because afterwards the old answer is
 * gone — and the consequences only act when it moved, so an edit that touches
 * neither the address nor the model costs two reads.
 *
 * ⚠ Not in `setCapabilityDefault`: that file is the storage boundary for the
 * registration and rules consequences out, and a connection edit never passes
 * through it anyway.
 */

import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"
import { NER_CAPABILITY } from "$lib/shared/constants/ner"
import {
	applyEmbeddingStarChange,
	currentEmbeddingModelId
} from "$lib/server/embedding/reindex"
import { applyNerStarChange, currentNerModelId } from "$lib/server/ner/reindex"

/** Every star whose movement has a consequence. */
export const CONSEQUENTIAL_STARS = [
	EMBEDDING_CAPABILITY,
	NER_CAPABILITY
] as const

/**
 * Run `write`, then apply the consequence of any watched star it moved.
 *
 * `stars` narrows the watch — `connections:setDefault` for one capability needs
 * only that capability's star read; a connection edit or delete can move either.
 */
export async function withStarConsequences<T>(
	db: Db,
	write: () => Promise<T>,
	stars: readonly string[] = CONSEQUENTIAL_STARS
): Promise<T> {
	const watchEmbedding = stars.includes(EMBEDDING_CAPABILITY)
	const watchNer = stars.includes(NER_CAPABILITY)
	const embeddingBefore = watchEmbedding
		? await currentEmbeddingModelId(db)
		: null
	const nerBefore = watchNer ? await currentNerModelId(db) : null

	const result = await write()

	if (watchEmbedding) await applyEmbeddingStarChange(db, embeddingBefore)
	if (watchNer) await applyNerStarChange(db, nerBefore)
	return result
}
