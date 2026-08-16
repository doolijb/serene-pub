/**
 * The auth cookie must not be Secure over plain HTTP.
 *
 * `secure` used to be `!dev`, so every packaged build set Secure — and a Secure
 * cookie is silently discarded by the browser over http://. The desktop app
 * serves itself over exactly that, so the userToken cookie was never stored:
 * /api/socket-token found no cookie, returned {token: null}, and login appeared
 * to do nothing whatsoever. Reported against the linux-x64 0.5.0-rc-3 build.
 *
 * set and delete must agree, or logout leaves the session live — the failure
 * the delete side was already commented for.
 */
import { describe, expect, test } from "vitest"
import { setUserTokenCookie } from "./setUserTokenCookie"
import { deleteUserTokenCookie } from "./deleteUserTokenCookie"

function fakeEvent(url: string, headers: Record<string, string> = {}) {
	const calls: any[] = []
	return {
		event: {
			url: new URL(url),
			request: { headers: new Headers(headers) },
			cookies: {
				set: (name: string, value: string, opts: any) =>
					calls.push({ op: "set", name, value, opts }),
				delete: (name: string, opts: any) =>
					calls.push({ op: "delete", name, opts })
			}
		} as any,
		calls
	}
}

describe("auth cookie security follows the request scheme", () => {
	test("plain HTTP (the desktop app) does NOT get a Secure cookie", () => {
		const { event, calls } = fakeEvent("http://localhost:3000/api/login")
		setUserTokenCookie({ event, token: "t" })
		expect(calls[0].opts.secure).toBe(false)
		expect(calls[0].opts.sameSite).toBe("lax")
		// Still hardened where it costs nothing.
		expect(calls[0].opts.httpOnly).toBe(true)
	})

	test("a LAN address over HTTP also gets a storable cookie", () => {
		// localhost is a secure context in some browsers; a LAN IP is not, and
		// that is a supported way to reach the desktop app.
		const { event, calls } = fakeEvent("http://192.168.1.50:3000/api/login")
		setUserTokenCookie({ event, token: "t" })
		expect(calls[0].opts.secure).toBe(false)
	})

	test("an https:// URL alone does NOT enable Secure", () => {
		// Measured: production adapter-node reports protocol "https:" even for
		// a plain-HTTP request, so the URL is not evidence of anything. HTTPS
		// must announce itself via the proxy header or the env opt-in.
		const { event, calls } = fakeEvent("https://example.com/api/login")
		setUserTokenCookie({ event, token: "t" })
		expect(calls[0].opts.secure).toBe(false)
	})

	test("SERENE_PUB_SECURE_COOKIES=true opts a direct-TLS deployment in", () => {
		process.env.SERENE_PUB_SECURE_COOKIES = "true"
		try {
			const { event, calls } = fakeEvent("http://example.com/api/login")
			setUserTokenCookie({ event, token: "t" })
			expect(calls[0].opts.secure).toBe(true)
			expect(calls[0].opts.sameSite).toBe("strict")
		} finally {
			delete process.env.SERENE_PUB_SECURE_COOKIES
		}
	})

	test("delete mirrors set exactly, or logout silently fails", () => {
		for (const url of [
			"http://localhost:3000/x",
			"https://example.com/x"
		]) {
			const a = fakeEvent(url)
			const b = fakeEvent(url)
			setUserTokenCookie({ event: a.event, token: "t" })
			deleteUserTokenCookie({ event: b.event })
			expect(b.calls[0].opts.secure).toBe(a.calls[0].opts.secure)
			expect(b.calls[0].opts.sameSite).toBe(a.calls[0].opts.sameSite)
		}
	})

	test("an HTTPS browser behind a TLS-terminating proxy still gets Secure", () => {
		// adapter-node only sees the proxy's plain-HTTP hop, so without
		// honouring x-forwarded-proto a real HTTPS deployment would silently
		// lose Secure — the deployments that need it most.
		const { event, calls } = fakeEvent(
			"http://app.internal:3000/api/login",
			{
				"x-forwarded-proto": "https"
			}
		)
		setUserTokenCookie({ event, token: "t" })
		expect(calls[0].opts.secure).toBe(true)
		expect(calls[0].opts.sameSite).toBe("strict")
	})

	test("a comma-joined forwarded chain uses the client-facing scheme", () => {
		const { event, calls } = fakeEvent(
			"http://app.internal:3000/api/login",
			{
				"x-forwarded-proto": "https, http"
			}
		)
		setUserTokenCookie({ event, token: "t" })
		expect(calls[0].opts.secure).toBe(true)
	})

	test("0.0.0.0 and 127.0.0.1 are storable, like any other plain-HTTP host", () => {
		for (const host of ["http://0.0.0.0:3000", "http://127.0.0.1:3000"]) {
			const { event, calls } = fakeEvent(host + "/api/login")
			setUserTokenCookie({ event, token: "t" })
			expect(calls[0].opts.secure, host).toBe(false)
		}
	})
})
