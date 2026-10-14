import { describe, expect, it } from "vitest"
import {
	consequenceLine,
	consequencesFor,
	impliedNeeds,
	samplingAfterPairChange
} from "./consequence"

describe("consequence words (never a grade)", () => {
	it("says what the receipt would say for each unmet need", () => {
		expect(consequencesFor({}, { structured: true, tools: true, references: true })).toEqual([
			"JSON by instruction (no schema door)",
			"tools by instruction (no native tool calls)",
			"references dropped"
		])
		expect(
			consequencesFor(
				{ json_schema: 1, tools: 2, "text+image->image": 1 },
				{ structured: true, tools: true, references: true }
			)
		).toEqual([])
		// Emulated tools are still "by instruction".
		expect(consequencesFor({ tools: 1 }, { tools: true })).toHaveLength(1)
	})

	it("an unfilled tile says where it falls back", () => {
		expect(consequenceLine({ filled: false, fallbackName: "Reply", needs: {} })).toBe(
			"Unfilled — falls back to Reply"
		)
		expect(
			consequenceLine({
				filled: true,
				grades: {},
				needs: impliedNeeds("core:loadout/extraction@1")
			})
		).toBe("JSON by instruction (no schema door)")
		expect(consequenceLine({ filled: true, grades: {}, needs: {} })).toBeNull()
	})
})

describe("step 3's swap on a pair change", () => {
	const sd15 = { id: 5, name: "SD 1.5", shape: "core:shape/image-gen@1" }
	const comfy = { id: 9, name: "Sprite workflow", shape: "comfy:shape/sprite@1" }
	it("keeps a config whose shape the new pair speaks", () => {
		expect(
			samplingAfterPairChange({ current: sd15, wantedShape: sd15.shape, seededDefault: sd15 })
		).toEqual({ samplingConfigId: 5, notice: null })
	})
	it("swaps a mismatched config to the transform's seeded default, and says so", () => {
		const r = samplingAfterPairChange({
			current: comfy,
			wantedShape: "core:shape/image-gen@1",
			seededDefault: sd15
		})
		expect(r.samplingConfigId).toBe(5)
		expect(r.notice).toBe("Sprite workflow does not fit this model, so sampling is now SD 1.5.")
	})
	it("clears it, saying so, when there is no seeded default of that shape", () => {
		const r = samplingAfterPairChange({
			current: comfy,
			wantedShape: "core:shape/image-gen@1",
			seededDefault: null
		})
		expect(r.samplingConfigId).toBeNull()
		expect(r.notice).toMatch(/cleared/)
	})
})
