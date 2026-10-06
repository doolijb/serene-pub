/**
 * Embeddings from LM Studio — `POST /v1/embeddings` on its own server.
 *
 * LM Studio serves its SDK's WebSocket and an OpenAI-compatible HTTP API from
 * ONE server on ONE port (1234 by default). A connection stores the SDK's
 * address (`ws://localhost:1234`), because that is what `LMStudioAdapter`'s
 * client takes; this module reaches the same server over HTTP by swapping the
 * scheme, so the person never types a second address for the same program.
 *
 * Over the OpenAI wire rather than the SDK's `client.embedding`, and that is
 * not a style choice: `@lmstudio/sdk` uses regex property escapes that fail to
 * PARSE under nodejs-mobile's V8 (see `ADAPTER_REGISTRY`), so an embedding lane
 * that imported it would be one more place the module could leak into a boot.
 * A downloaded model LM Studio has not loaded is loaded on the request (its
 * just-in-time loading), as it is for chat.
 *
 * ## Only the action
 *
 * The connection's own listing (`LMStudioAdapter.listModels`) names each
 * downloaded model with its modality — LM Studio says `type: "embedding"` — and
 * a test of a connection doing the embedding job ends in one probe embed
 * through this class (`adapterIO`). So, like KoboldCPP's, this module exports
 * no `listModels` or `testConnection` of its own.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports
} from "./BaseEmbeddingAdapter"
import { postOpenAIEmbeddings } from "./openAIEmbeddings"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

/**
 * The HTTP root of the LM Studio server a stored base URL names.
 *
 * `ws://` → `http://` and `wss://` → `https://`; an address already typed as
 * HTTP is kept. Unset falls back to the type's default address, the same one
 * the chat adapter falls back to.
 */
export function lmStudioHttpBase(baseUrl: string | null | undefined): string {
	const base =
		normalizeBaseUrl(baseUrl) ||
		normalizeBaseUrl(CONNECTION_DEFAULTS[CONNECTION_TYPE.LM_STUDIO].baseUrl)
	return base.replace(/^ws(s?):\/\//i, "http$1://")
}

export class LMStudioEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		const model = req.model ?? this.connection.model
		if (req.input.length === 0)
			return { vectors: [], model: model ?? "", dimensions: 0 }
		if (!model)
			throw new Error(
				"This LM Studio connection names no embedding model. Choose one on the connection."
			)

		// `appendV1: true` — the stored address is the server's root.
		const answer = await postOpenAIEmbeddings({
			baseUrl: lmStudioHttpBase(this.connection.baseUrl),
			appendV1: true,
			model,
			input: req.input,
			service: "LM Studio",
			signal: opts?.signal
		})
		return {
			vectors: answer.vectors,
			model: answer.model ?? model,
			dimensions: answer.dimensions,
			raw: answer.raw
		}
	}
}

const exports: EmbeddingAdapterExports = {
	Adapter: LMStudioEmbeddingAdapter
}

export default exports
