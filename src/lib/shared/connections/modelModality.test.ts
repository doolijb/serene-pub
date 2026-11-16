import { describe, expect, test } from "vitest"
import { modelModalityChoices } from "./modelModality"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

describe("modelModalityChoices", () => {
	test("an OpenAI-compatible model is for chat, images, embeddings or speech", () => {
		// Images since the OpenAI-images module (2026-10-12); speech since
		// Speech became a section (2026-11-12).
		expect(modelModalityChoices(CONNECTION_TYPE.OPENAI)).toEqual([
			"text-gen",
			"image-gen",
			"embeddings",
			"tts"
		])
	})

	test("a single-job type offers one choice, so the control stays hidden", () => {
		expect(modelModalityChoices(CONNECTION_TYPE.ANTHROPIC)).toHaveLength(1)
	})
})
