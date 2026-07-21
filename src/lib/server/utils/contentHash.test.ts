import { describe, expect, test } from "vitest"
import { hashCanonicalJson, sortKeysDeep } from "./contentHash"

describe("sortKeysDeep", () => {
	test("sorts nested object keys, not just top-level", () => {
		const a = sortKeysDeep({ b: 1, a: { d: 2, c: 3 } })
		const b = sortKeysDeep({ a: { c: 3, d: 2 }, b: 1 })
		expect(JSON.stringify(a)).toBe(JSON.stringify(b))
	})

	test("preserves array order and element identity", () => {
		expect(sortKeysDeep([{ b: 1, a: 2 }, "x", 3])).toEqual([
			{ a: 2, b: 1 },
			"x",
			3
		])
	})

	test("leaves primitives and null untouched", () => {
		expect(sortKeysDeep(null)).toBe(null)
		expect(sortKeysDeep(42)).toBe(42)
		expect(sortKeysDeep("str")).toBe("str")
	})
})

describe("hashCanonicalJson", () => {
	test("produces identical hashes for the same content in different key order", () => {
		const h1 = hashCanonicalJson({ name: "Aria", tags: ["a", "b"], nested: { x: 1, y: 2 } })
		const h2 = hashCanonicalJson({ nested: { y: 2, x: 1 }, tags: ["a", "b"], name: "Aria" })
		expect(h1).toBe(h2)
	})

	test("produces different hashes when content actually differs", () => {
		const h1 = hashCanonicalJson({ name: "Aria" })
		const h2 = hashCanonicalJson({ name: "Kael" })
		expect(h1).not.toBe(h2)
	})

	test("array order matters (unlike object key order)", () => {
		const h1 = hashCanonicalJson({ keys: ["a", "b"] })
		const h2 = hashCanonicalJson({ keys: ["b", "a"] })
		expect(h1).not.toBe(h2)
	})
})
