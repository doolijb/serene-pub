import { describe, it, expect } from "vitest"
import type { MachineHardware } from "$lib/shared/connections/machineHardware"
import { coLoadUnmeasured } from "./coLoadReading"

const hw = (vendor: string | null) =>
	({ gpu: { vendor } }) as unknown as MachineHardware

describe("coLoadUnmeasured", () => {
	it("is false with an nvidia card", () => {
		expect(coLoadUnmeasured(hw("nvidia"))).toBe(false)
	})
	it("is true for amd, apple, no vendor, or no hardware", () => {
		expect(coLoadUnmeasured(hw("amd"))).toBe(true)
		expect(coLoadUnmeasured(hw("apple"))).toBe(true)
		expect(coLoadUnmeasured(hw(null))).toBe(true)
		expect(coLoadUnmeasured(null)).toBe(true)
	})
	it("is false until the answer arrives", () => {
		expect(coLoadUnmeasured(undefined)).toBe(false)
	})
})
