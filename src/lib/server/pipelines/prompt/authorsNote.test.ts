/**
 * The author's note (AN1): read off a genre field, placed by the same index
 * arithmetic as the post-history block and inject scripts, gated by its
 * interval and never by a token trigger.
 */
import { describe, expect, it } from "vitest"
import {
	readAuthorsNoteValue,
	resolveAuthorsNoteContext
} from "./authorsNote"
import { resolveInjections } from "./assemble"

/** Three real messages and the seed placeholder, oldest first. */
const messages = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: -2 }]

describe("readAuthorsNoteValue", () => {
	it("reads an object, filling the declared defaults", () => {
		// Placed text defaults to the end of the transcript (owner ruling 2026-10-03).
		expect(readAuthorsNoteValue({ text: "Rain." })).toEqual({
			text: "Rain.",
			depth: 0,
			interval: 1,
			role: "system"
		})
	})

	it("reads numbers a form posted as text, and clamps them", () => {
		expect(
			readAuthorsNoteValue({ text: "x", depth: "2", interval: "0", role: "user" })
		).toEqual({ text: "x", depth: 2, interval: 1, role: "user" })
		expect(readAuthorsNoteValue({ depth: -3, role: "narrator" })).toMatchObject({
			depth: 0,
			role: "system"
		})
	})

	it("is not a plugin's text field of the same name", () => {
		expect(readAuthorsNoteValue("Keep it tense.")).toBeNull()
		expect(readAuthorsNoteValue(undefined)).toBeNull()
		expect(readAuthorsNoteValue(["a"])).toBeNull()
	})
})

describe("resolveAuthorsNoteContext", () => {
	const note = { text: "It is raining.", depth: 2, interval: 1, role: "system" as const }

	it("lands where an injection of the same depth lands", () => {
		const { authorsNote, diagnostics } = resolveAuthorsNoteContext({
			renderMessages: messages,
			note,
			replyCount: 5
		})
		const injected = resolveInjections([{ content: "x", depth: 2 }], messages.length)
		expect(Object.keys(injected)).toEqual([String(authorsNote.targetIndex)])
		expect(authorsNote).toEqual({
			targetIndex: 1,
			text: "It is raining.",
			role: "system",
			hasContent: true
		})
		expect(diagnostics).toMatchObject({ included: true, reason: "included", targetIndex: 1 })
	})

	it("clamps an over-deep note to the top rather than dropping it", () => {
		const { authorsNote } = resolveAuthorsNoteContext({
			renderMessages: messages,
			note: { ...note, depth: 40 },
			replyCount: 0
		})
		expect(authorsNote.targetIndex).toBe(0)
		expect(authorsNote.hasContent).toBe(true)
	})

	it("goes in on every interval-th reply, the first included", () => {
		const at = (replyCount: number) =>
			resolveAuthorsNoteContext({
				renderMessages: messages,
				note: { ...note, interval: 3 },
				replyCount
			})
		expect([0, 1, 2, 3, 4, 5, 6].map((n) => at(n).authorsNote.hasContent)).toEqual([
			true,
			false,
			false,
			true,
			false,
			false,
			true
		])
		expect(at(1).diagnostics).toMatchObject({ included: false, reason: "interval", replyCount: 1 })
		expect(at(1).authorsNote.text).toBeUndefined()
	})

	it("adds nothing for an empty note, and says so", () => {
		const { authorsNote, diagnostics } = resolveAuthorsNoteContext({
			renderMessages: messages,
			note: { ...note, text: "  " },
			replyCount: 0
		})
		expect(authorsNote.hasContent).toBe(false)
		expect(diagnostics.reason).toBe("empty")
	})

	it("has no token trigger: a one-message session gets it", () => {
		const { authorsNote } = resolveAuthorsNoteContext({
			renderMessages: [{ id: -2 }],
			note: { ...note, depth: 0 },
			replyCount: undefined
		})
		expect(authorsNote).toMatchObject({ targetIndex: 0, hasContent: true })
	})
})
