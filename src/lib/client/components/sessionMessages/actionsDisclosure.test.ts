/**
 * The Actions disclosure's close table (ruled 2026-09-17): its toggle and
 * Escape close it; focus leaving it never does. The suite runs on `node`
 * with no DOM, so the ruling is pinned on the pure table the composer
 * consults rather than on a mounted row — see `actionsDisclosure.ts` for
 * the first-press-does-nothing defect the focus-out close caused.
 */
import { describe, expect, it } from "vitest"
import { shouldCloseActions } from "./actionsDisclosure"

describe("shouldCloseActions", () => {
	describe("focusout", () => {
		it("never closes the row, wherever focus went", () => {
			for (const focusInside of [true, false])
				for (const overflowOpen of [true, false])
					expect(
						shouldCloseActions({ reason: "focusout", focusInside, overflowOpen })
					).toEqual({ close: false, returnFocus: false })
		})
	})

	describe("escape", () => {
		it("closes and returns focus to the toggle when focus was inside", () => {
			expect(
				shouldCloseActions({
					reason: "escape",
					focusInside: true,
					overflowOpen: false
				})
			).toEqual({ close: true, returnFocus: true })
		})

		it("closes without moving focus when focus was elsewhere", () => {
			expect(
				shouldCloseActions({
					reason: "escape",
					focusInside: false,
					overflowOpen: false
				})
			).toEqual({ close: true, returnFocus: false })
		})

		it("leaves the key to the More menu while it is open", () => {
			for (const focusInside of [true, false])
				expect(
					shouldCloseActions({ reason: "escape", focusInside, overflowOpen: true })
				).toEqual({ close: false, returnFocus: false })
		})
	})

	describe("toggle", () => {
		it("always closes, and never moves focus off the toggle", () => {
			for (const overflowOpen of [true, false])
				expect(
					shouldCloseActions({ reason: "toggle", focusInside: true, overflowOpen })
				).toEqual({ close: true, returnFocus: false })
		})
	})
})
