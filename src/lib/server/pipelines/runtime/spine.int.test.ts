/**
 * The whole prompt path, as one pipeline.
 *
 * Every other test in this directory checks one node. This one checks that they
 * compose: an event arrives, history and lore are retrieved, the arms are fused
 * and ranked, a template context is built, a prompt is assembled and sent, and a
 * message is written back — all from a stored document, through the executor,
 * against real rows.
 *
 * The model is faked and only the model. Everything else — the store, the
 * registry, the host, the adapters' own `generateText()` — is the real code.
 *
 * What this does **not** prove is parity. It proves the spine runs end to end
 * and that each stage's output reaches the next one; whether the bytes match
 * `PromptBuilder.compilePrompt` is the corpus's job, and the corpus does not
 * exist yet.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { saveDocument, loadDocument } from "$lib/server/pipelines/boot/store"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

/** What the fake model was asked to say, so a test can read the prompt back. */
let lastPrompt: any = null

/**
 * `implements` is load-bearing here, more than anywhere else in this directory.
 *
 * `dispatch.ts`'s header records that THIS fake once "accepted whatever it was
 * given", so the pipeline was handing a real adapter a payload carrying neither
 * `prompt` nor `messages` — an empty generation that read as a model fault. The
 * clause pins the one action the fake stands in for at the real signature, so a
 * drift from it fails to compile rather than passing green. See
 * fakeTextAdapter.ts for why `implements AdapterActions` would check nothing.
 */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_params: any) {}
	withCompiledPrompt(p: any) {
		this.injected = p
		lastPrompt = p
		return this
	}
	abort() {}
	async generateText() {
		return {
			completionResult: "The Ashguard ride at dawn.",
			compiledPrompt: this.injected,
			isAborted: false
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1, systemPrompt: "Stay in character." }
	})
}))
vi.mock("$lib/server/embedding", () => ({
	// No embedding model: the keyword arm carries the turn on its own, which is
	// the configuration most installs are actually in.
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let sessionId: number
let userId: number
let characterId: number

// The document under test: the prompt path, wired end to end.
const promptPipeline = () =>
	compile(
		spec("core:spec/respond", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.query("lore", ($) =>
				C.lorebookTriggers.v1({ scope: $.input.sessionScope })
			)
			.query("cast", ($) =>
				C.sessionCast.v1({ scope: $.input.sessionScope })
			)
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					// The authored text reaches the *context* node as well as the
					// assembly one. Both need it and neither derives it from the
					// other; the first parity run rendered a blank system prompt
					// because only Assemble had it.
					prompts: slot.prompts()
				})
			)
			// The ranker is not optional decoration between retrieval and
			// assembly: it is what decides which candidates fit the budget.
			// Without it Assemble has candidates and no decisions, and used to
			// render them all away in silence.
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.main,
					params: slot.params()
				})
			)
			// Between the rows and the render: who said each line, and the seed
			// the model continues from.
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
					candidates: $.rank.candidates,
					decisions: $.rank.decisions,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					// The story string arrives through the slot, resolved from the
					// context config by `buildWorld` — not hardcoded in the spec.
					// That is the layer that decides which template *this* session
					// gets, and a test that skipped it would pass on an install
					// where no user could reproduce it.
					template: slot.template(),
					prompts: slot.prompts(),
					// Without this the budget resolves to zero and every block is
					// excluded — the prompt renders with its lore silently gone.
					params: slot.params()
				})
			)
			.provider("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.consume("save", ($) =>
				C.createMessage.v1({ text: $.generate.text })
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "spine-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alice",
			description: "A knight sworn to {{user}}.",
			personality: "Steady."
		})
		.returning()
	characterId = character.id

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
		})
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Spine Lore", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })

	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes.",
		retrievalStrategy: "keyword"
	})

	await db
		.insert(schema.sessionMessages)
		.values([
			{ sessionId, role: "user", content: "Have you seen the ashguard?" }
		])

	// ⚠ The story string used to be seeded as a `context_configs` row pointed at
	// by `system_settings.default_context_config_id`, on the stated grounds that
	// this was "the way the app reaches it". It has not been, since `world.ts`
	// stopped projecting that table — the template is a
	// `pipeline_context_templates` reference resolved through the config layer
	// now, and this ad-hoc spec has no config layer to resolve it through.
	//
	// **This test stayed green for the whole of that time while Assemble
	// rendered nothing of the kind.** The slot resolved to `{}`, the binding
	// coerced it with `String(...)` into the literal seven characters
	// `[object Object]`, that is a perfectly valid Handlebars template, and
	// every assertion here only checks that `rendered` is a *string*. Making
	// the engine reach the renderer is what surfaced it: an empty object has no
	// engine either.
	//
	// So the template is layered into the world directly, exactly as
	// `parity/harness.ts` does for the same reason — `source` and `engine`
	// together, never one alone.
	await db.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

const SPINE_TEMPLATE =
	"{{instructions}}\n{{characters}}\n{{#each sessionMessages}}{{this.content}}\n{{/each}}"

const execute = async (input: any = {}) => {
	const saved = await saveDocument(db as any, promptPipeline(), {
		publish: true
	})
	const doc = await loadDocument(db as any, saved.specVersionId)
	const world = await buildWorld(db as any, { sessionId })
	// At `defaults`, under anything a fixture might override — and as a PAIR,
	// which is the rule `world.ts`'s `pushTemplate` enforces on the real path.
	// A source with no engine now halts rather than being rendered as
	// Handlebars on a guess.
	world.overrides.push(
		{
			nodeKey: "prompt",
			slot: "template",
			path: "source",
			value: SPINE_TEMPLATE,
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
	return await run(doc, {
		world,
		input: {
			text: "Have you seen the ashguard?",
			sessionScope: { sessionId },
			...input
		},
		seed: "seed:spine",
		triggerSource: "event",
		bindings: coreBindings(),
		host: createHost(db as any, { sessionId, userId })
	})
}

describe("the prompt path, end to end", () => {
	it("runs from event to written message", async () => {
		const receipt = await execute()
		// Reported with the halt reason attached, because "outcome: halt" alone
		// sends whoever hits this reading seven node implementations to find out
		// which one stopped and why.
		expect({
			outcome: receipt.outcome,
			stoppedAt: (receipt as any).haltNodeKey,
			because: (receipt as any).haltReason
		}).toEqual({
			outcome: "ok",
			stoppedAt: undefined,
			because: undefined
		})

		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		expect(rows.map((r) => r.content)).toContain(
			"The Ashguard ride at dawn."
		)
	})

	it("every stage's output reaches the next one", async () => {
		// Named individually rather than asserted as "no halts", because a
		// pipeline that skipped a stage and still finished is the failure worth
		// catching — and it looks like success from the outcome alone.
		const receipt = await execute()
		const at = (key: string) =>
			receipt.nodes.find((n) => n.nodeKey === key)!

		expect(at("history").output).toBeTruthy()
		expect((at("lore").output as any).hits.length).toBeGreaterThan(0)
		expect((at("context").output as any).templateContext.char).toBe("Alice")
		// ⚠ Not just "is a string". That is all this asserted for the whole
		// period in which Assemble was rendering the literal `[object Object]`
		// — a template that never arrived, coerced into truthiness, compiled by
		// Handlebars without complaint. A type check cannot tell a prompt from
		// a stringified empty object; naming something the story string must
		// have put there can.
		const rendered = (at("prompt").output as any).context.rendered
		expect(rendered).toBeTypeOf("string")
		expect(rendered).not.toContain("[object Object]")
		// `{{characters}}` — a value only the story string could have placed
		// there, and one no coercion accident produces.
		expect(rendered).toContain("A knight sworn to Bob.")
		expect((at("generate").output as any).text).toBe(
			"The Ashguard ride at dawn."
		)
	})

	it("the prompt that reached the model was built by the pipeline", async () => {
		// The seam's whole purpose: what the adapter sent is what Assemble
		// produced, not something the adapter built for itself.
		//
		// Compared as a `CompiledPrompt` rather than as the allocation, because
		// that conversion is real work dispatch does — Assemble publishes blocks
		// plus a rendered string, an adapter wants `{prompt, messages, meta}`,
		// and for a while the pipeline was handing over the former while every
		// test's fake adapter accepted anything.
		const receipt = await execute()
		const assembled = (
			receipt.nodes.find((n) => n.nodeKey === "prompt")!.output as any
		).context
		expect(lastPrompt?.prompt).toBe(assembled.rendered)
		expect(lastPrompt?.meta?.promptFormat).toBe("vicuna")
	})

	it("the character card the pipeline built carries the interpolated name", async () => {
		// Proves the context node ran against real cast rows rather than
		// returning an empty shell that the template rendered as blanks.
		const receipt = await execute()
		const ctx = (
			receipt.nodes.find((n) => n.nodeKey === "context")!.output as any
		).templateContext
		expect(ctx.characters).toContain("A knight sworn to Bob.")
		expect(ctx.characterNames).toBe("Alice")
	})

	it("the lore the keyword arm matched is in the receipt with its reason", async () => {
		const receipt = await execute()
		const lore = receipt.nodes.find((n) => n.nodeKey === "lore")!
			.output as any
		expect(lore.hits[0].payload.name).toBe("The Ashguard")
		// Why RAG did not run is answerable from the receipt rather than from
		// the embedding settings screen.
		expect(lore.diagnostics.vectorSearch).toMatch(/no embedding model/)
	})

	it("the receipt names every node that ran, in order", async () => {
		const receipt = await execute()
		expect(receipt.nodes.map((n) => n.nodeKey)).toEqual([
			"input",
			"history",
			"lore",
			"cast",
			"context",
			"rank",
			"lines",
			"prompt",
			"generate",
			"save"
		])
	})
})
