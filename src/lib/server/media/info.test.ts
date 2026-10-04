/**
 * The lightbox info pane's projection (attachments plan §3.4, lane F): named
 * fields only, and connection identity for administrators only.
 */
import { describe, expect, test } from "vitest"
import { mediaInfo } from "./info"
import type { FileRow } from "./index"

function file(over: Partial<FileRow> = {}): FileRow {
	return {
		id: 7,
		uuid: "11111111-2222-3333-4444-555555555555",
		kind: "image",
		filename: "cat.png",
		displayMime: "image/png",
		displayBytes: 2048,
		width: 640,
		height: 480,
		meta: null,
		...over
	} as FileRow
}

const generatedMeta = {
	prompt: "a lighthouse at dusk",
	negativePrompt: "blurry",
	seed: 42,
	model: "sdxl-base",
	backend: "a1111",
	connectionName: "Jody's Forge box",
	samplingConfig: "Portrait",
	request: { prompt: "a lighthouse at dusk", steps: 30, cfg: 6.5, sampler: "Euler a", width: 832, height: 1216 },
	applied: ["steps"],
	ignored: [],
	secretInternal: "never shown"
}

describe("mediaInfo", () => {
	test("an upload is its filename, type, size and dimensions — no generation block", () => {
		const info = mediaInfo(file(), { isAdmin: false })
		expect(info).toEqual({
			id: 7,
			uuid: "11111111-2222-3333-4444-555555555555",
			kind: "image",
			filename: "cat.png",
			mime: "image/png",
			bytes: 2048,
			width: 640,
			height: 480,
			generated: null
		})
	})

	test("a generated image reads named fields only, from meta and its request", () => {
		const info = mediaInfo(file({ meta: generatedMeta }), { isAdmin: true })
		expect(info.generated).toEqual({
			prompt: "a lighthouse at dusk",
			negativePrompt: "blurry",
			seed: 42,
			model: "sdxl-base",
			steps: 30,
			cfg: 6.5,
			sampler: "Euler a",
			width: 832,
			height: 1216,
			samplingConfig: "Portrait",
			connectionName: "Jody's Forge box"
		})
		expect(JSON.stringify(info)).not.toContain("never shown")
	})

	test("a non-admin never sees which connection made it", () => {
		const info = mediaInfo(file({ meta: generatedMeta }), { isAdmin: false })
		expect(info.generated?.prompt).toBe("a lighthouse at dusk")
		expect(info.generated).not.toHaveProperty("connectionName")
	})
})
