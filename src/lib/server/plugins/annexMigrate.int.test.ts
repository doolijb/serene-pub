/**
 * The `migrate(fromVersion)` lifecycle hook's host half (pr-6 G1): a fake manager whose
 * `migrate` callback renames a key and bumps `v`. Pinned: every session holding the owner's
 * document is migrated and stored, one without it is untouched, `halt` leaves the stored
 * document, and `migrateOwnerDocument` returns the migrated document.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import type { SandboxManager } from "./SandboxManager"

let db: TestDb
let userId: number
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})

let current: SandboxManager
vi.mock("$lib/server/plugins", () => ({ getManager: () => current }))

const OWNER = "acme.tracker"

function fakeManager(answer: (doc: Record<string, unknown>) => unknown) {
	const calls: any[] = []
	const mgr = {
		isRegistered: (id: string) => id === OWNER,
		callHook: async (_id: string, hook: string, input: any) => {
			calls.push({ hook, input })
			return {
				ok: true,
				value: answer(input.document),
				logs: [],
				durationMs: 0,
				backend: "quickjs"
			}
		}
	} as unknown as SandboxManager
	return { mgr, calls }
}

const v2 = (doc: Record<string, unknown>) => ({
	kind: "ok",
	value: { document: { v: 2, hp: doc.health } }
})

async function session(annex: Record<string, unknown> | null) {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "s", ...(annex ? { annex } : {}) } as any)
		.returning()
	return s.id
}
async function annexOf(id: number) {
	const [r] = await db.select({ a: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, id))
	return r.a as Record<string, any> | null
}

describe("annex owner migrate", () => {
	beforeAll(async () => {
		await import("$lib/server/db")
		userId = (await createTestUser(db, "annex-migrate")).id
	}, 60_000)

	it("migrates every session's document of the owner and leaves the rest", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const a = await session({ [OWNER]: { v: 1, health: 7 }, other: { keep: true } })
		const b = await session({ [OWNER]: { v: 1, health: 3 } })
		const c = await session({ other: { v: 1 } })
		const { mgr, calls } = fakeManager(v2)
		const out = await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		expect(out).toEqual({ migrated: 2, left: 0 })
		expect(calls.map((x) => x.input.sessionId).sort()).toEqual([a, b].sort())
		expect(calls[0].input).toMatchObject({ fromVersion: "1.0.0", version: "2.0.0" })
		expect((await annexOf(a))![OWNER]).toEqual({ v: 2, hp: 7 })
		expect((await annexOf(a))!.other).toEqual({ keep: true })
		expect((await annexOf(b))![OWNER]).toEqual({ v: 2, hp: 3 })
		expect(await annexOf(c)).toEqual({ other: { v: 1 } })
	}, 60_000)

	it("a halt leaves the document as stored", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const id = await session({ [OWNER]: { v: 1, health: 9 } })
		const { mgr } = fakeManager(() => ({ kind: "halt", reason: "not mine" }))
		const out = await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		expect(out.migrated).toBe(0)
		expect((await annexOf(id))![OWNER]).toEqual({ v: 1, health: 9 })
	}, 60_000)

	it("migrateOwnerDocument returns the migrated document, or the original when it halts", async () => {
		const { migrateOwnerDocument } = await import("./annexMigrate")
		current = fakeManager(v2).mgr
		expect(await migrateOwnerDocument(db as any, OWNER, 1, { v: 1, health: 5 }, "1.0.0")).toEqual({ v: 2, hp: 5 })
		current = fakeManager(() => ({ kind: "halt", reason: "no" })).mgr
		expect(await migrateOwnerDocument(db as any, OWNER, 1, { v: 1, health: 5 }, "1.0.0")).toEqual({ v: 1, health: 5 })
	}, 60_000)
})
