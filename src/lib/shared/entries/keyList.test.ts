import { describe, expect, it } from "vitest"
import {
	commaStaysInKey,
	keyList,
	keysFromTyping,
	keysText,
	withKeys,
	withoutKey
} from "./keyList"

const REGEX_KEY = String.raw`\w{2,4}`

describe("keyList (#146)", () => {
	it("keeps a list element for element — never re-splits", () => {
		expect(keyList([REGEX_KEY, "Smith, John"])).toEqual([
			REGEX_KEY,
			"Smith, John"
		])
	})

	it("trims, drops blanks and repeats", () => {
		expect(keyList([" umber ", "", "  ", "umber", "vault"])).toEqual([
			"umber",
			"vault"
		])
	})

	it("reads a legacy comma string as a list, once", () => {
		expect(keyList("tavern, inn ,, ")).toEqual(["tavern", "inn"])
	})

	it("reads nothing as no keys", () => {
		expect(keyList(null)).toEqual([])
		expect(keyList(undefined)).toEqual([])
		expect(keyList([1, null, "a"] as unknown[])).toEqual(["a"])
	})

	it("keysText is for a person to read, not a wire shape", () => {
		expect(keysText(["a", "b"])).toBe("a, b")
	})
})

describe("a comma typed into a key", () => {
	it("stays inside the key in a regex entry", () => {
		expect(commaStaysInKey(String.raw`\w{2`, true)).toBe(true)
		expect(commaStaysInKey("plain", true)).toBe(true)
	})

	it("ends the key in a literal entry", () => {
		expect(commaStaysInKey("tavern", false)).toBe(false)
	})

	it("stays inside an open group or a /…/ literal even in a literal entry", () => {
		expect(commaStaysInKey("a{1", false)).toBe(true)
		expect(commaStaysInKey("[a", false)).toBe(true)
		expect(commaStaysInKey("/ab", false)).toBe(true)
		// A closed group is closed; an escaped brace opens nothing.
		expect(commaStaysInKey("a{1,2}", false)).toBe(false)
		expect(commaStaysInKey(String.raw`a\{`, false)).toBe(false)
	})
})

describe("keysFromTyping", () => {
	it("is ONE key in a regex entry, commas and all", () => {
		expect(keysFromTyping(REGEX_KEY, true)).toEqual([REGEX_KEY])
		expect(keysFromTyping("(a|b){1,2}, c", true)).toEqual(["(a|b){1,2}, c"])
	})

	it("splits a literal paste on the commas outside a group", () => {
		expect(keysFromTyping("tavern, inn", false)).toEqual(["tavern", "inn"])
		expect(keysFromTyping("a{1,3}, b", false)).toEqual(["a{1,3}", "b"])
	})

	it("keeps a /…/ literal whole", () => {
		expect(keysFromTyping("/a{1,3}|b,c/i", false)).toEqual(["/a{1,3}|b,c/i"])
	})

	it("drops a trailing comma and blank typing", () => {
		expect(keysFromTyping("tavern,", false)).toEqual(["tavern"])
		expect(keysFromTyping("   ", true)).toEqual([])
	})
})

describe("editing the list", () => {
	it("appends in order without repeats", () => {
		expect(withKeys(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"])
	})

	it("removes one key by value", () => {
		expect(withoutKey([REGEX_KEY, "b"], REGEX_KEY)).toEqual(["b"])
	})
})
