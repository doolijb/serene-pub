/**
 * extractCharactersFromContent() regression — this used to be a private
 * closure inside generateSummary(), reachable only for freshly-drafted
 * scene summaries. It's now standalone specifically so
 * narrativeGraphBuildHandler can run the same extraction against
 * already-final history entry content for scene-less (direct) entries,
 * which previously extracted nobody at all (graphBuilder.ts's Phase 1 only
 * ever reads pre-resolved scene.participantCharacters/mentionedCharacters,
 * which direct entries never had populated). This locks in that the
 * extraction call itself still parses correctly through the refactor.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

const runQueuedLLMCallMock = vi.fn()

vi.mock("../runQueuedLLMCall", () => ({
	runQueuedLLMCall: (...args: unknown[]) => runQueuedLLMCallMock(...args)
}))

vi.mock("../getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		Adapter: class {
			constructor(_opts: unknown) {}
		}
	})
}))

const fakeConnection = {
	id: 1,
	name: "test-connection",
	type: "openai_session"
} as any
const fakeSampling = { id: 1, name: "test-sampling" } as any
const fakeContextConfig = { id: 1 } as any
const fakePromptConfig = { id: 1 } as any

afterEach(() => {
	runQueuedLLMCallMock.mockReset()
})

describe("extractCharactersFromContent", () => {
	test("parses participants/mentioned from a well-formed JSON response", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: '{"participants": ["Aria"], "mentioned": ["Bram"]}'
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content:
				"Aria walked into the tavern. Bram was mentioned in passing.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		// Legacy bare-string output is normalized to {name: ...} entries —
		// defense in depth for models that ignore the castId/name object
		// contract, or a custom prompt override still asking for the old
		// format.
		expect(result.participantCharacters).toEqual([{ name: "Aria" }])
		expect(result.mentionedCharacters).toEqual([{ name: "Bram" }])
	})

	test("strips markdown code fences before parsing", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: '```json\n{"participants": ["Kestrel"], "mentioned": []}\n```'
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content: "Kestrel arrived.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		expect(result.participantCharacters).toEqual([{ name: "Kestrel" }])
	})

	test("parses the current {castId}/{name} object contract", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: '{"participants":[{"castId":5},{"name":"New Guard"}],"mentioned":[{"castId":12}]}'
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content: "Bram nodded to the new guard.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		expect(result.participantCharacters).toEqual([
			{ castId: 5 },
			{ name: "New Guard" }
		])
		expect(result.mentionedCharacters).toEqual([{ castId: 12 }])
	})

	test("filters out malformed entries in the object contract (missing castId/name, wrong types)", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: '{"participants":[{"castId":5},{"castId":"not-a-number"},{},{"name":""}],"mentioned":[{"name":"Bram"}]}'
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content: "Some text.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		expect(result.participantCharacters).toEqual([{ castId: 5 }])
		expect(result.mentionedCharacters).toEqual([{ name: "Bram" }])
	})

	test("returns empty lists rather than throwing when the response has no JSON object", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: "I cannot determine the characters."
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content: "Some ambiguous text.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		expect(result).toEqual({
			participantCharacters: [],
			mentionedCharacters: []
		})
	})

	test("filters out non-string/non-object entries from a malformed legacy array", async () => {
		runQueuedLLMCallMock.mockResolvedValue({
			text: '{"participants": ["Aria", 42, null], "mentioned": "not-an-array"}'
		})
		const { extractCharactersFromContent } = await import("./index")

		const result = await extractCharactersFromContent({
			content: "Some text.",
			connection: fakeConnection,
			sampling: fakeSampling,
			contextConfig: fakeContextConfig,
			promptConfig: fakePromptConfig
		})

		expect(result.participantCharacters).toEqual([{ name: "Aria" }])
		expect(result.mentionedCharacters).toEqual([])
	})
})
