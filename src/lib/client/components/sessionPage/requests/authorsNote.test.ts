/**
 * `authors-note` / `set-authors-note` (AN1): the page reads and writes the
 * session's author's note for core's widget, through one tokened socket ask
 * each, and a refusal is the asking widget's own error.
 */
import { describe, expect, it, vi } from "vitest"
import { answerAuthorsNote, answerSetAuthorsNote, authorsNoteReplyKey, tokenedAsk } from "./authorsNote"

const answer = {
	offered: true,
	canEdit: true,
	note: { text: "Rain.", depth: 4, interval: 1, role: "system" as const },
	lastReply: null
}

describe("answerAuthorsNote", () => {
	it("reads the page's own session", async () => {
		const read = vi.fn(async () => ({ sessionId: 7, note: answer }))
		await expect(answerAuthorsNote({}, 7, read)).resolves.toEqual(answer)
		expect(read).toHaveBeenCalledWith({ sessionId: 7 })
	})

	it("rejects with the server's refusal, and with no session", async () => {
		await expect(
			answerAuthorsNote({}, 7, async () => ({ sessionId: 7, error: "This session was not found." }))
		).rejects.toThrow("This session was not found.")
		await expect(answerAuthorsNote({}, null, async () => ({ sessionId: 0 }))).rejects.toThrow(/no session/)
	})
})

describe("answerSetAuthorsNote", () => {
	const note = { text: "Rain.", depth: 2, interval: 3, role: "user" }

	it("sends the note whole, for the page's session", async () => {
		const write = vi.fn(async () => ({ sessionId: 7, note: answer }))
		await expect(answerSetAuthorsNote({ note }, 7, write)).resolves.toEqual(answer)
		expect(write).toHaveBeenCalledWith({ sessionId: 7, note })
	})

	it("refuses a malformed note before asking", async () => {
		const write = vi.fn()
		for (const bad of [
			{},
			{ note: { ...note, text: 3 } },
			{ note: { ...note, depth: -1 } },
			{ note: { ...note, interval: 0 } },
			{ note: { ...note, depth: 1.5 } },
			{ note: { ...note, role: "narrator" } }
		])
			await expect(answerSetAuthorsNote(bad, 7, write as never)).rejects.toThrow(/set-authors-note/)
		expect(write).not.toHaveBeenCalled()
	})

	it("is the owner's refusal, in the server's words", async () => {
		await expect(
			answerSetAuthorsNote({ note }, 7, async () => ({
				sessionId: 7,
				error: "Only the session's owner can change the author's note."
			}))
		).rejects.toThrow(/owner/)
	})
})

describe("tokenedAsk", () => {
	it("tokens each ask, and the reply's key is its token", async () => {
		const seen: Array<[string, unknown]> = []
		const ask = tokenedAsk<{ sessionId: number }, { sessionId: number; request?: string }>(
			{ ask: async (key, params) => (seen.push([key, params]), { sessionId: 1, request: key }) },
			"p"
		)
		const a = await ask({ sessionId: 1 })
		const b = await ask({ sessionId: 1 })
		expect(seen[0]![0]).not.toBe(seen[1]![0])
		expect(authorsNoteReplyKey(a)).toBe(seen[0]![0])
		expect(authorsNoteReplyKey(b)).toBe(seen[1]![0])
		expect(authorsNoteReplyKey({ sessionId: 1 })).toBeNull()
	})
})
