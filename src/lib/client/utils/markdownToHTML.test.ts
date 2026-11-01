import { describe, expect, it } from "vitest"
import { fixItalicSpaces, withoutOpenComment } from "./markdownToHTML"

describe("fixItalicSpaces", () => {
	it("keeps the space before every italic span", () => {
		expect(fixItalicSpaces("and she *was here*, and she *was not*.")).toBe(
			"and she *was here*, and she *was not*."
		)
		expect(fixItalicSpaces("*a* b *c* d *e*")).toBe("*a* b *c* d *e*")
	})

	it("trims trailing whitespace inside an italic span", () => {
		expect(fixItalicSpaces("she *was here *, ok")).toBe("she *was here*, ok")
	})

	it("leaves bold untouched", () => {
		expect(fixItalicSpaces("**bold** and *it*")).toBe("**bold** and *it*")
	})
})

describe("withoutOpenComment (a reply streaming its hidden draft block, M2c)", () => {
	it("cuts a comment still being written, and leaves a finished one and plain text alone", () => {
		expect(withoutOpenComment('Here is Mira.\n\n<!--draft:character {"name": "Mi')).toBe("Here is Mira.\n\n")
		expect(withoutOpenComment('Here is Mira.<!--draft:character {"name": "Mira"}-->')).toBe('Here is Mira.<!--draft:character {"name": "Mira"}-->')
		expect(withoutOpenComment("a <b> c --> d")).toBe("a <b> c --> d")
	})
})
