/**
 * 🚧 `core:query/earlier-scenes@1`, the binding: the session's eligible scenes
 * with the block's share of the budget. Which scenes show is Assemble's call
 * (`assembleTranscriptFit.int.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { SEED_MESSAGE_ID } from "$lib/server/pipelines/prompt/messages"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "earlier-scenes-query-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-earlier-scenes-query-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "earlier-scenes-query-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeSession() {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Earlier Query Book ${++seq}`, userId: ownerId })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }
			])
		)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: {}
		})
		.returning()
	return { ...session, lorebookId: lorebook.id }
}

async function addScene(
	sessionId: number,
	lorebookId: number,
	start: number,
	over: Partial<typeof schema.scenes.$inferInsert> = {}
) {
	await testDb.insert(schema.scenes).values({
		sessionId,
		lorebookId,
		channel: "main",
		openedAtMessageId: start,
		closedAtMessageId: start + 3,
		summary: `Summary from ${start}.`,
		summaryStatus: "done",
		...over
	})
}

async function query(input: Record<string, unknown>) {
	const { coreBindings } = await import(
		"$lib/server/pipelines/runtime/bindings"
	)
	return (await coreBindings()["core:query/earlier-scenes@1"]!(
		input as never,
		{} as never
	)) as any
}

describe("core:query/earlier-scenes@1", () => {
	it("returns the eligible scenes and floor(0.15 x total) by default", async () => {
		const s = await makeSession()
		await addScene(s.id, s.lorebookId, 10)
		const r = await query({
			scope: { sessionId: s.id },
			budget: { total: 1001 },
			params: {}
		})
		expect(r.kind).toBe("ok")
		expect(r.value.main.maxTokens).toBe(150)
		expect(r.value.main.scenes).toEqual([
			expect.objectContaining({
				summary: "Summary from 10.",
				firstLineId: 10
			})
		])
	}, 60_000)

	it("honours share, and falls back to 0.15 for one outside [0, 1]", async () => {
		const s = await makeSession()
		const at = async (share: unknown) =>
			(
				await query({
					scope: { sessionId: s.id },
					budget: { total: 2000 },
					params: { share }
				})
			).value.main.maxTokens
		expect(await at(0.5)).toBe(1000)
		expect(await at(0)).toBe(0)
		expect(await at(1.5)).toBe(300)
		expect(await at("x")).toBe(300)
	}, 60_000)

	it("gives null with no budget, or one without a positive total", async () => {
		const s = await makeSession()
		for (const budget of [
			undefined,
			{},
			{ total: 0 },
			{ total: Number.NaN }
		]) {
			const r = await query({
				scope: { sessionId: s.id },
				budget,
				params: {}
			})
			expect(r.value.main.maxTokens).toBeNull()
		}
	}, 60_000)

	it("halts with its sentence when the run is not scoped to a session", async () => {
		const r = await query({
			scope: {},
			budget: { total: 1000 },
			params: {}
		})
		expect(r).toMatchObject({
			kind: "halt",
			reason: expect.stringContaining(
				"there is no session to read earlier scenes from — the run is not scoped to a session"
			)
		})
	}, 60_000)

	it("a session with no done scene reads no scenes, and Assemble renders it as with no port", async () => {
		const s = await makeSession()
		await addScene(s.id, s.lorebookId, 10, {
			summaryStatus: "none",
			summary: ""
		})
		const r = await query({
			scope: { sessionId: s.id },
			budget: { total: 1000 },
			params: {}
		})
		expect(r.value.main.scenes).toEqual([])
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const lines = [
			{ id: 1, role: "user", name: "Jody", message: "Hello." },
			{
				id: SEED_MESSAGE_ID,
				role: "assistant",
				name: "Aria",
				message: ""
			}
		]
		const run = async (extra: Record<string, unknown>) =>
			(
				(await coreBindings()["core:task/assemble@2"]!(
					{
						template: {
							source: SHIPPED_CONTEXT_TEMPLATE,
							engine: CORE_TEMPLATE_ENGINE
						},
						decisions: [],
						messages: lines,
						budget: { total: 1000 },
						templateContext: { instructions: "You're Aria." },
						connection: {
							metadata: { wireMode: "chat", midSystem: "fold" }
						},
						...extra
					} as never,
					{
						countTokens: (t: string) => Math.ceil(t.length / 4)
					} as never
				)) as any
			).value
		const withPort = await run({ earlierScenes: r.value.main })
		const without = await run({})
		expect(JSON.stringify(withPort.context)).toBe(
			JSON.stringify(without.context)
		)
	}, 60_000)

	it("Story's reply spec carries the earlier-scenes query, so Story Minimal (which keeps the reply) has the node", async () => {
		const { storyRespondSpec } = await import("@serene-pub/core-catalog")
		expect(JSON.stringify(storyRespondSpec())).toMatch(
			/"definitionId":"core:query\/earlier-scenes"/
		)
	})
})
