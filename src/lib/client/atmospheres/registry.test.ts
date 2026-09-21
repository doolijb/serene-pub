import { describe, expect, it } from "vitest"
import { ATMOSPHERES, pickRandom } from "./definitions"

/**
 * The registry's shape, not its looks.
 *
 * `definitions.ts` is imported here in a node environment on purpose: it is the
 * one file in this folder a picker or a session would import to list what is
 * available, and it must not reach for the DOM to be read. The import itself is
 * half the assertion.
 */
describe("atmosphere definitions", () => {
	it("registers fourteen atmospheres", () => {
		expect(ATMOSPHERES).toHaveLength(14)
	})

	it("gives every atmosphere a unique core id", () => {
		const ids = ATMOSPHERES.map((a) => a.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const id of ids) {
			expect(id).toMatch(/^core:atmosphere\/[a-z-]+$/)
		}
	})

	// Film grain is a static noise overlay rather than an atmosphere; it was
	// left out of the port deliberately and must not creep back in.
	it("does not carry film grain", () => {
		for (const atmosphere of ATMOSPHERES) {
			expect(atmosphere.id.endsWith("grain")).toBe(false)
		}
	})

	it("gives every canvas atmosphere something to draw with", () => {
		for (const atmosphere of ATMOSPHERES) {
			if (atmosphere.kind !== "canvas") continue
			expect(typeof atmosphere.init).toBe("function")
			expect(typeof atmosphere.frame).toBe("function")
			expect(atmosphere.particles).toBeGreaterThanOrEqual(0)
		}
	})

	it("gives every css atmosphere a prefixed class and markup", () => {
		for (const atmosphere of ATMOSPHERES) {
			if (atmosphere.kind !== "css") continue
			expect(atmosphere.cls.startsWith("sp-atmo-")).toBe(true)
			expect(atmosphere.html.length).toBeGreaterThan(0)
		}
	})

	it("picks across the whole list", () => {
		expect(pickRandom(() => 0)).toBe(ATMOSPHERES[0])
		expect(pickRandom(() => 0.999)).toBe(
			ATMOSPHERES[ATMOSPHERES.length - 1]
		)
	})
})
