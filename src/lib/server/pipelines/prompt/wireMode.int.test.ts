/**
 * The assembled prompt reaches the model — on a CHAT connection, end to end.
 *
 * ## The defect these three cases prove
 *
 * On the pipeline path a chat-completions connection discarded the entire
 * assembled prompt. Confirmed empirically before this file existed:
 *
 *  - **Anthropic** sent `{system: "", messages: [{role: "user", content:
 *    "Hello"}]}` — the literal word "Hello", from the empty-messages floor in
 *    `buildAnthropicMessages`, because the payload it was handed carried a flat
 *    `prompt` and no `messages` at all.
 *  - **KoboldCPP** with its default `extraJson.useChat: true` posted to
 *    `/v1/chat/completions` with **no `messages` key**, because the branch read
 *    `compiledPrompt.messages!` and `JSON.stringify` drops `undefined`.
 *
 * The cause was one decision made in two places that could not see each other.
 * The legacy builder chose the shape as "chat if the adapter says so, else the
 * connection's format", and "the adapter says so" came from adapter-local flags
 * read inside `compilePrompt(args)`. The pipeline hands its payload over through
 * `withCompiledPrompt`, which returns before `compilePrompt` looks at its
 * argument — so the flag was never set, and the adapter branched on a default
 * that disagreed with the payload it had been given.
 *
 * Wire mode is a CONNECTION CAPABILITY now (ruled 2026-09-07), resolved once
 * from the row's four layers and read by both halves: `config/world.ts` puts it
 * on the descriptor the render sees, and `withWireMode` puts it on the row the
 * adapter sees. One value, so the two cannot disagree.
 *
 * ## Why this file goes all the way to the wire
 *
 * A test that asserted on the assemble node's output would have passed against
 * a fix that never reached an adapter, and a test that handed an adapter a
 * literal messages array would have proved nothing about the render. The defect
 * lived exactly in the join, so each case here runs the REAL pipeline against a
 * REAL connection row, converts through `toCompiledPrompt` the way every caller
 * does, constructs the REAL adapter through the same two wrappers the loader
 * uses, and reads the outgoing request off a mocked transport.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { toCompiledPrompt } from "$lib/server/pipelines/runtime/dispatch"
import { withCompletionTemplate } from "$lib/server/connections/completionTemplates"
import { withWireMode } from "$lib/server/connections/resolve"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

/**
 * The Anthropic SDK, replaced by a recorder.
 *
 * The whole assertion is "what went out", so the transport is the one thing
 * that has to be fake and nothing else is: the prompt is assembled by the real
 * pipeline and converted by the real `toCompiledPrompt`.
 */
const anthropicSent = vi.hoisted(() => [] as any[])
vi.mock("@anthropic-ai/sdk", () => ({
	default: class {
		messages = {
			create: async (params: any) => {
				anthropicSent.push(params)
				return { content: [{ type: "text", text: "ok" }] }
			},
			stream: vi.fn()
		}
		constructor() {}
	}
}))

// The module default-export shape every adapter ships (`AdapterExports`), which
// is what `getConnectionAdapter` hands back — so these are the same classes a
// real run constructs.
const AnthropicAdapter = (
	await import("$lib/server/connectionAdapters/AnthropicAdapter")
).default.Adapter
const KoboldCppAdapter = (
	await import("$lib/server/connectionAdapters/KoboldCppAdapter")
).default.Adapter

let db: TestDb
let sessionId: number
let userId: number
let anthropicId: number
let koboldId: number
/** The explicit model row per endpoint — every registration names the pair. */
const modelByConnection = new Map<number, number>()

/** The line a real user typed. Present in the assembled prompt; not in "Hello". */
const USER_LINE = "Where do the riders patrol?"

/**
 * A story string with role blocks in it.
 *
 * The three block helpers are the only things in a template that consult the
 * prompt format, so a template without them would render identically in both
 * wire modes and make the completion case pass vacuously.
 */
const TEMPLATE = [
	"{{#systemBlock}}You are narrating.{{/systemBlock}}",
	"{{#each sessionMessages}}",
	"{{#if (eq this.role 'assistant')}}",
	"{{#assistantBlock}}{{this.name}}: {{this.message}}{{/assistantBlock}}",
	"{{else}}",
	"{{#userBlock}}{{this.name}}: {{this.message}}{{/userBlock}}",
	"{{/if}}",
	"{{/each}}"
].join("\n")

/**
 * The shipped specs' wiring, reduced to the nodes this question needs.
 *
 * `connection: slot.connectionOf("generate")` is the line that makes the render
 * and the send share one connection — and therefore one wire mode.
 */
const wirePipeline = () =>
	compile(
		spec("core:spec/wire-mode", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.query("cast", ($) =>
				C.sessionCast.v1({ scope: $.input.sessionScope })
			)
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					prompts: slot.prompts()
				})
			)
			.task("lines", ($) =>
				C.processMessages.v1({
					messages: $.history.messages,
					cast: $.cast.cast,
					templateContext: $.context.templateContext,
					seedName: $.context.seedName
				})
			)
			.task("prompt", ($) =>
				C.assemble.v2({
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					prompts: slot.prompts({ node: "context" }),
					connection: slot.connectionOf("generate")
				})
			)
			.oracle("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "wire-mode", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()

	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			isPersona: true,
			name: "Bob",
			description: "A traveller."
		})
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: character.id,
		isActive: true,
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		personaId: persona.id,
		content: USER_LINE,
		isGenerating: false
	})

	// Real rows. Nothing selects a connection because it merely exists
	// (`capabilityTarget.ts`), so each test registers the one it is about.
	const [anthropic] = await db
		.insert(schema.connections)
		.values({
			name: "Claude",
			type: CONNECTION_TYPE.ANTHROPIC,
			baseUrl: "",
			// A format is SET, and it must make no difference: the native
			// Messages API declares no `wire_completion` at all, so this
			// connection resolves to chat and the delimiters have nothing to
			// wrap. A row carrying one is the realistic case — every connection
			// form has offered the picker to every type until now.
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: "estimate",
			extraJson: { apiKey: "sk-ant-test", stream: false }
		})
		.returning()
	anthropicId = anthropic.id
	const [anthropicModel] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: anthropic.id,
			model: "claude-sonnet-4-5",
			name: "claude-sonnet-4-5"
		})
		.returning()
	modelByConnection.set(anthropic.id, anthropicModel.id)

	const [kobold] = await db
		.insert(schema.connections)
		.values({
			name: "KoboldCPP",
			type: CONNECTION_TYPE.KOBOLDCPP,
			baseUrl: "http://localhost:5001",
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: "estimate",
			extraJson: { stream: false }
		})
		.returning()
	koboldId = kobold.id
	const [koboldModel] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: kobold.id, model: "test", name: "test" })
		.returning()
	modelByConnection.set(kobold.id, koboldModel.id)
}, 60_000)

/** Register a connection as the instance's `text->text` default and render. */
async function renderFor(connectionId: number) {
	await setCapabilityDefault(db, "text->text", {
		connectionId,
		connectionModelId: modelByConnection.get(connectionId) ?? null
	})

	const world = await buildWorld(db, { sessionId })
	// The story string, layered the way `pipelinePreview` does it: this ad-hoc
	// spec has no config layer to resolve a template reference through, and
	// `source` and `engine` travel together or not at all.
	world.overrides.push(
		{
			nodeKey: "prompt",
			slot: "template",
			path: "source",
			value: TEMPLATE,
			scopeKind: "defaults"
		} as any,
		{
			nodeKey: "prompt",
			slot: "template",
			path: "engine",
			value: CORE_TEMPLATE_ENGINE,
			scopeKind: "defaults"
		} as any
	)

	const receipt: any = await run(wirePipeline(), {
		world,
		input: {
			text: USER_LINE,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "wire-mode",
		triggerSource: "ui",
		// Halts at the Provider with the payload built, so this is the real
		// thing rather than a reconstruction of it.
		preview: true,
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId })
	})

	const payload = receipt?.preview?.context?.rendered
	expect(
		payload,
		`the run did not reach the Provider: ${receipt?.outcome} ` +
			`${receipt?.haltNodeKey ?? ""} ${receipt?.haltReason ?? ""}`
	).toBeTruthy()
	return payload
}

/** The pair as an adapter receives it — the same wrappers the loader applies. */
async function adapterConnection(connectionId: number) {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, connectionId))
		.limit(1)
	const modelId = modelByConnection.get(connectionId)
	const { connectionModelById, mergeEndpointModel } = await import(
		"$lib/server/connections/models"
	)
	const modelRow = modelId
		? await connectionModelById(db, modelId)
		: undefined
	return withWireMode(
		await withCompletionTemplate(
			db,
			mergeEndpointModel(row, modelRow) as any
		)
	)
}

const adapterArgs = (connection: any) => ({
	connection,
	sampling: {} as any,
	contextConfig: {} as any,
	promptConfig: { systemPrompt: "You are narrating." } as any,
	session: {
		id: sessionId,
		userId,
		sessionType: "session",
		metadata: { ragIgnored: true },
		sessionMessages: [],
		sessionCharacters: [],
		sessionPersonas: [],
		lorebook: null
	} as any,
	currentCharacterId: null
})

describe("a chat connection is sent the assembled prompt", () => {
	it("Anthropic receives the real turns, not the placeholder greeting", async () => {
		anthropicSent.length = 0

		const payload = await renderFor(anthropicId)
		const connection = await adapterConnection(anthropicId)
		const compiled = toCompiledPrompt(payload, connection)

		const adapter = new AnthropicAdapter({
			...adapterArgs(connection),
			tokenCounter: { countTokens: async (t: string) => t.length } as any,
			tokenLimit: 4096,
			contextThresholdPercent: 0.9
		} as any)
		adapter.withCompiledPrompt(compiled)
		await adapter.generateText()

		expect(anthropicSent).toHaveLength(1)
		const sent = anthropicSent[0]

		// ⚠ THE defect, stated as an assertion. Before the fix this array was
		// exactly `[{role: "user", content: "Hello"}]` and `system` was `""`.
		const asText = JSON.stringify(sent)
		expect(asText).toContain(USER_LINE)
		expect(sent.messages.some((m: any) => m.content === "Hello")).toBe(
			false
		)
		// The system block is promoted to Anthropic's top-level `system`, which
		// only happens when the payload carried a real system-role message.
		expect(sent.system).toContain("You are narrating")

		// And no marker survives into content. `split_chat` is the transport
		// hack the messages are parsed back out of; a leaked `<@role:` would mean
		// the parse did not run.
		for (const m of sent.messages)
			expect(JSON.stringify(m.content)).not.toContain("<@role:")
	}, 60_000)

	it("KoboldCPP's chat-completions request carries a populated messages array", async () => {
		const calls: Array<{ url: string; body: any }> = []
		const fetchMock = vi.fn(async (url: any, init: any) => {
			calls.push({
				url: String(url),
				body: init?.body ? JSON.parse(init.body) : undefined
			})
			return {
				ok: true,
				status: 200,
				json: async () => ({
					choices: [{ message: { content: "ok" } }]
				})
			} as any
		})
		vi.stubGlobal("fetch", fetchMock)
		try {
			const payload = await renderFor(koboldId)
			const connection = await adapterConnection(koboldId)
			const compiled = toCompiledPrompt(payload, connection)

			const adapter = new KoboldCppAdapter(adapterArgs(connection) as any)
			adapter.withCompiledPrompt(compiled)
			await adapter.generateText()

			const post = calls.find((c) =>
				c.url.includes("/v1/chat/completions")
			)
			expect(
				post,
				`no chat-completions request was made; saw ${calls
					.map((c) => c.url)
					.join(", ")}`
			).toBeTruthy()
			// ⚠ Before the fix the key was ABSENT — `compiledPrompt.messages!`
			// was `undefined` and `JSON.stringify` drops it, so KoboldCPP was
			// asked to continue a conversation it was never shown.
			expect(Array.isArray(post!.body.messages)).toBe(true)
			expect(post!.body.messages.length).toBeGreaterThan(0)
			expect(JSON.stringify(post!.body.messages)).toContain(USER_LINE)
		} finally {
			vi.unstubAllGlobals()
		}
	}, 60_000)
})

describe("a completion connection is byte-unchanged", () => {
	/**
	 * The exact prompt a Vicuna text-completion KoboldCPP connection was sent
	 * before wire mode existed, captured from a run of this very file against
	 * the pre-change code and pinned as a literal.
	 *
	 * A literal rather than a re-derivation on purpose: a test that rebuilt the
	 * expected string from the same template rows the renderer uses would follow
	 * the renderer wherever it went, which is precisely the property "unchanged"
	 * must not have.
	 */
	const VICUNA_PROMPT =
		"### System:\nYou are narrating.\n\n" +
		"### User:\nBob: Where do the riders patrol?\n\n" +
		"### Assistant:\nNarrator: \n"

	it("still renders one flat Vicuna string and posts it to /api/v1/generate", async () => {
		// Completion mode stated as a hand-set override, which is the sentence
		// the capability panel promises: "a hand-set value outranks every test
		// that comes after it". `wire_chat: false` is an explicit off, not an
		// absence — the auto state is the key being missing.
		await db
			.update(schema.connections)
			.set({ capabilities: { overrides: { wire_chat: false } } })
			.where(eq(schema.connections.id, koboldId))

		const calls: Array<{ url: string; body: any }> = []
		const fetchMock = vi.fn(async (url: any, init: any) => {
			calls.push({
				url: String(url),
				body: init?.body ? JSON.parse(init.body) : undefined
			})
			return {
				ok: true,
				status: 200,
				json: async () => ({ results: [{ text: "ok" }] })
			} as any
		})
		vi.stubGlobal("fetch", fetchMock)
		try {
			const payload = await renderFor(koboldId)

			// The render half: one string, no messages, in the connection's own
			// completion template.
			expect(payload.messages).toBeUndefined()
			expect(payload.rendered).toBe(VICUNA_PROMPT)

			const connection = await adapterConnection(koboldId)
			const compiled = toCompiledPrompt(payload, connection)
			expect(compiled.prompt).toBe(VICUNA_PROMPT)

			const adapter = new KoboldCppAdapter(adapterArgs(connection) as any)
			adapter.withCompiledPrompt(compiled)
			await adapter.generateText()

			const post = calls.find((c) => c.url.includes("/api/v1/generate"))
			expect(
				post,
				`no text-completion request was made; saw ${calls
					.map((c) => c.url)
					.join(", ")}`
			).toBeTruthy()
			expect(post!.body.prompt).toBe(VICUNA_PROMPT)
			expect(post!.body.messages).toBeUndefined()
		} finally {
			vi.unstubAllGlobals()
			await db
				.update(schema.connections)
				.set({ capabilities: {} })
				.where(eq(schema.connections.id, koboldId))
		}
	}, 60_000)
})
