/**
 * The post-history block reaches the wire as one unit, or not at all.
 *
 * `postHistory.test.ts` pins the decision on literals. This one is the half
 * that literals cannot reach: the card's own reminder and example dialogue
 * travel from `characters` rows through the context builder into the SHIPPED
 * context template, and it is the template that turns them into a system
 * message. So a decision that says "suppressed" while the template still has
 * three fields to render produces a receipt and a prompt that disagree — and
 * only a render can tell them apart.
 *
 * The trigger is set the way a person sets it, on the Session Prompt, and the
 * assertion is on the assembled messages rather than on the diagnostics beside
 * them: below the trigger the whole block stays out, headings included.
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

/** The shipped spec's own wiring, reduced to the nodes this question needs. */
const promptPipeline = () =>
	compile(
		spec("core:spec/post-history-block", { version: "1.0.0" })
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

	const [user] = await db
		.insert(schema.users)
		.values({ username: "post-history-block", isAdmin: false })
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
		.values({ userId, isGroup: false })
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
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		personaId: persona.id,
		content: "Where do the riders patrol?",
		isGenerating: false
	})

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
}, 60_000)

/** Render this session's next turn with the reminder's trigger set to `postHistoryTokenTrigger`. */
async function renderWith(postHistoryTokenTrigger: number) {
	const world = await buildWorld(db, { sessionId })
	// The prompt, layered the way the parity harness does: this ad-hoc spec
	// has no config layer to select a prompt row through.
	layerParityPrompts(world, {
		systemPrompt: "You are {{char}}.",
		postHistoryInstructions: RESPONSE_REMINDER,
		postHistoryDepth: 0,
		postHistoryTokenTrigger
	})
	// The shipped story string, layered the way `pipelinePreview` does it: this
	// ad-hoc spec has no config layer to resolve a template reference through,
	// and `source` and `engine` travel together or not at all.
	world.overrides.push(
		{
			nodeKey: "prompt",
			slot: "template",
			path: "source",
			value: SHIPPED_CONTEXT_TEMPLATE,
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

	const receipt: any = await run(promptPipeline(), {
		world,
		input: {
			text: "Where do the riders patrol?",
			sessionScope: { sessionId, currentCharacterId: characterId }
		},
		seed: `post-history-block-${postHistoryTokenTrigger}`,
		triggerSource: "ui",
		// Halts at the Provider with the payload built, so this is the real
		// thing rather than a reconstruction of it.
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
	const messages: Array<{ role: string; content: string }> =
		payload.messages ?? []
	expect(messages.length, "the render produced no messages").toBeGreaterThan(
		0
	)
	// ⚠ This connection is Ollama, whose chat wire FOLDS depth-placed system
	// text into the nearest user message (AN3, `midSystemFor`): Ollama's
	// templates would hoist a late system message to the top. So the block
	// is looked for on the whole wire, and pinned to the last user message
	// with exactly one system message — the top — left.
	expect(messages.filter((m) => m.role === "system")).toHaveLength(1)
	return {
		system: messages.map((m) => m.content).join("\n"),
		lastUser: [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
		diagnostics: receipt.nodes?.find((n: any) => n.nodeKey === "prompt")
			?.output?.postHistory
	}
}

describe("the post-history block on the wire", () => {
	it("carries all three parts once the history is at least the trigger", async () => {
		const { system, lastUser, diagnostics } = await renderWith(1)
		expect(lastUser).toMatch(/\[System note\]\nResponse reminder:/)
		expect(system).toContain("Response reminder:")
		expect(system).toContain(RESPONSE_REMINDER)
		expect(system).toContain("Character reminder:")
		expect(system).toContain(CHARACTER_REMINDER)
		expect(system).toContain("Example dialogue:")
		expect(system).toContain(EXAMPLE_DIALOGUE)
		expect(diagnostics).toMatchObject({
			included: true,
			reason: "included",
			trigger: 1,
			hasCharInstructions: true,
			hasExampleDialogue: true
		})
	}, 60_000)

	it("sends none of it below the trigger, headings included", async () => {
		const { system, diagnostics } = await renderWith(100000)
		// The receipt and the prompt say the same thing: a suppressed verdict
		// means no part of the block on the wire, headings included.
		expect(system).not.toContain("Response reminder:")
		expect(system).not.toContain("Character reminder:")
		expect(system).not.toContain("Example dialogue:")
		expect(system).not.toContain(CHARACTER_REMINDER)
		expect(system).not.toContain(EXAMPLE_DIALOGUE)
		expect(diagnostics).toMatchObject({
			included: false,
			reason: "below_token_trigger",
			trigger: 100000,
			// Facts about what the block would have carried, which is what
			// makes the suppression readable rather than merely reported.
			hasCharInstructions: true,
			hasExampleDialogue: true
		})
	}, 60_000)
})
