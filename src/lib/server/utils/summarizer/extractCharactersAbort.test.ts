/**
 * extractCharactersFromContent() used to end in a bare
 * `catch { return { participantCharacters: [], mentionedCharacters: [] } }`,
 * which turned a *cancelled* extraction into the indistinguishable claim
 * "nobody was in this scene". That matters because callers act on the result:
 * the summarize path persists it onto the scene row, and the graph build feeds
 * it into a proposal the user reviews and commits. So a mid-flight cancel
 * either wrote an empty cast over real data or silently produced a proposal
 * missing characters — with no error anywhere.
 *
 * The catch now rethrows when the signal aborted, and still degrades to empty
 * for ordinary parse/LLM failures (which are genuinely "extraction produced
 * nothing usable", not "the user changed their mind").
 *
 * Both callers classify cancellation by *signal*, not error name — scenes.ts's
 * catch keys on abortController.signal.aborted, and narrativeGraph.ts's build
 * catch reads `signal.aborted || err.name === "AbortError"` (signal first) — so
 * the rethrown error's shape doesn't matter to either of them.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

const mockGenerate = vi.fn()

vi.mock("../getConnectionAdapter", () => ({
	getConnectionAdapter: vi.fn(async () => ({
		// `implements` and not a bare method: it is what makes this fake fail to
		// compile if it ever drifts from the real `text->text` action — see
		// fakeTextAdapter.ts for why `implements AdapterActions` would not.
		Adapter: class implements FakeTextAdapter {
			constructor(_args: any) {}
			async preflight() {}
			async generateText() {
				return mockGenerate()
			}
			abort() {}
		},
		listModels: async () => [],
		testConnection: async () => ({ success: true }),
		connectionDefaults: {},
		samplingKeyMap: {}
	}))
}))

const { extractCharactersFromContent } = await import("./index")

function baseParams(signal?: AbortSignal) {
	return {
		content: "Aria and Bram argued in the market.",
		connection: { name: "test-conn", type: "ollama" } as any,
		sampling: { name: "test-sampling" } as any,
		contextConfig: {} as any,
		promptConfig: {} as any,
		signal
	}
}

describe("extractCharactersFromContent — abort vs failure", () => {
	beforeEach(() => {
		mockGenerate.mockReset()
	})

	test("an aborted extraction rethrows instead of reporting an empty cast", async () => {
		const controller = new AbortController()
		mockGenerate.mockImplementation(async () => {
			// Cancel arrives while the generation is in flight, then the call
			// fails — exactly the shape that used to be swallowed.
			controller.abort()
			throw new Error("aborted by user")
		})

		await expect(
			extractCharactersFromContent(baseParams(controller.signal))
		).rejects.toThrow()
	})

	test("an already-aborted signal rethrows rather than returning empty", async () => {
		const controller = new AbortController()
		controller.abort()
		mockGenerate.mockImplementation(async () => {
			throw new Error("stopped")
		})

		await expect(
			extractCharactersFromContent(baseParams(controller.signal))
		).rejects.toThrow()
	})

	test("a non-abort failure still degrades to an empty cast", async () => {
		const controller = new AbortController()
		mockGenerate.mockImplementation(async () => {
			throw new Error("model exploded")
		})

		const result = await extractCharactersFromContent(
			baseParams(controller.signal)
		)
		expect(result).toEqual({
			participantCharacters: [],
			mentionedCharacters: []
		})
	})

	test("unparseable output still degrades to an empty cast", async () => {
		mockGenerate.mockResolvedValue({ text: "not json at all" })

		const result = await extractCharactersFromContent(baseParams())
		expect(result).toEqual({
			participantCharacters: [],
			mentionedCharacters: []
		})
	})
})
