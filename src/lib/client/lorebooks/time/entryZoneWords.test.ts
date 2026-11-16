import { describe, expect, test } from "vitest"
import { entryZoneWords, type EntryZoneWordsInput } from "./entryZoneWords"
import type { ZoneField } from "./entryVersions"

const ALL: ZoneField[] = ["keys", "constant", "enabled", "anchorEntryId"]
const base: EntryZoneWordsInput = {
	timeline: true,
	lineWords: "On main",
	beganAt: null,
	decayRate: 0,
	held: [],
	keyCount: 0,
	fileable: true,
	parentName: null,
	pinned: false,
	off: false
}
const say = (over: Partial<EntryZoneWordsInput>) =>
	entryZoneWords({ ...base, ...over })

describe("entryZoneWords", () => {
	test("owner examples", () => {
		expect(say({ held: ALL })).toBe(
			"On main · Perpetual · Fact · no keywords · top level"
		)
		expect(
			say({
				lineWords: "On Duel lost",
				beganAt: "Year 5",
				decayRate: 0.25,
				held: ALL,
				keyCount: 3,
				parentName: "The Hill",
				pinned: true
			})
		).toBe(
			"On Duel lost · Began at Year 5 · Living · 0.25 · 3 keywords · part of The Hill · pinned"
		)
	})
	test("Timeline off", () => {
		expect(say({ timeline: false, held: ALL })).toBe(
			"Decay: Fact · no keywords · top level"
		)
		expect(say({ timeline: false, decayRate: 0.6 })).toBe(
			"Decay: Living · 0.6"
		)
	})
	test("empty held gives the old words", () => {
		expect(say({})).toBe("On main · Perpetual · Fact")
		expect(say({ lineWords: null })).toBe("Perpetual · Fact")
		expect(say({ timeline: false })).toBe("Decay: Fact")
	})
	test("each field is left out when not held", () => {
		const loud = { keyCount: 2, parentName: "X", pinned: true, off: true }
		expect(say({ ...loud, held: [] })).toBe("On main · Perpetual · Fact")
		expect(say({ ...loud, held: ["keys"] })).toBe(
			"On main · Perpetual · Fact · 2 keywords"
		)
		expect(say({ ...loud, held: ["anchorEntryId"] })).toBe(
			"On main · Perpetual · Fact · part of X"
		)
		expect(say({ ...loud, held: ["constant"] })).toBe(
			"On main · Perpetual · Fact · pinned"
		)
		expect(say({ ...loud, held: ["enabled"] })).toBe(
			"On main · Perpetual · Fact · off"
		)
	})
	test("1 keyword versus n", () => {
		expect(say({ held: ["keys"], keyCount: 1 })).toContain("· 1 keyword")
		expect(say({ held: ["keys"], keyCount: 1 })).not.toContain("keywords")
		expect(say({ held: ["keys"], keyCount: 4 })).toContain("· 4 keywords")
	})
	test("a place has no parent words", () => {
		expect(say({ held: ["anchorEntryId"], fileable: false })).toBe(
			"On main · Perpetual · Fact"
		)
	})
	test("pinned and off only when set", () => {
		expect(say({ held: ALL, keyCount: 1 })).toBe(
			"On main · Perpetual · Fact · 1 keyword · top level"
		)
		expect(say({ held: ["constant", "enabled"], off: true })).toBe(
			"On main · Perpetual · Fact · off"
		)
	})
	test("rate formatting", () => {
		expect(say({ decayRate: 1 })).toContain("Living · 1")
		expect(say({ decayRate: 0.6 })).toContain("Living · 0.6")
		expect(say({ decayRate: 0.333 })).toContain("Living · 0.33")
		expect(say({ decayRate: -1 })).toContain("Fact")
	})
})
