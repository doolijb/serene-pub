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
