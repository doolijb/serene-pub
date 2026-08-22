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
import { writtenMessageId } from "./runTurn"
import * as schema from "$lib/server/db/schema"

class FakeAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generate() {
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
let chatId: number
let userId: number
let characterId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("./bootstrap")
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
	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false })
		.returning()
	chatId = chat.id
	await db
		.insert(schema.chatCharacters)
		.values({ chatId, characterId, isActive: true, visibility: "visible" })
	await db
		.insert(schema.chatPersonas)
		.values({ chatId, personaId: persona.id })
	await db.insert(schema.chatMessages).values({
		chatId,
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
	const { runTurn } = await import("./runTurn")
	return await runTurn({
		db: db as any,
		chatId,
		userId,
		currentCharacterId: characterId,
		text: "Have you seen the ashguard?",
		...over
	})
}

describe("recording what a run did", () => {
	it("leaves a row saying the pipeline answered this chat", async () => {
		// The whole point: "is it using the new path" is a query, not a claim.
		const { lastRunFor } = await import("./receipts")
		await turn({ seed: "receipt:1" })

		const run = await lastRunFor(db as any, chatId)
		expect(run).toBeTruthy()
		expect(run.outcome).toBe("ok")
		expect(run.specSlug).toBe("core:spec/respond")
		expect(run.seed).toBe("receipt:1")
	}, 30_000)

	it("records the node trail, in order, as rows rather than only as a blob", async () => {
		// "Why did this reply include that lore" is a question about a node.
		// Answering it should not mean loading and walking JSON for every run.
		const { runForMessage } = await import("./receipts")
		const receipt = await turn({ seed: "receipt:2" })
		const messageId = writtenMessageId(receipt)!

		const found = await runForMessage(db as any, messageId)
		expect(found).toBeTruthy()
		expect(found!.nodes.map((n: any) => n.nodeKey)).toEqual([
			"input",
			"history",
			"lore",
			"cast",
			// Spec 1.4.0: the narrative graph's relationship summary, read as
			// its own node so it shows up here — a block in the prompt that no
			// receipt could account for was the reason to make it a node rather
			// than a read inside the context Task.
			"relationships",
			"context",
			"rank",
			"lines",
			"prompt",
			"generate",
			"save"
		])
		expect(found!.nodes.every((n: any) => n.result === "ok")).toBe(true)
	}, 30_000)

	it("links the run to the message it produced", async () => {
		// What makes "show me why *this* reply looks like that" a lookup rather
		// than a search through a chat's history.
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
		const { saveReceipt } = await import("./receipts")
		const broken = {
			insert: () => {
				throw new Error("disk is having a moment")
			}
		}
		const receipt = await turn({ seed: "receipt:5" })
		await expect(
			saveReceipt(broken as any, receipt, { chatId })
		).resolves.toBe(null)
	}, 30_000)

	it("does not record a comparison sweep", async () => {
		// The compare tool previews every chat on the instance; recording each
		// would bury the real runs in rows nobody asked for.
		const before = await db.select().from(schema.pipelineRuns)
		await turn({ seed: "receipt:6", preview: true, skipReceipt: true })
		const after = await db.select().from(schema.pipelineRuns)
		expect(after).toHaveLength(before.length)
	}, 30_000)

	it("records a preview as a preview, when it does record one", async () => {
		const { runsForChat } = await import("./receipts")
		await turn({ seed: "receipt:7", preview: true })
		const runs = await runsForChat(db as any, chatId)
		expect(runs.some((r: any) => r.isPreview)).toBe(true)
		// And a preview is never what `lastRunFor` reports, because it sent
		// nothing — it is not evidence that a reply came from the pipeline.
		const { lastRunFor } = await import("./receipts")
		expect((await lastRunFor(db as any, chatId)).isPreview).toBe(false)
	}, 30_000)
})
