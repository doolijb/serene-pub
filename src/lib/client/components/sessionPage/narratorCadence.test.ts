import { describe, expect, test } from "vitest"
import { narratorCadenceField } from "./narratorCadence"
import { narratorCadenceKey } from "$lib/shared/sessions/narratorCadence"

const field = (value: unknown, inherited: unknown = "off") => ({
	id: JSON.stringify(["genre", "narratorInterjections"]),
	address: { kind: "genre", key: "narratorInterjections" },
	label: "Narrator's turn",
	control: "enum",
	value,
	inherited,
	source: "session",
	reach: "owner",
	editable: true
})
const formOf = (...fields: unknown[]) =>
	({
		sessionId: 7,
		viewer: "owner",
		groups: [{ kind: "genre", id: "genre", heading: "Story", fields }]
	}) as never

describe("narratorCadenceKey", () => {
	test("older values read as the key they stand for", () => {
		expect(narratorCadenceKey(true)).toBe("every-round")
		expect(narratorCadenceKey("full")).toBe("every-round")
		expect(narratorCadenceKey("review")).toBe("every-round")
		expect(narratorCadenceKey(false)).toBe("off")
	})
	test("anything else passes through", () => {
		expect(narratorCadenceKey("every-2nd-round")).toBe("every-2nd-round")
		expect(narratorCadenceKey(undefined)).toBeUndefined()
		expect(narratorCadenceKey(null)).toBeNull()
	})
})

describe("narratorCadenceField", () => {
	test("finds the field as the server sent it (the server already maps an older stored value)", () => {
		const found = narratorCadenceField(
			formOf(
				{
					...field("x"),
					id: "other",
					address: { kind: "genre", key: "tone" }
				},
				field("every-round", "off")
			)
		)
		expect(found?.value).toBe("every-round")
		expect(found?.inherited).toBe("off")
		expect(found?.label).toBe("Narrator's turn")
	})
	test("is null when absent, or for a guest's form", () => {
		expect(narratorCadenceField(null)).toBeNull()
		expect(narratorCadenceField(undefined)).toBeNull()
		expect(
			narratorCadenceField({ sessionId: 7, groups: [] } as never)
		).toBeNull()
		expect(
			narratorCadenceField(
				formOf({
					...field("off"),
					address: { kind: "genre", key: "tone" }
				})
			)
		).toBeNull()
	})
})
