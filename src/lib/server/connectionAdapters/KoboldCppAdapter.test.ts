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

function makeAdapter(connectionOverrides: Record<string, any> = {}) {
	return new KoboldCppAdapter({
		connection: makeConnection(connectionOverrides),
		sampling: {} as any,
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
		expect(fetchMock).toHaveBeenLastCalledWith(
			"http://localhost:5001/api/v1/model",
			expect.anything()
		)
		expect(result.models[0].name).toContain("loaded-model")
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
// session-template pipeline (useSession: true), and koboldcpp separates native
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

	test('responseFormat "json" sends a GBNF grammar in session mode', async () => {
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
			extraJson: { useSession: false, stream: false }
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

	test("omits chat_template_kwargs entirely in text-completion mode (useSession: false), even with a value set", async () => {
		const adapter = makeAdapter({
			extraJson: {
				useSession: false,
				stream: false,
				enableThinking: true
			}
		})
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
	test("includes enable_thinking nested in chat_template_kwargs in session mode when explicitly set", async () => {
		const adapter = makeAdapter({
			extraJson: { useSession: true, stream: false, enableThinking: true }
		})
		mockCompilePrompt(adapter)
		await adapter.generateText()

		const body = findGenerateCallBody()
		expect(body).not.toHaveProperty("enable_thinking")
		expect(body.chat_template_kwargs?.enable_thinking).toBe(true)
	})

	test("omits chat_template_kwargs in session mode when Auto (null)", async () => {
		const adapter = makeAdapter({
			extraJson: { useSession: true, stream: false, enableThinking: null }
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
			extraJson: { useSession: true, stream: true }
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

	test("non-streaming: populates thinkingContent from message.reasoning_content in session mode", async () => {
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
			extraJson: { useSession: true, stream: false }
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
			extraJson: { useSession: true, stream: false }
		})
		mockCompilePrompt(adapter)
		const result = await adapter.generateText()

		expect((result as any).thinkingContent).toBeUndefined()
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
