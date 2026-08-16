import { expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-only-secret-key-do-not-use-in-prod"
}))

import {
	encryptToken,
	decryptToken,
	encryptApiKeyField,
	decryptApiKeyField,
	isEncryptedApiKey,
	CHARAVAULT_KEY_INFO,
	CONNECTION_API_KEY_INFO,
	VECTORIZATION_API_KEY_INFO
} from "./tokenCrypto"

test("encryptToken/decryptToken: round-trips plaintext for each key-info class", () => {
	for (const keyInfo of [
		CHARAVAULT_KEY_INFO,
		CONNECTION_API_KEY_INFO,
		VECTORIZATION_API_KEY_INFO
	]) {
		const plaintext = "cv_super-secret-app-password"
		const encrypted = encryptToken(plaintext, keyInfo)

		expect(encrypted.ciphertext).not.toContain(plaintext)
		expect(decryptToken(encrypted, keyInfo)).toBe(plaintext)
	}
})

test("encryptToken: uses a fresh IV per call, producing different ciphertext", () => {
	const plaintext = "same-plaintext"
	const a = encryptToken(plaintext, CONNECTION_API_KEY_INFO)
	const b = encryptToken(plaintext, CONNECTION_API_KEY_INFO)

	expect(a.iv).not.toBe(b.iv)
	expect(a.ciphertext).not.toBe(b.ciphertext)
})

test("decryptToken: throws on tampered ciphertext (auth tag mismatch)", () => {
	const encrypted = encryptToken("original-value", CONNECTION_API_KEY_INFO)
	const tampered = {
		...encrypted,
		ciphertext: Buffer.from("not the real ciphertext!!").toString("base64")
	}

	expect(() => decryptToken(tampered, CONNECTION_API_KEY_INFO)).toThrow()
})

test("decryptToken: throws on tampered auth tag", () => {
	const encrypted = encryptToken("original-value", CONNECTION_API_KEY_INFO)
	const flippedTag = Buffer.from(encrypted.authTag, "base64")
	flippedTag[0] ^= 0xff
	const tampered = { ...encrypted, authTag: flippedTag.toString("base64") }

	expect(() => decryptToken(tampered, CONNECTION_API_KEY_INFO)).toThrow()
})

test("keyInfo isolation: a value encrypted for one secret class can't be decrypted as another", () => {
	// This is the entire point of generalizing tokenCrypto.ts to take a
	// keyInfo per secret class — a connection API key and the CharaVault
	// token must derive genuinely different keys from the same root
	// secret, not just be logically distinguished by convention.
	const encrypted = encryptToken("some-secret", CONNECTION_API_KEY_INFO)
	expect(() => decryptToken(encrypted, CHARAVAULT_KEY_INFO)).toThrow()
	expect(() => decryptToken(encrypted, VECTORIZATION_API_KEY_INFO)).toThrow()
})

test("encryptApiKeyField/decryptApiKeyField: round-trips through the connections.extraJson envelope shape", () => {
	const plaintext = "sk-test-1234567890"
	const envelope = encryptApiKeyField(plaintext)

	expect(isEncryptedApiKey(envelope)).toBe(true)
	expect(envelope.ciphertext).not.toContain(plaintext)
	expect(decryptApiKeyField(envelope)).toBe(plaintext)
})

test("decryptApiKeyField: a legacy plain-string value (not yet re-saved) passes through unchanged", () => {
	expect(decryptApiKeyField("sk-legacy-plaintext-key")).toBe(
		"sk-legacy-plaintext-key"
	)
})

test("decryptApiKeyField: null/undefined/empty value resolves to undefined", () => {
	expect(decryptApiKeyField(null)).toBeUndefined()
	expect(decryptApiKeyField(undefined)).toBeUndefined()
	expect(decryptApiKeyField("")).toBeUndefined()
})

test("isEncryptedApiKey: rejects a value missing the envelope shape", () => {
	expect(isEncryptedApiKey({ ciphertext: "x" })).toBe(false)
	expect(isEncryptedApiKey("a string")).toBe(false)
	expect(isEncryptedApiKey(null)).toBe(false)
})
