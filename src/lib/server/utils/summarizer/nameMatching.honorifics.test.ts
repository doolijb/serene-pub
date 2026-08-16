/**
 * Honorific stripping, and the ambiguity rule that has to ship with it.
 *
 * A live build proposed "Commander Thorne" as a NEW character even though the
 * persona "Maren" (described in-world as Maren Thorne, Commander of Seraphis
 * Station) was already a bound node in the same lorebook. Two matchers existed:
 * graphBuilder's fuzzyMatchName stripped titles via TITLE_WORDS, while
 * namesMatch — which runs EARLIER, at cast resolution, and is where the
 * duplicate binding actually gets minted — compared raw words and could not
 * bridge "Commander Thorne" to "Maren Thorne". The right answer was in the
 * wrong file.
 *
 * Stripping titles makes namesMatch strictly more permissive, and its call site
 * in resolveCharacterRefs took the FIRST match. More permissive matching plus
 * first-match-wins is how duplicates get traded for silent mis-merges, which
 * are harder to spot and harder to undo. So the ambiguity rule lands here too,
 * in the same change — not as a follow-up.
 */
import { describe, expect, test } from "vitest"
import {
	namesMatch,
	resolveCharacterRefs,
	type CastEntry
} from "./availableSceneCast"

const entry = (
	id: number,
	name: string,
	aliases: string[] = []
): CastEntry => ({
	id,
	name,
	aliases
})

describe("namesMatch ignores honorifics", () => {
	test("a title does not block a shared surname", () => {
		expect(namesMatch("Commander Thorne", "Maren Thorne")).toBe(true)
	})

	test("title + surname matches the bare surname", () => {
		expect(namesMatch("Commander Thorne", "Thorne")).toBe(true)
	})

	test.each([
		["Lady Grey", "Grey"],
		["Sir Aldric", "Aldric Vane"],
		["Captain de Vries", "Vries"],
		["The Baron Harkon", "Harkon"]
	])("%s matches %s", (a, b) => {
		expect(namesMatch(a, b)).toBe(true)
	})

	test("stripping does NOT collapse genuinely different people", () => {
		expect(namesMatch("Commander Thorne", "Commander Vex")).toBe(false)
		expect(namesMatch("Lady Grey", "Lady Rowan")).toBe(false)
	})

	test("a name made only of titles falls back to raw words, not a match-all", () => {
		// distinctiveWords("The Baron") is empty; comparing empty sets would
		// make every name a subset of every other name.
		expect(namesMatch("The Baron", "Amara Lin")).toBe(false)
		expect(namesMatch("The Baron", "The Baron")).toBe(true)
	})
})

describe("resolveCharacterRefs refuses to guess between candidates", () => {
	test("an unambiguous title+surname resolves to the bound character", () => {
		const { ids, suggestedNames } = resolveCharacterRefs(
			[{ name: "Commander Thorne" }],
			[entry(5, "Maren", ["Thorne"]), entry(1, "Amara Lin")]
		)
		expect(ids).toEqual([5])
		expect(suggestedNames).toEqual([])
	})

	test("two plausible Thornes resolve to NEITHER, and surface as a suggestion", () => {
		// Previously `castEntries.find(...)`: whichever sorted first silently
		// won, attaching the scene to a character who was never in it. A
		// visible duplicate the user can merge beats a wrong identity they
		// never notice.
		const { ids, suggestedNames } = resolveCharacterRefs(
			[{ name: "Commander Thorne" }],
			[entry(5, "Maren Thorne"), entry(9, "Thorne Blackwood")]
		)
		expect(ids).toEqual([])
		expect(suggestedNames).toEqual(["Commander Thorne"])
	})

	test("an exact name still wins even when fuzzy matching reaches a neighbour", () => {
		// "Thorne" fuzzily matches "Thorne Blackwood" too, but an exact
		// canonical hit is not ambiguous.
		const { ids } = resolveCharacterRefs(
			[{ name: "Thorne" }],
			[entry(5, "Thorne"), entry(9, "Thorne Blackwood")]
		)
		expect(ids).toEqual([5])
	})

	test("a castId ref is unaffected by any of this", () => {
		const { ids } = resolveCharacterRefs(
			[{ castId: 9 }],
			[entry(5, "Maren Thorne"), entry(9, "Thorne Blackwood")]
		)
		expect(ids).toEqual([9])
	})
})
