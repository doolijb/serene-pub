/**
 * The model's own token counts (B2, 2026-10-03): synchronous answers over an
 * asynchronous cache, so the SDK's counting stays a loop and the budget still
 * measures what the server will.
 */

import { describe, it, expect, vi } from "vitest"
import {
	BackendTokenCounts,
	UNCOUNTED_FLOOR,
	UNCOUNTED_MARGIN,
	backendCounter,
	tokenCountEndpointFor
} from "$lib/server/connections/backendTokenCount"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const estimate = (t: string) => Math.ceil(t.length / 4)

/** A KoboldCPP that counts one token per three characters. */
function kcpp(calls: string[] = [], ok = true) {
	return vi.fn(async (_url: unknown, init?: RequestInit) => {
		const { prompt } = JSON.parse(String(init?.body))
		calls.push(prompt)
		return {
			ok,
			json: async () => ({ value: Math.ceil(prompt.length / 3) })
		} as Response
	}) as unknown as typeof fetch
}

describe("tokenCountEndpointFor", () => {
	it("asks KoboldCPP (both kinds) and llama.cpp, and nobody else", () => {
		expect(tokenCountEndpointFor(CONNECTION_TYPE.KOBOLDCPP, "http://h:5001/")?.url).toBe(
			"http://h:5001/api/extra/tokencount"
		)
		expect(tokenCountEndpointFor(CONNECTION_TYPE.KOBOLDCPP_MANAGED, "http://h:5001")?.url).toBe(
			"http://h:5001/api/extra/tokencount"
		)
		const llama = tokenCountEndpointFor(CONNECTION_TYPE.LLAMACPP, "http://h:8080")!
		expect(llama.url).toBe("http://h:8080/tokenize")
		expect(llama.read({ tokens: [1, 2, 3] })).toBe(3)
		expect(tokenCountEndpointFor(CONNECTION_TYPE.OLLAMA, "http://h:11434")).toBeNull()
		expect(tokenCountEndpointFor(CONNECTION_TYPE.OPENAI, "https://api.openai.com")).toBeNull()
		expect(tokenCountEndpointFor(CONNECTION_TYPE.KOBOLDCPP, "")).toBeNull()
	})
})

describe("BackendTokenCounts", () => {
	const endpoint = tokenCountEndpointFor(CONNECTION_TYPE.KOBOLDCPP, "http://h:5001")!

	it("answers an uncounted text with the estimate scaled UP, then with the server's count", async () => {
		const calls: string[] = []
		const counts = new BackendTokenCounts(endpoint, kcpp(calls))
		const count = backendCounter(counts, estimate as any, { enqueue: true })
		const text = "x".repeat(120) // estimate 30, server 40
		expect(count(text)).toBe(Math.ceil(30 * UNCOUNTED_FLOOR * UNCOUNTED_MARGIN))
		await counts.drain()
		expect(calls).toEqual([text])
		expect(count(text)).toBe(40)
	})

	it("learns how far the estimate runs off and scales the next uncounted text by it", async () => {
		const counts = new BackendTokenCounts(endpoint, kcpp())
		const count = backendCounter(counts, estimate as any, { enqueue: true })
		count("a".repeat(400))
		await counts.drain()
		// Server/estimate = 134/100 — above the floor, so it wins.
		const next = count("b".repeat(400))
		expect(next).toBe(Math.ceil(100 * (134 / 100) * UNCOUNTED_MARGIN))
	})

	it("a preview reads what is known but asks the server nothing", async () => {
		const calls: string[] = []
		const counts = new BackendTokenCounts(endpoint, kcpp(calls))
		const preview = backendCounter(counts, estimate as any, { enqueue: false })
		preview("a draft being typed")
		await counts.drain()
		expect(calls).toEqual([])
	})

	it("never fails: a server that errors leaves the estimate answering", async () => {
		const counts = new BackendTokenCounts(endpoint, kcpp([], false))
		const count = backendCounter(counts, estimate as any, { enqueue: true })
		const first = count("y".repeat(80))
		await counts.drain()
		expect(count("y".repeat(80))).toBe(first)
	})
})
