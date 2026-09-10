import { describe, expect, test } from "vitest"
import {
	NOTE_PREVIEW_LIMIT,
	noteIsTruncated,
	normalizeNote,
	notePreview
} from "./connectionNotes"

describe("notePreview", () => {
	test("nothing to show reads as an empty string, whatever 'nothing' was", () => {
		expect(notePreview(null)).toBe("")
		expect(notePreview(undefined)).toBe("")
		expect(notePreview("")).toBe("")
		expect(notePreview("   \n\t  ")).toBe("")
	})

	test("a short note is returned as written", () => {
		expect(notePreview("Use for prose")).toBe("Use for prose")
	})

	test("newlines and runs of whitespace collapse to single spaces", () => {
		// The point of the collapse: a native <option> is single-line, so a
		// pasted paragraph break must not silently weld two words together
		// or leave the row measuring lines nobody asked for.
		expect(notePreview("Use for prose.\n\nNot for extraction.")).toBe(
			"Use for prose. Not for extraction."
		)
		expect(notePreview("  a\t\tb  \r\n c ")).toBe("a b c")
	})

	test("a note exactly at the limit is not truncated", () => {
		const exact = "x".repeat(NOTE_PREVIEW_LIMIT)
		expect(notePreview(exact)).toBe(exact)
		expect(notePreview(exact)).not.toContain("…")
	})

	test("one character over the limit truncates", () => {
		const over = "x".repeat(NOTE_PREVIEW_LIMIT + 1)
		const out = notePreview(over)
		expect(out.endsWith("…")).toBe(true)
		expect(out.length).toBeLessThanOrEqual(NOTE_PREVIEW_LIMIT + 1)
	})

	test("truncation prefers a word boundary near the limit", () => {
		const note = `${"word ".repeat(40)}tail`
		const out = notePreview(note)
		expect(out.endsWith("…")).toBe(true)
		// Cut between words, so no half-word is left before the ellipsis.
		expect(out).not.toMatch(/wor…$/)
		expect(out).toMatch(/word…$/)
	})

	test("an unbroken paste has no boundary to find and is cut flat", () => {
		// The realistic worst case: a pasted URL or base64 blob with no space
		// in it at all. Honouring 'cut at a space' here would return the empty
		// string, which is worse than a hard cut.
		const blob = "a".repeat(4000)
		const out = notePreview(blob)
		expect(out).toBe(`${"a".repeat(NOTE_PREVIEW_LIMIT)}…`)
	})

	test("a boundary far from the limit is ignored rather than gutting the preview", () => {
		// One early space then a long unbroken run: cutting at the space would
		// throw away nearly the whole budget to avoid clipping one token.
		const note = `hi ${"z".repeat(4000)}`
		const out = notePreview(note)
		expect(out.length).toBe(NOTE_PREVIEW_LIMIT + 1)
		expect(out.startsWith("hi zzz")).toBe(true)
	})

	test("no trailing space is left sitting in front of the ellipsis", () => {
		const note = `${"word ".repeat(40)}tail`
		expect(notePreview(note)).not.toContain(" …")
	})

	test("the limit is a parameter, and the collapse happens before it applies", () => {
		expect(notePreview("alpha\nbeta gamma", 10)).toBe("alpha beta…")
	})

	test("the whole 4000-character column cap survives a preview", () => {
		const maxNote = "lorem ipsum ".repeat(400).slice(0, 4000)
		const out = notePreview(maxNote)
		expect(out.length).toBeLessThanOrEqual(NOTE_PREVIEW_LIMIT + 1)
	})
})

describe("noteIsTruncated", () => {
	test("false when there is nothing to truncate", () => {
		expect(noteIsTruncated(null)).toBe(false)
		expect(noteIsTruncated("   ")).toBe(false)
		expect(noteIsTruncated("short")).toBe(false)
	})

	test("measures the collapsed note, not the raw one", () => {
		// Fifty one-letter words separated by double newlines: 148 characters
		// raw, 99 once collapsed. The row shows all of it, so nothing is
		// hidden and nothing needs offering elsewhere.
		const airy = Array.from({ length: 50 }, () => "a").join("\n\n")
		expect(airy.length).toBeGreaterThan(NOTE_PREVIEW_LIMIT)
		expect(noteIsTruncated(airy)).toBe(false)
	})

	test("true exactly when the preview is not the whole note", () => {
		expect(noteIsTruncated("x".repeat(NOTE_PREVIEW_LIMIT))).toBe(false)
		expect(noteIsTruncated("x".repeat(NOTE_PREVIEW_LIMIT + 1))).toBe(true)
	})
})

describe("normalizeNote", () => {
	test("blank in every spelling stores as NULL, so there is only one", () => {
		expect(normalizeNote(null)).toBe(null)
		expect(normalizeNote(undefined)).toBe(null)
		expect(normalizeNote("")).toBe(null)
		expect(normalizeNote("  \n ")).toBe(null)
	})

	test("real text is trimmed but otherwise kept verbatim", () => {
		// Interior newlines survive: the note is the user's prose, and only
		// the DISPLAY collapses it.
		expect(normalizeNote("  prose\n\nnot extraction  ")).toBe(
			"prose\n\nnot extraction"
		)
	})
})
