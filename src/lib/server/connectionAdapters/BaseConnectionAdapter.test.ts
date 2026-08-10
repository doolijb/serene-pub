import { expect, test, vi, describe, beforeEach } from "vitest"

// BaseConnectionAdapter pulls in the full promptBuilder module graph
// (KeywordInfillEngine/RagInfillEngine/NarrativeGraphContext), which touches
// $lib/server/db and $lib/server/embedding at import time — mock both
// minimally before importing anything else, matching this repo's established
// test convention (see src/lib/server/auth/tokens/int.test.ts).
vi.mock("$lib/server/db", () => ({
	db: {
		query: {
			systemSettings: { findFirst: vi.fn(async () => null) }
		}
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	batchEmbed: vi.fn(),
	embed: vi.fn(),
	getLoadedModelId: () => null
}))

const { BaseConnectionAdapter } = await import("./BaseConnectionAdapter")

/** Minimal concrete subclass — generate() is abstract and irrelevant here;
 * compilePrompt()'s dispatch and compileNarratorResponsePrompt()'s pass-through
 * are what's under test. */
class TestAdapter extends BaseConnectionAdapter {
	async generate(): Promise<any> {
		throw new Error("not used in these tests")
	}
}

function makeChat(overrides: Record<string, any> = {}) {
	return {
		id: 1,
		userId: 1,
		chatType: "chat",
		metadata: { ragIgnored: true }, // skip the RAG dispatch branch entirely
		chatMessages: [],
		chatCharacters: [],
		chatPersonas: [],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		},
		...overrides
	} as any
}

function makeAdapter(overrides: Record<string, any> = {}) {
	return new TestAdapter({
		connection: { id: 1, promptFormat: "vicuna", extraJson: {} } as any,
		sampling: { contextTokensEnabled: false } as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are a helpful narrator." } as any,
		chat: makeChat(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		...overrides
	})
}

describe("BaseConnectionAdapter.compilePrompt() mode dispatch", () => {
	let adapter: InstanceType<typeof TestAdapter>
	let spies: Record<string, ReturnType<typeof vi.spyOn>>

	beforeEach(() => {
		adapter = makeAdapter()
		spies = {
			summarizer: vi
				.spyOn(adapter as any, "compileSummarizerPrompt")
				.mockResolvedValue({
					prompt: "x",
					messages: [],
					meta: {} as any
				}),
			narrator: vi
				.spyOn(adapter as any, "compileNarratorResponsePrompt")
				.mockResolvedValue({
					prompt: "x",
					messages: [],
					meta: {} as any
				}),
			default: vi
				.spyOn(adapter.promptBuilder, "compilePrompt")
				.mockResolvedValue({
					prompt: "x",
					messages: [],
					meta: {} as any
				})
		}
	})

	test("summarizer mode calls compileSummarizerPrompt only", async () => {
		adapter.isSummarizerMode = true
		await adapter.compilePrompt({ useChatFormat: true } as any)
		expect(spies.summarizer).toHaveBeenCalledTimes(1)
		expect(spies.narrator).not.toHaveBeenCalled()
		expect(spies.default).not.toHaveBeenCalled()
	})

	test("narrator response mode calls compileNarratorResponsePrompt only", async () => {
		adapter.isNarratorResponseMode = true
		await adapter.compilePrompt({} as any)
		expect(spies.narrator).toHaveBeenCalledTimes(1)
		expect(spies.summarizer).not.toHaveBeenCalled()
		expect(spies.default).not.toHaveBeenCalled()
	})

	test("no mode flags set falls through to the default character-perspective path", async () => {
		await adapter.compilePrompt({} as any)
		expect(spies.default).toHaveBeenCalledTimes(1)
		expect(spies.summarizer).not.toHaveBeenCalled()
		expect(spies.narrator).not.toHaveBeenCalled()
	})

	test("summarizer mode wins over narrator if both flags are set", async () => {
		adapter.isSummarizerMode = true
		adapter.isNarratorResponseMode = true
		await adapter.compilePrompt({} as any)
		expect(spies.summarizer).toHaveBeenCalledTimes(1)
		expect(spies.narrator).not.toHaveBeenCalled()
	})
})

describe("BaseConnectionAdapter.compileNarratorResponsePrompt()", () => {
	// Regression test for the bug fixed this session: compilePrompt()'s
	// dispatch used to call compileNarratorResponsePrompt() with NO arguments
	// at all, so a connection's useChatFormat choice never reached it — and
	// separately, compileNarratorResponsePrompt() itself used to hand-build a
	// messages-only response with prompt always left undefined, silently
	// sending an empty prompt to any text-completion connection. It's now a
	// thin pass-through into the shared context-block pipeline
	// (promptBuilder.compilePrompt) — this locks in that the args (in
	// particular useChatFormat) and the optional narratorInstructions focus
	// note actually reach it.

	test("forwards useChatFormat through to promptBuilder.compilePrompt()", async () => {
		const adapter = makeAdapter({ generatingMessageMetadata: {} })
		adapter.isNarratorResponseMode = true
		const spy = vi
			.spyOn(adapter.promptBuilder, "compilePrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: undefined,
				meta: {} as any
			})

		await adapter.compilePrompt({ useChatFormat: false } as any)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ useChatFormat: false })
		)

		await adapter.compilePrompt({ useChatFormat: true } as any)
		expect(spy).toHaveBeenLastCalledWith(
			expect.objectContaining({ useChatFormat: true })
		)
	})

	test("threads the per-trigger narratorInstructions focus note as extraInstructions", async () => {
		const adapter = makeAdapter({
			generatingMessageMetadata: {
				isNarratorResponse: true,
				narratorInstructions: "Focus on the weather turning."
			}
		})
		adapter.isNarratorResponseMode = true
		const spy = vi
			.spyOn(adapter.promptBuilder, "compilePrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: undefined,
				meta: {} as any
			})

		await adapter.compilePrompt({ useChatFormat: true } as any)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				extraInstructions: "Focus on the weather turning."
			})
		)
	})

	test("extraInstructions is undefined when no narratorInstructions were supplied", async () => {
		const adapter = makeAdapter({
			generatingMessageMetadata: { isNarratorResponse: true }
		})
		adapter.isNarratorResponseMode = true
		const spy = vi
			.spyOn(adapter.promptBuilder, "compilePrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: undefined,
				meta: {} as any
			})

		await adapter.compilePrompt({} as any)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ extraInstructions: undefined })
		)
	})
})

describe("BaseConnectionAdapter.compilePrompt() — graphContextInstructions (round-6 audit fix)", () => {
	// Regression test: generateResponse.ts used to append the narrative-graph
	// relationship summary directly to adapter.promptBuilder.instructions,
	// but that field is only ever set inside buildContextData() — called
	// later, from within promptBuilder.compilePrompt() itself — so it was
	// always undefined at the point generateResponse.ts ran, and the
	// injection silently never reached the model. It's now set on the
	// adapter as graphContextInstructions and merged into extraInstructions
	// here, the same mechanism narratorInstructions already uses.

	test("merges graphContextInstructions into extraInstructions on the default (non-narrator) path", async () => {
		const adapter = makeAdapter()
		adapter.graphContextInstructions = "Alice trusts Bob."
		const spy = vi
			.spyOn(adapter.promptBuilder, "compilePrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: undefined,
				meta: {} as any
			})

		await adapter.compilePrompt({ useChatFormat: true } as any)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				extraInstructions: "Alice trusts Bob."
			})
		)
	})

	test("extraInstructions is undefined when no graphContextInstructions were set", async () => {
		const adapter = makeAdapter()
		const spy = vi
			.spyOn(adapter.promptBuilder, "compilePrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: undefined,
				meta: {} as any
			})

		await adapter.compilePrompt({} as any)
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({ extraInstructions: undefined })
		)
	})

	test("does not reach the default path when narrator response mode is active (no double-injection)", async () => {
		const adapter = makeAdapter({
			generatingMessageMetadata: { isNarratorResponse: true }
		})
		adapter.isNarratorResponseMode = true
		adapter.graphContextInstructions = "Should not be used here."
		const defaultSpy = vi.spyOn(adapter.promptBuilder, "compilePrompt")
		const narratorSpy = vi
			.spyOn(adapter as any, "compileNarratorResponsePrompt")
			.mockResolvedValue({ prompt: "x", messages: undefined, meta: {} as any })

		await adapter.compilePrompt({} as any)
		expect(narratorSpy).toHaveBeenCalledTimes(1)
		expect(defaultSpy).not.toHaveBeenCalled()
	})
})
