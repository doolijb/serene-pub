/**
 * Round-13 audit fix (MEDIUM): usersCurrentChangePassphrase called
 * loginRateLimit.recordFailedAttempt() only inside the `if (!isCurrentValid)`
 * branch, AFTER awaiting the expensive passphrase.validate() call. A burst of
 * concurrent requests with the same (wrong) current passphrase could all pass
 * the isRateLimited() check before any of them reached recordFailedAttempt(),
 * letting more invalid-passphrase attempts through per burst than the
 * configured cap. Fixed by moving recordFailedAttempt() to immediately after
 * the isRateLimited() check, before the passphrase.validate() await — since
 * both calls are synchronous, this makes the check-and-record atomic with
 * respect to any other concurrently-executing call for the same key.
 *
 * This test proves the fix by mocking passphrase.validate() with an
 * artificial delay (simulating its real PBKDF2 + DB-lookup cost) and firing
 * more concurrent wrong-passphrase attempts than the configured limit (5) —
 * asserting validate() is only ever invoked for the first 5, with the rest
 * rejected purely by the rate limiter, never reaching validate() at all.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

vi.mock("$lib/server/providers/users/passphrase", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/providers/users/passphrase")
		>()
	return { ...actual, validate: vi.fn() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-changepass-ratelimit-int-test-")
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

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {}, disconnectSockets: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("users:current:changePassphrase — rate-limiter TOCTOU (Round-13 audit fix)", () => {
	test("a concurrent burst of wrong-passphrase attempts is capped at the configured limit, not let through by the race", async () => {
		const { usersCurrentChangePassphrase } = await import("./users")
		const user = await makeUser("changepass-race-user")

		const passphrase = await import(
			"$lib/server/providers/users/passphrase"
		)
		const validateMock = passphrase.validate as unknown as ReturnType<
			typeof vi.fn
		>
		// Simulates validate()'s real wall-clock cost (DB lookup + PBKDF2) —
		// without a fix, this delay is exactly what lets a concurrent burst
		// all pass the isRateLimited() check before any of them records an
		// attempt.
		validateMock.mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20))
			return false
		})

		const attempts = 10
		const results = await Promise.allSettled(
			Array.from({ length: attempts }, () =>
				usersCurrentChangePassphrase.handler(
					fakeSocket(user.id),
					{
						currentPassphrase: "wrong-guess",
						newPassphrase: "New-Horse-Battery-9"
					} as any,
					noopEmit
				)
			)
		)

		// loginRateLimit's ceiling is 5 attempts per window — only the first
		// 5 concurrent calls should ever reach the expensive validate() step;
		// the rest must be rejected by the rate limiter itself, before
		// validate() is invoked at all.
		expect(validateMock).toHaveBeenCalledTimes(5)

		expect(results.every((r) => r.status === "rejected")).toBe(true)
		const messages = results.map((r) =>
			r.status === "rejected" ? (r.reason as Error).message : ""
		)
		const invalidCount = messages.filter(
			(m) => m === "Invalid current passphrase"
		).length
		const rateLimitedCount = messages.filter(
			(m) => m === "Rate limited"
		).length

		expect(invalidCount).toBe(5)
		expect(rateLimitedCount).toBe(attempts - 5)
	})
})
