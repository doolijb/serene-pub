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
})
