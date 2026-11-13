import { describe, expect, it } from "vitest"
import { roundWorthBindings, roundWorthOf } from "./roundWorth"

const doc = (v?: unknown) => ({
	fields: v === undefined ? {} : { roundWorth: v }
})

describe("roundWorthOf", () => {
	it("reads a whole number above 0 as the minutes", () => {
		expect(roundWorthOf(doc(5))).toEqual({
			minutes: 5,
			step: { by: 5, unit: "minutes" }
		})
	})
	it.each([
		["0", doc(0)],
		["an absent field", doc()],
		["a negative", doc(-3)],
		["a fraction", doc(2.5)],
		["a string", doc("5")],
		["a null field", doc(null)],
		["a null document", null],
		["a document with no fields", {}]
	])("is 0 for %s", (_n, d) => {
		expect(roundWorthOf(d)).toEqual({
			minutes: 0,
			step: { by: 0, unit: "minutes" }
		})
	})
})

describe("core:query/round-worth@1", () => {
	const run = (read: (kind: string, args: unknown) => Promise<unknown>) =>
		(roundWorthBindings()["core:query/round-worth@1"] as any)(
			{ scope: { sessionId: 7 } },
			{ read }
		)

	it("publishes main, minutes and step from the settings document", async () => {
		const seen: unknown[] = []
		const res = await run(async (kind, args) => {
			seen.push([kind, args])
			return doc(5)
		})
		expect(seen).toEqual([["session_settings", { sessionId: 7 }]])
		const w = { minutes: 5, step: { by: 5, unit: "minutes" } }
		expect(res).toEqual({
			kind: "ok",
			value: { main: w, minutes: 5, step: w.step }
		})
	})

	it("halts when the session has no settings document", async () => {
		const res = await run(async () => null)
		expect(res.kind).toBe("halt")
		expect(res.reason).toMatch(/no session to read the round worth for/)
	})
})
