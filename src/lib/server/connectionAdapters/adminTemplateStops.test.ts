/**
 * An admin-authored template's OWN stop strings have to reach the wire.
 *
 * ## The defect this file exists to keep closed
 *
 * The delimiters moved onto a `completion_templates` row and the render path
 * learned to read one. The stop strings did not: every adapter resolved them
 * from a bare KEY, and `completionTemplateOf` answers a bare key **against the
 * built-ins**. So a template an admin authored named no built-in, resolved to
 * the DEFAULT, and the model was told to stop on Vicuna's `### ` markers — which
 * its prompt does not contain.
 *
 * Nothing errors when that happens. The request is well-formed, the backend is
 * happy, and the model simply never stops. It reads as a bad model rather than a
 * bad request, which is why this is asserted at the OUTGOING PAYLOAD of each
 * adapter rather than at the composer: the composer has accepted a resolved row
 * for three lanes now, and the whole defect was that nothing handed it one.
 *
 * ## Where the composition moved, and why every assertion here survived it
 *
 * The stop list is composed ONCE, in `connections/stops.ts`, and handed to the
 * adapter through `withStops` (ruling 2026-09-10) — an adapter no longer builds
 * one. So the construction below changed and the assertions did not: `stopsFor`
 * mirrors the expression the two host sites use
 * (`connection.completionTemplate ?? promptFormatOf(connection.promptFormat)`),
 * which is the same expression `BaseConnectionAdapter.completionTemplate`
 * evaluates for the RENDER half. That pairing is the whole point of the file and
 * it is now what these cases check: a drift between the accessor the renderer
 * reads and the expression the host composes from would show up here as exactly
 * the disagreement this file exists to catch.
 *
 * ## Both halves of one payload
 *
 * The summarizer case asserts the rendered `prompt` and the `stop_sequence` from
 * the SAME request. That pairing is the point — a render/stop disagreement is
 * invisible in either half alone, and the summarizer path is the one that
 * re-wraps its blocks inside the adapter (`buildTextPromptFromMessages`), so it
 * is the path most likely to be left behind by a fix applied only to the
 * stop-string call sites.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	BLOCK_ROLES,
	completionTemplateOf,
	framingFor,
	type CompletionTemplate,
	type RoleFraming
} from "$lib/shared/constants/completionTemplates"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
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

// ── Transports, one per adapter under test ────────────────────────────────
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

// ── The template an admin authored ────────────────────────────────────────
//
// Deliberately shares NO bytes with any built-in: `### `, `<|im_`, `*** ` and
// the `Speaker:` shapes all appear in the shipped rows, so an assertion against
// them could pass on a fallback. `@@` appears in none of them.
const MARK = (role: string): RoleFraming => ({
	prefix: `@@${role}@@\n`,
	suffix: `@@stop@@\n`
})
const CUSTOM: CompletionTemplate = {
	key: "acme-house-style",
	name: "Acme House Style",
	renderMode: "flat",
	roles: Object.fromEntries(
		BLOCK_ROLES.map((r) => [r, MARK(r)])
	) as CompletionTemplate["roles"],
	fallbackRole: MARK("user"),
	stopStrings: ["@@stop@@", "@@user@@"],
	isSelectable: true
}

/** Vicuna's lead stop — what a fallback resolution puts on the wire instead. */
const VICUNA_LEAD_STOP = "</s>"

function makeSession(over: Record<string, any> = {}): any {
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
		},
		...over
	}
}

/** A session in the shape `summarizer/index.ts` and `dispatchStep.ts` build. */
const summarizerSession = () =>
	makeSession({
		sessionType: SessionTypes.SUMMARIZE,
		sessionMessages: [
			{
				id: 1,
				sessionId: 0,
				role: "user",
				content: "Summarize this.",
				createdAt: new Date().toISOString(),
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		]
	})

/**
 * A connection AS A RESOLVER HANDS IT OVER: the row, with the template its
 * `promptFormat` names already dereferenced from the table.
 */
/**
 * ⚠ `wireMode` is stated, not derived, and every case below that wants the
 * completion branch says so with it.
 *
 * These used to spell it `extraJson: { useSession: false }` /
 * `{ prerenderPrompt: true }` — adapter-local flags each adapter read for
 * itself. Wire mode is a connection CAPABILITY now, resolved from the row's four
 * layers at the point the connection is loaded (`withWireMode`) and attached to
 * the row the adapter is handed, exactly like `completionTemplate` beside it. A
 * test states the resolved value for the same reason it states the resolved
 * template: it is constructing an `AdapterConnection`, not a database row.
 *
 * `completion` here is also what makes these tests mean anything — a completion
 * template has no effect at all in chat wire mode, where the roles carry the
 * structure and no delimiter is emitted.
 */
function connectionWithTemplate(over: Record<string, any> = {}): any {
	return {
		id: 1,
		promptFormat: CUSTOM.key,
		completionTemplate: CUSTOM,
		wireMode: "completion",
		extraJson: {},
		...over
	}
}

function params(connection: any, session: any) {
	return {
		connection,
		sampling: {} as any,
		contextConfig: {} as any,
		promptConfig: { systemPrompt: "You are terse." } as any,
		session,
		currentCharacterId: null,
		tokenCounter: { countTokens: async () => 1 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.9
	}
}

/**
 * The stop list, composed exactly as the two host sites compose it.
 *
 * ⚠ Deliberately NOT a hand-written array. The defect this file guards is a
 * connection's template being resolved twice and differently; a literal here
 * would assert what the test author believed rather than what the app does, and
 * would go green on precisely the drift it exists to catch.
 */
const stopsFor = (connection: any, session: any) =>
	composeStops({
		template:
			connection.completionTemplate ??
			promptFormatOf(connection.promptFormat),
		characters: (session.sessionCharacters ?? []).map(
			(cc: any) => cc.character
		),
		personas: (session.sessionPersonas ?? []).map((cp: any) => cp.persona),
		currentCharacterId: null,
		explicit: [],
		wire: connection.wireMode ?? "completion"
	})

/** Construct an adapter the way a host does: payload in, stop list in. */
const dispatchOnly = (Adapter: any, connection: any, session: any) => {
	const adapter = new Adapter(params(connection, session) as any) as any
	adapter.withStops(stopsFor(connection, session))
	return adapter
}

/** The one-line payload a Provider hands a dispatch-only adapter. */
const injectReply = (adapter: any) =>
	adapter.withCompiledPrompt({
		prompt: "@@system@@\nYou are terse.@@stop@@\n",
		messages: [{ role: "user", content: "hi" }],
		meta: {} as any
	} as any)

describe("KoboldCPP — the custom template's stops reach the wire", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ results: [{ text: "hi" }] })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	const generateBody = (): any => {
		const call = fetchMock.mock.calls.find((args: any[]) =>
			String(args[0]).includes("/api/v1/generate")
		)
		expect(call, "no text-completion request was sent").toBeDefined()
		return JSON.parse((call as any)[1].body)
	}

	test("a reply sends the template's stop strings, not the default's", async () => {
		const adapter = dispatchOnly(
			kobold.Adapter,
			connectionWithTemplate({
				type: "koboldcpp",
				baseUrl: "http://localhost:5001",
				model: "koboldcpp",
				extraJson: { stream: false }
			}),
			makeSession()
		)
		injectReply(adapter)
		await adapter.generateText()

		const body = generateBody()
		expect(body.stop_sequence).toEqual(
			expect.arrayContaining(CUSTOM.stopStrings)
		)
		// The fallback's own lead stop must be absent, so a template that merely
		// happened to include a built-in's marker could not make this pass.
		expect(body.stop_sequence).not.toContain(VICUNA_LEAD_STOP)
	})

	test("a summarizer run renders AND stops with the same template", async () => {
		const adapter = dispatchOnly(
			kobold.Adapter,
			connectionWithTemplate({
				type: "koboldcpp",
				baseUrl: "http://localhost:5001",
				model: "koboldcpp",
				extraJson: { stream: false }
			}),
			summarizerSession()
		)
		await adapter.generateText()

		const body = generateBody()
		// One payload, both halves. The prompt the summarizer re-wraps inside the
		// adapter and the stops that end it have to name the same markers.
		expect(body.prompt).toContain("@@system@@")
		expect(body.prompt).toContain("@@stop@@")
		expect(body.prompt).not.toContain("### ")
		expect(body.stop_sequence).toEqual(
			expect.arrayContaining(CUSTOM.stopStrings)
		)
		expect(body.stop_sequence).not.toContain(VICUNA_LEAD_STOP)
	})
})

describe("Ollama — both call sites resolve identically", () => {
	beforeEach(() => {
		ollamaGenerateMock.mockClear()
		ollamaChatMock.mockClear()
	})

	const conn = (wireMode: string) =>
		connectionWithTemplate({
			type: "ollama",
			baseUrl: "http://localhost:11434",
			model: "llama3",
			wireMode,
			extraJson: { stream: false }
		})

	/**
	 * ⚠ **This case is INVERTED by the ruling of 2026-09-10, deliberately.**
	 *
	 * It used to assert that the chat request carried the template's stop
	 * strings, and that was the bug rather than the guarantee: on a chat wire the
	 * roles carry the structure, so a completion template's delimiters have
	 * nothing to bite on — and sending them OVERRIDES the model's native stop
	 * tokens (`<|im_end|>` on a ChatML model) in servers such as Ollama's
	 * OpenAI-compat layer, truncating replies for no gain. `OpenAIChatAdapter`
	 * and `LlamaCppAdapter` had both refused to do it, in comments, for as long
	 * as this file has asserted the opposite of Ollama.
	 *
	 * What the file is actually for survives the inversion: the template that
	 * reaches the composer is still the RESOLVED ROW rather than a bare key, and
	 * the wire rule is what decides where it goes. So this asserts the entries
	 * are held back on THIS wire — and `dropped` names them, so "held back" and
	 * "never composed" are still distinguishable, which they were not before.
	 */
	test("chat wire holds the template's stops back, and says so", async () => {
		const connection = conn("chat")
		const session = makeSession()
		const adapter = dispatchOnly(ollama.Adapter, connection, session)
		injectReply(adapter)
		await adapter.generateText()

		const req = ollamaChatMock.mock.calls[0]?.[0] as any
		expect(req, "no chat request was sent").toBeDefined()
		for (const stop of CUSTOM.stopStrings)
			expect(req.options.stop).not.toContain(stop)
		expect(req.options.stop).not.toContain(VICUNA_LEAD_STOP)

		// Held back rather than never composed — the distinction the old flat
		// `string[]` could not carry, and the one a receipt reader needs.
		expect(
			stopsFor(connection, session).dropped.map((s) => s.value)
		).toEqual(expect.arrayContaining(CUSTOM.stopStrings))
	})

	/**
	 * ⚠ The generate branch used to CONCATENATE this file's two local
	 * compositions (`[...stop, ...formatStopStrings]`), spelled `|| "chatml"`
	 * and `|| "vicuna"` in one file — so a disagreement between them put both
	 * formats' markers on one wire. There is one composition now and it cannot
	 * disagree with itself; what this still checks is that the ROW reached it,
	 * because a bare key would resolve to the default and put its lead stop here.
	 *
	 * Reached by a CONNECTION in completion wire mode, carrying a payload with a
	 * prompt and no messages — which is what that mode's render produces. The
	 * branch used to be chosen from the payload (`!!compiledPrompt.messages`),
	 * which could not disagree with itself but also could not disagree with a
	 * payload built for the wrong shape; the connection decides now, and the
	 * render reads the same value.
	 */
	test("completion wire sends the template's own stops", async () => {
		const adapter = dispatchOnly(
			ollama.Adapter,
			conn("completion"),
			makeSession()
		)
		adapter.withCompiledPrompt({
			prompt: "@@system@@\nYou are terse.@@stop@@\n",
			meta: {} as any
		} as any)
		await adapter.generateText()

		const req = ollamaGenerateMock.mock.calls[0]?.[0] as any
		expect(req, "no generate request was sent").toBeDefined()
		expect(req.options.stop).toEqual(
			expect.arrayContaining(CUSTOM.stopStrings)
		)
		expect(req.options.stop).not.toContain(VICUNA_LEAD_STOP)
	})
})

describe("llama.cpp — the custom template's stops reach the wire", () => {
	test("a reply sends the template's stop strings", async () => {
		vi.mocked(axios.post).mockClear()
		const adapter = dispatchOnly(
			llamacpp.Adapter,
			connectionWithTemplate({
				type: "llamacpp",
				baseUrl: "http://localhost:8080",
				model: "",
				extraJson: { stream: false }
			}),
			makeSession()
		)
		injectReply(adapter)
		await adapter.generateText()

		const body = vi.mocked(axios.post).mock.calls[0]?.[1] as any
		expect(body, "no completion request was sent").toBeDefined()
		expect(body.stop).toEqual(expect.arrayContaining(CUSTOM.stopStrings))
		expect(body.stop).not.toContain(VICUNA_LEAD_STOP)
	})
})

/**
 * ⚠ LM Studio's case is NOT here — it is in `LMStudioAdapter.test.ts`.
 *
 * `importBoundary.test.ts` permits `LMStudioAdapter` to be imported by the
 * registry thunk and its own tests only: `@lmstudio/sdk` uses regex property
 * escapes that fail to PARSE under nodejs-mobile's V8, so any other importer
 * takes server boot down on Android — on a platform CI does not run, at parse
 * time, with no stack anybody would connect back to the import. So the sixth
 * call site is asserted next to its adapter rather than beside the other five.
 */

describe("OpenAI-compatible — the custom template's stops reach the wire", () => {
	test("a pre-rendered reply sends the template's stop strings", async () => {
		openAICreateMock.mockClear()
		const adapter = dispatchOnly(
			openai.Adapter,
			connectionWithTemplate({
				type: "openai",
				baseUrl: "https://api.example.com/v1",
				model: "gpt-4o",
				// Completion wire mode, from the helper above — a completion
				// template's stops are only composed for that wire, and this
				// used to be spelled `extraJson.prerenderPrompt`.
				extraJson: {
					apiKey: "sk-test",
					stream: false
				}
			}),
			makeSession()
		)
		injectReply(adapter)
		await adapter.generateText()

		const params0 = openAICreateMock.mock.calls[0]?.[0] as any
		expect(params0, "no completion request was sent").toBeDefined()
		expect(params0.stop).toEqual(expect.arrayContaining(CUSTOM.stopStrings))
		expect(params0.stop).not.toContain(VICUNA_LEAD_STOP)
	})
})

/**
 * The absent case — the guard, mutated.
 *
 * A connection can reach an adapter without a resolved template: a unit test's
 * literal, `connections:test` on unsaved form state, or a row whose
 * `prompt_format` is NULL (the foreign key is `ON DELETE SET NULL`), cleared to
 * `""`, or naming a template that is gone. `BaseConnectionAdapter
 * .completionTemplate` falls back for all of those, and the ONLY thing that
 * makes that fallback safe is that it is the same expression the renderer falls
 * back to — `completionTemplateOf(promptFormatOf(key))`.
 *
 * So this asserts the property rather than the value: for each absent state, the
 * markers wrapping the prompt and the stop strings ending it both come from
 * whatever `completionTemplateOf(promptFormatOf(key))` answers. A fallback that
 * drifted to a second spelling would still produce a valid-looking payload, and
 * the disagreement would only ever show up as a model that does not stop.
 */
describe("a connection with no resolved template", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({ results: [{ text: "hi" }] })
		}))
		vi.stubGlobal("fetch", fetchMock)
	})
	afterEach(() => vi.unstubAllGlobals())

	const summarizerBody = async (connection: any): Promise<any> => {
		fetchMock.mockClear()
		const session = summarizerSession()
		const adapter = dispatchOnly(kobold.Adapter, connection, session)
		await adapter.generateText()
		const call = fetchMock.mock.calls.find((args: any[]) =>
			String(args[0]).includes("/api/v1/generate")
		)
		expect(call, "no text-completion request was sent").toBeDefined()
		return JSON.parse((call as any)[1].body)
	}

	const bare = (promptFormat: any) => ({
		id: 1,
		type: "koboldcpp",
		baseUrl: "http://localhost:5001",
		model: "koboldcpp",
		promptFormat,
		// Completion wire mode, because a completion template is what this
		// describe block is about and it has no effect in the other one.
		wireMode: "completion",
		extraJson: { stream: false }
	})

	// NULL, cleared, unresolved, and a built-in named by key with no row loaded.
	for (const promptFormat of [
		null,
		undefined,
		"",
		"no-such-template",
		"chatml"
	])
		test(`renders and stops with one template for ${JSON.stringify(promptFormat)}`, async () => {
			const expected = completionTemplateOf(promptFormatOf(promptFormat))
			const body = await summarizerBody(bare(promptFormat))

			// The render half — the system block's own framing, byte for byte.
			const framing = framingFor(expected, "system")
			expect(body.prompt.startsWith(framing.prefix), body.prompt).toBe(
				true
			)
			// The stop half — from the same row, not from a second resolution.
			expect(body.stop_sequence).toEqual(
				expect.arrayContaining(expected.stopStrings)
			)
		})

	/**
	 * ⚠ The ROW wins over the key, and this is the mutation that matters.
	 *
	 * Every other case here names a key that resolves to the default anyway, so
	 * they cannot tell "reads the row" from "falls back and lands in the same
	 * place". This one can: `promptFormat` names a BUILT-IN, so reading the key
	 * resolves — plausibly, silently, and to the wrong template. The attached
	 * row is a Vicuna an admin has replaced, and only a reader that prefers the
	 * row gets it.
	 */
	test("an attached row outranks a key that would also resolve", async () => {
		const shadow: CompletionTemplate = {
			...CUSTOM,
			key: "vicuna",
			name: "Not the shipped Vicuna"
		}
		const body = await summarizerBody({
			...bare("vicuna"),
			completionTemplate: shadow
		})
		expect(body.prompt).toContain("@@system@@")
		expect(body.prompt).not.toContain("### ")
		expect(body.stop_sequence).toEqual(
			expect.arrayContaining(CUSTOM.stopStrings)
		)
		expect(body.stop_sequence).not.toContain(VICUNA_LEAD_STOP)
	})
})
