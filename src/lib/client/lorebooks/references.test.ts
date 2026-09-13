/**
 * Whether one row is named in some text.
 *
 * Pure, because it is a rule about strings rather than about a component: a
 * word inside a longer word is not a mention, a keyword with punctuation at
 * its edges still is, and a text match is never dressed up as a retrieval
 * decision.
 */
import { describe, expect, it } from "vitest"
import { keywordsOf, mentions } from "./references"
import type { PoolItem } from "./poolFilter"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: "core:entry/world-lore",
		name: `Entry ${over.id}`,
		content: "",
		keys: "",
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: 0,
		position: over.id,
		priority: 0,
		createdAt: 0,
		updatedAt: 0,
		...over
	}
}

describe("mentions", () => {
	it("finds a keyword written as a word of its own", () => {
		expect(
			mentions("The gate to Umber City is sealed.", "Umber City")
		).toBe(true)
	})

	it("matches whatever case the text wrote it in", () => {
		expect(mentions("UMBER CITY burned.", "Umber City")).toBe(true)
	})

	it("does not count a keyword buried inside a longer word", () => {
		expect(mentions("The ashguard held.", "ash")).toBe(false)
	})

	it("matches a keyword whose own edges are not word characters", () => {
		expect(mentions("Sealed by {{char:1}} alone.", "{{char:1}}")).toBe(true)
	})

	it("reads an empty text as naming nothing", () => {
		expect(mentions("", "umber")).toBe(false)
	})
})

describe("keywordsOf", () => {
	it("reads the keywords as authored, in order", () => {
		expect(keywordsOf(item({ id: 1, keys: "umber, umber city" }))).toEqual([
			"umber",
			"umber city"
		])
	})

	it("drops the blanks a trailing comma leaves behind", () => {
		expect(keywordsOf(item({ id: 1, keys: " , ,  " }))).toEqual([])
	})
})
