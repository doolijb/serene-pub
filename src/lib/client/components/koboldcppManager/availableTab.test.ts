/**
 * These exist for a failure that is invisible at the moment it happens.
 *
 * A download started from the Image tab that forgets to say so is recorded with
 * the server's default kind ("text"), and the multi-gigabyte file the user just
 * waited for never appears in the Image list. Nothing throws, and there is no
 * later point at which the app can notice: a Stable-Diffusion .gguf is
 * byte-indistinguishable from a text-LLM .gguf by filename, which is the whole
 * reason the kind has to be recorded at the moment it is known.
 */
import { describe, expect, test } from "vitest"
import { downloadParams } from "./availableTab"

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

	test("a recommended vision model's projector rides along on a text download, never on an image one", () => {
		const projector = {
			filename: "mmproj-F16.gguf",
			downloadUrl: "https://example.invalid/mmproj-F16.gguf"
		}
		const seeing = { ...TEXT_MODEL, visionProjector: projector }
		expect(
			downloadParams(seeing, TEXT_MODEL.pullOptions[1], "text").visionProjector
		).toEqual(projector)
		expect(
			downloadParams(seeing, TEXT_MODEL.pullOptions[1], "image").visionProjector
		).toBeUndefined()
		expect(
			downloadParams(TEXT_MODEL, TEXT_MODEL.pullOptions[1], "text").visionProjector
		).toBeUndefined()
	})
})
