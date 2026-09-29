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
 *
 * ## ⚠ The connection here is in COMPLETION wire mode, and that is a precondition
 *
 * A prompt format is meaningful **only** in completion wire mode (NOMENCLATURE
 * §10). In chat mode the roles carry the structure: the render emits role-tagged
 * messages through `split_chat` and the connection's delimiters have nothing
 * to wrap — not a default format, none at all. So every case below states the
 * mode by a hand-set override on the row, which is what makes the property it
 * asserts a property this connection actually has. The last describe block is
 * the other half: the same row in chat mode, where the format does nothing.
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
import {
	completionTemplateOf,
	framingFor,
	type BlockRole
} from "$lib/shared/constants/completionTemplates"

/**
 * What Vicuna puts before a block of this role.
 *
 * Was `PromptBlockFormatter.vicunaOpen(role)`, one of eight per-format helper
 * methods that were the switch's implementation. The framing is a template row
 * now, so the question is a lookup — asked here through the same resolver the
 * renderer uses, so this cannot assert bytes the renderer would not emit.
 */
const vicunaOpen = (role: BlockRole) =>
	framingFor(completionTemplateOf(PromptFormats.VICUNA), role).prefix
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
		.values({ username: "prompt-format", isAdmin: false })
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
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: "estimate",
			// Completion wire mode, hand-set. See the header: a prompt format has
			// no effect in the other one, so without this every case below would
			// be asserting delimiters on a render that emits none. `wire_chat:
			// false` is an explicit off — an absent key is the auto state, which
			// on KoboldCPP resolves to chat.
			capabilities: { overrides: { wire_chat: false } }
		})
		.returning()
	connectionId = connection.id
	const [formatModel] = await db
		.insert(schema.connectionModels)
		.values({ connectionId, model: "test", name: "test" })
		.returning()
	await setCapabilityDefault(db, "text->text", {
		connectionId,
		connectionModelId: formatModel.id
	})
}, 60_000)

/** Point the one registered connection at a format and render this session. */
async function renderWith(promptFormat: string | null) {
	await db
		.update(schema.connections)
		.set({ promptFormat })
		.where(eq(schema.connections.id, connectionId))

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
		host: createHost(db, { sessionId, userId })
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
		expect(payload.rendered).not.toContain(vicunaOpen("system"))
	}, 60_000)

	it("wraps blocks in Llama-2 instruct when the connection says so", async () => {
		const payload = await renderWith(PromptFormats.LLAMA2_INST)

		expect(payload.rendered).toContain("<<SYS>>")
		expect(payload.rendered).not.toContain(vicunaOpen("system"))
	}, 60_000)

	it("still renders Vicuna for a Vicuna connection", async () => {
		// The parity corpus's case, stated here so a change that made every
		// format work EXCEPT the default one could not pass.
		const payload = await renderWith(PromptFormats.VICUNA)
		expect(payload.rendered).toContain(vicunaOpen("system"))
	}, 60_000)

	it("treats a cleared prompt_format as Vicuna rather than ChatML", async () => {
		// NULL, not `""`, and the change is the foreign key's doing.
		//
		// `prompt_format` used to be bare text with no constraint, so `""` was a
		// state a row could be in; this case was written for it. Referencing
		// `completion_templates.key` removes that state from the STORAGE layer
		// outright — there is no template keyed `""` for the row to point at, so
		// the database refuses it and the migration nulls any that predate the
		// key. Cleared is now spelled NULL, which is what it always meant.
		//
		// The empty string survives as an IN-FLIGHT value (a payload, a plugin,
		// a receipt replayed from an older build), and `completionTemplateOf`
		// still answers it with the default — pinned in
		// `completionTemplates.test.ts` alongside the other two absent states.
		// What is asserted here is the half that needs a database: a connection
		// with no format set renders Vicuna and not the `default:` arm's ChatML.
		const payload = await renderWith(null)
		expect(payload.rendered).toContain(vicunaOpen("system"))
		expect(payload.rendered).not.toContain(PromptBlockFormatter.CHATML_OPEN)
	}, 60_000)
})

/**
 * The other half of the precondition: in CHAT wire mode the format does nothing.
 *
 * ⚠ Every case above binds a connection in completion wire mode, which makes
 * them all incapable of noticing the thing this block pins — a chat connection
 * ignoring its `prompt_format` entirely. That is not a degradation; it is what
 * "chat mode has no prompt format, not even a default one" means in bytes.
 *
 * The end-to-end proof that the messages then REACH the model lives in
 * `wireMode.int.test.ts`, which carries the payload all the way to a mocked
 * transport. What is asserted here is narrower and belongs beside the format
 * cases: the format was set, and it changed nothing.
 */
describe("chat wire mode overrides the connection's format", () => {
	/** Put the one registered connection in chat mode, then back. */
	const inChatMode = async <T>(fn: () => Promise<T>): Promise<T> => {
		await db
			.update(schema.connections)
			.set({ capabilities: { overrides: { wire_completion: false } } })
			.where(eq(schema.connections.id, connectionId))
		try {
			return await fn()
		} finally {
			await db
				.update(schema.connections)
				.set({ capabilities: { overrides: { wire_chat: false } } })
				.where(eq(schema.connections.id, connectionId))
		}
	}

	it("emits messages and no ChatML delimiters, though the row says ChatML", async () => {
		const payload = await inChatMode(() => renderWith(PromptFormats.CHATML))

		expect(payload.rendered).toBeUndefined()
		expect(Array.isArray(payload.messages)).toBe(true)
		expect(payload.messages.length).toBeGreaterThan(0)
		// The format was SET and had no effect — the half a positive-only
		// assertion could not see.
		const asText = JSON.stringify(payload.messages)
		expect(asText).not.toContain(PromptBlockFormatter.CHATML_OPEN)
		// Nor does the transport's own marker survive the parse.
		expect(asText).not.toContain("<@role:")
	}, 60_000)

	it("reports split_chat on the receipt, not the row's format", async () => {
		// The receipt names what the render USED. Stamping "chatml" on a prompt
		// carrying no ChatML would put a reader debugging an empty reply on the
		// wrong trail — the same lie this file's other receipt case removed.
		const payload = await inChatMode(() => renderWith(PromptFormats.CHATML))
		expect(payload.promptFormat).toBe(PromptFormats.SPLIT_CHAT)
		expect(
			toCompiledPrompt(payload, { promptFormat: PromptFormats.CHATML })
				.meta.promptFormat
		).toBe(PromptFormats.SPLIT_CHAT)
	}, 60_000)
})

describe("the split-chat shape, end to end", () => {
	/**
	 * The reachability this change creates.
	 *
	 * `split_chat` is the one format that produces a role ARRAY instead of a
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

	it("does not take this branch for a template merely NAMED 'split'", async () => {
		/**
		 * ⚠ The highest-value line in the change, end to end.
		 *
		 * `assemble.ts` decided this with `/split/i.test(input.promptFormat)` —
		 * a SUBSTRING test on the format string. That was survivable only while
		 * the eight keys were a hardcoded list nobody could add to. Templates
		 * are rows now, so the string is user-supplied, and any template whose
		 * key contains "split" would switch the WHOLE pipeline to role-array
		 * output: `rendered` comes back undefined to a text-completion adapter,
		 * and the role-marker parser runs over a string with no markers in it
		 * and yields an empty array. Both failures reach a user as an empty
		 * generation with nothing in the log.
		 *
		 * The row is inserted directly because there is no create route yet —
		 * the admin lane builds it. That is also what makes this the first
		 * exercise of the foreign key accepting a user-authored template.
		 */
		await db.insert(schema.completionTemplates).values({
			seedKey: null,
			key: "my-split-format",
			name: "My Split Format",
			isImmutable: false,
			renderMode: "flat",
			roles: {},
			fallbackRole: { prefix: "", suffix: "" },
			stopStrings: [],
			isSelectable: true
		})

		const payload = await renderWith("my-split-format")

		// FLAT, because `renderMode` says flat. The old substring test made
		// this the split branch on the name alone.
		expect(typeof payload.rendered).toBe("string")
		expect(payload.messages).toBeUndefined()
		expect(payload.rendered).not.toContain("<@role:")
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

/**
 * The half the format wire did not finish: an admin-authored ROW.
 *
 * `makeBlock` has taken a resolved template or a bare key since the table
 * landed, and `completionTemplateOf` resolves a bare key **against the
 * built-ins**. Nothing loaded a row. So a template someone wrote on
 * `/admin/completion-templates`, saved, and pointed a connection at, resolved
 * to no built-in and rendered as Vicuna — a control that validates, persists,
 * shows its delimiters back, and changes not one byte of what the model
 * receives.
 *
 * These two cases are the whole of that. The first asserts the row's markers
 * reach the prompt; the second asserts an EDIT to the row reaches the next
 * render, which is the property any cache between the table and the renderer
 * would quietly take away.
 */
describe("an admin-authored template row reaches the render", () => {
	/** Markers no built-in contains, so the assertions cannot pass by accident. */
	const OPEN = (role: string) => `<<<SP:${role}>>>\n`
	const CLOSE = "\n<<<END>>>\n"

	const framingRows = (open: (role: string) => string, close: string) =>
		Object.fromEntries(
			["system", "user", "assistant", "model", "tool", "function"].map(
				(r) => [r, { prefix: open(r), suffix: close }]
			)
		)

	beforeAll(async () => {
		await db.insert(schema.completionTemplates).values({
			seedKey: null,
			key: "house-style",
			name: "House Style",
			isImmutable: false,
			renderMode: "flat",
			roles: framingRows(OPEN, CLOSE),
			fallbackRole: { prefix: OPEN("user"), suffix: CLOSE },
			stopStrings: ["<<<END>>>"],
			isSelectable: true
		})
	}, 60_000)

	it("wraps blocks in the row's own delimiters", async () => {
		const payload = await renderWith("house-style")

		expect(payload.rendered).toContain(OPEN("system"))
		expect(payload.rendered).toContain(OPEN("user"))
		expect(payload.rendered).toContain(CLOSE)
		// The negative half, and the one that fails against the defect: with no
		// loader, `completionTemplateOf("house-style")` finds no built-in and
		// answers with the DEFAULT, so the prompt comes out in Vicuna markers
		// while every screen says "House Style".
		expect(payload.rendered).not.toContain(vicunaOpen("system"))
		// The receipt still names the KEY. The row is what rendered; the key is
		// what a reader of the receipt can look up.
		expect(payload.promptFormat).toBe("house-style")
	}, 60_000)

	it("re-reads the row, so an edit lands on the next render", async () => {
		/**
		 * ⚠ The anti-cache case.
		 *
		 * `registerContextHandlebarsHelpers` wraps every helper in
		 * `if (!handlebars.helpers.X)`, so whichever template is passed at FIRST
		 * registration is the one that renders forever after on that Handlebars
		 * instance. `renderers.ts` creates a fresh instance per render, which is
		 * what keeps that harmless — and a cache on the loader would reinstate
		 * it one level up: the first render after boot would pin the framing and
		 * an admin's edit would appear to save while changing nothing until a
		 * restart.
		 *
		 * The first render above has already happened, so if anything memoised
		 * the row this assertion sees the OLD markers.
		 */
		const EDITED = (role: string) => `[[${role.toUpperCase()}]]\n`
		await db
			.update(schema.completionTemplates)
			.set({
				roles: framingRows(EDITED, CLOSE),
				fallbackRole: { prefix: EDITED("user"), suffix: CLOSE }
			})
			.where(eq(schema.completionTemplates.key, "house-style"))

		const payload = await renderWith("house-style")

		expect(payload.rendered).toContain(EDITED("system"))
		expect(payload.rendered).not.toContain(OPEN("system"))
	}, 60_000)
})
