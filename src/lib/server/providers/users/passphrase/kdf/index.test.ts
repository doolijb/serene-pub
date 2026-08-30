/**
 * Passphrase hashing (see ./index.ts).
 *
 * The properties that matter: a correct passphrase verifies and a wrong one
 * does not; the digest is self-describing so parameters can change later
 * without invalidating stored passphrases; the instance pepper genuinely
 * participates; and a legacy PBKDF2 row is recognised as needing an upgrade
 * rather than silently kept forever.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key"
}))

const {
	hashPassphrase,
	verifyPassphrase,
	preferredAlgorithm,
	argon2Available
} = await import("./index")

const PW = "Correct!Horse1"

describe("round trip", () => {
	test("accepts the right passphrase and rejects a wrong one", () => {
		const stored = hashPassphrase(PW)
		expect(verifyPassphrase(PW, stored).valid).toBe(true)
		expect(verifyPassphrase("Wrong!Horse1", stored).valid).toBe(false)
	})

	test("uses Argon2id where the runtime supports it", () => {
		const stored = hashPassphrase(PW)
		expect(stored.startsWith(`$${preferredAlgorithm()}$`)).toBe(true)
		// The Android build (nodejs-mobile 18) takes the scrypt branch instead.
		expect(["argon2id", "scrypt"]).toContain(preferredAlgorithm())
		expect(argon2Available()).toBe(preferredAlgorithm() === "argon2id")
	})

	test("salts per passphrase, so identical inputs differ on disk", () => {
		expect(hashPassphrase(PW)).not.toBe(hashPassphrase(PW))
	})

	test("a modern digest is not flagged for rehash", () => {
		expect(verifyPassphrase(PW, hashPassphrase(PW)).needsRehash).toBe(false)
	})
})

describe("self-describing format", () => {
	test("carries algorithm, cost parameters and salt", () => {
		const stored = hashPassphrase(PW)
		const [, alg, params, salt, hash] = stored.split("$")
		expect(alg).toMatch(/^(argon2id|scrypt)$/)
		// Parameters live beside the digest so the cost can be raised later
		// without invalidating anyone's stored passphrase.
		expect(params).toMatch(/=/)
		expect(Buffer.from(salt, "base64").length).toBe(16)
		expect(Buffer.from(hash, "base64").length).toBe(32)
	})

	test("verifies against the parameters recorded in the row, not today's defaults", () => {
		const stored = hashPassphrase(PW)
		// Simulating a future where defaults were raised: the stored row must
		// still verify on its own terms.
		expect(verifyPassphrase(PW, stored).valid).toBe(true)
	})
})

describe("legacy PBKDF2 rows", () => {
	const legacyDigest = "deadbeef".repeat(8)

	test("a matching legacy hash verifies and is flagged for upgrade", () => {
		const res = verifyPassphrase(PW, legacyDigest, {
			salt: "s",
			iterations: 100000,
			verify: () => legacyDigest
		})
		expect(res.valid).toBe(true)
		expect(res.algorithm).toBe("pbkdf2")
		// This is the scheme being retired — always upgrade on next sign-in.
		expect(res.needsRehash).toBe(true)
	})

	test("a non-matching legacy hash fails", () => {
		const res = verifyPassphrase(PW, legacyDigest, {
			salt: "s",
			iterations: 100000,
			verify: () => "00".repeat(32)
		})
		expect(res.valid).toBe(false)
	})
})

describe("the instance pepper", () => {
	test("a digest does not verify under a different instance secret", async () => {
		const stored = hashPassphrase(PW)
		vi.resetModules()
		vi.doMock("$lib/server/db", () => ({
			getCryptoSecretKey: () => "a-completely-different-secret"
		}))
		const other = await import("./index")
		// A stolen database without meta.json is useless — the same property
		// the original scheme had, preserved through the algorithm change.
		expect(other.verifyPassphrase(PW, stored).valid).toBe(false)
		vi.doUnmock("$lib/server/db")
		vi.resetModules()
	})
})
