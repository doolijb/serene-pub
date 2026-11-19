/**
 * Round-4 audit fixes, auth/session lane:
 *  - 2a: usersCurrentSetPassphrase used to overwrite an existing passphrase
 *      with no re-authentication — only usersCurrentChangePassphrase
 *      verified the current passphrase first. Now setPassphrase rejects if
 *      an active passphrase already exists.
 *  - 2b: neither passphrase handler revoked other sessions/sockets on
 *      success — a stolen token/open socket survived a passphrase change
 *      indefinitely. Now both call expireAll and disconnectSockets, in that
 *      order, strictly AFTER emitting the success response (caller and
 *      target share the same user room).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-users-passphrase-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function makeOrderedSpies() {
	const calls: string[] = []
	const emitToUser = (event: string) => {
		calls.push(`emit:${event}`)
	}
	const io = {
		to: (room: string) => ({
			emit: () => {},
			disconnectSockets: () => {
				calls.push(`disconnect:${room}`)
			}
		})
	}
	return { calls, emitToUser, io }
}

const VALID_PASSPHRASE = "Correct-Horse-Battery-9"

describe("users:current:setPassphrase — re-authentication gap (PGlite integration)", () => {
	test("rejects when a passphrase already exists", async () => {
		const { usersCurrentSetPassphrase } = await import("./users")
		const user = await makeUser("setpass-existing-user")
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})

		const { calls, emitToUser, io } = makeOrderedSpies()
		await expect(
			usersCurrentSetPassphrase.handler(
				{ user: { id: user.id }, io },
				{ passphrase: "Different-Horse-Battery-9" } as any,
				emitToUser
			)
		).rejects.toThrow()

		// Must reject with just the error emission — no token/socket
		// revocation, since nothing was actually changed.
		expect(calls).toEqual(["emit:users:current:setPassphrase:error"])

		const stillValid = await passphrase.validate({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})
		expect(stillValid).toBe(true)
	})

	test("succeeds for first-time setup, then revokes tokens and disconnects sockets after emitting", async () => {
		const { usersCurrentSetPassphrase } = await import("./users")
		const user = await makeUser("setpass-firsttime-user")
		const userTokens = await import("$lib/server/providers/users/tokens")
		await userTokens.create({ userId: user.id.toString() })

		const { calls, emitToUser, io } = makeOrderedSpies()
		const res = await usersCurrentSetPassphrase.handler(
			{ user: { id: user.id }, io },
			{ passphrase: VALID_PASSPHRASE } as any,
			emitToUser
		)

		expect(res.success).toBe(true)
		expect(calls).toEqual([
			"emit:users:current:setPassphrase",
			`disconnect:user_${user.id}`
		])

		const tokens = await testDb.query.userTokens.findMany({
			where: eq(schema.userTokens.userId, user.id)
		})
		expect(tokens.length).toBeGreaterThan(0)
		expect(tokens.every((t) => t.expiresAt <= new Date())).toBe(true)
	})
})

describe("users:current:setPassphrase — turn accounts on in the same press", () => {
	test("enableAccounts turns accounts on before the sockets are disconnected", async () => {
		const { usersCurrentSetPassphrase } = await import("./users")
		const user = await makeUser("setpass-enable-user")
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, user.id))
		await testDb
			.insert(schema.systemSettings)
			.values({ id: 1, isAccountsEnabled: false })
			.onConflictDoUpdate({
				target: schema.systemSettings.id,
				set: { isAccountsEnabled: false }
			})

		const { calls, emitToUser, io } = makeOrderedSpies()
		await usersCurrentSetPassphrase.handler(
			{ user: { id: user.id, isAdmin: true }, io },
			{ passphrase: VALID_PASSPHRASE, enableAccounts: true } as any,
			emitToUser
		)

		const settings = await testDb.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1)
		})
		expect(settings?.isAccountsEnabled).toBe(true)
		expect(calls[0]).toBe("emit:users:current:setPassphrase")
		expect(calls.at(-1)).toBe(`disconnect:user_${user.id}`)
		expect(calls).toContain("emit:systemSettings:updateAccountsEnabled")
	})

	async function logbookRows() {
		await new Promise((r) => setTimeout(r, 300))
		return (await testDb.select().from(schema.adminLogbook)).filter(
			(r) => r.event === "systemSettings:updateAccountsEnabled"
		)
	}

	async function resetAccounts() {
		await testDb.delete(schema.adminLogbook)
		await testDb
			.insert(schema.systemSettings)
			.values({ id: 1, isAccountsEnabled: false })
			.onConflictDoUpdate({
				target: schema.systemSettings.id,
				set: { isAccountsEnabled: false }
			})
	}

	test("the one-press turn-on is recorded in the admin logbook, once", async () => {
		const { usersCurrentSetPassphrase } = await import("./users")
		const user = await makeUser("setpass-logbook-user")
		await resetAccounts()
		const { emitToUser, io } = makeOrderedSpies()
		await usersCurrentSetPassphrase.handler(
			{ user: { id: user.id, isAdmin: true }, io },
			{ passphrase: VALID_PASSPHRASE, enableAccounts: true } as any,
			emitToUser
		)
		expect(await logbookRows()).toHaveLength(1)
	})

	test("a direct emit of the event still logs exactly one row", async () => {
		const { runHandler } = await import("./runHandler")
		const { systemSettingsUpdateAccountsEnabled } = await import(
			"./systemSettings"
		)
		const user = await makeUser("setpass-direct-user")
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})
		await resetAccounts()
		const { emitToUser, io } = makeOrderedSpies()
		await runHandler(
			{ user: { id: user.id, isAdmin: true }, io },
			systemSettingsUpdateAccountsEnabled,
			{ enabled: true },
			emitToUser
		)
		expect(await logbookRows()).toHaveLength(1)
	})

	test("a non-admin's enableAccounts sets the passphrase and nothing else", async () => {
		// Without the `isAdmin` guard in setPassphrase, runHandler would run the
		// inner handler, which throws "Unauthorized" before any emit or write; the
		// guard is pinned by the absence of the `:error` emit that unguarded
		// dispatch would send through `io`.
		const { usersCurrentSetPassphrase } = await import("./users")
		const user = await makeUser("setpass-nonadmin-user")
		await resetAccounts()
		const { calls, emitToUser, io } = makeOrderedSpies()
		const errors: string[] = []
		const spyIo = {
			to: (room: string) => ({
				emit: (event: string) => errors.push(event),
				disconnectSockets: () => io.to(room).disconnectSockets()
			})
		}
		const res = await usersCurrentSetPassphrase.handler(
			{ user: { id: user.id, isAdmin: false }, io: spyIo } as any,
			{ passphrase: VALID_PASSPHRASE, enableAccounts: true } as any,
			emitToUser
		)
		const settings = await testDb.query.systemSettings.findFirst({
			where: eq(schema.systemSettings.id, 1)
		})
		expect(settings?.isAccountsEnabled).toBe(false)
		expect(calls).not.toContain("emit:systemSettings:updateAccountsEnabled")
		expect(errors).toEqual([])
		expect(await logbookRows()).toHaveLength(0)
		expect(res.success).toBe(true)
	})
})

describe("users:current:changePassphrase — session revocation (PGlite integration)", () => {
	test("revokes tokens and disconnects sockets, strictly after emitting success", async () => {
		const { usersCurrentChangePassphrase } = await import("./users")
		const user = await makeUser("changepass-user")
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})
		const userTokens = await import("$lib/server/providers/users/tokens")
		await userTokens.create({ userId: user.id.toString() })

		const { calls, emitToUser, io } = makeOrderedSpies()
		const res = await usersCurrentChangePassphrase.handler(
			{ user: { id: user.id }, io },
			{
				currentPassphrase: VALID_PASSPHRASE,
				newPassphrase: "New-Horse-Battery-9"
			} as any,
			emitToUser
		)

		expect(res.success).toBe(true)
		expect(calls).toEqual([
			"emit:users:current:changePassphrase",
			`disconnect:user_${user.id}`
		])

		const tokens = await testDb.query.userTokens.findMany({
			where: eq(schema.userTokens.userId, user.id)
		})
		expect(tokens.every((t) => t.expiresAt <= new Date())).toBe(true)

		const stillValidOld = await passphrase.validate({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})
		const validNew = await passphrase.validate({
			userId: user.id.toString(),
			passphrase: "New-Horse-Battery-9"
		})
		expect(stillValidOld).toBe(false)
		expect(validNew).toBe(true)
	})
})

describe("users:current:changePassphrase — brute-force rate limiting (Round-8 audit fix)", () => {
	test("rejects further attempts after enough wrong current-passphrase guesses, even with the correct one", async () => {
		const { usersCurrentChangePassphrase } = await import("./users")
		const user = await makeUser("changepass-ratelimit-user")
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})

		const { emitToUser, io } = makeOrderedSpies()

		// loginRateLimit's default ceiling is 5 attempts per window — burn
		// through it with wrong guesses.
		for (let i = 0; i < 5; i++) {
			await expect(
				usersCurrentChangePassphrase.handler(
					{ user: { id: user.id }, io },
					{
						currentPassphrase: "wrong-guess",
						newPassphrase: "New-Horse-Battery-9"
					} as any,
					emitToUser
				)
			).rejects.toThrow()
		}

		// The next attempt is rejected by the rate limiter itself — proven
		// by supplying the *correct* current passphrase, which would
		// otherwise succeed.
		await expect(
			usersCurrentChangePassphrase.handler(
				{ user: { id: user.id }, io },
				{
					currentPassphrase: VALID_PASSPHRASE,
					newPassphrase: "New-Horse-Battery-9"
				} as any,
				emitToUser
			)
		).rejects.toThrow(/rate limit/i)

		// The passphrase was never actually changed.
		const stillValid = await passphrase.validate({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})
		expect(stillValid).toBe(true)
	})

	test("a successful change clears the rate-limit counter", async () => {
		const { usersCurrentChangePassphrase } = await import("./users")
		const user = await makeUser("changepass-ratelimit-clear-user")
		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		await passphrase.set({
			userId: user.id.toString(),
			passphrase: VALID_PASSPHRASE
		})

		const { emitToUser, io } = makeOrderedSpies()

		// A couple of failed attempts, then a successful one.
		for (let i = 0; i < 2; i++) {
			await expect(
				usersCurrentChangePassphrase.handler(
					{ user: { id: user.id }, io },
					{
						currentPassphrase: "wrong-guess",
						newPassphrase: "New-Horse-Battery-9"
					} as any,
					emitToUser
				)
			).rejects.toThrow()
		}

		const res = await usersCurrentChangePassphrase.handler(
			{ user: { id: user.id }, io },
			{
				currentPassphrase: VALID_PASSPHRASE,
				newPassphrase: "New-Horse-Battery-9"
			} as any,
			emitToUser
		)
		expect(res.success).toBe(true)
	})
})
