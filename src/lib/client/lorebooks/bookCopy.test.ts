/**
 * The name a copy is offered under.
 *
 * The prompt is pre-filled rather than blank because the reader is being shown
 * what will happen, and the suggestion has to hold for a name with stray
 * whitespace in it and for a book that has no name at all.
 */
import { describe, expect, it } from "vitest"
import { copyName } from "./bookCopy"

describe("copyName", () => {
	it("suffixes the book's own name", () => {
		expect(copyName("Umber City")).toBe("Umber City (copy)")
	})

	it("trims what it is given, so the suffix is not stranded", () => {
		expect(copyName("  The Open Door  ")).toBe("The Open Door (copy)")
	})

	it("names a nameless book rather than starting with a bracket", () => {
		expect(copyName("")).toBe("Lorebook (copy)")
		expect(copyName("   ")).toBe("Lorebook (copy)")
	})

	it("copies a copy, rather than counting them", () => {
		expect(copyName("Umber City (copy)")).toBe("Umber City (copy) (copy)")
	})
})
