/**
 * The `migrate` moment over lorebook documents too (M0, lane S2; SHAPES L9 Migration):
 * a fake manager whose `migrate` callback renames key `a` to `b`. Pinned: a session document
 * and a lorebook document of the owner are both migrated and stored, each told which by
 * `scope`; a lorebook input carries no `sessionId`; a lorebook without the owner is not
 * visited; a callback that throws on a lorebook document leaves it and counts it in `left`.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import type { SandboxManager } from "./SandboxManager"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let userId: number
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db }
})

const OWNER = "acme.tracker"

function fakeManager(answer: (input: any) => unknown) {
	const calls: any[] = []
	const mgr = {
		isRegistered: (id: string) => id === OWNER,
		callHook: async (_id: string, hook: string, input: any) => {
			calls.push({ hook, input })
			return { ok: true, value: answer(input), logs: [], durationMs: 0, backend: "quickjs" }
		}
	} as unknown as SandboxManager
	return { mgr, calls }
}

/** Renames `a` to `b`. */
const rename = (input: any) => ({
	kind: "ok",
	value: { document: { b: input.document.a } }
})

async function session(annex: Record<string, unknown>) {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "s", annex } as any)
		.returning()
	return s!.id
}
async function book(annex: Record<string, unknown>) {
	const [b] = await db.insert(schema.lorebooks).values({ userId, name: "b", annex } as any).returning()
	return b!.id
}
async function sessionAnnex(id: number) {
	const [r] = await db.select({ a: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, id))
	return r!.a as Record<string, any>
}
async function bookAnnex(id: number) {
	const [r] = await db.select({ a: schema.lorebooks.annex }).from(schema.lorebooks).where(eq(schema.lorebooks.id, id))
	return r!.a as Record<string, any>
}

describe("annex owner migrate over lorebook documents", () => {
	beforeAll(async () => {
		await import("$lib/server/db")
		userId = (await createTestUser(db, "annex-migrate-lorebook")).id
	}, 60_000)

	it("migrates one session document and one lorebook document, each stored", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const s = await session({ [OWNER]: { a: 1 }, other: { keep: true } })
		const l = await book({ [OWNER]: { a: 2 }, other: { keep: true } })
		const { mgr, calls } = fakeManager(rename)
		const out = await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		expect(out).toEqual({ migrated: 2, left: 0 })
		expect(calls).toHaveLength(2)
		expect((await sessionAnnex(s))[OWNER]).toEqual({ b: 1 })
		expect((await sessionAnnex(s)).other).toEqual({ keep: true })
		expect((await bookAnnex(l))[OWNER]).toEqual({ b: 2 })
		expect((await bookAnnex(l)).other).toEqual({ keep: true })
	}, 60_000)

	it("tells each document which it is: a session input has scope and sessionId, a lorebook input has scope and no sessionId", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const s = await session({ [OWNER]: { a: 1 } })
		const l = await book({ [OWNER]: { a: 2 } })
		const { mgr, calls } = fakeManager(rename)
		await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		const forSession = calls.map((c) => c.input).find((i) => i.scope?.kind === "session" && i.sessionId === s)
		expect(forSession).toMatchObject({ sessionId: s, scope: { kind: "session", sessionId: s } })
		const forBook = calls.map((c) => c.input).find((i) => i.scope?.kind === "lorebook" && i.scope.lorebookId === l)
		expect(forBook).toMatchObject({ scope: { kind: "lorebook", lorebookId: l }, fromVersion: "1.0.0", version: "2.0.0" })
		expect(Object.hasOwn(forBook, "sessionId")).toBe(false)
	}, 60_000)

	it("does not visit a lorebook whose annex lacks the owner", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const l = await book({ other: { a: 9 } })
		const { mgr, calls } = fakeManager(rename)
		await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		expect(calls.some((c) => c.input.scope?.kind === "lorebook" && c.input.scope.lorebookId === l)).toBe(false)
		expect(await bookAnnex(l)).toEqual({ other: { a: 9 } })
	}, 60_000)

	it("a callback that throws on the lorebook document leaves it unchanged and counts it in left", async () => {
		const { migrateAnnexOwner } = await import("./annexMigrate")
		const l = await book({ [OWNER]: { a: 5 } })
		const { mgr } = fakeManager((input) => {
			if (input.scope?.kind === "lorebook" && input.scope.lorebookId === l) throw new Error("boom")
			return rename(input)
		})
		const out = await migrateAnnexOwner(db as any, mgr, OWNER, { fromVersion: "1.0.0", version: "2.0.0" })
		expect(out.left).toBeGreaterThanOrEqual(1)
		expect(await bookAnnex(l)).toEqual({ [OWNER]: { a: 5 } })
	}, 60_000)
})
