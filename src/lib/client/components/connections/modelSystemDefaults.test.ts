import { describe, expect, test } from "vitest"
import { systemCapabilitiesForModel } from "./modelSystemDefaults"

describe("systemCapabilitiesForModel", () => {
	test("matches a pair naming the model outright", () => {
		const out = systemCapabilitiesForModel(
			{
				"text->text": { connectionId: 7, connectionModelId: 3 },
				"text->image": { connectionId: 9, connectionModelId: 3 }
			},
			7,
			3
		)
		expect(out).toEqual(["text->text"])
	})

	test("a pair naming only the endpoint targets nothing", () => {
		// Connections have no default model: an endpoint-level default is an
		// incomplete choice, not a match for any row.
		const defaults = {
			"text->text": { connectionId: 7, connectionModelId: null }
		}
		expect(systemCapabilitiesForModel(defaults, 7, 1)).toEqual([])
		expect(systemCapabilitiesForModel(defaults, 7, 2)).toEqual([])
	})

	test("undefined defaults mean nothing is starred", () => {
		expect(systemCapabilitiesForModel(undefined, 7, 1)).toEqual([])
	})
})
