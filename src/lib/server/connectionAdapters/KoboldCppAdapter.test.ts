import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

// KoboldCppAdapter -> BaseConnectionAdapter pulls in the full promptBuilder
// module graph at import time — mock minimally, same convention as
// BaseConnectionAdapter.test.ts.
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

const { KoboldCppAdapter, testConnection } = await import("./KoboldCppAdapter")
const { buildPerspectiveSchema } = await import("$lib/server/utils/graphSchema")
const { JSON_OBJECT_GBNF } = await import("./jsonGrammar")
const exportsDefault = (await import("./KoboldCppAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "koboldcpp",
		baseUrl: "http://localhost:5001",
		model: "koboldcpp",
		promptFormat: "vicuna",
		extraJson: {},
		...overrides
	}
}

function makeAdapter(
	connectionOverrides: Record<string, any> = {},
	// Already RESOLVED, the way an adapter receives it: a key being present is
	// the switch being on.
	sampling: Record<string, unknown> = {}
) {
	return new KoboldCppAdapter({
		connection: makeConnection(connectionOverrides),
		sampling: sampling as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are a helpful narrator." } as any,
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
		currentCharacterId: null
	})
}

describe("KoboldCppAdapter.mapSamplingConfig()", () => {
	test("maps known sampling keys and defaults sampler_order", () => {
		const adapter = makeAdapter()
		adapter.sampling = {
			temperature: 0.8,
			topP: 0.9
		} as any
		const result = adapter.mapSamplingConfig()
		expect(result.temperature).toBe(0.8)
		expect(result.top_p).toBe(0.9)
		expect(result.sampler_order).toEqual([6, 0, 1, 3, 4, 2, 5])
	})

	// `sampling` arrives already resolved, so a switched-off sampler reaches the
	// adapter as an absent key — omission is the only "off" there is.
	test("does not send a sampler the resolved config omits", () => {
		const adapter = makeAdapter()
		adapter.sampling = { topP: 0.9 } as any
		const result = adapter.mapSamplingConfig()
		expect(result.top_p).toBe(0.9)
		expect(result.temperature).toBeUndefined()
	})
})

describe("KoboldCppAdapter — base URL trailing-slash normalization", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ version: "1.2.3" })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("testConnection() hits the same URL whether baseUrl has a trailing slash or not", async () => {
		await testConnection(
			makeConnection({ baseUrl: "http://localhost:5001" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/extra/version",
			expect.anything()
		)

		await testConnection(
			makeConnection({ baseUrl: "http://localhost:5001/" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/extra/version",
			expect.anything()
		)
	})

	test("testConnection() collapses multiple trailing slashes too", async () => {
		await testConnection(
			makeConnection({ baseUrl: "http://localhost:5001///" })
		)
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/extra/version",
			expect.anything()
		)
	})

	test("testConnection() falls back to the documented default when baseUrl is unset", async () => {
		await testConnection(makeConnection({ baseUrl: "" }))
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/extra/version",
			expect.anything()
		)
	})

	test("testConnection() reports a non-ok response as a failure with status info", async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: "Internal Server Error"
		})
		const result = await testConnection(makeConnection())
		expect(result.ok).toBe(false)
		expect(result.error).toContain("500")
	})

	test("testConnection() reports a network error", async () => {
		fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"))
		const result = await testConnection(makeConnection())
		expect(result.ok).toBe(false)
		expect(result.error).toContain("ECONNREFUSED")
	})

	test("listModels() hits the normalized URL regardless of a trailing slash", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ result: "loaded-model" })
		})
		const result = await exportsDefault.listModels(
			makeConnection({ baseUrl: "http://localhost:5001/" })
		)
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:5001/api/v1/model",
			expect.anything()
		)
		expect(result.models[0].name).toContain("loaded-model")
	})

	describe("listModels() — only the loaded models koboldcpp names", () => {
		// The shapes below are koboldcpp 1.119's own answers, recorded live.
		const SD = [
			{
				title: "sdxs-512-tinySDdistilled_Q8_0",
				model_name: "sdxs-512-tinySDdistilled_Q8_0",
				filename: "/models/sdxs-512-tinySDdistilled_Q8_0.gguf",
				config: null
			}
		]
		function answer(
			text: string,
			sd: { status: number; body?: unknown },
			embedding: string | null = null
		) {
			fetchMock.mockImplementation(async (url: string) => {
				if (url.endsWith("/api/v1/model"))
					return { ok: true, status: 200, json: async () => ({ result: text }) }
				if (url.endsWith("/api/extra/version"))
					return {
						ok: true,
						status: 200,
						json: async () => ({ embeddings: embedding != null })
					}
				if (url.endsWith("/v1/embeddings"))
					return {
						ok: true,
						status: 200,
						json: async () => ({ model: embedding, data: [] })
					}
				return {
					ok: sd.status >= 200 && sd.status < 300,
					status: sd.status,
					json: async () => sd.body
				}
			})
		}

		test("text and image, each with its modality", async () => {
			answer("koboldcpp/gemma-4-E4B-it-Q4_K_M", { status: 200, body: SD })
			const result = await exportsDefault.listModels(makeConnection())
			expect(result.error).toBeUndefined()
			expect(result.models).toEqual([
				{
					model: "koboldcpp/gemma-4-E4B-it-Q4_K_M",
					name: "koboldcpp/gemma-4-E4B-it-Q4_K_M",
					modality: "text-gen"
				},
				{
					model: "sdxs-512-tinySDdistilled_Q8_0",
					name: "sdxs-512-tinySDdistilled_Q8_0",
					modality: "image-gen"
				}
			])
		})

		test("an image-only instance's \"inactive\" is not a text model", async () => {
			answer("inactive", { status: 200, body: SD })
			const result = await exportsDefault.listModels(makeConnection())
			expect(result.models.map((m: any) => m.modality)).toEqual(["image-gen"])
		})

		test("no image model — an empty list or a 404 — lists the text model alone", async () => {
			answer("koboldcpp/x", { status: 200, body: [] })
			expect(
				(await exportsDefault.listModels(makeConnection())).models.length
			).toBe(1)
			answer("koboldcpp/x", { status: 404 })
			expect(
				(await exportsDefault.listModels(makeConnection())).models.length
			).toBe(1)
		})

		test("the loaded embedding model is listed, named by the probe", async () => {
			answer("koboldcpp/x", { status: 200, body: [] }, "nomic-embed-text-v1.5.Q4_K_M")
			const result = await exportsDefault.listModels(makeConnection())
			expect(result.models.map((m: any) => [m.model, m.modality])).toEqual([
				["koboldcpp/x", "text-gen"],
				["nomic-embed-text-v1.5.Q4_K_M", "embeddings"]
			])
		})

		test("no embedding model loaded: the probe is never sent", async () => {
			answer("koboldcpp/x", { status: 200, body: [] })
			await exportsDefault.listModels(makeConnection())
			expect(
				fetchMock.mock.calls.some((call: unknown[]) =>
					String(call[0]).endsWith("/v1/embeddings")
				)
			).toBe(false)
		})

		test("an image answer that says nothing is an ERROR, never half a listing", async () => {
			answer("koboldcpp/x", { status: 503 })
			const result = await exportsDefault.listModels(makeConnection())
			expect(result.models).toEqual([])
			expect(result.error).toMatch(/image model/)
		})
	})

	test("generateText()'s abort() targets the normalized URL", async () => {
		const adapter = makeAdapter({ baseUrl: "http://localhost:5001/" })
		;(adapter as any).genKey = "test-genkey"
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ result: "some-model" })
		})
		adapter.abort()
		// abort() fires a non-awaited fetch — flush microtasks once.
		await Promise.resolve()
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:5001/api/extra/abort",
			expect.objectContaining({ method: "POST" })
		)
	})
})

// Round: connections-editing/thinking-toggle bugfix. See the plan for full
// context — enable_thinking only has meaning inside koboldcpp's
// session-template pipeline (chat wire mode), and koboldcpp separates native
// reasoning into a `reasoning_content` field this adapter previously never
// read (unlike its Ollama/Anthropic siblings).
describe("KoboldCppAdapter — enable_thinking request gating", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	function mockCompilePrompt(adapter: InstanceType<typeof KoboldCppAdapter>) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ choices: [{ message: { content: "hi" } }] })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	// compilePrompt's own base-class setup (getContextTokenLimit's
	// true_max_context_length probe) also goes through the same mocked
	// fetch, ahead of the actual generate request — find the real one by
	// URL rather than assuming call index 0.
	function findGenerateCallBody(): any {
		const call = fetchMock.mock.calls.find((args: any[]) => {
			const url = args[0] as string
			return (
				url.includes("/v1/chat/completions") ||
				url.includes("/api/v1/generate")
			)
		})
		expect(call).toBeDefined()
		return JSON.parse(call![1].body)
	}

	// ── responseFormat ────────────────────────────────────────────────────
	//
	// The NEGATIVE case is the important one. This constraint rides on the same
	// adapters session uses; a grammar leaking into an ordinary roleplay reply
	// would be a far worse regression than the extraction failures it exists to
	// fix. Default is "text", so forgetting to opt in can only ever under-apply.

	test("sends no grammar by default \u2014 session must never be constrained", async () => {
		const adapter = makeAdapter({ extraJson: { stream: false } })
		mockCompilePrompt(adapter)
		expect(adapter.responseFormat).toBe("text")
		await adapter.generateText()
		expect(findGenerateCallBody()).not.toHaveProperty("grammar")
	})

	test('responseFormat "json" sends a GBNF grammar in chat mode', async () => {
		const adapter = makeAdapter({ extraJson: { stream: false } })
		mockCompilePrompt(adapter)
		adapter.responseFormat = "json"
		await adapter.generateText()
		const body = findGenerateCallBody()
		expect(typeof body.grammar).toBe("string")
		expect(body.grammar).toContain("root")
	})

	test('responseFormat "json" sends a GBNF grammar in text-completion mode too', async () => {
		// KoboldCPP accepts `grammar` on both endpoints; a caller should not
		// have to know which one their connection happens to use.
		const adapter = makeAdapter({
			wireMode: "completion",
			extraJson: { stream: false }
		})
		mockCompilePrompt(adapter)
		adapter.responseFormat = "json"
		await adapter.generateText()
		expect(typeof findGenerateCallBody().grammar).toBe("string")
	})

	test("a responseSchema narrows the grammar to that exact shape", async () => {
		const adapter = makeAdapter({ extraJson: { stream: false } })
		mockCompilePrompt(adapter)
		adapter.responseFormat = "json"
		adapter.responseSchema = buildPerspectiveSchema("Corb")
		await adapter.generateText()
		const grammar = findGenerateCallBody().grammar
		// The pin itself — the value `from` is allowed to take.
		expect(grammar).toContain('("\\"Corb\\"")')
		expect(grammar).toContain('\\"relationships\\"')
		// …and it is the schema grammar, not the generic any-object one.
		expect(grammar).not.toBe(JSON_OBJECT_GBNF)
	})

	test("a responseSchema is ignored while responseFormat is text", async () => {
		// The negative case again, and the one that matters most: responseSchema
		// is consulted ONLY under "json". A schema set without opting into JSON
		// mode must not constrain generation, or the session path could be
		// constrained by a stray assignment rather than a deliberate one.
		const adapter = makeAdapter({ extraJson: { stream: false } })
		mockCompilePrompt(adapter)
		adapter.responseSchema = buildPerspectiveSchema("Corb")
		expect(adapter.responseFormat).toBe("text")
		await adapter.generateText()
		expect(findGenerateCallBody()).not.toHaveProperty("grammar")
	})

	test("omits chat_template_kwargs entirely in completion wire mode, even with a value set", async () => {
		const adapter = makeAdapter(
			{ wireMode: "completion", extraJson: { stream: false } },
			// The choice arrives on the SAMPLING config now (ruling
			// 2026-09-12), not on the connection. The route still cannot carry
			// it, which is the property this case has always asserted.
			{ reasoning: "high" }
		)
		mockCompilePrompt(adapter)
		const result = await adapter.generateText()
		expect(typeof result.completionResult).toBe("string")

		const body = findGenerateCallBody()
		expect(body).not.toHaveProperty("enable_thinking")
		expect(body).not.toHaveProperty("chat_template_kwargs")
	})

	// Bugfix: koboldcpp never reads a top-level "enable_thinking" from a
	// request — every occurrence of that key in koboldcpp's own source is
	// inside its Tkinter GUI's launch-config code. The real per-request path
	// only reads a nested chat_template_kwargs object.
	test("includes enable_thinking nested in chat_template_kwargs in chat mode when explicitly set", async () => {
		const adapter = makeAdapter(
			{ wireMode: "chat", extraJson: { stream: false } },
			{ reasoning: "low" }
		)
		mockCompilePrompt(adapter)
		await adapter.generateText()

		const body = findGenerateCallBody()
		expect(body).not.toHaveProperty("enable_thinking")
		expect(body.chat_template_kwargs?.enable_thinking).toBe(true)
	})

	test("omits chat_template_kwargs in chat mode when the sampler is off", async () => {
		// The vocabulary's "say nothing" is the field being SWITCHED OFF, which
		// is the state the connection's old Auto/On/Off control spelled `null`.
		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		mockCompilePrompt(adapter)
		await adapter.generateText()

		expect(findGenerateCallBody()).not.toHaveProperty(
			"chat_template_kwargs"
		)
	})
})

describe("KoboldCppAdapter — native reasoning_content readback", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	function mockCompilePrompt(adapter: InstanceType<typeof KoboldCppAdapter>) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
	}

	function makeSSEResponse(dataPayloads: any[]) {
		const encoder = new TextEncoder()
		const body = new ReadableStream({
			start(controller) {
				for (const payload of dataPayloads) {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
					)
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"))
				controller.close()
			}
		})
		return { ok: true, body }
	}

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("streaming: forwards delta.reasoning_content via thinkingCb, separately from content", async () => {
		fetchMock = vi.fn(async () =>
			makeSSEResponse([
				{ choices: [{ delta: { reasoning_content: "Pondering" } }] },
				{ choices: [{ delta: { reasoning_content: " deeply." } }] },
				{ choices: [{ delta: { content: "Hello" } }] },
				{ choices: [{ delta: { content: " there." } }] }
			])
		)
		vi.stubGlobal("fetch", fetchMock)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: true }
		})
		mockCompilePrompt(adapter)
		const result = await adapter.generateText()

		let content = ""
		let thinking = ""
		expect(typeof result.completionResult).toBe("function")
		await (result.completionResult as any)(
			(chunk: string) => {
				content += chunk
			},
			(chunk: string) => {
				thinking += chunk
			}
		)

		expect(content).toBe("Hello there.")
		expect(thinking).toBe("Pondering deeply.")
	})

	test("non-streaming: populates thinkingContent from message.reasoning_content in chat mode", async () => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: "Hello there.",
							reasoning_content: "Pondering deeply."
						}
					}
				]
			})
		}))
		vi.stubGlobal("fetch", fetchMock)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		mockCompilePrompt(adapter)
		const result = await adapter.generateText()

		expect(result.completionResult).toBe("Hello there.")
		expect((result as any).thinkingContent).toBe("Pondering deeply.")
	})

	test("non-streaming: thinkingContent is undefined when the response has no reasoning_content", async () => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Hello there." } }]
			})
		}))
		vi.stubGlobal("fetch", fetchMock)

		const adapter = makeAdapter({
			wireMode: "chat",
			extraJson: { stream: false }
		})
		mockCompilePrompt(adapter)
		const result = await adapter.generateText()

		expect((result as any).thinkingContent).toBeUndefined()
	})
})

/**
 * A payload built for a chat endpoint, handed to the text-completion branch.
 *
 * Rarer than it was, and deliberately still covered. Wire mode is one resolved
 * value read by both the render and this send, so the ordinary way to reach this
 * branch is gone: a completion-mode connection renders a flat string. What can
 * still arrive as messages is a payload a plugin assembled itself, a receipt
 * replayed from an older build, or a connection whose `prompt_format` names a
 * `role_array` template while the connection is in completion wire mode — the
 * template's own render mode and the connection's method remain independent
 * fields.
 *
 * What this pins is that the request body never carries `prompt: undefined`.
 * That is the shape that generates from nothing and reads as a model fault,
 * which is the failure mode `dispatch.ts`'s own header records having shipped
 * once already.
 */
describe("KoboldCppAdapter — a messages-only payload in text-completion mode", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ results: [{ text: "hi" }] })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	function generateBody(): any {
		const call = fetchMock.mock.calls.find((args: any[]) =>
			String(args[0]).includes("/api/v1/generate")
		)
		expect(call).toBeDefined()
		return JSON.parse((call as any)[1].body)
	}

	const messagesOnly = {
		prompt: undefined,
		messages: [
			{ role: "system", content: "Stay in character." },
			{ role: "user", content: "Bob: Where do the riders patrol?" },
			{ role: "assistant", content: "Alice:" }
		],
		meta: {} as any
	}

	test("sends a real prompt string rather than undefined", async () => {
		const adapter = makeAdapter({
			promptFormat: "vicuna",
			wireMode: "completion",
			extraJson: { stream: false }
		})
		adapter.withCompiledPrompt(messagesOnly as any)
		await adapter.generateText()

		const body = generateBody()
		expect(body.prompt).toBeTypeOf("string")
		expect(body.prompt.length).toBeGreaterThan(0)
	})

	test("rebuilds the blocks in the connection's own format", async () => {
		// Faithful rather than guessed: the roles are re-wrapped with the
		// wrapper this connection asked for, not flattened into an unlabelled
		// blob that loses who said what.
		const adapter = makeAdapter({
			promptFormat: "chatml",
			wireMode: "completion",
			extraJson: { stream: false }
		})
		adapter.withCompiledPrompt(messagesOnly as any)
		await adapter.generateText()

		const body = generateBody()
		expect(body.prompt).toContain("<|im_start|>system")
		expect(body.prompt).toContain("<|im_start|>user")
		expect(body.prompt).toContain("Where do the riders patrol?")
	})

	test("does not open a second assistant turn when the payload already seeds one", async () => {
		// An assembled session prompt ends with the seed turn — an assistant
		// block holding just the speaker's name for the model to continue.
		// Appending the usual empty opener after it would tell the model to
		// start a reply twice.
		const adapter = makeAdapter({
			promptFormat: "vicuna",
			wireMode: "completion",
			extraJson: { stream: false }
		})
		adapter.withCompiledPrompt(messagesOnly as any)
		await adapter.generateText()

		const body = generateBody()
		expect(body.prompt.match(/### Assistant:/g)?.length).toBe(1)
		expect(body.prompt.endsWith("Alice:\n")).toBe(true)
	})

	test("a payload carrying a prompt string is still sent verbatim", async () => {
		// The path every connection takes today, unchanged: nothing is rebuilt
		// when there is a string to send.
		const adapter = makeAdapter({
			promptFormat: "vicuna",
			wireMode: "completion",
			extraJson: { stream: false }
		})
		adapter.withCompiledPrompt({
			prompt: "### System:\nexactly this\n",
			messages: [{ role: "user", content: "ignored" }],
			meta: {} as any
		} as any)
		await adapter.generateText()

		expect(generateBody().prompt).toBe("### System:\nexactly this\n")
	})
})

describe("KoboldCppAdapter module exports", () => {
	test("exports Adapter/testConnection/listModels/connectionDefaults/samplingKeyMap", () => {
		expect(exportsDefault.Adapter).toBe(KoboldCppAdapter)
		expect(typeof exportsDefault.testConnection).toBe("function")
		expect(typeof exportsDefault.listModels).toBe("function")
		expect(exportsDefault.connectionDefaults).toBeDefined()
		expect(exportsDefault.samplingKeyMap).toBeDefined()
	})
})

/**
 * The reply and the scratchpad stay OUT of the server log.
 *
 * Three `[KCPP DEBUG]` lines survived the Gemma-4 thinking diagnosis they were
 * added for. The streaming one was the worst of them:
 * `JSON.stringify(data.choices?.[0])` inside the per-delta loop, so the entire
 * reply and the entire reasoning were written to stdout token by token — a
 * privacy problem and, at one `JSON.stringify` per delta, a cost on the hot
 * path as well.
 *
 * The comment above them said "TEMPORARY DEBUG — remove after diagnosing", and
 * they had outlived that condition: the diagnosis produced the
 * `chat_template_kwargs` fix and the `reasoning_content` readback, both pinned
 * by the suites above. These cases are what keeps the next diagnosis's
 * leftovers from settling in the same way.
 */
describe("KoboldCppAdapter — generation writes nothing to the server log", () => {
	function mockCompilePrompt(adapter: InstanceType<typeof KoboldCppAdapter>) {
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "Tell me a secret." }],
			meta: {} as any
		} as any)
	}

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("non-streaming: neither the request nor the reasoning is logged", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: true,
					json: async () => ({
						choices: [
							{
								message: {
									content: "Hello there.",
									reasoning_content: "Pondering deeply."
								}
							}
						]
					})
				}))
			)
			const adapter = makeAdapter({
				wireMode: "chat",
				extraJson: { stream: false, enableThinking: true }
			})
			mockCompilePrompt(adapter)

			const result = await adapter.generateText()
			// Still delivered to the CALLER — this is about where it does not go.
			expect((result as any).thinkingContent).toBe("Pondering deeply.")
			expect(logSpy).not.toHaveBeenCalled()
		} finally {
			logSpy.mockRestore()
		}
	})

	test("streaming: no per-delta dump of the reply or the reasoning", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			const encoder = new TextEncoder()
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: true,
					body: new ReadableStream({
						start(controller) {
							for (const payload of [
								{
									choices: [
										{
											delta: {
												reasoning_content:
													"Pondering deeply."
											}
										}
									]
								},
								{
									choices: [
										{ delta: { content: "Hello there." } }
									]
								}
							]) {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify(payload)}\n\n`
									)
								)
							}
							controller.enqueue(
								encoder.encode("data: [DONE]\n\n")
							)
							controller.close()
						}
					})
				}))
			)
			const adapter = makeAdapter({
				wireMode: "chat",
				extraJson: { stream: true, enableThinking: true }
			})
			mockCompilePrompt(adapter)

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
			expect(content).toBe("Hello there.")
			expect(thinking).toBe("Pondering deeply.")
			expect(logSpy).not.toHaveBeenCalled()
		} finally {
			logSpy.mockRestore()
		}
	})
})

/**
 * The node's `streaming` parameter, at the one line that reads it.
 *
 * KoboldCPP's own default is `?? true`, which makes it the adapter where `auto`
 * meaning "true" would be invisible — it already is true — and where `off` is
 * worth the most: a background step gets one POST instead of a frame feed
 * nobody reads. Read off `completionResult`, because that is the fact the
 * dispatch branches on.
 */
describe("KoboldCppAdapter — the node's streaming parameter", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ choices: [{ message: { content: "hi" } }] })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	const sendWith = async (stream: boolean, mode?: "auto" | "off") => {
		const adapter = makeAdapter({ extraJson: { stream } })
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
		// The unset case is the one that matters here: `?? true` means an
		// untouched KoboldCPP connection streams, and it has to keep doing so.
		const adapter = makeAdapter({ extraJson: {} })
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		expect(typeof (await adapter.generateText()).completionResult).toBe(
			"function"
		)
	})

	test("off sends one request even on a streaming connection", async () => {
		expect(await sendWith(true, "off")).toBe("one request")
	})
})

/**
 * Reasoning, as a SAMPLING parameter (ruling 2026-09-12).
 *
 * KoboldCPP has TWO states where the vocabulary has four, and only on the
 * session route: `enable_thinking` is a Jinja variable the chat template reads,
 * and the raw completion endpoints never run that pipeline. Everything the
 * service cannot express is recorded rather than lost.
 */
describe("KoboldCppAdapter — reasoning on the wire", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				results: [{ text: "ok" }],
				choices: [{ message: { content: "ok" } }]
			}),
			text: async () => "{}"
		}))
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	async function bodyFor(
		sampling: Record<string, unknown>,
		wireMode: "chat" | "completion" = "chat"
	) {
		const adapter = makeAdapter(
			{ wireMode, extraJson: { stream: false } },
			sampling
		)
		adapter.withCompiledPrompt({
			prompt: "hi",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		await adapter.generateText()
		const call = fetchMock.mock.calls.find((c: any) =>
			String(c[0]).includes("completions")
		) as any
		return { body: JSON.parse(call[1].body), adapter }
	}

	test("off is the template variable set to false", async () => {
		const { body, adapter } = await bodyFor({ reasoning: "off" })
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
		// Honoured exactly, so nothing is recorded.
		expect(adapter.ignoredSamplers).toEqual([])
	})

	test("a level is honoured as on, and the level itself is recorded as lost", async () => {
		const { body, adapter } = await bodyFor({ reasoning: "high" })
		expect(body.chat_template_kwargs).toEqual({ enable_thinking: true })
		expect(adapter.ignoredSamplers).toContain("reasoning")
	})

	test("a budget has no field on this service at all", async () => {
		const { adapter } = await bodyFor({
			reasoning: "low",
			reasoningBudget: 2048
		})
		expect(adapter.ignoredSamplers).toContain("reasoningBudget")
	})
})
