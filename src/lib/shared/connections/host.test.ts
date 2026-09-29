import { describe, expect, test } from "vitest"
import { isLoopbackAddress } from "./host"

describe("isLoopbackAddress", () => {
	test.each([
		["http://localhost:11434/", true],
		["http://127.0.0.1:11434", true],
		["http://127.1.2.3", true],
		["http://[::1]:11434", true],
		["localhost:11434", true],
		["http://ollama.lan:11434", false],
		["http://192.168.1.20:11434", false],
		["", false],
		[null, false],
		["not a url at all ::", false]
	])("%s → %s", (address, expected) => {
		expect(isLoopbackAddress(address as any)).toBe(expected)
	})
})
