/**
 * 🚧 Placed media in the context budget (O10).
 */
import { describe, expect, test } from "vitest"
import { fallBackMedia, mediaBudgetNote, placedMediaTokens } from "./mediaBudget"

const line = (id: number, tokens?: number) =>
	tokens
		? {
				id,
				message: `line ${id}`,
				attachments: `\n<@media:u-${id}>`,
				mediaTokens: tokens,
				attachmentsAsText: `\n[image: u-${id}.png]`
			}
		: { id, message: `line ${id}` }

describe("placed media", () => {
	test("is counted from each line's estimate", () => {
		expect(placedMediaTokens([line(1, 1600), line(2), line(3, 100)])).toBe(1700)
		expect(placedMediaTokens([line(1)])).toBe(0)
	})

	test("falls back to its names, oldest line first, until enough is freed", () => {
		const input = [line(1, 1600), line(2), line(3, 1600), line(4, 1600)]
		const fb = fallBackMedia(input, 2000, () => 5)
		expect(fb.files).toBe(2)
		expect(fb.lines[0]).toEqual({ id: 1, message: "line 1", attachments: "\n[image: u-1.png]" })
		expect(fb.lines[1]).toBe(input[1])
		expect(fb.lines[2]).not.toHaveProperty("mediaTokens")
		// The newest line keeps its picture.
		expect(fb.lines[3]).toBe(input[3])
		expect(placedMediaTokens(fb.lines)).toBe(1600)
	})

	test("the receipt says what fell back and on what numbers", () => {
		expect(mediaBudgetNote({ files: 2, media: 4800, measured: 9000, budget: 8000 })).toBe(
			"2 files did not fit the context window and were sent as names instead (the prompt measured 9000 tokens with about 4800 of media, against a budget of 8000)."
		)
	})
})
