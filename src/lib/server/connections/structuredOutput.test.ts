/**
 * Which door a structured request goes out through.
 *
 * Three answers, in decreasing strength, and the reason this is a pure function
 * is that the dispatch must be able to say which one it took on the receipt: a
 * step that asked for a schema and got a plain instruction produced the same
 * kind of answer by a different route, and only the receipt can tell them apart.
 */

import { describe, it, expect } from "vitest"
import { closure, gradeOf, BAND, type CapabilitySet } from "@serene-pub/sdk"
import { chooseStructuredMode } from "./structuredOutput"

const schema = { type: "object" as const }

const native = (...ids: string[]): CapabilitySet =>
	closure(
		Object.fromEntries(
			ids.map((id) => [id, gradeOf(id as any, BAND.native)])
		) as CapabilitySet
	)

describe("chooseStructuredMode", () => {
	it("asks for a schema when the connection takes one and a schema was given", () => {
		const choice = chooseStructuredMode(native("json_schema"), { schema })
		expect(choice.mode).toBe("schema")
		expect(choice.capability).toBe("json_schema")
	})

	it("asks for a schema through a grammar, which is the emulated band", () => {
		// `EMULATABLE_VIA` says jsonSchemaToGbnf IS "json_schema via grammar",
		// so a llama.cpp-family connection reaches the schema door too.
		const choice = chooseStructuredMode(native("grammar"), { schema })
		expect(choice.mode).toBe("schema")
		expect(choice.capability).toBe("json_schema")
		expect(choice.degraded).toBe(true)
	})

	it("falls back to plain JSON mode when no schema was given", () => {
		const choice = chooseStructuredMode(native("json_schema"), {})
		expect(choice.mode).toBe("object")
		expect(choice.capability).toBe("json_object")
	})

	it("falls back to plain JSON mode when only json_object is held", () => {
		const choice = chooseStructuredMode({ json_object: 2 }, { schema })
		expect(choice.mode).toBe("object")
		expect(choice.capability).toBe("json_object")
	})

	it("falls back to an instruction when the connection constrains nothing", () => {
		const choice = chooseStructuredMode(native("text->text"), { schema })
		expect(choice.mode).toBe("instruction")
		expect(choice.capability).toBe(null)
	})

	it("falls back to an instruction on a connection nobody has determined", () => {
		// 0175 left an empty set on every row it could not resolve. An empty set
		// is not permission: the instruction door works everywhere, so it is the
		// safe reading, and the row upgrades itself the first time it is tested.
		const choice = chooseStructuredMode({}, { schema })
		expect(choice.mode).toBe("instruction")
	})

	it("reads a non-number grade as unsupported", () => {
		// The column is loose JSON that predates the grade scale; `"native"` as
		// a string must not grant anything.
		const choice = chooseStructuredMode(
			{ json_object: "native" } as unknown as CapabilitySet,
			{}
		)
		expect(choice.mode).toBe("instruction")
	})
})
