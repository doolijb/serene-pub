import { describe, expect, test } from "vitest"
import { mergeWorkflowValues, workflowValuesOf } from "./workflowValues"

describe("a loadout's workflow values", () => {
	test("keep scalars only; empty is null", () => {
		expect(workflowValuesOf({ steps: 30, sampler: "euler", hires: true, x: { a: 1 }, n: NaN })).toEqual({
			steps: 30,
			sampler: "euler",
			hires: true
		})
		expect(workflowValuesOf({})).toBeNull()
		expect(workflowValuesOf(null)).toBeNull()
		expect(workflowValuesOf([1])).toBeNull()
	})

	test("layer defaults < loadout < step; undefined never unsets", () => {
		expect(
			mergeWorkflowValues(
				{ steps: 20, cfg: 7, lora: 0.8 },
				{ steps: 30, lora: undefined },
				{ cfg: 5 }
			)
		).toEqual({ steps: 30, cfg: 5, lora: 0.8 })
	})
})
