import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { pluginHookInvocations } from "$lib/server/db/schema"
import { pruneInvocations } from "./store"
import type { InvocationRecord } from "./SandboxManager"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const NOW = new Date("2026-11-13T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY)

const row = (hookName: string, finishedAt: Date) => ({
	pluginId: "acme.ret",
	pluginName: "Ret",
	bundleHash: "h",
	hookName,
	backend: "quickjs",
	mode: "concurrent",
	queuedAt: finishedAt,
	startedAt: finishedAt,
	finishedAt,
	durationMs: 1,
	ok: true,
	outcome: "ok"
})

const survivors = async () =>
	(await db.select().from(pluginHookInvocations))
		.map((r) => r.hookName)
		.sort()

beforeEach(async () => {
	await db.delete(pluginHookInvocations)
})

describe("invocation log retention", () => {
	it("deletes rows older than the day cut", async () => {
		await db
			.insert(pluginHookInvocations)
			.values([
				row("old", at(31)),
				row("edge", at(29)),
				row("new", at(1))
			])
		await pruneInvocations(db, NOW, { days: 30, maxRows: 100 })
		expect(await survivors()).toEqual(["edge", "new"])
	})

	it("keeps only the newest maxRows by finished_at", async () => {
		await db
			.insert(pluginHookInvocations)
			.values([1, 2, 3, 4, 5, 6, 7].map((d) => row("r" + d, at(d))))
		await pruneInvocations(db, NOW, { days: 30, maxRows: 5 })
		expect(await survivors()).toEqual(["r1", "r2", "r3", "r4", "r5"])
	})

	it("applies both cuts: the survivors are the intersection", async () => {
		await db
			.insert(pluginHookInvocations)
			.values([
				row("a", at(1)),
				row("b", at(2)),
				row("c", at(3)),
				row("d", at(40)),
				row("e", at(50))
			])
		// Day cut leaves a,b,c; row cut leaves a,b → a,b.
		await pruneInvocations(db, NOW, { days: 30, maxRows: 2 })
		expect(await survivors()).toEqual(["a", "b"])
		// Row cut alone would keep 4; the day cut still removes the old ones.
		await db.delete(pluginHookInvocations)
		await db
			.insert(pluginHookInvocations)
			.values([row("a", at(1)), row("d", at(40)), row("e", at(50))])
		await pruneInvocations(db, NOW, { days: 30, maxRows: 4 })
		expect(await survivors()).toEqual(["a"])
	})

	it("the first write after boot prunes", async () => {
		vi.resetModules()
		const fresh = await import("./store")
		await db.insert(pluginHookInvocations).values(row("ancient", at(90)))
		const t = Date.now()
		const rec: InvocationRecord = {
			pluginId: "acme.ret",
			pluginName: "Ret",
			bundleHash: "h",
			hookName: "live",
			backend: "quickjs",
			mode: "concurrent",
			queuedAt: t,
			startedAt: t,
			finishedAt: t,
			durationMs: 1,
			ok: true,
			outcome: "ok"
		} as InvocationRecord
		await fresh.writeInvocation(db, rec)
		expect(await survivors()).toEqual(["live"])
		// The second write is not a prune write (cadence is every 100).
		await db.insert(pluginHookInvocations).values(row("ancient2", at(90)))
		await fresh.writeInvocation(db, rec)
		expect(await survivors()).toEqual(["ancient2", "live", "live"])
	})
})
