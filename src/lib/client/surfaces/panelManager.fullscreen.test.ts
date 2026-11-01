/** `announceFullscreen` (SHAPES L1): every subscriber hears the change. */
import { describe, expect, it, vi } from "vitest"
import { SurfaceManager } from "./panelManager.svelte"

describe("SurfaceManager.announceFullscreen", () => {
	it("a subscriber hears { kind: 'fullscreen', on }", () => {
		const m = new SurfaceManager()
		const heard = vi.fn()
		m.subscribe(heard)
		m.announceFullscreen(true)
		expect(heard).toHaveBeenCalledWith({ kind: "fullscreen", on: true })
	})
})
