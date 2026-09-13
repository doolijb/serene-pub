/**
 * Every slot value ever written still means what it meant (0114).
 *
 * This is the compatibility promise the endpoint/model split rests on. A
 * `pipeline_node_overrides` row's `connection` slot has been written as a bare
 * number, a numeric string, `{ref}` and `{id}` across four releases, and none of
 * those rows were migrated — the split relies on all four continuing to read as
 * "that endpoint, its default model".
 *
 * ⚠ The failure this prevents is silent in the direction that passes. A reader
 * that stopped understanding `{id: 12}` would resolve the slot to nothing, fall
 * through to the instance default, and produce output from the right KIND of
 * connection — plausible text from a model nobody chose, with no error and
 * nothing on any screen that disagrees.
 */

import { describe, expect, it } from "vitest"
import { connectionSlotValue, slotConnectionId, slotModelId } from "./slotRef"

describe("reading a slot value", () => {
	it("understands all four legacy spellings as the endpoint alone", () => {
		for (const value of [12, "12", { ref: 12 }, { id: 12 }]) {
			expect(slotConnectionId(value)).toBe(12)
			// And none of them names a model, which is what makes "no model
			// means the default" the whole of the migration.
			expect(slotModelId(value)).toBeNull()
		}
	})

	it("reads a pair", () => {
		const v = { ref: 12, modelId: 3 }
		expect(slotConnectionId(v)).toBe(12)
		expect(slotModelId(v)).toBe(3)
	})

	it("answers null for everything that names nothing", () => {
		for (const value of [null, undefined, "", "abc", {}, [], NaN]) {
			expect(slotConnectionId(value)).toBeNull()
			expect(slotModelId(value)).toBeNull()
		}
	})
})

describe("writing a slot value", () => {
	it("writes a BARE NUMBER when no model is named", () => {
		// Byte-for-byte what was written before the split, so a config diff stays
		// readable and an older build reading this row is unaffected. The object
		// form appears only when it carries something.
		expect(connectionSlotValue(12)).toBe(12)
		expect(connectionSlotValue(12, null)).toBe(12)
	})

	it("writes the pair when a model is named", () => {
		expect(connectionSlotValue(12, 3)).toEqual({ ref: 12, modelId: 3 })
	})

	it("clears to null when the connection is cleared, model and all", () => {
		// A model without its endpoint is not a partial selection, it is an
		// unresolvable one — `CapabilityCandidate` states the same rule at the
		// resolver.
		expect(connectionSlotValue(null, 3)).toBeNull()
		expect(connectionSlotValue(undefined, 3)).toBeNull()
	})

	it("round-trips through the readers", () => {
		const v = connectionSlotValue(7, 9)
		expect(slotConnectionId(v)).toBe(7)
		expect(slotModelId(v)).toBe(9)
	})
})
