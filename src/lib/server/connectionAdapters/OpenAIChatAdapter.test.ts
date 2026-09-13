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

function makeAdapter(
	connectionOverrides: Record<string, any> = {},
	// Already RESOLVED, the way an adapter receives it: a key being present is
	// the switch being on.
	sampling: Record<string, unknown> = {}
) {
	return new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		// Empty is what "the context budget is switched off" resolves to now:
		sampling,
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

/**
 * Native tool calling (20 §9) — the door `advertise-tools` opens with
 * `style: 'native'`.
 *
 * Two properties, and the second is the one that cannot fail loudly: the
 * declarations have to reach the request in the field THIS format calls them,
 * and a returned call has to come back as data rather than being left in the
 * prose for a parser to guess at.
 */
describe("OpenAIChatAdapter — tools on the wire", () => {
	const TOOLS = [
		{
			name: "search_entries",
			description: "Search the lorebook.",
			parameters: {
				type: "object",
				properties: { query: { type: "string" } }
			}
		}
	]

	test("sends the declarations as functions, and asks the model to choose", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "" } }]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		await adapter.generateText()

		const [params] = createMock.mock.calls.at(-1)!
		expect(params.tools).toEqual([
			{
				type: "function",
				function: {
					name: "search_entries",
					description: "Search the lorebook.",
					parameters: TOOLS[0]!.parameters
				}
			}
		])
		// Auto is what a tool loop means: the model decides whether this turn is
		// work or an answer, and the answer is how the loop ends.
		expect(params.tool_choice).toBe("auto")
	})

	test("a request with no tools carries no tools KEY, not an empty array", async () => {
		// Several servers behind this format reject `tools: []` outright and
		// others switch tool mode on for it, so every non-tool pipeline would
		// start paying for a feature it never asked for.
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()

		const [params] = createMock.mock.calls.at(-1)!
		expect("tools" in params).toBe(false)
		expect("tool_choice" in params).toBe(false)
	})

	test("reads the returned call off the structured field, arguments parsed", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: "Let me look.",
						tool_calls: [
							{
								function: {
									name: "search_entries",
									// A JSON **string** on this format.
									arguments: '{"query":"ashguard"}'
								}
							}
						]
					}
				}
			]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		const result = await adapter.generateText()

		expect(result.toolCall).toEqual({
			tool: "search_entries",
			args: { query: "ashguard" }
		})
		// The prose is still the prose — a call is not a reply.
		expect(result.completionResult).toBe("Let me look.")
	})

	test("unparseable arguments run the tool with none rather than losing the turn", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: "",
						tool_calls: [
							{
								function: {
									name: "search_entries",
									arguments: "{oops"
								}
							}
						]
					}
				}
			]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "x" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		const result = await adapter.generateText()
		expect(result.toolCall).toEqual({ tool: "search_entries", args: {} })
	})

	test("no call is null, not undefined — the loop's predicate reads it", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "Captain Vell." } }]
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "x" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		const result = await adapter.generateText()
		expect(result.toolCall).toBeNull()
	})
})

/**
 * The same call, off a STREAMING request (20 §9).
 *
 * A connection with `extraJson.stream` reached the branch above and surfaced no
 * call at all, so a tool loop's predicate never fired and every loop ran to its
 * ceiling. The deltas carry one fragment each — an index, the name once, and
 * `arguments` a few characters at a time — and the accumulated result must be
 * the shape the non-streaming branch produces, not a second spelling of it.
 */
describe("OpenAIChatAdapter — tool calls off the stream", () => {
	const TOOLS = [
		{
			name: "search_entries",
			description: "Search the lorebook.",
			parameters: {
				type: "object",
				properties: { query: { type: "string" } }
			}
		}
	]

	function streamOf(parts: any[]) {
		return (async function* () {
			for (const part of parts) yield part
		})()
	}

	const streamingAdapter = () => {
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: true }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		return adapter
	}

	/** Drive the stream the way `dispatchGeneration` does. */
	const drain = async (result: any) => {
		let content = ""
		await result.completionResult((chunk: string) => {
			content += chunk
		})
		return content
	}

	const delta = (toolCalls: any[], finish?: string) => ({
		choices: [
			{
				delta: { tool_calls: toolCalls },
				...(finish ? { finish_reason: finish } : {})
			}
		]
	})

	test("arguments split across chunks are concatenated, then parsed once", async () => {
		createMock.mockClear()
		createMock.mockReturnValueOnce(
			streamOf([
				{ choices: [{ delta: { content: "Let me look." } }] },
				delta([
					{
						index: 0,
						id: "call_1",
						function: { name: "search_entries", arguments: "" }
					}
				]),
				delta([{ index: 0, function: { arguments: '{"que' } }]),
				delta([{ index: 0, function: { arguments: 'ry":"ash' } }]),
				delta([{ index: 0, function: { arguments: 'guard"}' } }]),
				{ choices: [{ delta: {}, finish_reason: "tool_calls" }] }
			])
		)
		const adapter = streamingAdapter()
		const result = await adapter.generateText()
		// Read AFTER the drain, like the stop hit: a streaming adapter only
		// learns this while the caller is running the stream.
		expect(await drain(result)).toBe("Let me look.")
		expect(adapter.streamedToolCall).toEqual({
			tool: "search_entries",
			args: { query: "ashguard" }
		})
	})

	test("the first call only, even when the model asks for two", async () => {
		// The loop runs one tool per iteration and receipts it as one step —
		// the same rule the non-streaming branch states.
		createMock.mockClear()
		createMock.mockReturnValueOnce(
			streamOf([
				delta([
					{
						index: 0,
						function: {
							name: "search_entries",
							arguments: '{"query":"ashguard"}'
						}
					},
					{
						index: 1,
						function: {
							name: "grep_transcript",
							arguments: '{"text":"vell"}'
						}
					}
				]),
				{ choices: [{ delta: {}, finish_reason: "tool_calls" }] }
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toEqual({
			tool: "search_entries",
			args: { query: "ashguard" }
		})
	})

	test("unparseable accumulated arguments run the tool with none", async () => {
		createMock.mockClear()
		createMock.mockReturnValueOnce(
			streamOf([
				delta([{ index: 0, function: { name: "search_entries" } }]),
				delta([{ index: 0, function: { arguments: "{oops" } }]),
				{ choices: [{ delta: {}, finish_reason: "tool_calls" }] }
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toEqual({
			tool: "search_entries",
			args: {}
		})
	})

	test("a stream that called nothing leaves it null, not undefined", async () => {
		createMock.mockClear()
		createMock.mockReturnValueOnce(
			streamOf([
				{ choices: [{ delta: { content: "Captain Vell." } }] },
				{ choices: [{ delta: {}, finish_reason: "stop" }] }
			])
		)
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toBeNull()
	})
})

/**
 * The prompt cache, recorded (ruled "later, non-disruptive").
 *
 * RECORDED and nothing else: no request is reordered, no prefix is placed, no
 * cache control is sent. A number nobody can see is a number nobody can act on,
 * and the panel's row is the whole of the visible half.
 */
describe("OpenAIChatAdapter — prompt cache accounting", () => {
	const primed = () => {
		const adapter = makeAdapter({
			extraJson: { apiKey: "k", stream: false }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("reads cached_tokens off prompt_tokens_details, with the prompt total beside it", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }],
			usage: {
				prompt_tokens: 4096,
				completion_tokens: 12,
				prompt_tokens_details: { cached_tokens: 3072 }
			}
		})
		const result = await primed().generateText()
		expect(result.tokensPrompt).toBe(4096)
		expect(result.tokensCached).toBe(3072)
	})

	test("a service that reports usage but no cache detail stays undefined, never 0", async () => {
		// Absent and zero are different answers: "this connection does not say"
		// and "nothing was reused". A 0 here would be a fabrication.
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }],
			usage: { prompt_tokens: 100, completion_tokens: 5 }
		})
		const result = await primed().generateText()
		expect(result.tokensPrompt).toBe(100)
		expect(result.tokensCached).toBeUndefined()
	})
})

/**
 * The exchange, recorded for the run inspector.
 *
 * The stop record says what was composed; this says what this format called it
 * and what the service answered before anything was read out of it.
 */
describe("OpenAIChatAdapter — the exchange it records", () => {
	const primed = (overrides: Record<string, any> = {}) => {
		const adapter = makeAdapter(overrides)
		adapter.withStops({
			sent: [{ value: "<<END>>", kind: "explicit" }],
			dropped: [],
			wire: "chat"
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("records the endpoint, the body it built and the reply it read", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "Captain Vell." } }]
		})
		const adapter = primed()
		await adapter.generateText()
		const wire = adapter.lastExchange
		expect(wire, "the adapter recorded no exchange").toBeTruthy()
		expect(wire.request.url).toBe(
			"https://api.example.com/v1/chat/completions"
		)
		expect(wire.request.method).toBe("POST")
		expect(wire.request.body.messages).toEqual([
			{ role: "user", content: "who leads them?" }
		])
		expect(wire.request.body.stop).toEqual(["<<END>>"])
		expect(wire.response.raw).toContain("Captain Vell.")
		expect(wire.response.streamed).toBe(false)
	})

	test("the connection's key reaches no part of the record", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }]
		})
		const adapter = primed({
			extraJson: { apiKey: "sk-do-not-keep", stream: false }
		})
		await adapter.generateText()
		expect(JSON.stringify(adapter.lastExchange)).not.toContain(
			"sk-do-not-keep"
		)
	})

	test("a streamed generation records the frames it read", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue(
			(async function* () {
				yield { choices: [{ delta: { content: "Captain " } }] }
				yield { choices: [{ delta: { content: "Vell." } }] }
			})()
		)
		const adapter = primed({ extraJson: { apiKey: "k", stream: true } })
		const result = await adapter.generateText()
		await (result.completionResult as any)(() => {})
		const wire = adapter.lastExchange
		expect(wire.response.streamed).toBe(true)
		expect(wire.response.chunks).toBe(2)
		expect(wire.request.body.stream).toBe(true)
		expect(wire.response.raw).toContain("Vell.")
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * `auto` resolves to the CONNECTION's answer and nothing else: this adapter's
 * default is `|| false`, and widening an unset flag to true would change what
 * every untouched OpenAI-compatible connection sends. Read off
 * `completionResult`, because that is the fact the dispatch branches on — a
 * function is a stream to drain, a string is an answer already in hand.
 */
describe("OpenAIChatAdapter — the node's streaming parameter", () => {
	const sendWith = async (stream: boolean, mode?: "auto" | "off") => {
		createMock.mockReset()
		// Only the non-streaming branch reaches this: a streaming request
		// returns a closure and calls the SDK when somebody drains it.
		createMock.mockResolvedValue({
			choices: [{ message: { content: "hi" } }]
		})
		const adapter = makeAdapter({
			extraJson: { apiKey: "sk-test", stream }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
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
		// And the record says so: `stream` is a field on this format's body,
		// so a reader diagnosing the run sees the request that went out.
		expect((createMock.mock.calls[0]![0] as any).stream ?? false).toBe(
			false
		)
	})
})

/**
 * Reasoning, as a SAMPLING parameter (ruling 2026-09-12).
 *
 * Chat Completions takes an effort WORD and has no budget field, so the two
 * halves of the vocabulary land differently: one is translated, the other is
 * reported as unsendable.
 */
describe("OpenAIChatAdapter — reasoning on the wire", () => {
	async function requestFor(sampling: Record<string, unknown>) {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "ok" } }]
		})
		const adapter = makeAdapter({}, sampling)
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		return { req: createMock.mock.calls[0][0], adapter }
	}

	test("a config that never enabled it sends no key at all", async () => {
		// Today's bytes: the request is identical to the one this adapter sent
		// before the vocabulary had a word for reasoning.
		const { req, adapter } = await requestFor({ temperature: 0.5 })
		expect(req).not.toHaveProperty("reasoning_effort")
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("off is this format's own word for it, and is sent", async () => {
		const { req } = await requestFor({ reasoning: "off" })
		expect(req.reasoning_effort).toBe("none")
	})

	test("a level goes across as the level", async () => {
		for (const level of ["low", "medium", "high"] as const) {
			const { req } = await requestFor({ reasoning: level })
			expect(req.reasoning_effort).toBe(level)
		}
	})

	test("a budget has no field here, and says so", async () => {
		const { req, adapter } = await requestFor({
			reasoning: "high",
			reasoningBudget: 4096
		})
		expect(req.reasoning_effort).toBe("high")
		expect(req).not.toHaveProperty("reasoningBudget")
		expect(req).not.toHaveProperty("thinking")
		expect(adapter.ignoredSamplers).toEqual(["reasoningBudget"])
	})
})

/**
 * The reasoning half of what the model wrote, where the envelope breaks it out.
 *
 * A BREAKDOWN of `completion_tokens`, never an addition — a reader who sees a
 * 512-token cap produce forty words is looking at a reasoning budget, and this
 * is the only number that says so.
 */
describe("OpenAIChatAdapter — reasoning tokens", () => {
	test("completion_tokens_details.reasoning_tokens reaches the result", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "ok" } }],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 480,
				completion_tokens_details: { reasoning_tokens: 412 }
			}
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		const result = await adapter.generateText()
		expect(result.tokensCompletion).toBe(480)
		expect(result.tokensReasoning).toBe(412)
	})

	test("a service that does not break it out stays ABSENT, not zero", async () => {
		createMock.mockClear()
		createMock.mockResolvedValue({
			choices: [{ message: { content: "ok" } }],
			usage: { prompt_tokens: 120, completion_tokens: 480 }
		})
		const adapter = makeAdapter()
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		const result = await adapter.generateText()
		expect(result.tokensCompletion).toBe(480)
		expect(result.tokensReasoning).toBeUndefined()
	})
})
