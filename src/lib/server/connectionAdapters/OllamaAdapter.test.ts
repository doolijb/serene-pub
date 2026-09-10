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
vi.mock("ollama", () => ({
	Ollama: class {
		list = (...args: any[]) => listMock(...args)
		chat = (...args: any[]) => chatMock(...args)
		generate = (...args: any[]) => generateMock(...args)
		abort = vi.fn()
		constructor(...args: any[]) {
			ollamaConstructorMock(...args)
		}
	}
}))

const exportsDefault = (await import("./OllamaAdapter")).default

function makeConnection(overrides: Record<string, any> = {}): any {
	return {
		id: 1,
		type: "ollama",
		baseUrl: "http://localhost:11434",
		model: "llama3",
		promptFormat: "vicuna",
		// Chat wire mode, stated the way an adapter receives it — `withWireMode`
		// attaches this where a connection is loaded. It used to be
		// `extraJson.useSession`, an adapter-local flag.
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
				extraJson: { stream: false, think: true }
			})
			mockCompilePrompt(adapter)

			const result = await adapter.generateText()
			// The reasoning still reaches the CALLER — this is about where it
			// does not go, not about switching it off.
			expect(result.thinkingContent).toBe("Pondering deeply.")
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
				extraJson: { stream: true, think: true }
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
