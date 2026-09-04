/**
 * Asserts the CSP directives that FEATURES depend on, as declared in
 * svelte.config.js.
 *
 * csp.test.ts covers mergeCspExtras() against synthetic headers — it never
 * reads the real config, so nothing checked that the directives the app
 * actually ships still permit what the app actually does. A shipped build
 * proved why that matters: narrowing `connect-src` to `ws: wss:` during the
 * single-listener socket work silently emptied the community character
 * library. Every card was blocked with "Refused to connect because it
 * violates the document's Content Security Policy", the grid rendered zero
 * <img> elements, and the whole suite stayed green.
 *
 * The trap is that the library does NOT load card art with
 * <img src="https://...">. RetryableImage.svelte fetch()es the PNG, converts
 * it with response.blob(), and hands the <img> a blob: URL — so the request
 * is governed by `connect-src`, not `img-src`. `img-src` listing "https:"
 * (and even raw.githubusercontent.com explicitly) cannot cover it, which is
 * exactly why the regression was invisible to inspection of the obvious
 * directive.
 */

import { describe, expect, test } from "vitest"
import config from "../../../../svelte.config.js"

/** The declared sources for one directive, as a flat array of strings. */
function directive(name: string): string[] {
	const directives = (config as any)?.kit?.csp?.directives
	expect(
		directives,
		"svelte.config.js should declare kit.csp.directives"
	).toBeTruthy()
	const value = directives[name]
	expect(value, `CSP should declare a "${name}" directive`).toBeTruthy()
	return value as string[]
}

describe("shipped CSP directives", () => {
	test("connect-src permits the community library host, because RetryableImage fetches card art rather than using <img src>", () => {
		// If this fails, the character library is broken: cards fetch from
		// raw.githubusercontent.com (see $lib/shared/library/imageUrlFor) and a
		// blocked fetch renders an empty grid with no <img> at all. Adding the
		// host to img-src does NOT fix it — see this file's header.
		expect(directive("connect-src")).toContain(
			"https://raw.githubusercontent.com"
		)
	})

	test("connect-src permits the websocket schemes Socket.IO upgrades to", () => {
		const connectSrc = directive("connect-src")
		expect(connectSrc).toContain("ws:")
		expect(connectSrc).toContain("wss:")
	})

	test("connect-src permits same-origin, which is what the socket handshake and the CharaVault image proxy rely on", () => {
		// Socket.IO shares the app server, so its handshake is same-origin;
		// CharaVault art is proxied through /library/cardImage/charavault/
		// because charavault.net sends Cross-Origin-Resource-Policy.
		expect(directive("connect-src")).toContain("self")
	})

	test("img-src permits blob:, which is what every fetched card portrait is finally rendered from", () => {
		// RetryableImage sets the <img> src to a URL.createObjectURL() result.
		// Without blob: the fetch would succeed and the image still would not
		// render.
		expect(directive("img-src")).toContain("blob:")
	})
})
