import { describe, expect, it } from "vitest"
import { curlyQuotes } from "./curlyQuotes"

describe("curlyQuotes", () => {
	it("pairs two quoted spans", () => {
		expect(curlyQuotes('"Stay a while," she said. "Please."')).toBe(
			"“Stay a while,” she said. “Please.”"
		)
	})
	it("turns an apostrophe curly", () => {
		expect(curlyQuotes("it's")).toBe("it’s")
	})
	it("opens a single quote after a space", () => {
		expect(curlyQuotes("say 'hi'")).toBe("say ‘hi’")
	})
	it("leaves text without quotes alone", () => {
		expect(curlyQuotes("Stay a while.")).toBe("Stay a while.")
	})
	it("a filled Say it as… preview: the line's quote right after the template's opens", () => {
		expect(curlyQuotes('“"Stay a while," she said.” — said with joy')).toBe(
			"““Stay a while,” she said.” — said with joy"
		)
	})
	it("leaves curly text alone", () => {
		const s = "“Stay,” it’s fine"
		expect(curlyQuotes(s)).toBe(s)
	})
})
