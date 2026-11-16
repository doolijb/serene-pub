import { describe, expect, it } from "vitest"
import {
	KNOWLEDGE_SOURCES,
	NOTHING_MARKED_RECEIPT,
	judgeEntryKnowledge,
	knowledgeExclusionReason,
	knowledgeExclusions,
	knowledgeReceipt,
	type KnowledgeRowRead
} from "./entryKnowledge"
import { MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import {
	KNOWLEDGE_KINDS,
	isKnowledgeKind
} from "$lib/shared/lorebooks/knowledgeKinds"

let n = 0
const row = (
	over: Partial<KnowledgeRowRead> & { entryId: number }
): KnowledgeRowRead => ({
	id: ++n,
	kind: null,
	branchId: null,
	date: null,
	inNotes: false,
	...over
})
const year = (y: number) => ({ year: y, month: null, day: null })
// Branch 7 forked from main at year 100.
const BRANCH: Line = {
	branchId: 7,
	steps: [
		{ branchId: 7, cut: null },
		{ branchId: null, cut: year(100) }
	]
}
const judge = (
	over: Partial<Parameters<typeof judgeEntryKnowledge>[0]> & {
		rows?: KnowledgeRowRead[]
	}
) =>
	judgeEntryKnowledge({
		markedEntryIds: [],
		rows: [],
		line: MAIN_LINE,
		moment: null,
		timelineOff: false,
		...over
	})

describe("judgeEntryKnowledge", () => {
	it("leaves nothing out when nothing is marked", () => {
		expect(judge({ rows: [row({ entryId: 1 })] })).toEqual({
			leftOut: [],
			notKnown: 0,
			keptFrom: 0
		})
	})

	it("leaves out a marked entry with no tie", () => {
		expect(judge({ markedEntryIds: [2, 1] })).toEqual({
			leftOut: [
				{ entryId: 1, cause: "not-known" },
				{ entryId: 2, cause: "not-known" }
			],
			notKnown: 2,
			keptFrom: 0
		})
	})

	it("lets a marked entry in through an ordinary tie and through every knowing kind", () => {
		for (const kind of [
			null,
			"was_told",
			"knows",
			"has_been_there"
		] as const) {
			expect(
				judge({
					markedEntryIds: [1],
					rows: [row({ entryId: 1, kind })]
				}).leftOut
			).toEqual([])
		}
	})

	it("leaves out an unmarked entry kept from the member", () => {
		expect(
			judge({ rows: [row({ entryId: 1, kind: "kept_from" })] })
		).toEqual({
			leftOut: [{ entryId: 1, cause: "kept-from" }],
			notKnown: 0,
			keptFrom: 1
		})
	})

	it("gives a marked entry a winning kept-from cause", () => {
		const out = judge({
			markedEntryIds: [1],
			rows: [row({ entryId: 1, kind: "kept_from" })]
		})
		expect(out.leftOut).toEqual([{ entryId: 1, cause: "kept-from" }])
	})

	it("lets the later date win, undated being earliest", () => {
		const knowsLater = [
			row({ entryId: 1, kind: "kept_from", date: year(10) }),
			row({ entryId: 1, kind: "knows", date: year(20) })
		]
		expect(
			judge({ markedEntryIds: [1], rows: knowsLater }).leftOut
		).toEqual([])
		const keptLater = [
			row({ entryId: 1, kind: "knows", date: year(10) }),
			row({ entryId: 1, kind: "kept_from", date: year(20) })
		]
		expect(judge({ rows: keptLater }).leftOut).toEqual([
			{ entryId: 1, cause: "kept-from" }
		])
		const undated = [
			row({ entryId: 1, kind: "kept_from" }),
			row({ entryId: 1, kind: "knows", date: year(1) })
		]
		expect(judge({ markedEntryIds: [1], rows: undated }).leftOut).toEqual(
			[]
		)
	})

	it("lets the nearer line win at one date", () => {
		const rows = [
			row({
				entryId: 1,
				kind: "kept_from",
				branchId: null,
				date: year(50)
			}),
			row({ entryId: 1, kind: "knows", branchId: 7, date: year(50) })
		]
		expect(
			judge({ markedEntryIds: [1], rows, line: BRANCH }).leftOut
		).toEqual([])
		const flipped = [
			row({ entryId: 1, kind: "knows", branchId: null, date: year(50) }),
			row({ entryId: 1, kind: "kept_from", branchId: 7, date: year(50) })
		]
		expect(judge({ rows: flipped, line: BRANCH }).leftOut).toEqual([
			{ entryId: 1, cause: "kept-from" }
		])
	})

	it("lets kept-from win at one date on one line", () => {
		const rows = [
			row({ entryId: 1, kind: "knows", date: year(5) }),
			row({ entryId: 1, kind: "kept_from", date: year(5) })
		]
		expect(judge({ markedEntryIds: [1], rows }).leftOut).toEqual([
			{ entryId: 1, cause: "kept-from" }
		])
	})

	it("lets a notes tie be nearest at one date", () => {
		const rows = [
			row({ entryId: 1, kind: "kept_from", date: year(5) }),
			row({ entryId: 1, kind: "knows", date: year(5), inNotes: true })
		]
		expect(judge({ markedEntryIds: [1], rows }).leftOut).toEqual([])
	})

	it("judges a notes tie by the moment alone, not by its branch", () => {
		const rows = [
			row({ entryId: 1, kind: "knows", branchId: 99, inNotes: true })
		]
		expect(judge({ markedEntryIds: [1], rows }).leftOut).toEqual([])
		const late = [
			row({ entryId: 1, kind: "knows", date: year(30), inNotes: true })
		]
		expect(
			judge({ markedEntryIds: [1], rows: late, moment: year(20) }).leftOut
		).toEqual([{ entryId: 1, cause: "not-known" }])
		// With the own book as the reading, its rows are judged like any other.
		expect(
			judge({ markedEntryIds: [1], rows, ownBookIsReading: true }).leftOut
		).toEqual([{ entryId: 1, cause: "not-known" }])
	})

	it("ignores a tie on a line the reply does not read", () => {
		const rows = [row({ entryId: 1, kind: "knows", branchId: 7 })]
		expect(judge({ markedEntryIds: [1], rows }).leftOut).toEqual([
			{ entryId: 1, cause: "not-known" }
		])
	})

	it("ignores a tie dated after the reply's moment, and a fork's later rows", () => {
		const rows = [row({ entryId: 1, kind: "knows", date: year(30) })]
		expect(
			judge({ markedEntryIds: [1], rows, moment: year(20) }).leftOut
		).toEqual([{ entryId: 1, cause: "not-known" }])
		const main = [
			row({ entryId: 1, kind: "knows", branchId: null, date: year(150) })
		]
		expect(
			judge({ markedEntryIds: [1], rows: main, line: BRANCH }).leftOut
		).toEqual([{ entryId: 1, cause: "not-known" }])
		const undated = [row({ entryId: 1, kind: "knows", branchId: null })]
		expect(
			judge({ markedEntryIds: [1], rows: undated, line: BRANCH }).leftOut
		).toEqual([])
	})

	it("ignores dates with the Timeline off, lines still applying", () => {
		const rows = [
			row({
				entryId: 1,
				kind: "kept_from",
				branchId: null,
				date: year(200)
			}),
			row({ entryId: 1, kind: "knows", branchId: 7, date: year(1) })
		]
		expect(
			judge({
				markedEntryIds: [1],
				rows,
				line: BRANCH,
				timelineOff: true
			}).leftOut
		).toEqual([])
		const after = [row({ entryId: 1, kind: "knows", date: year(30) })]
		expect(
			judge({
				markedEntryIds: [1],
				rows: after,
				moment: year(20),
				timelineOff: true
			}).leftOut
		).toEqual([])
		const offLine = [row({ entryId: 1, kind: "knows", branchId: 7 })]
		expect(
			judge({ markedEntryIds: [1], rows: offLine, timelineOff: true })
				.leftOut
		).toEqual([{ entryId: 1, cause: "not-known" }])
	})

	it("counts each cause", () => {
		const out = judge({
			markedEntryIds: [1, 2],
			rows: [
				row({ entryId: 2, kind: "kept_from" }),
				row({ entryId: 3, kind: "kept_from" })
			]
		})
		expect(out).toMatchObject({ notKnown: 1, keptFrom: 2 })
	})
})

describe("sentences", () => {
	it("spells the reasons and receipts", () => {
		expect(knowledgeExclusionReason("not-known", "Ana")).toBe(
			"Not known by Ana."
		)
		expect(knowledgeExclusionReason("kept-from", "Ana")).toBe(
			"Kept from Ana."
		)
		expect(knowledgeReceipt("Ana", { notKnown: 0, keptFrom: 0 })).toBe(
			"No entries left out for Ana"
		)
		expect(knowledgeReceipt("Ana", { notKnown: 1, keptFrom: 0 })).toBe(
			"1 entry left out: not known by Ana"
		)
		expect(knowledgeReceipt("Ana", { notKnown: 3, keptFrom: 0 })).toBe(
			"3 entries left out: not known by Ana"
		)
		expect(knowledgeReceipt("Ana", { notKnown: 0, keptFrom: 1 })).toBe(
			"1 entry left out: kept from Ana"
		)
		expect(knowledgeReceipt("Ana", { notKnown: 0, keptFrom: 2 })).toBe(
			"2 entries left out: kept from Ana"
		)
		expect(knowledgeReceipt("Ana", { notKnown: 2, keptFrom: 1 })).toBe(
			"3 entries left out: 2 not known by Ana, 1 kept from Ana"
		)
		expect(NOTHING_MARKED_RECEIPT).toBe(
			"No entries left out: nothing here is marked not common knowledge or kept from anyone"
		)
	})

	it("spells every source for every left-out entry", () => {
		const out = knowledgeExclusions(
			[
				{ entryId: 4, cause: "not-known" },
				{ entryId: 5, cause: "kept-from" }
			],
			"Ana"
		)
		expect(KNOWLEDGE_SOURCES).toEqual([
			"worldLore",
			"characterLore",
			"history"
		])
		expect(out).toHaveLength(6)
		for (const source of KNOWLEDGE_SOURCES) {
			expect(out).toContainEqual({
				source,
				id: 4,
				reason: "Not known by Ana."
			})
			expect(out).toContainEqual({
				source,
				id: 5,
				reason: "Kept from Ana."
			})
		}
	})

	it("names the kinds", () => {
		for (const k of KNOWLEDGE_KINDS) expect(isKnowledgeKind(k)).toBe(true)
		expect(isKnowledgeKind("member of")).toBe(false)
		expect(isKnowledgeKind(null)).toBe(false)
	})
})
