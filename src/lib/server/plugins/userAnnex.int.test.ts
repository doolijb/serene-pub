/**
 * 🚧 (M2b) The user annex store over a real (in-memory) DB. Needs the
 * `user_annexes` table (the supervisor's migration) and the built SDK.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { USER_ANNEX_LIMITS } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let a: number
let b: number
const OWNER = "acme.saves"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	;[{ id: a }, { id: b }] = await db
		.insert(schema.users)
		.values([{ username: "annex-a" }, { username: "annex-b" }])
		.returning({ id: schema.users.id })
	await db.insert(schema.plugins).values({
		pluginId: OWNER,
		name: OWNER,
		bundleSource: "// x",
		bundleHash: "hash-annex",
		enabled: true,
		manifest: {
			annexFields: [
				{ key: "profile", shape: { type: "string" }, see: [], scope: "user" },
				{ key: "saves/", shape: { type: "object", fields: { n: { type: "integer", required: true } } }, see: [], scope: "user" },
				{ key: "blobs/", shape: { type: "string" }, see: [], scope: "user" },
				{ key: "session-only", shape: { type: "string" }, see: [] }
			]
		}
	})
}, 120_000)

afterAll(async () => {
	await db.delete(schema.userAnnexes)
})

const store = () => import("./userAnnex")

describe("user annex store", () => {
	test("get / set / list / remove", async () => {
		const s = await store()
		expect(await s.getUserAnnex(db as any, a, OWNER, "profile")).toBeNull()
		expect(await s.setUserAnnex(db as any, a, OWNER, "profile", "hi")).toEqual({ ok: true, version: 1 })
		expect(await s.setUserAnnex(db as any, a, OWNER, "profile", "yo")).toEqual({ ok: true, version: 2 })
		const got = await s.getUserAnnex(db as any, a, OWNER, "profile")
		expect(got).toMatchObject({ key: "profile", doc: "yo", version: 2 })
		await s.setUserAnnex(db as any, a, OWNER, "saves/one", { n: 1 })
		await s.setUserAnnex(db as any, a, OWNER, "saves/two", { n: 2 })
		expect((await s.listUserAnnex(db as any, a, OWNER, "saves/")).map((r) => r.key)).toEqual(["saves/one", "saves/two"])
		expect((await s.listUserAnnex(db as any, a, OWNER)).length).toBe(3)
		expect(await s.removeUserAnnex(db as any, a, OWNER, "saves/two")).toMatchObject({ ok: true })
		expect(await s.getUserAnnex(db as any, a, OWNER, "saves/two")).toBeNull()
	})

	test("base is compare-and-set: stale returns the fresh document; 0 on an existing key is stale", async () => {
		const s = await store()
		await s.setUserAnnex(db as any, a, OWNER, "saves/cas", { n: 1 })
		const stale = await s.setUserAnnex(db as any, a, OWNER, "saves/cas", { n: 2 }, { base: 0 })
		expect(stale).toMatchObject({ ok: false, stale: true, fresh: { doc: { n: 1 }, version: 1 } })
		const ok = await s.setUserAnnex(db as any, a, OWNER, "saves/cas", { n: 2 }, { base: 1 })
		expect(ok).toEqual({ ok: true, version: 2 })
		expect(await s.setUserAnnex(db as any, a, OWNER, "saves/fresh", { n: 1 }, { base: 0 })).toEqual({ ok: true, version: 1 })
		const rm = await s.removeUserAnnex(db as any, a, OWNER, "saves/cas", { base: 1 })
		expect(rm).toMatchObject({ ok: false, stale: true })
	})

	test("refusals: undeclared, bad key, bad shape, session-scope field, oversize", async () => {
		const s = await store()
		expect(await s.setUserAnnex(db as any, a, OWNER, "nope", "x")).toMatchObject({ ok: false, refused: expect.stringContaining("'nope'") })
		expect(await s.setUserAnnex(db as any, a, OWNER, "session-only", "x")).toMatchObject({ ok: false })
		expect(await s.setUserAnnex(db as any, a, OWNER, "Bad Key", "x")).toMatchObject({ ok: false })
		expect(await s.setUserAnnex(db as any, a, OWNER, "saves/x", { n: "text" })).toMatchObject({ ok: false })
		expect(await s.setUserAnnex(db as any, a, OWNER, "blobs/big", "x".repeat(USER_ANNEX_LIMITS.bytesPerDoc))).toMatchObject({ ok: false })
		expect(await s.setUserAnnex(db as any, a, "ghost.plugin", "profile", "x")).toMatchObject({ ok: false })
	})

	test("caps: bytes per owner and documents per owner", async () => {
		const s = await store()
		await db.delete(schema.userAnnexes).where(eq(schema.userAnnexes.userId, b))
		const chunk = "x".repeat(USER_ANNEX_LIMITS.bytesPerDoc - 16)
		const fits = Math.floor(USER_ANNEX_LIMITS.bytesPerOwner / (USER_ANNEX_LIMITS.bytesPerDoc - 14))
		for (let i = 0; i < fits; i++)
			expect(await s.setUserAnnex(db as any, b, OWNER, `blobs/${i}`, chunk)).toMatchObject({ ok: true })
		expect(await s.setUserAnnex(db as any, b, OWNER, "blobs/over", chunk)).toMatchObject({ ok: false, refused: expect.stringContaining("bytes") })
		await db.delete(schema.userAnnexes).where(eq(schema.userAnnexes.userId, b))
		for (let i = 0; i < USER_ANNEX_LIMITS.docsPerOwner; i++)
			await db.insert(schema.userAnnexes).values({ userId: b, owner: OWNER, key: `blobs/${i}`, doc: "x" })
		expect(await s.setUserAnnex(db as any, b, OWNER, "blobs/extra", "x")).toMatchObject({ ok: false, refused: expect.stringContaining("documents") })
		await db.delete(schema.userAnnexes).where(eq(schema.userAnnexes.userId, b))
	})

	test("another person's documents are never visible", async () => {
		const s = await store()
		await s.setUserAnnex(db as any, a, OWNER, "profile", "mine")
		expect(await s.getUserAnnex(db as any, b, OWNER, "profile")).toBeNull()
		expect(await s.listUserAnnex(db as any, b, OWNER)).toEqual([])
		expect(await s.loadUserAnnexSnapshot(db as any, b, OWNER)).toEqual({})
	})

	test("commitUserAnnexWrites is all-or-nothing against each base", async () => {
		const s = await store()
		await db.delete(schema.userAnnexes).where(eq(schema.userAnnexes.userId, b))
		const snap = await s.loadUserAnnexSnapshot(db as any, b, OWNER)
		expect(snap).toEqual({})
		const res = await s.commitUserAnnexWrites(db as any, b, OWNER, [
			{ key: "profile", doc: "p", base: 0 },
			{ key: "saves/a", doc: { n: 1 }, base: 0 }
		])
		expect(res).toEqual({ ok: true })
		const stale = await s.commitUserAnnexWrites(db as any, b, OWNER, [
			{ key: "profile", doc: "q", base: 1 },
			{ key: "saves/a", doc: { n: 2 }, base: 0 }
		])
		expect(stale).toEqual({ ok: false, stale: ["saves/a"] })
		expect((await s.getUserAnnex(db as any, b, OWNER, "profile"))?.doc).toBe("p")
		const bad = await s.commitUserAnnexWrites(db as any, b, OWNER, [
			{ key: "profile", doc: "r", base: 1 },
			{ key: "undeclared", doc: "x", base: 0 }
		])
		expect(bad).toMatchObject({ ok: false, refused: expect.any(String) })
		expect((await s.getUserAnnex(db as any, b, OWNER, "profile"))?.doc).toBe("p")
		expect(await s.commitUserAnnexWrites(db as any, b, OWNER, [{ key: "saves/a", doc: null, base: 1 }])).toEqual({ ok: true })
		expect(await s.getUserAnnex(db as any, b, OWNER, "saves/a")).toBeNull()
	})

	test("removeOwnerUserAnnexes and removeUserAnnexesOfUser", async () => {
		const s = await store()
		await s.setUserAnnex(db as any, a, OWNER, "profile", "x")
		await s.setUserAnnex(db as any, b, OWNER, "profile", "y")
		expect(await s.removeUserAnnexesOfUser(db as any, b)).toBeGreaterThan(0)
		expect(await s.listUserAnnex(db as any, b, OWNER)).toEqual([])
		expect(await s.listUserAnnex(db as any, a, OWNER)).not.toEqual([])
		expect(await s.removeOwnerUserAnnexes(db as any, OWNER)).toBeGreaterThan(0)
		expect(await s.listUserAnnex(db as any, a, OWNER)).toEqual([])
	})

	test("a hard account delete cascades", async () => {
		const s = await store()
		const [{ id }] = await db.insert(schema.users).values({ username: "annex-gone" }).returning({ id: schema.users.id })
		await s.setUserAnnex(db as any, id, OWNER, "profile", "x")
		await db.delete(schema.users).where(eq(schema.users.id, id))
		expect(await db.select().from(schema.userAnnexes).where(eq(schema.userAnnexes.userId, id))).toEqual([])
	})
})
