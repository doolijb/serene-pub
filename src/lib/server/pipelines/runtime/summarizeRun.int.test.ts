/**
 * A summary, run as a pipeline against real rows — and stopped at the write.
 *
 * The summarize sockets run their spec with `preview: {atNode: "save"}`: every
 * model step executes, and the run halts before the `create-lore-entry`
 * consumer because the handler has never written the entry — a person reviews
 * the result in the modal and saves. This file asks whether that whole path
 * holds together: the spec loads from rows, `summarize_source` resolves sender
 * names, the topic travels the wired `request` port into the drafting prompt,
 * and the receipt carries the synth and naming outputs the socket reads back.
 *
 * The model is faked and only the model.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/** Every prompt the fake model was handed, in call order. */
const calls: Array<{ systemPrompt: string; userPrompt: string }> = []

/** Canned answers, in the world spec's step order: draft → synth → name. */
const answers = [
	"<content>• The gate was sealed with old iron.</content>",
	"<content>The gate was sealed, so they went under it.</content>",
	"The Sealed Gate"
]

class FakeStepAdapter {
	private system: string
	private user: string
	constructor(p: any) {
		this.system = p?.promptConfig?.systemPrompt ?? ""
		this.user = p?.session?.sessionMessages?.[0]?.content ?? ""
	}
	abort() {}
	async preflight() {}
	async generate() {
		calls.push({ systemPrompt: this.system, userPrompt: this.user })
		const text = answers[Math.min(calls.length - 1, answers.length - 1)]!
		return {
			compiledPrompt: {},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(text)
			}
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeStepAdapter })
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb
let sessionId: number
let userId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "summarize-run-test", isAdmin: false })
		.returning()
	userId = user.id

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Mira", description: "A scout." })
		.returning()

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Run Lore", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionMessages).values([
		{
			sessionId,
			role: "assistant",
			characterId: character.id,
			content: "The gate was sealed with old iron."
		},
		{
			sessionId,
			role: "user",
			content: "Then we go under it, not through it."
		}
	])

	// The steps resolve their connection through the instance default — the
	// "first time someone presses Summarize" path.
	const [connection] = await db
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({ name: "Fake sampling", isImmutable: false })
		.returning()
	await db
		.insert(schema.systemSettings)
		.values({
			id: 1,
			defaultConnectionId: connection.id,
			defaultSamplingConfigId: sampling.id
		})
		.onConflictDoUpdate({
			target: [schema.systemSettings.id],
			set: {
				defaultConnectionId: connection.id,
				defaultSamplingConfigId: sampling.id
			}
		})
}, 120_000)

describe("a summarize run, stopped at the write", () => {
	it("runs every step, halts at save, and the outputs are on the receipt", async () => {
		const { runSpec } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/summarize"
		)

		const seen: string[] = []
		const receipt = await runSpec({
			db,
			sessionId,
			userId,
			specId: SUMMARIZE_WORLD_SPEC_ID,
			input: {
				scope: { sessionId },
				request: { topic: "the gate" }
			},
			preview: { atNode: "save" },
			onNode: (e) => {
				if (e.phase === "start" && e.kind === "provider")
					seen.push(e.typeId)
			},
			skipReceipt: true
		})

		// Halted, not errored: stopping before the write is the designed
		// outcome of this flow, and the socket keys on the node outputs.
		expect(receipt.outcome).toBe("halt")
		expect(receipt.haltNodeKey).toBe("save")

		const out = (key: string) =>
			(receipt.nodes.find((n: any) => n.nodeKey === key) as any)?.output
		expect(out("synth")?.content).toBe(
			"The gate was sealed, so they went under it."
		)
		expect(out("naming")?.name).toBeTruthy()

		// No lore entry was written — that is the whole point of the stop.
		const entries = await db.select().from(schema.worldLoreEntries)
		expect(entries.length).toBe(0)

		// Every model step announced itself, in phase order — the executor's
		// inherent node events, not a per-trigger wiring.
		expect(seen).toEqual([
			"core:provider/summarize-batch@1",
			"core:provider/summarize-synth@1",
			"core:provider/name-entry@1"
		])
	})

	it("carries sender names and the topic into the drafting prompt", async () => {
		const draft = calls[0]!
		// The `summarize_source` read resolved the speaker, so the drafting
		// prompt shows "Mira", not "Unknown".
		expect(draft.userPrompt).toContain("Mira")
		expect(draft.userPrompt).toContain("old iron")
		// The topic travelled the `request` port into phase 1 — per batch,
		// not just at synthesis.
		expect(draft.userPrompt).toContain('Focus specifically on: "the gate"')
	})

	it("the each-draft interior point runs the user's chain over every draft (18 §4e)", async () => {
		// Core dogfooding the broker (07 §0b): the chain attaches at slot
		// `scripts`, path `each-draft` — exactly what the panel's per-point
		// option writes — and the binding invokes it through `ctx.scripts`,
		// so the cleanup reaches the material summaries are built *from*.
		const { eq } = await import("drizzle-orm")
		const { createScript, updateScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/summarize"
		)
		const shout = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Draft shouter"
		})
		await updateScript(db as any, shout.id, {
			source: "return text.toUpperCase()"
		})
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, SUMMARIZE_WORLD_SPEC_ID))
			.limit(1)
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				eq(schema.pipelineNodes.specVersionId, spec.activeVersionId!)
			)
		const batchNode = (nodes as any[]).find(
			(n) => n.typeId === "core:provider/summarize-batch"
		)!
		// The chain attaches as the selected configuration's own value — the
		// only global home since the layer simplification (2026-08-24).
		{
			const { resolveSelectedConfig, duplicateConfig, selectConfig } =
				await import("$lib/server/pipelines/config/named")
			const shipped = await resolveSelectedConfig(
				db as any,
				spec.id,
				spec.slug,
				{}
			)
			const copy = await duplicateConfig(
				db as any,
				shipped!.configId,
				"Chain host"
			)
			await selectConfig(db as any, spec.id, "instance", 0, copy.id)
			await db.insert(schema.pipelineConfigValues).values({
				configId: copy.id,
				nodeKey: batchNode.nodeKey,
				slot: "scripts",
				path: "each-draft",
				value: [shout.id]
			})
		}

		calls.length = 0
		const { runSpec } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runSpec({
			db,
			sessionId,
			userId,
			specId: SUMMARIZE_WORLD_SPEC_ID,
			input: { scope: { sessionId }, request: { topic: "the gate" } },
			preview: { atNode: "save" },
			skipReceipt: true
		})

		// Synthesis was handed the transformed draft — the point ran between
		// the model's answer and the next phase.
		const synthCall = calls[1]!
		expect(synthCall.userPrompt).toContain(
			"THE GATE WAS SEALED WITH OLD IRON."
		)

		// And the receipt says a *binding* asked (18 §4e): visible from
		// outside, attributed to the drafting node.
		const apps = (receipt.nodes as any[])
			.filter((n: any) =>
				n.typeId?.startsWith("core:provider/summarize-batch")
			)
			.flatMap((n: any) => n.scripts ?? [])
		expect(apps).toMatchObject([
			{
				name: "Draft shouter",
				result: "ok",
				changed: true,
				appliedBy: "binding"
			}
		])
	})
})
