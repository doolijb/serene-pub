/**
 * The pipeline's own voice, named (lair re-plan R5): the one rule every
 * reader of the null turn entry and of an unclaimed line goes through.
 */

import { describe, expect, it } from "vitest"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"

describe("ownVoiceName", () => {
	it("a genre that declares a fallback envoy: the voice is that envoy", () => {
		expect(
			ownVoiceName({
				envoys: [
					{ name: { en: "Mascot" } },
					{ name: { en: "Castellan", fr: "Châtelain" }, fallback: true }
				],
				narratorName: "Fate"
			})
		).toBe("Castellan")
	})

	it("names the envoy in the reader's language, and takes a name already resolved", () => {
		const envoys = [{ name: { en: "Castellan", fr: "Châtelain" }, fallback: true }]
		expect(ownVoiceName({ envoys }, "fr")).toBe("Châtelain")
		// The session view hands names already in the viewer's language.
		expect(ownVoiceName({ envoys: [{ name: "Scribe", fallback: true }] })).toBe("Scribe")
	})

	it("a genre with no fallback envoy: the session's narrator name", () => {
		expect(
			ownVoiceName({
				envoys: [{ name: { en: "Mascot" }, fallback: false }],
				narratorName: "  Fate "
			})
		).toBe("Fate")
	})

	it("nothing named at all: UNCLAIMED_LINE_NAME, never Unknown", () => {
		expect(ownVoiceName({ narratorName: "  " })).toBe("Narrator")
		expect(ownVoiceName(null)).toBe("Narrator")
		expect(ownVoiceName({ envoys: [null, { fallback: true, name: "" }] })).toBe(
			"Narrator"
		)
	})
})
