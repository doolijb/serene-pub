import { describe, expect, test, vi } from "vitest"

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

const openAIConstructorMock = vi.fn()
const createMock = vi.fn()
const modelsListMock = vi.fn()
vi.mock("openai", () => ({
	OpenAI: class {
		// `chat.completions` is the vendor SDK's own surface, not our vocabulary
		// — the sessions rename must never reach it, here or in the adapter.
		chat = {
			completions: { create: (...args: any[]) => createMock(...args) }
		}
		models = { list: (...args: any[]) => modelsListMock(...args) }
		constructor(...args: any[]) {
			openAIConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./OpenAIChatAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "openai",
		baseUrl: "https://api.example.com/v1",
		model: "gpt-4o",
		promptFormat: "openai",
		extraJson: { apiKey: "sk-test" },
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

function makeAdapter(connectionOverrides: Record<string, any> = {}) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		// Empty is what "the context budget is switched off" resolves to now:
		sampling: {},
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("OpenAIChatAdapter — base URL trailing-slash normalization", () => {
	test("generateText() constructs the OpenAI client with a normalized baseURL", async () => {
		openAIConstructorMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }]
		})
		const adapter = makeAdapter({ baseUrl: "https://api.example.com/v1/" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		expect(openAIConstructorMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)
	})

	test("listModels() and testConnection() also normalize the base URL", async () => {
		openAIConstructorMock.mockClear()
		modelsListMock.mockResolvedValue({ data: [] })
		await exportsDefault.listModels(
			makeConnection({ baseUrl: "https://api.example.com/v1///" })
		)
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "https://api.example.com/v1" })
		)
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: "https://api.example.com/v1" })
		)
	})

	test("falls back to the connection-type default (normalized) when baseUrl is unset", async () => {
		openAIConstructorMock.mockClear()
		modelsListMock.mockResolvedValue({ data: [] })
		await exportsDefault.listModels(makeConnection({ baseUrl: "" }))
		// The OpenAI Session connection type's own default baseUrl is "" (empty —
		// meaning "use the real OpenAI API," which the SDK does when baseURL
		// is undefined), so the resolved value should be undefined, not "".
		expect(openAIConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ baseURL: undefined })
		)
	})
})

describe("OpenAIChatAdapter.mapSamplingConfig()", () => {
	test("maps the keys the resolved config contains; an absent key is not sent", () => {
		const adapter = makeAdapter()
		// `sampling` arrives resolved: topP is absent rather than disabled,
		// because absence is the only way "switched off" is expressed now.
		adapter.sampling = {
			temperature: 0.7
		}
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
	})
})

describe("OpenAIChatAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

/**
 * Native reasoning on the OpenAI-compatible chat route.
 *
 * This adapter is not only "OpenAI" — it is the one people point at DeepSeek's
 * API, OpenRouter, vLLM, SGLang, TabbyAPI and Together, which is where most
 * reasoning models in actual use live. Mirrors the KoboldCPP suite's shape
 * (`KoboldCppAdapter.test.ts`), because the wire field is the same one.
 *
 * TWO field names, each earning its place:
 *   - `reasoning_content` — DeepSeek's own API field, and what SGLang, TabbyAPI,
 *     llama.cpp's `/v1/chat/completions` under `--reasoning-format deepseek` and
 *     KoboldCPP all emit. Older vLLM too.
 *   - `reasoning` — what vLLM emits since it followed OpenAI's gpt-oss guidance
 *     (vllm-project/vllm#27752), and OpenRouter's documented field.
 *
 * Read in that order, FIRST MATCH WINS: OpenRouter documents `reasoning_content`
 * as an alias of `reasoning`, so a backend that sends both is sending one
 * thought twice, and summing them would print it twice.
 */
describe("OpenAIChatAdapter — native reasoning readback", () => {
	function mockCompilePrompt(adapter: any) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	function streamOf(parts: any[]) {
		return (async function* () {
			for (const part of parts) yield part
		})()
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

	test("streaming: forwards delta.reasoning_content via thinkingCb, separately from content", async () => {
		createMock.mockReturnValueOnce(
			streamOf([
				{ choices: [{ delta: { reasoning_content: "Pondering" } }] },
				{ choices: [{ delta: { reasoning_content: " deeply." } }] },
				{ choices: [{ delta: { content: "Hello" } }] },
				{ choices: [{ delta: { content: " there." } }] }
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(content).toBe("Hello there.")
		expect(thinking).toBe("Pondering deeply.")
	})

	test("streaming: forwards delta.reasoning too — vLLM's current field, and OpenRouter's", async () => {
		createMock.mockReturnValueOnce(
			streamOf([
				{ choices: [{ delta: { reasoning: "Pondering" } }] },
				{ choices: [{ delta: { reasoning: " deeply." } }] },
				{ choices: [{ delta: { content: "Hello there." } }] }
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(content).toBe("Hello there.")
		expect(thinking).toBe("Pondering deeply.")
	})

	test("streaming: a delta carrying BOTH names yields the thought once, not twice", async () => {
		createMock.mockReturnValueOnce(
			streamOf([
				{
					choices: [
						{
							delta: {
								reasoning_content: "Pondering.",
								reasoning: "Pondering."
							}
						}
					]
				},
				{ choices: [{ delta: { content: "Hello." } }] }
			])
		)
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(content).toBe("Hello.")
		expect(thinking).toBe("Pondering.")
	})

	// Both wire modes, asserted rather than assumed — and here they genuinely
	// cannot differ: this adapter POSTs `/v1/chat/completions` in EITHER mode
	// (see the wire-mode docstring in the adapter, and the manifest's note on
	// what `wire_completion` means for this format). Completion wire changes
	// what the MODEL is shown — one flat prompt in a single user turn — not the
	// route, so the reasoning field comes back off the same delta and the same
	// message. Pinned, because the capability layer will read this claim.
	test("streaming: completion wire reads the same reasoning field — same route either way", async () => {
		createMock.mockReturnValueOnce(
			streamOf([
				{ choices: [{ delta: { reasoning_content: "Pondering." } }] },
				{ choices: [{ delta: { content: "Hello there." } }] }
			])
		)
		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { apiKey: "k", stream: true }
		})
		mockCompilePrompt(adapter)

		const { content, thinking } = await drain(await adapter.generateText())
		expect(thinking).toBe("Pondering.")
		expect(content).toBe("Hello there.")
	})

	test("non-streaming: completion wire populates thinkingContent too", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "Hello there.",
						reasoning_content: "Pondering."
					}
				}
			]
		})
		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { apiKey: "k", stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.thinkingContent).toBe("Pondering.")
	})

	test("non-streaming: populates thinkingContent from message.reasoning_content", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "Hello there.",
						reasoning_content: "Pondering deeply."
					}
				}
			]
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.thinkingContent).toBe("Pondering deeply.")
	})

	test("non-streaming: populates thinkingContent from message.reasoning", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "Hello there.",
						reasoning: "Pondering deeply."
					}
				}
			]
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.thinkingContent).toBe("Pondering deeply.")
	})

	test("non-streaming: thinkingContent is undefined when the response carries neither field", async () => {
		createMock.mockResolvedValueOnce({
			choices: [{ message: { content: "Hello there." } }]
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: false }
		})
		mockCompilePrompt(adapter)

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.thinkingContent).toBeUndefined()
	})
})

/**
 * How this adapter continues a partial reply — and where it will not pretend to.
 *
 * The route is derived from the connection's WIRE MODE and the type's own
 * declaration, never from a local flag: in completion wire the assembled prompt
 * already ends in an open assistant block, and in chat wire a trailing
 * `{role:"assistant"}` message is the chat template's business rather than a
 * prefill. Reporting `none` there is the point — the server refuses the verb
 * with this sentence rather than sending a request that looks like a
 * continuation and is not.
 */
describe("OpenAIChatAdapter — continuing a reply", () => {
	test("completion wire leaves the seed block open, so the route is that", () => {
		const adapter = makeAdapter({ wireMode: "completion" }) as any
		expect(adapter.continuationRoute.kind).toBe("openBlock")
	})

	test("chat wire reports UNSUPPORTED, with a reason a person can act on", () => {
		const adapter = makeAdapter({ wireMode: "chat" }) as any
		const route = adapter.continuationRoute
		expect(route.kind).toBe("none")
		expect(route.reason).toContain("Chat messages")
		expect(route.reason).toContain("Text completion")
		expect(route.reason).not.toContain("wire_")
	})
})
