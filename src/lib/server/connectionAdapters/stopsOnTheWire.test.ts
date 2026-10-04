/**
 * An adapter SENDS the composed stop list. It does not build one.
 *
 * ## The property, and why it is stated negatively
 *
 * Five adapters used to compose their own stop sequences from the connection's
 * completion template and the session's cast, and a sixth sent none at all.
 * Asserting only that the handed-over list arrives on the wire would go green on
 * an adapter that ALSO added its own — which is precisely the state the ruling
 * of 2026-09-10 removed, and precisely the state that put a completion
 * template's role labels on Ollama's chat request, overriding a ChatML model's
 * native `<|im_end|>`.
 *
 * So every case here is a pair. The connection carries a template whose stop
 * strings share no bytes with the handed-over list, and the session carries a
 * cast whose names share none either:
 *
 *   1. every value in `sent` reaches the service's own field, in order; and
 *   2. the template's own stops and the cast's `Name:` labels are **absent**.
 *
 * (2) is the assertion that fails if a `StopStrings.get` call comes back. It
 * cannot be satisfied by an adapter that composes, whatever else it also does.
 *
 * ## What is deliberately NOT here
 *
 * The wire rule. Whether a `format` stop belongs on a chat request is
 * `composeStops`'s decision and is asserted at `connections/stops.test.ts`; an
 * adapter is handed an already-filtered list and has no opinion. Testing the
 * rule here would be testing it twice, in the place that no longer knows it.
 *
 * LM Studio's case is in `LMStudioAdapter.test.ts` for the reason
 * `adminTemplateStops.test.ts` gives: `importBoundary.test.ts` allows
 * `@lmstudio/sdk` into the registry thunk and that adapter's own tests only,
 * because it cannot be PARSED under nodejs-mobile's V8 on Android.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	BLOCK_ROLES,
	type CompletionTemplate,
	type RoleFraming
} from "$lib/shared/constants/completionTemplates"
import type { ComposedStops } from "$lib/server/connections/stops"

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

// ── Transports ────────────────────────────────────────────────────────────
const ollamaGenerateMock = vi.fn(async (..._args: any[]) => ({
	response: "hi"
}))
const ollamaChatMock = vi.fn(async (..._args: any[]) => ({
	message: { content: "hi" }
}))
vi.mock("ollama", () => ({
	Ollama: class {
		list = vi.fn()
		chat = (...args: any[]) => ollamaChatMock(...args)
		generate = (...args: any[]) => ollamaGenerateMock(...args)
		abort = vi.fn()
	}
}))

const openAICreateMock = vi.fn(async (..._args: any[]) => ({
	choices: [{ message: { content: "hi" } }]
}))
vi.mock("openai", () => ({
	OpenAI: class {
		chat = {
			completions: {
				create: (...args: any[]) => openAICreateMock(...args)
			}
		}
		models = { list: vi.fn() }
	}
}))

const anthropicCreateMock = vi.fn(async (..._args: any[]) => ({
	content: [{ type: "text", text: "hi" }]
}))
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			create: (...args: any[]) => anthropicCreateMock(...args),
			stream: vi.fn()
		}
	}
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn(async () => ({ data: { status: "ok" } })),
		post: vi.fn(async () => ({ data: { content: "hi" } })),
		CancelToken: { source: () => ({ token: "token", cancel: vi.fn() }) },
		isCancel: () => false
	}
}))

const axios = (await import("axios")).default
const kobold = (await import("./KoboldCppAdapter")).default
const ollama = (await import("./OllamaAdapter")).default
const llamacpp = (await import("./LlamaCppAdapter")).default
const openai = (await import("./OpenAIChatAdapter")).default
const anthropic = (await import("./AnthropicAdapter")).default

// ── The decoys ────────────────────────────────────────────────────────────
//
// A template and a cast an adapter WOULD have composed from, sharing no bytes
// with the handed-over list below. Anything of theirs on the wire is an adapter
// that went and looked.
const MARK = (role: string): RoleFraming => ({
	prefix: `@@${role}@@\n`,
	suffix: `@@stop@@\n`
})
const DECOY_TEMPLATE: CompletionTemplate = {
	key: "decoy-house-style",
	name: "Decoy House Style",
	renderMode: "flat",
	roles: Object.fromEntries(
		BLOCK_ROLES.map((r) => [r, MARK(r)])
	) as CompletionTemplate["roles"],
	fallbackRole: MARK("user"),
	stopStrings: ["@@decoy-format@@"],
	isSelectable: true
}
const DECOY_SPEAKER = "Decoy Character:"
const DECOY_PERSONA = "Decoy Persona:"

/** What the host actually composed — none of it derivable from the decoys. */
const COMPOSED: ComposedStops = {
	sent: [
		{ value: "%%one%%", kind: "format" },
		{ value: "%%two%%", kind: "speaker" },
		{ value: "%%three%%", kind: "explicit" }
	],
	dropped: [{ value: "%%held-back%%", kind: "format" }],
	wire: "completion"
}
const SENT = COMPOSED.sent.map((s) => s.value)

/** Every string an adapter could only have on the wire by composing. */
const DECOYS = [
	...DECOY_TEMPLATE.stopStrings,
	DECOY_SPEAKER,
	DECOY_PERSONA,
	// And the entry the wire rule held back: `dropped` is a report, never a
	// second list for an adapter to read.
	"%%held-back%%"
]

function makeSession(): any {
	return {
		id: 1,
		userId: 1,
		sessionType: "session",
		metadata: { ragIgnored: true },
		sessionMessages: [],
		sessionCharacters: [
			{
				character: {
					id: 42,
					name: "Decoy Character",
					nickname: null
				}
			}
		],
		sessionPersonas: [{ persona: { id: 7, name: "Decoy Persona" } }],
		lorebook: {
			id: 1,
			lorebookBindings: [],
			worldLoreEntries: [],
			characterLoreEntries: [],
			historyEntries: []
		}
	}
}

function params(connection: any) {
	return {
		connection,
		sampling: {} as any,
		systemPrompt: "You are terse.",
		session: makeSession(),
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}
}

function connection(over: Record<string, any> = {}): any {
	return {
		id: 1,
		promptFormat: DECOY_TEMPLATE.key,
		completionTemplate: DECOY_TEMPLATE,
		wireMode: "completion",
		extraJson: {},
		...over
	}
}

/** A payload carrying both shapes, so either branch has something to send. */
const inject = (adapter: any) =>
	adapter
		.withCompiledPrompt({
			prompt: "@@system@@\nYou are terse.@@stop@@\n",
			messages: [{ role: "user", content: "hi" }],
			meta: {} as any
		} as any)
		.withStops(COMPOSED)

/** Both halves of the property, in one place so no case can state only one. */
function expectHonoured(field: unknown) {
	expect(field, "no stop sequences reached the wire").toBeDefined()
	expect(field).toEqual(SENT)
	for (const decoy of DECOYS)
		expect(
			field as string[],
			`"${decoy}" is on the wire, so this adapter composed a list of its own`
		).not.toContain(decoy)
}

describe("KoboldCPP honours the composed list", () => {
	let fetchMock: ReturnType<typeof vi.fn>
	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				results: [{ text: "hi" }],
				choices: [{ message: { content: "hi" } }]
			})
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	const bodyFor = (fragment: string): any => {
		const call = fetchMock.mock.calls.find((args: any[]) =>
			String(args[0]).includes(fragment)
		)
		expect(call, `no request to ${fragment}`).toBeDefined()
		return JSON.parse((call as any)[1].body)
	}

	test("completion wire puts them on stop_sequence", async () => {
		const adapter = new kobold.Adapter(
			params(
				connection({
					type: "koboldcpp",
					baseUrl: "http://localhost:5001",
					model: "koboldcpp",
					extraJson: { stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured(bodyFor("/api/v1/generate").stop_sequence)
	})

	test("chat wire sends them too — it used to send nothing at all", async () => {
		const adapter = new kobold.Adapter(
			params(
				connection({
					type: "koboldcpp",
					baseUrl: "http://localhost:5001",
					model: "koboldcpp",
					wireMode: "chat",
					extraJson: { stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		// The author's own sequences are the only kind that survives the wire
		// rule here; this leg discarded them for a release.
		expectHonoured(bodyFor("/v1/chat/completions").stop)
	})
})

describe("Ollama honours the composed list", () => {
	beforeEach(() => {
		ollamaGenerateMock.mockClear()
		ollamaChatMock.mockClear()
	})

	test("completion wire puts them on options.stop", async () => {
		const adapter = new ollama.Adapter(
			params(
				connection({
					type: "ollama",
					baseUrl: "http://localhost:11434",
					model: "llama3",
					extraJson: { stream: false }
				})
			) as any
		) as any
		adapter
			.withCompiledPrompt({
				prompt: "@@system@@\nYou are terse.@@stop@@\n",
				meta: {} as any
			} as any)
			.withStops(COMPOSED)
		await adapter.generateText()
		expectHonoured(
			(ollamaGenerateMock.mock.calls[0]?.[0] as any).options.stop
		)
	})

	test("chat wire puts the SAME list there, not a second composition", async () => {
		// This branch is the one that misbehaved: it concatenated the adapter's
		// two local compositions, so a template's role labels went out on a
		// chat request and overrode the model's native stop tokens.
		const adapter = new ollama.Adapter(
			params(
				connection({
					type: "ollama",
					baseUrl: "http://localhost:11434",
					model: "llama3",
					wireMode: "chat",
					extraJson: { stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured((ollamaChatMock.mock.calls[0]?.[0] as any).options.stop)
	})
})

describe("llama.cpp honours the composed list", () => {
	beforeEach(() => vi.mocked(axios.post).mockClear())

	test("completion wire puts them on stop", async () => {
		const adapter = new llamacpp.Adapter(
			params(
				connection({
					type: "llamacpp",
					baseUrl: "http://localhost:8080",
					model: "",
					extraJson: { stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured((vi.mocked(axios.post).mock.calls[0]?.[1] as any).stop)
	})

	test("chat wire sends them too — the blanket omission is gone", async () => {
		vi.mocked(axios.post).mockResolvedValueOnce({
			data: { choices: [{ message: { content: "hi" } }] }
		} as any)
		const adapter = new llamacpp.Adapter(
			params(
				connection({
					type: "llamacpp",
					baseUrl: "http://localhost:8080",
					model: "",
					wireMode: "chat",
					extraJson: { stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured((vi.mocked(axios.post).mock.calls[0]?.[1] as any).stop)
	})
})

describe("OpenAI-compatible honours the composed list", () => {
	beforeEach(() => openAICreateMock.mockClear())

	test("the ternary is gone: chat wire sends what it was handed", async () => {
		const adapter = new openai.Adapter(
			params(
				connection({
					type: "openai",
					baseUrl: "https://api.example.com/v1",
					model: "gpt-4o",
					wireMode: "chat",
					extraJson: { apiKey: "sk-test", stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured((openAICreateMock.mock.calls[0]?.[0] as any).stop)
	})

	test("completion wire sends the same list", async () => {
		const adapter = new openai.Adapter(
			params(
				connection({
					type: "openai",
					baseUrl: "https://api.example.com/v1",
					model: "gpt-4o",
					extraJson: { apiKey: "sk-test", stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured((openAICreateMock.mock.calls[0]?.[0] as any).stop)
	})
})

describe("Anthropic honours the composed list", () => {
	beforeEach(() => anthropicCreateMock.mockClear())

	test("stop_sequences reaches the Messages API — it sent none, ever", async () => {
		const adapter = new anthropic.Adapter(
			params(
				connection({
					type: "anthropic",
					baseUrl: "",
					model: "claude-sonnet-4-5",
					wireMode: "chat",
					extraJson: { apiKey: "sk-ant-test", stream: false }
				})
			) as any
		) as any
		inject(adapter)
		await adapter.generateText()
		expectHonoured(
			(anthropicCreateMock.mock.calls[0]?.[0] as any).stop_sequences
		)
	})

	test("an empty list sends no key rather than an empty array", async () => {
		const adapter = new anthropic.Adapter(
			params(
				connection({
					type: "anthropic",
					baseUrl: "",
					model: "claude-sonnet-4-5",
					wireMode: "chat",
					extraJson: { apiKey: "sk-ant-test", stream: false }
				})
			) as any
		) as any
		adapter
			.withCompiledPrompt({
				messages: [{ role: "user", content: "hi" }],
				meta: {} as any
			} as any)
			.withStops({ sent: [], dropped: [], wire: "chat" })
		await adapter.generateText()
		expect(
			anthropicCreateMock.mock.calls[0]?.[0] as any
		).not.toHaveProperty("stop_sequences")
	})
})

describe("an adapter handed nothing composes nothing", () => {
	// The honest answer rather than a fallback: a caller that skipped
	// `withStops` has a wiring bug, and an adapter quietly building its own
	// list is what this whole change removes. The decoy template is right
	// there — a composing adapter would send `@@decoy-format@@`.
	test("no withStops call means an empty list, not the template's", async () => {
		vi.mocked(axios.post).mockClear()
		const adapter = new llamacpp.Adapter(
			params(
				connection({
					type: "llamacpp",
					baseUrl: "http://localhost:8080",
					model: "",
					extraJson: { stream: false }
				})
			) as any
		) as any
		adapter.withCompiledPrompt({
			prompt: "@@system@@\nYou are terse.@@stop@@\n",
			meta: {} as any
		} as any)
		await adapter.generateText()
		expect((vi.mocked(axios.post).mock.calls[0]?.[1] as any).stop).toEqual(
			[]
		)
	})
})
