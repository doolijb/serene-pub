/**
 * TOTP against a real database (plan 26 §10).
 *
 * The RFC conformance is covered in ./index.test.ts; what is under test here is
 * the state machine around it — that a factor cannot take effect before it is
 * proved, that a recovery code works exactly once, and that clearing a factor
 * never leaves a session still claiming to have satisfied it.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schemaModule from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { computeCode, timeStep } from "./index"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const schema = await import("$lib/server/db/schema")
	const db = await createTestDb()
	return { db, schema, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

beforeEach(async () => {
	await testDb.delete(schemaModule.userTotpRecoveryCodes)
	await testDb.delete(schemaModule.userTotp)
	await testDb.delete(schemaModule.userTokens)
	await testDb.delete(schemaModule.users)
})

async function makeUser(username: string) {
	const [user] = await testDb
		.insert(schemaModule.users)
		.values({ username, isAdmin: true })
		.returning()
	return user
}

async function makeSession(userId: number) {
	const [token] = await testDb
		.insert(schemaModule.userTokens)
		.values({
			userId,
			token: `tok-${userId}-${Math.random()}`,
			expiresAt: new Date(Date.now() + 86_400_000),
			browser: "test",
			os: "test"
		})
		.returning()
	return token
}

/** Enrol fully and return the plaintext secret plus recovery codes. */
async function enrol(userId: number, username: string) {
	const svc = await import("./service")
	const { secret } = await svc.beginEnrollment(userId, username)
	const { recoveryCodes } = await svc.confirmEnrollment(
		userId,
		computeCode(secret, timeStep())
	)
	return { secret, recoveryCodes }
}

describe("enrolment", () => {
	test("a started enrolment is not yet in force", async () => {
		const svc = await import("./service")
		const user = await makeUser("pending")
		await svc.beginEnrollment(user.id, user.username)

		// Enabling before the user proves they can produce a code would lock
		// them out with a secret their authenticator never received.
		const state = await svc.getTotpState(user.id)
		expect(state.enrolled).toBe(true)
		expect(state.enabled).toBe(false)
		expect(await svc.isMfaEnabled(user.id)).toBe(false)
	})

	test("a wrong code leaves it not in force", async () => {
		const svc = await import("./service")
		const user = await makeUser("wrongcode")
		await svc.beginEnrollment(user.id, user.username)
		await expect(svc.confirmEnrollment(user.id, "000000")).rejects.toThrow(
			/not correct/i
		)
		expect(await svc.isMfaEnabled(user.id)).toBe(false)
	})

	test("a live code enables it and issues ten recovery codes", async () => {
		const svc = await import("./service")
		const user = await makeUser("enrols")
		const { recoveryCodes } = await enrol(user.id, user.username)

		expect(recoveryCodes).toHaveLength(10)
		const state = await svc.getTotpState(user.id)
		expect(state.enabled).toBe(true)
		expect(state.remainingCodes).toBe(10)
	})

	test("restarting an unconfirmed enrolment replaces the pending secret", async () => {
		const svc = await import("./service")
		const user = await makeUser("restarts")
		const first = await svc.beginEnrollment(user.id, user.username)
		const second = await svc.beginEnrollment(user.id, user.username)
		// A user who abandoned a half-finished enrolment should get a fresh QR
		// code, not the stale one their app failed to scan.
		expect(second.secret).not.toBe(first.secret)
		await expect(
			svc.confirmEnrollment(
				user.id,
				computeCode(first.secret, timeStep())
			)
		).rejects.toThrow()
	})

	test("refuses to re-enrol an account that already has it enabled", async () => {
		const svc = await import("./service")
		const user = await makeUser("already")
		await enrol(user.id, user.username)
		await expect(
			svc.beginEnrollment(user.id, user.username)
		).rejects.toThrow(/already enabled/i)
	})

	test("only the hash of a recovery code is stored", async () => {
		const user = await makeUser("hashed")
		const { recoveryCodes } = await enrol(user.id, user.username)
		const rows = await testDb.query.userTotpRecoveryCodes.findMany({
			where: eq(schemaModule.userTotpRecoveryCodes.userId, user.id)
		})
		const stored = rows.map((r) => r.codeHash).join(" ")
		for (const code of recoveryCodes) {
			expect(stored).not.toContain(code)
		}
	})

	test("the secret is encrypted at rest", async () => {
		const user = await makeUser("encrypted")
		const { secret } = await enrol(user.id, user.username)
		const row = await testDb.query.userTotp.findFirst({
			where: eq(schemaModule.userTotp.userId, user.id)
		})
		expect(JSON.stringify(row!.secret)).not.toContain(secret)
		expect(row!.secret).toMatchObject({
			ciphertext: expect.any(String),
			iv: expect.any(String),
			authTag: expect.any(String)
		})
	})
})

describe("verification", () => {
	test("a valid code marks this session verified and no other", async () => {
		const svc = await import("./service")
		const user = await makeUser("verifies")
		const { secret } = await enrol(user.id, user.username)
		const sessionA = await makeSession(user.id)
		const sessionB = await makeSession(user.id)

		const out = await svc.verifyForSession({
			userId: user.id,
			tokenId: sessionA.id,
			// A step ahead: enrolment already burned the current one.
			code: computeCode(secret, timeStep() + 1)
		})
		expect(out.ok).toBe(true)

		expect(await svc.isMfaPending(user.id, sessionA.id)).toBe(false)
		// Verification is per-session, not per-account.
		expect(await svc.isMfaPending(user.id, sessionB.id)).toBe(true)
	})

	test("a recovery code works once and is then spent", async () => {
		const svc = await import("./service")
		const user = await makeUser("recovers")
		const { recoveryCodes } = await enrol(user.id, user.username)
		const session = await makeSession(user.id)
		const code = recoveryCodes[0]

		const first = await svc.verifyForSession({
			userId: user.id,
			tokenId: session.id,
			code
		})
		expect(first).toMatchObject({
			ok: true,
			usedRecoveryCode: true,
			remainingCodes: 9
		})

		const second = await svc.verifyForSession({
			userId: user.id,
			tokenId: (await makeSession(user.id)).id,
			code
		})
		expect(second.ok).toBe(false)
	})

	test("a recovery code is accepted however the user retypes it", async () => {
		const svc = await import("./service")
		const user = await makeUser("retypes")
		const { recoveryCodes } = await enrol(user.id, user.username)
		const session = await makeSession(user.id)
		const messy = ` ${recoveryCodes[0].toLowerCase().replace("-", " ")} `

		const out = await svc.verifyForSession({
			userId: user.id,
			tokenId: session.id,
			code: messy
		})
		expect(out.ok).toBe(true)
	})

	test("a valid authenticator code never consumes a recovery code", async () => {
		const svc = await import("./service")
		const user = await makeUser("nowaste")
		const { secret } = await enrol(user.id, user.username)
		const session = await makeSession(user.id)

		await svc.verifyForSession({
			userId: user.id,
			tokenId: session.id,
			code: computeCode(secret, timeStep() + 1)
		})
		expect((await svc.getTotpState(user.id)).remainingCodes).toBe(10)
	})

	test("a spent time step cannot be replayed into a second session", async () => {
		const svc = await import("./service")
		const user = await makeUser("replay")
		const { secret } = await enrol(user.id, user.username)
		const step = timeStep() + 1
		const code = computeCode(secret, step)

		await svc.verifyForSession({
			userId: user.id,
			tokenId: (await makeSession(user.id)).id,
			code
		})
		const second = await svc.verifyForSession({
			userId: user.id,
			tokenId: (await makeSession(user.id)).id,
			code
		})
		expect(second.ok).toBe(false)
	})
})

describe("isMfaPending", () => {
	test("is false for a user who has never enrolled", async () => {
		const svc = await import("./service")
		const user = await makeUser("nofactor")
		const session = await makeSession(user.id)
		// This is what keeps the gate invisible on nearly every instance.
		expect(await svc.isMfaPending(user.id, session.id)).toBe(false)
	})

	test("is false while enrolment is unconfirmed", async () => {
		const svc = await import("./service")
		const user = await makeUser("halfway")
		await svc.beginEnrollment(user.id, user.username)
		const session = await makeSession(user.id)
		expect(await svc.isMfaPending(user.id, session.id)).toBe(false)
	})

	test("is true with 2FA enabled and no session row to check", async () => {
		const svc = await import("./service")
		const user = await makeUser("notoken")
		await enrol(user.id, user.username)
		// Fails closed.
		expect(await svc.isMfaPending(user.id, null)).toBe(true)
	})
})

describe("regenerate and clear", () => {
	test("regenerating invalidates every previous code", async () => {
		const svc = await import("./service")
		const user = await makeUser("regen")
		const { recoveryCodes } = await enrol(user.id, user.username)

		const fresh = await svc.regenerateRecoveryCodes(user.id)
		expect(fresh).toHaveLength(10)
		expect(fresh).not.toContain(recoveryCodes[0])

		const out = await svc.verifyForSession({
			userId: user.id,
			tokenId: (await makeSession(user.id)).id,
			code: recoveryCodes[0]
		})
		expect(out.ok).toBe(false)
	})

	test("clearing with revocation removes every session", async () => {
		const svc = await import("./service")
		const user = await makeUser("adminclear")
		await enrol(user.id, user.username)
		await makeSession(user.id)

		await svc.clearTotp(user.id, { revokeSessions: true })

		expect(
			await testDb.query.userTokens.findMany({
				where: eq(schemaModule.userTokens.userId, user.id)
			})
		).toHaveLength(0)
		expect(await svc.isMfaEnabled(user.id)).toBe(false)
	})

	test("clearing without revocation still drops stale verification marks", async () => {
		const svc = await import("./service")
		const user = await makeUser("selfdisable")
		const { secret } = await enrol(user.id, user.username)
		const session = await makeSession(user.id)
		await svc.verifyForSession({
			userId: user.id,
			tokenId: session.id,
			code: computeCode(secret, timeStep() + 1)
		})

		await svc.clearTotp(user.id, { revokeSessions: false })

		// The session survives — a user disabling their own factor should not
		// be logged out — but must not still claim to have cleared a factor
		// that no longer exists, or a later re-enrolment would find it
		// pre-verified against a secret that is gone.
		const token = await testDb.query.userTokens.findFirst({
			where: eq(schemaModule.userTokens.id, session.id)
		})
		expect(token).toBeDefined()
		expect(token!.mfaVerifiedAt).toBeNull()
	})
})
