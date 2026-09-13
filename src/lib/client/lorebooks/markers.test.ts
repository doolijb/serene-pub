/**
 * The retrieval marker, as arithmetic.
 *
 * Three states and the third is an absence: an entry the newest run never
 * reported on gets no glyph at all, because a placeholder mark would be the
 * list asserting a decision nobody made.
 */
import { describe, expect, it } from "vitest"
import { markerFor, type EntryDecisions } from "./markers"

const decisions: EntryDecisions = { 1: "fired", 2: "considered" }

describe("markerFor", () => {
	it("marks an entry the newest run put in the prompt", () => {
		const marker = markerFor(decisions, 1)
		expect(marker?.glyph).toBe("●")
		expect(marker?.label).toBe("Fired")
	})

	it("marks an entry the newest run weighed and left out", () => {
		const marker = markerFor(decisions, 2)
		expect(marker?.glyph).toBe("○")
		expect(marker?.label).toBe("Considered")
	})

	it("marks nothing for an entry the newest run never reported on", () => {
		expect(markerFor(decisions, 3)).toBeNull()
	})

	it("marks nothing when no run has been read yet", () => {
		expect(markerFor(null, 1)).toBeNull()
		expect(markerFor({}, 1)).toBeNull()
	})

	it("says on hover what the mark is about and where the criteria are", () => {
		for (const id of [1, 2]) {
			const title = markerFor(decisions, id)!.title
			expect(title).toContain("newest run")
			expect(title).toContain("Read in?")
		}
	})

	it("gives the two states different words, not one word twice", () => {
		expect(markerFor(decisions, 1)!.title).not.toBe(
			markerFor(decisions, 2)!.title
		)
	})
})
