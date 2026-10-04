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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID, ofType } from "$lib/server/utils/lorebookEntries"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { CompiledPrompt } from "$lib/server/connectionAdapters/types"

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

/** Every prompt the fake model was handed, in call order. */
const calls: Array<{ systemPrompt: string; userPrompt: string }> = []

/** Canned answers, in the world spec's step order: draft → synth → name. */
const answers = [
	"<content>• The gate was sealed with old iron.</content>",
	"<content>The gate was sealed, so they went under it.</content>",
	"The Sealed Gate"
]

/**
 * What a step adapter reports it sent.
 *
 * `dispatchStep` hands one in through construction rather than
 * `withCompiledPrompt`, and nothing in this file reads it back — but the action
 * requires it, so the fake states an empty one honestly instead of returning a
 * shape the real `generateText` forbids. The `as any` is on `meta` alone: the
 * fields under it describe a build that did not happen.
 */
const NO_PAYLOAD: CompiledPrompt = {
	prompt: undefined,
	messages: undefined,
	meta: {} as any
}

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeStepAdapter implements FakeTextAdapter {
	/** The composed stop list, handed over at construction. */
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	private system: string
	private user: string
	constructor(p: any) {
		this.system = p?.promptConfig?.systemPrompt ?? ""
		this.user = p?.session?.sessionMessages?.[0]?.content ?? ""
	}
	abort() {}
	async preflight() {}
	async generateText() {
		calls.push({ systemPrompt: this.system, userPrompt: this.user })
		const text = answers[Math.min(calls.length - 1, answers.length - 1)]!
		return {
			compiledPrompt: NO_PAYLOAD,
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
	await bootstrapPipelines(db)

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
	// The instance default: a `connection_defaults` row keyed by capability since
	// 0181, where it used to be two `system_settings` columns. Load-bearing —
	// every step in this run resolves its connection through the chain, and an
	// unregistered `text->text` means the first one refuses rather than falling
	// back to whatever happens to be saved.
	// The MODEL half of the pair. A registration names both halves — an
	// endpoint on its own is incomplete and every step refuses — and the merge
	// is what puts the identifier on the row the adapter is handed.
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(db, connection.id, "fake-7b")
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
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
				if (e.phase === "start" && e.kind === "oracle")
					seen.push(e.definitionId)
			},
			skipReceipt: true
		})

		// Halted, not errored: stopping before the write is the designed
		// outcome of this flow, and the socket keys on the node outputs.
		expect(receipt.outcome).toBe("halt")
		expect(receipt.haltNodeKey).toBe("save")

		// Who portrays whom is pinned here too (U5a, W1): a summarize is a
		// run in a session that reaches the model — parked at its write, not
		// a pre-call preview — so it is answered like a reply. No speaker,
		// so the cast, the owner and the run owner are what it asks about.
		expect(receipt.portrayals).toEqual({
			owner: { by: "person", userId: String(userId) },
			"run-owner": { by: "person", userId: String(userId) }
		})

		const out = (key: string) =>
			(receipt.nodes.find((n: any) => n.nodeKey === key) as any)?.output
		expect(out("synth")?.content).toBe(
			"The gate was sealed, so they went under it."
		)
		expect(out("naming")?.name).toBeTruthy()

		// No lore entry was written — that is the whole point of the stop.
		const entries = await db
			.select()
			.from(schema.lorebookEntries)
			.where(ofType(WORLD_LORE_TYPE_ID))
		expect(entries.length).toBe(0)

		// Every model step announced itself, in phase order — the executor's
		// inherent node events, not a per-trigger wiring.
		expect(seen).toEqual([
			"core:oracle/summarize-batch@1",
			"core:oracle/summarize-synth@1",
			"core:oracle/name-entry@1"
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
		const shout = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Draft shouter"
		})
		await updateScript(db, shout.id, {
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
			(n) => n.definitionId === "core:oracle/summarize-batch"
		)!
		// The chain attaches as the selected configuration's own value — the
		// only global home since the layer simplification (2026-08-24).
		{
			const { resolveSelectedConfig, duplicateConfig, selectConfig } =
				await import("$lib/server/pipelines/config/named")
			const shipped = await resolveSelectedConfig(
				db,
				spec.id,
				spec.slug,
				{}
			)
			const copy = await duplicateConfig(
				db,
				shipped!.configId,
				"Chain host"
			)
			await selectConfig(db, spec.id, "pub", 0, copy.id)
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
				n.definitionId?.startsWith("core:oracle/summarize-batch")
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

/**
 * Attachments in the summarize transcript (owner ruling 2026-10-03): the
 * spec's `attachments` query reads the files the picked messages show, and
 * `batches` names each after its message's text. A message that is only a
 * picture reaches the draft as that picture's name and description, where it
 * used to be an empty line.
 */
describe("a summarize run names a message's files", () => {
	let dataDir: string
	let priorDataDir: string | undefined

	beforeAll(async () => {
		const fs = await import("node:fs/promises")
		const os = await import("node:os")
		const path = await import("node:path")
		dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-summarize-attach-"))
		priorDataDir = process.env.SERENE_PUB_DATA_DIR
		process.env.SERENE_PUB_DATA_DIR = dataDir
	})

	afterAll(async () => {
		const fs = await import("node:fs/promises")
		if (priorDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
		else process.env.SERENE_PUB_DATA_DIR = priorDataDir
		await fs.rm(dataDir, { recursive: true, force: true })
	})

	it("an attachment-only message is drafted from its image's name and description", async () => {
		const { PNG } = await import("pngjs")
		const img = new PNG({ width: 4, height: 4 })
		for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 7) % 256
		const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
		const { createMedia } = await import("$lib/server/media")
		const { mediaPartFor } = await import("$lib/server/attachments/partData")
		const row: any = await insertLegacy(db as any, {
			sessionId,
			role: "user",
			content: "",
			isGenerating: false
		} as any)
		const created = await createMedia(db as any, {
			userId,
			sessionId,
			bytes: PNG.sync.write(img),
			filename: "gate.png"
		})
		await appendParts(db as any, row.id, [
			mediaPartFor(created.file, { alt: "a rusted iron gate" })
		])

		const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
		const { SUMMARIZE_WORLD_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/summarize"
		)
		calls.length = 0
		const receipt = await runSpec({
			db,
			sessionId,
			userId,
			specId: SUMMARIZE_WORLD_SPEC_ID,
			input: { scope: { sessionId }, request: { messageIds: [row.id] } },
			preview: { atNode: "save" },
			skipReceipt: true
		})
		expect(receipt.haltNodeKey, receipt.haltReason).toBe("save")
		expect(calls[0]!.userPrompt).toContain(
			"[image: gate.png — a rusted iron gate]"
		)
	}, 60_000)
})
