import { describe, expect, test } from "vitest"
import { MAX_MEDIA_UPLOAD_BYTES } from "$lib/server/media/sniff"
import {
	ATTACHMENT_CAPS,
	ATTACHMENT_KINDS,
	attachmentCapBytes,
	attachmentKindOf,
	attachmentSizeRefusal
} from "./caps"

const MiB = 1024 * 1024

describe("attachment caps (D5/D6)", () => {
	test("the owner's numbers", () => {
		expect(ATTACHMENT_CAPS.filesPerMessage).toBe(10)
		expect(attachmentCapBytes("image")).toBe(20 * MiB)
		expect(attachmentCapBytes("text")).toBe(1 * MiB)
		expect(attachmentCapBytes("pdf")).toBe(32 * MiB)
		expect(ATTACHMENT_CAPS.chunkBytes).toBe(1 * MiB)
	})

	test("the absolute cap is the media store's, and no kind exceeds it", () => {
		expect(ATTACHMENT_CAPS.absoluteBytes).toBe(MAX_MEDIA_UPLOAD_BYTES)
		for (const kind of ATTACHMENT_KINDS)
			expect(attachmentCapBytes(kind)).toBeLessThanOrEqual(
				MAX_MEDIA_UPLOAD_BYTES
			)
	})

	test("kinds come from sniffed mimes; documents no model reads are not offered", () => {
		expect(attachmentKindOf("image/png")).toBe("image")
		expect(attachmentKindOf("image/gif")).toBe("image")
		expect(attachmentKindOf("text/markdown")).toBe("text")
		expect(attachmentKindOf("application/pdf")).toBe("pdf")
		expect(attachmentKindOf("application/epub+zip")).toBeNull()
		expect(attachmentKindOf("application/rtf")).toBeNull()
		expect(attachmentKindOf("image/svg+xml")).toBeNull()
	})

	test("a size refusal names the kind and its cap", () => {
		expect(attachmentSizeRefusal("image", 20 * MiB)).toBeNull()
		expect(attachmentSizeRefusal("image", 20 * MiB + 1)).toBe(
			"An image can be at most 20 MB."
		)
		expect(attachmentSizeRefusal("text", 2 * MiB)).toBe(
			"A text file can be at most 1 MB."
		)
	})
})
