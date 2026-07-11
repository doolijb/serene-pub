import { describe, expect, test } from "vitest"
import {
	normalizeLorebookEntryPriority,
	mapLorebookEntryToWorldLoreEntry
} from "./lorebookImportMapper"

describe("normalizeLorebookEntryPriority", () => {
	test("defaults null/undefined to 1", () => {
		expect(normalizeLorebookEntryPriority(null)).toBe(1)
		expect(normalizeLorebookEntryPriority(undefined)).toBe(1)
	})

	test("clamps values below 1 up to 1", () => {
		expect(normalizeLorebookEntryPriority(0)).toBe(1)
		expect(normalizeLorebookEntryPriority(-5)).toBe(1)
	})

	test("clamps values above 3 down to 3", () => {
		expect(normalizeLorebookEntryPriority(4)).toBe(3)
		expect(normalizeLorebookEntryPriority(100)).toBe(3)
	})

	test("passes through in-range values unchanged", () => {
		expect(normalizeLorebookEntryPriority(1)).toBe(1)
		expect(normalizeLorebookEntryPriority(2)).toBe(2)
		expect(normalizeLorebookEntryPriority(3)).toBe(3)
	})
})

describe("mapLorebookEntryToWorldLoreEntry", () => {
	test("maps a full entry", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{
				keys: ["alpha", "beta"],
				content: "Some lore content",
				enabled: true,
				constant: true,
				name: "Entry Name",
				priority: 2
			},
			3
		)

		expect(mapped).toEqual({
			name: "Entry Name",
			content: "Some lore content",
			position: 3,
			keys: "alpha, beta",
			enabled: true,
			constant: true,
			priority: 2,
			extraJson: {}
		})
	})

	test("falls back to comment, then 'Imported Entry', when name is missing", () => {
		const withComment = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true, comment: "A comment" },
			0
		)
		expect(withComment.name).toBe("A comment")

		const withNeither = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true },
			0
		)
		expect(withNeither.name).toBe("Imported Entry")
	})

	test("joins multiple keys with a comma-space separator", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: ["one", "two", "three"], content: "", enabled: true },
			0
		)
		expect(mapped.keys).toBe("one, two, three")
	})

	test("defaults enabled to true and constant to false when omitted", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: undefined as unknown as boolean },
			0
		)
		expect(mapped.enabled).toBe(true)
		expect(mapped.constant).toBe(false)
	})

	test("normalizes out-of-range priority", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true, priority: 99 },
			0
		)
		expect(mapped.priority).toBe(3)
	})
})
