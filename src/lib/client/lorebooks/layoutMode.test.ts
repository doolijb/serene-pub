/**
 * The lorebook workspace's layout mode — pure, and the whole of the decision
 * the workspace makes about its own width.
 */
import { describe, expect, it } from "vitest"
import { DESK_MIN_PX, layoutModeFor } from "./layoutMode"

describe("layoutModeFor", () => {
	it("is the desk at the breakpoint and above", () => {
		expect(layoutModeFor(DESK_MIN_PX)).toBe("desk")
		expect(layoutModeFor(DESK_MIN_PX + 1)).toBe("desk")
		expect(layoutModeFor(1440)).toBe("desk")
	})

	it("is compact below it", () => {
		expect(layoutModeFor(DESK_MIN_PX - 1)).toBe("compact")
		expect(layoutModeFor(390)).toBe("compact")
	})

	it("is compact for a width nobody has measured yet", () => {
		expect(layoutModeFor(0)).toBe("compact")
		expect(layoutModeFor(-1)).toBe("compact")
		expect(layoutModeFor(Number.NaN)).toBe("compact")
	})
})
