import { describe, expect, test } from "vitest"
import {
	isStarterKit,
	kitBookId,
	kitHoldsLine,
	kitSourceLine,
	refOfCard
} from "./starterKitCards"

describe("starter lorebook cards", () => {
	test("a card's id back to the kit it names", () => {
		expect(refOfCard({ id: "primer:drowned-coast" })).toEqual({
			primerId: "drowned-coast"
		})
		expect(refOfCard({ id: "book:41" })).toEqual({ lorebookId: 41 })
		expect(refOfCard({ id: "book:x" })).toBeNull()
		expect(refOfCard({ id: "primer:" })).toBeNull()
		expect(refOfCard({ id: "other" })).toBeNull()
		expect(kitBookId({ id: "book:41" })).toBe(41)
		expect(kitBookId({ id: "primer:drowned-coast" })).toBeNull()
	})

	test("what a kit holds, in words", () => {
		expect(kitHoldsLine({ entries: 12, places: 3, cast: 2 })).toBe(
			"Holds 12 entries, 3 places and 2 cast members"
		)
		expect(kitHoldsLine({ entries: 1, places: 0, cast: 1 })).toBe(
			"Holds 1 entry and 1 cast member"
		)
		expect(kitHoldsLine({ entries: 0, places: 1, cast: 0 })).toBe(
			"Holds 1 place"
		)
		expect(kitHoldsLine({ entries: 0, places: 0, cast: 0 })).toBe(
			"A fresh start on its rules"
		)
	})

	test("where a kit comes from", () => {
		expect(kitSourceLine({ source: "core" })).toBe("Comes with Serene Pub")
		expect(kitSourceLine({ source: "plugin" })).toBe("Comes with a plugin")
		expect(kitSourceLine({ source: "admin", ownerName: "Ada" })).toBe(
			"Made by Ada"
		)
		expect(
			kitSourceLine({ source: "admin", ownerName: "Ada", mine: true })
		).toBe("Made by you")
		expect(kitSourceLine({ source: "admin" })).toBe("Made by an admin")
	})

	test("a book kind of starter_kit is a kit", () => {
		expect(isStarterKit({ kind: "starter_kit" })).toBe(true)
		expect(isStarterKit({ kind: "book" })).toBe(false)
		expect(isStarterKit(null)).toBe(false)
	})
})
