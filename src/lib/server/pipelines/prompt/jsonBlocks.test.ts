/**
 * What a JSON step is allowed to see of the conversation.
 *
 * A model imitates the last thing it read. When a planner's answer lands inside
 * a reply, the next turn's planner reads its own schema back out of the
 * transcript and the keeper reads it too — which is how a state keeper came to
 * answer with `{beats, speakers, worldHints}` and change nothing at all.
 *
 * So the JSON steps read the conversation as prose. This is the cut, and it is
 * a pure function because the rule has edges: a brace inside a sentence is not a
 * block, and a message that was nothing but a block has no prose left in it.
 */

import { describe, it, expect } from "vitest"
import { stripJsonBlocks } from "./jsonBlocks"

describe("stripJsonBlocks", () => {
	it("leaves ordinary prose alone", () => {
		const prose =
			"*looks up from a dusty tome* Ah, Jody. The bell has rung thrice."
		expect(stripJsonBlocks(prose)).toBe(prose)
	})

	it("removes a bare JSON array appended after the prose", () => {
		const text =
			'Verity closes the book.\n\n[{"beats": ["one"], "needsLookup": false}]'
		expect(stripJsonBlocks(text)).toBe("Verity closes the book.")
	})

	it("removes a bare JSON object appended after the prose", () => {
		const text = 'She nods.\n\n{"changes": [{"owner": "Wren"}]}'
		expect(stripJsonBlocks(text)).toBe("She nods.")
	})

	it("removes a fenced json block wherever it sits", () => {
		const text =
			'Wren draws the bolt.\n\n```json\n{"beats": ["bolt drawn"]}\n```\n\nMarrow waits.'
		expect(stripJsonBlocks(text)).toBe(
			"Wren draws the bolt.\n\nMarrow waits."
		)
	})

	it("removes an unlabelled fence whose body is JSON", () => {
		const text = 'Marrow shrugs.\n\n```\n{"speakers": []}\n```'
		expect(stripJsonBlocks(text)).toBe("Marrow shrugs.")
	})

	it("keeps a fenced block that is not JSON", () => {
		const text = "Wren reads aloud.\n\n```\nthe bell rang thrice\n```"
		expect(stripJsonBlocks(text)).toBe(text)
	})

	it("keeps braces inside a sentence", () => {
		const text = "He muttered {something} and left."
		expect(stripJsonBlocks(text)).toBe(text)
	})

	it("keeps a line that merely opens a brace", () => {
		const text = "Verity wrote:\n{ and then stopped"
		expect(stripJsonBlocks(text)).toBe(text)
	})

	it("empties a message that was nothing but a block", () => {
		expect(stripJsonBlocks('{"beats": []}')).toBe("")
		expect(stripJsonBlocks('```json\n{"beats": []}\n```')).toBe("")
	})

	it("removes a block sitting between two paragraphs", () => {
		const text =
			'Wren steps back.\n\n{"worldHints": {"weather": "fog"}}\n\nMarrow does not.'
		expect(stripJsonBlocks(text)).toBe(
			"Wren steps back.\n\nMarrow does not."
		)
	})

	it("is a no-op on an empty string", () => {
		expect(stripJsonBlocks("")).toBe("")
	})

	it("keeps a bare scalar that happens to parse as JSON", () => {
		// `42` and `"fog"` parse, and neither is a block somebody pasted — only
		// an object or an array is the shape this cut is about.
		expect(stripJsonBlocks("Verity counts.\n\n42")).toBe(
			"Verity counts.\n\n42"
		)
	})
})
