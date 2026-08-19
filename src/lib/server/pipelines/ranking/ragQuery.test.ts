/**
 * The query windows, and how a message is written when it is a query.
 *
 * Small surface, and two of its three rules are only visible in edge cases that
 * a chat exercises constantly: a participant who left, and a chat shorter than
 * the window.
 */

import { describe, it, expect } from "vitest"
import {
	formatMessageForQuery,
	queryWindows
} from "$lib/server/utils/promptBuilder/ragQuery"

const cast = {
	chatCharacters: [
		{ character: { id: 1, name: "Alice", nickname: "The Knight" } }
	],
	chatPersonas: [{ persona: { id: 1, name: "Bob" } }],
	removedChatCharacters: [
		{
			characterId: 9,
			character: { id: 9, name: "Gone" },
			removedName: "Departed"
		}
	]
}

describe("formatting a message as a query", () => {
	it("attributes the speaker, because retrieval is about who said what", () => {
		expect(
			formatMessageForQuery(
				{
					role: "assistant",
					content: "The wall fell.",
					characterId: 1
				},
				cast
			)
		).toBe("[The Knight]: The wall fell.")
	})

	it("prefers a nickname, matching how the chat displays them", () => {
		const out = formatMessageForQuery(
			{ characterId: 1, content: "x" },
			cast
		)
		expect(out.startsWith("[The Knight]")).toBe(true)
	})

	it("names a participant who has since left", () => {
		// Otherwise every line they ever said embeds as though nobody said it,
		// and a chat with turnover slowly loses its own history to retrieval.
		expect(
			formatMessageForQuery(
				{ characterId: 9, content: "I was here." },
				cast
			)
		).toBe("[Gone]: I was here.")
	})

	it("falls back to the role rather than to nothing", () => {
		expect(
			formatMessageForQuery({ role: "user", content: "hi" }, cast)
		).toBe("[user]: hi")
	})

	it("strips emphasis markers, which move the vector and mean nothing", () => {
		expect(
			formatMessageForQuery(
				{ role: "user", content: "*the wall fell*" },
				cast
			)
		).toBe("[user]: the wall fell")
	})
})

describe("the two windows", () => {
	const msgs = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			role: "user",
			content: `m${i}`
		}))
	const params = { currentWindow: 2, recentWindow: 3 }

	it("splits current from recent without overlapping", () => {
		const { current, recent } = queryWindows(msgs(10), cast, params)
		expect(current).toEqual(["[user]: m8", "[user]: m9"])
		expect(recent).toEqual(["[user]: m5", "[user]: m6", "[user]: m7"])
	})

	it("gives back what exists when the chat is shorter than the windows", () => {
		const { current, recent } = queryWindows(msgs(3), cast, params)
		expect(current).toEqual(["[user]: m1", "[user]: m2"])
		expect(recent).toEqual(["[user]: m0"])
	})

	it("has an empty recent window on a brand-new chat", () => {
		const { current, recent } = queryWindows(msgs(1), cast, params)
		expect(current).toEqual(["[user]: m0"])
		expect(recent).toEqual([])
	})

	it("does not embed the whole history when a window is set to zero", () => {
		// `slice(-0)` is `slice(0)` — the whole array. So a zero window read as
		// "every message, one query each", which is the opposite of what zero
		// means and expensive enough to present as a hang. These are
		// user-facing parameters now, so zero is a value someone will type.
		const { current, recent } = queryWindows(msgs(5), cast, {
			currentWindow: 0,
			recentWindow: 2
		})
		expect(current).toEqual([])
		expect(recent).toEqual(["[user]: m3", "[user]: m4"])
	})

	it("asks nothing at all when both windows are zero", () => {
		const { current, recent } = queryWindows(msgs(5), cast, {
			currentWindow: 0,
			recentWindow: 0
		})
		expect(current).toEqual([])
		expect(recent).toEqual([])
	})
})
