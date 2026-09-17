/**
 * Any OpenAI-compatible `/embeddings` endpoint.
 *
 * One adapter, every service behind that wire: OpenAI itself, LM Studio,
 * llama.cpp server, vLLM, a hosted gateway — the same argument `A1111Adapter`
 * makes for scoping by API FORMAT rather than by vendor.
 *
 * ⚠ Its own connection type rather than a capability on `openai`, because a
 * connection names exactly ONE model and an embedding model is not a chat model.
 * `OpenAIChatAdapter` speaks `/v1/chat/completions` and nothing else; the
 * manifest's own note on that entry says image generation would be a different
 * route hence a different adapter, and `/embeddings` is that case again.
 *
 * Plain `fetch` rather than the `openai` package, which `embedding/index.ts`
 * used. The package adds retries and a client object for one POST with no
 * streaming, and the request body is three fields.
 */

import {
	BaseEmbeddingAdapter,
	type EmbedRequest,
	type EmbedResult,
	type EmbeddingAdapterExports,
	type EmbeddingModelOption
} from "./BaseEmbeddingAdapter"

/**
 * The base URL with one trailing slash removed.
 *
 * ⚠ Never append `/v1`. A base URL is what the person typed, half these services
 * want `/v1` on it and llama.cpp's server does not, so a suffix invented here is
 * wrong for one of them and unfixable from the form.
 */
function root(baseUrl: string | null | undefined): string {
	return (baseUrl ?? "").trim().replace(/\/+$/, "")
}

/**
 * This connection's key, decrypted.
 *
 * `extraJson.apiKey` is an encrypted envelope at rest (tokenCrypto) and
 * `decryptApiKeyField` also passes a legacy plaintext string through, which is
 * what keeps a row that has not been re-saved since working.
 *
 * ⚠ `tokenCrypto` is imported DYNAMICALLY and must stay that way. It imports
 * `$lib/server/db` for the root secret, and that module migrates a PGlite
 * database at import time — so a static import here would make constructing this
 * adapter, or merely loading its module in a unit test, pay a full database
 * migration. Same reason every entry in `ADAPTER_REGISTRY` is a thunk.
 */
export async function embeddingApiKey(
	connection: SelectConnection
): Promise<string | null> {
	const key = (connection.extraJson as any)?.apiKey
	if (!key) return null
	const { decryptApiKeyField } = await import("$lib/server/utils/tokenCrypto")
	return decryptApiKeyField(key) ?? null
}

async function refusal(res: Response, what: string): Promise<Error> {
	let detail = ""
	try {
		detail = (await res.text())?.slice(0, 500) ?? ""
	} catch {
		detail = ""
	}
	return new Error(
		`Embeddings ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`
	)
}

async function headers(
	connection: SelectConnection
): Promise<Record<string, string>> {
	const key = await embeddingApiKey(connection)
	return {
		"Content-Type": "application/json",
		...(key ? { Authorization: `Bearer ${key}` } : {})
	}
}

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
		const base = root(this.connection.baseUrl)
		if (!base)
			throw new Error(
				"This embeddings connection has no base URL. Set one on the connection."
			)

		const res = await fetch(`${base}/embeddings`, {
			method: "POST",
			headers: await headers(this.connection),
			body: JSON.stringify({ model, input: req.input }),
			signal: opts?.signal
		})
		if (!res.ok) throw await refusal(res, "request")

		const body = (await res.json()) as {
			data?: Array<{ index: number; embedding: number[] }>
			model?: string
		}
		const data = body?.data
		if (!Array.isArray(data) || data.length !== req.input.length)
			throw new Error(
				`The embeddings endpoint returned ${Array.isArray(data) ? data.length : 0} vectors for ${req.input.length} inputs.`
			)

		// ⚠ Sorted by the API's OWN index, never trusted to arrive in order. The
		// spec says each item carries its index precisely because the response is
		// not required to be ordered, and a vector filed against the wrong row is
		// a retrieval failure that surfaces as bad results rather than an error.
		const vectors = [...data]
			.sort((a, b) => a.index - b.index)
			.map((d) => d.embedding)

		return {
			vectors,
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
		const res = await fetch(`${base}/models`, {
			headers: await headers(connection)
		})
		// Not every compatible host serves `/models`; llama.cpp's server and a
		// few gateways do not. That is a host without a catalogue, not a broken
		// connection — the person types the model name, which is what the picker
		// already lets them do.
		if (!res.ok)
			return {
				models: [],
				error: (await refusal(res, "model list")).message
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
	const base = root(connection.baseUrl)
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
