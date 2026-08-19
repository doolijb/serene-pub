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

class FakeAdapter {
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
	async generate() {
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
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: connectionForRun,
		sampling: { id: 1, temperature: 1 }
	})
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." }
	})
}))
let chatRow = true

/**
 * The database, handed in rather than imported.
 *
 * `dispatch.ts` used to import the app's connection directly; the end-to-end
 * spine test caught it by running against a test database and watching dispatch
 * read from the other one. Passing it makes both tests possible.
 */
const fakeDb = {
	query: {
		chats: {
			findFirst: async () =>
				chatRow && {
					id: 7,
					chatType: "chat",
					chatCharacters: [
						{ character: { id: 1, name: "Alice" } },
						{ character: null }
					],
					chatPersonas: [{ persona: { id: 1, name: "Bob" } }],
					lorebook: null
				}
		}
	}
} as any

const { dispatchGeneration, DispatchError } = await import("./dispatch")
const { createHost, HostScopeError } = await import("./host")
const { coreBindings } = await import("./bindings")

const compiled = { prompt: "You are Alice.", meta: { built: "by a Task" } }

beforeEach(() => {
	seen = {}
	mode = "text"
	chatRow = true
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
			chatId: 7,
			userId: 1
		})
		expect(seen.compiledPrompt).toBe(compiled)
		expect(r.text).toBe("Hello there")
		expect(r.thinking).toBe("hmm")
	})

	it("drops cast rows whose character was deleted, as the legacy path does", async () => {
		// The FK is nullable with `onDelete: set null`, so a row can survive its
		// character. `BasePromptChat` requires the relation on the rows it lists.
		await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			chatId: 7
		})
		expect(seen.constructedWith.chat.chatCharacters).toHaveLength(1)
	})

	it("streams to the sink and still returns the whole text", async () => {
		mode = "stream"
		const chunks: string[] = []
		const thoughts: string[] = []
		const r = await dispatchGeneration({
			db: fakeDb,
			compiledPrompt: compiled,
			chatId: 7,
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
			chatId: 7,
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
			chatId: 7,
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
			dispatchGeneration({ db: fakeDb, compiledPrompt: null, chatId: 7 })
		).rejects.toThrow(DispatchError)
	})

	it("says the chat is gone rather than generating into nothing", async () => {
		// A run can outlive the chat it was triggered in — the prompt was built
		// minutes ago and the user deleted the chat while the model was queued.
		chatRow = false
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				chatId: 7
			})
		).rejects.toThrow(/no chat 7/)
	})

	it("says so plainly when no connection is configured", async () => {
		connectionForRun = null
		await expect(
			dispatchGeneration({
				db: fakeDb,
				compiledPrompt: compiled,
				chatId: 7
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
			chatId: 7
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
		const host = createHost(fakeDb, { chatId: 7, userId: 1 })
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
			{ chatId: 7 },
			{ main: compiled, blocks: [], budget: {} }
		)
		expect(r.kind).toBe("ok")
		expect(seen.compiledPrompt).toBe(compiled)
	})

	it("halts on an empty completion rather than erroring", async () => {
		// A stop sequence at position zero is a thing that happens. Calling it
		// an error sends whoever reads the receipt hunting for a bug.
		mode = "empty"
		const r = await runWith({ chatId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/returned nothing/)
	})

	it("halts on an abort, and names it as one", async () => {
		mode = "abort"
		const r = await runWith({ chatId: 7 })
		expect(r.kind).toBe("halt")
		expect(r.reason).toMatch(/aborted/)
	})

	it("refuses to generate in a run with no chat scope", async () => {
		await expect(runWith({ userId: 1 })).rejects.toThrow(HostScopeError)
	})

	it("forwards the run's stream sink without putting it in the payload", async () => {
		// A socket handle is not a value; it must not land in the receipt.
		mode = "stream"
		const chunks: string[] = []
		const r = await runWith({
			chatId: 7,
			sink: { onChunk: (c: string) => chunks.push(c) }
		})
		expect(chunks).toEqual(["Hel", "lo ", "there"])
		expect(JSON.stringify(r.value)).not.toContain("onChunk")
	})
})
