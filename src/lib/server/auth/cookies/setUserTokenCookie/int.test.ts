import { afterEach, describe, expect, test, vi } from "vitest"
import type { RequestEvent } from "@sveltejs/kit"

// maxAge is still computed from process.env at module load, so those tests
// re-import fresh. secure/sameSite no longer are: they follow the REQUEST
// SCHEME now, because deriving them from NODE_ENV meant every packaged build
// set Secure — and a Secure cookie is silently discarded over plain HTTP,
// which is how the desktop app serves itself. Login stored no cookie and
// appeared to do nothing at all.
describe("setUserTokenCookie", () => {
	const originalEnv = { ...process.env }

	afterEach(() => {
		process.env = { ...originalEnv }
		vi.resetModules()
	})

	// HTTPS is signalled by the proxy header, never by the URL — see
	// cookieSecurity(). A production adapter-node build reports "https:" for
	// plain-HTTP requests, so the URL cannot be trusted.
	const eventForHttps = (setMock: any) =>
		({
			url: new URL("https://example.com/api/login"),
			request: { headers: new Headers({ "x-forwarded-proto": "https" }) },
			cookies: { set: setMock }
		}) as unknown as RequestEvent

	const eventFor = (url: string, setMock: any) =>
		({
			url: new URL(url),
			cookies: { set: setMock }
		}) as unknown as RequestEvent

	test("maxAge is derived from USER_TOKEN_EXPIRATION_HOURS", async () => {
		process.env.USER_TOKEN_EXPIRATION_HOURS = "12"
		vi.resetModules()
		const { setUserTokenCookie } = await import("./index")

		const setMock = vi.fn()
		setUserTokenCookie({
			event: eventForHttps(setMock),
			token: "testToken"
		})

		expect(setMock).toHaveBeenCalledWith("userToken", "testToken", {
			path: "/",
			httpOnly: true,
			secure: true,
			sameSite: "strict",
			maxAge: 60 * 60 * 12
		})
	})

	test("HTTPS gets a strict/secure cookie", async () => {
		process.env.USER_TOKEN_EXPIRATION_HOURS = "24"
		vi.resetModules()
		const { setUserTokenCookie } = await import("./index")

		const setMock = vi.fn()
		setUserTokenCookie({
			event: eventForHttps(setMock),
			token: "testToken"
		})

		expect(setMock.mock.calls[0][2]).toMatchObject({
			secure: true,
			sameSite: "strict",
			maxAge: 60 * 60 * 24
		})
	})

	test("plain HTTP gets a storable, non-secure cookie regardless of NODE_ENV", async () => {
		// The regression: NODE_ENV=production over http:// used to produce a
		// Secure cookie the browser threw away.
		process.env.NODE_ENV = "production"
		process.env.USER_TOKEN_EXPIRATION_HOURS = "24"
		vi.resetModules()
		const { setUserTokenCookie } = await import("./index")

		const setMock = vi.fn()
		setUserTokenCookie({
			event: eventFor("http://localhost:3000/api/login", setMock),
			token: "testToken"
		})

		expect(setMock.mock.calls[0][2]).toMatchObject({
			secure: false,
			sameSite: "lax",
			httpOnly: true
		})
	})
})
