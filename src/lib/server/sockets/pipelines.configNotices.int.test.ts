/**
 * Somebody has to be able to READ a cull.
 *
 * `reconcileConfigs` has recorded every culled value since configs existed —
 * what it was, what it held, which version took it — and for just as long
 * nothing outside a test had ever read one. A person who deliberately set a
 * value at an address a later version moved lost it in silence, which the
 * schema itself calls the worst of the three available behaviours.
 *
 * These are the two events that close that: the notices a configuration is
 * holding, and dismissing one. The claims worth pinning are the ones that are
 * easy to lose by accident later — the payload names a control rather than a
 * node, a dismissal outlives the request that made it, and neither event will
 * cross from one configuration (or one pipeline) to another on a guessed id.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// `./pipelines` reaches $lib/server/db at import time, and the panel behind it
// wants the instance secret — both stubbed here rather than through
// importOriginal(), which would read and write the real on-disk data dir as an
// import side effect.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let specId: number
let otherSpecId: number
let configId: number
let otherConfigId: number
let culledId: number
let backfilledId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-config-notices-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: "test:spec/notices", name: "Notices" })
		.returning()
	specId = spec.id
	const [other] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: "test:spec/elsewhere", name: "Elsewhere" })
		.returning()
	otherSpecId = other.id

	const [config] = await testDb
		.insert(schema.pipelineConfigs)
		.values({ specId, name: "Tuned" })
		.returning()
	configId = config.id
	const [otherConfig] = await testDb
		.insert(schema.pipelineConfigs)
		.values({ specId: otherSpecId, name: "Someone else's" })
		.returning()
	otherConfigId = otherConfig.id

	const notices = await testDb
		.insert(schema.pipelineConfigNotices)
		.values([
			{
				configId,
				kind: "culled",
				nodeKey: "rank",
				slot: "params",
				path: "scanDepth",
				label: "Scan Depth",
				previousValue: 12 as any
			},
			{
				configId,
				kind: "backfilled",
				nodeKey: "rank",
				slot: "params",
				path: "maxEntries",
				label: "Max Entries"
			}
		])
		.returning()
	culledId = (notices as any[])[0].id
	backfilledId = (notices as any[])[1].id
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (isAdmin = true) =>
	({
		user: { id: 1, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

/**
 * An `emitToUser` that keeps what a handler sent, resolving a lazy payload.
 *
 * `pipelines:configNotices` is a gated event, so the refreshed list a dismissal
 * answers with is now a THUNK the real `emitToUser` runs only for a socket that
 * wants it (socket-interest plan, ruling 4) — with no banner open anywhere, the
 * pending-notice read is never paid. Running it here is what the gate does when
 * somebody IS listening, and it is where the list lives: `register` discards
 * what a handler returns, so the emit has always been the real answer.
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

describe("pipelines:configNotices", () => {
	test("answers with the pending notices, named and valued", async () => {
		const { pipelinesConfigNotices } = await import("./pipelines")
		const res = await pipelinesConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId },
			noopEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.configId).toBe(configId)
		const byLabel = new Map(
			(res.notices ?? []).map((n) => [n.label, n] as const)
		)
		expect(byLabel.get("Scan Depth")?.kind).toBe("culled")
		// The value the person had set travels with the notice: "your setting
		// was removed" without it asks them to remember what they chose months
		// ago.
		expect(byLabel.get("Scan Depth")?.previousValue).toBe(12)
		expect(byLabel.get("Max Entries")?.kind).toBe("backfilled")
	})

	test("names a control, never a node", async () => {
		// 05 §0a — the configuration payload carries no topology, and a notice
		// is part of that payload. The address is what the SERVER addresses a
		// value by; the label is what a person needs.
		const { pipelinesConfigNotices } = await import("./pipelines")
		const res = await pipelinesConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId },
			noopEmit
		)
		const wire = JSON.stringify(res.notices)
		expect(wire).not.toContain("nodeKey")
		expect(wire).not.toContain("rank")
	})

	test("refuses a configuration belonging to another pipeline", async () => {
		// A config id is a small integer somebody can guess. Without the
		// pairing, one pipeline's screen reads another's notices.
		const { pipelinesConfigNotices } = await import("./pipelines")
		const res = await pipelinesConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId: otherConfigId },
			noopEmit
		)
		expect(res.notices).toBeUndefined()
		expect(res.error).toMatch(/different pipeline/i)
	})

	test("is the administrator's, like every other config verb", async () => {
		const { pipelinesConfigNotices } = await import("./pipelines")
		const res = await pipelinesConfigNotices.handler(
			fakeSocket(false),
			{ slug: "test:spec/notices", configId },
			noopEmit
		)
		expect(res.notices).toBeUndefined()
		expect(res.error).toMatch(/admin/i)
	})
})

describe("pipelines:acknowledgeConfigNotices", () => {
	test("dismisses one and answers with what is left", async () => {
		const { pipelinesAcknowledgeConfigNotices } = await import(
			"./pipelines"
		)
		const out = collecting()
		const res = await pipelinesAcknowledgeConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId, noticeId: culledId },
			out.emit
		)
		expect(res.error).toBeUndefined()
		expect(
			(out.last("pipelines:configNotices").notices ?? []).map(
				(n: any) => n.id
			)
		).toEqual([backfilledId])
	})

	test("the dismissal is on the row, so it outlives the request", async () => {
		// The point of the column: a banner that came back on the next reload
		// would teach people to ignore the one surface that explains a missing
		// setting.
		const [row] = await testDb
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.id, culledId))
		expect(row.acknowledgedAt).toBeTruthy()

		const { pipelinesConfigNotices } = await import("./pipelines")
		const res = await pipelinesConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId },
			noopEmit
		)
		expect((res.notices ?? []).map((n) => n.id)).toEqual([backfilledId])
	})

	test("refuses a non-admin, and leaves the notice pending", async () => {
		const { pipelinesAcknowledgeConfigNotices } = await import(
			"./pipelines"
		)
		const res = await pipelinesAcknowledgeConfigNotices.handler(
			fakeSocket(false),
			{ slug: "test:spec/notices", configId, noticeId: backfilledId },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		const [row] = await testDb
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.id, backfilledId))
		expect(row.acknowledgedAt).toBeNull()
	})

	test("with no id, clears everything the configuration is holding", async () => {
		const { pipelinesAcknowledgeConfigNotices } = await import(
			"./pipelines"
		)
		const out = collecting()
		await pipelinesAcknowledgeConfigNotices.handler(
			fakeSocket(),
			{ slug: "test:spec/notices", configId },
			out.emit
		)
		expect(out.last("pipelines:configNotices").notices).toEqual([])
	})
})
