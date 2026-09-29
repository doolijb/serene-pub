/**
 * What a run leaves behind.
 *
 * The property that matters is the one this file is named for: after a turn,
 * there is a row saying what happened. "Did that use the pipeline?" should be a
 * query, not a claim — and the second test is the one that keeps it honest,
 * because a receipt store that drops writes silently is worse than none.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	/** The composed stop list. Recorded so a test can assert what was handed over. */
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: "The Ashguard ride at dawn."
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
// The reply dispatch consumes the run's own resolution now (R-8) and asks the
// resolver only to load the pair — so the stand-in connection is supplied
// where dispatch actually reads it. The real resolver answers first: a test
// that registers a capability default of its own gets that connection (and
// its stop guards), and only an instance with nothing registered falls back
// to the stand-in.
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<
		typeof import("$lib/server/connections/capabilityTarget")
	>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
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
		.values({ username: "receipt-test", isAdmin: false })
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

	const [contextConfig] = await db
		.insert(schema.contextConfigs)
		.values({ name: "Receipt Context", template: "{{instructions}}" })
		.returning()
	const [promptConfig] = await db
		.insert(schema.promptConfigs)
		.values({ name: "Receipt Prompt", systemPrompt: "You are {{char}}." })
		.returning()
	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: contextConfig.id,
		defaultPromptConfigId: promptConfig.id
	})
}, 60_000)

const turn = async (over: any = {}) => {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db: db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: "Have you seen the ashguard?",
		...over
	})
}

/**
 * The row a run left, with what it made.
 *
 * The receipt's `runId` is the SDK's identity; `pipeline_run_artifacts.run_id`
 * is the table's — so a test that wants the second has to go through the first.
 */
async function recordFor(receipt: { runId: string }) {
	const { runArtifacts } = await import(
		"$lib/server/pipelines/runtime/receipts"
	)
	const [run] = await db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.runId, receipt.runId))
	return { run, artifacts: await runArtifacts(db, run.id) }
}

/** The one message this turn's Consumer wrote. */
async function messageWrittenBy(receipt: { runId: string }) {
	const { artifacts } = await recordFor(receipt)
	const message = artifacts.find((a: any) => a.kind === "message")
	expect(message, "the run recorded no message artifact").toBeTruthy()
	return message!.entityId as number
}

describe("recording what a run did", () => {
	it("leaves a row saying the pipeline answered this session", async () => {
		// The whole point: "is it using the new path" is a query, not a claim.
		const { lastRunFor } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await turn({ seed: "receipt:1" })

		const run = await lastRunFor(db, sessionId)
		expect(run).toBeTruthy()
		expect(run.outcome).toBe("ok")
		expect(run.specSlug).toBe("core:spec/respond")
		expect(run.seed).toBe("receipt:1")
	}, 30_000)

	it("records the node trail, in order, as rows rather than only as a blob", async () => {
		// "Why did this reply include that lore" is a question about a node.
		// Answering it should not mean loading and walking JSON for every run.
		const { runForMessage } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const receipt = await turn({ seed: "receipt:2" })
		const messageId = await messageWrittenBy(receipt)

		const found = await runForMessage(db, messageId)
		expect(found).toBeTruthy()
		expect(found!.nodes.map((n: any) => n.nodeKey)).toEqual([
			"input",
			// 09-B B4: the pipeline owns its row. The placeholder outlet
			// creates the reply row — **directly after the inlet** since
			// A6 (PLAN-turn-order §4.4), before anything costs a token and
			// before the reads; `save` at the end is the update that fills
			// it. The `speaker` node that used to stand between them is
			// gone: who speaks is state the fired entry names, decided by
			// `core:spec/<genre>-turn-order` outside this run entirely.
			"placeholder",
			// Spec 1.6.0: the four reads moved into an `async` block, which
			// qualifies the keys inside it. They still each appear, and still
			// in declaration order — the receipt is ordered by assignment, not
			// by which finished first, so a parallel block does not make the
			// trail nondeterministic.
			"gather.history.read",
			// Spec 1.8.0: world and character lore are their own lanes, so each
			// can carry its own weight, floor and share. `lore` below is the
			// merge that puts them back together for the ranker — wiring the
			// ranker to one lane would have dropped the other with nothing
			// anywhere reporting it.
			"gather.worldLore.read",
			"gather.characterLore.read",
			"gather.historyEntries.read",
			// Spec 1.18.0: the third mechanism, retrieving on the names the scene is
			// using. Inert by default — both its caps ship at 0 — but it is a
			// node either way, so it is a line in the trail either way.
			"gather.entities.read",
			"gather.cast.read",
			// Spec 1.4.0: the narrative graph's relationship summary, read as
			// its own node so it shows up here — a block in the prompt that no
			// receipt could account for was the reason to make it a node rather
			// than a read inside the context Task.
			"gather.relationshipsPerspectives.read",
			"gather.relationshipsKnown.read",
			// The same graph again, read as ranked candidates rather than as
			// three keyed sections (ruling 2026-09-10, Q1). A third branch and
			// not a widening of either above it: those two hand the graph to
			// the template outside the budget, and this one puts every tie into
			// the `relationships` band where the share divides it and the
			// receipt accounts for it. It spends nothing until somebody raises
			// that band, and it is a line in the trail either way.
			"gather.relationships.read",
			// Spec 1.19.0: the fourth mechanism. Its own block rather than a fifth
			// chain in `gather`, because chains of a parallel block cannot read
			// each other and this one needs `gather.history`'s messages — and
			// because the debug preview stops at the first Provider on the
			// spine, which `embed` would be.
			//
			// All three run on an install with no embedding model: `embed`
			// returns no vectors under its `auto` setting rather than failing
			// the turn, and `search` is off by default anyway. Present in the
			// trail either way, which is the point — a retrieval mechanism nobody can
			// see on the receipt is one nobody can debug.
			"semantic.arm.queries",
			"semantic.arm.embed",
			"semantic.arm.search",
			// Spec 1.6.0: how much room the context has, derived from the
			// sampling config's window instead of typed on the ranker. Its own
			// node for the same reason `relationships` is — a number that
			// decides what fits belongs in the receipt.
			"contextBudget",
			"lore",
			// Spec 1.20.0: the fifth mechanism — entries reached by a
			// *description* rather than by a name the scene actually said.
			// Its own block after `lore` for two reasons: its pool **is**
			// `lore`'s output, which is what makes it structurally unable to
			// admit anything, and a Provider on the spine would halt the debug
			// preview.
			//
			// All three run on an install with no embedding model:
			// `mentions` needs none, `embed` returns no vectors under `auto`
			// rather than failing the turn, and `link` returns empty with the
			// reason on the receipt. `loreLinked` then concatenates its output
			// **in front of** `lore.candidates`, so an empty mechanism leaves `rank`
			// exactly the list it would have had.
			"names.arm.mentions",
			"names.arm.embed",
			"names.arm.link",
			"loreLinked",
			"rank",
			// ⚠ **Below the ranker, where it used to be above it.** The context
			// builder's two relationship in-ports carry `rank`'s inclusions, so
			// the prompt's relationship sections are built from the band that
			// was actually allocated rather than from the whole graph dump; a
			// node cannot read a selection that has not happened. Nothing
			// between the two ever read this node.
			"context",
			"lines",
			"prompt",
			"generate",
			"save",
			// The sprite tail (DESIGN-sprites §5), after the save: what the
			// speaker can show. A card with no sprites stops here — the
			// junction's branch is skipped, which is a stated outcome, not a
			// node in the trail.
			"sprites"
		])
		expect(found!.nodes.every((n: any) => n.result === "ok")).toBe(true)

		// "Why did Bram speak" is now a receipt line (19 §5): the trigger's
		// Who spoke is the ENTRY's, not a node's (PLAN-turn-order §4.4):
		// the reply run seats no `speaker` node any more, and the
		// placeholder is made from the pick the inlet carried.
		expect(found!.nodes.some((n: any) => n.nodeKey === "speaker")).toBe(
			false
		)
		const placeholderRow = found!.nodes.find(
			(n: any) => n.nodeKey === "placeholder"
		)
		expect(placeholderRow!.definitionId).toBe("core:outlet/create-message@1")
		const inlet = receipt.nodes.find((n: any) => n.nodeKey === "input")
		expect((inlet!.output as any).speaker).toBe(`character:${characterId}`)
	}, 30_000)

	it("links the run to the message it produced", async () => {
		// What makes "show me why *this* reply looks like that" a lookup rather
		// than a search through a session's history — a row in the artifact
		// relation now, written by the Consumer that did the writing rather
		// than reconstructed from the receipt afterwards.
		const receipt = await turn({ seed: "receipt:3" })
		const { run, artifacts } = await recordFor(receipt)

		// One row, two facts about it (09-B B4): the placeholder created it
		// and the save filled it. Both name the node that did it, which the
		// old column could not say at all.
		expect(artifacts).toHaveLength(2)
		expect(artifacts[0]).toMatchObject({
			runId: run.id,
			seq: 0,
			kind: "message",
			action: "created",
			nodeKey: "placeholder"
		})
		expect(artifacts[1]).toMatchObject({
			runId: run.id,
			seq: 1,
			kind: "message",
			action: "updated",
			nodeKey: "save",
			entityId: artifacts[0].entityId
		})
		expect(typeof artifacts[0].entityId).toBe("number")

		// And the artifact names a message that actually exists.
		const [message] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, artifacts[0].entityId))
		expect(
			message,
			"the artifact names a message that is not there"
		).toBeTruthy()
	}, 30_000)

	it("answers which runs produced a given row, newest first", async () => {
		/**
		 * The reverse lookup, and the reason a column could not have been kept.
		 * A message is legitimately the artifact of more than one run — a
		 * **continue** re-runs the whole pipeline against the row already on
		 * screen, and a regenerate does the same — and `message_id` could only
		 * ever remember the last writer.
		 */
		const { runsForArtifact, saveReceipt } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const first = await turn({ seed: "receipt:3b" })
		const messageId = await messageWrittenBy(first)

		// A second run over the same row, recorded the way a continue records.
		await saveReceipt(
			db,
			{
				runId: "receipt:3b:continue",
				specId: "core:spec/respond",
				specVersion: "1.0.0",
				outcome: "ok",
				triggerSource: "event",
				seed: "receipt:3b:continue",
				startedAt: 0,
				endedAt: 1,
				nodes: []
			} as any,
			{
				sessionId,
				userId,
				artifacts: [
					{ kind: "message", entityId: messageId, action: "updated" }
				]
			}
		)

		const runs = await runsForArtifact(db, "message", messageId)
		expect(runs.map((r: any) => r.runId)).toEqual([
			"receipt:3b:continue",
			first.runId
		])

		// And nothing is invented for a row no run ever touched.
		expect(await runsForArtifact(db, "message", 999_999)).toEqual([])
	}, 30_000)

	it("keeps the whole receipt, not only the columns", async () => {
		// A column list written today should not decide what a panel can show
		// in six months.
		const receipt = await turn({ seed: "receipt:4" })
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, receipt.runId))
		expect((row.receipt as any).nodes.length).toBe(receipt.nodes.length)
	}, 30_000)

	it("bounds the reply text on the stored receipt at the wire cap, and says so", async () => {
		// Since the one road the generate node's output IS the reply, and it
		// landed in `pipeline_runs.receipt` unbounded once the adapter road's
		// cap on `reply.text` went with it. The published value is untouched —
		// the save read the whole reply — only what the column keeps of it.
		const { saveReceipt, boundedForStorage } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const { WIRE_RAW_LIMIT } = await import(
			"$lib/server/connectionAdapters/BaseConnectionAdapter"
		)
		const long = "x".repeat(WIRE_RAW_LIMIT + 1000)
		const receipt: any = {
			runId: "receipt:cap",
			specId: "core:spec/respond",
			specVersion: "1.0.0",
			outcome: "ok",
			triggerSource: "event",
			seed: "receipt:cap",
			startedAt: 0,
			endedAt: 1,
			nodes: [
				{
					seq: 0,
					nodeKey: "generate",
					kind: "oracle",
					definitionId: "core:oracle/generate-text@1",
					result: "ok",
					output: { main: long, text: long, thinking: "short" }
				},
				{
					seq: 1,
					nodeKey: "save",
					kind: "outlet",
					definitionId: "core:outlet/update-message@1",
					result: "ok",
					output: { text: long }
				}
			],
			emitted: [],
			consumption: { tokens: 0, nodeExecutions: 2 }
		}
		const id = await saveReceipt(db, receipt, { sessionId, userId })
		expect(id).not.toBeNull()
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, id!))
		const stored = row.receipt as any
		const generate = stored.nodes.find((n: any) => n.nodeKey === "generate")
		expect(generate.output.text.length).toBe(WIRE_RAW_LIMIT)
		expect(generate.output.main.length).toBe(WIRE_RAW_LIMIT)
		expect(generate.output.thinking).toBe("short")
		expect(generate.output.textTruncated).toEqual({
			bytes: WIRE_RAW_LIMIT + 1000,
			kept: WIRE_RAW_LIMIT,
			marker: `truncated, ${WIRE_RAW_LIMIT + 1000} bytes`
		})
		expect(generate.notes.join(" ")).toMatch(/truncated, \d+ bytes/)
		// Only the generate nodes: an outlet's input is its own record.
		expect(
			stored.nodes.find((n: any) => n.nodeKey === "save").output.text
				.length
		).toBe(long.length)
		// The receipt in hand was not mutated — it is also what the trigger
		// returns and the run-end hook was handed.
		expect(receipt.nodes[0].output.text.length).toBe(long.length)
		expect(receipt.nodes[0].output.textTruncated).toBeUndefined()

		// A reply under the cap is stored exactly as it was.
		const short = { ...receipt, nodes: [{ ...receipt.nodes[0], output: { text: "brief" } }] }
		expect(boundedForStorage(short)).toBe(short)
	})

	it("bounds the save node's stored input at the wire cap, and says so", async () => {
		// `update-message`'s `input.text`/`input.thinking` carry the same reply
		// a generate node already published, recorded a second time as this
		// node's own input — the same wire cap applies there.
		const { saveReceipt } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const { WIRE_RAW_LIMIT } = await import(
			"$lib/server/connectionAdapters/BaseConnectionAdapter"
		)
		const long = "x".repeat(WIRE_RAW_LIMIT + 1000)
		const receipt: any = {
			runId: "receipt:cap-input",
			specId: "core:spec/respond",
			specVersion: "1.0.0",
			outcome: "ok",
			triggerSource: "event",
			seed: "receipt:cap-input",
			startedAt: 0,
			endedAt: 1,
			nodes: [
				{
					seq: 0,
					nodeKey: "save",
					kind: "outlet",
					definitionId: "core:outlet/update-message@1",
					result: "ok",
					input: { text: long, thinking: "short" },
					output: { id: 1 }
				}
			],
			emitted: [],
			consumption: { tokens: 0, nodeExecutions: 1 }
		}
		const id = await saveReceipt(db, receipt, { sessionId, userId })
		expect(id).not.toBeNull()
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, id!))
		const stored = row.receipt as any
		const save = stored.nodes.find((n: any) => n.nodeKey === "save")
		expect(save.input.text.length).toBe(WIRE_RAW_LIMIT)
		expect(save.input.thinking).toBe("short")
		expect(save.input.textTruncated).toEqual({
			bytes: WIRE_RAW_LIMIT + 1000,
			kept: WIRE_RAW_LIMIT,
			marker: `truncated, ${WIRE_RAW_LIMIT + 1000} bytes`
		})
		expect(save.notes.join(" ")).toMatch(/truncated, \d+ bytes/)
		// The receipt in hand was not mutated.
		expect(receipt.nodes[0].input.text.length).toBe(long.length)
		expect(receipt.nodes[0].input.textTruncated).toBeUndefined()
	})

	it("a failed write does not fail the turn", async () => {
		// A run that produced a good reply and then could not record itself has
		// still produced a good reply. Getting this backwards loses a user's
		// message to a bad day in the audit trail.
		const { saveReceipt } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const broken = {
			insert: () => {
				throw new Error("disk is having a moment")
			}
		}
		const receipt = await turn({ seed: "receipt:5" })
		await expect(
			saveReceipt(broken as any, receipt, { sessionId })
		).resolves.toBe(null)
	}, 30_000)

	it("does not record a comparison sweep", async () => {
		// The compare tool previews every session on the instance; recording each
		// would bury the real runs in rows nobody asked for.
		// Other tests' queued event work settles first, so the count is this
		// turn's alone (PLAN §8 (27)).
		const settle = async () =>
			(await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		await settle()
		const before = await db.select().from(schema.pipelineRuns)
		await turn({ seed: "receipt:6", preview: true, skipReceipt: true })
		await settle()
		const after = await db.select().from(schema.pipelineRuns)
		expect(after).toHaveLength(before.length)
	}, 30_000)

	/**
	 * The stop sequences ride the generate node's OWN output since the one
	 * road (09-B B4): the binding runs on every reply and publishes `stops`,
	 * so there is no receipt patch any more and nothing here to pin. The
	 * shape of that output is `dispatch.int.test.ts`'s to assert.
	 */

	it("records a preview as a preview, when it does record one", async () => {
		const { runsForSession } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await turn({ seed: "receipt:7", preview: true })
		const runs = await runsForSession(db, sessionId)
		expect(runs.some((r: any) => r.isPreview)).toBe(true)
		// And a preview is never what `lastRunFor` reports, because it sent
		// nothing — it is not evidence that a reply came from the pipeline.
		const { lastRunFor } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		expect((await lastRunFor(db, sessionId)).isPreview).toBe(false)
	}, 30_000)
})
