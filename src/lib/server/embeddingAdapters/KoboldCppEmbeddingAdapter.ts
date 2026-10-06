/**
 * Embeddings from a KoboldCPP someone else runs — `POST /v1/embeddings`.
 *
 * KoboldCPP has no admin-free way to CHOOSE its embedding model: it embeds with
 * whatever it was started with (`--embeddingsmodel`), and ignores a `model`
 * field in the request. What it does do is NAME that model in every response
 * (`"model": "nomic-embed-text-v1.5.Q4_K_M"`, verified live on 1.119). That is
 * what makes this safe to offer at all (owner ruling 2026-09-26).
 *
 * ## ⚠ Every response is checked against the model this pair names
 *
 * Stored vectors are only comparable with vectors from the SAME model. The
 * operator can restart KoboldCPP with a different embedding model at any time,
 * between two syncs, and nothing here would otherwise notice — the request
 * would succeed and file vectors from a new model beside ones from the old.
 * So a response naming a different model than the pair's is a REFUSAL, with
 * both names in the sentence; the next sync marks the old model missing and
 * lists the new one, and switching to it is a person's choice (with its
 * reindex confirmation), never a side effect.
 *
 * ## Only the action
 *
 * The connection's own listing (`KoboldCppAdapter.listModels`) names every
 * loaded model with its modality, the embedding one included, and a test of a
 * connection doing the embedding job ends in one probe embed through this class
 * (`adapterIO` in `connections/modelSync.ts`). So this module exports no
 * `listModels` or `testConnection` of its own: a second listing of the same
 * process would be code nothing calls.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports
} from "./BaseEmbeddingAdapter"
import { postOpenAIEmbeddings } from "./openAIEmbeddings"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { normalizeModelName } from "$lib/server/koboldcpp/modelManager"

const DEFAULT_BASE_URL = "http://localhost:5001"

export class KoboldCppEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		const expected = req.model ?? this.connection.model
		if (req.input.length === 0)
			return { vectors: [], model: expected ?? "", dimensions: 0 }
		if (!expected)
			throw new Error(
				"This KoboldCPP connection names no embedding model. Choose one on the connection."
			)

		// `appendV1: true` — a KoboldCPP base URL is the server's root, as its
		// text adapter treats it too (`{base}/v1/chat/completions`).
		const answer = await postOpenAIEmbeddings({
			baseUrl:
				normalizeBaseUrl(this.connection.baseUrl) || DEFAULT_BASE_URL,
			appendV1: true,
			model: expected,
			input: req.input,
			service: "KoboldCPP",
			signal: opts?.signal
		})

		// One model however it is spelled: KoboldCPP reports a model without its
		// extension and sometimes under `koboldcpp/`, while a managed install
		// records the file it loaded (`nomic-embed-text-v1.5.Q4_K_M.gguf`).
		// Refusing that pair would refuse every vector a working setup makes.
		const loaded = answer.model ?? ""
		if (
			!loaded ||
			normalizeModelName(loaded) !== normalizeModelName(expected)
		)
			throw new Error(
				loaded
					? `KoboldCPP is embedding with "${loaded}", but this connection is set to "${expected}". ` +
						`Vectors from two models cannot be mixed. Refresh the connection's models and choose the one it has loaded.`
					: `KoboldCPP did not say which embedding model answered, so its vectors cannot be trusted to match "${expected}".`
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
	Adapter: KoboldCppEmbeddingAdapter
}

export default exports
