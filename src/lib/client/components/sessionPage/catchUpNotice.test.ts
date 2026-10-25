import { describe, expect, test, vi } from "vitest"
import { catchUpLabel, catchUpNotice } from "$lib/shared/sessions/archive"
import { catchUpHeaderNotice } from "./catchUpNotice"

const offer = { fromSessionId: 4, fromSessionName: "The Lantern Inn", lines: 12 }

describe("catchUpHeaderNotice", () => {
	test("is null with no offer", () => {
		const o = { dismissed: false, dismiss: vi.fn(), press: vi.fn() }
		expect(catchUpHeaderNotice(null, o)).toBeNull()
		expect(catchUpHeaderNotice(undefined, o)).toBeNull()
	})

	test("is null once dismissed", () => {
		expect(
			catchUpHeaderNotice(offer, { dismissed: true, dismiss: vi.fn(), press: vi.fn() })
		).toBeNull()
	})

	test("carries the shared text and label", () => {
		const n = catchUpHeaderNotice(offer, { dismissed: false, dismiss: vi.fn(), press: vi.fn() })
		expect(n?.text).toBe(catchUpNotice(offer))
		expect(n?.action?.label).toBe(catchUpLabel(offer))
		expect(n?.link).toBeNull()
	})

	test("pressing closes the older session out, then dismisses", () => {
		const order: string[] = []
		const press = vi.fn(() => order.push("press"))
		const dismiss = vi.fn(() => order.push("dismiss"))
		const n = catchUpHeaderNotice(offer, { dismissed: false, dismiss, press })
		n?.action?.press()
		expect(press).toHaveBeenCalledWith(4)
		expect(order).toEqual(["press", "dismiss"])
	})
})
