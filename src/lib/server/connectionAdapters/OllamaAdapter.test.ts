import { describe, expect, test, vi } from "vitest"
import { composeStops } from "$lib/server/connections/stops"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"

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

const ollamaConstructorMock = vi.fn()
const listMock = vi.fn()
// `chat` is the Ollama SDK's own method name — the vendor surface, which the
// sessions rename never touches. Hoisted alongside `list` so a test can drive a
// real generation; the per-instance `vi.fn()`s could not be reached from here.
const chatMock = vi.fn()
const generateMock = vi.fn()
const showMock = vi.fn(async (_request: { model: string }): Promise<unknown> => ({}))
vi.mock("ollama", () => ({
	Ollama: class {
		list = (...args: any[]) => listMock(...args)
		show = (request: { model: string }) => showMock(request)
		chat = (...args: any[]) => chatMock(...args)
		generate = (...args: any[]) => generateMock(...args)
		abort = vi.fn()
		constructor(...args: any[]) {
			ollamaConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./OllamaAdapter")).default
const { ollamaModelModality, withShowCapabilities } = await import(
	"./OllamaAdapter"
)

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "ollama",
		baseUrl: "http://localhost:11434",
		model: "llama3",
		promptFormat: "vicuna",
		// Chat wire mode, stated the way an adapter receives it — `withWireMode`
		// attaches this where a connection is loaded. It used to be
		// `extraJson.useChat`, an adapter-local flag.
		wireMode: "chat",
		extraJson: { stream: false },
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
		systemPrompt: "Test system prompt.",
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}) as any
}

describe("OllamaAdapter — base URL trailing-slash normalization", () => {
	test("getClient() (used by generateText()) constructs Ollama with a normalized host", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "http://localhost:11434/" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})

	test("getClient() collapses multiple trailing slashes", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "http://localhost:11434///" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})

	test("getClient() passes host: undefined (not empty string) when baseUrl is unset", async () => {
		ollamaConstructorMock.mockClear()
		const adapter = makeAdapter({ baseUrl: "" })
		adapter.getClient()
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: undefined })
		)
	})

	test("listModels() also normalizes the host", async () => {
		ollamaConstructorMock.mockClear()
		listMock.mockResolvedValue({ models: [] })
		await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://localhost:11434/" })
		)
		expect(ollamaConstructorMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ host: "http://localhost:11434" })
		)
	})
})

describe("OllamaAdapter.mapSamplingConfig()", () => {
	test("maps the keys the resolved config contains, and never the 'streaming' key", () => {
		const adapter = makeAdapter()
		// `sampling` arrives resolved: topP is absent rather than disabled,
		// because absence is the only way "switched off" is expressed now.
		adapter.sampling = {
			temperature: 0.7,
			streaming: true
		}
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_p).toBeUndefined()
		expect(result.streaming).toBeUndefined()
	})
})

describe("OllamaAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

/**
 * The model's scratchpad, and the user's prompt, stay OUT of the server log.
 *
 * This adapter carried a diagnosis's leftovers: a first-stream-part dump that
 * printed a 50-character prefix of the thinking, a per-chunk "thinking chunk: N
 * chars", the same on the non-streaming paths, and — worst, and outside both
 * wire branches so it fired on every generation — `console.log("OllamaAdapter
 * generate mode request:", req)`, which put the WHOLE compiled prompt (system
 * prompt, character cards, lorebook, entire conversation) on stdout.
 *
 * A server log is shared, long-lived and frequently shipped somewhere else;
 * roleplay content and a model's private reasoning have no business in one.
 * These cases exist because that content arrived there through ordinary
 * debugging, and the next debugging session will be just as ordinary.
 */
describe("OllamaAdapter — generation writes nothing to the server log", () => {
	function mockCompilePrompt(adapter: any) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "Tell me a secret." }],
			meta: {} as any
		} as any)
	}

	test("non-streaming: neither the prompt nor the thinking is logged", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			chatMock.mockResolvedValueOnce({
				message: {
					content: "Hello there.",
					thinking: "Pondering deeply."
				}
			})
			const adapter = makeAdapter({
				wireMode: "chat",
				extraJson: { stream: false }
			})
			mockCompilePrompt(adapter)

			const result = await adapter.generateText()
			// The reasoning still reaches the CALLER — this is about where it
			// does not go, not about switching it off.
			expect(result.reasoningContent).toBe("Pondering deeply.")
			expect(logSpy).not.toHaveBeenCalled()
		} finally {
			logSpy.mockRestore()
		}
	})

	test("streaming: neither the prompt nor the thinking is logged", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			chatMock.mockReturnValueOnce(
				(async function* () {
					yield { message: { thinking: "Pondering deeply." } }
					yield { message: { content: "Hello there." } }
				})()
			)
			const adapter = makeAdapter({
				wireMode: "chat",
				extraJson: { stream: true }
			})
			mockCompilePrompt(adapter)

			const result = await adapter.generateText()
			let content = ""
			let reasoning = ""
			await (result.completionResult as any)(
				(chunk: string) => {
					content += chunk
				},
				(chunk: string) => {
					reasoning += chunk
				}
			)
			expect(content).toBe("Hello there.")
			expect(reasoning).toBe("Pondering deeply.")
			expect(logSpy).not.toHaveBeenCalled()
		} finally {
			logSpy.mockRestore()
		}
	})
})

/**
 * The two fields that decide whether the model sees what we rendered, and
 * whether its weights are still resident when the next turn arrives.
 *
 * Both were measured wrong against a real Ollama (Qwen2.5-14B):
 *
 *  - `/api/generate` went out with no `raw`, so Ollama wrapped the ChatML
 *    prompt this app had already rendered in the MODEL's own chat template —
 *    +8 tokens, and the open assistant seed block (`<|im_start|>assistant\n
 *    Echo: `) was closed and reopened, so the model re-emitted the speaker
 *    name it had already been given.
 *  - `keep_alive` fell back to `"300ms"`, so the weights unloaded after every
 *    turn: a 9 GB reload per message.
 *
 * `raw: true` also switches OFF Ollama's default stop handling, which is why
 * the first case asserts `options.stop` is populated as well — the template's
 * markers have to be ours on that branch, because nothing else supplies them.
 */
describe("OllamaAdapter — raw mode and keep_alive on the wire", () => {
	function mockCompilePrompt(adapter: any) {
		adapter.withCompiledPrompt({
			prompt: "### Instruction:\nhi\n\n### Response:\n",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	/** The request object the adapter actually handed to the Ollama SDK. */
	async function requestFor(overrides: Record<string, any>) {
		chatMock.mockClear()
		generateMock.mockClear()
		chatMock.mockResolvedValueOnce({ message: { content: "ok" } })
		generateMock.mockResolvedValueOnce({ response: "ok" })
		const connection = makeConnection(overrides)
		const adapter = makeAdapter(overrides)
		// The stop list arrives composed, the way a host hands it over — an
		// adapter builds none of its own (ruling 2026-09-10). Composed from the
		// connection rather than written out, so this stays an assertion about
		// the app's own resolution.
		adapter.withStops(
			composeStops({
				template:
					connection.completionTemplate ??
					promptFormatOf(connection.promptFormat),
				characters: [],
				personas: [],
				currentCharacterId: null,
				explicit: [],
				wire: overrides.wireMode ?? "completion"
			})
		)
		mockCompilePrompt(adapter)
		await adapter.generateText()
		const mock = overrides.wireMode === "chat" ? chatMock : generateMock
		expect(mock).toHaveBeenCalledTimes(1)
		return mock.mock.calls[0][0]
	}

	test("completion wire sets raw:true, and carries our own stop strings", async () => {
		const req = await requestFor({
			wireMode: "completion",
			extraJson: { stream: false }
		})
		expect(req.raw).toBe(true)
		// `raw: true` disables the server's default stop handling too, so the
		// template's markers must already be on the request.
		expect(Array.isArray(req.options.stop)).toBe(true)
		expect(req.options.stop.length).toBeGreaterThan(0)
	})

	test("chat wire sends no raw key — the server owns the template there", async () => {
		const req = await requestFor({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		expect("raw" in req).toBe(false)
	})

	test("keep_alive defaults to Ollama's own 5m on both wires", async () => {
		const completion = await requestFor({
			wireMode: "completion",
			extraJson: { stream: false }
		})
		expect(completion.keep_alive).toBe("5m")
		const chat = await requestFor({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		expect(chat.keep_alive).toBe("5m")
	})

	test("an explicit keepAlive on the connection still wins", async () => {
		const req = await requestFor({
			wireMode: "completion",
			extraJson: { stream: false, keepAlive: "60s" }
		})
		expect(req.keep_alive).toBe("60s")
	})
})

/**
 * Native tool calling (20 §9). Ollama's tools ride `ollama.chat()` and nothing
 * else — `ollama.generate()` takes a flat prompt and has no field for them, so
 * a completion-wire request carrying tools is a wiring mistake `dispatch.ts`
 * refuses rather than a request this adapter sends stripped.
 */
describe("OllamaAdapter — tools on the wire", () => {
	const TOOLS = [
		{
			name: "grep_transcript",
			description: "Find where a phrase was said.",
			parameters: {
				type: "object",
				properties: { text: { type: "string" } }
			}
		}
	]

	/**
	 * ⚠ `mockReset`, not `mockClear`.
	 *
	 * `requestFor` above queues a response on BOTH `chatMock` and
	 * `generateMock` and consumes one, so the other stays queued — and
	 * `mockClear` empties the call list while leaving that queue alone. A test
	 * that only cleared would be handed an earlier test's leftover reply and
	 * would be asserting about a response it never wrote.
	 */
	const primeChat = (response: unknown) => {
		chatMock.mockReset()
		chatMock.mockResolvedValue(response)
	}

	const chatAdapter = () => {
		const adapter = makeAdapter({ wireMode: "chat" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("sends the declarations on the chat request", async () => {
		primeChat({ message: { content: "ok" } })
		const adapter = chatAdapter()
		adapter.withTools(TOOLS)
		await adapter.generateText()

		const req = chatMock.mock.calls[0]![0]
		expect(req.tools).toEqual([
			{
				type: "function",
				function: {
					name: "grep_transcript",
					description: "Find where a phrase was said.",
					parameters: TOOLS[0]!.parameters
				}
			}
		])
	})

	test("a request with no tools carries no tools key", async () => {
		// Present-but-empty renders a tool preamble into the model's own
		// template, which every non-tool pipeline would then pay for.
		primeChat({ message: { content: "ok" } })
		await chatAdapter().generateText()
		expect("tools" in chatMock.mock.calls[0]![0]).toBe(false)
	})

	test("reads the returned call off message.tool_calls", async () => {
		primeChat({
			message: {
				content: "Looking.",
				tool_calls: [
					{
						function: {
							name: "grep_transcript",
							// Already an object on this SDK, unlike OpenAI's
							// JSON string — the normalizer takes either.
							arguments: { text: "ashguard" }
						}
					}
				]
			}
		})
		const adapter = chatAdapter()
		adapter.withTools(TOOLS)
		const result = await adapter.generateText()

		expect(result.toolCall).toEqual({
			tool: "grep_transcript",
			args: { text: "ashguard" }
		})
		expect(result.completionResult).toBe("Looking.")
	})

	test("no call is null — the loop's predicate reads it", async () => {
		chatMock.mockClear()
		chatMock.mockResolvedValueOnce({
			message: { content: "Captain Vell." }
		})
		const adapter = chatAdapter()
		adapter.withTools(TOOLS)
		expect((await adapter.generateText()).toolCall).toBeNull()
	})
})

test("completion wire cannot carry tools, and says so rather than dropping them", () => {
	// `ollama.generate()` has no tools field. Answering `true` here would let
	// the dispatch's check pass and the declarations vanish one branch later.
	const chat = makeAdapter({ wireMode: "chat" })
	const completion = makeAdapter({ wireMode: "completion" })
	expect(chat.consumesTools).toBe(true)
	expect(completion.consumesTools).toBe(false)
})

/**
 * The same call, off a STREAMING request (20 §9).
 *
 * A connection with `extraJson.stream` never reached the read above, so it
 * surfaced no call, the loop's predicate never fired, and every tool loop ran to
 * its ceiling. This SDK does not fragment its arguments the way OpenAI's does —
 * they arrive as an object, in one part — but they arrive on a delta all the
 * same, and the accumulated result must be the shape the non-streaming branch
 * produces rather than a second spelling of it.
 */
describe("OllamaAdapter — tool calls off the stream", () => {
	const TOOLS = [
		{
			name: "grep_transcript",
			description: "Find where a phrase was said.",
			parameters: {
				type: "object",
				properties: { text: { type: "string" } }
			}
		}
	]

	/** ⚠ `mockReset`, not `mockClear` — see `primeChat` above for why. */
	const primeChatStream = (parts: any[]) => {
		chatMock.mockReset()
		chatMock.mockResolvedValue(
			(async function* () {
				for (const part of parts) yield part
			})()
		)
	}

	const streamingAdapter = () => {
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: true }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		adapter.withTools(TOOLS)
		return adapter
	}

	const drain = async (result: any) => {
		let content = ""
		await result.completionResult((chunk: string) => {
			content += chunk
		})
		return content
	}

	test("reads the call off a message delta, keeping the prose that streamed with it", async () => {
		primeChatStream([
			{ message: { content: "Looking." } },
			{
				message: {
					content: "",
					tool_calls: [
						{
							function: {
								name: "grep_transcript",
								arguments: { text: "ashguard" }
							}
						}
					]
				}
			},
			{ message: { content: "" }, done: true }
		])
		const adapter = streamingAdapter()
		const result = await adapter.generateText()
		expect(await drain(result)).toBe("Looking.")
		expect(adapter.streamedToolCall).toEqual({
			tool: "grep_transcript",
			args: { text: "ashguard" }
		})
	})

	test("a stream that called nothing leaves it null, not undefined", async () => {
		primeChatStream([{ message: { content: "Captain Vell." } }])
		const adapter = streamingAdapter()
		await drain(await adapter.generateText())
		expect(adapter.streamedToolCall).toBeNull()
	})
})

/**
 * The prompt cache, recorded (ruled "later, non-disruptive").
 *
 * Ollama reports `prompt_eval_count` and NOTHING about reuse — it re-evaluates
 * only what its own KV cache missed and never says how much that was. So the
 * prompt total is recorded and the cached count stays absent, which is a
 * different answer from zero and the only honest one available here.
 */
describe("OllamaAdapter — prompt cache accounting", () => {
	const primeChat = (response: unknown) => {
		chatMock.mockReset()
		chatMock.mockResolvedValue(response)
	}

	const primed = () => {
		const adapter = makeAdapter({ wireMode: "chat" })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "hello" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("records prompt_eval_count as the prompt total and claims nothing about reuse", async () => {
		primeChat({ message: { content: "hi" }, prompt_eval_count: 512 })
		const result = await primed().generateText()
		expect(result.tokensPrompt).toBe(512)
		expect(result.tokensCached).toBeUndefined()
	})
})

/**
 * The exchange, recorded for the run inspector.
 *
 * The receipt carries the assembled prompt and the stop record; what it cannot
 * otherwise carry is what this adapter rendered that into and what came back
 * before anything was parsed out of it. Both halves are asserted here because
 * either alone leaves the reader reaching for a proxy.
 */
describe("OllamaAdapter — the exchange it records", () => {
	const primed = (overrides: Record<string, any> = {}) => {
		const adapter = makeAdapter({ wireMode: "chat", ...overrides })
		adapter.withStops(
			composeStops({
				template: promptFormatOf("vicuna"),
				characters: [],
				personas: [],
				currentCharacterId: null,
				explicit: ["<<END>>"],
				wire: "chat"
			})
		)
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
			meta: {} as any
		} as any)
		return adapter
	}

	test("a chat generation records the request it sent and the reply it read", async () => {
		chatMock.mockReset()
		chatMock.mockResolvedValue({ message: { content: "Captain Vell." } })
		const adapter = primed()
		await adapter.generateText()
		const wire = adapter.lastExchange
		expect(wire, "the adapter recorded no exchange").toBeTruthy()
		expect(wire.request.url).toBe("http://localhost:11434/api/chat")
		expect(wire.request.method).toBe("POST")
		expect(wire.request.body.messages).toEqual([
			{ role: "user", content: "who leads them?" }
		])
		expect(wire.request.body.options.stop).toEqual(["<<END>>"])
		expect(wire.response.raw).toContain("Captain Vell.")
		expect(wire.response.streamed).toBe(false)
		expect(wire.response.truncated).toBeUndefined()
	})

	test("a streamed generation records every frame, in order", async () => {
		chatMock.mockReset()
		chatMock.mockResolvedValue(
			(async function* () {
				yield { message: { content: "Captain " } }
				yield { message: { content: "Vell." } }
			})()
		)
		const adapter = primed({ extraJson: { stream: true } })
		const result = await adapter.generateText()
		await result.completionResult(() => {})
		const wire = adapter.lastExchange
		expect(wire.response.streamed).toBe(true)
		expect(wire.response.chunks).toBe(2)
		expect(wire.response.raw).toContain("Captain ")
		expect(wire.response.raw).toContain("Vell.")
	})

	test("a reply past the cap is kept to 64 KB and says so", async () => {
		const { WIRE_RAW_LIMIT } = await import("./BaseConnectionAdapter")
		chatMock.mockReset()
		chatMock.mockResolvedValue({
			message: { content: "y".repeat(70 * 1024) }
		})
		const adapter = primed()
		await adapter.generateText()
		expect(adapter.lastExchange.response.raw.length).toBe(WIRE_RAW_LIMIT)
		expect(adapter.lastExchange.response.truncated).toBe(true)
	})

	test("a key on the connection reaches no part of the record", async () => {
		chatMock.mockReset()
		chatMock.mockResolvedValue({ message: { content: "hi" } })
		const adapter = primed({
			extraJson: { stream: false, apiKey: "sk-do-not-keep" }
		})
		await adapter.generateText()
		expect(JSON.stringify(adapter.lastExchange)).not.toContain(
			"sk-do-not-keep"
		)
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * `auto` must resolve to the CONNECTION's answer and nothing else: this
 * adapter's default is `|| false`, and a parameter that widened an unset flag
 * to true would change what every untouched Ollama connection sends. `off` is
 * the only value that overrides, and what it overrides is the flag, not the
 * shape of the reply — a non-streaming result is still a whole answer.
 *
 * Read off `completionResult`, because that is the fact the dispatch branches
 * on: a function is a stream to drain, a string is an answer already in hand.
 */
describe("OllamaAdapter — the node's streaming parameter", () => {
	const sendWith = async (stream: boolean, mode?: "auto" | "off") => {
		chatMock.mockReset()
		chatMock.mockResolvedValue({ message: { content: "ok" } })
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream }
		})
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [{ role: "user", content: "who leads them?" }],
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
 * `think` is the one field, and it takes a boolean on every model but the
 * gpt-oss family, which takes the level word itself. What a level could not
 * carry is recorded rather than lost, which is the half no request body can
 * show: an absent field and a field that was never asked for look identical.
 */
describe("OllamaAdapter — reasoning on the wire", () => {
	async function requestFor(
		sampling: Record<string, unknown>,
		connectionOverrides: Record<string, any> = {}
	) {
		chatMock.mockClear()
		chatMock.mockResolvedValueOnce({ message: { content: "ok" } })
		const adapter = makeAdapter(
			{ wireMode: "chat", ...connectionOverrides },
			sampling
		)
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		return { req: chatMock.mock.calls[0][0], adapter }
	}

	test("a config that never enabled it sends no `think` key at all", async () => {
		// Not `think: false`. The field is a real instruction to a thinking
		// model, so a config that did not ask has to leave the request silent
		// on it. `extraJson.think`, which used to answer here, is read by
		// nothing since the ruling of 2026-09-12.
		const off = await requestFor({}, { extraJson: { stream: false } })
		expect(off.req).not.toHaveProperty("think")
		expect(off.adapter.ignoredSamplers).toEqual([])

		const stale = await requestFor(
			{},
			{ extraJson: { stream: false, think: true } }
		)
		expect(stale.req).not.toHaveProperty("think")
	})

	test("off is asked for explicitly, and is the only way to get it", async () => {
		const { req } = await requestFor(
			{ reasoning: "off" },
			{ extraJson: { stream: false, think: true } }
		)
		expect(req.think).toBe(false)
	})

	test("a level is a word on gpt-oss and a boolean everywhere else", async () => {
		const oss = await requestFor(
			{ reasoning: "high" },
			{
				model: "gpt-oss:20b"
			}
		)
		expect(oss.req.think).toBe("high")
		expect(oss.adapter.ignoredSamplers).toEqual([])

		// A level sent to anything else is a 400, so it becomes plain "on" and
		// the lost precision is recorded.
		const llama = await requestFor(
			{ reasoning: "low" },
			{
				model: "llama3"
			}
		)
		expect(llama.req.think).toBe(true)
		expect(llama.adapter.ignoredSamplers).toContain("reasoning")
	})

	test("a budget has no field here at all, and says so", async () => {
		const { req, adapter } = await requestFor(
			{ reasoning: "medium", reasoningBudget: 4096 },
			{ model: "gpt-oss:20b" }
		)
		expect(req.think).toBe("medium")
		expect(req).not.toHaveProperty("reasoning_budget")
		expect(adapter.ignoredSamplers).toContain("reasoningBudget")
	})

	test("the sampler never reaches `options` — `think` is top-level", async () => {
		const { req } = await requestFor({
			reasoning: "off",
			temperature: 0.4
		})
		expect(req.options).not.toHaveProperty("think")
		expect(req.options.temperature).toBe(0.4)
	})
})

describe("what a listed Ollama model is for", () => {
	test("embedding without completion is an embedding model", () => {
		expect(ollamaModelModality({ capabilities: ["embedding"] })).toBe("embeddings")
	})

	test("completion without embedding is a text model, vision and tools included", () => {
		expect(
			ollamaModelModality({ capabilities: ["completion", "tools", "vision"] })
		).toBe("text-gen")
	})

	test("both, neither, or an older Ollama that sends no array says nothing", () => {
		expect(ollamaModelModality({ capabilities: ["completion", "embedding"] })).toBeUndefined()
		expect(ollamaModelModality({ capabilities: [] })).toBeUndefined()
		expect(ollamaModelModality({ name: "llama3" })).toBeUndefined()
		expect(ollamaModelModality(null)).toBeUndefined()
	})
})

// ── Images per message (PLAN-composer-attachments §3.6) ─────────────────────
describe("OllamaAdapter — images on the chat wire", () => {
	test("declares that it sends them", () => {
		expect(makeAdapter({}).consumesAttachments).toBe(true)
	})

	test("a turn's image rides /api/chat as base64 in that message's images", async () => {
		chatMock.mockClear()
		chatMock.mockResolvedValueOnce({ message: { content: "ok" } })
		const png = Buffer.from("png bytes of a cat")
		const adapter = makeAdapter({ wireMode: "chat", extraJson: { stream: false } })
		adapter.withCompiledPrompt({
			prompt: undefined,
			messages: [
				{ role: "user", content: "Ash: my cat" },
				{ role: "assistant", content: "Mara:" }
			],
			meta: {} as any
		} as any)
		adapter.withMessageAttachments([[{ bytes: png, mime: "image/png" }], []])
		await adapter.generateText()
		const req = chatMock.mock.calls[0][0]
		expect(req.messages[0]).toEqual({
			role: "user",
			content: "Ash: my cat",
			images: [png.toString("base64")]
		})
		expect(req.messages[1]).toEqual({ role: "assistant", content: "Mara:" })
	})
})

describe("the listing asks /api/show for each model's capabilities", () => {
	test("copies `capabilities` onto each entry, so vision and modality reach the sync", async () => {
		listMock.mockResolvedValue({
			models: [
				{ model: "qwen2.5vl:7b", name: "qwen2.5vl:7b", details: {} },
				{ model: "nomic-embed-text", name: "nomic-embed-text", details: {} }
			]
		})
		showMock.mockImplementation(async ({ model }: any) => ({
			capabilities:
				model === "qwen2.5vl:7b" ? ["completion", "vision"] : ["embedding"]
		}))
		const { models } = await exportsDefault.listModels(makeConnection())
		expect(models[0]).toMatchObject({
			capabilities: ["completion", "vision"],
			modality: "text-gen"
		})
		expect(models[1]).toMatchObject({
			capabilities: ["embedding"],
			modality: "embeddings"
		})
		showMock.mockReset()
		showMock.mockImplementation(async (_request: { model: string }) => ({}))
	})

	test("leaves an entry that already carries the list alone, and a failed show silent", async () => {
		const show = vi.fn(async ({ model }: any) => {
			if (model === "broken") throw new Error("model not found")
			return { capabilities: ["completion"] }
		})
		const out = await withShowCapabilities({ show }, [
			{ model: "a", capabilities: ["completion", "vision"] },
			{ model: "broken" },
			{ model: "b" }
		])
		expect(show).toHaveBeenCalledTimes(2)
		expect(out[0].capabilities).toEqual(["completion", "vision"])
		expect(out[1]).toEqual({ model: "broken" })
		expect(out[2].capabilities).toEqual(["completion"])
	})

	test("stops asking once the total budget is spent, so the sync's own timeout is never hit", async () => {
		let clock = 0
		const show = vi.fn(async () => {
			clock += 9_000 // past the 8 s budget on the first answer
			return { capabilities: ["completion"] }
		})
		const out = await withShowCapabilities(
			{ show },
			Array.from({ length: 10 }, (_, i) => ({ model: `m${i}` })),
			() => clock
		)
		// The first show spends the budget; no worker starts another after it.
		expect(show).toHaveBeenCalledTimes(1)
		expect(out.filter((m) => m.capabilities).length).toBe(1)
		expect(out).toHaveLength(10)
	})
})
