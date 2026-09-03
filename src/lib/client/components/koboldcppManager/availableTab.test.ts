/**
 * These exist for a failure that is invisible at the moment it happens.
 *
 * A download started from the Image tab that forgets to say so is recorded with
 * the server's default kind ("text"), and the multi-gigabyte file the user just
 * waited for never appears in the Image list. Nothing throws, and there is no
 * later point at which the app can notice: a Stable-Diffusion .gguf is
 * byte-indistinguishable from a text-LLM .gguf by filename, which is the whole
 * reason the kind has to be recorded at the moment it is known.
 *
 * The rest guard copy that would otherwise quietly lie — an empty list that
 * reads as "there are no image models" when what actually happened is that a
 * single upstream repo could not be fetched.
 */
import { describe, expect, test } from "vitest"
import {
	PICKER_COPY,
	SEARCH_HINT,
	downloadParams,
	isRecommendedQuant,
	pullOptionsLabel,
	recommendedEmptyState,
	skipsPicker
} from "./availableTab"

const IMG_MODEL: Sockets.KoboldCPP.SearchModels.ModelResult = {
	name: "koboldcpp/imgmodel",
	description: "A few simple image generation models",
	url: "https://huggingface.co/koboldcpp/imgmodel",
	sdcpp: true,
	pullOptions: [
		{
			label: "imgmodel_xl_q4_0.gguf",
			filename: "imgmodel_xl_q4_0.gguf",
			downloadUrl:
				"https://huggingface.co/koboldcpp/imgmodel/resolve/main/imgmodel_xl_q4_0.gguf",
			sizeBytes: 6_300_000_000
		}
	]
}

const TEXT_MODEL: Sockets.KoboldCPP.SearchModels.ModelResult = {
	name: "bartowski/Llama-3.2-1B-Instruct-GGUF",
	description: "Llama 3.2",
	url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF",
	pullOptions: [
		{
			label: "Q4_K_M",
			filename: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
			downloadUrl: "https://example.invalid/q4.gguf",
			sizeBytes: 808_000_000
		},
		{
			label: "Q8_0",
			filename: "Llama-3.2-1B-Instruct-Q8_0.gguf",
			downloadUrl: "https://example.invalid/q8.gguf",
			sizeBytes: 1_300_000_000
		}
	]
}

describe("downloadParams", () => {
	test("carries the kind of the tab the download was started from", () => {
		expect(
			downloadParams(IMG_MODEL, IMG_MODEL.pullOptions[0], "image").kind
		).toBe("image")
		expect(
			downloadParams(TEXT_MODEL, TEXT_MODEL.pullOptions[0], "text").kind
		).toBe("text")
	})

	test("says image for a .gguf, because the extension proves nothing", () => {
		// The maintainer's own image catalog is entirely .gguf. If this ever
		// falls back to inferring from the filename, every recommended image
		// model silently becomes a text model.
		const params = downloadParams(
			IMG_MODEL,
			IMG_MODEL.pullOptions[0],
			"image"
		)
		expect(params.filename.endsWith(".gguf")).toBe(true)
		expect(params.kind).toBe("image")
	})

	test("passes through every field the download handler already relied on", () => {
		expect(
			downloadParams(TEXT_MODEL, TEXT_MODEL.pullOptions[1], "text")
		).toEqual({
			modelName: "bartowski/Llama-3.2-1B-Instruct-GGUF",
			filename: "Llama-3.2-1B-Instruct-Q8_0.gguf",
			downloadUrl: "https://example.invalid/q8.gguf",
			modelUrl:
				"https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF",
			description: "Llama 3.2",
			quantization: "Q8_0",
			sizeBytes: 1_300_000_000,
			kind: "text"
		})
	})
})

describe("skipsPicker", () => {
	test("a single-file card downloads on one click", () => {
		expect(skipsPicker(IMG_MODEL)).toBe(true)
	})

	test("a card with something to choose still opens the picker", () => {
		expect(skipsPicker(TEXT_MODEL)).toBe(false)
	})
})

describe("isRecommendedQuant", () => {
	test("recommends Q4_K_M for text models", () => {
		expect(isRecommendedQuant("text", "Q4_K_M")).toBe(true)
		expect(isRecommendedQuant("text", "Q8_0")).toBe(false)
	})

	test("never recommends a quantization on the image side", () => {
		// Image labels are whole filenames, so a substring match would fire on
		// coincidence rather than on a considered recommendation.
		expect(isRecommendedQuant("image", "sd15_Q4_K_M.gguf")).toBe(false)
		expect(isRecommendedQuant("image", "imgmodel_xl_q4_0.gguf")).toBe(false)
	})
})

describe("PICKER_COPY", () => {
	test("the image picker never calls a choice of model a quantization", () => {
		// The rows there are different checkpoints (SD1.5 vs SDXL), not one
		// model at different precisions — naming them quantizations would send
		// the user looking for a Q-number that isn't on any of them.
		const { title, ariaLabel, blurb } = PICKER_COPY.image
		expect(`${title} ${ariaLabel} ${blurb}`).not.toMatch(/quant/i)
	})

	test("the text picker still names the quantization tradeoff", () => {
		expect(PICKER_COPY.text.blurb).toMatch(/Q4_K_M/)
	})
})

describe("pullOptionsLabel", () => {
	test("counts image options as files, not quantizations", () => {
		expect(pullOptionsLabel(6, "image")).toBe("6 files")
		expect(pullOptionsLabel(6, "text")).toBe("6 quants")
	})

	test("stays singular for one", () => {
		expect(pullOptionsLabel(1, "image")).toBe("1 file")
		expect(pullOptionsLabel(1, "text")).toBe("1 quant")
	})
})

describe("recommendedEmptyState", () => {
	test("a failed image-catalog fetch reads as a failure, not as an empty catalog", () => {
		// koboldcpp/imgmodel is a single upstream repo. Renamed or unreachable,
		// the list is empty — and "no recommended image models" would then be
		// read as a fact about KoboldCPP rather than about the network.
		const state = recommendedEmptyState("image", true)
		expect(state.tone).toBe("error")
		expect(state.detail).toMatch(/Hugging Face/)
	})

	test("an empty catalog does not claim a failure", () => {
		expect(recommendedEmptyState("image", false).tone).toBe("empty")
		expect(recommendedEmptyState("text", false).tone).toBe("empty")
	})

	test("both kinds offer the source that still works", () => {
		for (const kind of ["text", "image"] as const) {
			for (const failed of [true, false]) {
				expect(recommendedEmptyState(kind, failed).detail).toMatch(
					/Hugging Face/
				)
			}
		}
	})
})

describe("SEARCH_HINT", () => {
	test("tells the image searcher what it is actually searching for", () => {
		// The image search filters on text-to-image, so a user typing an LLM
		// name gets nothing back; the hint is the only thing that says so.
		expect(SEARCH_HINT.image).toMatch(/Stable Diffusion/)
		expect(SEARCH_HINT.text).toMatch(/GGUF/)
	})
})
