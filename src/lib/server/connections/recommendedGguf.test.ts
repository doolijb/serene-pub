import { describe, expect, it } from "vitest"
import {
	chatEntries,
	embeddingEntries,
	parseRecommendedYaml
} from "./recommendedGguf"

const YAML = `# name: string
# tags: string[]
models:
  # 3GB VRAM Tier
  - name: unsloth/Qwen3.5-4B-GGUF
    pull: hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M
    size: 2.74
    recommended_vram: 3
    tags: [roleplay, utility, vision, long-context]
    details:
      parameter_size: 4B
      quantization_level: Q4_K_M
      modified_at: "2026-02"
      description: "Compact Qwen with a long context."

  - name: nomic-embed-text
    pull: nomic-embed-text
    size: 0.27
    recommended_vram: 1
    tags: [embedding]
    details:
      parameter_size: 137M
      quantization_level: F16
      modified_at: "2024-02"
      description: "A strong general-purpose English embedding model."
`

describe("the recommended GGUF list, read once", () => {
	it("reads every field the list carries", () => {
		const [qwen] = parseRecommendedYaml(YAML)
		expect(qwen).toEqual({
			name: "unsloth/Qwen3.5-4B-GGUF",
			pull: "hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M",
			size: 2.74,
			recommended_vram: 3,
			tags: ["roleplay", "utility", "vision", "long-context"],
			details: {
				parameter_size: "4B",
				quantization_level: "Q4_K_M",
				modified_at: "2026-02",
				description: "Compact Qwen with a long context."
			}
		})
	})

	it("keeps the tags", () => {
		expect(parseRecommendedYaml(YAML).map((e) => e.tags)).toEqual([
			["roleplay", "utility", "vision", "long-context"],
			["embedding"]
		])
	})

	it("falls back to 0 on a garbled number, never NaN", () => {
		const [e] = parseRecommendedYaml(
			"models:\n  - name: x\n    size: lots\n    recommended_vram: many\n"
		)
		expect(e.size).toBe(0)
		expect(e.recommended_vram).toBe(0)
	})

	it("an entry with no tags line has none, not undefined", () => {
		const [e] = parseRecommendedYaml("models:\n  - name: x\n    pull: y\n")
		expect(e.tags).toEqual([])
	})

	it("ignores comment lines, including ones that look like fields", () => {
		const [e] = parseRecommendedYaml(
			"models:\n  - name: x\n    # size: 99\n    size: 1\n"
		)
		expect(e.size).toBe(1)
	})
})

describe("embedding models never reach a chat list", () => {
	const entries = parseRecommendedYaml(YAML)

	it("the chat list excludes an embedding-tagged entry", () => {
		// KoboldCPP reads this file for its TEXT list; an embedding entry's pull
		// is an Ollama library name no KoboldCPP can fetch.
		expect(chatEntries(entries).map((e) => e.name)).toEqual([
			"unsloth/Qwen3.5-4B-GGUF"
		])
	})

	it("the embeddings list is exactly the tagged entries", () => {
		expect(embeddingEntries(entries).map((e) => e.name)).toEqual([
			"nomic-embed-text"
		])
	})
})
