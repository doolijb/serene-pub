/**
 * Embeddings from llama.cpp's llama-server — `POST /v1/embeddings`.
 *
 * llama-server embeds only when it was started with `--embeddings` (usually
 * with an embedding GGUF, and then it is an embedding-only server); without it
 * the route answers 501, "This server does not support embeddings". Nothing it
 * serves says which it is — not `/props`, not `/v1/models` — so the text
 * module asks the way this class would, with a one-word embed
 * (`llamaCppServesEmbeddings` in `LlamaCppAdapter`), and the type's
 * `text->embedding` stays unproven until that probe answers on Test.
 *
 * ⚠ The OpenAI shape, under `/v1`. llama-server's bare `/embeddings` is its
 * own, non-OpenAI shape (a bare array, no `data`), which the shared response
 * check would refuse rather than misread.
 *
 * llama-server echoes the request's `model` rather than naming what it loaded,
 * so unlike KoboldCPP there is nothing in the answer to check the pair against.
 *
 * ## Only the action
 *
 * The connection's own listing (`LlamaCppAdapter.listModels`) names the one
 * loaded model with its modality, and a test of a connection doing the
 * embedding job ends in one probe embed through this class (`adapterIO`), so
 * this module exports no `listModels` or `testConnection` of its own.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports
} from "./BaseEmbeddingAdapter"
import { postOpenAIEmbeddings } from "./openAIEmbeddings"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

/** The same fallback the text adapter uses for an unset base URL. */
const DEFAULT_BASE_URL = "http://localhost:8080"

export class LlamaCppEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		const model = req.model ?? this.connection.model
		if (req.input.length === 0)
			return { vectors: [], model: model ?? "", dimensions: 0 }
		if (!model)
			throw new Error(
				"This llama.cpp connection names no embedding model. Choose one on the connection."
			)

		// `appendV1: true` — a llama.cpp base URL is the server's root, as its
		// text adapter treats it too (`{base}/v1/chat/completions`).
		const answer = await postOpenAIEmbeddings({
			baseUrl:
				normalizeBaseUrl(this.connection.baseUrl) || DEFAULT_BASE_URL,
			appendV1: true,
			model,
			input: req.input,
			service: "llama.cpp",
			signal: opts?.signal
		})
		return {
			vectors: answer.vectors,
			// The pair's own name: llama-server's `model` is our request echoed.
			model,
			dimensions: answer.dimensions,
			raw: answer.raw
		}
	}
}

const exports: EmbeddingAdapterExports = {
	Adapter: LlamaCppEmbeddingAdapter
}

export default exports
