import { describe, expect, it } from "vitest"
import {
	factsAreEmpty,
	formatContext,
	formatPrice,
	readModelFacts,
	readStoredFacts
} from "./modelFacts"
import { normalizeProbedModels } from "./probedModels"

describe("readModelFacts — OpenAI-compatible (OpenRouter)", () => {
	const entry = {
		id: "anthropic/claude-sonnet-4.5",
		name: "Anthropic: Claude Sonnet 4.5",
		context_length: 200000,
		pricing: { prompt: "0.000003", completion: "0.000015" },
		architecture: { input_modalities: ["text", "image"] },
		top_provider: { max_completion_tokens: 64000 },
		created: 1727308800
	}

	it("reads the context window", () => {
		expect(readModelFacts(entry)?.contextWindow).toBe(200000)
	})

	it("converts per-token strings to per-million numbers", () => {
		// The whole reason this is not a field copy: OpenRouter quotes per
		// token, the app shows per million.
		expect(readModelFacts(entry)?.pricing).toEqual({
			inPerMTok: 3,
			outPerMTok: 15,
			currency: "USD"
		})
	})

	it("keeps a zero price as Free rather than dropping it as falsy", () => {
		const free = readModelFacts({
			context_length: 8192,
			pricing: { prompt: "0", completion: "0" }
		})
		expect(free?.pricing?.inPerMTok).toBe(0)
		expect(formatPrice(free?.pricing?.inPerMTok)).toBe("Free")
	})

	it("reads the max output tokens off top_provider", () => {
		expect(readModelFacts(entry)?.maxOutputTokens).toBe(64000)
	})

	it("reads input modalities, and falls back to the arrow string", () => {
		expect(readModelFacts(entry)?.inputModalities).toEqual([
			"text",
			"image"
		])
		expect(
			readModelFacts({
				context_length: 1,
				architecture: { modality: "text+image->text" }
			})?.inputModalities
		).toEqual(["text", "image"])
	})

	it("turns the unix created stamp into an ISO date", () => {
		expect(readModelFacts(entry)?.released).toBe("2024-09-26T00:00:00.000Z")
	})

	it("marks the bag as coming from the host", () => {
		expect(readModelFacts(entry)?.source).toBe("host")
	})
})

describe("readModelFacts — Ollama", () => {
	const entry = {
		name: "llama3.1:8b",
		model: "llama3.1:8b",
		size: 4661224676,
		modified_at: "2026-06-30T12:00:00.000Z",
		details: {
			family: "llama",
			parameter_size: "8.0B",
			quantization_level: "Q4_K_M"
		}
	}

	it("reads the details bag and the byte size", () => {
		expect(readModelFacts(entry)).toEqual({
			parameters: "8.0B",
			quantization: "Q4_K_M",
			family: "llama",
			sizeBytes: 4661224676,
			released: "2026-06-30T12:00:00.000Z",
			source: "host"
		})
	})

	it("does not invent a price for a model that is free by construction", () => {
		expect(readModelFacts(entry)?.pricing).toBeUndefined()
	})
})

describe("readModelFacts — LM Studio", () => {
	it("reads the SDK's camelCase descriptor", () => {
		expect(
			readModelFacts({
				model: "qwen2.5-14b",
				name: "Qwen2.5 14B",
				maxContextLength: 32768,
				paramsString: "14B",
				quantization: "Q4_K_M",
				architecture: "qwen2",
				sizeBytes: 9020000000,
				vision: true
			})
		).toEqual({
			contextWindow: 32768,
			parameters: "14B",
			quantization: "Q4_K_M",
			family: "qwen2",
			sizeBytes: 9020000000,
			inputModalities: ["text", "image"],
			source: "host"
		})
	})
})

describe("readModelFacts — a producer that already speaks ModelFacts", () => {
	it("passes a declared bag through and keeps its source", () => {
		expect(
			readModelFacts({
				id: "claude-sonnet-4-5",
				name: "Claude Sonnet 4.5",
				facts: {
					contextWindow: 200000,
					pricing: { inPerMTok: 3, outPerMTok: 15, currency: "USD" },
					source: "list"
				}
			})
		).toEqual({
			contextWindow: 200000,
			pricing: { inPerMTok: 3, outPerMTok: 15, currency: "USD" },
			source: "list"
		})
	})

	it("keeps a file-sourced bag from the managed KoboldCPP listing", () => {
		expect(
			readModelFacts({
				model: "Lyra-v4-Q4_K_M.gguf",
				name: "Lyra v4",
				facts: {
					quantization: "Q4_K_M",
					sizeBytes: 7000000000,
					source: "file"
				}
			})
		).toEqual({
			quantization: "Q4_K_M",
			sizeBytes: 7000000000,
			source: "file"
		})
	})
})

describe("readModelFacts — nothing to say", () => {
	it("answers null for a bare OpenAI official entry", () => {
		// `{id, object, created, owned_by}` carries no fact worth a column, and
		// an empty bag would read like an answer.
		expect(
			readModelFacts({
				id: "gpt-4o",
				object: "model",
				owned_by: "openai"
			})
		).toBeNull()
	})

	it("answers null for a string, a null and a bare identifier", () => {
		expect(readModelFacts("gpt-4o")).toBeNull()
		expect(readModelFacts(null)).toBeNull()
		expect(readModelFacts({ model: "x", name: "x" })).toBeNull()
	})

	it("never guesses a fact the host did not send", () => {
		const facts = readModelFacts({ context_length: 8192 })
		expect(facts?.contextWindow).toBe(8192)
		expect(facts?.pricing).toBeUndefined()
		expect(facts?.quantization).toBeUndefined()
		expect(facts?.parameters).toBeUndefined()
	})
})

describe("factsAreEmpty", () => {
	it("is true for nothing, and for a bag holding only its provenance", () => {
		expect(factsAreEmpty(undefined)).toBe(true)
		expect(factsAreEmpty({ source: "host" })).toBe(true)
		expect(factsAreEmpty({ contextWindow: 1, source: "host" })).toBe(false)
	})
})

describe("normalizeProbedModels carries the facts", () => {
	it("attaches facts to the entries that have them and omits the rest", () => {
		const out = normalizeProbedModels([
			{ id: "a", name: "A", context_length: 8192 },
			{ id: "b", name: "B" }
		])
		expect(out[0].facts?.contextWindow).toBe(8192)
		expect(out[1].facts).toBeUndefined()
	})

	it("still drops an entry with no usable identifier", () => {
		expect(normalizeProbedModels([{ context_length: 8192 }])).toEqual([])
	})
})

describe("formatContext", () => {
	it("reads windows the way a person says them", () => {
		expect(formatContext(200000)).toBe("200k")
		expect(formatContext(32768)).toBe("33k")
		expect(formatContext(512)).toBe("512")
		expect(formatContext(1_048_576)).toBe("1M")
		expect(formatContext(2_000_000)).toBe("2M")
	})

	it("answers null for nothing, rather than a zero", () => {
		expect(formatContext(null)).toBeNull()
		expect(formatContext(0)).toBeNull()
		expect(formatContext(undefined)).toBeNull()
	})
})

describe("formatPrice", () => {
	it("prints dollars per million, and Free for zero", () => {
		expect(formatPrice(3)).toBe("$3.00")
		expect(formatPrice(0.8)).toBe("$0.80")
		expect(formatPrice(0.0004)).toBe("$0.0004")
		expect(formatPrice(0)).toBe("Free")
	})

	it("answers null for unknown, which renders as a dash", () => {
		expect(formatPrice(null)).toBeNull()
		expect(formatPrice(undefined)).toBeNull()
	})

	it("spells a currency that is not dollars", () => {
		expect(formatPrice(3, "EUR")).toBe("EUR 3.00")
	})
})

describe("a stored facts column, read back", () => {
	it("returns a stored row's facts, validated", () => {
		expect(
			readStoredFacts({ contextWindow: 8192, source: "list", family: "llama" })
		).toEqual({ contextWindow: 8192, source: "list", family: "llama" })
	})

	it("gives a legacy row with no source the default, instead of passing it through unchecked", () => {
		// The case the old `as ModelFacts` cast hid: a row that predates
		// `source` would have reached the client missing a required field.
		expect(readStoredFacts({ contextWindow: 4096 })?.source).toBe("host")
	})

	it("drops a field that is the wrong shape rather than trusting it", () => {
		const facts = readStoredFacts({ contextWindow: "lots", family: "qwen" })
		expect(facts?.contextWindow).toBeUndefined()
		expect(facts?.family).toBe("qwen")
	})

	it("reads an absent or empty column as no facts, so the wire omits the key", () => {
		expect(readStoredFacts(null)).toBeNull()
		expect(readStoredFacts(undefined)).toBeNull()
		expect(readStoredFacts({})).toBeNull()
		expect(readStoredFacts("nonsense")).toBeNull()
	})
})
