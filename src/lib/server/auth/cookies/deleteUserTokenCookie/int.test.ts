import { expect, test, vi } from "vitest"
import { deleteUserTokenCookie } from "."
import type { RequestEvent } from "@sveltejs/kit"

const eventForHttps = (deleteMock: any) =>
	({
		url: new URL("https://example.com/logout"),
		request: { headers: new Headers({ "x-forwarded-proto": "https" }) },
		cookies: { delete: deleteMock }
	}) as unknown as RequestEvent

const eventFor = (url: string, deleteMock: any) =>
	({
		url: new URL(url),
		cookies: { delete: deleteMock }
	}) as unknown as RequestEvent

test("deleteUserTokenCookie: mirrors set's attributes on HTTPS", () => {
	const deleteMock = vi.fn()
	deleteUserTokenCookie({
		event: eventForHttps(deleteMock)
	})
	expect(deleteMock).toHaveBeenCalledWith("userToken", {
		path: "/",
		httpOnly: true,
		secure: true,
		sameSite: "strict"
	})
})

test("deleteUserTokenCookie: over plain HTTP, matches the non-secure cookie that was set", () => {
	// A Secure-flagged deletion is discarded over http:// just as a Secure
	// Set-Cookie is, so a mismatch here leaves the session live after logout.
	const deleteMock = vi.fn()
	deleteUserTokenCookie({
		event: eventFor("http://localhost:3000/logout", deleteMock)
	})
	expect(deleteMock).toHaveBeenCalledWith("userToken", {
		path: "/",
		httpOnly: true,
		secure: false,
		sameSite: "lax"
	})
})
