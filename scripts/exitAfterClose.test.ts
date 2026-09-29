import { describe, expect, test, vi } from "vitest"

import { exitAfterClose } from "./exitAfterClose"

/**
 * The claim: the database is closed before the process exits on every path —
 * the work succeeding, returning a failure code, or throwing — and a close
 * that itself fails never changes the exit code the work earned.
 */
describe("exitAfterClose", () => {
	function harness(close: () => Promise<void> = async () => {}) {
		const order: string[] = []
		const exit = vi.fn((code: number) => order.push(`exit ${code}`))
		const closeSpy = vi.fn(async () => {
			order.push("close")
			await close()
		})
		return { order, exit, close: closeSpy }
	}

	test("success: closes, then exits 0", async () => {
		const h = harness()
		await exitAfterClose(async () => 0, h.close, h.exit)
		expect(h.order).toEqual(["close", "exit 0"])
	})

	test("a failure code: closes, then exits with it", async () => {
		const h = harness()
		await exitAfterClose(async () => 1, h.close, h.exit)
		expect(h.order).toEqual(["close", "exit 1"])
	})

	test("thrown work: reports it, closes, exits 1", async () => {
		const h = harness()
		const stderr = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true)
		try {
			await exitAfterClose(
				async () => {
					throw new Error("no manifest")
				},
				h.close,
				h.exit
			)
			expect(stderr).toHaveBeenCalledWith("no manifest\n")
		} finally {
			stderr.mockRestore()
		}
		expect(h.order).toEqual(["close", "exit 1"])
	})

	test("a close that throws keeps the work's exit code", async () => {
		const h = harness(async () => {
			throw new Error("already closed")
		})
		const stderr = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true)
		try {
			await exitAfterClose(async () => 0, h.close, h.exit)
		} finally {
			stderr.mockRestore()
		}
		expect(h.order).toEqual(["close", "exit 0"])
	})
})
