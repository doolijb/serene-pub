/**
 * `applyPresetDefaults` (EditSessionForm's create-flow preset pre-fill, 23
 * §9) used to overwrite `name`/`scenario`/`tags`/`lorebookId`/
 * `groupReplyStrategy`/`genreFields` unconditionally on every preset switch,
 * silently discarding a scenario (or any other field) the user had already
 * typed. `resolvePresetFill` is the extracted, pure decision behind the fix:
 * fill only a field that's still pristine — the form's initial value, or
 * whatever the PREVIOUSLY-applied preset put there — and never a value the
 * user typed.
 */
import { describe, it, expect } from "vitest"
import {
	resolvePresetFill,
	INITIAL_PRESET_FILLABLE_FIELDS,
	type PresetFillableFields,
	type PresetFillState
} from "./applyPresetDefaults"

const blank = (): PresetFillableFields => ({
	...INITIAL_PRESET_FILLABLE_FIELDS,
	genreFields: {}
})

describe("resolvePresetFill", () => {
	it("first selection: fills every recognised key from an empty form, same as the old unconditional apply", () => {
		const result = resolvePresetFill(
			blank(),
			{},
			{
				name: "Alice",
				scenario: "A quiet tavern.",
				groupReplyStrategy: "manual",
				lorebookId: 7,
				tags: ["fantasy", "slow-burn"],
				genreFields: { tone: "cozy" }
			}
		)
		expect(result.fields).toEqual({
			name: "Alice",
			scenario: "A quiet tavern.",
			groupReplyStrategy: "manual",
			lorebookId: 7,
			tags: ["fantasy", "slow-burn"],
			genreFields: { tone: "cozy" }
		})
	})

	it("switching presets: a pristine field (still the initial empty value) takes the new preset's default", () => {
		const result = resolvePresetFill(
			blank(),
			{},
			{ name: "Bob", scenario: "Second preset's scenario." }
		)
		expect(result.fields.name).toBe("Bob")
		expect(result.fields.scenario).toBe("Second preset's scenario.")
	})

	it("switching presets: a field still holding the PREVIOUS preset's default is replaced", () => {
		// Simulates: preset A applied (scenario -> "A's scenario", tracked in
		// fillState), user never touched it, now switching to preset B.
		const afterA = resolvePresetFill(blank(), {}, { scenario: "A's scenario" })
		const afterB = resolvePresetFill(
			afterA.fields,
			afterA.fillState,
			{ scenario: "B's scenario" }
		)
		expect(afterB.fields.scenario).toBe("B's scenario")
	})

	it("switching presets: a scenario the user typed is kept, not discarded — the bug this fixes", () => {
		const afterA = resolvePresetFill(blank(), {}, { scenario: "A's scenario" })
		const userEdited: PresetFillableFields = {
			...afterA.fields,
			scenario: "A scenario the user wrote by hand."
		}
		const afterB = resolvePresetFill(userEdited, afterA.fillState, {
			scenario: "B's scenario"
		})
		expect(afterB.fields.scenario).toBe(
			"A scenario the user wrote by hand."
		)
	})

	it("switching presets: a name the user typed is kept even though the new preset supplies one", () => {
		const current: PresetFillableFields = { ...blank(), name: "My Story" }
		const result = resolvePresetFill(current, {}, { name: "Preset Name" })
		expect(result.fields.name).toBe("My Story")
	})

	it("a field diverged from a preset value is retired — a THIRD preset also can't overwrite it", () => {
		const afterA = resolvePresetFill(blank(), {}, { name: "A" })
		const userEdited: PresetFillableFields = { ...afterA.fields, name: "Mine" }
		const afterB = resolvePresetFill(userEdited, afterA.fillState, {
			name: "B"
		})
		expect(afterB.fields.name).toBe("Mine")
		const afterC = resolvePresetFill(afterB.fields, afterB.fillState, {
			name: "C"
		})
		expect(afterC.fields.name).toBe("Mine")
	})

	it("tags: pristine (still []) takes the new preset's tags", () => {
		const result = resolvePresetFill(blank(), {}, { tags: ["a", "b"] })
		expect(result.fields.tags).toEqual(["a", "b"])
	})

	it("tags: user-edited tags are kept across a preset switch", () => {
		const afterA = resolvePresetFill(blank(), {}, { tags: ["a", "b"] })
		const userEdited: PresetFillableFields = {
			...afterA.fields,
			tags: ["a", "b", "custom"]
		}
		const afterB = resolvePresetFill(userEdited, afterA.fillState, {
			tags: ["x", "y"]
		})
		expect(afterB.fields.tags).toEqual(["a", "b", "custom"])
	})

	it("lorebookId: pristine null takes the preset's id, and a explicit null default is applied too", () => {
		const result = resolvePresetFill(blank(), {}, { lorebookId: 3 })
		expect(result.fields.lorebookId).toBe(3)
		const cleared = resolvePresetFill(result.fields, result.fillState, {
			lorebookId: null
		})
		expect(cleared.fields.lorebookId).toBeNull()
	})

	it("lorebookId: a user-picked lorebook survives a preset switch", () => {
		const current: PresetFillableFields = { ...blank(), lorebookId: 42 }
		const result = resolvePresetFill(current, {}, { lorebookId: 3 })
		expect(result.fields.lorebookId).toBe(42)
	})

	it("groupReplyStrategy: an invalid value in defaults is ignored entirely", () => {
		const result = resolvePresetFill(blank(), {}, {
			groupReplyStrategy: "not-a-real-strategy"
		})
		expect(result.fields.groupReplyStrategy).toBe("ordered")
	})

	it("genreFields: fills only the keys the new preset specifies, per key pristineness", () => {
		const afterA = resolvePresetFill(
			blank(),
			{},
			{ genreFields: { tone: "cozy", length: "short" } }
		)
		// User edits just `length`, leaves `tone` alone.
		const userEdited: PresetFillableFields = {
			...afterA.fields,
			genreFields: { ...afterA.fields.genreFields, length: "epic" }
		}
		const afterB = resolvePresetFill(userEdited, afterA.fillState, {
			genreFields: { tone: "grim", length: "medium" }
		})
		expect(afterB.fields.genreFields).toEqual({
			tone: "grim", // still pristine (untouched since preset A) -> replaced
			length: "epic" // user-edited -> kept
		})
	})

	it("genreFields: a key the user typed directly (no preset ever touched it) is kept", () => {
		const current: PresetFillableFields = {
			...blank(),
			genreFields: { mood: "hand-typed" }
		}
		const result = resolvePresetFill(current, {}, {
			genreFields: { mood: "preset-value" }
		})
		expect(result.fields.genreFields).toEqual({ mood: "hand-typed" })
	})

	it("a field the new preset doesn't mention is left completely alone", () => {
		const current: PresetFillableFields = { ...blank(), name: "Kept As-Is" }
		const result = resolvePresetFill(current, {}, { scenario: "Only this." })
		expect(result.fields.name).toBe("Kept As-Is")
	})

	it("null/absent defaults change nothing and carry the fill state forward untouched", () => {
		const fillState: PresetFillState = { name: "A" }
		const current: PresetFillableFields = { ...blank(), name: "A" }
		const result = resolvePresetFill(current, fillState, null)
		expect(result.fields).toEqual(current)
		expect(result.fillState).toEqual(fillState)
	})
})
