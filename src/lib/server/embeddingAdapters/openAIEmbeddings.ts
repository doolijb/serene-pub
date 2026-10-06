/**
 * The OpenAI embeddings wire, written once.
 *
 * `POST {base}[/v1]/embeddings` with `{model, input}`, answered by
 * `{data: [{index, embedding}], model}`. OpenAI speaks it, and so does every
 * server that copies the shape: KoboldCPP, llama-server, LM Studio, vLLM,
 * Ollama's shim, a hosted gateway. Each type's adapter keeps what is particular
 * to it — which base URL, whether `/v1` goes on it, whether a key is sent, what
 * to make of the `model` the answer names — and hands the rest to this module,
 * so the checks a stored vector depends on are made one way for all of them.
 *
 * ⚠ Not llama-server's bare `/embeddings`. That route answers a bare array of
 * `{index, embedding}` with no `data` wrapper and no `model` (see
 * `LlamaCppAdapter`'s `EmbeddingsResponse`), so a base URL that reaches it
 * through this module fails the shape check below rather than embedding. The
 * OpenAI shape is under `/v1` there, as it is on KoboldCPP and LM Studio.
 *
 * Plain `fetch` rather than the `openai` package: one POST, no streaming, a
 * three-field body.
 */

import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"

/**
 * Where the embeddings route is, for one stored base URL.
 *
 * `appendV1` is the TYPE's statement about its base URLs, never a guess made
 * from the URL itself:
 *
 *   · `false` for `openai-embeddings`, whose base URL is whatever the person
 *     typed and conventionally already ends in the version segment
 *     (`https://api.openai.com/v1`, `http://localhost:1234/v1`). A suffix added
 *     here would double theirs, and a URL without one is left as typed.
 *   · `true` for a type whose base URL is the server's root, as every local
 *     server's text adapter already treats it (`{base}/v1/chat/completions`).
 *
 * Trailing slashes are dropped and nothing else is touched — `appendV1: true`
 * on a base that already ends in `/v1` gives `/v1/v1/embeddings`, which is
 * what each type's existing rows have always resolved to and must keep doing.
 */
export function openAIEmbeddingsUrl(
	baseUrl: string | null | undefined,
	appendV1: boolean
): string {
	return `${normalizeBaseUrl(baseUrl)}${appendV1 ? "/v1" : ""}/embeddings`
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
 * database at import time — so a static import here would make constructing an
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

/** JSON, and a bearer token when there is one to send. */
export function openAIHeaders(
	apiKey: string | null | undefined
): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
	}
}

/**
 * The line a refused request should read as: `<subject> failed (<status>)`,
 * then the server's own body, when it sent one — that body is usually the whole
 * diagnosis ("model not found", "embeddings are not enabled").
 */
export async function embeddingsRefusal(
	res: Response,
	subject: string
): Promise<Error> {
	let detail = ""
	try {
		detail = (await res.text())?.slice(0, 500) ?? ""
	} catch {
		detail = ""
	}
	return new Error(
		`${subject} failed (${res.status})${detail ? `: ${detail}` : ""}`
	)
}

export interface OpenAIEmbeddingsRequest {
	/** The base URL as stored. See `openAIEmbeddingsUrl`. */
	baseUrl: string
	/** Whether `/v1` goes between it and `/embeddings`. See `openAIEmbeddingsUrl`. */
	appendV1: boolean
	model: string
	/** ⚠ Never empty: the caller answers an empty batch without the wire. */
	input: string[]
	/** A bearer token, already decrypted. Nothing is sent without one. */
	apiKey?: string | null
	/**
	 * Who the error sentences name: `"KoboldCPP"` reads "KoboldCPP's embeddings
	 * request failed (500)" and "KoboldCPP returned 1 vectors for 2 inputs."
	 * Unset, they name the endpoint generically.
	 */
	service?: string
	signal?: AbortSignal
}

export interface OpenAIEmbeddingsAnswer {
	/** One vector per input, in INPUT order. */
	vectors: number[][]
	/** Their width — checked to be one width for the whole batch. */
	dimensions: number
	/**
	 * The `model` the answer named, trimmed, or null when it named none.
	 *
	 * Reported, never judged: what it means is the type's question. The generic
	 * adapter passes it through; KoboldCPP refuses an answer naming any model
	 * but the pair's.
	 */
	model: string | null
	/** The parsed body, for the receipt. Never interpreted past this module. */
	raw: unknown
}

/** One batch through the wire, validated. Throws a sentence on any failure. */
export async function postOpenAIEmbeddings(
	req: OpenAIEmbeddingsRequest
): Promise<OpenAIEmbeddingsAnswer> {
	const res = await fetch(openAIEmbeddingsUrl(req.baseUrl, req.appendV1), {
		method: "POST",
		headers: openAIHeaders(req.apiKey),
		body: JSON.stringify({ model: req.model, input: req.input }),
		signal: req.signal
	})
	if (!res.ok)
		throw await embeddingsRefusal(
			res,
			req.service
				? `${req.service}'s embeddings request`
				: "Embeddings request"
		)
	const body = (await res.json()) as { data?: unknown; model?: unknown }
	const vectors = vectorsInInputOrder(
		body?.data,
		req.input.length,
		req.service ?? "The embeddings endpoint"
	)
	return {
		vectors,
		dimensions: vectors[0]?.length ?? 0,
		model:
			typeof body?.model === "string" && body.model.trim()
				? body.model.trim()
				: null,
		raw: body
	}
}

/**
 * `data`, checked and put back in input order.
 *
 * ⚠ Placed by the API's OWN `index`, never trusted to arrive in order. The spec
 * gives each item its index precisely because the list is not required to be
 * ordered, and a vector filed against the wrong row is a retrieval failure
 * that surfaces as bad results rather than as an error. An item with no index
 * at all keeps its arrival position — the only reading a server that omits
 * them leaves — and either way the positions must be exactly one per input.
 *
 * One width for the batch, too: vectors of two widths are two models' output
 * or a truncated answer, and either would corrupt an index built from them.
 */
function vectorsInInputOrder(
	data: unknown,
	count: number,
	speaker: string
): number[][] {
	if (!Array.isArray(data) || data.length !== count)
		throw new Error(
			`${speaker} returned ${Array.isArray(data) ? data.length : 0} vectors for ${count} inputs.`
		)
	const vectors: number[][] = new Array(count)
	data.forEach((item: any, arrival) => {
		const at = typeof item?.index === "number" ? item.index : arrival
		const embedding = item?.embedding
		if (
			!Array.isArray(embedding) ||
			embedding.length === 0 ||
			!embedding.every((v) => typeof v === "number")
		)
			throw new Error(
				`${speaker} returned something other than a vector for input ${at}.`
			)
		if (!Number.isInteger(at) || at < 0 || at >= count || vectors[at])
			throw new Error(
				`${speaker} returned vectors whose indexes do not match the ${count} inputs.`
			)
		vectors[at] = embedding
	})
	const width = vectors[0]?.length ?? 0
	const other = vectors.find((v) => v.length !== width)
	if (other)
		throw new Error(
			`${speaker} returned vectors of different widths (${width} and ${other.length}).`
		)
	return vectors
}
