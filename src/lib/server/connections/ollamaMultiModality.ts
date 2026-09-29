/**
 * One Ollama connection per host serves every modality the host has.
 *
 * Owner ruling 2026-09-25. `ollama-embeddings` was a second connection type for
 * the SAME Ollama host, a workaround for one-modality connections. Since plan 2026-09-24 B4 every Ollama connection is its own
 * host, so the two rows could not be folded into one view without risking two
 * hosts in it. Declaring the family the host really has — `POST /api/embed` —
 * on the `ollama` type (registry + manifest) makes the second type unnecessary
 * instead, and this is the half that moves existing rows onto it.
 *
 * It is the 2026-09-08 ruling applied again: *one connection type per service,
 * merge any type split on that seam* — 0105 merged `llamacpp_completion` on the
 * wire-mode seam; this merges `ollama-embeddings` on the modality seam.
 *
 * ## A rename, never a fold
 *
 * An `ollama-embeddings` row becomes an `ollama` row IN PLACE. Its id does not
 * change, so nothing that references it by id — the embedding star, its model
 * rows, sampling and pipeline configs, the session tables — can dangle. Folding
 * it into a same-host `ollama` row and deleting it would have been tidier and
 * LOSSIER: every one of those references would need repointing first, and one
 * missed would silently unconfigure somebody. 0105 chose a rename over a fold
 * for the same reason. A host that had both rows is left with two `ollama`
 * connections to it — redundant, visible, and safe to delete either one.
 *
 * ## The cache refresh is not here
 *
 * A renamed row's cached capabilities still describe the OLD type, and every
 * existing `ollama` row's cache predates `text->embedding`. Both are rebuilt by
 * `refreshConnectionCapabilityCaches`, which the boot sync runs straight after
 * this — one refresh path for every type, so a manifest change can never again
 * reach only the rows somebody remembered to write a step for. Order matters:
 * rename first, so the rebuild resolves each row as the type it now is.
 *
 * ## Runs every boot, writes once
 *
 * Boot defaults-sync, not a migration — the 2026-09-06 ruling: anything that
 * must persist goes through here, idempotently. The rename matches nothing
 * after its first run.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export async function mergeOllamaEmbeddingsType(
	db: Db
): Promise<{ renamed: number }> {
	const renamed = await db
		.update(schema.connections)
		.set({ type: CONNECTION_TYPE.OLLAMA, modality: "text-gen" })
		.where(eq(schema.connections.type, CONNECTION_TYPE.OLLAMA_EMBEDDINGS))
		.returning({ id: schema.connections.id })
	if (renamed.length)
		console.log(
			`[connections] Ollama is one connection per host: renamed ${renamed.length} ollama-embeddings row(s) onto ollama.`
		)
	return { renamed: renamed.length }
}
