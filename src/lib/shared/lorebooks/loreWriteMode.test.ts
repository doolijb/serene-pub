/**
 * The lore write mode's levels (owner ruling 2026-10-21, "Personal > Lorebook
 * > Session"): a book only ever tightens the owner's own mode, and the level
 * that is stricter is the one a screen below names.
 */
import { describe, expect, test } from "vitest"
import {
	effectiveLoreWriteMode,
	loreWriteLimit,
	stricterLoreWriteMode
} from "./loreWriteMode"

describe("stricterLoreWriteMode", () => {
	test("Off beats Review beats Full, in either order", () => {
		expect(stricterLoreWriteMode("full", "review")).toBe("review")
		expect(stricterLoreWriteMode("review", "full")).toBe("review")
		expect(stricterLoreWriteMode("review", "off")).toBe("off")
		expect(stricterLoreWriteMode("full", "full")).toBe("full")
	})
})

describe("loreWriteLimit", () => {
	test("a book on Full leaves the personal mode as the answer", () => {
		expect(loreWriteLimit({ personal: "review", book: "full" })).toEqual({
			mode: "review",
			limitedBy: "personal"
		})
		expect(loreWriteLimit({ personal: "full", book: "full" })).toEqual({
			mode: "full",
			limitedBy: null
		})
	})

	test("a stricter book wins, and says so", () => {
		expect(loreWriteLimit({ personal: "full", book: "review" })).toEqual({
			mode: "review",
			limitedBy: "lorebook"
		})
		expect(loreWriteLimit({ personal: "review", book: "off" })).toEqual({
			mode: "off",
			limitedBy: "lorebook"
		})
	})

	test("a book never loosens the personal mode", () => {
		expect(loreWriteLimit({ personal: "off", book: "full" }).mode).toBe("off")
	})

	test("no book, or a value that is not a mode, is the personal mode alone", () => {
		expect(loreWriteLimit({ personal: "review" })).toEqual({ mode: "review", limitedBy: null })
		expect(loreWriteLimit({ personal: "full", book: "sometimes" as any }).mode).toBe("full")
	})

	test("the personal mode itself follows the pub, then Full", () => {
		expect(effectiveLoreWriteMode(null, "review")).toBe("review")
		expect(effectiveLoreWriteMode(null, null)).toBe("full")
	})
})
