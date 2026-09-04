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
import { writtenMessageId } from "$lib/server/pipelines/runtime/runTurn"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

/** Pinned to the real action, so a rename cannot pass here — fakeTextAdapter.ts. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
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
	await bootstrapPipelines(db as any)

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
	await db
		.insert(schema.sessionCharacters)
		.values({
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
		db: db as any,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: "Have you seen the ashguard?",
		...over
	})
}

describe("recording what a run did", () => {
	it("leaves a row saying the pipeline answered this session", async () => {
		// The whole point: "is it using the new path" is a query, not a claim.
		const { lastRunFor } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await turn({ seed: "receipt:1" })

		const run = await lastRunFor(db as any, sessionId)
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
		const messageId = writtenMessageId(receipt)!

		const found = await runForMessage(db as any, messageId)
		expect(found).toBeTruthy()
		expect(found!.nodes.map((n: any) => n.nodeKey)).toEqual([
			"input",
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
			"gather.cast.read",
			// Spec 1.4.0: the narrative graph's relationship summary, read as
			// its own node so it shows up here — a block in the prompt that no
			// receipt could account for was the reason to make it a node rather
			// than a read inside the context Task.
			"gather.relationshipsPerspectives.read",
			"gather.relationshipsKnown.read",
			// Spec 1.11.0: who speaks is decided (or an explicit pick recorded)
			// inside the run — the receipt line 19 §5 exists for.
			"speaker",
			"context",
			// Spec 1.6.0: how much room the context has, derived from the
			// sampling config's window instead of typed on the ranker. Its own
			// node for the same reason `relationships` is — a number that
			// decides what fits belongs in the receipt.
			"contextBudget",
			"lore",
			"rank",
			"lines",
			"prompt",
			"generate",
			"save"
		])
		expect(found!.nodes.every((n: any) => n.result === "ok")).toBe(true)

		// "Why did Bram speak" is now a receipt line (19 §5): the trigger's
		// pick was recorded, with what decided and how. The socket still
		// pre-picks every turn, so the pick wins under `turn-manual` — the
		// strategies deciding for themselves is behind U-C5's retirement of
		// the pre-pick. The row carries identity; the decision itself lives
		// in the receipt blob, so it is read off the returned receipt.
		const speakerRow = found!.nodes.find(
			(n: any) => n.nodeKey === "speaker"
		)
		expect(speakerRow.typeId).toBe("core:task/turn-manual@1")
		const speaker = receipt.nodes.find((n: any) => n.nodeKey === "speaker")
		expect(speaker!.output).toMatchObject({
			characterId,
			strategy: "manual",
			main: { characterId, via: "pick" }
		})
	}, 30_000)

	it("links the run to the message it produced", async () => {
		// What makes "show me why *this* reply looks like that" a lookup rather
		// than a search through a session's history.
		const receipt = await turn({ seed: "receipt:3" })
		const messageId = writtenMessageId(receipt)!
		const [row] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, receipt.runId))
		expect(row.messageId).toBe(messageId)
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
		const before = await db.select().from(schema.pipelineRuns)
		await turn({ seed: "receipt:6", preview: true, skipReceipt: true })
		const after = await db.select().from(schema.pipelineRuns)
		expect(after).toHaveLength(before.length)
	}, 30_000)

	it("records a preview as a preview, when it does record one", async () => {
		const { runsForSession } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		await turn({ seed: "receipt:7", preview: true })
		const runs = await runsForSession(db as any, sessionId)
		expect(runs.some((r: any) => r.isPreview)).toBe(true)
		// And a preview is never what `lastRunFor` reports, because it sent
		// nothing — it is not evidence that a reply came from the pipeline.
		const { lastRunFor } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		expect((await lastRunFor(db as any, sessionId)).isPreview).toBe(false)
	}, 30_000)
})
