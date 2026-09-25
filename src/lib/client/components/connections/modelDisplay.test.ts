import { describe, expect, test } from "vitest"
import { formatSize, modelDisplay, nameFromIdentifier } from "./modelDisplay"

describe("nameFromIdentifier", () => {
	test("pulls the model out of a Hugging Face GGUF path with a quant tag", () => {
		// The shipped managed view used this whole string as the row's title,
		// wrapped over two lines.
		expect(
			nameFromIdentifier("hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M")
		).toBe("MN Lyra v4")
	})

	test("drops the packager, the format and the quant, keeps the name", () => {
		expect(
			nameFromIdentifier(
				"hf.co/bartowski/TheDrummer_Cydonia-24B-v4.3-GGUF:IQ4_XS"
			)
		).toBe("TheDrummer Cydonia v4.3")
	})

	test("keeps instruction-tuning in the name — it distinguishes checkpoints", () => {
		expect(nameFromIdentifier("Qwen2.5-14B-Instruct-GGUF")).toContain(
			"Instruct"
		)
	})

	test("leaves a plain cloud identifier alone", () => {
		expect(nameFromIdentifier("gpt-4o")).toBe("Gpt 4o")
		expect(nameFromIdentifier("claude-sonnet-4-5")).toBe(
			"Claude Sonnet 4 5"
		)
	})

	test("strips a file extension", () => {
		expect(nameFromIdentifier("Lyra-v4-Q4_K_M.gguf")).toBe("Lyra v4")
	})

	test("falls back rather than returning an empty row", () => {
		expect(nameFromIdentifier("Q4_K_M.gguf")).toBe("Q4_K_M")
		expect(nameFromIdentifier("")).toBe("")
	})
})

describe("modelDisplay", () => {
	test("a person's name always wins over anything derived", () => {
		expect(
			modelDisplay({
				model: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M",
				name: "The good one"
			}).name
		).toBe("The good one")
	})

	test("derives a name when the row is still its bare identifier", () => {
		// What `syncConnectionModels` leaves a freshly-listed row as.
		const d = modelDisplay({
			model: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M",
			name: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M"
		})
		expect(d.name).toBe("MN Lyra v4")
	})

	test("reads the parameters and the quant out of the identifier", () => {
		const d = modelDisplay({
			model: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M"
		})
		expect(d.parameters).toBe("12B")
		expect(d.quantization).toBe("Q4_K_M")
	})

	test("the host's own facts beat the regular expression", () => {
		const d = modelDisplay({
			model: "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M",
			facts: {
				parameters: "12.2B",
				quantization: "Q4_K_S",
				source: "host"
			}
		})
		expect(d.parameters).toBe("12.2B")
		expect(d.quantization).toBe("Q4_K_S")
	})

	test("a cloud model has neither, and says so with null", () => {
		const d = modelDisplay({ model: "anthropic/claude-sonnet-4.5" })
		expect(d.parameters).toBeNull()
		expect(d.quantization).toBeNull()
	})

	test("always keeps the identifier verbatim", () => {
		const id = "hf.co/bartowski/MN-12B-Lyra-v4-GGUF:Q4_K_M"
		expect(modelDisplay({ model: id }).identifier).toBe(id)
	})
})

describe("formatSize", () => {
	test("reads bytes as a person says them", () => {
		expect(formatSize(7_000_000_000)).toBe("7 GB")
		expect(formatSize(11_900_000_000)).toBe("11.9 GB")
		expect(formatSize(24_000_000_000)).toBe("24 GB")
		expect(formatSize(840_000_000)).toBe("840 MB")
	})

	test("answers null for nothing", () => {
		expect(formatSize(null)).toBeNull()
		expect(formatSize(0)).toBeNull()
		expect(formatSize(undefined)).toBeNull()
	})
})
