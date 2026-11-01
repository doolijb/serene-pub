/**
 * 🚧 (M2b) `appletApi:userAnnex` over a real (in-memory) DB: refused without the
 * grant, answered with it, and the person is always the socket's. Needs the
 * `user_annexes` table and the built SDK.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let db: TestDb
let a: number
let b: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const FIELDS = [{ key: "profile", shape: { type: "string" }, see: [], scope: "user" }]

async function plugin(pluginId: string, permissions: unknown, enabled = true, review = true) {
	const { reviewMarks, declaredPermissions } = await import("$lib/server/plugins/permissions")
	const manifest = { annexFields: FIELDS, permissions } as any
	await db.insert(schema.plugins).values({
		pluginId,
		name: pluginId,
		bundleSource: "// x",
		bundleHash: `h-${pluginId}`,
		enabled,
		manifest,
		adminDenied: review ? reviewMarks(declaredPermissions(manifest)) : []
	})
}

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	;[{ id: a }, { id: b }] = await db
		.insert(schema.users)
		.values([{ username: "sock-a" }, { username: "sock-b" }])
		.returning({ id: schema.users.id })
	await plugin("acme.granted", { applet: { annex: { user: true } } })
	await plugin("acme.ungranted", {})
	await plugin("acme.unreviewed", { applet: { annex: { user: true } } }, true, false)
	await plugin("acme.off", { applet: { annex: { user: true } } }, false)
}, 120_000)

async function ask(userId: number | undefined, params: any) {
	const { pluginsUserAnnex } = await import("./userAnnex")
	const events: { event: string; data: any }[] = []
	const socket = { user: userId === undefined ? undefined : { id: userId } } as any
	try {
		const res = await pluginsUserAnnex.handler(socket, params, (event: string, data: any) => events.push({ event, data }))
		return { res, events }
	} catch (e: any) {
		return { error: e, events }
	}
}

describe("appletApi:userAnnex", () => {
	test("refused: signed out, unknown, ungranted, unreviewed, switched off", async () => {
		for (const [uid, id] of [
			[undefined, "acme.granted"],
			[a, "acme.nobody"],
			[a, "acme.ungranted"],
			[a, "acme.unreviewed"],
			[a, "acme.off"]
		] as const) {
			const r = await ask(uid, { pluginId: id, op: "get", key: "profile" })
			expect(r.error, `${uid} ${id}`).toBeTruthy()
			expect(r.events.some((e) => e.event === "appletApi:userAnnex:error")).toBe(true)
		}
	})

	test("granted: set, get, list, remove — and the person is the socket's", async () => {
		const set = await ask(a, { pluginId: "acme.granted", op: "set", key: "profile", doc: "hello", requestId: "r1" })
		expect(set.res).toMatchObject({ pluginId: "acme.granted", requestId: "r1", result: { ok: true, version: 1 } })
		const mine = await ask(a, { pluginId: "acme.granted", op: "get", key: "profile" })
		expect((mine.res as any).result).toMatchObject({ doc: "hello" })
		const theirs = await ask(b, { pluginId: "acme.granted", op: "get", key: "profile" })
		expect((theirs.res as any).result).toBeNull()
		const list = await ask(a, { pluginId: "acme.granted", op: "list" })
		expect((list.res as any).result.rows.map((r: any) => r.key)).toEqual(["profile"])
		const stale = await ask(a, { pluginId: "acme.granted", op: "set", key: "profile", doc: "x", base: 0 })
		expect((stale.res as any).result).toMatchObject({ ok: false, stale: true })
		const rm = await ask(a, { pluginId: "acme.granted", op: "remove", key: "profile" })
		expect((rm.res as any).result).toMatchObject({ ok: true })
	})

	test("a user id in the params is ignored", async () => {
		await ask(a, { pluginId: "acme.granted", op: "set", key: "profile", doc: "a's", userId: b })
		const asB = await ask(b, { pluginId: "acme.granted", op: "get", key: "profile" })
		expect((asB.res as any).result).toBeNull()
	})
})
