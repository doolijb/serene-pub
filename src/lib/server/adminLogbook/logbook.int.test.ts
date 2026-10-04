/**
 * The admin logbook end to end against real migrations: a settings change
 * through its real handler writes exactly one record with the diff, a
 * non-admin or a refused change writes none, and the History read filters by
 * object and pages by cursor. The wrapper's three steps
 * (`logbookBegin` → handler → `logbookCommit`) are driven here in the order
 * `sockets/index.ts` `register` runs them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let dataDir: string

const { getDb, setDb } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		}
	}
})

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	return {
		...actual,
		get db() {
			return getDb()
		}
	}
})

let testDb: TestDb

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-logbook-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	setDb(testDb)
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const admin = { id: 1, isAdmin: true, username: "admin", displayName: "Ada" }
const socketOf = (user: any) => ({ user, io: { to: () => ({ emit() {} }) } }) as any

/** What `register` does around a handler. */
async function dispatch(user: any, handler: any, params: any) {
	const { logbookBegin, logbookCommit } = await import("./record")
	const pending = await logbookBegin(user, handler.event, params, testDb as any)
	let errored = false
	let emitted: unknown
	const emit = (event: string, data: any) => {
		if (event === `${handler.event}:error`) errored = true
		if (event === handler.event && typeof data !== "function") emitted = data
	}
	let result: unknown
	try {
		result = await handler.handler(socketOf(user), params, emit)
	} catch {
		return null
	}
	if (!pending || errored) return null
	return logbookCommit(pending, result ?? emitted, testDb as any)
}

describe("admin logbook (PGlite integration)", () => {
	test("a settings change writes one record with its diff", async () => {
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"$lib/server/sockets/systemSettings"
		)
		const before = await testDb.select().from(schema.adminLogbook)
		const row = await dispatch(admin, systemSettingsUpdateDefaultLanguage, {
			language: "fr"
		})
		const after = await testDb.select().from(schema.adminLogbook)
		expect(after.length - before.length).toBe(1)
		expect(row).toMatchObject({
			actorUserId: 1,
			actorName: "Ada",
			event: "systemSettings:updateDefaultLanguage",
			objectType: "pub",
			objectId: null,
			action: "change"
		})
		expect(row!.summary).toMatch(/^Changed default language from .* to “fr”$/)
		expect(row!.changes).toEqual([
			expect.objectContaining({ field: "defaultLanguage", after: "fr" })
		])
	}, 60_000)

	test("a non-admin's change and a refused change write nothing", async () => {
		const { systemSettingsUpdateDefaultLanguage } = await import(
			"$lib/server/sockets/systemSettings"
		)
		const count = async () =>
			(await testDb.select().from(schema.adminLogbook)).length
		const n = await count()
		await dispatch(
			{ id: 2, isAdmin: false, username: "u" },
			systemSettingsUpdateDefaultLanguage,
			{ language: "de" }
		)
		// An unsupported language is refused by the handler.
		await dispatch(admin, systemSettingsUpdateDefaultLanguage, {
			language: "xx-not-a-language"
		})
		expect(await count()).toBe(n)
	}, 60_000)

	test("History reads by object and pages by cursor", async () => {
		const { logbookBegin, logbookCommit } = await import("./record")
		// Three connection records for two objects, written as the wrapper would.
		for (const id of [12, 12, 13]) {
			const p = await logbookBegin(admin, "connections:delete", { id }, testDb as any)
			await logbookCommit(p!, {}, testDb as any)
		}
		const { listLogbook } = await import("./read")
		const one = await listLogbook(testDb as any, {
			objectType: "connection",
			objectId: "12"
		})
		expect(one.records).toHaveLength(2)
		expect(one.records.every((r) => r.objectId === "12")).toBe(true)
		expect(one.records[0].summary).toBe("Deleted connection “12”")

		const page1 = await listLogbook(testDb as any, { limit: 2 })
		expect(page1.records).toHaveLength(2)
		expect(page1.hasMore).toBe(true)
		const page2 = await listLogbook(testDb as any, {
			limit: 2,
			before: page1.records[1].id
		})
		expect(page2.records[0].id).toBeLessThan(page1.records[1].id)

		const singleton = await listLogbook(testDb as any, {
			objectType: "pub",
			objectId: ""
		})
		expect(singleton.records.length).toBeGreaterThan(0)
		expect(singleton.actors).toEqual([{ id: 1, name: "Ada" }])

		const text = await listLogbook(testDb as any, { text: "default language" })
		expect(text.records.every((r) => r.objectType === "pub")).toBe(true)

		// One record by id: the change view's read.
		const target = page1.records[1]
		const byId = await listLogbook(testDb as any, { recordId: target.id })
		expect(byId.records).toEqual([target])
		expect(byId.hasMore).toBe(false)
		const none = await listLogbook(testDb as any, { recordId: 999_999 })
		expect(none.records).toEqual([])
	}, 60_000)

	test("pruning keeps the newest N and drops the expired", async () => {
		const { pruneLogbook } = await import("./record")
		await pruneLogbook(testDb as any, new Date(), { max: 2 })
		expect((await testDb.select().from(schema.adminLogbook)).length).toBe(2)
		await pruneLogbook(
			testDb as any,
			new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
		)
		expect((await testDb.select().from(schema.adminLogbook)).length).toBe(0)
	}, 60_000)
})
