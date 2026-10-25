/**
 * 🚧 A model's reads and writes as sets (O3).
 */
import { describe, expect, test } from "vitest"
import {
	MODEL_PURPOSES,
	modalityOfWrites,
	modelKindsAllow,
	modelKindsOf,
	parseKindList,
	purposeOn,
	toggledPurpose
} from "./modelKinds"
import { modelPurposeChoices } from "./modelModality"
import { modalityOfTransform } from "$lib/shared/constants/connectionSections"

const allow = (row: Parameters<typeof modelKindsAllow>[0], cap: string) =>
	modelKindsAllow(row, cap, modalityOfTransform)

describe("modelKindsOf", () => {
	test("stated columns win; a generating modality reads as what it writes; reads stay unstated", () => {
		expect(modelKindsOf({ modality: "text-gen" })).toEqual({ reads: null, writes: ["text"] })
		expect(modelKindsOf({ modality: "image-gen" })).toEqual({ reads: null, writes: ["image"] })
		expect(modelKindsOf({ modality: "text-gen", writes: ["text", "audio"], reads: ["text", "image"] })).toEqual({
			reads: ["text", "image"],
			writes: ["text", "audio"]
		})
		expect(modelKindsOf({ modality: "embeddings" })).toEqual({ reads: null, writes: null })
		expect(modelKindsOf(null)).toEqual({ reads: null, writes: null })
	})
})

describe("modelKindsAllow — in ⊆ reads, out ⊆ writes", () => {
	test("a text model replies; is refused pictures and speech; its reads are not stated, so vision passes", () => {
		expect(allow({ modality: "text-gen" }, "text->text")).toBe(true)
		expect(allow({ modality: "text-gen" }, "text+image->text")).toBe(true)
		expect(allow({ modality: "text-gen" }, "text->image")).toBe(false)
		expect(allow({ modality: "text-gen" }, "text->text+audio")).toBe(false)
	})
	test("stated reads gate what goes in", () => {
		expect(allow({ reads: ["text"], writes: ["text"] }, "text+image->text")).toBe(false)
		expect(allow({ reads: ["text", "audio"], writes: ["text"] }, "text+audio->text")).toBe(true)
		expect(allow({ reads: ["text", "audio"], writes: ["text"] }, "audio->text")).toBe(true)
	})
	test("embeddings and entities stay single", () => {
		expect(allow({ modality: "embeddings" }, "text->embedding")).toBe(true)
		expect(allow({ modality: "embeddings" }, "text->text")).toBe(false)
		expect(allow({ modality: "ner" }, "text->entities")).toBe(true)
	})
	test("a feature, and a model nobody described, are never gated", () => {
		expect(allow({ modality: "text-gen" }, "tools")).toBe(true)
		expect(allow({}, "text->image")).toBe(true)
	})
	test("speech is the tts modality now, not none", () => {
		expect(allow({ modality: "tts" }, "text->audio")).toBe(true)
		expect(allow({ modality: "tts" }, "text->text")).toBe(false)
	})
})

describe("What it's for", () => {
	test("five choices, in the ruled order", () => {
		expect(MODEL_PURPOSES.map((p) => p.label)).toEqual([
			"Writes replies",
			"Draws pictures",
			"Speaks",
			"Hears",
			"Sees"
		])
	})
	test("a toggle states only its own half; reads keep text; nothing written is Not sure", () => {
		const kinds = modelKindsOf({ modality: "text-gen" })
		const speaks = MODEL_PURPOSES.find((p) => p.key === "speaks")!
		const hears = MODEL_PURPOSES.find((p) => p.key === "hears")!
		const writes = MODEL_PURPOSES.find((p) => p.key === "writes-replies")!
		expect(toggledPurpose(kinds, speaks, true)).toEqual({ writes: ["text", "audio"] })
		expect(toggledPurpose(kinds, hears, true)).toEqual({ reads: ["text", "audio"] })
		expect(toggledPurpose(kinds, writes, false)).toEqual({ writes: null })
		expect(purposeOn(kinds, writes)).toBe(true)
		expect(purposeOn(kinds, hears)).toBe(false)
	})
	test("a generating model is filed under what its writes lead with", () => {
		expect(modalityOfWrites(["text", "audio"])).toBe("text-gen")
		expect(modalityOfWrites(["image"])).toBe("image-gen")
		expect(modalityOfWrites(["audio"])).toBe("tts")
		expect(modalityOfWrites(null)).toBeNull()
	})
	test("the choices follow what the connection type can carry", () => {
		const openai = modelPurposeChoices("openai").map((p) => p.key)
		expect(openai).toEqual(["writes-replies", "draws-pictures", "speaks", "hears", "sees"])
		const anthropic = modelPurposeChoices("anthropic").map((p) => p.key)
		expect(anthropic).toEqual(["writes-replies", "sees"])
	})
	test("a payload's list is checked for its shape", () => {
		expect(parseKindList(["text", "audio", "audio"], "writes")).toEqual({ value: ["text", "audio"] })
		expect(parseKindList(null, "reads")).toEqual({ value: null })
		expect("error" in parseKindList("text", "reads")).toBe(true)
	})
})
