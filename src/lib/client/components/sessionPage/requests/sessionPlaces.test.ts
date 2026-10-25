/**
 * `session-places` (W4): the page reads the session's places and ways for
 * core's Places widget through one tokened `sessions:places` ask, and a
 * refusal is the asking widget's own error.
 */
import { describe, expect, it, vi } from "vitest"
import type { SessionPlacesV1 } from "@serene-pub/sdk"
import { answerSessionPlaces, sessionPlacesReplyKey } from "./sessionPlaces"

const places: SessionPlacesV1 = {
	lorebookId: 4,
	asOf: { year: 412 },
	places: [
		{ id: 1, name: "The Guardroom", category: null, tint: null, linked: [] }
	],
	ways: []
}

describe("answerSessionPlaces", () => {
	it("reads the page's own session, whatever the params say", async () => {
		const read = vi.fn(async () => ({ sessionId: 7, places }))
		await expect(
			answerSessionPlaces({ sessionId: 99 }, 7, read)
		).resolves.toEqual(places)
		expect(read).toHaveBeenCalledWith({ sessionId: 7 })
	})

	it("rejects with the server's refusal, an answer that says nothing, and with no session", async () => {
		await expect(
			answerSessionPlaces({}, 7, async () => ({
				sessionId: 7,
				error: "This session is not one you are in."
			}))
		).rejects.toThrow("This session is not one you are in.")
		await expect(
			answerSessionPlaces({}, 7, async () => ({ sessionId: 7 }))
		).rejects.toThrow(/did not say/)
		const read = vi.fn()
		await expect(
			answerSessionPlaces({}, null, read as never)
		).rejects.toThrow(/no session/)
		expect(read).not.toHaveBeenCalled()
	})

	it("🚧 names the own book when the reply names none; a shared book stays; no own book stays null", async () => {
		const noBook = { ...places, lorebookId: null }
		const read = async () => ({ sessionId: 7, places: noBook })
		await expect(answerSessionPlaces({}, 7, read, 9)).resolves.toEqual({
			...noBook,
			lorebookId: 9
		})
		await expect(
			answerSessionPlaces({}, 7, async () => ({ sessionId: 7, places }), 9)
		).resolves.toEqual(places)
		await expect(answerSessionPlaces({}, 7, read)).resolves.toEqual(noBook)
	})

	it("keys a reply by the token its ask carried", () => {
		expect(
			sessionPlacesReplyKey({
				sessionId: 7,
				request: "widget-places:1:x"
			})
		).toBe("widget-places:1:x")
		expect(sessionPlacesReplyKey({ sessionId: 7 })).toBeNull()
	})
})
