/**
 * The pipeline workspace's server half (22 §3): the batch save and the run
 * receipt.
 *
 * Batch semantics worth pinning: entries apply in order through the same
 * write path the per-option events use, and the first refusal stops the batch
 * with a count of what landed — a partial apply is *named*, never silent.
 * The receipt fetch is gated exactly like the runs list: your runs, nobody
 * else's, by runId.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		// `instanceSecret()` reads the crypto key through the same module.
		getCryptoSecretKey: () => "workspace-test-secret"
	}
})

let adminId: number
let strangerId: number

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)

	const [admin] = await testDb
		.insert(schema.users)
		.values({ username: "workspace-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "workspace-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id
}, 120_000)

function fakeSocket(userId: number, isAdmin: boolean) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

const RESPOND = "core:spec/respond"

/**
 * A writable configuration to land batch writes in. Shipped Default refuses
 * edits ("Duplicate it and edit the copy") — the same rule the workspace's
 * shipped-save dialog routes around by creating a copy first.
 */
let editableConfigId: number
async function ensureEditableConfig(): Promise<number> {
	if (editableConfigId) return editableConfigId
	const { createConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const [spec] = await testDb
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND))
		.limit(1)
	const row = await createConfig(
		testDb as any,
		spec.id,
		"workspace-editable"
	)
	editableConfigId = row.id
	return editableConfigId
}

/** Two writable option ids off the live declarations — no hardcoded handles. */
async function twoNumericOptionIds(): Promise<string[]> {
	const { namespaceView } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const view = await namespaceView(
		testDb as any,
		"workspace-test-secret",
		RESPOND,
		{ userId: adminId, isAdmin: true }
	)
	expect(view).toBeTruthy()
	const all = view!.steps.flatMap((s: any) => [...s.options, ...s.advanced])
	const nums = all.filter(
		(o: any) =>
			(o.control === "integer" || o.control === "number") && o.writable
	)
	expect(nums.length).toBeGreaterThanOrEqual(2)
	return [nums[0].id, nums[1].id]
}

describe("pipelines:setOptions — the batch save", () => {
	it("applies sets and clears in one request", async () => {
		const { pipelinesSetOptions } = await import("./pipelines")
		const [a, b] = await twoNumericOptionIds()
		// Select the editable copy so the refreshed view resolves against it.
		const { selectNamedConfig } = await import(
			"$lib/server/pipelines/config/panel"
		)
		await selectNamedConfig(
			testDb as any,
			RESPOND,
			{ userId: adminId, isAdmin: true },
			await ensureEditableConfig()
		)

		const configId = await ensureEditableConfig()
		const res: any = await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{
				slug: RESPOND,
				configId,
				set: [
					{ optionId: a, value: 7 },
					{ optionId: b, value: 9 }
				],
				clear: []
			} as any,
			noop
		)
		expect(res.error).toBeUndefined()
		const after = (res.pipeline.steps as any[])
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.id === a || o.id === b)
		expect(after.find((o) => o.id === a)!.value).toBe(7)
		expect(after.find((o) => o.id === b)!.value).toBe(9)

		// And the clear half: reset both through the same event.
		const cleared: any = await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{ slug: RESPOND, configId, set: [], clear: [a, b] } as any,
			noop
		)
		expect(cleared.error).toBeUndefined()
		const rows = (cleared.pipeline.steps as any[])
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.id === a || o.id === b)
		for (const o of rows) expect(o.overriddenHere).toBe(false)
	})

	it("a refusal mid-batch stops it and names what landed", async () => {
		const { pipelinesSetOptions } = await import("./pipelines")
		const [a] = await twoNumericOptionIds()
		const events: { event: string; data: any }[] = []

		const configId = await ensureEditableConfig()
		const res: any = await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{
				slug: RESPOND,
				configId,
				set: [
					{ optionId: a, value: 3 },
					{ optionId: "opt_not_a_real_handle", value: 1 }
				],
				clear: []
			} as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeTruthy()
		// The first entry landed before the refusal — said, not silent.
		expect(res.applied).toBe(1)
		expect(
			events.some((e) => e.event === "pipelines:setOptions:error")
		).toBe(true)
		// The view still refreshed so the panel shows what actually landed.
		expect(events.some((e) => e.event === "pipelines:get")).toBe(true)

		// Tidy the landed write.
		await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{ slug: RESPOND, configId, set: [], clear: [a] } as any,
			noop
		)
	})
})

describe("pipelines:run — the receipt", () => {
	async function seedRun(userId: number, runId: string) {
		await testDb.insert(schema.pipelineRuns).values({
			runId,
			specSlug: RESPOND,
			specVersion: "1.0.0",
			userId,
			outcome: "ok",
			triggerSource: "event",
			seed: "s",
			startedAt: new Date(0),
			endedAt: new Date(1000),
			elapsedMs: 1000,
			tokensSpent: 42,
			receipt: {
				runId,
				outcome: "ok",
				nodes: [
					{
						nodeKey: "generate",
						seq: 1,
						kind: "provider",
						result: "ok",
						elapsedMs: 900,
						tokens: 42
					}
				]
			}
		})
	}

	it("returns the stored receipt, node rows and all", async () => {
		const { pipelinesRun } = await import("./pipelines")
		await seedRun(adminId, "run-mine")
		const res: any = await pipelinesRun.handler(
			fakeSocket(adminId, true),
			{ runId: "run-mine" } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.run.runId).toBe("run-mine")
		expect(res.run.receipt.nodes).toHaveLength(1)
		expect(res.run.receipt.nodes[0].nodeKey).toBe("generate")
	})

	it("refuses another user's run by runId", async () => {
		const { pipelinesRun } = await import("./pipelines")
		await seedRun(adminId, "run-private")
		const res: any = await pipelinesRun.handler(
			fakeSocket(strangerId, false),
			{ runId: "run-private" } as any,
			noop
		)
		expect(res.error).toBeTruthy()
		expect(res.run).toBeUndefined()
	})
})
