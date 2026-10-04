import { describe, expect, test } from "vitest"
import {
	REDACTED,
	diffSnapshots,
	humanizeField,
	idFromResult,
	isRefusal,
	isSecretField,
	paramChanges,
	redactValue,
	summarize
} from "./diff"

describe("isSecretField", () => {
	test.each([
		"password",
		"passphrase",
		"newPassphrase",
		"koboldCppManagedAdminPassword",
		"apiKey",
		"api_key",
		"API-KEY",
		"charaVaultEncryptedToken",
		"charaVaultTokenIv",
		"charaVaultTokenAuthTag",
		"credential",
		"ciphertext",
		"iv",
		"authTag",
		"token",
		"accessToken",
		"tokenHash",
		"recoveryKeyHash",
		"clientSecret",
		"Authorization",
		"code"
	])("%s is secret", (k) => expect(isSecretField(k)).toBe(true))

	test.each([
		"name",
		"baseUrl",
		"maxTokens",
		"tokenCounter",
		"contextTokens",
		"defaultLanguage",
		"isAccountsEnabled",
		"email",
		"hostname"
	])("%s is not secret", (k) => expect(isSecretField(k)).toBe(false))
})

describe("redactValue", () => {
	test("withholds secret keys at any depth, keeps empties empty", () => {
		const out = redactValue({
			name: "Local",
			extraJson: { apiKey: "sk-live-123", headers: { Authorization: "Bearer x" } },
			password: "",
			nested: [{ token: "abc" }]
		}) as any
		expect(out.name).toBe("Local")
		expect(out.extraJson.apiKey).toBe(REDACTED)
		expect(out.extraJson.headers.Authorization).toBe(REDACTED)
		expect(out.password).toBe("")
		expect(out.nested[0].token).toBe(REDACTED)
		expect(JSON.stringify(out)).not.toContain("sk-live-123")
	})

	test("clips long strings and dates become ISO", () => {
		const long = "x".repeat(1000)
		expect((redactValue(long) as string).length).toBeLessThan(300)
		expect(redactValue(new Date("2026-01-02T03:04:05Z"))).toBe(
			"2026-01-02T03:04:05.000Z"
		)
	})
})

describe("diffSnapshots", () => {
	test("one changed scalar, bookkeeping ignored", () => {
		const c = diffSnapshots(
			{ id: 1, defaultLanguage: "en", updatedAt: new Date(1) },
			{ id: 1, defaultLanguage: "fr", updatedAt: new Date(2) }
		)
		expect(c).toEqual([
			{
				field: "defaultLanguage",
				label: "default language",
				before: "en",
				after: "fr"
			}
		])
	})

	test("walks into objects so one knob is one line", () => {
		const c = diffSnapshots(
			{ values: { temperature: 0.7, topP: 0.9 } },
			{ values: { temperature: 1.1, topP: 0.9 } }
		)
		expect(c.map((x) => x.field)).toEqual(["values.temperature"])
		expect(c[0].label).toBe("values › temperature")
	})

	test("a changed secret is a line with no values", () => {
		const c = diffSnapshots(
			{ credential: "old-secret", hostname: "a" },
			{ credential: "new-secret", hostname: "a" }
		)
		expect(c).toEqual([
			{ field: "credential", label: "credential", redacted: true }
		])
		expect(JSON.stringify(c)).not.toContain("secret\"")
		expect(JSON.stringify(c)).not.toContain("new-secret")
	})

	test("nested secrets inside a changed object are withheld", () => {
		const c = diffSnapshots(
			{ extraJson: "a" },
			{ extraJson: { apiKey: "sk-1", model: "m" } }
		)
		expect(JSON.stringify(c)).not.toContain("sk-1")
	})

	test("no change → no lines", () => {
		expect(diffSnapshots({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([])
	})
})

describe("summarize", () => {
	test("single scalar names both values", () => {
		expect(
			summarize({
				action: "change",
				objectTypeLabel: "instance settings",
				objectLabel: "Pub settings",
				changes: diffSnapshots(
					{ defaultLanguage: "en" },
					{ defaultLanguage: "fr" }
				)
			})
		).toBe("Changed default language from “en” to “fr”")
	})

	test("booleans read on/off; several fields are listed", () => {
		expect(
			summarize({
				action: "change",
				objectTypeLabel: "x",
				objectLabel: "",
				changes: diffSnapshots({ scriptsEnabled: false }, { scriptsEnabled: true })
			})
		).toBe("Changed scripts enabled from off to on")
		expect(
			summarize({
				action: "change",
				objectTypeLabel: "connection",
				objectLabel: "Local",
				changes: diffSnapshots(
					{ name: "a", baseUrl: "b", notes: "c" },
					{ name: "A", baseUrl: "B", notes: "C" }
				)
			})
		).toBe("Changed name, base URL and notes")
	})

	test("add/delete/verb/no-op", () => {
		const base = { objectTypeLabel: "connection", objectLabel: "Local", changes: [] }
		expect(summarize({ ...base, action: "add" })).toBe("Added connection “Local”")
		expect(summarize({ ...base, action: "delete" })).toBe(
			"Deleted connection “Local”"
		)
		expect(summarize({ ...base, action: "change" })).toBe("No fields changed")
		expect(summarize({ ...base, action: "other", verb: "Started it" })).toBe(
			"Started it"
		)
	})

	test("a redacted single change never prints values", () => {
		expect(
			summarize({
				action: "change",
				objectTypeLabel: "KoboldCPP manager",
				objectLabel: "",
				changes: [{ field: "password", label: "password", redacted: true }]
			})
		).toBe("Changed password")
	})
})

describe("idFromResult / isRefusal / paramChanges", () => {
	test("finds ids", () => {
		expect(idFromResult({ connection: { id: 12 } }, "connection")).toBe("12")
		expect(idFromResult({ connection: { id: 12 } })).toBe("12")
		expect(idFromResult({ id: 3, token: "x" })).toBe("3")
		expect(idFromResult({ configId: 7, spec: { id: 1 } }, "configId")).toBe("7")
		expect(idFromResult({ backup: { name: "b.tar" } }, "backup.name")).toBe(
			"b.tar"
		)
		expect(idFromResult(undefined)).toBeNull()
	})

	test("refusals", () => {
		expect(isRefusal({ error: "no" })).toBe(true)
		expect(isRefusal({ ok: true })).toBe(false)
		expect(isRefusal(undefined)).toBe(false)
	})

	test("param changes redact secrets and skip absent ones", () => {
		expect(
			paramChanges({ kind: "text", passphrase: "hunter2" }, [
				"kind",
				"passphrase",
				"missing"
			])
		).toEqual([
			{ field: "kind", label: "kind", after: "text" },
			{ field: "passphrase", label: "passphrase", redacted: true }
		])
		expect(paramChanges({ passphrase: "" }, ["passphrase"])).toEqual([])
	})
})

test("humanizeField", () => {
	expect(humanizeField("koboldCppManagerBaseUrl")).toBe(
		"kobold cpp manager base URL"
	)
	expect(humanizeField("isAccountsEnabled")).toBe("accounts enabled")
})
