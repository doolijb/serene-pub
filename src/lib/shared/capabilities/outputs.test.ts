/**
 * 🚧 The derived bind requirement (O6): what a step's requested outputs ask
 * of its connection — and the model gate refusing a pair whose model was not
 * said to speak (O3).
 */
import { describe, expect, test } from "vitest"
import { capabilityForOutputs } from "./outputs"
import { modelKindsAllow } from "$lib/shared/connections/modelKinds"
import { modalityOfTransform } from "$lib/shared/constants/connectionSections"

describe("capabilityForOutputs", () => {
	test("text alone, or nothing stated, is the reply as it always was", () => {
		expect(capabilityForOutputs(undefined)).toBe("text->text")
		expect(capabilityForOutputs([])).toBe("text->text")
		expect(capabilityForOutputs(["text"])).toBe("text->text")
	})

	test("audio beside text asks for a spoken reply", () => {
		expect(capabilityForOutputs(["text", "audio"])).toBe("text->text+audio")
		expect(capabilityForOutputs(["audio", "text"])).toBe("text->text+audio")
	})

	test("an unknown kind passes through into the requirement (O1)", () => {
		expect(capabilityForOutputs(["text", "hologram"])).toBe("text->text+hologram")
	})
})

describe("the requirement against a model's writes", () => {
	const spoken = capabilityForOutputs(["text", "audio"])
	test("a model that only writes replies is refused a spoken reply", () => {
		expect(modelKindsAllow({ modality: "text-gen" }, spoken, modalityOfTransform)).toBe(false)
		expect(modelKindsAllow({ writes: ["text"] }, spoken, modalityOfTransform)).toBe(false)
	})
	test("a model that speaks takes it; one nobody described is ungated", () => {
		expect(modelKindsAllow({ writes: ["text", "audio"] }, spoken, modalityOfTransform)).toBe(true)
		expect(modelKindsAllow({}, spoken, modalityOfTransform)).toBe(true)
	})
})
