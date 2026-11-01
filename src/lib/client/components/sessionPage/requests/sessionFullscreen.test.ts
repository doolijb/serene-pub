/** `session-fullscreen` (SHAPES L1): a widget's press, answered by the page. */
import { afterEach, describe, expect, test, vi } from "vitest"
import { answerSessionFullscreen } from "./sessionFullscreen"

const control = () => ({
	on: false,
	enter: vi.fn(),
	exit: vi.fn(),
	toggle: vi.fn()
})

afterEach(() => vi.unstubAllGlobals())

describe("answerSessionFullscreen", () => {
	test("on:true enters, on:false exits, absent toggles", () => {
		const c = control()
		answerSessionFullscreen({ on: true }, c)
		expect(c.enter).toHaveBeenCalledOnce()
		answerSessionFullscreen({ on: false }, c)
		expect(c.exit).toHaveBeenCalledOnce()
		answerSessionFullscreen({}, c)
		expect(c.toggle).toHaveBeenCalledOnce()
	})

	test("no session open refuses with its sentence", () => {
		expect(() => answerSessionFullscreen({}, null)).toThrow(
			"There is no session open to show full screen."
		)
	})

	test("without a live user activation it refuses and changes nothing", () => {
		vi.stubGlobal("navigator", { userActivation: { isActive: false } })
		const c = control()
		expect(() => answerSessionFullscreen({ on: true }, c)).toThrow(
			"Full screen changes only when someone presses for it."
		)
		expect(c.enter).not.toHaveBeenCalled()
	})
})
