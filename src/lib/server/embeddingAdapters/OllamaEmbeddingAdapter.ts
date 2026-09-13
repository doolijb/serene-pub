/**
 * Ollama's own embedding route: `POST /api/embed`.
 *
 * ⚠ Not `/v1/embeddings`, and not the `openai` preset pointed at Ollama. The
 * compatibility shim exists, but `/api/embed` is the route Ollama documents, it
 * is the one that takes a batch (`input` accepts a string OR an array, and
 * answers `embeddings` either way), and it is the one that honours
 * `keep_alive`. Routing embeddings through the OpenAI shim would also mean the
 * connection could not say which Ollama it meant when an instance runs both an
 * embedding model and a chat model.
 *
 * Plain `fetch` rather than the `ollama` npm client the text adapter uses: that
 * client's `embed()` exists but pulls the whole SDK in for one POST, and this
 * module is loaded on the vectorization path where nothing else needs it.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports,
	type EmbeddingModelOption
} from "./BaseEmbeddingAdapter"

/** `http://host:11434/` and `http://host:11434` both address the same server. */
function root(baseUrl: string | null | undefined): string {
	return (baseUrl ?? "").trim().replace(/\/+$/, "")
}

/**
 * The line a failed request should read as.
 *
 * The body, when the server sent one: Ollama answers a missing model with
 * `model "x" not found, try pulling it first`, which is the entire diagnosis and
 * would be replaced by "404" if this only reported the status.
 */
async function refusal(res: Response, what: string): Promise<Error> {
	let detail = ""
	try {
		detail = (await res.text())?.slice(0, 500) ?? ""
	} catch {
		detail = ""
	}
	return new Error(
		`Ollama ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`
	)
}

export class OllamaEmbeddingAdapter extends BaseEmbeddingAdapter {
	async embedText(
		req: EmbedRequest,
		opts?: { signal?: AbortSignal }
	): Promise<EmbedResult> {
		// No wire call for an empty batch — the queue's idle tick would
		// otherwise wake the model on every scan for nothing.
		if (req.input.length === 0)
			return {
				vectors: [],
				model: req.model ?? this.connection.model ?? "",
				dimensions: 0
			}

		const model = req.model ?? this.connection.model
		if (!model)
			throw new Error(
				"This Ollama embeddings connection names no model. Choose one on the connection."
			)
		const base = root(this.connection.baseUrl)
		if (!base)
			throw new Error(
				"This Ollama embeddings connection has no base URL. Set one on the connection."
			)

		const res = await fetch(`${base}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model, input: req.input }),
			signal: opts?.signal
		})
		if (!res.ok) throw await refusal(res, "embed")

		const body = (await res.json()) as {
			embeddings?: number[][]
			model?: string
		}
		const vectors = body?.embeddings
		// A 200 with no vectors is the shape a wrong route produces (an Ollama
		// that answered the request but is not this endpoint), so it is named
		// rather than allowed through as an empty result the queue would store.
		if (!Array.isArray(vectors) || vectors.length !== req.input.length)
			throw new Error(
				`Ollama /api/embed returned ${Array.isArray(vectors) ? vectors.length : 0} vectors for ${req.input.length} inputs.`
			)

		return {
			vectors,
			// ⚠ Ollama's own spelling of the model, when it gives one: it
			// normalizes a bare name to `name:latest`, and the identity string
			// this ends up in is what staleness compares against.
			model: body.model ?? model,
			dimensions: vectors[0]?.length ?? 0,
			raw: body
		}
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: EmbeddingModelOption[]; error?: string }> {
	const base = root(connection.baseUrl)
	if (!base) return { models: [], error: "No base URL is set." }
	try {
		const res = await fetch(`${base}/api/tags`)
		if (!res.ok)
			return { models: [], error: (await refusal(res, "list")).message }
		const body = (await res.json()) as {
			models?: Array<{ model?: string; name?: string }>
		}
		// Everything Ollama holds, unfiltered.
		//
		// ⚠ Never narrow this to names that look like embedding models.
		// `/api/tags` publishes no field saying which a model is, so any filter
		// is a substring guess: it would hide `mxbai-large`,
		// `snowflake-arctic-embed` under a different tag, and every model
		// somebody pulled under a name of their own. The endpoint answers
		// whether a pick works; a guess here refuses a working one with nothing
		// on screen to say why.
		return {
			models: (body?.models ?? [])
				.map((m) => ({ model: m.model ?? m.name ?? "" }))
				.filter((m) => !!m.model)
		}
	} catch (e: any) {
		return { models: [], error: e?.message ?? String(e) }
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	const base = root(connection.baseUrl)
	if (!base) return { ok: false, error: "No base URL is set." }
	const { models, error } = await listModels(connection)
	if (error) return { ok: false, error }
	return { ok: true, extra: { models } }
}

const exports: EmbeddingAdapterExports = {
	Adapter: OllamaEmbeddingAdapter,
	listModels,
	testConnection
}

export default exports
