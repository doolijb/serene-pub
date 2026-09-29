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

/**
 * An `emitToUser` that keeps what a handler sent, resolving a lazy payload.
 *
 * `pipelines:get` is a gated event, so the refreshed view a write answers with
 * is now a THUNK the real `emitToUser` runs only for a socket that wants it
 * (socket-interest plan, ruling 4). Running it here is what the gate does when
 * somebody is listening — and this is where the view lives now: `register`
 * discards what a handler returns, so the emit has always been the real answer.
 */
function collecting() {
	const sent: { event: string; data: any }[] = []
	return {
		sent,
		emit: async (event: string, data: any) => {
			sent.push({
				event,
				data: typeof data === "function" ? await data() : data
			})
		},
		/** The payload of the last emit of one event. */
		last: (event: string) =>
			[...sent].reverse().find((e) => e.event === event)?.data
	}
}

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
		const set = collecting()
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
			set.emit
		)
		expect(res.error).toBeUndefined()
		const after = (set.last("pipelines:get").pipeline.steps as any[])
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.id === a || o.id === b)
		expect(after.find((o) => o.id === a)!.value).toBe(7)
		expect(after.find((o) => o.id === b)!.value).toBe(9)

		// And the clear half: reset both through the same event.
		const cleared = collecting()
		const clearedRes: any = await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{ slug: RESPOND, configId, set: [], clear: [a, b] } as any,
			cleared.emit
		)
		expect(clearedRes.error).toBeUndefined()
		const rows = (cleared.last("pipelines:get").pipeline.steps as any[])
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.id === a || o.id === b)
		for (const o of rows) expect(o.overriddenHere).toBe(false)
	})

	it("a refusal mid-batch stops it and names what landed", async () => {
		const { pipelinesSetOptions } = await import("./pipelines")
		const [a] = await twoNumericOptionIds()
		const out = collecting()

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
			out.emit
		)
		expect(res.error).toBeTruthy()
		// The first entry landed before the refusal — said, not silent.
		expect(res.applied).toBe(1)
		expect(
			out.sent.some((e) => e.event === "pipelines:setOptions:error")
		).toBe(true)
		// The view still refreshed so the panel shows what actually landed —
		// and it really was BUILT, not merely announced: the payload resolves.
		expect(out.last("pipelines:get").pipeline).toBeTruthy()

		// Tidy the landed write.
		await pipelinesSetOptions.handler(
			fakeSocket(adminId, true),
			{ slug: RESPOND, configId, set: [], clear: [a] } as any,
			noop
		)
	})
})

describe("pipelines:run — the receipt", () => {
	async function seedRun(
		userId: number,
		runId: string,
		receiptExtra: Record<string, unknown> = {}
	) {
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
						kind: "oracle",
						result: "ok",
						elapsedMs: 900,
						tokens: 42
					}
				],
				...receiptExtra
			}
		})
	}

	it("names the receipt's pinned portrayals, says 'you' for the viewer, and never names a stranger (U5a)", async () => {
		const { pipelinesRun } = await import("./pipelines")
		const [tom] = await testDb
			.insert(schema.characters)
			.values({ userId: adminId, name: "Tom", description: "A cast member." })
			.returning()
		const [elara] = await testDb
			.insert(schema.characters)
			.values({
				userId: adminId,
				name: "Elara",
				description: "The admin's persona.",
				isPersona: true
			})
			.returning()
		const [ghost] = await testDb
			.insert(schema.characters)
			.values({
				userId: strangerId,
				name: "Ghost",
				description: "In nobody's session."
			})
			.returning()
		await seedRun(adminId, "run-portrayed", {
			portrayals: {
				owner: { by: "person", userId: String(adminId) },
				"run-owner": { by: "person", userId: String(adminId) },
				[`character:${tom.id}`]: { by: "ai" },
				[`character:${elara.id}`]: {
					by: "person",
					userId: String(adminId)
				},
				// Nobody's — a non-member and a character in no session. The
				// rows exist; the line must not read them.
				[`user:${strangerId}`]: { by: "none" },
				[`character:${ghost.id}`]: { by: "none" },
				"envoy:mascot": { by: "ai" },
				// Not a reference, and not a portrayal: read as data, skipped.
				"persona:9": { by: "ai" },
				[`character:${tom.id + 1000}`]: "ai",
				// Ids no integer column holds: nobody's, and no query is
				// attempted for them (S1).
				"character:99999999999": { by: "ai" },
				"user:2147483648": { by: "person", userId: "2147483648" }
			}
		})
		const res: any = await pipelinesRun.handler(
			fakeSocket(adminId, true),
			{ runId: "run-portrayed" } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		// The receipt is served as stored — the map is still on it.
		expect(res.run.receipt.portrayals[`character:${tom.id}`]).toEqual({
			by: "ai"
		})
		// And named beside it, in the receipt's order, for the line.
		expect(res.run.portrayals).toEqual([
			{
				ref: "owner",
				name: "owner",
				by: "person",
				person: { name: "workspace-admin", you: true }
			},
			{
				ref: "run-owner",
				name: "run-owner",
				by: "person",
				person: { name: "workspace-admin", you: true }
			},
			{ ref: `character:${tom.id}`, name: "Tom", by: "ai" },
			{
				ref: `character:${elara.id}`,
				name: "Elara",
				by: "person",
				person: { name: "workspace-admin", you: true }
			},
			{ ref: `user:${strangerId}`, name: `user:${strangerId}`, by: "none" },
			{
				ref: `character:${ghost.id}`,
				name: `character:${ghost.id}`,
				by: "none"
			},
			{ ref: "envoy:mascot", name: "mascot", by: "ai" },
			{ ref: "character:99999999999", name: "character:99999999999", by: "ai" },
			{
				ref: "user:2147483648",
				name: "user:2147483648",
				by: "person",
				person: { name: "2147483648", you: false }
			}
		])
		expect(JSON.stringify(res.run.portrayals)).not.toContain(
			"workspace-stranger"
		)
		expect(JSON.stringify(res.run.portrayals)).not.toContain("Ghost")
	})

	it("serves no portrayals for a receipt that pinned none", async () => {
		const { pipelinesRun } = await import("./pipelines")
		await seedRun(adminId, "run-unportrayed")
		const res: any = await pipelinesRun.handler(
			fakeSocket(adminId, true),
			{ runId: "run-unportrayed" } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect("portrayals" in res.run).toBe(false)
	})

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
