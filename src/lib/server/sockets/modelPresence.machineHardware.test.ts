import { describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({
	machineHardware: vi.fn(async () => ({ gpu: { vendor: null } }))
}))
vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/connections/hardware", () => ({
	machineHardware: m.machineHardware
}))

import { modelsMachineHardware } from "./modelPresence"

describe("models:machineHardware handler", () => {
	test("a non-admin gets a null answer and a sentence, no throw", async () => {
		const emit = vi.fn()
		const res: any = await modelsMachineHardware.handler(
			{ user: { id: 2, isAdmin: false } } as any,
			{},
			emit
		)
		expect(res.hardware).toBeNull()
		expect(res.error).toMatch(/admin/i)
		expect(m.machineHardware).not.toHaveBeenCalled()
		expect(emit).toHaveBeenCalledWith("models:machineHardware", res)
	})
	test("an admin gets the hardware; a failure gets a sentence", async () => {
		const emit = vi.fn()
		const admin = { user: { id: 1, isAdmin: true } } as any
		const ok: any = await modelsMachineHardware.handler(admin, {}, emit)
		expect(ok.hardware).toEqual({ gpu: { vendor: null } })
		m.machineHardware.mockRejectedValueOnce(new Error("x"))
		const bad: any = await modelsMachineHardware.handler(admin, {}, emit)
		expect(bad).toEqual({
			hardware: null,
			error: "Could not read this computer's hardware."
		})
	})
})
