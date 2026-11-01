import { describe, expect, test } from "vitest"
import { frameStateStore } from "./framePort"

describe("save-state cap", () => {
	test("a 200 KB state is kept and its v survives", () => {
		const store = frameStateStore()
		const r = store.set("k", { v: "1.2.0", data: "x".repeat(200 * 1024) })
		expect(r.kept).toBe(true)
		expect(store.get("k")!.v).toBe("1.2.0")
	})
	test("a 300 KB state is dropped with the cap in its reason", () => {
		const store = frameStateStore()
		const r = store.set("k", { v: "1.2.0", data: "x".repeat(300 * 1024) })
		expect(r.kept).toBe(false)
		expect(r.reason).toContain(String(256 * 1024))
		expect(store.get("k")).toBeUndefined()
	})
})
