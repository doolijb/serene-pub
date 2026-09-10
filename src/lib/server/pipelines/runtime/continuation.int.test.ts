/**
 * Continue: the partial reaches the model as a PREFILL, and reaches retrieval
 * as nothing at all.
 *
 * ## The defect
 *
 * `sessionMessages:continue` keeps the row's text and calls `generateResponse`,
 * which wrote `(session as any)._continuationPrefill` — a key **nothing read**.
 * The runtime has had the seam the whole time (`prompt/messages.ts` puts
 * `continuationPrefill` on the seed line, id -2) and no port carried a value to
 * it, because `core:task/process-messages@1` declared none and no spec wired
 * one. So a continue sent an EMPTY seed line, got a fresh reply, and glued it
 * onto the partial afterwards — the model never saw what it was continuing.
 *
 * ## The other half, which is the same defect read from the other side
 *
 * The row holding the partial is `isGenerating: true` and still in the table,
 * and the host's `session_messages` read filtered on `isHidden` alone — so the
 * partial arrived at every retrieval mechanism and every history window as a
 * **stored message**. Per the ruling of 2026-09-08 (D-2) it must not: a continue
 * re-retrieves as a full run, the partial counts toward the token budget because
 * it is in the prompt, and it is excluded from knowledge and message querying.
 *
 * The second `it` below is what makes that a fact rather than a claim. Its
 * `PARTIAL` names an entry ("moonwell") that nothing else in the session names,
 * so the entry can only be retrieved by a scan that saw the partial — and the
 * control entry beside it ("ashguard", named by the stored user line) is what
 * separates "the scan does not see the partial" from "the scan is broken".
 *
 * Asserted through `runTurn` against the SHIPPED `core:spec/respond` document
 * loaded from the database the bootstrap published it to — not an ad-hoc spec.
 * A test that compiled its own pipeline would wire the new port while writing
 * it, and the defect lives in the shipped document.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"

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
let generatingId: number

/** The text already on the row — what a continue is continuing. */
const PARTIAL = "I saw them near the moonwell at"

/** In the stored user line, so the control entry is reachable either way. */
const USER_LINE = "Have you seen the ashguard?"

const ASHGUARD = "Riders who patrol the ash wastes."
/** Reachable ONLY through the partial: no stored message says "moonwell". */
const MOONWELL = "A spring that shows tomorrow's weather."

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "continue-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
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
		.values({ name: "Continue Lore", userId })
		.returning()
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: ASHGUARD
			},
			{
				lorebookId: lorebook.id,
				name: "The Moonwell",
				keys: "moonwell",
				content: MOONWELL
			}
		])
	)

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
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: USER_LINE,
		personaId: persona.id
	})

	/**
	 * The row a continue is about, in the exact state
	 * `sessionMessagesContinueHandler` leaves it: text kept, `isGenerating`
	 * flipped. This is the row that must not be a stored message to anything
	 * that queries.
	 */
	const [generating] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			characterId,
			content: PARTIAL,
			isGenerating: true,
			generationStage: "queued"
		})
		.returning()
	generatingId = generating.id

	// The story string, layered the way `runTurn.int.test.ts` does it.
	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({
			name: "Continue Context",
			template:
				"{{{instructions}}}\nLORE:{{{worldLore}}}\n{{#each sessionMessages}}{{this.name}}: {{this.message}}\n{{/each}}"
		})
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({ name: "Continue Prompt", systemPrompt: "You are {{char}}." })
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})

	const { createContextTemplate } = await import(
		"$lib/server/pipelines/entities/contextTemplates"
	)
	const { CONTEXT_TEMPLATE_NODE_TYPE } = await import(
		"$lib/server/pipelines/entities/contextTemplateDefaults"
	)
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const template = await createContextTemplate(db, {
		nodeTypeId: CONTEXT_TEMPLATE_NODE_TYPE,
		name: "Continue Template",
		source: contextConfig.template!
	})
	const [respondSpec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
		.limit(1)
	const decl = (
		await declarations(db, respondSpec.activeVersionId!)
	).find(
		(d) =>
			d.control === "context-template-ref" &&
			d.nodeTypeId === CONTEXT_TEMPLATE_NODE_TYPE
	)!
	const { resolveSelectedConfig, duplicateConfig, selectConfig } =
		await import("$lib/server/pipelines/config/named")
	const shipped = await resolveSelectedConfig(
		db,
		respondSpec.id,
		RESPOND_SPEC_ID,
		{}
	)
	const copy = await duplicateConfig(
		db,
		shipped!.configId,
		"Continue host"
	)
	await selectConfig(db, respondSpec.id, "instance", 0, copy.id)
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

/** The turn a continue runs: a full run, carrying the partial as a prefill. */
async function continueTurn(): Promise<any> {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db: db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		// ⚠ NOT the partial. A continue re-retrieves as a full run, and the
		// partial is not the message that triggered it — see the ruling.
		text: "",
		continuationPrefill: PARTIAL,
		seed: "continue:test",
		preview: true,
		skipReceipt: true
	})
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

const countOf = (haystack: string, needle: string) =>
	haystack.split(needle).length - 1

describe("the seed line carries the prefill", () => {
	it("ends the prompt with the speaker's name and the text so far", async () => {
		const rendered = renderedOf(await continueTurn())

		/**
		 * ⚠ The whole defect, as one assertion. The seed line (id -2) is the
		 * last thing in the prompt and is what the model continues from, so a
		 * prefill that reached it puts the partial THERE — at the end — rather
		 * than in the transcript above it.
		 */
		expect(
			rendered.trimEnd().endsWith(`Alice: ${PARTIAL}`),
			`the prompt does not end on the prefilled seed line. Tail:\n` +
				JSON.stringify(rendered.slice(-160))
		).toBe(true)

		// And exactly once: the generating row is excluded from history, so the
		// partial is in the prompt in one place and one place only. Without the
		// exclusion this is 2 — once as a transcript line, once as the seed.
		expect(countOf(rendered, PARTIAL)).toBe(1)
	}, 60_000)
})

describe("the partial is not a stored message", () => {
	it("is absent from the retrieval-visible history while present in the prompt", async () => {
		const receipt = await continueTurn()
		const rendered = renderedOf(receipt)

		// 1. The history query — the window every downstream mechanism reads.
		const history = receipt.nodes.find(
			(n: any) => n.typeId === "core:query/session-history@1"
		)
		expect(history, "the history query did not run").toBeTruthy()
		const ids = ((history!.output as any)?.messages ?? []).map(
			(m: any) => m.id
		)
		expect(
			ids,
			"the row being generated arrived at retrieval as a stored message"
		).not.toContain(generatingId)

		// 2. The keyword scan. "moonwell" occurs in the partial and NOWHERE
		// else in the session, so an entry keyed on it can only be admitted by
		// a scan that read the partial.
		expect(
			rendered,
			"lore was retrieved from the partial text"
		).not.toContain(MOONWELL)

		// 3. The control. Without it, a scan that silently found nothing at all
		// would read as a pass.
		expect(
			rendered,
			"the keyword scan found nothing — assertion 2 proves nothing"
		).toContain(ASHGUARD)

		// 4. And the partial IS in the prompt, on the seed line. Excluded from
		// querying, included in what the model is asked to continue — which is
		// also why it counts against the token budget.
		expect(rendered).toContain(PARTIAL)
	}, 60_000)
})
