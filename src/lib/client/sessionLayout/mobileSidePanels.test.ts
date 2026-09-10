import { describe, it, expect, beforeEach, vi } from "vitest"
import {
	mobileSidePanels,
	nextOpen,
	resolveOpen,
	showsToggles
} from "./mobileSidePanels.svelte"

/** A stand-in for the header button that opened the overlay. */
function fakeOpener(connected = true) {
	return { isConnected: connected, focus: vi.fn() } as unknown as HTMLElement
}

describe("nextOpen — one overlay at a time", () => {
	it("opens the tapped side from closed", () => {
		expect(nextOpen(null, "left")).toBe("left")
		expect(nextOpen(null, "right")).toBe("right")
	})

	it("closes when the OPEN side is tapped again", () => {
		expect(nextOpen("left", "left")).toBe(null)
		expect(nextOpen("right", "right")).toBe(null)
	})

	it("swaps when the other side is tapped", () => {
		expect(nextOpen("left", "right")).toBe("right")
		expect(nextOpen("right", "left")).toBe("left")
	})
})

describe("resolveOpen — no stuck overlay", () => {
	it("keeps a populated side open while narrow", () => {
		expect(
			resolveOpen({ narrow: true, left: 2, right: 0, open: "left" })
		).toBe("left")
	})

	it("closes above the breakpoint (rotate / resize to desktop)", () => {
		expect(
			resolveOpen({ narrow: false, left: 2, right: 1, open: "left" })
		).toBe(null)
	})

	it("closes when the open side loses its last widget", () => {
		expect(
			resolveOpen({ narrow: true, left: 0, right: 3, open: "left" })
		).toBe(null)
		expect(
			resolveOpen({ narrow: true, left: 3, right: 0, open: "right" })
		).toBe(null)
	})

	it("never invents an open side", () => {
		expect(
			resolveOpen({ narrow: true, left: 2, right: 2, open: null })
		).toBe(null)
	})
})

describe("showsToggles — the header L/R group", () => {
	it("is hidden above the breakpoint even when both sides are populated", () => {
		expect(showsToggles({ narrow: false, left: 3, right: 3 })).toBe(false)
	})

	it("is hidden when neither side is populated", () => {
		expect(showsToggles({ narrow: true, left: 0, right: 0 })).toBe(false)
	})

	it("shows when either side is populated", () => {
		expect(showsToggles({ narrow: true, left: 1, right: 0 })).toBe(true)
		expect(showsToggles({ narrow: true, left: 0, right: 1 })).toBe(true)
	})
})

describe("mobileSidePanels — the shared singleton", () => {
	beforeEach(() => {
		mobileSidePanels.open = null
		mobileSidePanels.setSides(true, 2, 2)
	})

	it("toggles, swaps and closes through the store", () => {
		mobileSidePanels.toggle("left")
		expect(mobileSidePanels.open).toBe("left")
		mobileSidePanels.toggle("right")
		expect(mobileSidePanels.open).toBe("right")
		mobileSidePanels.toggle("right")
		expect(mobileSidePanels.open).toBe(null)
	})

	it("returns focus to the opener when the overlay closes", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		expect(opener.focus).not.toHaveBeenCalled()
		mobileSidePanels.close()
		expect(mobileSidePanels.open).toBe(null)
		expect(opener.focus).toHaveBeenCalledTimes(1)
	})

	it("does not focus an opener that has left the DOM", () => {
		const opener = fakeOpener(false)
		mobileSidePanels.toggle("right", opener)
		mobileSidePanels.close()
		expect(opener.focus).not.toHaveBeenCalled()
	})

	it("close() on an already-closed store is a no-op", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		mobileSidePanels.close()
		mobileSidePanels.close()
		expect(opener.focus).toHaveBeenCalledTimes(1)
	})

	it("crossing back to desktop drops the overlay without stealing focus", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		mobileSidePanels.setSides(false, 2, 2)
		expect(mobileSidePanels.open).toBe(null)
		expect(opener.focus).not.toHaveBeenCalled()
	})

	it("emptying the open side drops the overlay", () => {
		mobileSidePanels.toggle("left")
		mobileSidePanels.setSides(true, 0, 2)
		expect(mobileSidePanels.open).toBe(null)
	})

	it("leaves the other side open when the closed side empties", () => {
		mobileSidePanels.toggle("left")
		mobileSidePanels.setSides(true, 2, 0)
		expect(mobileSidePanels.open).toBe("left")
	})
})
