/**
 * Less-confusing plan A1 (2026-10-11): the name typed at Get started is the
 * name the person plays as. The quick persona was created as "You" whatever
 * "What should we call you?" said.
 */
import { describe, expect, test } from "vitest"
import {
	QUICK_PERSONA_FALLBACK_NAME,
	quickPersonaCharacter,
	quickPersonaName
} from "./quickPersona"

describe("quickPersonaName", () => {
	test("the name typed at Get started is the persona's name", () => {
		expect(quickPersonaName("Mara", null)).toBe("Mara")
	})

	test("surrounding spaces are dropped, as the display name drops them", () => {
		expect(quickPersonaName("  Mara  ", null)).toBe("Mara")
	})

	test("the typed name wins over a display name already saved", () => {
		expect(quickPersonaName("Mara", "jody")).toBe("Mara")
	})

	test("no answer (the field was hidden) reads the saved display name", () => {
		expect(quickPersonaName("", "Jody")).toBe("Jody")
		expect(quickPersonaName(null, "Jody")).toBe("Jody")
	})

	test("falls back to You only when there is no name at all", () => {
		expect(quickPersonaName("", null)).toBe(QUICK_PERSONA_FALLBACK_NAME)
		expect(quickPersonaName("   ", "  ")).toBe("You")
		expect(quickPersonaName(undefined, undefined)).toBe("You")
	})

	test("an answer the display-name rule refuses is skipped, never truncated", () => {
		expect(quickPersonaName("x".repeat(51), "Jody")).toBe("Jody")
		expect(quickPersonaName("x".repeat(51), null)).toBe("You")
	})
})

describe("quickPersonaCharacter", () => {
	test("a typed name lands on the created persona row", () => {
		const row = quickPersonaCharacter(quickPersonaName("Mara", null))
		expect(row).toMatchObject({
			name: "Mara",
			isPersona: true,
			isDefaultPersona: true
		})
		expect(row.description).toMatch(/represents you in sessions/)
	})
})
