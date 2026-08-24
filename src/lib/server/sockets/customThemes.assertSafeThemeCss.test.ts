/**
 * Round-9 audit fix (LOW): custom theme CSS had no server-side content
 * validation — @import and an external url(...) are classic CSS-based
 * data-exfiltration vectors. style-src stays a tight fixed list, but
 * img-src deliberately allows any "https:" host (inline session images need
 * that — see svelte.config.js), so CSP alone no longer neutralizes this for
 * images — assertSafeThemeCss's rejection is the actual defense here.
 * Rejects (not silently strips) either, called right after
 * stripDataThemeWrapper in customThemesSave.
 */
import { describe, expect, test, vi } from "vitest"
import { assertSafeThemeCss } from "./customThemes"

// Pure-function test — doesn't touch the DB at all — but customThemes.ts
// imports the real `db` at module scope, which otherwise triggers a real
// connection/lock-check against the on-disk dev database purely as an
// import side effect. A bare stub (not a real createTestDb() PGlite
// instance — nothing here ever calls it, and spinning up a real instance
// per test file risks a WASM-level crash from multiple concurrent PGlite
// instances in the same worker) is enough to short-circuit that import.
vi.mock("$lib/server/db", () => ({ db: {} }))

describe("assertSafeThemeCss", () => {
	test("accepts plain CSS with no url() at all", () => {
		expect(() =>
			assertSafeThemeCss(
				"--color-primary-500: #ff0000; --color-surface-100: #ffffff;"
			)
		).not.toThrow()
	})

	test("accepts a relative url()", () => {
		expect(() =>
			assertSafeThemeCss("background: url(images/bg.png);")
		).not.toThrow()
		expect(() =>
			assertSafeThemeCss("background: url('./bg.png');")
		).not.toThrow()
	})

	test("accepts a data: url()", () => {
		expect(() =>
			assertSafeThemeCss("background: url(data:image/png;base64,AAAA);")
		).not.toThrow()
	})

	test("rejects @import", () => {
		expect(() =>
			assertSafeThemeCss("@import url('https://evil.com/steal.css');")
		).toThrow(/@import/)
	})

	test("rejects an http:// url()", () => {
		expect(() =>
			assertSafeThemeCss("background: url(http://evil.com/x.png);")
		).toThrow(/external URLs/)
	})

	test("rejects an https:// url()", () => {
		expect(() =>
			assertSafeThemeCss("background: url('https://evil.com/x.png');")
		).toThrow(/external URLs/)
	})

	test("rejects a protocol-relative // url()", () => {
		expect(() =>
			assertSafeThemeCss("background: url(//evil.com/x.png);")
		).toThrow(/external URLs/)
	})
})
