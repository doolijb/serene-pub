/**
 * The nonce-preservation test is the one that matters most: SvelteKit injects
 * a nonce for its own inline hydration script, and if a merge mangles or drops
 * it the page loads but never hydrates — a dead UI with no console error,
 * which is exactly the failure mode svelte.config.js's comment warns about.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const ORIGINAL_ENV = { ...process.env }

const BASE =
	"default-src 'self'; script-src 'self' 'nonce-AbC123+/=' ; style-src 'self'; connect-src 'self' http: https:"

beforeEach(() => {
	delete process.env.CSP_EXTRA_SCRIPT_SRC
	delete process.env.CSP_EXTRA_STYLE_SRC
	delete process.env.CSP_EXTRA_CONNECT_SRC
	vi.resetModules()
})

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
	vi.restoreAllMocks()
})

describe("mergeCspExtras", () => {
	test("no env set — returns the header untouched", async () => {
		const { mergeCspExtras } = await import("./csp")
		expect(mergeCspExtras(BASE)).toBe(BASE)
	})

	test("appends to script-src while preserving the nonce byte-for-byte", async () => {
		process.env.CSP_EXTRA_SCRIPT_SRC =
			"https://static.cloudflareinsights.com"
		const { mergeCspExtras } = await import("./csp")
		const out = mergeCspExtras(BASE)
		expect(out).toContain("'nonce-AbC123+/='")
		expect(out).toContain(
			"script-src 'self' 'nonce-AbC123+/=' https://static.cloudflareinsights.com"
		)
	})

	test("leaves unrelated directives alone", async () => {
		process.env.CSP_EXTRA_SCRIPT_SRC = "https://cdn.example.com"
		const { mergeCspExtras } = await import("./csp")
		const out = mergeCspExtras(BASE)
		expect(out).toContain("default-src 'self'")
		expect(out).toContain("style-src 'self'")
		expect(out).not.toContain("style-src 'self' https://cdn.example.com")
	})

	test("accepts hostnames containing hyphens", async () => {
		process.env.CSP_EXTRA_SCRIPT_SRC = "https://my-cdn.example.com"
		const { mergeCspExtras } = await import("./csp")
		expect(mergeCspExtras(BASE)).toContain("https://my-cdn.example.com")
	})

	test("supports multiple comma-separated sources across directives", async () => {
		process.env.CSP_EXTRA_SCRIPT_SRC =
			"https://a.example.com,https://b.example.com"
		process.env.CSP_EXTRA_CONNECT_SRC = "https://c.example.com"
		const { mergeCspExtras } = await import("./csp")
		const out = mergeCspExtras(BASE)
		expect(out).toContain("https://a.example.com https://b.example.com")
		expect(out).toContain(
			"connect-src 'self' http: https: https://c.example.com"
		)
	})

	test("does not duplicate a source already present", async () => {
		process.env.CSP_EXTRA_SCRIPT_SRC = "'self'"
		const { mergeCspExtras } = await import("./csp")
		const scriptSrc = mergeCspExtras(BASE)
			.split(";")
			.map((d) => d.trim())
			.find((d) => d.startsWith("script-src"))!
		// Asserted on the directive rather than the whole header: merging
		// re-joins directives with a canonical "; ", so a header written with
		// irregular spacing (as BASE deliberately is) comes back normalized.
		// That is harmless — CSP is whitespace-insensitive between tokens —
		// but it makes whole-header equality the wrong assertion here.
		expect(scriptSrc.match(/'self'/g)).toHaveLength(1)
		expect(scriptSrc).toContain("'nonce-AbC123+/='")
	})

	test("rejects a value that would inject a whole directive", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		process.env.CSP_EXTRA_SCRIPT_SRC = "x; script-src 'unsafe-inline'"
		const { mergeCspExtras } = await import("./csp")
		const out = mergeCspExtras(BASE)
		expect(out).not.toContain("unsafe-inline")
		expect(out).toBe(BASE)
		expect(warn).toHaveBeenCalled()
	})

	test("skips a directive that is not already present rather than inventing it", async () => {
		// Creating style-src where only default-src exists would NARROW what is
		// allowed, breaking the page instead of widening it.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		process.env.CSP_EXTRA_STYLE_SRC = "https://fonts.example.com"
		const { mergeCspExtras } = await import("./csp")
		const minimal = "default-src 'self'"
		expect(mergeCspExtras(minimal)).toBe(minimal)
		expect(warn).toHaveBeenCalled()
	})

	test("re-reads when the env changes rather than caching the first answer", async () => {
		const { mergeCspExtras } = await import("./csp")
		process.env.CSP_EXTRA_SCRIPT_SRC = "https://first.example.com"
		expect(mergeCspExtras(BASE)).toContain("https://first.example.com")
		process.env.CSP_EXTRA_SCRIPT_SRC = "https://second.example.com"
		const out = mergeCspExtras(BASE)
		expect(out).toContain("https://second.example.com")
		expect(out).not.toContain("https://first.example.com")
	})
})
