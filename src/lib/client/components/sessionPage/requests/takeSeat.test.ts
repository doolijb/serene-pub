import { describe, expect, test } from "vitest"
import { answerTakeSeat, SEAT_NAME_MAX } from "./takeSeat"

describe("🚧 take-seat (Lair rewrite D5)", () => {
	test("opens the viewer's seat under the trimmed name", () => {
		const taken: string[] = []
		answerTakeSeat({ name: "  Maren Holt " }, { takeSeat: (n) => taken.push(n) })
		expect(taken).toEqual(["Maren Holt"])
	})
	test("a blank or missing name is refused, and nothing is written", () => {
		const taken: string[] = []
		const deps = { takeSeat: (n: string) => taken.push(n) }
		expect(() => answerTakeSeat({ name: "   " }, deps)).toThrow("Name the character you'll play.")
		expect(() => answerTakeSeat({}, deps)).toThrow("Name the character you'll play.")
		expect(() => answerTakeSeat(null, deps)).toThrow("Name the character you'll play.")
		expect(() => answerTakeSeat({ name: "x".repeat(SEAT_NAME_MAX + 1) }, deps)).toThrow(/at most 80/)
		expect(taken).toEqual([])
	})
})
