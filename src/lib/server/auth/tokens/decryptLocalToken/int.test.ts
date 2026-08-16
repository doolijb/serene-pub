import { describe, expect, test, vi } from "vitest"

// See generateLocalToken/int.test.ts — same reason for mocking $lib/server/db.
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-only-secret-key-do-not-use-in-prod"
}))

import { generateLocalToken } from "../generateLocalToken"
import { decryptLocalToken } from "."

describe("decryptLocalToken", () => {
	test("decrypts a token back to its original payload", async () => {
		const token = await generateLocalToken({
			payload: { userId: 7, name: "test" }
		})

		const decrypted = await decryptLocalToken({ token })
		expect(decrypted).toMatchObject({ userId: 7, name: "test" })
	})

	test("rejects a tampered token", async () => {
		const token = await generateLocalToken({ payload: { userId: 1 } })
		const tampered = token.slice(0, -4) + "abcd"

		await expect(decryptLocalToken({ token: tampered })).rejects.toThrow()
	})

	test("rejects garbage input", async () => {
		await expect(
			decryptLocalToken({ token: "not-a-real-token" })
		).rejects.toThrow()
	})

	test("rejects an expired token", async () => {
		// paseto's expiresIn parser only supports second-and-up granularity
		// (no "ms" unit) — see node_modules/paseto/lib/help/ms.js.
		const token = await generateLocalToken({
			payload: { userId: 1 },
			expiresIn: "1s"
		})
		await new Promise((resolve) => setTimeout(resolve, 1100))

		await expect(decryptLocalToken({ token })).rejects.toThrow()
	})
})
