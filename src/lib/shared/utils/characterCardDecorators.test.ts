import { describe, expect, test } from "vitest"
import { stripCardDecorators } from "./characterCardDecorators"

describe("stripCardDecorators", () => {
	test("strips a single @@decorator line and its parsed value", () => {
		const { content, decorators } = stripCardDecorators(
			"@@position before_char\nActual content"
		)
		expect(content).toBe("Actual content")
		expect(decorators).toEqual([
			{ name: "position", value: "before_char", fallback: false }
		])
	})

	test("strips a multi-decorator block with no trailing blank-line artifact", () => {
		const { content, decorators } = stripCardDecorators(
			"@@dont_activate\n@@depth 5\n\nActual content"
		)
		expect(content).toBe("Actual content")
		expect(decorators).toEqual([
			{ name: "dont_activate", value: "", fallback: false },
			{ name: "depth", value: "5", fallback: false }
		])
	})

	test("strips a @@@ fallback-chain line alongside its primary decorator", () => {
		const { content, decorators } = stripCardDecorators(
			"@@primary value\n@@@fallback value\nActual content"
		)
		expect(content).toBe("Actual content")
		expect(decorators).toEqual([
			{ name: "primary", value: "value", fallback: false },
			{ name: "fallback", value: "value", fallback: true }
		])
	})

	test("leaves ordinary text and mid-line @@ usage untouched", () => {
		const text = "Contact: user@@example.com\nNormal paragraph text."
		const { content, decorators } = stripCardDecorators(text)
		expect(content).toBe(text)
		expect(decorators).toEqual([])
	})

	test("only swallows one directly-adjacent blank line per side, not the author's own spacing", () => {
		const { content } = stripCardDecorators("@@depth 5\n\n\nActual content")
		// One blank line closes the gap the decorator block created; the
		// second blank line is the author's own paragraph spacing.
		expect(content).toBe("\nActual content")
	})

	test("empty content returns unchanged with no decorators", () => {
		expect(stripCardDecorators("")).toEqual({ content: "", decorators: [] })
	})
})
