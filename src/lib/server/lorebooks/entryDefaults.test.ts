/**
 * The layers of a session's new entry's Beginning and Decay: the step's value
 * over the entry type's, per field, else perpetual and 0.
 */
import { describe, expect, it } from "vitest"
import { defineRuleset } from "@serene-pub/sdk"
import { deriveEntryTypes } from "@serene-pub/core-catalog"
import {
	checkStepDefaults,
	entryTypeDefaultsLayer,
	entryTypeSentenceName,
	newEntryTime
} from "./entryDefaults"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

const DATE = { year: 10, month: 2, day: 5 }
const NONE = { year: null, month: null, day: null }

describe("newEntryTime", () => {
	it("no layer says anything: perpetual, 0", () => {
		expect(newEntryTime({ date: DATE, takesBeginning: true })).toEqual({
			...NONE,
			decayRate: 0
		})
	})
	it("each layer alone", () => {
		const began = {
			defaultBeginning: "began" as const,
			defaultDecayRate: 0.2
		}
		for (const layer of ["type", "step"] as const)
			expect(
				newEntryTime({
					[layer]: began,
					date: DATE,
					takesBeginning: true
				})
			).toEqual({ ...DATE, decayRate: 0.2 })
	})
	it("step over type, per field independently", () => {
		const type = {
			defaultBeginning: "began" as const,
			defaultDecayRate: 0.1
		}
		expect(
			newEntryTime({
				type,
				step: { defaultBeginning: "perpetual" },
				date: DATE,
				takesBeginning: true
			})
		).toEqual({ ...NONE, decayRate: 0.1 })
		// a step setting only the rate keeps the type's Beginning
		expect(
			newEntryTime({
				type,
				step: { defaultDecayRate: 0.7 },
				date: DATE,
				takesBeginning: true
			})
		).toEqual({ ...DATE, decayRate: 0.7 })
		// a rate of 0 is a value, not absent
		expect(
			newEntryTime({
				type,
				step: { defaultDecayRate: 0 },
				date: DATE,
				takesBeginning: true
			}).decayRate
		).toBe(0)
	})
	it("began without a date gives no date parts, and the Decay still resolves", () => {
		expect(
			newEntryTime({
				type: { defaultBeginning: "began", defaultDecayRate: 0.4 },
				date: null,
				takesBeginning: true
			})
		).toEqual({ ...NONE, decayRate: 0.4 })
	})
	it("a date with no month or day carries them as null", () => {
		expect(
			newEntryTime({
				type: { defaultBeginning: "began" },
				date: { year: 7 },
				takesBeginning: true
			})
		).toEqual({ year: 7, month: null, day: null, decayRate: 0 })
	})
	it("a type that carries its own date takes none", () => {
		expect(
			newEntryTime({
				type: { defaultBeginning: "began" },
				date: DATE,
				takesBeginning: false
			}).year
		).toBeNull()
	})
})

describe("checkStepDefaults", () => {
	const world = { name: "World lore", takesBeginning: true }
	it("empty, null and absent are unset", () => {
		expect(checkStepDefaults(undefined, world)).toEqual({ layer: {} })
		expect(
			checkStepDefaults(
				{ defaultBeginning: "", defaultDecayRate: null },
				world
			)
		).toEqual({ layer: {} })
	})
	it("good values are the layer", () => {
		expect(
			checkStepDefaults(
				{ defaultBeginning: "began", defaultDecayRate: 0 },
				world
			)
		).toEqual({
			layer: { defaultBeginning: "began", defaultDecayRate: 0 }
		})
	})
	it("refuses with a sentence", () => {
		expect(checkStepDefaults({ defaultBeginning: "born" }, world)).toEqual({
			refusal:
				"born is not a Beginning default. Say 'perpetual' or 'began', or leave it empty."
		})
		const rate =
			"A Decay rate is a number from 0 to 1: 0 is a fact, above 0 a living entry."
		for (const bad of [2, -0.1, Number.NaN, "0.3"])
			expect(checkStepDefaults({ defaultDecayRate: bad }, world)).toEqual(
				{ refusal: rate }
			)
		expect(
			checkStepDefaults(
				{ defaultBeginning: "began" },
				{ name: "History", takesBeginning: false }
			)
		).toEqual({
			refusal:
				"History entries carry their own date, so defaultBeginning does nothing here. Leave it empty."
		})
	})
})

describe("entryTypeDefaultsLayer", () => {
	it("core's five", () => {
		for (const id of [
			WORLD_LORE_TYPE_ID,
			CHARACTER_LORE_TYPE_ID,
			LOCATION_TYPE_ID
		])
			expect(entryTypeDefaultsLayer(id)).toEqual({
				defaultBeginning: "perpetual",
				defaultDecayRate: 0
			})
		expect(entryTypeDefaultsLayer(ITEM_TYPE_ID)).toEqual({
			defaultBeginning: "began",
			defaultDecayRate: 0
		})
		expect(entryTypeDefaultsLayer(HISTORY_TYPE_ID)).toEqual({})
		expect(entryTypeDefaultsLayer("test:entry/nothing")).toEqual({})
	})
	it("a ruleset's derived type carries what it declares", () => {
		const decl = defineRuleset("test:ruleset/defaultsworld@1", {
			name: { en: "Defaults world" },
			attributes: [],
			entryTypes: [
				{
					id: "wound",
					name: { en: "Wound" },
					holders: ["cast"],
					fields: {},
					prose: "A wound.",
					defaultBeginning: "began",
					defaultDecayRate: 0.25
				}
			]
		} as never)
		deriveEntryTypes(decl as never)
		expect(
			entryTypeDefaultsLayer("test:entry/defaultsworld.wound")
		).toEqual({
			defaultBeginning: "began",
			defaultDecayRate: 0.25
		})
	})
})

describe("entryTypeSentenceName", () => {
	it("is the declared name without a trailing 'entries'", () => {
		expect(entryTypeSentenceName(HISTORY_TYPE_ID)).toBe("History")
		expect(entryTypeSentenceName(WORLD_LORE_TYPE_ID)).toBe("World lore")
	})
})
