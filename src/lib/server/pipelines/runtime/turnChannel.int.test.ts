/**
 * The triggering message's channel travels with the turn (R-C, 2026-09-17).
 *
 * ## What was missing
 *
 * A genre may declare that one of its channels narrates
 * (`{ slug: 'aside', voice: 'narrator' }`), and until now the run had no way to
 * honour it: `voice: 'none'` could be read off the newest row, but nothing
 * anywhere said **which channel the turn was triggered on**. So the narrator
 * voice shipped declared and unwired — a genre could say it and nothing would
 * happen — and a turn on a channel with no rows yet answered for whichever
 * channel had spoken last.
 *
 * `runTurn` carries it now: onto the inlet's `channel` port, where a genre's
 * junction can branch on it, and onto the host scope, where it becomes the
 * declared voice the seed line takes (`prompt/seedLine.ts`).
 *
 * ## And the negative control, which is the half that protects every install
 *
 * The standard chat declares no channels at all. A turn on it names `main` —
 * explicitly, the way `continuationPrefill` names `""` — and the prompt it
 * assembles is the same bytes whatever channel the request names, because
 * nothing about a channel can reach a genre that shapes none.
 *
 * Run through `runTurn` against the SHIPPED `core:spec/chat-respond` loaded from the
 * database the bootstrap published it to, for the same reason
 * `continuation.int.test.ts` is: a test that compiled its own document would
 * wire the new port while writing it.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { spec } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

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

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "turn-channel", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
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
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})

	// The story string, layered the way `runTurn.int.test.ts` does it — a
	// template simple enough that a byte comparison below is readable.
	await db.insert(schema.systemSettings).values({ id: 1 })
	const channelTemplate =
		"{{{instructions}}}\n{{#each sessionMessages}}{{this.name}}: {{this.message}}\n{{/each}}"

	const { createContextTemplate } = await import(
		"$lib/server/pipelines/entities/contextTemplates"
	)
	const { CONTEXT_TEMPLATE_NODE_TYPE } = await import(
		"$lib/server/pipelines/entities/contextTemplateDefaults"
	)
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const template = await createContextTemplate(db, {
		nodeDefinitionId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: "Channel Template",
		source: channelTemplate
	})
	const [respondSpec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
		.limit(1)
	const decl = (await declarations(db, respondSpec.activeVersionId!)).find(
		(d) =>
			d.control === "context-template-ref" &&
			d.nodeDefinitionId === CONTEXT_TEMPLATE_NODE_TYPE
	)!
	const { resolveSelectedConfig, duplicateConfig, selectConfig } =
		await import("$lib/server/pipelines/config/named")
	const shipped = await resolveSelectedConfig(
		db,
		respondSpec.id,
		CHAT_RESPOND_SPEC_ID,
		{}
	)
	const copy = await duplicateConfig(db, shipped!.configId, "Channel host")
	await selectConfig(db, respondSpec.id, "pub", 0, copy.id)
	await db
		.insert(schema.pipelineConfigValues)
		.values({
			configId: copy.id,
			nodeKey: decl.nodeKey,
			slot: decl.slot,
			path: decl.path,
			value: template.id
		})
		.onConflictDoUpdate({
			target: [
				schema.pipelineConfigValues.configId,
				schema.pipelineConfigValues.nodeKey,
				schema.pipelineConfigValues.slot,
				schema.pipelineConfigValues.path
			],
			set: { value: template.id }
		})
}, 60_000)

/**
 * One turn, stopped at the Provider with its payload built — so the prompt
 * compared below is the real one and no model is involved.
 */
const turn = async (over: any = {}): Promise<any> => {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db: db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: "",
		seed: "turn-channel:test",
		preview: true,
		skipReceipt: true,
		...over
	})
}

/** What `$.input.*` resolves against — the inlet's published scope. */
const inletScope = (receipt: any) => {
	const inlet = receipt?.nodes?.find(
		(n: any) => n.definitionId === "core:inlet/user-message@1"
	)
	expect(
		inlet,
		`the inlet did not run: ${receipt?.outcome} ` +
			`${receipt?.haltNodeKey ?? ""} ${receipt?.haltReason ?? ""}`
	).toBeTruthy()
	return inlet.output as Record<string, unknown>
}

const renderedOf = (receipt: any) => {
	const rendered = receipt?.preview?.context?.rendered
	const out = rendered?.rendered ?? rendered
	expect(
		typeof out,
		`the run did not reach the Provider: ${receipt?.outcome} ` +
			`${receipt?.haltNodeKey ?? ""} ${receipt?.haltReason ?? ""}`
	).toBe("string")
	return out as string
}

describe("the trigger's channel reaches $.input.channel", () => {
	it("carries what the trigger named, lane included", async () => {
		expect(inletScope(await turn({ channel: "manuscript" }))).toMatchObject(
			{ channel: "manuscript" }
		)
		// A lane is part of the stored string and travels whole: the slug is
		// the channel, the number is which of its conversations this is.
		expect(inletScope(await turn({ channel: "phone:3" }))).toMatchObject({
			channel: "phone:3"
		})
	}, 60_000)

	it("is a reference a spec may wire, and a junction may read", () => {
		/**
		 * The declared half. The value above would reach `$.input.channel`
		 * whether or not the port existed — an inlet publishes its payload
		 * whole — but only a **declared** port can be named in a document,
		 * typed on the way in. This line does not compile without it, and the
		 * edge below is what a genre's junction would branch on.
		 */
		const built = spec("core:spec/channel-probe", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.task("lines", ($) =>
				C.processMessages.v1({ seedName: $.input.channel })
			)
			.build()
		expect(
			built.nodes.find((n: any) => n.key === "lines")?.config?.seedName
		).toEqual({ __ref: "data", node: "input", port: "channel" })
	})

	it("carries `main` when the trigger named none", async () => {
		// Always resolved, never absent — the `continuationPrefill` rule: a
		// port a junction may compare against is no use if half the turns
		// leave it unresolved.
		expect(inletScope(await turn())).toMatchObject({ channel: "main" })
		expect(inletScope(await turn({ channel: "" }))).toMatchObject({
			channel: "main"
		})
	}, 60_000)
})

describe("a genre that declares no channels", () => {
	it("assembles the same prompt whatever channel the turn names", async () => {
		// The negative control. The standard chat declares no channel, so
		// `channelShaping` answers null, nothing lands on the cast read, and
		// the turn's channel cannot reach the prompt at all — which is what
		// makes "byte-identical for every existing install" structural rather
		// than hopeful.
		const absent = renderedOf(await turn())
		expect(renderedOf(await turn({ channel: "main" }))).toBe(absent)
		expect(renderedOf(await turn({ channel: "manuscript" }))).toBe(absent)
		// And the prompt is a real one, so the comparison is not three empty
		// strings agreeing with each other.
		expect(absent).toContain("Have you seen the ashguard?")
		expect(absent.trimEnd().endsWith("Alice:")).toBe(true)
	}, 60_000)

	it("puts nothing new on the cast the prompt is built from", async () => {
		const cast = (await turn()).nodes?.find(
			(n: any) => n.definitionId === "core:query/session-cast@1"
		)
		expect(cast, "the cast query did not run").toBeTruthy()
		expect(cast.output?.cast ?? cast.output).not.toHaveProperty(
			"turnChannelVoice"
		)
	}, 60_000)
})
