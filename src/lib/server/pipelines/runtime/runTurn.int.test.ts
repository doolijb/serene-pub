/**
 * A chat turn, run as a pipeline against real rows.
 *
 * The last integration point: everything below this has its own tests, and this
 * one asks whether the app could actually call it — the spec loads from the
 * database the bootstrap published it to, the world resolves from real config
 * rows, and the turn writes a real message.
 *
 * The model is faked and only the model.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

// Whichever test runs a turn first pays the cold dynamic import of the entire
// dispatch chain — the SDK, the contracts, the host bindings, the legacy adapter
// and Handlebars — which on a slow machine is comfortably past vitest's 5s
// default. Raised per file rather than per test deliberately: the cost belongs
// to the *first* turn, not to any particular assertion, so a per-test timeout
// would make this file pass or fail depending on the order its tests ran in.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

let streamed: string[] = []

class FakeAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generate() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				for (const chunk of ["The Ashguard ", "ride at dawn."])
					onContent(chunk)
			}
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
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let chatId: number
let userId: number
let characterId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "turn-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Alice",
			description: "A knight sworn to {{user}}."
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
		.values({ name: "Turn Lore", userId })
		.returning()
	await db.insert(schema.worldLoreEntries).values({
		lorebookId: lorebook.id,
		name: "The Ashguard",
		keys: "ashguard",
		content: "Riders who patrol the ash wastes.",
		retrievalStrategy: "keyword"
	})

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	chatId = chat.id

	await db
		.insert(schema.chatCharacters)
		.values({ chatId, characterId, isActive: true, visibility: "visible" })
	await db
		.insert(schema.chatPersonas)
		.values({ chatId, personaId: persona.id })
	await db.insert(schema.chatMessages).values({
		chatId,
		role: "user",
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({
			name: "Turn Context",
			// `{{{instructions}}}`, not `{{instructions}}`. Since 0.6 a value
			// arrives carrying its own heading and fence, and a double stash
			// HTML-escapes the fence — this fixture rendered
			// `Instructions:\n&quot;&quot;&quot;` until it was a triple.
			template:
				"{{{instructions}}}\nLORE:{{{worldLore}}}\n{{#each chatMessages}}{{this.name}}: {{this.message}}\n{{/each}}"
		})
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({ name: "Turn Prompt", systemPrompt: "You are {{char}}." })
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})

	// The story string reaches the pipeline from `pipeline_context_templates`
	// now, selected through the config layer — `context_configs` above is the
	// legacy row and nothing renders it. Written as an instance override rather
	// than by editing the shipped config, because that is what choosing a
	// template in the panel actually does.
	const { createContextTemplate } = await import("$lib/server/pipelines/entities/contextTemplates")
	const { CONTEXT_TEMPLATE_NODE_TYPE } = await import(
		"$lib/server/pipelines/entities/contextTemplateDefaults"
	)
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const template = await createContextTemplate(db as any, {
		nodeTypeId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: "Turn Template",
		source: contextConfig.template!
	})
	const [respondSpec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		.limit(1)
	// By node type, not "the first template slot": every `template` slot is a
	// reference now, so the history and lore queries have one too, and picking
	// the first one silently configures the wrong node.
	const decl = (
		await declarations(db as any, respondSpec.activeVersionId!)
	).find(
		(d) =>
			d.control === "context-template-ref" &&
			d.nodeTypeId === CONTEXT_TEMPLATE_NODE_TYPE
	)!
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: respondSpec.id,
		scopeKind: "instance",
		scopeId: 0,
		nodeKey: decl.nodeKey,
		slot: decl.slot,
		path: decl.path,
		value: template.id
	})
}, 60_000)

const turn = async (over: any = {}) => {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db: db as any,
		chatId,
		userId,
		currentCharacterId: characterId,
		text: "Have you seen the ashguard?",
		...over
	})
}

describe("running a turn", () => {
	it("runs the spec the bootstrap published, from rows", async () => {
		// Nothing here constructs a document: it is loaded from the table the
		// startup path wrote it to, which is the difference between "the
		// pipeline works" and "the app could run the pipeline".
		const { generatedText, haltExplanation } = await import("$lib/server/pipelines/runtime/runTurn")
		const receipt = await turn()

		expect(haltExplanation(receipt)).toBe(null)
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
	})

	it("writes the message it generated", async () => {
		await turn({ seed: "turn:written" })
		const rows = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))
		expect(rows.map((r) => r.content)).toContain(
			"The Ashguard ride at dawn."
		)
	})

	it("streams to the sink while still putting the whole text on the port", async () => {
		// The user watches it arrive; the receipt records one value. A socket
		// handle is not a value — it would land in the receipt and in every
		// downstream node's input.
		const { generatedText } = await import("$lib/server/pipelines/runtime/runTurn")
		streamed = []
		const receipt = await turn({
			seed: "turn:stream",
			sink: { onChunk: (c: string) => streamed.push(c) }
		})
		expect(streamed).toEqual(["The Ashguard ", "ride at dawn."])
		expect(generatedText(receipt)).toBe("The Ashguard ride at dawn.")
		expect(JSON.stringify(receipt)).not.toContain("onChunk")
	})

	it("previews without sending or writing anything", async () => {
		const before = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))

		const receipt: any = await turn({ preview: true, seed: "turn:preview" })
		const after = await db
			.select()
			.from(schema.chatMessages)
			.where(eq(schema.chatMessages.chatId, chatId))

		expect(receipt.preview?.context?.rendered?.rendered).toContain(
			'LORE:World lore: \n```json\n{"The Ashguard"'
		)
		// The whole point of a preview: it is the real payload, and nothing
		// happened.
		expect(after).toHaveLength(before.length)
	})

	it("says plainly when the spec was never published", async () => {
		const { runTurn, PipelineUnavailableError } = await import("$lib/server/pipelines/runtime/runTurn")
		await expect(
			runTurn({
				db: db as any,
				chatId,
				userId,
				currentCharacterId: characterId,
				text: "x",
				specId: "core:spec/not-published"
			})
		).rejects.toThrow(PipelineUnavailableError)
	})
})
