/**
 * The author's note reaches the wire (AN1): a Chat session's stored note
 * travels from `sessions.genre_fields` through the inlet's `fields` and the
 * context builder to Assemble, which places it by the post-history block's
 * arithmetic and its own interval, and the SHIPPED Default template renders it
 * — first at its index, before the post-history reminder. The assertion is on
 * the assembled messages, so the receipt's verdict and the prompt agree.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { layerParityPrompts } from "$lib/server/pipelines/parity/harness"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { spec, compile, run, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { CHAT_GENRE_ID } from "@serene-pub/core-catalog"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let sessionId: number
let userId: number
let characterId: number

/** The three texts, one per part of the block. */
const RESPONSE_REMINDER = "Write one reply only."
const CHARACTER_REMINDER = "Marrow never lies."
const EXAMPLE_DIALOGUE = "Wren: I know the fog roads."
/** The person's own note for this session. */
const NOTE = "[The fog is lifting over the moor.]"

/** The shipped spec's own wiring, reduced to the nodes this question needs. */
const promptPipeline = () =>
	compile(
		spec("core:spec/authors-note-block", { version: "1.0.0" })
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
					prompts: slot.prompts(),
					// The wire respond ships (AN1): the genre's fields.
					fields: $.input.fields
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
					// The slot the Session Prompt's two numbers project onto,
					// which is what makes the trigger below a person's setting
					// rather than a literal handed to the binding.
					params: slot.params(),
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
	// The genre registry: `genreFieldsFor` keeps only the keys Chat declares,
	// and the cast read counts replies only for a genre declaring the note.
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "authors-note-block", isAdmin: false })
		.returning()
	userId = user.id

	// The two card-authored parts, on the character who speaks this turn.
	const [character] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Marrow",
			description: "A knight.",
			postHistoryInstructions: CHARACTER_REMINDER,
			exampleDialogues: [EXAMPLE_DIALOGUE]
		})
		.returning()
	characterId = character.id

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
		.values({
			userId,
			isGroup: false,
			genreId: CHAT_GENRE_ID,
			genreFields: { authorsNote: { text: NOTE, depth: 1, interval: 2, role: "system" } }
		} as any)
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values([
		{ sessionId, role: "user", personaId: persona.id, content: "Hello there.", isGenerating: false },
		{ sessionId, role: "assistant", characterId, content: "Well met.", isGenerating: false },
		{ sessionId, role: "user", personaId: persona.id, content: "Where do the riders patrol?", isGenerating: false }
	])

	/**
	 * A REGISTERED connection in CHAT wire mode, and both halves are load
	 * bearing. Merely saving a row selects nothing, so the assemble node's
	 * connection slot resolves to nothing; and a completion-wire connection
	 * renders one flat string, which has no system message to assert on. This
	 * type declares and defaults both modes, so it resolves to chat with no
	 * override to write.
	 */
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Chat Under Test",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			tokenCounter: "estimate"
		})
		.returning()
	const [chatModel] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: connection.id, model: "test", name: "test" })
		.returning()
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		connectionModelId: chatModel.id
	})
}, 120_000)

/** Set the session's stored note, then render its next turn. */
async function render(note: Record<string, unknown>) {
	await db
		.update(schema.sessions)
		.set({ genreFields: { authorsNote: note } } as any)
		.where(eq(schema.sessions.id, sessionId))
	const world = await buildWorld(db, { sessionId })
	layerParityPrompts(world, {
		systemPrompt: "You are {{char}}.",
		postHistoryInstructions: RESPONSE_REMINDER,
		postHistoryDepth: 0,
		postHistoryTokenTrigger: 0
	})
	world.overrides.push(
		{ nodeKey: "prompt", slot: "template", path: "source", value: SHIPPED_CONTEXT_TEMPLATE, scopeKind: "defaults" } as any,
		{ nodeKey: "prompt", slot: "template", path: "engine", value: CORE_TEMPLATE_ENGINE, scopeKind: "defaults" } as any
	)
	const receipt: any = await run(promptPipeline(), {
		world,
		input: {
			text: "Where do the riders patrol?",
			sessionScope: { sessionId, currentCharacterId: characterId },
			fields: await genreFieldsFor(db, sessionId)
		},
		seed: "authors-note-block",
		triggerSource: "ui",
		preview: true,
		compactHaltReceipts: false,
		bindings: coreBindings(),
		host: createHost(db, { sessionId, userId })
	})
	const payload = receipt?.preview?.context?.rendered
	expect(
		payload,
		`the run did not reach the Provider: ${receipt?.outcome} ` +
			`${receipt?.haltNodeKey ?? ""} ${receipt?.haltReason ?? ""}`
	).toBeTruthy()
	const messages: Array<{ role: string; content: string }> = payload.messages ?? []
	return {
		messages,
		diagnostics: receipt.nodes?.find((n: any) => n.nodeKey === "prompt")?.output?.authorsNote
	}
}

const indexOf = (messages: Array<{ content: string }>, text: string) =>
	messages.findIndex((m) => m.content.includes(text))

describe("the author's note on the wire (AN1)", () => {
	it("goes in at its depth, before the post-history reminder, as the role it names", async () => {
		// One completed reply ("Well met.") so far: at an interval of 1 it applies.
		const { messages, diagnostics } = await render({ text: NOTE, depth: 1, interval: 1, role: "system" })
		const note = indexOf(messages, NOTE)
		expect(note, JSON.stringify(messages)).toBeGreaterThan(-1)
		// ⚠ This connection's chat wire FOLDS depth-placed system text (AN3,
		// `midSystemFor`): the note rides the next user message — the
		// person's last line, one real message after it at depth 1 — as a
		// labelled aside BEFORE their words, and the depth-0 reminder rides
		// the same message after them. Positions are compared inside it.
		expect(messages[note]!.role).toBe("user")
		expect(messages.filter((m) => m.role === "system")).toHaveLength(1)
		const carried = messages[note]!.content
		expect(note).toBe(indexOf(messages, "Where do the riders patrol?"))
		expect(note).toBeGreaterThan(indexOf(messages, "Well met."))
		expect(carried.indexOf(`[System note]\n${NOTE}`)).toBeGreaterThan(-1)
		expect(carried.indexOf(NOTE)).toBeLessThan(carried.indexOf("Where do the riders patrol?"))
		expect(carried.indexOf(NOTE)).toBeLessThan(carried.indexOf(RESPONSE_REMINDER))
		expect(diagnostics).toMatchObject({ included: true, reason: "included", depth: 1, replyCount: 1 })

		const asUser = await render({ text: NOTE, depth: 0, interval: 1, role: "user" })
		const at = indexOf(asUser.messages, NOTE)
		expect(asUser.messages[at]!.role).toBe("user")
		// Depth 0, same index as the reminder: the note first — the reminder
		// folds onto the end of the note's own user message.
		const held = asUser.messages[at]!.content
		expect(held.indexOf(NOTE)).toBeLessThan(held.indexOf(RESPONSE_REMINDER))
	}, 60_000)

	it("with no depth stored, goes at the end — after the newest message, before the reminder (owner ruling 2026-10-03)", async () => {
		const { messages, diagnostics } = await render({ text: NOTE, interval: 1, role: "system" })
		expect(diagnostics).toMatchObject({ included: true, depth: 0 })
		// Folded on this connection: the person's newest line carries it,
		// AFTER their words, and the reminder after it, closest to the reply.
		const at = indexOf(messages, NOTE)
		expect(at).toBe(messages.length - 1)
		const carried = messages[at]!.content
		expect(carried.indexOf("Where do the riders patrol?")).toBeLessThan(carried.indexOf(NOTE))
		expect(carried.indexOf(NOTE)).toBeLessThan(carried.indexOf(RESPONSE_REMINDER))
	}, 60_000)

	it("skips a reply its interval does not land on, and says so", async () => {
		// One reply so far; every second reply: this is not one of them.
		const { messages, diagnostics } = await render({ text: NOTE, depth: 1, interval: 2, role: "system" })
		expect(indexOf(messages, NOTE)).toBe(-1)
		expect(diagnostics).toMatchObject({ included: false, reason: "interval", replyCount: 1, interval: 2 })
	}, 60_000)

	it("an empty note adds nothing, and the prompt is the one without a note", async () => {
		const { messages, diagnostics } = await render({ text: "", depth: 4, interval: 1, role: "system" })
		expect(diagnostics).toMatchObject({ included: false, reason: "empty" })
		expect(messages.some((m) => m.content.trim() === "")).toBe(false)
	}, 60_000)
})
