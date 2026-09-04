/**
 * Dispatch: the same adapters, reached with a prompt built elsewhere.
 *
 * The adapter is a fake, because what is under test is not whether KoboldCPP
 * answers — it is that the payload arrives unmodified, that streamed chunks
 * reach both the sink and the port, that an abort reaches the adapter's own
 * flag, and that **no connection material comes back**. The last one is the
 * reason this file exists at all: it is a property that can only be broken
 * silently, since a leak looks exactly like a working generation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

const SECRET_KEY = "sk-do-not-leak-9f8e7d"
const SECRET_URL = "http://192.168.1.50:5001"

const connection = {
	id: 1,
	type: "koboldcpp",
	name: "Local Kobold",
	baseUrl: SECRET_URL,
	apiKey: SECRET_KEY,
	model: "some-model-q4",
	promptFormat: "vicuna",
	tokenCounter: "estimate"
}

/** What the fake adapter saw, so a test can assert on it after the fact. */
let seen: {
	compiledPrompt?: unknown
	constructedWith?: any
	aborted?: boolean
} = {}
let mode: "text" | "stream" | "empty" | "abort" = "text"
let connectionForRun: any = connection

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	aborted = false
	promptBuilder: any = {}
	constructor(params: any) {
		seen.constructedWith = params
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		seen.compiledPrompt = p
		return this
	}
	abort() {
		this.aborted = true
		seen.aborted = true
	}
	async generateText() {
		if (mode === "empty")
			return {
				completionResult: "",
				compiledPrompt: this.injected,
				isAborted: false
			}
		if (mode === "abort")
			return {
				completionResult: "partial",
				compiledPrompt: this.injected,
				isAborted: true
			}
		if (mode === "stream")
			return {
				compiledPrompt: this.injected,
				isAborted: false,
				completionResult: async (
					onContent: (c: string) => void,
					onThinking?: (c: string) => void
				) => {
					onThinking?.("hmm")
					for (const chunk of ["Hel", "lo ", "there"]) {
						if (this.aborted) return
						onContent(chunk)
					}
				}
			}
		return {
			completionResult: "Hello there",
			compiledPrompt: this.injected,
			isAborted: false,
			thinkingContent: "hmm"
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
/** What the resolver was ASKED for — tier 2 arrives in these params. */
let resolveArgs: any = null
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async (params: any) => {
		resolveArgs = params
		return {
			connection: connectionForRun,
			sampling: { id: 1, temperature: 1 }
		}
	}
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." }
	})
}))
let sessionRow = true

/**
 * The database, handed in rather than imported.
 *
 * `dispatch.ts` used to import the app's connection directly; the end-to-end
 * spine test caught it by running against a test database and watching dispatch
 * read from the other one. Passing it makes both tests possible.
 */
const fakeDb = {
	query: {
		sessions: {
			findFirst: async () =>
				sessionRow && {
					id: 7,
					sessionType: "session",
					sessionCharacters: [
						{ character: { id: 1, name: "Alice" } },
						{ character: null }
					],
					sessionPersonas: [{ persona: { id: 1, name: "Bob" } }],
					lorebook: null
				}
		}
	}
} as any

const { dispatchGeneration, DispatchError } = await import(
	"$lib/server/pipelines/runtime/dispatch"
)
const { createHost, HostScopeError } = await import(
	"$lib/server/pipelines/runtime/host"
)
const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")

const compiled = { prompt: "You are Alice.", meta: { built: "by a Task" } }

beforeEach(() => {
	seen = {}
	resolveArgs = null
	mode = "text"
	sessionRow = true
	connectionForRun = connection
})

describe("dispatching a prompt built elsewhere", () => {
	it("hands the adapter the payload verbatim and builds nothing", async () => {
		// The whole seam: `withCompiledPrompt` is what makes `compilePrompt()`
		// return this instead of constructing one. If the payload were reshaped
		// on the way through, parity between the two paths would be untestable.
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			userId: 1
		})
		expect(seen.compiledPrompt).toBe(compiled)
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("hmm")
	})

	it("drops cast rows whose character was deleted, as the legacy path does", async () => {
		// The FK is nullable with `onDelete: set null`, so a row can survive its
		// character. `BasePromptSession` requires the relation on the rows it lists.
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		expect(seen.constructedWith.session.sessionCharacters).toHaveLength(1)
	})

	it("streams to the sink and still returns the whole text", async () => {
		mode = "stream"
		const chunks: string[] = []
		const thoughts: string[] = []
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			onChunk: (c) => chunks.push(c),
			onThinking: (c) => thoughts.push(c)
		})
		expect(chunks).toEqual(["Hel", "lo ", "there"])
		expect(thoughts).toEqual(["hmm"])
		// The port needs one value even though the user saw three.
		expect(r.text).toBe("Hello there")
	})

	it("delivers a non-streaming answer to the sink too", async () => {
		// Otherwise a connection that does not stream would show the user
		// nothing at all until the run finished, which reads as a hang.
		const chunks: string[] = []
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			onChunk: (c) => chunks.push(c)
		})
		expect(chunks).toEqual(["Hello there"])
	})

	it("an abort reaches the adapter, not just this function", async () => {
		// Returning early on the signal would leave the request running against
		// the provider — the user sees a stopped generation and the model keeps
		// being billed for it.
		mode = "stream"
		const controller = new AbortController()
		const chunks: string[] = []
		const done = dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7,
			signal: controller.signal,
			onChunk: (c) => {
				chunks.push(c)
				controller.abort()
			}
		})
		await done
		expect(seen.aborted).toBe(true)
		expect(chunks.length).toBeLessThan(3)
	})

	it("refuses an empty payload rather than generating from nothing", async () => {
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: null,
				sessionId: 7
			})
		).rejects.toThrow(DispatchError)
	})

	it("says the session is gone rather than generating into nothing", async () => {
		// A run can outlive the session it was triggered in — the prompt was built
		// minutes ago and the user deleted the session while the model was queued.
		sessionRow = false
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7
			})
		).rejects.toThrow(/no session 7/)
	})

	it("says so plainly when no connection is configured", async () => {
		connectionForRun = null
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				sessionId: 7
			})
		).rejects.toThrow(/no AI connection is configured/)
	})
})

describe("what dispatch refuses to hand back", () => {
	it("returns the completion and no connection material", async () => {
		// The security property, stated as a test because it can only ever fail
		// silently: a leak looks exactly like a working generation. A Provider
		// that could read the connection is a plugin that exfiltrates an API key
		// while its spec reads as an innocent node.
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			sessionId: 7
		})
		const serialised = JSON.stringify(r)
		expect(serialised).not.toContain(SECRET_KEY)
		expect(serialised).not.toContain(SECRET_URL)
		expect(serialised).not.toContain("some-model-q4")
		// The type is deliberately kept: enough to answer "which provider
		// answered", nothing anyone could replay.
		expect(r.via).toBe("koboldcpp")
	})

	it("keeps the connection out of the binding's result too", async () => {
		const bindings = coreBindings()
		const host = createHost(fakeDb, { sessionId: 7, userId: 1 })
		const r: any = await bindings["core:provider/generate-text@1"]!(
			{ compiledPrompt: compiled },
			{
				call: (payload: unknown) =>
					host.call!(payload, {
						key: "generate",
						typeId: "core:provider/generate-text",
						typeVersion: 1,
						kind: "provider"
					}),
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			} as any
		)
		expect(r.kind).toBe("ok")
		expect(JSON.stringify(r.value)).not.toContain(SECRET_KEY)
		expect(r.value.text).toBe("Hello there")
	})
})

describe("the generate-text binding", () => {
	const bindings = coreBindings()

	const runWith = (scope: any, input: any = { compiledPrompt: compiled }) => {
		const host = createHost(fakeDb, scope)
		return bindings["core:provider/generate-text@1"]!(input, {
			call: (payload: unknown) =>
				host.call!(payload, {
					key: "generate",
					typeId: "core:provider/generate-text",
					typeVersion: 1,
					kind: "provider"
				}),
			signal: new AbortController().signal,
			progress: () => {},
			log: () => {}
		} as any) as any
	}

	it("takes the assemble node's output without a shim in between", async () => {
		const r = await runWith(
			{ sessionId: 7 },
			{ main: compiled, blocks: [], budget: {} }
		)
		expect(r.kind).toBe("ok")
		expect(seen.compiledPrompt).toBe(compiled)
	})

	it("forwards its own connection and sampling slots as tier 2", async () => {
		// The middle tier of `capability default → pipeline config → session
		// override`. Its absence was invisible: the panel showed Connection and
		// Sampling pickers on the reply step, they stored fine, and nothing ever
		// read them — the run resolved from the instance default every time. The
		// `generate-image` sibling forwarded them all along, which is what made
		// the gap look like a difference in kind rather than an omission.
		await runWith(
			{ sessionId: 7 },
			{
				compiledPrompt: compiled,
				connection: { id: 42 },
				sampling: { id: 99 }
			}
		)
		expect(resolveArgs?.pipelineConnectionId).toBe(42)
		expect(resolveArgs?.pipelineSamplingId).toBe(99)
	})

	it("sends null for a slot nobody set, rather than inventing one", async () => {
		// A node with no connection chosen must fall through to the capability
		// default — not to a guess, and not to whatever the last run used.
		await runWith({ sessionId: 7 })
		expect(resolveArgs?.pipelineConnectionId).toBeNull()
		expect(resolveArgs?.pipelineSamplingId).toBeNull()
	})

	it("halts on an empty completion rather than erroring", async () => {
		// A stop sequence at position zero is a thing that happens. Calling it
		// an error sends whoever reads the receipt hunting for a bug.
		mode = "empty"
		const r = await runWith({ sessionId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/returned nothing/)
	})

	it("halts on an abort, and names it as one", async () => {
		mode = "abort"
		const r = await runWith({ sessionId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/aborted/)
	})

	it("refuses to generate in a run with no session scope", async () => {
		await expect(runWith({ userId: 1 })).rejects.toThrow(HostScopeError)
	})

	it("forwards the run's stream sink without putting it in the payload", async () => {
		// A socket handle is not a value; it must not land in the receipt.
		mode = "stream"
		const chunks: string[] = []
		const r = await runWith({
			sessionId: 7,
			sink: { onChunk: (c: string) => chunks.push(c) }
		})
		expect(chunks).toEqual(["Hel", "lo ", "there"])
		expect(JSON.stringify(r.value)).not.toContain("onChunk")
	})
})

/**
 * The debug panel's retrieval trail.
 *
 * This replaced `meta.rag`, which reported the legacy infill engine's internal
 * phase counters — a guaranteed window, a RAG pass, a fill pass. The pipeline
 * runs none of those phases, so porting the numbers would have meant inventing
 * them. What it does have is a decision per block, which answers the question
 * the panel existed for ("why isn't my lore showing up") directly rather than
 * by inference from an aggregate.
 */
describe("toCompiledPrompt's retrieval trail", () => {
	const allocation = {
		rendered: "PROMPT",
		totalTokens: 30,
		budget: { total: 100, used: 30, remaining: 70 },
		groups: { worldLore: { allocated: 50, used: 20, entries: 2 } },
		blocks: [
			{
				id: 7,
				source: "worldLore",
				name: "The Ashguard",
				content: "Riders who patrol the ash wastes.",
				tokens: 20,
				included: true,
				why: ["matched 'ashguard'", "score 0.812", "fits the budget"]
			},
			{
				id: 8,
				source: "worldLore",
				name: "The Long Winter",
				content: "Nine years without a thaw.",
				tokens: 40,
				included: false,
				why: ["matched 'winter'", "score 0.401", "over budget"]
			}
		]
	}

	const meta = async () => {
		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		return toCompiledPrompt(allocation, { promptFormat: "vicuna" }).meta
	}

	it("reports every candidate, kept or not", async () => {
		const blocks = (await meta()).retrieval.blocks
		expect(blocks.map((b: any) => [b.name, b.included])).toEqual([
			["The Ashguard", true],
			["The Long Winter", false]
		])
	})

	it("carries the reasoning, which is the whole point", async () => {
		// An excluded entry with no stated reason is exactly the state the
		// panel exists to prevent.
		const dropped = (await meta()).retrieval.blocks.find(
			(b: any) => !b.included
		)
		expect(dropped.why).toContain("over budget")
	})

	it("carries the budget the decisions were made against", async () => {
		expect((await meta()).retrieval.budget).toEqual({
			total: 100,
			used: 30,
			remaining: 70
		})
	})

	it("does not ship block content to the client", async () => {
		// It is already in the prompt this same object carries; a second copy
		// of every lore entry has no reader and a real cost on a big lorebook.
		for (const b of (await meta()).retrieval.blocks)
			expect(b).not.toHaveProperty("content")
	})

	it("degrades to an empty trail rather than throwing", async () => {
		// A plugin's assembler may produce a payload with no block record at
		// all. The panel renders nothing; it must not break the send.
		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/runtime/dispatch"
		)
		const bare = toCompiledPrompt(
			{ rendered: "x" },
			{ promptFormat: "vicuna" }
		)
		expect(bare.meta.retrieval).toEqual({ budget: null, blocks: [] })
	})
})
