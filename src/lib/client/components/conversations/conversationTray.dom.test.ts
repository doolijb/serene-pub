import { describe, expect, it } from "vitest"
import { inbound, outbound } from "./conversationTray.svelte"

describe("conversation tray scope translation", () => {
	it("sends the scope as conversationId", () => {
		expect(outbound({ sessionId: 12, filename: "a.png" })).toEqual({
			conversationId: 12,
			filename: "a.png"
		})
		expect(outbound({ trayItemId: "t1" })).toEqual({ trayItemId: "t1" })
	})

	it("reads a conversation reply as the tray's scope", () => {
		expect(inbound({ conversationId: 12, trayItemId: "t1" })).toEqual({
			conversationId: 12,
			sessionId: 12,
			trayItemId: "t1"
		})
	})

	it("never mistakes a session tray's reply for a conversation's", () => {
		const read = inbound({ sessionId: 12, trayItemId: "t1" }) as Record<string, unknown>
		expect(read.sessionId).toBeUndefined()
		expect(read.trayItemId).toBe("t1")
	})
})
