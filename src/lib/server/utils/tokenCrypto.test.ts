import { expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-only-secret-key-do-not-use-in-prod"
}))

import { encryptToken, decryptToken } from "./tokenCrypto"

test("encryptToken/decryptToken: round-trips plaintext", () => {
	const plaintext = "cv_super-secret-app-password"
	const encrypted = encryptToken(plaintext)

	expect(encrypted.ciphertext).not.toContain(plaintext)
	expect(decryptToken(encrypted)).toBe(plaintext)
})

test("encryptToken: uses a fresh IV per call, producing different ciphertext", () => {
	const plaintext = "same-plaintext"
	const a = encryptToken(plaintext)
	const b = encryptToken(plaintext)

	expect(a.iv).not.toBe(b.iv)
	expect(a.ciphertext).not.toBe(b.ciphertext)
})

test("decryptToken: throws on tampered ciphertext (auth tag mismatch)", () => {
	const encrypted = encryptToken("original-value")
	const tampered = {
		...encrypted,
		ciphertext: Buffer.from("not the real ciphertext!!").toString("base64")
	}

	expect(() => decryptToken(tampered)).toThrow()
})

test("decryptToken: throws on tampered auth tag", () => {
	const encrypted = encryptToken("original-value")
	const flippedTag = Buffer.from(encrypted.authTag, "base64")
	flippedTag[0] ^= 0xff
	const tampered = { ...encrypted, authTag: flippedTag.toString("base64") }

	expect(() => decryptToken(tampered)).toThrow()
})
