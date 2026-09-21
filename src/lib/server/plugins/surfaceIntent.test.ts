import { describe, it, expect, vi } from "vitest"
import { emitSurfaceIntent } from "./surfaceIntent"

describe("emitSurfaceIntent", () => {
	it("emits open/close ids to the acting user", () => {
		const emit = vi.fn()
		emitSurfaceIntent(emit, 7, { open: ["map"], close: ["tasks"] })
		expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
			sessionId: 7,
			open: ["map"],
			close: ["tasks"]
		})
	})

	it("omits an empty side and drops non-string ids", () => {
		const emit = vi.fn()
		emitSurfaceIntent(emit, 1, { open: ["map", 3 as any, ""], close: [] })
		expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
			sessionId: 1,
			open: ["map"]
		})
	})

	it("does not emit when there is nothing to do", () => {
		const emit = vi.fn()
		emitSurfaceIntent(emit, 1, {})
		emitSurfaceIntent(emit, 1, { open: [], close: [] })
		emitSurfaceIntent(emit, 1, { open: [42 as any] })
		expect(emit).not.toHaveBeenCalled()
	})

	describe("a plugin names its own panels", () => {
		it("qualifies a bare id with the emitting plugin's", () => {
			const emit = vi.fn()
			emitSurfaceIntent(
				emit,
				7,
				{ open: ["map"], close: ["tasks"] },
				"acme.dice"
			)
			expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
				sessionId: 7,
				open: ["acme.dice:map"],
				close: ["acme.dice:tasks"]
			})
		})

		it("passes through an id the plugin already qualified itself", () => {
			const emit = vi.fn()
			emitSurfaceIntent(emit, 7, { open: ["acme.dice:map"] }, "acme.dice")
			expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
				sessionId: 7,
				open: ["acme.dice:map"]
			})
		})

		it("drops another plugin's widget, and the good ids beside it survive", () => {
			// A drop, not a throw: the whole verb is a proposal, and one bad
			// id must not cancel the panel the plugin really did ask for.
			const emit = vi.fn()
			emitSurfaceIntent(
				emit,
				7,
				{ open: ["rival.pkg:map", "map"], close: ["rival.pkg:tasks"] },
				"acme.dice"
			)
			expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
				sessionId: 7,
				open: ["acme.dice:map"]
			})
		})

		it("emits nothing when every id it named was someone else's", () => {
			const emit = vi.fn()
			emitSurfaceIntent(emit, 7, { open: ["rival.pkg:map"] }, "acme.dice")
			expect(emit).not.toHaveBeenCalled()
		})

		it("leaves core's and a genre's plain ids alone", () => {
			// No plugin emitted this, so nothing is qualified — a core widget
			// id is plain and must stay plain.
			const emit = vi.fn()
			emitSurfaceIntent(emit, 7, { open: ["scene-portraits"] })
			expect(emit).toHaveBeenCalledWith("sessions:surfaceIntent", {
				sessionId: 7,
				open: ["scene-portraits"]
			})
		})
	})
})
