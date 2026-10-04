/**
 * One writer for a stored file's part (PLAN-composer-attachments §3.1 "Part
 * data"): `core:image` carries its width, height and name, `core:file` its
 * mime, name and size — whoever wrote it (an attachment, `mediaParts`, an
 * outlet).
 */
import { describe, expect, test } from "vitest"
import { mediaPartFor } from "./partData"

const row = (over: Record<string, unknown> = {}) =>
	({
		id: 41,
		kind: "image",
		filename: "cat.png",
		width: 1600,
		height: 900,
		displayMime: "image/webp",
		displayBytes: 2048,
		...over
	}) as any

describe("mediaPartFor", () => {
	test("an image part carries its width, height, name and alt", () => {
		expect(mediaPartFor(row(), { alt: "A tabby" })).toEqual({
			type: "core:image",
			data: { assetId: 41, alt: "A tabby", filename: "cat.png", width: 1600, height: 900 }
		})
	})

	test("an unknown size is left off, never written as 0 or null", () => {
		expect(mediaPartFor(row({ width: null, height: 0, filename: null })).data).toEqual({ assetId: 41 })
	})

	test("a file part carries its display mime, name and bytes", () => {
		expect(mediaPartFor(row({ kind: "document", filename: "notes.md", displayMime: "text/markdown", displayBytes: 3072 }))).toEqual({
			type: "core:file",
			data: { assetId: 41, mime: "text/markdown", name: "notes.md", bytes: 3072 }
		})
	})

	test("an outlet may force the part type and name a file the row kept no name for", () => {
		const part = mediaPartFor(row({ kind: "image", filename: null, displayMime: null, displayBytes: null }), {
			as: "file",
			name: "render.png",
			mime: "image/png"
		})
		expect(part).toEqual({ type: "core:file", data: { assetId: 41, mime: "image/png", name: "render.png" } })
	})
})
