/**
 * The OpenAI embeddings wire, once, for every type that speaks it.
 *
 * What a stored vector depends on is checked here rather than per adapter:
 * which input each vector belongs to, that there is one per input, and that
 * they share one width. Each adapter's own cases (its base URL, its key, what
 * it makes of the returned model) are in `adapters.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import {
	embeddingsRefusal,
	openAIEmbeddingsUrl,
	postOpenAIEmbeddings
} from "./openAIEmbeddings"

afterEach(() => {
	vi.unstubAllGlobals()
})

/** A host answering `body` to every request, recording each. */
function host(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	const f = vi.fn(async (_url: any, _init?: any) => ({
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body,
		text: async () =>
			typeof body === "string" ? body : JSON.stringify(body)
	}))
	vi.stubGlobal("fetch", f)
	return f
}

const call = (over: Record<string, unknown> = {}) => ({
	baseUrl: "http://localhost:8080",
	appendV1: true,
	model: "nomic-embed-text",
	input: ["a", "b"],
	...over
})

describe("openAIEmbeddingsUrl — /v1 is the type's statement, never a guess", () => {
	it("adds /v1 only when asked, and drops nothing but trailing slashes", () => {
		expect(openAIEmbeddingsUrl("http://h:5001", true)).toBe(
			"http://h:5001/v1/embeddings"
		)
		expect(openAIEmbeddingsUrl("http://h:5001///", true)).toBe(
			"http://h:5001/v1/embeddings"
		)
		expect(openAIEmbeddingsUrl("https://api.openai.com/v1/", false)).toBe(
			"https://api.openai.com/v1/embeddings"
		)
		expect(openAIEmbeddingsUrl("http://h:8080", false)).toBe(
			"http://h:8080/embeddings"
		)
	})

	it("does not look at the URL to decide — a base already ending in /v1 gets another", () => {
		// What every existing KoboldCPP row with such a base has always
		// resolved to; changing it silently would move their requests.
		expect(openAIEmbeddingsUrl("http://h:5001/v1", true)).toBe(
			"http://h:5001/v1/v1/embeddings"
		)
	})
})

describe("postOpenAIEmbeddings — the request", () => {
	it("posts {model, input} as JSON, with a bearer token only when there is a key", async () => {
		const f = host({
			data: [
				{ index: 0, embedding: [1, 0] },
				{ index: 1, embedding: [0, 1] }
			]
		})
		await postOpenAIEmbeddings(call({ apiKey: "sk-1" }))
		await postOpenAIEmbeddings(call())
		const [url, withKey] = f.mock.calls[0]
		expect(url).toBe("http://localhost:8080/v1/embeddings")
		expect(withKey.method).toBe("POST")
		expect(JSON.parse(withKey.body)).toEqual({
			model: "nomic-embed-text",
			input: ["a", "b"]
		})
		expect(withKey.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer sk-1"
		})
		expect(f.mock.calls[1][1].headers).toEqual({
			"Content-Type": "application/json"
		})
	})

	it("passes the caller's signal through", async () => {
		const f = host({ data: [{ index: 0, embedding: [1] }] })
		const signal = new AbortController().signal
		await postOpenAIEmbeddings(call({ input: ["a"], signal }))
		expect(f.mock.calls[0][1].signal).toBe(signal)
	})
})

describe("postOpenAIEmbeddings — the answer", () => {
	it("puts vectors back in INPUT order by the API's own index", async () => {
		host({
			data: [
				{ index: 1, embedding: [0, 1] },
				{ index: 0, embedding: [1, 0] }
			],
			model: "  nomic-embed-text-v1.5  "
		})
		const res = await postOpenAIEmbeddings(call())
		expect(res.vectors).toEqual([
			[1, 0],
			[0, 1]
		])
		expect(res.dimensions).toBe(2)
		// Trimmed, and reported as named — judging it is the caller's job.
		expect(res.model).toBe("nomic-embed-text-v1.5")
	})

	it("keeps arrival order for a server that sends no indexes", async () => {
		host({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] })
		const res = await postOpenAIEmbeddings(call())
		expect(res.vectors).toEqual([
			[1, 0],
			[0, 1]
		])
	})

	it("answers a null model when the server names none, or names a blank", async () => {
		host({ data: [{ index: 0, embedding: [1] }], model: " " })
		expect((await postOpenAIEmbeddings(call({ input: ["a"] }))).model).toBe(
			null
		)
		host({ data: [{ index: 0, embedding: [1] }] })
		expect((await postOpenAIEmbeddings(call({ input: ["a"] }))).model).toBe(
			null
		)
	})

	it("refuses a count that is not one vector per input", async () => {
		host({ data: [{ index: 0, embedding: [1] }] })
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			"The embeddings endpoint returned 1 vectors for 2 inputs."
		)
		// llama-server's bare `/embeddings` answers a bare array — no `data`.
		host([{ index: 0, embedding: [[1]] }])
		await expect(
			postOpenAIEmbeddings(call({ input: ["a"], service: "KoboldCPP" }))
		).rejects.toThrow("KoboldCPP returned 0 vectors for 1 inputs.")
	})

	it("refuses two vectors filed against one input", async () => {
		host({
			data: [
				{ index: 0, embedding: [1] },
				{ index: 0, embedding: [2] }
			]
		})
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			/indexes do not match the 2 inputs/
		)
		host({
			data: [
				{ index: 0, embedding: [1] },
				{ index: 2, embedding: [2] }
			]
		})
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			/indexes do not match/
		)
	})

	it("refuses an item that is not a vector", async () => {
		host({
			data: [
				{ index: 0, embedding: [1, 2] },
				{ index: 1, embedding: "AAAA" }
			]
		})
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			/something other than a vector for input 1/
		)
		host({
			data: [
				{ index: 0, embedding: [] },
				{ index: 1, embedding: [1] }
			]
		})
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			/something other than a vector for input 0/
		)
	})

	it("refuses a batch of two widths", async () => {
		host({
			data: [
				{ index: 0, embedding: [1, 2, 3] },
				{ index: 1, embedding: [1, 2] }
			]
		})
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			"The embeddings endpoint returned vectors of different widths (3 and 2)."
		)
	})

	it("says what the server said when it refuses, naming the service", async () => {
		host("embeddings are not enabled", { ok: false, status: 501 })
		await expect(
			postOpenAIEmbeddings(call({ service: "KoboldCPP" }))
		).rejects.toThrow(
			"KoboldCPP's embeddings request failed (501): embeddings are not enabled"
		)
		host("", { ok: false, status: 500 })
		await expect(postOpenAIEmbeddings(call())).rejects.toThrow(
			/^Embeddings request failed \(500\)$/
		)
	})
})

describe("embeddingsRefusal", () => {
	it("survives a body that cannot be read", async () => {
		const res = {
			status: 502,
			text: async () => {
				throw new Error("socket hang up")
			}
		} as unknown as Response
		expect(
			(await embeddingsRefusal(res, "Embeddings model list")).message
		).toBe("Embeddings model list failed (502)")
	})
})
