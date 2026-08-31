/**
 * One-time account invites (plan 27 §3).
 *
 * An invite token is a bearer credential — whoever holds it becomes the account
 * — so what matters is that it works exactly once, dies on schedule, and can be
 * taken back before it is used.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schemaModule from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const schema = await import("$lib/server/db/schema")
	const db = await createTestDb()
	return { db, schema, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let admin: any

beforeAll(async () => {
	const m = await import("$lib/server/db")
	testDb = m.db as unknown as TestDb
}, 60_000)

beforeEach(async () => {
	await testDb.delete(schemaModule.accountInvites)
	await testDb.delete(schemaModule.users)
	;[admin] = await testDb
		.insert(schemaModule.users)
		.values({ username: "admin", isAdmin: true })
		.returning()
})

describe("creation", () => {
	test("returns the token once and stores only its hash", async () => {
		const { createInvite, hashToken } = await import("./index")
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})

		const row = await testDb.query.accountInvites.findFirst({
			where: eq(schemaModule.accountInvites.id, inv.id)
		})
		expect(row!.tokenHash).toBe(hashToken(inv.token))
		// The token is a bearer credential; nothing may keep it readable.
		expect(JSON.stringify(row)).not.toContain(inv.token)
	})

	test("expires in two hours, deliberately fixed", async () => {
		const { createInvite, INVITE_TTL_MS } = await import("./index")
		expect(INVITE_TTL_MS).toBe(2 * 60 * 60 * 1000)
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		const ms = inv.expiresAt.getTime() - Date.now()
		expect(ms).toBeGreaterThan(INVITE_TTL_MS - 5000)
		expect(ms).toBeLessThanOrEqual(INVITE_TTL_MS)
	})

	test("refuses the nonsensical kind/user combinations", async () => {
		const { createInvite } = await import("./index")
		await expect(
			createInvite({ kind: "account", createdBy: admin.id })
		).rejects.toThrow(/must name the user/i)
		await expect(
			createInvite({
				kind: "register",
				userId: admin.id,
				createdBy: admin.id
			})
		).rejects.toThrow(/no account yet/i)
	})
})

describe("claiming", () => {
	test("works exactly once", async () => {
		const { createInvite, claimInvite } = await import("./index")
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})

		expect((await claimInvite(inv.token)).ok).toBe(true)
		const second = await claimInvite(inv.token)
		expect(second.ok).toBe(false)
		expect((second as any).reason).toBe("used")
	})

	test("peeking does not consume it", async () => {
		const { createInvite, peekInvite, claimInvite } = await import(
			"./index"
		)
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		// The page inspects an invite to decide which form to render; doing so
		// must not burn it.
		expect((await peekInvite(inv.token)).ok).toBe(true)
		expect((await peekInvite(inv.token)).ok).toBe(true)
		expect((await claimInvite(inv.token)).ok).toBe(true)
	})

	test("refuses an expired invite", async () => {
		const { createInvite, claimInvite } = await import("./index")
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		await testDb
			.update(schemaModule.accountInvites)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schemaModule.accountInvites.id, inv.id))

		const res = await claimInvite(inv.token)
		expect(res.ok).toBe(false)
		expect((res as any).reason).toBe("expired")
	})

	test("refuses a revoked invite", async () => {
		const { createInvite, claimInvite, revokeInvite } = await import(
			"./index"
		)
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		await revokeInvite(inv.id)

		const res = await claimInvite(inv.token)
		expect(res.ok).toBe(false)
		expect((res as any).reason).toBe("revoked")
	})

	test("refuses an unknown token", async () => {
		const { claimInvite } = await import("./index")
		const res = await claimInvite("not-a-real-token")
		expect((res as any).reason).toBe("not-found")
	})

	test("revoking after use does not resurrect or alter it", async () => {
		const { createInvite, claimInvite, revokeInvite } = await import(
			"./index"
		)
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		await claimInvite(inv.token)
		await revokeInvite(inv.id)
		const row = await testDb.query.accountInvites.findFirst({
			where: eq(schemaModule.accountInvites.id, inv.id)
		})
		// Revocation is scoped to unused invites, so a used one keeps its
		// record of having been used rather than being relabelled.
		expect(row!.usedAt).not.toBeNull()
		expect(row!.revokedAt).toBeNull()
	})

	test("concurrent claims of the same token yield exactly one winner", async () => {
		const { createInvite, claimInvite } = await import("./index")
		const inv = await createInvite({
			kind: "register",
			createdBy: admin.id
		})
		const results = await Promise.all([
			claimInvite(inv.token),
			claimInvite(inv.token),
			claimInvite(inv.token)
		])
		expect(results.filter((r) => r.ok)).toHaveLength(1)
	})
})
