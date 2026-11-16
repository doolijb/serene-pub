import { describe, expect, test, vi } from "vitest"
import { TtlCache } from "./cache"

describe("TtlCache cap and sweep", () => {
	test("keeps exactly maxEntries, dropping the oldest", () => {
		const c = new TtlCache<number>(60_000, 5)
		for (let i = 0; i < 8; i++) c.set(`k${i}`, i)
		for (let i = 0; i < 3; i++) expect(c.get(`k${i}`)).toBeUndefined()
		for (let i = 3; i < 8; i++) expect(c.get(`k${i}`)).toBe(i)
	})

	test("a later set sweeps an expired entry of another key", () => {
		const c = new TtlCache<number>(10, 5)
		const now = Date.now()
		const spy = vi.spyOn(Date, "now")
		spy.mockReturnValue(now)
		c.set("old", 1)
		spy.mockReturnValue(now + 11)
		c.set("fresh", 2)
		expect((c as any).entries.has("old")).toBe(false)
		expect(c.get("fresh")).toBe(2)
		spy.mockRestore()
	})

	test("a re-set key moves to newest and survives eviction", () => {
		const c = new TtlCache<number>(60_000, 3)
		c.set("a", 1)
		c.set("b", 2)
		c.set("c", 3)
		c.set("a", 10)
		c.set("d", 4)
		expect(c.get("b")).toBeUndefined()
		expect(c.get("a")).toBe(10)
		expect(c.get("c")).toBe(3)
		expect(c.get("d")).toBe(4)
	})
})
