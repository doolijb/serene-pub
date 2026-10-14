/**
 * `stat-trail` (F2): the page asks the server for one owner's stat trail in
 * its own session — the owner, the slot and a limit passed on as they are —
 * and answers with what the server said; a malformed ask, a page with no
 * session, a refusal or a reply with no trail rejects in words.
 */
import { describe, expect, it, vi } from "vitest"
import {
	answerStatTrail,
	statTrailReplyKey,
	STAT_TRAIL_MOST
} from "./statTrail"

const changes = [
	{ messageId: 4, at: 1, from: null, to: 18, by: "model" as const }
]

describe("answerStatTrail", () => {
	it("reads the page's session for the owner's slot, and answers the trail", async () => {
		const read = vi.fn(async (ask: { sessionId: number }) => ({
			sessionId: ask.sessionId,
			trail: { changes }
		}))
		await expect(
			answerStatTrail(
				{
					owner: { kind: "session_cast", id: 11 },
					slotId: " hp ",
					limit: 5
				},
				7,
				read
			)
		).resolves.toEqual({ changes })
		expect(read).toHaveBeenCalledWith({
			sessionId: 7,
			owner: { kind: "session_cast", id: 11 },
			slotId: "hp",
			limit: 5
		})
		// No limit asked: none passed (the server's default).
		await answerStatTrail(
			{ owner: { kind: "session", id: 7 }, slotId: "weather" },
			7,
			read
		)
		expect(read).toHaveBeenLastCalledWith({
			sessionId: 7,
			owner: { kind: "session", id: 7 },
			slotId: "weather"
		})
	})

	it("refuses a malformed ask before asking the server", async () => {
		const read = vi.fn()
		const ask = (p: unknown, sessionId: number | null = 7) =>
			answerStatTrail(p as never, sessionId, read)
		await expect(
			ask({ owner: { kind: "cast_member", id: 1 }, slotId: "hp" })
		).rejects.toThrow("names its owner")
		await expect(
			ask({ owner: { kind: "session_cast", id: 1.5 }, slotId: "hp" })
		).rejects.toThrow("names its owner")
		await expect(ask({ slotId: "hp" })).rejects.toThrow("names its owner")
		await expect(
			ask({ owner: { kind: "session_cast", id: 1 }, slotId: " " })
		).rejects.toThrow("slot id")
		await expect(
			ask({
				owner: { kind: "session_cast", id: 1 },
				slotId: "hp",
				limit: 0
			})
		).rejects.toThrow("limit")
		await expect(
			ask({
				owner: { kind: "session_cast", id: 1 },
				slotId: "hp",
				limit: STAT_TRAIL_MOST + 1
			})
		).rejects.toThrow("limit")
		await expect(
			ask({ owner: { kind: "session_cast", id: 1 }, slotId: "hp" }, null)
		).rejects.toThrow("no session")
		expect(read).not.toHaveBeenCalled()
	})

	it("rejects with the server's refusal, or a reply that says nothing", async () => {
		const owner = { kind: "session_cast" as const, id: 1 }
		await expect(
			answerStatTrail({ owner, slotId: "hp" }, 7, async () => ({
				sessionId: 7,
				error: "This session is not one you are in."
			}))
		).rejects.toThrow("This session is not one you are in.")
		await expect(
			answerStatTrail({ owner, slotId: "hp" }, 7, async () => ({
				sessionId: 7
			}))
		).rejects.toThrow("did not say how the stat changed")
	})

	it("keys a reply by the token its ask carried", () => {
		expect(
			statTrailReplyKey({
				sessionId: 7,
				request: "widget-stat-trail:1:ab"
			})
		).toBe("widget-stat-trail:1:ab")
		expect(statTrailReplyKey({ sessionId: 7 })).toBeNull()
	})
})
