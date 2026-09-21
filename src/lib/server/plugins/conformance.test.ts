import { describe, it, expect } from "vitest"
import { checkConformance } from "./conformance"

/**
 * Conformance derives `backends` by actually loading the bundle on both
 * sandboxes — the compiled-fact rule. Proves the two orthogonal breakage axes
 * (SES-hostile → quickjs-only) and the unusable case (loads on neither).
 */

describe("conformance harness", () => {
	it("a clean bundle runs on both backends", async () => {
		const r = await checkConformance(
			"module.exports = { hooks: { v: (i) => i.n } }"
		)
		expect(r.backends.sort()).toEqual(["quickjs", "ses"])
		expect(r.issues).toEqual({})
	}, 10_000)

	it("a SES-hostile bundle (prototype mutation) is quickjs-only", async () => {
		const r = await checkConformance(
			"Array.prototype.__x = 1; module.exports = { hooks: { v: () => 1 } }"
		)
		expect(r.backends).toEqual(["quickjs"])
		expect(r.issues.ses).toBeTruthy()
		expect(r.issues.quickjs).toBeUndefined()
	}, 10_000)

	it("a bundle that throws at module scope loads on neither", async () => {
		const r = await checkConformance(
			"throw new Error('boom at import'); module.exports = { hooks: {} }"
		)
		expect(r.backends).toEqual([])
		expect(r.issues.quickjs).toMatch(/boom/)
		expect(r.issues.ses).toMatch(/boom/)
	}, 10_000)

	it("a bundle with no hooks still loads (valid, just empty)", async () => {
		const r = await checkConformance("module.exports = { hooks: {} }")
		expect(r.backends.sort()).toEqual(["quickjs", "ses"])
	}, 10_000)
})

/**
 * The task reach (plans/29 R-3, F11): a bundle whose task hook reaches for
 * `fetch` or `storage` fails conformance on both backends with a sentence
 * naming the law — before it can install and halt on its first run with a
 * TypeError the author would read as a sandbox bug.
 */
describe("conformance harness — the task reach", () => {
	const REACHES = `module.exports = { hooks: {
		t: async function (input, ctx) { return await ctx.fetch("https://example.com/") },
		s: function (input, ctx) { return ctx.storage.get("k") },
		pure: function (input) { return (input.n || 0) + 1 },
		broken: function (input) { return input.missing.field }
	} }`

	it("a task hook calling fetch fails on every backend, naming R-3 and F11", async () => {
		const r = await checkConformance(REACHES, {
			nodeDefinitions: { "acme:task/t@1": "t" }
		})
		expect(r.backends).toEqual([])
		for (const kind of ["quickjs", "ses"] as const) {
			expect(r.issues[kind]).toMatch(/R-3/)
			expect(r.issues[kind]).toMatch(/F11/)
			expect(r.issues[kind]).toMatch(/hook 't'/)
		}
	}, 15_000)

	it("a task hook reading storage fails the same way", async () => {
		const r = await checkConformance(REACHES, {
			nodeDefinitions: { "acme:task/s@1": "s" }
		})
		expect(r.backends).toEqual([])
		expect(r.issues.quickjs).toMatch(/R-3/)
		expect(r.issues.ses).toMatch(/R-3/)
	}, 15_000)

	it("the same hook bound to an oracle is not the probe's business", async () => {
		// An oracle's ctx carries both; whether the network is granted is a
		// permission the admin decides at run time, not a conformance fact.
		const r = await checkConformance(REACHES, {
			nodeDefinitions: { "acme:oracle/t@1": "t" }
		})
		expect(r.backends.sort()).toEqual(["quickjs", "ses"])
		expect(r.issues).toEqual({})
	}, 15_000)

	it("a pure task passes, and a task that fails on its own words is left to its author", async () => {
		const pure = await checkConformance(REACHES, {
			nodeDefinitions: { "acme:task/pure@1": "pure" }
		})
		expect(pure.backends.sort()).toEqual(["quickjs", "ses"])
		// `broken` throws the same TypeError whichever ctx it is given: the
		// failure does not change when storage and fetch appear, so it is not
		// a reach — and not this probe's finding.
		const broken = await checkConformance(REACHES, {
			nodeDefinitions: { "acme:task/broken@1": "broken" }
		})
		expect(broken.backends.sort()).toEqual(["quickjs", "ses"])
		expect(broken.issues).toEqual({})
	}, 15_000)

	it("a script kind's link reaching for storage fails under the chain-link ctx, naming the kind", async () => {
		// A chain link is a script: in-app scripts get `{ random, log }`, and
		// a plugin's link gets the same (R-3).
		const r = await checkConformance(REACHES, {
			hookKinds: { "core:script:text/transform@1": "s" }
		})
		expect(r.backends).toEqual([])
		for (const kind of ["quickjs", "ses"] as const) {
			expect(r.issues[kind]).toMatch(/R-3/)
			expect(r.issues[kind]).toMatch(/F11/)
			expect(r.issues[kind]).toMatch(/hook 's'/)
			expect(r.issues[kind]).toMatch(/script kind core:script:text\/transform@1/)
			expect(r.issues[kind]).toMatch(/chain-link/)
		}
	}, 15_000)

	it("a template engine's renderer reaching for fetch fails under a task's ctx", async () => {
		// A render is pure — template and variables in, a string out — so the
		// engine host dispatches it as a task (R-3).
		const r = await checkConformance(REACHES, {
			engines: { "acme:template/mustache@1": "t" }
		})
		expect(r.backends).toEqual([])
		expect(r.issues.quickjs).toMatch(/template engine acme:template\/mustache@1/)
		expect(r.issues.ses).toMatch(/R-3/)
	}, 15_000)

	it("a pure link and a pure renderer pass", async () => {
		const r = await checkConformance(REACHES, {
			hookKinds: { "core:script:text/transform@1": "pure" },
			engines: { "acme:template/mustache@1": "pure" }
		})
		expect(r.backends.sort()).toEqual(["quickjs", "ses"])
		expect(r.issues).toEqual({})
	}, 15_000)

	it("a manifest without node definitions probes nothing", async () => {
		const r = await checkConformance(REACHES)
		expect(r.backends.sort()).toEqual(["quickjs", "ses"])
	}, 15_000)
})
