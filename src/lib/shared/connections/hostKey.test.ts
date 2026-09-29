import { describe, expect, it } from "vitest"
import { hostKey, sameHost } from "./hostKey"

describe("whether two addresses name the same host", () => {
	it("forgives a trailing slash", () => {
		expect(sameHost("http://localhost:11434", "http://localhost:11434/")).toBe(true)
	})

	it("forgives the case of the scheme and host", () => {
		expect(sameHost("HTTP://LocalHost:11434", "http://localhost:11434")).toBe(true)
	})

	it("forgives a default port written out", () => {
		expect(sameHost("http://ollama.lan", "http://ollama.lan:80")).toBe(true)
		expect(sameHost("https://ollama.lan", "https://ollama.lan:443/")).toBe(true)
	})

	it("keeps different ports apart", () => {
		expect(sameHost("http://localhost:11434", "http://localhost:11435")).toBe(false)
	})

	it("does NOT equate localhost with 127.0.0.1 — spelling, not network identity", () => {
		// Deciding those are one machine means resolving names. Treating them as
		// two is the safe direction: a duplicate slips through, never a refusal
		// of a genuinely different host.
		expect(sameHost("http://localhost:11434", "http://127.0.0.1:11434")).toBe(false)
	})

	it("treats an empty address as matching nothing, not everything", () => {
		expect(hostKey("")).toBeNull()
		expect(hostKey(null)).toBeNull()
		expect(sameHost("", "")).toBe(false)
		expect(sameHost(null, undefined)).toBe(false)
	})

	it("still matches two identical addresses that are not URLs", () => {
		expect(sameHost("not a url/", "NOT A URL")).toBe(true)
	})
})
