/**
 * Any OpenAI-compatible `/embeddings` endpoint.
 *
 * One adapter, every service behind that wire: OpenAI itself, OpenRouter,
 * Gemini's compatibility layer, LocalAI, a hosted gateway — the same argument
 * `A1111Adapter` makes for scoping by API FORMAT rather than by vendor.
 *
 * The `embedding` module of the `openai` type (`adapters/registry.ts`): one
 * OpenAI-compatible connection per service chats through `OpenAIChatAdapter`
 * and embeds through this (owner ruling 2026-10-05), so `openai-embeddings`
 * rows merge into `openai` at boot (`connections/openAIMultiModality.ts`). A
 * module of its own because `/embeddings` is a different route from
 * `/chat/completions`, the case the manifest's note on that entry makes for
 * image generation. Whether a service embeds is the `text->embedding` switch
 * — its preset's claim, or the person's — never this file's.
 *
 * The wire itself — request, auth header, response checks — is
 * `./openAIEmbeddings`, shared with every other type that speaks it. What is
 * this module's own is the base URL, taken exactly as typed (see `embedText`).
 * Its `/models` listing and test answer only for a row the merge has not
 * reached yet (⏳ `openai-embeddings`): an `openai` row is listed by its text
 * adapter, and its test ends in a probe embed through this one (`adapterIO`).
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports,
	type EmbeddingModelOption
} from "./BaseEmbeddingAdapter"
import {
	embeddingApiKey,
	embeddingsRefusal,
	openAIHeaders,
	postOpenAIEmbeddings
} from "./openAIEmbeddings"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

export class OpenAIEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		if (req.input.length === 0)
			return {
				vectors: [],
				model: req.model ?? this.connection.model ?? "",
				dimensions: 0
			}

		const model = req.model ?? this.connection.model
		if (!model)
			throw new Error(
				"This embeddings connection names no model. Choose one on the connection."
			)
		const base = normalizeBaseUrl(this.connection.baseUrl)
		if (!base)
			throw new Error(
				"This embeddings connection has no base URL. Set one on the connection."
			)

		// `appendV1: false` — this type's base URL is used exactly as typed. Its
		// rows conventionally carry the version segment already
		// (`https://api.openai.com/v1`, `http://localhost:1234/v1`), and a `/v1`
		// added here would double it on every one of them, from a form with no
		// way to undo it. A llama-server is reached by typing its `/v1` too: its
		// bare `/embeddings` is a different, non-OpenAI shape, which the shared
		// response check refuses rather than misreads.
		const answer = await postOpenAIEmbeddings({
			baseUrl: base,
			appendV1: false,
			model,
			input: req.input,
			apiKey: await embeddingApiKey(this.connection),
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

async function listModels(
	connection: SelectConnection
): Promise<{ models: EmbeddingModelOption[]; error?: string }> {
	const base = normalizeBaseUrl(connection.baseUrl)
	if (!base) return { models: [], error: "No base URL is set." }
	try {
		const res = await fetch(`${base}/models`, {
			headers: openAIHeaders(await embeddingApiKey(connection))
		})
		// Not every compatible host serves `/models`; llama.cpp's server and a
		// few gateways do not. That is a host without a catalogue, not a broken
		// connection — the person types the model name, which is what the picker
		// already lets them do.
		if (!res.ok)
			return {
				models: [],
				error: (await embeddingsRefusal(res, "Embeddings model list"))
					.message
			}
		const body = (await res.json()) as { data?: Array<{ id?: string }> }
		return {
			models: (body?.data ?? [])
				.map((m) => ({ model: m.id ?? "" }))
				.filter((m) => !!m.model)
		}
	} catch (e: any) {
		return { models: [], error: e?.message ?? String(e) }
	}
}

async function testConnection(
	connection: SelectConnection & { model?: string | null }
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	const base = normalizeBaseUrl(connection.baseUrl)
	if (!base) return { ok: false, error: "No base URL is set." }
	// A REAL embed call, not a `/models` probe, when a model is named: a host
	// that lists models and then refuses to embed with the one chosen is the
	// exact configuration this test exists to catch, and it is also what tells
	// the form the vector width.
	if (connection.model) {
		try {
			const { dimensions } = await new OpenAIEmbeddingAdapter(
				connection
			).embedText({ input: ["test"] })
			return { ok: true, extra: { dimensions } }
		} catch (e: any) {
			return { ok: false, error: e?.message ?? String(e) }
		}
	}
	const { models, error } = await listModels(connection)
	if (error) return { ok: false, error }
	return { ok: true, extra: { models } }
}

const exports: EmbeddingAdapterExports = {
	Adapter: OpenAIEmbeddingAdapter,
	listModels,
	testConnection
}

export default exports
