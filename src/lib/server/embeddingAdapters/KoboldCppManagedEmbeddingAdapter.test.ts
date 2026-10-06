/**
 * Embeddings from KoboldCPP, run by Serene Pub — load first, then the wire.
 *
 * The three things this adapter adds to the external KoboldCPP's are each
 * pinned here, against a stubbed model manager and a stubbed `fetch`:
 *
 *   · the pair's GGUF is put in koboldcpp's embeddings slot BEFORE every
 *     request (`ensureManagedReady` with `kind: "embeddings"`), which is also
 *     what resets the idle timers — so embedding work counts as use;
 *   · the request goes to the address the manager answers with, never the
 *     row's display-only `baseUrl`;
 *   · an answer naming another model is refused, however koboldcpp spells it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const manager = vi.hoisted(() => ({
	calls: [] as string[],
	ensureManagedReady: vi.fn()
}))

// The real preflight opens the database and starts a process; what is under
// test is that it is ASKED, with what, and before the wire.
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: (...args: unknown[]) =>
		manager.ensureManagedReady(...args)
}))

const MANAGER_URL = "http://127.0.0.1:5099"

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 7,
		name: "KoboldCPP",
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		// Display only, and deliberately stale: the manager has moved port.
		baseUrl: "http://localhost:5001",
		model: "nomic-embed-text-v1.5.Q4_K_M.gguf",
		extraJson: {},
		capabilities: {},
		...over
	}) as any

function answering(model: string | undefined) {
	const f = vi.fn(async (_url: string, _init?: unknown) => {
		manager.calls.push("fetch")
		return {
			ok: true,
			status: 200,
			json: async () => ({
				object: "list",
				data: [
					{ index: 1, embedding: [0.4, 0.5] },
					{ index: 0, embedding: [0.1, 0.2] }
				],
				model
			})
		}
	})
	vi.stubGlobal("fetch", f)
	return f
}

async function adapter(over: Record<string, unknown> = {}) {
	const mod = (await import("./KoboldCppManagedEmbeddingAdapter")).default
	return new mod.Adapter(conn(over))
}

beforeEach(() => {
	manager.calls.length = 0
	manager.ensureManagedReady.mockReset().mockImplementation(async () => {
		manager.calls.push("ensure")
		return { baseUrl: MANAGER_URL }
	})
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("KoboldCPP, run by Serene Pub — embeddings", () => {
	it("loads the pair's model into the embeddings slot, then embeds at the manager's address", async () => {
		const f = answering("nomic-embed-text-v1.5.Q4_K_M")
		const signal = new AbortController().signal
		const res = await (
			await adapter()
		).embedText({ input: ["a", "b"] }, { signal })

		expect(manager.ensureManagedReady).toHaveBeenCalledWith(
			{ kind: "embeddings", file: "nomic-embed-text-v1.5.Q4_K_M.gguf" },
			{ connectionId: 7, signal }
		)
		expect(manager.calls).toEqual(["ensure", "fetch"])
		// The manager's address, not the row's — and `/v1` on its root.
		expect(f.mock.calls[0][0]).toBe(`${MANAGER_URL}/v1/embeddings`)
		expect((f.mock.calls[0][1] as any).signal).toBe(signal)
		expect(JSON.parse((f.mock.calls[0][1] as any).body)).toEqual({
			model: "nomic-embed-text-v1.5.Q4_K_M.gguf",
			input: ["a", "b"]
		})
		// In input order, by the API's own index.
		expect(res.vectors).toEqual([
			[0.1, 0.2],
			[0.4, 0.5]
		])
		expect(res.dimensions).toBe(2)
		expect(res.model).toBe("nomic-embed-text-v1.5.Q4_K_M")
	})

	it("asks the manager on EVERY request, which is what keeps the idle timers reset", async () => {
		answering("nomic-embed-text-v1.5.Q4_K_M")
		const a = await adapter()
		await a.embedText({ input: ["a", "b"] })
		await a.embedText({ input: ["c", "d"] })
		expect(manager.calls).toEqual(["ensure", "fetch", "ensure", "fetch"])
	})

	it("loads nothing and sends nothing for an empty batch", async () => {
		const f = answering("nomic-embed-text-v1.5.Q4_K_M")
		const res = await (await adapter()).embedText({ input: [] })
		expect(res).toEqual({
			vectors: [],
			model: "nomic-embed-text-v1.5.Q4_K_M.gguf",
			dimensions: 0
		})
		expect(manager.ensureManagedReady).not.toHaveBeenCalled()
		expect(f).not.toHaveBeenCalled()
	})

	it("refuses a pair with no model before touching the process", async () => {
		const f = answering("x")
		await expect(
			(await adapter({ model: null })).embedText({ input: ["a"] })
		).rejects.toThrow(/No embedding model is chosen/)
		expect(manager.ensureManagedReady).not.toHaveBeenCalled()
		expect(f).not.toHaveBeenCalled()
	})

	it("embeds nothing when the model will not load", async () => {
		const f = answering("nomic-embed-text-v1.5.Q4_K_M")
		manager.ensureManagedReady.mockRejectedValueOnce(
			new Error(
				'The embeddings model "nomic-embed-text-v1.5.Q4_K_M.gguf" failed to load'
			)
		)
		await expect(
			(await adapter()).embedText({ input: ["a"] })
		).rejects.toThrow(/failed to load/)
		expect(f).not.toHaveBeenCalled()
	})

	it("REFUSES vectors from any other model, naming both", async () => {
		answering("bge-m3-Q8_0")
		await expect(
			(await adapter()).embedText({ input: ["a", "b"] })
		).rejects.toThrow(
			/"bge-m3-Q8_0".*"nomic-embed-text-v1\.5\.Q4_K_M\.gguf".*cannot be mixed/
		)
	})

	it("refuses an answer that names no model", async () => {
		answering(undefined)
		await expect(
			(await adapter()).embedText({ input: ["a", "b"] })
		).rejects.toThrow(/did not say which embedding model/)
	})

	it("matches one model however koboldcpp spells it", async () => {
		for (const reported of [
			"nomic-embed-text-v1.5.Q4_K_M",
			"koboldcpp/nomic-embed-text-v1.5.Q4_K_M",
			"nomic-embed-text-v1.5.Q4_K_M.GGUF"
		]) {
			answering(reported)
			const res = await (await adapter()).embedText({ input: ["a", "b"] })
			expect(res.model).toBe(reported)
		}
	})

	it("exports the action alone — the endpoint lists and tests through its text module", async () => {
		const mod = (await import("./KoboldCppManagedEmbeddingAdapter")).default
		expect(Object.keys(mod)).toEqual(["Adapter"])
	})
})
