import { describe, expect, test } from "vitest"
import {
	fitSummaries,
	historyDaysInCast,
	inCastHistoryReceipt,
	inCastScenesReceipt,
	keptScenesInCast,
	speakerInCastViewOf,
	type SpeakerInCastSceneRow
} from "./speakerInCast"

const row = (
	id: number,
	over: Partial<SpeakerInCastSceneRow> = {}
): SpeakerInCastSceneRow => ({
	id,
	opened: id * 10,
	closed: id * 10 + 5,
	selected: null,
	castResolved: true,
	castEmpty: false,
	historyEntryId: null,
	summary: `Summary ${id}.`,
	summaryStatus: "done",
	...over
})
const view = (scenes: SpeakerInCastSceneRow[], inCast: number[]) =>
	speakerInCastViewOf({
		memberId: 1,
		name: "Mira",
		scenes,
		inCastSceneIds: inCast
	})

describe("keptScenesInCast", () => {
	test("kept: in the cast, open, unresolved cast; left out: closed and resolved without it", () => {
		const v = view(
			[
				row(1),
				row(2),
				row(3, { closed: null }),
				row(4, { castResolved: false }),
				row(5)
			],
			[1]
		)
		expect(keptScenesInCast(v, [1, 2, 3, 4, 5])).toEqual({
			keptIds: [1, 3, 4],
			leftOut: 2
		})
	})
	test("a scene resolved with no participant at all is kept, like one never worked out", () => {
		const v = view([row(1, { castEmpty: true }), row(2)], [])
		expect(keptScenesInCast(v, [1, 2])).toEqual({
			keptIds: [1],
			leftOut: 1
		})
	})
	test("a scene the view does not hold is kept; order preserved", () => {
		expect(keptScenesInCast(view([row(2)], []), [9, 2])).toEqual({
			keptIds: [9],
			leftOut: 1
		})
	})
})

describe("historyDaysInCast", () => {
	test("every scene kept: whole; none kept: none; no scene of this session: absent", () => {
		const v = view(
			[
				row(1, { historyEntryId: 100 }),
				row(2, { historyEntryId: 100 }),
				row(3, { historyEntryId: 200 }),
				row(4)
			],
			[1, 2]
		)
		const days = historyDaysInCast(v)
		expect(days.get(100)).toEqual({ kind: "whole" })
		expect(days.get(200)).toEqual({ kind: "none", why: "none" })
		expect(days.has(300)).toBe(false)
		expect(days.size).toBe(2)
	})
	test("some missed: the kept scenes' summaries in story order, trimmed, usable only", () => {
		const v = view(
			[
				row(1, {
					historyEntryId: 5,
					opened: 50,
					summary: "  Later.  "
				}),
				row(2, { historyEntryId: 5, opened: 10, summary: "Earlier." }),
				row(3, { historyEntryId: 5, opened: 30, summary: "   " }),
				row(4, {
					historyEntryId: 5,
					opened: 40,
					summaryStatus: "pending"
				}),
				row(5, { historyEntryId: 5, opened: 20 })
			],
			[1, 2, 3, 4]
		)
		expect(historyDaysInCast(v).get(5)).toEqual({
			kind: "scenes",
			summaries: ["Earlier.", "Later."]
		})
	})
	test("ties by scene id; a tick scene starts at its smallest line", () => {
		const v = view(
			[
				row(8, { historyEntryId: 5, opened: 10, summary: "B" }),
				row(7, { historyEntryId: 5, opened: 10, summary: "A" }),
				row(6, {
					historyEntryId: 5,
					opened: null,
					closed: null,
					selected: [4, 2],
					summary: "T"
				}),
				row(9, { historyEntryId: 5 })
			],
			[6, 7, 8]
		)
		expect(historyDaysInCast(v).get(5)).toEqual({
			kind: "scenes",
			summaries: ["T", "A", "B"]
		})
	})
	test("some missed and no kept scene has a usable summary: none, for missing some", () => {
		const v = view(
			[
				row(1, { historyEntryId: 5, summary: null }),
				row(2, { historyEntryId: 5 })
			],
			[1]
		)
		expect(historyDaysInCast(v).get(5)).toEqual({
			kind: "none",
			why: "some"
		})
	})
	test("an open scene and an unresolved cast count as kept", () => {
		const v = view(
			[
				row(1, { historyEntryId: 5, closed: null }),
				row(2, { historyEntryId: 5, castResolved: false })
			],
			[]
		)
		expect(historyDaysInCast(v).get(5)).toEqual({ kind: "whole" })
	})
})

describe("fitSummaries", () => {
	test("fits whole", () => {
		expect(fitSummaries(["ab", "cd"], 10)).toEqual({
			text: "ab\n\ncd",
			cut: false
		})
	})
	test("keeps the start, drops from the end", () => {
		expect(fitSummaries(["aaaa", "bb", "cc"], 8)).toEqual({
			text: "aaaa\n\nbb",
			cut: true
		})
		expect(fitSummaries(["aaaa", "bb", "cc"], 10)).toEqual({
			text: "aaaa\n\nbb",
			cut: true
		})
	})
	test("the first is always kept whole, even alone over the cap", () => {
		expect(fitSummaries(["aaaa", "bb"], 3)).toEqual({
			text: "aaaa",
			cut: true
		})
		expect(fitSummaries(["aaaa"], 1)).toEqual({ text: "aaaa", cut: false })
	})
	test("nothing to fit", () => {
		expect(fitSummaries([], 3)).toEqual({ text: "", cut: false })
	})
})

describe("sentences", () => {
	test("scenes receipt", () => {
		expect(inCastScenesReceipt("Mira", 0)).toBe(
			"No scene summaries left out: Mira is in the cast of every one"
		)
		expect(inCastScenesReceipt("Mira", 1)).toBe(
			"1 scene summary left out: Mira is not in its cast"
		)
		expect(inCastScenesReceipt("Mira", 3)).toBe(
			"3 scene summaries left out: Mira is not in their cast"
		)
	})
	test("history receipt", () => {
		expect(inCastHistoryReceipt("Mira", 0, 0, 0)).toBe(
			"No history entries changed for Mira"
		)
		expect(inCastHistoryReceipt("Mira", 1, 2, 0)).toBe(
			"History for Mira: 1 day shown as the scenes Mira was in, 2 left out"
		)
		expect(inCastHistoryReceipt("Mira", 2, 0, 0)).toBe(
			"History for Mira: 2 days shown as the scenes Mira was in"
		)
		expect(inCastHistoryReceipt("Mira", 0, 1, 0)).toBe(
			"History for Mira: 1 left out"
		)
		expect(inCastHistoryReceipt("Mira", 2, 1, 1)).toBe(
			"History for Mira: 2 days shown as the scenes Mira was in, 1 cut short, 1 left out"
		)
	})
})
