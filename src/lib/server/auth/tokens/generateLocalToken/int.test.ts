import { describe, expect, test, vi } from "vitest"

// generateLocalToken pulls in $lib/server/db (via ../index -> secretKey) purely
// to derive the encryption key. Mock it so tests never touch the real,
// on-disk application database.
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-only-secret-key-do-not-use-in-prod"
}))

import { generateLocalToken } from "."
import { decryptLocalToken } from "../decryptLocalToken"

describe("generateLocalToken", () => {
	test("creates a non-empty paseto token string", async () => {
		const token = await generateLocalToken({ payload: { userId: 1 } })

		expect(typeof token).toBe("string")
		expect(token.length).toBeGreaterThan(0)
	})

	test("round-trips the payload through decryptLocalToken", async () => {
		const token = await generateLocalToken({
			payload: { userId: 42, role: "admin" }
		})

		const decrypted = await decryptLocalToken({ token })
		expect(decrypted).toMatchObject({ userId: 42, role: "admin" })
	})

	test("produces a different token each time for the same payload", async () => {
		const a = await generateLocalToken({ payload: { x: 1 } })
		const b = await generateLocalToken({ payload: { x: 1 } })

		expect(a).not.toBe(b)
	})
})
