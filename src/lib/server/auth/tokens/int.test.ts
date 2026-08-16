import { expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-only-secret-key-do-not-use-in-prod"
}))

import { secretKey } from "."

test("secretKey: is a 32-byte base64 string (paseto v3.local's required key length)", () => {
	expect(secretKey).toBeDefined()
	expect(typeof secretKey).toBe("string")
	expect(secretKey.length).toBe(32)
})
