/**
 * 🚧 A failed reply in a genre with no row retry (the 100-turn walk, B7): the
 * row's press — Retry on the error row, Try again on the turn line — asks the
 * retake's preview, and a turn of ONE row is retaken whole rather than handed
 * to the row regenerate the genre refuses ("what happened stands").
 */
import { describe, expect, it, vi } from "vitest"
import { createRetake, type RetakeRow } from "./retake"

const harness = () => {
	const sent: any[] = []
	const asked: RetakeRow[][] = []
	const retake = createRetake({
		sessionId: () => 7,
		quiet: () => false,
		send: (p) => sent.push(p),
		setQuiet: () => {},
		ask: (rows) => asked.push(rows)
	})
	return { retake, sent, asked }
}
const preview = (rows: number[]) =>
	({ sessionId: 7, ok: true, preview: true, rows: rows.map((messageId) => ({ messageId })) }) as any

describe("pressRow", () => {
	it("a one-row turn: the row's own regenerate, where the genre offers one", () => {
		const { retake, sent, asked } = harness()
		const fallback = vi.fn()
		retake.pressRow(40, fallback)
		expect(sent).toEqual([{ sessionId: 7, preview: true }])
		expect(retake.hear(preview([40]))).toBe(true)
		expect(fallback).toHaveBeenCalledOnce()
		expect(asked).toEqual([])
	})

	it("a one-row turn where the genre offers no row retry: the whole turn, asked first", () => {
		const { retake, asked } = harness()
		const fallback = vi.fn()
		retake.pressRow(40, fallback, true)
		expect(retake.hear(preview([40]))).toBe(true)
		expect(fallback).not.toHaveBeenCalled()
		expect(asked).toEqual([[{ messageId: 40 }]])
	})

	it("a row the newest turn does not hold is still the row's own press", () => {
		const { retake } = harness()
		const fallback = vi.fn()
		retake.pressRow(12, fallback, true)
		retake.hear(preview([40, 41]))
		expect(fallback).toHaveBeenCalledOnce()
	})
})

describe("🚧 retakeSentence names no channel slug (2026-10-18, the 100-turn walk #27)", () => {
	it("the story's speakers, then the other channels by the names the genre gives them", async () => {
		const { retakeSentence } = await import("./retake")
		const rows = [
			{ messageId: 1, channel: "main", characterId: null, name: "Narrator" },
			{ messageId: 2, channel: "table", characterId: null, name: "Narrator" },
			{ messageId: 3, channel: "travelogue", characterId: null, name: "Narrator" },
			{ messageId: 4, channel: "parley:2", characterId: null, name: "Planner" }
		] as RetakeRow[]
		const said = retakeSentence(rows, "en", { table: "Dice", travelogue: "Journal", parley: "Planner" })
		expect(said).toBe("This deletes and rewrites: Narrator, and the turn's lines on Dice, Journal, and Planner.")
		expect(said).not.toMatch(/table|travelogue|parley/)
		expect(retakeSentence([rows[0]!], "en")).toBe("This deletes and rewrites: Narrator.")
		expect(retakeSentence([rows[1]!], "en")).toBe("This deletes and rewrites the last turn's lines on Table.")
	})
})
