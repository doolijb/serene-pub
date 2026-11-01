import { describe, expect, it } from "vitest"
import { INFLECTION_LABELS } from "@serene-pub/sdk"
import { STANDARD_SPRITE_LABELS } from "$lib/shared/sprites"

describe("inflection labels", () => {
	it("the SDK's INFLECTION_LABELS are the app's standard sprite labels, in order", () => {
		expect([...INFLECTION_LABELS]).toEqual([...STANDARD_SPRITE_LABELS])
	})
	it("there are 28 and neutral is one of them", () => {
		expect(INFLECTION_LABELS).toHaveLength(28)
		expect(INFLECTION_LABELS).toContain("neutral")
	})
})
