import { describe, expect, it } from "vitest"
import { S } from "@serene-pub/sdk"
import {
	samplingDefaultsFor,
	samplingDeletion,
	samplingEnabledCount,
	samplingKeyValues,
	samplingModality,
	samplingModalityWord,
	samplingValuesForForm,
	samplingValuesToSave
} from "./samplingAdmin"

const creative = {
	id: 1,
	name: "Creative",
	isImmutable: false,
	shape: S.textGen,
	values: { temperature: 1.1, topP: 0.95, contextTokens: 8192, seed: 4 },
	enabled: ["temperature", "topP", "contextTokens", "seed"]
}
const builtin = {
	id: 2,
	name: "Default",
	isImmutable: true,
	shape: S.textGen,
	values: {},
	enabled: []
}
const sdxl = {
	id: 3,
	name: "SDXL",
	isImmutable: false,
	shape: S.imageGen,
	values: { steps: 30, cfg: 6.5, width: 1024, height: 1024 },
	enabled: ["steps", "cfg", "width"]
}

const defaults = {
	"text->text": { samplingConfigId: 1 },
	"text->image": { samplingConfigId: 3 },
	"text->embedding": { samplingConfigId: null }
}

describe("modality", () => {
	it("reads the shape, defaulting to text", () => {
		expect(samplingModality(S.imageGen)).toBe("image-gen")
		expect(samplingModality(null)).toBe("text-gen")
		expect(samplingModalityWord(S.textGen)).toBe("Text")
		expect(samplingModalityWord(S.imageGen)).toBe("Image")
	})
})

describe("samplingKeyValues", () => {
	it("shows only switched-on key values, in a fixed order", () => {
		expect(samplingKeyValues(creative)).toBe("Temp 1.1 · Top P 0.95 · Context 8,192")
		// height is stored but off: not sent, so not shown
		expect(samplingKeyValues(sdxl)).toBe("Steps 30 · CFG 6.5 · 1024×?")
		expect(
			samplingKeyValues({ ...sdxl, enabled: [...sdxl.enabled, "height"] })
		).toBe("Steps 30 · CFG 6.5 · 1024×1024")
	})
	it("says a config that sends nothing sends nothing", () => {
		expect(samplingKeyValues(builtin)).toBe("Nothing sent")
	})
	it("an enabled key with no stored value shows its declared default", () => {
		expect(samplingKeyValues({ ...builtin, enabled: ["temperature"] })).toMatch(/^Temp \d/)
	})
	it("a dash when only unlisted parameters are on", () => {
		expect(
			samplingKeyValues({ ...creative, enabled: ["seed"] })
		).toBe("—")
	})
})

describe("samplingEnabledCount", () => {
	it("counts against the shape's schema, ignoring unknown keys", () => {
		const c = samplingEnabledCount({ ...creative, enabled: [...creative.enabled, "bogus"] })
		expect(c.on).toBe(4)
		expect(c.total).toBeGreaterThan(20)
	})
})

describe("samplingDefaultsFor", () => {
	it("names each default whose sampling half is this config", () => {
		expect(samplingDefaultsFor(1, defaults).map((d) => d.capability)).toEqual([
			"text->text"
		])
		expect(samplingDefaultsFor(2, defaults)).toEqual([])
		expect(samplingDefaultsFor(1, undefined)).toEqual([])
	})
})

describe("samplingDeletion", () => {
	const usedBy = { 1: ["Chat", "Summarize"], 3: ["Image"] }

	it("lists each config with the defaults it releases and the pipelines that pick it", () => {
		const d = samplingDeletion([creative], defaults, usedBy)
		expect(d.title).toBe("Delete Creative?")
		expect(d.confirmLabel).toBe("Delete sampling config")
		expect(d.objects).toHaveLength(1)
		expect(d.objects[0].related?.map((r) => r.label)).toEqual([
			"Default released for",
			"Picked by pipelines"
		])
		expect(d.objects[0].related?.[1].items).toEqual(["Chat", "Summarize"])
		expect(d.summary).toMatch(/^One default goes unset/)
		expect(d.summary).toMatch(/2 pipelines need another choice/)
	})

	it("keeps built-in configs out of the list and says so", () => {
		const d = samplingDeletion([creative, builtin, sdxl], defaults, usedBy)
		expect(d.objects.map((o) => o.label)).toEqual(["Creative", "SDXL"])
		expect(d.title).toBe("Delete 2 sampling configs?")
		expect(d.summary).toMatch(/Default stays/)
		expect(d.summary).toMatch(/2 defaults go unset/)
		expect(d.summary).toMatch(/3 pipelines need/)
	})

	it("offers nothing to delete when every selected config is built in", () => {
		const d = samplingDeletion([builtin], defaults, usedBy)
		expect(d.objects).toEqual([])
		expect(d.title).toBe("Default is built in")
	})

	it("an unused config just says it cannot be undone", () => {
		const d = samplingDeletion([{ ...creative, id: 9 }], defaults, usedBy)
		expect(d.summary).toBe("This cannot be undone.")
		expect(d.objects[0].related).toEqual([])
	})
})

describe("samplingValuesForForm / samplingValuesToSave", () => {
	const schema = {
		temperature: { type: "number", default: 0.7 },
		topK: { type: "integer", default: 40 },
		sampler: { type: "text" }
	} as any

	it("fills declared defaults where nothing is stored, keeping stored values", () => {
		expect(samplingValuesForForm(schema, { topK: 10, extra: 1 })).toEqual({
			temperature: 0.7,
			topK: 10,
			extra: 1
		})
	})

	it("round-trips: an untouched form saves exactly what was stored", () => {
		const stored = { topK: 10 }
		const form = samplingValuesForForm(schema, stored)
		expect(samplingValuesToSave(schema, form, stored)).toEqual(stored)
	})

	it("keeps a changed filled-in value and a stored value equal to its default", () => {
		const stored = { temperature: 0.7 }
		const form = { ...samplingValuesForForm(schema, stored), topK: 50 }
		expect(samplingValuesToSave(schema, form, stored)).toEqual({
			temperature: 0.7,
			topK: 50
		})
	})
})
