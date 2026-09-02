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

function makeSession(overrides: Record<string, any> = {}) {
	return {
		id: 1,
		userId: 1,
		sessionType: "session",
		metadata: { ragIgnored: true }, // skip the RAG dispatch branch entirely
		sessionMessages: [],
		sessionCharacters: [],
		sessionPersonas: [],
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
		// Empty is what "the context budget is switched off" resolves to now:
		sampling: {},
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are a helpful narrator." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.8,
		...overrides
	})
}

describe("BaseConnectionAdapter.compilePrompt()", () => {
	/**
	 * What is left of it.
	 *
	 * The three describes this replaced covered mode dispatch, narrator
	 * compilation and graph-context injection — all behaviours of the legacy
	 * `PromptBuilder`, which is deleted. Every prompt is now built by the
	 * pipeline and handed over via `withCompiledPrompt`; narrator mode is its
	 * own spec, and the relationship summary is `core:query/graph-context@1`.
	 * Those tests were not ported because there is nothing left on this class
	 * for them to assert.
	 *
	 * Two behaviours survive here, and both matter more than what went:
	 * summarizer mode still assembles its own payload, and an adapter asked to
	 * compile without having been handed one must refuse rather than generate
	 * from nothing.
	 */
	test("summarizer mode assembles its own payload", async () => {
		const adapter = makeAdapter()
		;(adapter as any).isSummarizerMode = true
		const spy = vi
			.spyOn(adapter as any, "compileSummarizerPrompt")
			.mockResolvedValue({
				prompt: "x",
				messages: [],
				meta: {} as any
			})

		await adapter.compilePrompt({})
		expect(spy).toHaveBeenCalledTimes(1)
	})

	test("returns the injected payload untouched when there is one", async () => {
		const adapter = makeAdapter()
		const payload = {
			prompt: "from the pipeline",
			messages: [],
			meta: {} as any
		}
		adapter.withCompiledPrompt(payload as any)
		await expect(adapter.compilePrompt({})).resolves.toBe(payload)
	})

	test("refuses rather than generating from an empty prompt", async () => {
		// The failure this prevents is silent: an adapter that fell through to
		// a missing builder and returned nothing would send an empty string and
		// read as a model fault.
		const adapter = makeAdapter()
		await expect(adapter.compilePrompt({})).rejects.toThrow(
			/never handed one/
		)
	})
})
