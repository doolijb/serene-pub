/**
 * 🚧 (M2c) The applet library doors over a real (in-memory) DB: the grant,
 * the person's own rights and the provided-mark ownership rule. Needs no
 * schema beyond what exists.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	autoEnqueueCharacter: async () => {}
}))

let db: TestDb
let a: number
let b: number
const ids: Record<string, number> = {}

async function plugin(pluginId: string, applet: unknown, enabled = true) {
	const { reviewMarks, declaredPermissions } = await import("$lib/server/plugins/permissions")
	const manifest = { permissions: { applet } } as any
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		bundleSource: "// x",
		bundleHash: `h-${pluginId}`,
		enabled,
		manifest,
		adminDenied: reviewMarks(declaredPermissions(manifest))
	})
}

async function character(userId: number, name: string, mark?: { plugin: string; uuidOk?: boolean }) {
	const [row] = await db
		.insert(schema.characters)
		.values({ userId, name, description: `${name} d` })
		.returning({ id: schema.characters.id, uuid: schema.characters.uuid })
	if (mark) {
		await db
			.update(schema.characters)
			.set({
				extensions: {
					serenepub: {
						provided: {
							plugin: mark.plugin,
							slug: "s",
							version: "1",
							uuid: mark.uuidOk === false ? "00000000-0000-4000-8000-000000000000" : row.uuid
						}
					}
				}
			})
			.where(eq(schema.characters.id, row.id))
	}
	return row.id
}

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "true"
	db = (await import("$lib/server/db")).db as unknown as TestDb
	;[{ id: a }, { id: b }] = await db
		.insert(schema.users)
		.values([{ username: "lib-a" }, { username: "lib-b" }])
		.returning({ id: schema.users.id })
	await plugin("acme.none", {})
	await plugin("acme.read", { characters: "read", lorebooks: "read" })
	await plugin("acme.write", { characters: "write", lorebooks: "read" })
	await plugin("acme.other", { characters: "write" })
	await plugin("acme.off", { characters: "write", lorebooks: "read" }, false)
	ids.plain = await character(a, "Plain")
	ids.mine = await character(a, "Mine", { plugin: "acme.write" })
	ids.theirs = await character(a, "Theirs", { plugin: "acme.other" })
	ids.dup = await character(a, "Dup", { plugin: "acme.write", uuidOk: false })
	ids.bobs = await character(b, "Bobs", { plugin: "acme.write" })
	for (let i = 0; i < 4; i++) await character(a, `Page ${i}`)
	const mk = async (userId: number, name: string, extra: object = {}) =>
		(await db.insert(schema.lorebooks).values({ userId, name, ...extra } as any).returning({ id: schema.lorebooks.id }))[0].id
	ids.bookA = await mk(a, "Alpha book")
	ids.bookShared = await mk(b, "Shared book")
	ids.bookPrivate = await mk(b, "Private book")
	await db.insert(schema.lorebookShares).values({ lorebookId: ids.bookShared, userId: a } as any)
}, 120_000)

async function ask(handlerName: string, userId: number | undefined, params: any) {
	const mod = await import("./appletLibrary")
	const h = (mod as any)[handlerName]
	const events: { event: string; data: any }[] = []
	const socket = { user: userId === undefined ? undefined : { id: userId } } as any
	try {
		const res = await h.handler(socket, params, (event: string, data: any) => events.push({ event, data }))
		return { res, events }
	} catch (e: any) {
		return { error: e as Error, events }
	}
}
const errored = (r: { events: { event: string }[] }, ev: string) => r.events.some((e) => e.event === `${ev}:error`)

describe("appletApi:libraryCharacters", () => {
	test("refused without the grant, signed out, or switched off", async () => {
		for (const [uid, id] of [
			[a, "acme.none"],
			[undefined, "acme.read"],
			[a, "acme.off"],
			[a, "acme.nobody"]
		] as const) {
			const r = await ask("pluginsLibraryCharacters", uid, { pluginId: id, requestId: "r" })
			expect(r.error, `${uid} ${id}`).toBeTruthy()
			expect(errored(r, "appletApi:libraryCharacters")).toBe(true)
		}
	})

	test("lists only the person's own, newest first, pages and searches", async () => {
		const first = await ask("pluginsLibraryCharacters", a, { pluginId: "acme.read", requestId: "r1", limit: 3 })
		expect(first.res).toMatchObject({ pluginId: "acme.read", requestId: "r1" })
		const rows = first.res!.result.rows
		expect(rows).toHaveLength(3)
		expect(first.res!.result.nextCursor).toBe(String(rows[2].id))
		expect(rows[0].id).toBeGreaterThan(rows[1].id)
		const names = new Set<string>()
		let cursor: string | undefined
		for (let i = 0; i < 5; i++) {
			const r = await ask("pluginsLibraryCharacters", a, { pluginId: "acme.read", limit: 3, cursor })
			for (const row of r.res!.result.rows) names.add(row.name)
			cursor = r.res!.result.nextCursor
			if (!cursor) break
		}
		expect(names.has("Bobs")).toBe(false)
		expect(names.size).toBe(8)
		const q = await ask("pluginsLibraryCharacters", a, { pluginId: "acme.read", q: "PAGE" })
		expect(q.res!.result.rows.map((r: any) => r.name).sort()).toEqual(["Page 0", "Page 1", "Page 2", "Page 3"])
		expect(q.res!.result.rows[0].avatarUrl).toBeNull()
		const bad = await ask("pluginsLibraryCharacters", a, { pluginId: "acme.read", cursor: "x" })
		expect(bad.error).toBeTruthy()
	})
})

describe("appletApi:updateCharacter", () => {
	test("a read grant cannot update", async () => {
		const r = await ask("pluginsUpdateCharacter", a, { pluginId: "acme.read", characterId: ids.mine, name: "x" })
		expect(r.error?.message).toMatch(/leave to change characters/)
		expect(errored(r, "appletApi:updateCharacter")).toBe(true)
	})

	test("unmarked, another plugin's, a duplicate, and another person's are refused", async () => {
		for (const id of [ids.plain, ids.theirs, ids.dup]) {
			const r = await ask("pluginsUpdateCharacter", a, { pluginId: "acme.write", characterId: id, name: "Hijack" })
			expect(r.error?.message, String(id)).toBe(
				"That character was not made by this extension, so it cannot change it."
			)
		}
		const bobs = await ask("pluginsUpdateCharacter", a, { pluginId: "acme.write", characterId: ids.bobs, name: "Hijack" })
		expect(bobs.error).toBeTruthy()
		const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, ids.bobs))
		expect(row.name).toBe("Bobs")
	})

	test("the marked own row changes its card fields, keeps its mark; unknown fields refused", async () => {
		const bad = await ask("pluginsUpdateCharacter", a, { pluginId: "acme.write", characterId: ids.mine, extensions: {} })
		expect(bad.error?.message).toMatch(/'extensions'/)
		const none = await ask("pluginsUpdateCharacter", a, { pluginId: "acme.write", characterId: ids.mine })
		expect(none.error).toBeTruthy()
		const r = await ask("pluginsUpdateCharacter", a, {
			pluginId: "acme.write",
			requestId: "u1",
			characterId: ids.mine,
			name: "Mine Renamed",
			nickname: null,
			firstMessage: "Hello"
		})
		expect(r.error).toBeUndefined()
		expect(r.res).toMatchObject({ requestId: "u1", result: { id: ids.mine, name: "Mine Renamed" } })
		const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, ids.mine))
		expect(row.firstMessage).toBe("Hello")
		expect((row.extensions as any).serenepub.provided.plugin).toBe("acme.write")
		expect(r.events.map((e) => e.event)).toContain("characters:update")
	})
})

describe("appletApi:libraryLorebooks", () => {
	test("refused without the grant", async () => {
		const r = await ask("pluginsLibraryLorebooks", a, { pluginId: "acme.other" })
		expect(r.error).toBeTruthy()
	})

	test("own and shared readable books, canEdit right; an unreadable one never", async () => {
		const r = await ask("pluginsLibraryLorebooks", a, { pluginId: "acme.read", requestId: "l1" })
		const byId = new Map<number, any>(r.res!.result.rows.map((x: any) => [x.id, x]))
		expect(byId.get(ids.bookA)).toMatchObject({ canEdit: true })
		expect(byId.get(ids.bookShared)).toMatchObject({ canEdit: false })
		expect(byId.has(ids.bookPrivate)).toBe(false)
		const q = await ask("pluginsLibraryLorebooks", a, { pluginId: "acme.read", q: "alpha" })
		expect(q.res!.result.rows.map((x: any) => x.id)).toEqual([ids.bookA])
		const paged = await ask("pluginsLibraryLorebooks", a, { pluginId: "acme.read", limit: 1 })
		expect(paged.res!.result.nextCursor).toBeTruthy()
	})
})
