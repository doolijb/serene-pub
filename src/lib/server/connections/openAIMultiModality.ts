/**
 * One OpenAI-compatible connection per service serves chat AND embeddings.
 *
 * Owner ruling 2026-10-05 (the owner's word was "fold"; it is a rename, as
 * below). `openai-embeddings` was a second connection type for the SAME
 * OpenAI-compatible service, from when a connection named one model of one
 * modality. The `openai` type now declares `text->embedding` itself (registry +
 * manifest, `OpenAIEmbeddingAdapter` registered for both), and this is the half
 * that moves existing rows onto it — the 2026-09-08 ruling (*one connection
 * type per service*) applied a third time, after 0105's `llamacpp_completion`
 * and `ollamaMultiModality.ts`'s `ollama-embeddings`.
 *
 * ## A rename, never a fold
 *
 * An `openai-embeddings` row becomes an `openai` row IN PLACE, exactly as
 * `mergeOllamaEmbeddingsType` does it and for its reasons: the id does not
 * change, so the embedding star (`connection_defaults`), its model rows,
 * sampling and pipeline configs and the session tables keep pointing at it, and
 * its base URL, key, models and extras are the row's own and untouched. The
 * vector identity every stored vector carries (`api::<baseUrl>::<model>`,
 * `embedding/target.ts`) is built from the base URL and the model alone, never
 * the type, so it reads the same before and after — nothing is re-embedded.
 *
 * Two things a plain type rename would lose, written in the same pass:
 *
 *   · **The switch.** `openai` declares `text->embedding` but does not default
 *     it (most of its services cannot embed), so a renamed row would resolve
 *     it OFF and its star would stop resolving. The row was an embeddings
 *     connection — somebody set it up to embed — so the merge records that as
 *     the person's override, `text->embedding` on, which they can switch off
 *     like any other. An override already there is kept.
 *   · **What its models are for.** Every model row it owns is an embedding
 *     model, and says so (`connection_models.modality = "embeddings"`), so the
 *     endpoint's new chat half never offers one for chat.
 *
 * ## A row whose key is still quarantined is renamed too
 *
 * The 0.5.3 upgrade writes its API embedding singleton as an
 * `openai-embeddings` row whose key sits under `__legacyVectorizationApiKey`,
 * and the upgrade renames it here in the same pass that restores it
 * (`attic/restore.ts`), so the boot that upgrades leaves nothing for the next
 * one. The quarantine rides along untouched (`extra_json` is the row's own),
 * and `migrateEmbeddingConnection`, a startup task later in that boot, finds
 * the row by the quarantine itself, whatever its type and modality now are.
 *
 * ## The cache refresh is not here
 *
 * As for Ollama: `refreshConnectionCapabilityCaches`, which the boot sync (and
 * the upgrade) runs straight after this, rebuilds each renamed row's cached set as the type it
 * now is — chat, the rest of the `openai` defaults, and embeddings by the
 * override. Rename first.
 *
 * Runs every boot, writes once: boot defaults-sync, not a migration (the
 * 2026-09-06 ruling). The rename matches nothing after its first run.
 */
import { and, eq } from "drizzle-orm"
import { topGrade } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const EMBEDDING = "text->embedding"

export async function mergeOpenAIEmbeddingsType(
	db: Db
): Promise<{ renamed: number }> {
	const rows = await db
		.select({
			id: schema.connections.id,
			capabilities: schema.connections.capabilities
		})
		.from(schema.connections)
		.where(eq(schema.connections.type, CONNECTION_TYPE.OPENAI_EMBEDDINGS))

	let renamed = 0
	for (const row of rows) {
		const stored = (row.capabilities ?? {}) as {
			overrides?: Record<string, unknown>
		} & Record<string, unknown>
		const overrides = {
			...(stored.overrides ?? {}),
			[EMBEDDING]: stored.overrides?.[EMBEDDING] ?? topGrade(EMBEDDING)
		}

		// The model rows FIRST: the type is the marker that this row is done,
		// so a boot stopped between the two writes finds it unrenamed and does
		// both again.
		await db
			.update(schema.connectionModels)
			.set({ modality: "embeddings" })
			.where(eq(schema.connectionModels.connectionId, row.id))
		const done = await db
			.update(schema.connections)
			.set({
				type: CONNECTION_TYPE.OPENAI,
				modality: "text-gen",
				capabilities: { ...stored, overrides }
			})
			.where(
				and(
					eq(schema.connections.id, row.id),
					eq(
						schema.connections.type,
						CONNECTION_TYPE.OPENAI_EMBEDDINGS
					)
				)
			)
			.returning({ id: schema.connections.id })
		renamed += done.length
	}
	if (renamed)
		console.log(
			`[connections] OpenAI-compatible is one connection per service: renamed ${renamed} openai-embeddings row(s) onto openai.`
		)
	return { renamed }
}
