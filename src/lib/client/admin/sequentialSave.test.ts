import { describe, expect, it } from "vitest"
import { saveErrors, saveInSequence, saveSummary } from "./sequentialSave"

describe("saveInSequence", () => {
	it("runs every step in order, one at a time", async () => {
		const seen: string[] = []
		let inFlight = 0
		const step = (label: string) => ({
			label,
			run: async () => {
				inFlight++
				expect(inFlight).toBe(1)
				seen.push(label)
				await Promise.resolve()
				inFlight--
			}
		})
		const out = await saveInSequence([step("a"), step("b"), step("c")])
		expect(seen).toEqual(["a", "b", "c"])
		expect(out).toEqual({ landed: ["a", "b", "c"], refused: [], skipped: [] })
		expect(saveSummary(out, "Chat")).toBe("Saved Chat")
		expect(saveErrors(out)).toEqual([])
	})

	it("keeps going past a refusal and names it", async () => {
		const out = await saveInSequence([
			{ label: "Offered: A", run: async () => {} },
			{ label: "Offered: B", run: async () => Promise.reject(new Error("missing a binding")) },
			{ label: "Name: C", run: async () => {} }
		])
		expect(out.landed).toEqual(["Offered: A", "Name: C"])
		expect(out.refused).toEqual([{ label: "Offered: B", error: "missing a binding" }])
		expect(saveSummary(out, "Chat")).toBe("Saved 2 of 3 changes")
		expect(saveErrors(out)).toEqual(["Offered: B: missing a binding"])
	})

	it("skips a step whose prerequisite was refused", async () => {
		let ran = false
		const out = await saveInSequence([
			{ label: "Add D", run: async () => Promise.reject(new Error("no")) },
			{
				label: "Default: D",
				after: ["Add D"],
				run: async () => {
					ran = true
				}
			}
		])
		expect(ran).toBe(false)
		expect(out.skipped).toEqual(["Default: D"])
		expect(saveErrors(out)[1]).toMatch(/Not sent.*Default: D/)
	})

	it("words a refusal that carries no sentence", async () => {
		const out = await saveInSequence([{ label: "x", run: () => Promise.reject("??") }])
		expect(out.refused[0].error).toBe("The server refused the change.")
	})
})
