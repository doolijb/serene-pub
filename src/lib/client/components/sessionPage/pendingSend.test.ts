import { describe, expect, it, vi } from "vitest"
import {
	createPendingSend,
	PENDING_SEND_TIMEOUT_MS,
	SEND_UNANSWERED
} from "./pendingSend"

/** A composer whose box the test drives. */
function harness() {
	let box = ""
	const said: string[] = []
	const landed: number[] = []
	const send = createPendingSend({
		restore: (c) => (box = c),
		draft: () => box,
		landed: (id) => landed.push(id),
		say: (s) => said.push(s)
	})
	return {
		send,
		said,
		landed,
		get box() {
			return box
		},
		type(c: string) {
			box = c
		}
	}
}

const row = { id: 9, role: "user", userId: 1, content: "hello", sessionId: 7 }

describe("pendingSend — the draft across a Send", () => {
	it("keeps the text until the answer carries the saved row", () => {
		const h = harness()
		expect(h.send.start(7, "hello", 1)).toBe(true)
		expect(h.send.inFlight).toBe(true)
		h.send.answer({ sessionId: 7, accepted: true, runId: "r", sessionMessage: row })
		expect(h.send.inFlight).toBe(false)
		expect(h.landed).toEqual([7])
		expect(h.box).toBe("")
		expect(h.said).toEqual([])
	})

	it("an answer that only accepts waits for the push", () => {
		const h = harness()
		h.send.start(7, "hello", 1)
		h.send.answer({ sessionId: 7, accepted: true, runId: "r" })
		expect(h.send.inFlight).toBe(true)
		h.send.pushed({ ...row, content: "something else" })
		h.send.pushed({ ...row, userId: 2 })
		h.send.pushed({ ...row, sessionId: 8 })
		expect(h.send.inFlight).toBe(true)
		h.send.pushed(row)
		expect(h.send.inFlight).toBe(false)
		expect(h.landed).toEqual([7])
	})

	it("a refusal gives the text back and says the sentence once", () => {
		const h = harness()
		h.send.start(7, "hello", 1)
		h.send.answer({ sessionId: 7, refused: "The Planner is listening only to the party." })
		expect(h.box).toBe("hello")
		expect(h.said).toEqual(["The Planner is listening only to the party."])
		expect(h.landed).toEqual([])
		// A late push for the refused text changes nothing.
		h.send.pushed(row)
		expect(h.landed).toEqual([])
	})

	it("an error gives the text back silently — the app-wide catch-all says it", () => {
		const h = harness()
		h.send.start(7, "hello", 1)
		h.send.answer({ sessionId: 7, error: "Failed to send message", refused: "x" })
		expect(h.box).toBe("hello")
		expect(h.said).toEqual([])
	})

	it("text typed since is kept, after the given-back text", () => {
		const h = harness()
		h.send.start(7, "hello", 1)
		h.type("and more")
		h.send.answer({ sessionId: 7, refused: "no" })
		expect(h.box).toBe("hello\n\nand more")
	})

	it("no answer within the timeout gives the text back", () => {
		vi.useFakeTimers()
		try {
			const h = harness()
			h.send.start(7, "hello", 1)
			vi.advanceTimersByTime(PENDING_SEND_TIMEOUT_MS - 1)
			expect(h.box).toBe("")
			vi.advanceTimersByTime(1)
			expect(h.box).toBe("hello")
			expect(h.said).toEqual([SEND_UNANSWERED])
			expect(h.send.inFlight).toBe(false)
		} finally {
			vi.useRealTimers()
		}
	})

	it("one send at a time; another session's answer is not this one's", () => {
		const h = harness()
		expect(h.send.start(7, "hello", 1)).toBe(true)
		expect(h.send.start(7, "again", 1)).toBe(false)
		h.send.answer({ sessionId: 8, refused: "no" })
		expect(h.send.inFlight).toBe(true)
		h.send.drop()
		expect(h.send.inFlight).toBe(false)
		expect(h.box).toBe("")
	})
})
