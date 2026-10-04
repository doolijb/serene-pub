/**
 * A tab's pending copies (`LayoutCopyAsks`): each answer settles the oldest
 * ask, a refusal gives back the blob save its ask dropped, and an answer to
 * another tab's copy settles nothing here.
 */
import { describe, expect, it, vi } from "vitest"
import { LayoutCopyAsks } from "./layoutCopyAsks"

describe("LayoutCopyAsks", () => {
	it("resolves an ask true when its copy lands, and persists nothing", async () => {
		const asks = new LayoutCopyAsks()
		const persist = vi.fn()
		const landed = asks.ask(true)
		expect(asks.settle(true, persist)).toBe(true)
		await expect(landed).resolves.toBe(true)
		expect(persist).not.toHaveBeenCalled()
		expect(asks.pending).toBe(0)
	})

	it("resolves false on a refusal, and sends the save the ask dropped", async () => {
		const asks = new LayoutCopyAsks()
		const persist = vi.fn()
		const refused = asks.ask(true)
		expect(asks.settle(false, persist)).toBe(true)
		await expect(refused).resolves.toBe(false)
		expect(persist).toHaveBeenCalledTimes(1)
	})

	it("sends nothing on a refusal when no save was waiting", async () => {
		const asks = new LayoutCopyAsks()
		const persist = vi.fn()
		const refused = asks.ask(false)
		asks.settle(false, persist)
		await expect(refused).resolves.toBe(false)
		expect(persist).not.toHaveBeenCalled()
	})

	it("settles asks oldest first", async () => {
		const asks = new LayoutCopyAsks()
		const persist = vi.fn()
		const first = asks.ask(false)
		const second = asks.ask(true)
		asks.settle(false, persist)
		asks.settle(true, persist)
		await expect(first).resolves.toBe(false)
		await expect(second).resolves.toBe(true)
		expect(persist).not.toHaveBeenCalled()
	})

	it("reports an answer it has no ask for (another tab's copy)", () => {
		const asks = new LayoutCopyAsks()
		const persist = vi.fn()
		expect(asks.settle(false, persist)).toBe(false)
		expect(persist).not.toHaveBeenCalled()
	})
})
