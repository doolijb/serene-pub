import { describe, expect, it } from "vitest"
import { fixItalicSpaces } from "./markdownToHTML"

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
