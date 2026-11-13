import { describe, expect, test } from "vitest"
import { parseLiftNote } from "./versionsLift"

describe("parseLiftNote", () => {
	test("null, non-JSON and other shapes answer null, never throw", () => {
		expect(parseLiftNote(null)).toBeNull()
		expect(parseLiftNote("Greetings: one half was retold")).toBeNull()
		expect(parseLiftNote("{bad")).toBeNull()
		expect(parseLiftNote("[]")).toBeNull()
		expect(parseLiftNote("3")).toBeNull()
		expect(
			parseLiftNote(JSON.stringify({ v: 2, differences: [] }))
		).toBeNull()
		expect(parseLiftNote(JSON.stringify({ v: 1 }))).toBeNull()
	})

	test("a v1 note round-trips", () => {
		const note = {
			v: 1,
			differences: [
				{
					branchId: null,
					line: "main",
					at: { kind: "before-first-change" },
					appearance: null,
					fields: ["greetings"]
				}
			],
			mixedGreetings: true
		}
		expect(parseLiftNote(JSON.stringify(note))).toEqual(note)
	})
})
