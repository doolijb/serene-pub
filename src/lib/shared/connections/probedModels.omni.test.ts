/**
 * 🚧 What a host says a model reads and writes (O3) — read off a listing.
 */
import { describe, expect, test } from "vitest"
import { normalizeProbedModels } from "./probedModels"

describe("normalizeProbedModels — reads and writes", () => {
	test("OpenRouter's architecture modalities become the model's sets", () => {
		const [m] = normalizeProbedModels([
			{
				id: "openai/gpt-4o-audio-preview",
				architecture: { input_modalities: ["text", "audio", "file"], output_modalities: ["text", "audio"] }
			}
		])
		expect(m).toMatchObject({ reads: ["text", "audio"], writes: ["text", "audio"] })
	})

	test("an adapter's own lists win; an embedding model states none; silence states none", () => {
		const [a, e, s] = normalizeProbedModels([
			{ model: "x", reads: ["text", "image"], writes: ["text"], architecture: { output_modalities: ["image"] } },
			{ model: "embed", modality: "embeddings", architecture: { output_modalities: ["embeddings"] } },
			{ model: "plain" }
		])
		expect(a).toMatchObject({ reads: ["text", "image"], writes: ["text"] })
		expect(e).not.toHaveProperty("writes")
		expect(s).not.toHaveProperty("reads")
		expect(s).not.toHaveProperty("writes")
	})
})
