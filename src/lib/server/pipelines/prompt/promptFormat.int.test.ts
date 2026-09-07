/**
 * The connection's prompt format reaches the render — end to end.
 *
 * ## What was broken
 *
 * `prompt/assemble.ts` decided every wrapper from `input.promptFormat`, and
 * **nothing ever supplied it**: `core:task/assemble@2` declared no such port or
 * slot, neither shipped spec wired one, and `runtime/bindings.ts` read
 * `input?.promptFormat` off an object that never had the key. So
 * `prompt/renderers.ts` took its `?? "vicuna"` fallback on every run and every
 * ChatML, Llama-2, Alpaca, OpenAI and Claude connection was sent Vicuna
 * markers — while `runtime/dispatch.ts` stamped the receipt with the
 * connection's REAL format, so the receipt asserted a format the render had not
 * used. The whole existing test surface is Vicuna-only, which is why it
 * survived: `"vicuna"` is what the bug produces AND what the correct code
 * produces, so no Vicuna fixture can tell them apart.
 *
 * This file is the fixture that can. Every case here binds a **non-Vicuna**
 * connection and reads the bytes back.
 *
 * ## Through the real resolution, not a literal
 *
 * The format arrives on assemble's `connection` slot, which every shipped spec
 * wires to the node that SENDS (`slot.connectionOf("generate")`) — so what is
 * exercised is `buildWorld`'s manifest, the executor's shared-slot resolution
 * and the binding's read of it, against a real `connections` row registered as
 * the instance's `text->text` default. A test that handed the binding a literal
 * would prove none of that, and it is all of that which was missing.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { toCompiledPrompt } from "$lib/server/pipelines/runtime/dispatch"
import { PromptBlockFormatter } from "$lib/shared/utils/PromptBlockFormatter"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
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
let connectionId: number

/**
 * The story string, in the shape a real context template has.
 *
 * The three block helpers are the point: `systemBlock`/`userBlock`/
 * `assistantBlock` are the only things in a template that consult the prompt
 * format, so a template without them renders identically under every format and
 * would make this whole file pass vacuously.
 */
const TEMPLATE = [
	"{{#systemBlock}}{{systemPrompt}}{{/systemBlock}}",
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
 * `connection: slot.connectionOf("generate")` is the line under test: it is
 * what `respond`, `narrate` and the parity harness all carry, and removing it
 * from any of them puts the defect back.
 */
const formatPipeline = () =>
	compile(
		spec("core:spec/prompt-format", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
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
			.provider("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.build()
	)

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "prompt-format", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			name: "Bob",
			description: "A traveller.",
			isDefault: false
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
		visibility: "visible"
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

	// A real row, and registered — nothing selects a connection because it is
	// merely saved (`capabilityTarget.ts`), so without the registration
	// `world.activeConnection` is empty, the slot resolves to nothing and the
	// render falls back to Vicuna. Which is exactly what this file exists to
	// tell apart from the fix.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Format Under Test",
			type: "koboldcpp",
			baseUrl: "http://localhost:5001",
			model: "test",
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: "estimate"
		})
		.returning()
	connectionId = connection.id
	await setCapabilityDefault(db as any, "text->text", { connectionId })
}, 60_000)

/** Point the one registered connection at a format and render this session. */
async function renderWith(promptFormat: string) {
	await db
		.update(schema.connections)
		.set({ promptFormat })
		.where(eq(schema.connections.id, connectionId))

	const world = await buildWorld(db as any, { sessionId })
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

	const receipt: any = await run(formatPipeline(), {
		world,
		input: {
			text: "Where do the riders patrol?",
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "prompt-format",
		triggerSource: "ui",
		// Halts at the Provider with the payload built, so this is the real
		// thing rather than a reconstruction of it.
		preview: true,
		bindings: coreBindings(),
		host: createHost(db as any, { sessionId, userId })
	})

	// `PreviewReport.context` is `{rendered, tokens}` and `rendered` is
	// Assemble's whole allocation record — the same unwrap `generateResponse.ts`
	// and `sessions.ts` do before handing it to `toCompiledPrompt`.
	const payload = receipt?.preview?.context?.rendered
	expect(
		payload,
		`the run did not reach the Provider: ${receipt?.outcome} ` +
			`${receipt?.haltNodeKey ?? ""} ${receipt?.haltReason ?? ""}`
	).toBeTruthy()
	return payload
}

describe("the connection's prompt format reaches the render", () => {
	it("wraps blocks in ChatML when the connection says ChatML", async () => {
		const payload = await renderWith(PromptFormats.CHATML)

		expect(payload.rendered).toContain(PromptBlockFormatter.CHATML_OPEN)
		// The negative half is the one that fails against the defect: Vicuna is
		// what the unwired render produced for every connection, so asserting
		// only the presence of ChatML would pass on a prompt carrying both.
		expect(payload.rendered).not.toContain(
			PromptBlockFormatter.vicunaOpen("system")
		)
	}, 60_000)

	it("wraps blocks in Llama-2 instruct when the connection says so", async () => {
		const payload = await renderWith(PromptFormats.LLAMA2_INST)

		expect(payload.rendered).toContain("<<SYS>>")
		expect(payload.rendered).not.toContain(
			PromptBlockFormatter.vicunaOpen("system")
		)
	}, 60_000)

	it("still renders Vicuna for a Vicuna connection", async () => {
		// The parity corpus's case, stated here so a change that made every
		// format work EXCEPT the default one could not pass.
		const payload = await renderWith(PromptFormats.VICUNA)
		expect(payload.rendered).toContain(
			PromptBlockFormatter.vicunaOpen("system")
		)
	}, 60_000)

	it("treats a cleared prompt_format as Vicuna rather than ChatML", async () => {
		// `prompt_format` is nullable text with no check constraint, so `""` is
		// a state a row can be in — and `?? "vicuna"` would pass it through to
		// `makeBlock`, whose `default:` arm is ChatML. The wrong operator here
		// silently rewraps every prompt on that connection.
		const payload = await renderWith("")
		expect(payload.rendered).toContain(
			PromptBlockFormatter.vicunaOpen("system")
		)
		expect(payload.rendered).not.toContain(
			PromptBlockFormatter.CHATML_OPEN
		)
	}, 60_000)
})

describe("the split-session shape, end to end", () => {
	/**
	 * The reachability this change creates.
	 *
	 * `split_session` is the one format that produces a role ARRAY instead of a
	 * string, and no pipeline run could reach it before: the format never got to
	 * the render, so `isSplit` was false on every run. Everything downstream of
	 * it — the marker neutralisation in `PromptBlockFormatter`, the re-parse in
	 * `parseSplitChatPrompt`, the conversion in `toCompiledPrompt` — has been
	 * dead code on this path for the whole of 0.6.
	 */
	it("produces messages rather than a rendered string", async () => {
		const payload = await renderWith(PromptFormats.SPLIT_CHAT)

		expect(payload.rendered).toBeUndefined()
		expect(Array.isArray(payload.messages)).toBe(true)
		expect(payload.messages.length).toBeGreaterThan(0)
		expect(payload.messages[0].role).toBe("system")
		// Parsed back OUT of the markers, so no marker survives into content.
		for (const m of payload.messages)
			expect(m.content).not.toContain("<@role:")
	}, 60_000)

	it("converts to an adapter payload that still carries its meta", async () => {
		// ⚠ The regression this pins: `toCompiledPrompt` short-circuits a
		// payload that "already looks compiled", and Assemble's own split output
		// carries a real `messages` array — so it matched, was returned
		// untouched, and the caller got an allocation record where it expected
		// `{prompt, messages, meta}`. `sessions.ts`'s token count reads
		// `meta.tokenCounts` off this and `generateResponse.ts` hands it to an
		// adapter; both would have read `undefined` and reported it as a model
		// fault.
		const payload = await renderWith(PromptFormats.SPLIT_CHAT)
		const compiled = toCompiledPrompt(payload, {
			promptFormat: PromptFormats.SPLIT_CHAT
		})

		expect(compiled.prompt).toBeUndefined()
		expect(Array.isArray(compiled.messages)).toBe(true)
		expect(compiled.meta).toBeTruthy()
		expect(compiled.meta.tokenCounts).toBeTruthy()
		expect(compiled.meta.promptFormat).toBe(PromptFormats.SPLIT_CHAT)
		// Not the allocation record: a caller telling the two apart by the
		// presence of `blocks` is exactly what went wrong.
		expect(compiled).not.toHaveProperty("blocks")
	}, 60_000)

	it("leaves a plugin's own compiled payload untouched", async () => {
		// The escape hatch the short-circuit exists for. A plugin that assembles
		// its own wire format hands over `{prompt, messages, meta}` and carries
		// no allocation record, so it must still pass through.
		const own = { prompt: "mine", messages: undefined, meta: { a: 1 } }
		expect(toCompiledPrompt(own, { promptFormat: "chatml" })).toBe(own)
	})
})

describe("the receipt reports the format that was used", () => {
	it("names what the render did, not what the row says", async () => {
		// The lie: `dispatch.ts` derived `meta.promptFormat` from the connection
		// it had just resolved — a second resolution, on a second path, of a
		// question Assemble had already answered. While the render was hardwired
		// to Vicuna that made the receipt an outright falsehood; it stays a
		// hazard wherever the two resolutions can differ, which is every caller
		// that renders through the world manifest and sends through
		// `resolveTaskConfig` (`generateResponse.ts`, `sessions.ts`).
		const payload = await renderWith(PromptFormats.CHATML)
		expect(payload.promptFormat).toBe(PromptFormats.CHATML)

		// Deliberately handed a DISAGREEING connection: what the render used
		// wins, because it is the only one of the two that is a fact.
		const compiled = toCompiledPrompt(payload, { promptFormat: "claude" })
		expect(compiled.meta.promptFormat).toBe(PromptFormats.CHATML)
	}, 60_000)

	it("falls back to the connection for a payload that carries no format", async () => {
		// A plugin's own assembler, or a receipt replayed from before Assemble
		// published the field.
		const compiled = toCompiledPrompt(
			{ rendered: "text", blocks: [] },
			{ promptFormat: PromptFormats.INSTRUCT }
		)
		expect(compiled.meta.promptFormat).toBe(PromptFormats.INSTRUCT)
	})
})
