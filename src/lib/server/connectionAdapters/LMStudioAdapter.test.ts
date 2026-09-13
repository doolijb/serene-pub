import { describe, expect, test, vi } from "vitest"
import { BLOCK_ROLES } from "$lib/shared/constants/completionTemplates"
import { composeStops } from "$lib/server/connections/stops"

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

const lmStudioConstructorMock = vi.fn()
const listDownloadedModelsMock = vi.fn()
const getLMStudioVersionMock = vi.fn()
// A loaded model, for the one test that actually generates. The rest of this
// file never reaches `llm.model`, so answering it costs them nothing.
const respondMock = vi.fn(async (..._args: any[]) => ({ content: "hi" }))
const completeMock = vi.fn(async (..._args: any[]) => ({ content: "hi" }))
vi.mock("@lmstudio/sdk", () => ({
	LMStudioClient: class {
		system = {
			listDownloadedModels: (...args: any[]) =>
				listDownloadedModelsMock(...args),
			getLMStudioVersion: (...args: any[]) =>
				getLMStudioVersionMock(...args)
		}
		llm = {
			model: vi.fn(async () => ({
				getContextLength: vi.fn(async () => 4096),
				respond: (...args: any[]) => respondMock(...args),
				complete: (...args: any[]) => completeMock(...args)
			}))
		}
		constructor(...args: any[]) {
			lmStudioConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./LMStudioAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "lmstudio",
		baseUrl: "ws://localhost:1234",
		model: "some-model",
		promptFormat: "chatml",
		extraJson: { ttl: 60 },
		...overrides
	}
}

function makeSession(): any {
	return {
		id: 1,
		userId: 1,
		sessionType: "session",
		metadata: { ragIgnored: true },
		sessionMessages: [],
		sessionCharacters: [],
		sessionPersonas: [],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		}
	}
}

function makeAdapter(
	connectionOverrides: Record<string, any> = {},
	// Already RESOLVED, the way an adapter receives it: a key being present is
	// the switch being on.
	sampling: Record<string, unknown> = {}
) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		sampling: sampling as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("LMStudioAdapter — base URL trailing-slash normalization", () => {
	test("getClient() constructs LMStudioClient with a normalized baseUrl", () => {
		lmStudioConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "ws://localhost:1234/" })
		adapter.getClient()
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)
	})

	test("getClient() passes baseUrl: undefined (not empty string) when unset", () => {
		lmStudioConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.getClient()
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: undefined })
		)
	})

	test("testConnection() and listModels() also normalize baseUrl", async () => {
		lmStudioConstructorMock.mockClear()
		getLMStudioVersionMock.mockResolvedValue({ version: "1.0.0" })
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "m1" }])

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "ws://localhost:1234/" })
		)
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)

		await exportsDefault.listModels(
			makeConnection({ baseUrl: "ws://localhost:1234///" })
		)
		expect(lmStudioConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseUrl: "ws://localhost:1234" })
		)
	})
})

describe("LMStudioAdapter.mapSamplingConfig()", () => {
	// `sampling` arrives already resolved, so a switched-off sampler reaches the
	// adapter as an absent key — omission is the only "off" there is. The
	// undefined/object guards are a separate rule about unusable values.
	test("maps known sampling keys, skipping omitted/undefined/object values", () => {
		const adapter = makeAdapter()
		adapter.sampling = { temperature: 0.7 } as any
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
	})
})

describe("LMStudioAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

/**
 * An admin-authored template's stop strings have to reach LM Studio too.
 *
 * ⚠ This case lives HERE rather than beside the other five adapters'
 * (`adminTemplateStops.test.ts`) because `importBoundary.test.ts` allows
 * `LMStudioAdapter` to be imported by the registry thunk and **its own tests**
 * only — `@lmstudio/sdk` uses regex property escapes that fail to PARSE under
 * nodejs-mobile's V8, so any other importer takes server boot down on Android.
 * The defect and the reasoning are documented in `adminTemplateStops.test.ts`;
 * this is the sixth call site, asserted at the outgoing payload like the rest.
 */
describe("LMStudioAdapter — an admin-authored template's stop strings", () => {
	// Shares no bytes with any built-in: `### `, `<|im_`, `*** ` and the
	// `Speaker:` shapes all appear in shipped rows, so asserting against them
	// could pass on a fallback.
	const CUSTOM = {
		key: "acme-house-style",
		name: "Acme House Style",
		renderMode: "flat" as const,
		roles: Object.fromEntries(
			BLOCK_ROLES.map((r) => [
				r,
				{ prefix: `@@${r}@@\n`, suffix: "@@stop@@\n" }
			])
		) as any,
		fallbackRole: { prefix: "@@user@@\n", suffix: "@@stop@@\n" },
		stopStrings: ["@@stop@@", "@@user@@"],
		isSelectable: true
	}

	test("sends the template's stop strings, not the default's", async () => {
		respondMock.mockClear()
		completeMock.mockClear()
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])

		const adapter = makeAdapter({
			// The connection AS A RESOLVER HANDS IT OVER — the row with the
			// template its `promptFormat` names already dereferenced. Without
			// it the key alone resolves against the BUILT-INS, which is the
			// whole defect: an authored template got the default's stops.
			promptFormat: CUSTOM.key,
			completionTemplate: CUSTOM,
			// Completion wire mode: a completion template's stop strings are
			// what this case is about, and they are only sent in that mode.
			wireMode: "completion",
			extraJson: { ttl: 60, stream: false }
		})
		adapter.withCompiledPrompt({
			prompt: "@@system@@\nYou are terse.@@stop@@\n",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		// ⚠ Composed at the HOST, then handed over — the adapter builds nothing
		// (ruling 2026-09-10). The end-to-end property this case has always
		// asserted is unchanged and is what the pairing preserves: the template
		// this connection carries is the one `composeStops` reads, and the row
		// it reads is the one the resolver dereferenced. Calling the real
		// composer rather than a hand-written list is what keeps the assertion
		// about the app rather than about the test.
		adapter.withStops(
			composeStops({
				template: CUSTOM,
				characters: [],
				personas: [],
				currentCharacterId: null,
				explicit: [],
				wire: "completion"
			})
		)
		await adapter.generateText()

		const opts = (respondMock.mock.calls[0] ??
			completeMock.mock.calls[0])?.[1] as any
		expect(opts, "no generation request was sent").toBeDefined()
		expect(opts.stopStrings).toEqual(
			expect.arrayContaining(CUSTOM.stopStrings)
		)
		// Vicuna's lead stop — what a fallback resolution would have sent.
		expect(opts.stopStrings).not.toContain("</s>")
	})

	/**
	 * The sixth adapter's half of `stopsOnTheWire.test.ts` — the file it cannot
	 * join, because `importBoundary.test.ts` lets `@lmstudio/sdk` be imported by
	 * the registry thunk and this adapter's own tests only.
	 *
	 * Stated negatively for the same reason: an adapter that ALSO composed
	 * locally would satisfy "the handed-over list arrived" and still be wrong.
	 */
	test("honours the composed list and adds nothing of its own", async () => {
		respondMock.mockClear()
		completeMock.mockClear()
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])

		const adapter = makeAdapter({
			promptFormat: CUSTOM.key,
			// A decoy: an adapter that went and looked would put `@@stop@@` on
			// the wire, and it shares no bytes with the list handed over below.
			completionTemplate: CUSTOM,
			wireMode: "completion",
			extraJson: { ttl: 60, stream: false }
		})
		adapter.withCompiledPrompt({
			prompt: "@@system@@\nYou are terse.@@stop@@\n",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		adapter.withStops({
			sent: [
				{ value: "%%one%%", kind: "format" },
				{ value: "%%two%%", kind: "explicit" }
			],
			dropped: [{ value: "%%held-back%%", kind: "speaker" }],
			wire: "completion"
		})
		await adapter.generateText()

		const opts = (respondMock.mock.calls[0] ??
			completeMock.mock.calls[0])?.[1] as any
		expect(opts.stopStrings).toEqual(["%%one%%", "%%two%%"])
		for (const decoy of [...CUSTOM.stopStrings, "%%held-back%%"])
			expect(
				opts.stopStrings,
				`"${decoy}" is on the wire, so this adapter composed its own list`
			).not.toContain(decoy)
	})
})

/**
 * Native reasoning through the LM Studio SDK.
 *
 * ⚠ Lives HERE for the same reason the stop-strings case above does:
 * `importBoundary.test.ts` lets `@lmstudio/sdk` be imported by the registry
 * thunk and this adapter's OWN tests only, so this case cannot join a shared
 * file. Same shape as the KoboldCPP suite otherwise.
 *
 * LM Studio does not use a wire field — its SDK splits reasoning for us:
 *   - streaming: every `LLMPredictionFragment` carries `reasoningType`
 *     ("none" | "reasoning" | "reasoningStartTag" | "reasoningEndTag").
 *   - non-streaming: `PredictionResult` carries `reasoningContent` and
 *     `nonReasoningContent` alongside the combined `content`.
 */
describe("LMStudioAdapter — native reasoning readback", () => {
	function mockCompilePrompt(adapter: any) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	// An OngoingPrediction stands in for a promise here: the adapter iterates it
	// directly when streaming, and calls cancel() on the idle/abort paths.
	function fragmentStream(fragments: any[]) {
		return {
			async *[Symbol.asyncIterator]() {
				for (const fragment of fragments) yield fragment
			},
			cancel: vi.fn()
		}
	}

	async function drain(result: any) {
		let content = ""
		let thinking = ""
		expect(typeof result.completionResult).toBe("function")
		await result.completionResult(
			(chunk: string) => {
				content += chunk
			},
			(chunk: string) => {
				thinking += chunk
			}
		)
		return { content, thinking }
	}

	test("streaming: routes reasoningType fragments to thinkingCb and drops the tag fragments", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		respondMock.mockReturnValueOnce(
			fragmentStream([
				{ content: "<think>", reasoningType: "reasoningStartTag" },
				{ content: "Pondering", reasoningType: "reasoning" },
				{ content: " deeply.", reasoningType: "reasoning" },
				{ content: "</think>", reasoningType: "reasoningEndTag" },
				{ content: "Hello", reasoningType: "none" },
				{ content: " there.", reasoningType: "none" }
			]) as any
		)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { ttl: 60, stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(thinking).toBe("Pondering deeply.")
		// The tags are structure, not prose — the reasoning arrives on its own
		// channel, so leaving them in the reply would show the user raw markup.
		expect(content).toBe("Hello there.")
	})

	test("streaming: a fragment with no reasoningType is content, exactly as before", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		completeMock.mockReturnValueOnce(
			fragmentStream([
				{ content: "Hello" },
				{ content: " there." }
			]) as any
		)

		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { ttl: 60, stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(content).toBe("Hello there.")
		expect(thinking).toBe("")
	})

	test("non-streaming: thinkingContent comes from reasoningContent, and the reply drops the reasoning", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		respondMock.mockResolvedValueOnce({
			// `content` is the WHOLE generation, reasoning included — returning
			// it verbatim while also reporting thinkingContent would show the
			// scratchpad twice.
			content: "<think>Pondering deeply.</think>Hello there.",
			reasoningContent: "Pondering deeply.",
			nonReasoningContent: "Hello there."
		} as any)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { ttl: 60, stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.thinkingContent).toBe("Pondering deeply.")
		expect(result.completionResult).toBe("Hello there.")
	})

	test("non-streaming: with no reasoning, content and thinkingContent are untouched", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		completeMock.mockResolvedValueOnce({
			content: "Hello there.",
			reasoningContent: "",
			nonReasoningContent: "Hello there."
		} as any)

		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { ttl: 60, stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.thinkingContent).toBeUndefined()
	})

	// Both wire modes, asserted rather than assumed. `.respond()` and
	// `.complete()` reach the same routing, and the SDK tags fragments the same
	// way for either — but "reasoning works in completion wire too" is a claim
	// the capability layer will read, so it is pinned here rather than inferred.
	test("streaming: completion wire (.complete) is tagged the same way", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		completeMock.mockReturnValueOnce(
			fragmentStream([
				{ content: "Pondering deeply.", reasoningType: "reasoning" },
				{ content: "Hello there.", reasoningType: "none" }
			]) as any
		)

		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { ttl: 60, stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(thinking).toBe("Pondering deeply.")
		expect(content).toBe("Hello there.")
	})

	test("non-streaming: completion wire (.complete) splits reasoning the same way", async () => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		completeMock.mockResolvedValueOnce({
			content: "<think>Pondering deeply.</think>Hello there.",
			reasoningContent: "Pondering deeply.",
			nonReasoningContent: "Hello there."
		} as any)

		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { ttl: 60, stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.thinkingContent).toBe("Pondering deeply.")
		expect(result.completionResult).toBe("Hello there.")
	})

	test("non-streaming: an SDK result without the reasoning fields still returns its content", async () => {
		// Defensive: `content` alone is the older result shape, and the one the
		// rest of this file's mocks return. It must not become an empty reply.
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		respondMock.mockResolvedValueOnce({ content: "Hello there." } as any)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { ttl: 60, stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.thinkingContent).toBeUndefined()
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * `auto` resolves to the CONNECTION's answer and nothing else: this adapter's
 * default is `|| false`, and widening an unset flag to true would change what
 * every untouched LM Studio connection sends. Read off `completionResult`,
 * because that is the fact the dispatch branches on — a function is a stream to
 * drain, a string is an answer already in hand.
 */
describe("LMStudioAdapter — the node's streaming parameter", () => {
	const sendWith = async (stream: boolean, mode?: "auto" | "off") => {
		listDownloadedModelsMock.mockResolvedValue([{ modelKey: "some-model" }])
		respondMock.mockReset()
		// Only the non-streaming branch reaches this: a streaming request
		// returns a closure and calls `respond()` when somebody drains it.
		respondMock.mockResolvedValue({ content: "ok" } as any)
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { ttl: 60, stream }
		})
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		if (mode) adapter.withStreaming(mode)
		const result = await adapter.generateText()
		return typeof result.completionResult === "function"
			? "streamed"
			: "one request"
	}

	test("auto answers whatever the connection says, both ways", async () => {
		expect(await sendWith(true, "auto")).toBe("streamed")
		expect(await sendWith(false, "auto")).toBe("one request")
	})

	test("a node that hands nothing over is the same as auto", async () => {
		expect(await sendWith(true)).toBe("streamed")
		expect(await sendWith(false)).toBe("one request")
	})

	test("off sends one request even on a streaming connection", async () => {
		expect(await sendWith(true, "off")).toBe("one request")
	})
})

/**
 * Reasoning, as a SAMPLING parameter (ruling 2026-09-12).
 *
 * LM Studio's own server speaks the OpenAI spelling, so the level rides in
 * `options` beside the rest of `mapSamplingConfig` — which is where this
 * adapter has always put a key the SDK may or may not forward.
 */
describe("LMStudioAdapter — reasoning on the wire", () => {
	async function optionsFor(sampling: Record<string, unknown>) {
		respondMock.mockClear()
		completeMock.mockClear()
		const adapter = makeAdapter(
			{ wireMode: "chat", extraJson: { ttl: 60, stream: false } },
			sampling
		)
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		const opts = (respondMock.mock.calls[0] ??
			completeMock.mock.calls[0])?.[1] as any
		return { opts, adapter }
	}

	test("a config that never enabled it sends no key at all", async () => {
		const { opts, adapter } = await optionsFor({ temperature: 0.5 })
		expect(opts).not.toHaveProperty("reasoning_effort")
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("off, and the three levels, go across as the OpenAI word", async () => {
		expect(
			(await optionsFor({ reasoning: "off" })).opts.reasoning_effort
		).toBe("none")
		for (const level of ["low", "medium", "high"] as const)
			expect(
				(await optionsFor({ reasoning: level })).opts.reasoning_effort
			).toBe(level)
	})

	test("a budget has no field here, and says so", async () => {
		const { opts, adapter } = await optionsFor({
			reasoning: "low",
			reasoningBudget: 2048
		})
		expect(opts.reasoning_effort).toBe("low")
		expect(opts).not.toHaveProperty("reasoningBudget")
		expect(adapter.ignoredSamplers).toEqual(["reasoningBudget"])
	})
})
