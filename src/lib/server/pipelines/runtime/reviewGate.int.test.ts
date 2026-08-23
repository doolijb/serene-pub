/**
 * The review gate, end to end against real rows (01 §7).
 *
 * A person flips `Review` to `sync` on the summarize pipeline's save step —
 * one config option, written where every other option is written — and the
 * next run parks before the write with a form inferred from the payload the
 * node received. Approve writes it; an edit writes the edited thing and the
 * binding cannot tell (F14); reject halts the run, which is a halt and not
 * an error. No bespoke UI, no per-pipeline wiring: the gate is inherent.
 *
 * The model is faked and only the model.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

const answers = [
	"<content>• The gate was sealed with old iron.</content>",
	"<content>The gate was sealed, so they went under it.</content>",
	"The Sealed Gate"
]
let call = 0

class FakeStepAdapter {
	constructor(_p: any) {}
	abort() {}
	async preflight() {}
	async generate() {
		const text = answers[Math.min(call++, answers.length - 1)]!
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
let chatId: number
let userId: number
let specId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "review-gate-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Gate Lore", userId })
		.returning()
	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	chatId = chat.id
	await db.insert(schema.chatMessages).values([
		{
			chatId,
			role: "user",
			content: "The gate was sealed with old iron."
		}
	])

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

	const { SUMMARIZE_WORLD_SPEC_ID } = await import("$lib/server/pipelines/specs/summarize")
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, SUMMARIZE_WORLD_SPEC_ID))
	specId = spec.id

	// The person's choice, written where every option is written: review
	// `sync` on the save step, at user scope.
	await db.insert(schema.pipelineNodeOverrides).values({
		specId,
		scopeKind: "user",
		scopeId: userId,
		nodeKey: "save",
		slot: "settings",
		path: "review",
		value: "sync"
	})
}, 120_000)

/** Wait for this user's next parked review, patiently — the first run pays cold imports. */
async function awaitReview() {
	const { pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
	await vi.waitFor(
		() => {
			expect(pendingReviewsFor(userId).length).toBeGreaterThan(0)
		},
		{ timeout: 20_000, interval: 100 }
	)
	const all = pendingReviewsFor(userId)
	return all[all.length - 1]!
}

/** Clear anything a failed earlier test left parked. */
async function drainReviews() {
	const { pendingReviewsFor, resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")
	for (const r of pendingReviewsFor(userId))
		resolveReview(r.id, userId, "reject")
}

async function runGated() {
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	const { SUMMARIZE_WORLD_SPEC_ID } = await import("$lib/server/pipelines/specs/summarize")
	return runSpec({
		db,
		chatId,
		userId,
		specId: SUMMARIZE_WORLD_SPEC_ID,
		input: { scope: { chatId }, request: {} },
		skipReceipt: true
	})
}

describe("a run parks at the gate, and a person decides", () => {
	it("approve writes exactly what was reviewed", async () => {
		call = 0
		await drainReviews()
		const { resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")

		const running = runGated()

		// The run is parked — the write has not happened.
		const review = await awaitReview()
		expect(await db.select().from(schema.worldLoreEntries)).toHaveLength(0)

		// The form is defined by the data the node received — name and
		// content, inferred, no bespoke screen.
		expect(review.nodeKey).toBe("save")
		expect((review.schema as any).name?.type).toBe("string")
		// Short content infers as a one-line field, long as a textarea — either
		// way it is editable, which is the property that matters.
		expect(["string", "text"]).toContain(
			(review.schema as any).content?.type
		)
		expect(String(review.values.content)).toContain("under it")

		resolveReview(review.id, userId, "approve")
		const receipt = await running
		expect(receipt.outcome).toBe("ok")

		const entries = await db.select().from(schema.worldLoreEntries)
		expect(entries).toHaveLength(1)
		expect(entries[0]!.content).toContain("under it")
	})

	it("an edit is committed as if the pipeline wrote it (F14)", async () => {
		call = 0
		await drainReviews()
		const { resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")
		const running = runGated()
		const review = await awaitReview()
		resolveReview(review.id, userId, "edit", {
			...review.values,
			name: "The Gate Below",
			content: "REVIEWED AND REWRITTEN."
		})
		const receipt = await running
		expect(receipt.outcome).toBe("ok")

		const entries = await db.select().from(schema.worldLoreEntries)
		const edited = entries.find((e: any) => e.name === "The Gate Below")
		expect(edited?.content).toBe("REVIEWED AND REWRITTEN.")
	})

	it("reject halts the run — a halt, not an error — and writes nothing", async () => {
		call = 0
		await drainReviews()
		const { resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")
		const before = (await db.select().from(schema.worldLoreEntries)).length

		const running = runGated()
		const review = await awaitReview()
		resolveReview(review.id, userId, "reject")
		const receipt = await running
		expect(receipt.outcome).toBe("halt")
		expect(receipt.haltReason).toMatch(/rejected at review/)

		const after = (await db.select().from(schema.worldLoreEntries)).length
		expect(after).toBe(before)
	})

	it("someone else cannot decide your review", async () => {
		call = 0
		await drainReviews()
		const { resolveReview, ReviewNotFoundError } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const running = runGated()
		const review = await awaitReview()
		expect(() => resolveReview(review.id, userId + 999, "approve")).toThrow(
			ReviewNotFoundError
		)
		// And the rightful owner still can.
		resolveReview(review.id, userId, "reject")
		await running
	})

	it("a cancelled run withdraws its review instead of leaving a ghost card", async () => {
		call = 0
		await drainReviews()
		const { pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
		const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
		const { SUMMARIZE_WORLD_SPEC_ID } = await import("$lib/server/pipelines/specs/summarize")

		const controller = new AbortController()
		const running = runSpec({
			db,
			chatId,
			userId,
			specId: SUMMARIZE_WORLD_SPEC_ID,
			input: { scope: { chatId }, request: {} },
			signal: controller.signal,
			skipReceipt: true
		})
		await awaitReview()
		controller.abort()
		const receipt = await running
		expect(receipt.outcome).toBe("halt")
		expect(pendingReviewsFor(userId)).toHaveLength(0)
	})
})
