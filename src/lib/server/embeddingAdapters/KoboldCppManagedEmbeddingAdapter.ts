/**
 * Embeddings from KoboldCPP, run by Serene Pub — `POST /v1/embeddings` on the
 * managed process, with the pair's model loaded into koboldcpp's embeddings
 * slot first.
 *
 * The wire is the external KoboldCPP's (`KoboldCppEmbeddingAdapter`), and so is
 * the refusal of an answer from any other model. What differs is everything
 * around the request:
 *
 *   - **The model is LOADED, not found.** An external instance embeds with
 *     whatever it was started with; this one embeds with the file the pair
 *     names, because the model manager puts it there. `ensureManagedReady`
 *     with `kind: "embeddings"` starts the process when it is down, loads the
 *     file into the co-resident embeddings slot beside whatever chat or image
 *     model is resident (one reload, and only when the slot holds another
 *     file), and otherwise only resets the idle timer. So it runs before
 *     EVERY request, which is what keeps embedding work counting as use.
 *   - **The address is the manager's.** `koboldCppSettings.koboldCppManagerBaseUrl`,
 *     as `ensureManagedReady` answers it. The row's own `baseUrl` is display
 *     only and is not kept in sync, exactly as for the text and image halves.
 *
 * ## No `setEmbeddingModel` here
 *
 * A successful embeddings load makes its model the STANDING one (the one every
 * later chat or image load keeps in the slot) — `ensureModelLoaded` does that
 * itself, and only once the model has loaded. Naming it standing before the
 * load would let a file koboldcpp cannot open ride into the next chat load,
 * which is the failure the model manager is built to keep away from chat.
 *
 * ## Only the action
 *
 * The managed endpoint's listing (`KoboldCppManagedAdapter.listModels`) names
 * each embedding GGUF with `modality: "embeddings"`, and a test of the
 * connection doing the embedding job ends in one probe embed through this
 * class (`adapterIO`). So, like the external KoboldCPP's, this module exports
 * no `listModels` or `testConnection`.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports
} from "./BaseEmbeddingAdapter"
import { postOpenAIEmbeddings } from "./openAIEmbeddings"
import { ensureManagedReady } from "$lib/server/koboldcpp/managedPreflight"
import { normalizeModelName } from "$lib/server/koboldcpp/modelManager"

export class KoboldCppManagedEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		const file = (req.model ?? this.connection.model ?? "").trim()
		// No load and no wire for an empty batch — the queue's idle tick would
		// otherwise reload a model for nothing.
		if (req.input.length === 0)
			return { vectors: [], model: file, dimensions: 0 }
		if (!file)
			throw new Error(
				"No embedding model is chosen on KoboldCPP, run by Serene Pub. Choose one under its Embedding models."
			)

		const { baseUrl } = await ensureManagedReady(
			{ kind: "embeddings", file },
			{ connectionId: this.connection.id, signal: opts?.signal }
		)

		// `appendV1: true` — the manager's address is the server's root.
		const answer = await postOpenAIEmbeddings({
			baseUrl,
			appendV1: true,
			model: file,
			input: req.input,
			service: "KoboldCPP",
			signal: opts?.signal
		})

		// The slot was just made to hold this file, so another name here means
		// something else answered on the manager's port — an instance this app
		// did not start, or one restarted under it. Vectors from two models
		// cannot share an index, so that is a refusal, never a pass.
		const loaded = answer.model ?? ""
		if (!loaded || normalizeModelName(loaded) !== normalizeModelName(file))
			throw new Error(
				loaded
					? `KoboldCPP answered with the embedding model "${loaded}", but "${file}" was loaded for this connection. ` +
						`Vectors from two models cannot be mixed. Check that nothing else is running on KoboldCPP's port.`
					: `KoboldCPP did not say which embedding model answered, so its vectors cannot be trusted to match "${file}".`
			)

		return {
			vectors: answer.vectors,
			model: loaded,
			dimensions: answer.dimensions,
			raw: answer.raw
		}
	}
}

const exports: EmbeddingAdapterExports = {
	Adapter: KoboldCppManagedEmbeddingAdapter
}

export default exports
