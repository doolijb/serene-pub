/**
 * The load-bearing test in this file is "serves the tunnel and localhost
 * simultaneously". PUBLIC_SOCKETS_ENDPOINT — the thing PUBLIC_URL replaces —
 * passed the tunnel case and the localhost case when each was checked on its
 * own, and failed the moment both had to be true of the same running process.
 * Asserting them in one body is what makes a regression to global-override
 * semantics impossible to miss.
 *
 * That property used to be asserted through getPublicSocketsEndpoint(), which
 * is gone: Socket.IO shares the app's HTTP server, so there is no separate
 * endpoint to advertise. The same assertions now go through
 * resolveRequestPublicOrigin(), which is the per-request, hostname-matched
 * resolution they were really exercising.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
	for (const key of [
		"PUBLIC_URL",
		"SERENE_PUB_PUBLIC_URL",
		"ORIGIN",
		"TRUSTED_PROXIES",
		"ADDRESS_HEADER",
		"HOST_HEADER",
		"PROTOCOL_HEADER",
		"SERENE_PUB_SECURE_COOKIES"
	]) {
		delete process.env[key]
	}
})

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
	vi.restoreAllMocks()
})

/**
 * @param host the Host header, i.e. what the client asked for
 * @param peer the raw TCP peer; null models an adapter that exposes no socket
 */
function eventWith(
	host: string,
	opts: {
		peer?: string | null
		headers?: Record<string, string>
		urlProtocol?: string
	} = {}
) {
	const headers = new Headers({ host, ...(opts.headers ?? {}) })
	const peer = opts.peer === undefined ? "127.0.0.1" : opts.peer
	return {
		request: new Request(`http://${host}/api/login`, {
			headers
		}),
		// Deliberately allowed to disagree with reality — several tests assert
		// that this property is NOT what drives the decision.
		url: new URL(`${opts.urlProtocol ?? "http:"}//${host}/`),
		platform:
			peer === null
				? undefined
				: { req: { socket: { remoteAddress: peer } } }
	}
}

describe("resolveRequestPublicOrigin", () => {
	test("unset — auto-detects per request from the Host header", async () => {
		const { resolveRequestPublicOrigin } = await import("./publicUrl")
		expect(resolveRequestPublicOrigin(eventWith("localhost:3000"))).toEqual(
			{ origin: "http://localhost:3000", source: "detected" }
		)
	})

	test("serves the tunnel and localhost SIMULTANEOUSLY from one variable", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { resolveRequestPublicOrigin } = await import("./publicUrl")

		// Through the proxy: the declared public origin, no port — the socket
		// connects back to this same origin, so it has to be the one a browser
		// can actually reach.
		const viaTunnel = resolveRequestPublicOrigin(
			eventWith("tunnel.example.com")
		)
		expect(viaTunnel).toEqual({
			origin: "https://tunnel.example.com",
			source: "public-url"
		})

		// Direct, same process, same env, same tick: unchanged behavior.
		expect(resolveRequestPublicOrigin(eventWith("localhost:3000"))).toEqual(
			{ origin: "http://localhost:3000", source: "detected" }
		)

		// ...and back again, to catch any caching that latches on first use.
		expect(
			resolveRequestPublicOrigin(eventWith("tunnel.example.com")).origin
		).toBe("https://tunnel.example.com")
	})

	test("an explicit port in PUBLIC_URL is preserved", async () => {
		process.env.PUBLIC_URL = "https://x.example.com:8443"
		const { resolveRequestPublicOrigin } = await import("./publicUrl")
		expect(
			resolveRequestPublicOrigin(eventWith("x.example.com:8443")).origin
		).toBe("https://x.example.com:8443")
	})

	test("a trusted proxy's forwarded protocol produces an https origin on an undeclared host", async () => {
		// The detected-source path, which is what remains now that the legacy
		// SOCKETS_HTTPS_HOSTS/SOCKETS_HTTP_MODE fallbacks are retired: no
		// PUBLIC_URL for this hostname, so scheme comes from the forwarded
		// header, believed because the peer is a trusted proxy.
		const { resolveRequestPublicOrigin } = await import("./publicUrl")
		const resolved = resolveRequestPublicOrigin(
			eventWith("other.example.com", {
				peer: "127.0.0.1",
				headers: { "x-forwarded-proto": "https" }
			})
		)
		expect(resolved.origin).toBe("https://other.example.com")
		expect(resolved.source).toBe("detected")
	})
})

describe("getConfiguredPublicUrl", () => {
	test("falls back to ORIGIN, which already means the same thing", async () => {
		process.env.ORIGIN = "https://origin.example.com"
		const { getConfiguredPublicUrl } = await import("./publicUrl")
		expect(getConfiguredPublicUrl()?.origin).toBe(
			"https://origin.example.com"
		)
	})

	test("PUBLIC_URL outranks SERENE_PUB_PUBLIC_URL outranks ORIGIN", async () => {
		process.env.ORIGIN = "https://c.example.com"
		process.env.SERENE_PUB_PUBLIC_URL = "https://b.example.com"
		process.env.PUBLIC_URL = "https://a.example.com"
		const { getConfiguredPublicUrl } = await import("./publicUrl")
		expect(getConfiguredPublicUrl()?.origin).toBe("https://a.example.com")
	})

	test("a base path is rejected with a warning, not half-honored", async () => {
		// The most likely wrong value: PUBLIC_URL means a base path in
		// CRA/Vite/Next vocabulary, so someone will eventually set "/serene".
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		process.env.PUBLIC_URL = "/serene"
		const { getConfiguredPublicUrl, resolveRequestPublicOrigin } =
			await import("./publicUrl")
		expect(getConfiguredPublicUrl()).toBeNull()
		expect(warn).toHaveBeenCalled()
		// ...and the app still works, falling back to auto-detection.
		expect(
			resolveRequestPublicOrigin(eventWith("localhost:3000")).origin
		).toBe("http://localhost:3000")
	})

	test("a non-http scheme is rejected", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
		process.env.PUBLIC_URL = "ftp://example.com"
		const { getConfiguredPublicUrl } = await import("./publicUrl")
		expect(getConfiguredPublicUrl()).toBeNull()
	})

	test("re-reads when the env changes rather than caching the first answer", async () => {
		const { getConfiguredPublicUrl } = await import("./publicUrl")
		process.env.PUBLIC_URL = "https://first.example.com"
		expect(getConfiguredPublicUrl()?.hostname).toBe("first.example.com")
		process.env.PUBLIC_URL = "https://second.example.com"
		expect(getConfiguredPublicUrl()?.hostname).toBe("second.example.com")
	})
})

describe("isRequestHttps", () => {
	test("event.url.protocol alone is NEVER enough", async () => {
		// adapter-node reports https: for plain-http requests when nothing is
		// configured. Two prior fixes in this codebase were written against
		// this property and were silent no-ops; the HSTS header was being sent
		// over plain HTTP because of it. This test exists so nobody
		// "simplifies" the check back to it.
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("localhost:3000", { urlProtocol: "https:" })
			)
		).toBe(false)
	})

	test("true for a request on the configured https PUBLIC_URL host", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { isRequestHttps } = await import("./publicUrl")
		expect(isRequestHttps(eventWith("tunnel.example.com"))).toBe(true)
	})

	test("false for a request on a DIFFERENT host than PUBLIC_URL", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { isRequestHttps } = await import("./publicUrl")
		expect(isRequestHttps(eventWith("localhost:3000"))).toBe(false)
	})

	test("x-forwarded-proto is believed from a trusted peer", async () => {
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("app.example.com", {
					peer: "127.0.0.1",
					headers: { "x-forwarded-proto": "https" }
				})
			)
		).toBe(true)
	})

	test("x-forwarded-proto is IGNORED from an untrusted peer", async () => {
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("app.example.com", {
					peer: "203.0.113.7",
					headers: { "x-forwarded-proto": "https" }
				})
			)
		).toBe(false)
	})

	test("TRUSTED_PROXIES can re-enable a public-address proxy", async () => {
		process.env.TRUSTED_PROXIES = "203.0.113.7"
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("app.example.com", {
					peer: "203.0.113.7",
					headers: { "x-forwarded-proto": "https" }
				})
			)
		).toBe(true)
	})

	test("an unresolvable peer still honors the forwarded protocol", async () => {
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("app.example.com", {
					peer: null,
					headers: { "x-forwarded-proto": "https" }
				})
			)
		).toBe(true)
	})

	test("a custom PROTOCOL_HEADER name is honored", async () => {
		process.env.PROTOCOL_HEADER = "x-scheme"
		const { isRequestHttps } = await import("./publicUrl")
		expect(
			isRequestHttps(
				eventWith("app.example.com", {
					headers: { "x-scheme": "https" }
				})
			)
		).toBe(true)
	})

	test("SERENE_PUB_SECURE_COOKIES=true declares TLS for the whole deployment", async () => {
		process.env.SERENE_PUB_SECURE_COOKIES = "true"
		const { isRequestHttps } = await import("./publicUrl")
		expect(isRequestHttps(eventWith("localhost:3000"))).toBe(true)
	})

	test("retired SOCKETS_HTTPS_HOSTS and SOCKETS_HTTP_MODE have no effect", async () => {
		// Both were socket-prefixed variables answering a question that is not
		// socket-specific. PUBLIC_URL says scheme and host together, per
		// request, which is what neither of them could do. Asserted rather than
		// merely deleted so re-adding a global protocol override has to delete
		// a test that says why it was removed.
		process.env.SOCKETS_HTTPS_HOSTS = "legacy.example.com"
		process.env.SOCKETS_HTTP_MODE = "https"
		const { isRequestHttps } = await import("./publicUrl")
		expect(isRequestHttps(eventWith("legacy.example.com"))).toBe(false)
		expect(isRequestHttps(eventWith("anything.example.com"))).toBe(false)
	})
})

describe("partial events", () => {
	test("tolerates an event with no request at all", async () => {
		// These functions sit on the cookie and login paths. The inline
		// implementations they replaced used optional chaining throughout, and
		// dropping it turned a missing header into a 500 on login. Do not
		// "tidy up" the guards in publicUrl.ts without deleting this test.
		const { isRequestHttps, resolveRequestPublicHost } = await import(
			"./publicUrl"
		)
		const bare = { url: new URL("https://example.com/api/login") }
		expect(() => isRequestHttps(bare)).not.toThrow()
		expect(isRequestHttps(bare)).toBe(false)
		expect(resolveRequestPublicHost(bare)).toBe("example.com")
	})

	test("tolerates an event with neither request nor url", async () => {
		const { isRequestHttps, resolveRequestPublicOrigin } = await import(
			"./publicUrl"
		)
		expect(isRequestHttps({})).toBe(false)
		expect(() => resolveRequestPublicOrigin({})).not.toThrow()
	})
})

describe("resolveRequestPublicHost", () => {
	test("uses the Host header by default", async () => {
		const { resolveRequestPublicHost } = await import("./publicUrl")
		expect(
			resolveRequestPublicHost(eventWith("app.example.com:3000"))
		).toBe("app.example.com")
	})

	test("honors x-forwarded-host from a trusted peer", async () => {
		const { resolveRequestPublicHost } = await import("./publicUrl")
		expect(
			resolveRequestPublicHost(
				eventWith("localhost:3000", {
					peer: "127.0.0.1",
					headers: { "x-forwarded-host": "public.example.com" }
				})
			)
		).toBe("public.example.com")
	})

	test("ignores x-forwarded-host from an untrusted peer", async () => {
		const { resolveRequestPublicHost } = await import("./publicUrl")
		expect(
			resolveRequestPublicHost(
				eventWith("localhost:3000", {
					peer: "203.0.113.7",
					headers: { "x-forwarded-host": "evil.example.com" }
				})
			)
		).toBe("localhost")
	})

	test("a spoofed x-forwarded-host cannot activate PUBLIC_URL from an untrusted peer", async () => {
		process.env.PUBLIC_URL = "https://tunnel.example.com"
		const { resolveRequestPublicOrigin } = await import("./publicUrl")
		expect(
			resolveRequestPublicOrigin(
				eventWith("localhost:3000", {
					peer: "203.0.113.7",
					headers: { "x-forwarded-host": "tunnel.example.com" }
				})
			)
		).toEqual({ origin: "http://localhost:3000", source: "detected" })
	})
})
