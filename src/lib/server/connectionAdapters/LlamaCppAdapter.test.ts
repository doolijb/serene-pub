import { describe, expect, test, vi } from "vitest"
import axios from "axios"

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
vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		CancelToken: { source: () => ({ token: "token", cancel: vi.fn() }) },
		isCancel: () => false
	}
}))

const exportsDefault = (await import("./LlamaCppAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		// The SERVICE id. It was `llamacpp_completion` — the one type id that
		// encoded a wire mode — until the ruling that a type names a service and
		// the wire is a capability; `drizzle/0105_llamacpp_service_type.sql`
		// carries existing rows over.
		//
		// ⚠ No `wireMode` here on purpose, so these cases exercise the FALLBACK:
		// `wireModeFor` reads the type's declaration and answers `completion`,
		// which is what every row this rename touched was already being called
		// by. A type the manifest does not know falls through to `chat` instead
		// — which is how a stale id would silently change the endpoint, and why
		// the rename needed a migration rather than a code-only edit.
		type: "llamacpp",
		baseUrl: "http://localhost:8080",
		model: "",
		promptFormat: "vicuna",
		extraJson: {},
		...overrides
	}
}

describe("LlamaCppAdapter — base URL trailing-slash normalization", () => {
	test("testConnection() hits the same URL whether baseUrl has a trailing slash or not", async () => {
		vi.mocked(axios.get).mockResolvedValue({ data: { status: "ok" } })

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://localhost:8080" })
		)
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)

		await exportsDefault.testConnection(
			makeConnection({ baseUrl: "http://localhost:8080/" })
		)
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)
	})

	test("testConnection() falls back to the documented default when baseUrl is unset", async () => {
		vi.mocked(axios.get).mockResolvedValue({ data: { status: "ok" } })
		await exportsDefault.testConnection(makeConnection({ baseUrl: "" }))
		expect(axios.get).toHaveBeenLastCalledWith(
			"http://localhost:8080/health"
		)
	})

	test("testConnection() reports a network error", async () => {
		vi.mocked(axios.get).mockRejectedValue(
			new Error("connect ECONNREFUSED")
		)
		const result = await exportsDefault.testConnection(makeConnection())
		expect(result.ok).toBe(false)
		expect(result.error).toContain("ECONNREFUSED")
	})

	test("listModels() hits the normalized URL and reports the loaded model", async () => {
		vi.mocked(axios.get).mockResolvedValue({
			data: { model: "some-model.gguf" }
		})
		const result = await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://localhost:8080///" })
		)
		expect(axios.get).toHaveBeenLastCalledWith("http://localhost:8080/show")
		expect(result.models[0].model).toBe("some-model.gguf")
	})
})

describe("LlamaCppAdapter.mapSamplingConfig()", () => {
	// `sampling` arrives already resolved, so a switched-off sampler reaches the
	// adapter as an absent key — omission is the only "off" there is.
	test("maps known sampling keys, skipping omitted ones", async () => {
		// LlamaCppAdapter isn't a named export — build an adapter via the
		// exported class on the AdapterExports object instead.
		const adapter = new exportsDefault.Adapter({
			connection: makeConnection(),
			sampling: { temperature: 0.7 } as any,
			contextConfig: {} as any,
			promptConfig: { systemPrompt: "Test" } as any,
			session: {
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
			} as any,
			currentCharacterId: null,
			tokenCounter: { countTokens: async () => 1 } as any,
			tokenLimit: 4096,
			contextThresholdPercent: 0.9
		}) as any

		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.7)
		expect(result.top_k).toBeUndefined()
	})
})

describe("LlamaCppAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(typeof exportsDefault.Adapter).toBe("function")
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

/**
 * Why the NATIVE route has no reasoning FIELD — and why that is not the same as
 * having no reasoning.
 *
 * A CHARACTERIZATION test, not a red-green one: nothing changed in the adapter,
 * and these cases passed before the reasoning work as they do after it. They
 * exist to pin the fact behind that — so the next person to look for the
 * missing `thinkingContent` finds the reason here instead of adding a
 * plausible-looking key that no llama.cpp build ever sends.
 *
 * The route is the whole of it. In COMPLETION wire mode this adapter posts
 * llama.cpp's NATIVE `POST /completion`, and that endpoint has no reasoning
 * field: the server README's response-field list omits `reasoning_content`, and
 * `to_json_non_oaicompat()` — the serializer behind it, for both the final and
 * the partial result — never sets that key. `--reasoning-format` and
 * `chat_template_kwargs.enable_thinking` are `/v1/chat/completions` features,
 * and `/completion` runs no chat template at all. (The chat leg, which DOES
 * carry the field, is the describe block below this one.)
 *
 * ⚠ But the reasoning is NOT lost, and a capability declaration must not say
 * it is. `to_json_non_oaicompat()` serializes the raw accumulated text —
 * `common_chat_parse()` and the `oaicompat_msg` carrying `reasoning_content`
 * are read only by the OAI-compat serializers — so the `<think>` tags arrive
 * INLINE in `content`, unstripped, exactly as the model wrote them. Both cases
 * below assert that inline text verbatim, because that is the contract the
 * shared inline-tag parser consumes. "No field for this route to read" is
 * the finding; "this connection cannot reason" would be false.
 */
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
	const adapter = new exportsDefault.Adapter({
		connection: makeConnection(connectionOverrides),
		sampling: sampling as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "Test system prompt." } as any,
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 2048,
		contextThresholdPercent: 0.9
	}) as any
	// BOTH shapes on the payload, so which one goes on the wire is decided by
	// the connection's wire mode alone — a fixture carrying only one would let
	// the branch look right for the wrong reason.
	adapter.withCompiledPrompt({
		prompt: "hi",
		messages: [{ role: "user", content: "hi" }],
		meta: {} as any
	} as any)
	return adapter
}

describe("LlamaCppAdapter — reasoning arrives inline, with no field to read", () => {
	test("non-streaming: posts /completion — the route with no reasoning field — and reports no thinkingContent", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			// Everything `/completion` actually returns for a thinking model:
			// the tags stay in `content`, and there is no sibling field.
			data: { content: "<think>Pondering.</think>Hello there." }
		})
		const adapter = makeAdapter({ extraJson: { stream: false } })

		const result = await adapter.generateText()
		expect(vi.mocked(axios.post).mock.calls.at(-1)?.[0]).toBe(
			"http://localhost:8080/completion"
		)
		expect(result.completionResult).toBe(
			"<think>Pondering.</think>Hello there."
		)
		expect(result.thinkingContent).toBeUndefined()
	})

	test("streaming: the SSE chunks carry content only, and thinkingCb is never called", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: [
				'data: {"content":"<think>Pondering.</think>"}\n',
				'data: {"content":"Hello there."}\n'
			]
		})
		const adapter = makeAdapter({ extraJson: { stream: true } })

		const result = await adapter.generateText()
		let content = ""
		const thinkingCb = vi.fn()
		expect(typeof result.completionResult).toBe("function")
		await (result.completionResult as any)((chunk: string) => {
			content += chunk
		}, thinkingCb)

		expect(vi.mocked(axios.post).mock.calls.at(-1)?.[0]).toBe(
			"http://localhost:8080/completion"
		)
		expect(content).toBe("<think>Pondering.</think>Hello there.")
		expect(thinkingCb).not.toHaveBeenCalled()
	})
})

/**
 * The chat leg — llama-server's OpenAI-compatible route, reached by the same
 * type.
 *
 * `llamacpp_completion` was the one connection type id that encoded a WIRE
 * MODE, and the way to use llama-server's chat API was an `openai` connection
 * pointed at the same process — which quietly dropped every native sampler the
 * OpenAI shape has no field for (`n_probs`, `samplers`, `cache_prompt`,
 * `t_max_predict_ms`). The type names the SERVICE now and the wire is a
 * capability, so both legs are reachable from one row.
 *
 * Every case here states `wireMode` the way an adapter receives it —
 * `withWireMode` attaches it where the connection is LOADED — which is the same
 * fixture idiom `OllamaAdapter.test.ts` uses.
 */
describe("LlamaCppAdapter — chat wire mode", () => {
	test("non-streaming: posts /v1/chat/completions with the MESSAGES, not a prompt", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: {
				choices: [{ message: { content: "Hello there." } }]
			}
		})
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})

		const result = await adapter.generateText()
		const [url, body] = vi.mocked(axios.post).mock.calls.at(-1)!
		expect(url).toBe("http://localhost:8080/v1/chat/completions")
		expect((body as any).messages).toEqual([
			{ role: "user", content: "hi" }
		])
		// The mutation that matters: a `prompt` key here would mean the flat
		// string went out beside the messages, which is the payload/endpoint
		// disagreement wire mode exists to close.
		expect(body).not.toHaveProperty("prompt")
		expect(result.completionResult).toBe("Hello there.")
	})

	test("non-streaming: reads reasoning_content — the field the native route does not have", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: {
				choices: [
					{
						message: {
							content: "Hello there.",
							reasoning_content: "Pondering."
						}
					}
				]
			}
		})
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})

		const result = await adapter.generateText()
		expect(result.completionResult).toBe("Hello there.")
		expect(result.thinkingContent).toBe("Pondering.")
	})

	test("streaming: reads the OpenAI delta envelope and its sibling reasoning field", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: [
				'data: {"choices":[{"delta":{"reasoning_content":"Pondering."}}]}\n',
				'data: {"choices":[{"delta":{"content":"Hello "}}]}\n',
				'data: {"choices":[{"delta":{"content":"there."}}]}\n',
				// ⚠ The sentinel, verbatim. It is not JSON; parsing it throws
				// into the swallowing catch, so a build that did not skip it
				// would look identical here — which is why it is in the fixture
				// rather than trusted to be harmless.
				"data: [DONE]\n"
			]
		})
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: true }
		})

		const result = await adapter.generateText()
		let content = ""
		let thinking = ""
		await (result.completionResult as any)(
			(chunk: string) => {
				content += chunk
			},
			(chunk: string) => {
				thinking += chunk
			}
		)
		expect(vi.mocked(axios.post).mock.calls.at(-1)?.[0]).toBe(
			"http://localhost:8080/v1/chat/completions"
		)
		expect(content).toBe("Hello there.")
		expect(thinking).toBe("Pondering.")
	})

	test("does not put the completion template's stop strings on the chat leg", async () => {
		// The same considered omission `OpenAIChatAdapter` documents: in chat
		// mode the roles carry the structure, so the completion template's role
		// labels have nothing to stop on — and sending them OVERRIDES the
		// model's native stop tokens, truncating replies for no gain. The
		// completion leg below still sends them. (`sampling` is empty in this
		// fixture, so the only `stop` that could appear is the template's.)
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: { choices: [{ message: { content: "ok" } }] }
		})
		const chat = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		await chat.generateText()
		expect(vi.mocked(axios.post).mock.calls.at(-1)?.[1]).not.toHaveProperty(
			"stop"
		)

		vi.mocked(axios.post).mockResolvedValueOnce({ data: { content: "ok" } })
		const completion = makeAdapter({
			wireMode: "completion",
			extraJson: { stream: false }
		})
		await completion.generateText()
		expect(
			(vi.mocked(axios.post).mock.calls.at(-1)?.[1] as any).stop
		).toBeInstanceOf(Array)
	})

	test("refuses a completion-shaped payload rather than sending an empty conversation", async () => {
		// `compiledPrompt.messages!` on a flat payload sends `undefined`,
		// `JSON.stringify` drops the key, and llama-server is asked to continue
		// a conversation it was never shown. The same refusal Ollama and
		// KoboldCPP raise, for the same reason — and deliberately NOT a
		// fallback to `promptTextFor`, which would put an adapter-local wire
		// mode back.
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		adapter.withCompiledPrompt({ prompt: "hi", meta: {} as any } as any)
		await expect(adapter.generateText()).rejects.toThrow(
			/chat wire mode, but the prompt it was handed carries no messages/
		)
	})

	test("structured output goes out as response_format, not as a GBNF grammar", async () => {
		// The OpenAI-compatible route speaks `response_format` and converts the
		// schema to GBNF itself; `grammar` is the NATIVE endpoint's field. A
		// build that sent the completion branch's key here would generate
		// unconstrained text and report success.
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: { choices: [{ message: { content: "{}" } }] }
		})
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		// A public field on the base class, set directly — the same way every
		// caller that wants JSON sets it.
		adapter.responseFormat = "json"
		await adapter.generateText()
		const body = vi.mocked(axios.post).mock.calls.at(-1)?.[1] as any
		expect(body.response_format).toEqual({ type: "json_object" })
		expect(body).not.toHaveProperty("grammar")
	})
})

/**
 * The prompt cache, recorded (ruled "later, non-disruptive").
 *
 * llama.cpp is the one server here that reports the reused PREFIX directly,
 * though not under a field of that name: `tokens_evaluated` is the whole prompt
 * and `timings.prompt_n` is the part of it this request actually pushed through
 * the model, so the difference is what its KV cache already held.
 *
 * ⚠ **Not `tokens_cached`.** That field is the slot's cache size AFTER the
 * request — prompt and generated tokens together — so reading it as the reused
 * prefix would report a number larger than the prompt on any second turn.
 */
describe("LlamaCppAdapter — prompt cache accounting", () => {
	test("the reused prefix is the prompt total minus what was evaluated", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: {
				content: "Hello there.",
				tokens_evaluated: 4096,
				tokens_cached: 4108,
				timings: { prompt_n: 1024, predicted_n: 12 }
			}
		})
		const adapter = makeAdapter({ extraJson: { stream: false } })

		const result = await adapter.generateText()
		expect(result.tokensPrompt).toBe(4096)
		expect(result.tokensCached).toBe(3072)
	})

	test("a response with no timings claims nothing about reuse", async () => {
		// Absent, never zero: "this server did not say" and "nothing was
		// reused" are different answers and only one of them is true here.
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: { content: "Hello there.", tokens_evaluated: 4096 }
		})
		const adapter = makeAdapter({ extraJson: { stream: false } })

		const result = await adapter.generateText()
		expect(result.tokensPrompt).toBe(4096)
		expect(result.tokensCached).toBeUndefined()
	})

	test("a full re-evaluation reports zero reused, which is not the same as absent", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: {
				content: "Hello there.",
				tokens_evaluated: 900,
				timings: { prompt_n: 900 }
			}
		})
		const adapter = makeAdapter({ extraJson: { stream: false } })

		const result = await adapter.generateText()
		expect(result.tokensCached).toBe(0)
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * `auto` resolves to the CONNECTION's answer and nothing else: this adapter's
 * default is `|| false`, and widening an unset flag to true would change what
 * every untouched llama.cpp connection sends. Read off `completionResult`,
 * because that is the fact the dispatch branches on — a function is a stream to
 * drain, a string is an answer already in hand.
 */
describe("LlamaCppAdapter — the node's streaming parameter", () => {
	const sendWith = async (stream: boolean, mode?: "auto" | "off") => {
		// Only the non-streaming branch reaches this: a streaming request
		// returns a closure and POSTs when somebody drains it.
		vi.mocked(axios.post).mockResolvedValue({
			data: { content: "Hello there." }
		})
		const adapter = makeAdapter({ extraJson: { stream } })
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
		// And the record says so: `stream` is a field on this format's body.
		expect(vi.mocked(axios.post).mock.calls.at(-1)?.[1]).toMatchObject({
			stream: false
		})
	})
})

/**
 * Reasoning, as a SAMPLING parameter (ruling 2026-09-12).
 *
 * llama-server splits the question the way its own flags do — a token budget
 * and a Jinja variable — and both are `/v1/chat/completions` features. The
 * native `/completion` route runs no chat template at all, which is why the
 * choice is recorded as unsendable there rather than posted as a no-op.
 */
describe("LlamaCppAdapter — reasoning on the wire", () => {
	async function bodyFor(
		sampling: Record<string, unknown>,
		wireMode: "chat" | "completion" = "chat"
	) {
		vi.mocked(axios.post).mockClear()
		vi.mocked(axios.post).mockResolvedValueOnce({
			data:
				wireMode === "chat"
					? { choices: [{ message: { content: "ok" } }] }
					: { content: "ok" }
		})
		const adapter = makeAdapter(
			{ wireMode, extraJson: { stream: false } },
			sampling
		)
		await adapter.generateText()
		const body = vi.mocked(axios.post).mock.calls.at(-1)![1] as any
		return { body, adapter }
	}

	test("a config that never enabled it sends neither field", async () => {
		const { body, adapter } = await bodyFor({ temperature: 0.4 })
		expect(body).not.toHaveProperty("reasoning_budget")
		expect(body).not.toHaveProperty("chat_template_kwargs")
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("off is a budget of zero AND the template variable, together", async () => {
		// One without the other leaves a chat template that asks the other
		// question doing the opposite of what was chosen.
		const { body } = await bodyFor({ reasoning: "off" })
		expect(body.reasoning_budget).toBe(0)
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
	})

	test("a level becomes the shared table's token count", async () => {
		const { body } = await bodyFor({ reasoning: "high" })
		expect(body.reasoning_budget).toBe(32000)
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
	})

	test("a budget set outright beats the level's table entry", async () => {
		const { body, adapter } = await bodyFor({
			reasoning: "low",
			reasoningBudget: 5000
		})
		expect(body.reasoning_budget).toBe(5000)
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("the completion route records both rather than posting a no-op", async () => {
		const { body, adapter } = await bodyFor(
			{ reasoning: "high", reasoningBudget: 5000 },
			"completion"
		)
		expect(body).not.toHaveProperty("reasoning_budget")
		expect(body).not.toHaveProperty("chat_template_kwargs")
		expect(adapter.ignoredSamplers).toEqual([
			"reasoning",
			"reasoningBudget"
		])
	})
})
