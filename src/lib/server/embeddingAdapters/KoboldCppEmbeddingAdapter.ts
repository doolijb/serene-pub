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
 * The connection's own listing (`KoboldCppAdapter.listModels`) carries every
 * loaded model with its modality; this module's `listModels` answers for the
 * embedding model alone, from the same reader.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports
} from "./BaseEmbeddingAdapter"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { fetchLoadedEmbeddingModel } from "$lib/server/koboldcpp/kcppHttp"

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
		const base =
			normalizeBaseUrl(this.connection.baseUrl) || DEFAULT_BASE_URL

		const res = await fetch(`${base}/v1/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: expected, input: req.input }),
			signal: opts?.signal
		})
		if (!res.ok) {
			const detail = (await res.text().catch(() => "")).slice(0, 500)
			throw new Error(
				`KoboldCPP's embeddings request failed (${res.status})${detail ? `: ${detail}` : ""}`
			)
		}
		const body = (await res.json()) as {
			data?: Array<{ index: number; embedding: number[] }>
			model?: string
		}

		const loaded = typeof body?.model === "string" ? body.model.trim() : ""
		if (loaded !== expected)
			throw new Error(
				loaded
					? `KoboldCPP is embedding with "${loaded}", but this connection is set to "${expected}". ` +
							`Vectors from two models cannot be mixed. Refresh the connection's models and choose the one it has loaded.`
					: `KoboldCPP did not say which embedding model answered, so its vectors cannot be trusted to match "${expected}".`
			)

		const data = body?.data
		if (!Array.isArray(data) || data.length !== req.input.length)
			throw new Error(
				`KoboldCPP returned ${Array.isArray(data) ? data.length : 0} vectors for ${req.input.length} inputs.`
			)
		// By the API's own index, never arrival order — see OpenAIEmbeddingAdapter.
		const vectors = [...data]
			.sort((a, b) => a.index - b.index)
			.map((d) => d.embedding)
		return {
			vectors,
			model: loaded,
			dimensions: vectors[0]?.length ?? 0,
			raw: body
		}
	}
}

/** The loaded embedding model, as a one-entry list — see `fetchLoadedEmbeddingModel`. */
async function listModels(
	connection: SelectConnection
): Promise<{ models: { model: string }[]; error?: string }> {
	const base = normalizeBaseUrl(connection.baseUrl) || DEFAULT_BASE_URL
	const loaded = await fetchLoadedEmbeddingModel(base)
	if (!loaded.determined)
		return {
			models: [],
			error: "KoboldCPP did not say which embedding model it has loaded."
		}
	return { models: loaded.name ? [{ model: loaded.name }] : [] }
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	const { models, error } = await listModels(connection)
	if (error) return { ok: false, error }
	return models.length
		? { ok: true }
		: {
				ok: false,
				error: "KoboldCPP has no embedding model loaded. Start it with --embeddingsmodel."
			}
}

const exports: EmbeddingAdapterExports = {
	Adapter: KoboldCppEmbeddingAdapter,
	listModels,
	testConnection
}

export default exports
