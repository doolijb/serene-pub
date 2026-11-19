import { describe, expect, it } from "vitest"
import {
	NOTHING_MARKED_RECEIPT,
	judgeEntryKnowledge,
	type KnowledgeDrop,
	knowledgeDropReceipt,
	knowledgeDropOf,
	noteKnowledgeDrop,
	knowledgeReceipt,
	winningTies,
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
	hand: false,
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

	it("says one read's drop, noted on its rows", () => {
		const rows: unknown[] = []
		expect(knowledgeDropOf(rows)).toBeUndefined()
		const drop: KnowledgeDrop = {
			kind: "judged",
			name: "Ana",
			notKnown: 1,
			keptFrom: 0,
			leftOut: [
				{ entryId: 4, cause: "not-known" },
				{ entryId: 5, cause: "not-known" }
			]
		}
		noteKnowledgeDrop(rows, drop)
		expect(knowledgeDropOf(rows)).toBe(drop)
		expect(knowledgeDropReceipt(drop)).toBe(
			"1 entry left out: not known by Ana"
		)
		expect(knowledgeDropReceipt({ kind: "nothing-marked" })).toBe(
			NOTHING_MARKED_RECEIPT
		)
		expect(knowledgeDropReceipt({ kind: "reads-all" })).toBe(
			"Reads everything: not one cast member's turn"
		)
	})

	it("names the kinds", () => {
		for (const k of KNOWLEDGE_KINDS) expect(isKnowledgeKind(k)).toBe(true)
		expect(isKnowledgeKind("member of")).toBe(false)
		expect(isKnowledgeKind(null)).toBe(false)
	})

	describe("winningTies", () => {
		const win = (rows: KnowledgeRowRead[], line: Line = MAIN_LINE) =>
			winningTies({ rows, line, moment: null, timelineOff: false })

		it("a dated tie beats an undated one that is not a hand tie", () => {
			const undated = row({ entryId: 1, kind: "kept_from" })
			const dated = row({ entryId: 1, kind: "was_told", date: year(5) })
			expect(win([undated, dated]).get(1)?.id).toBe(dated.id)
			expect(win([dated, undated]).get(1)?.id).toBe(dated.id)
		})

		it("the later date wins", () => {
			const a = row({ entryId: 1, kind: "knows", date: year(5) })
			const b = row({ entryId: 1, kind: "kept_from", date: year(9) })
			expect(win([b, a]).get(1)?.id).toBe(b.id)
		})

		it("the nearer line wins at one date", () => {
			const main = row({ entryId: 1, kind: "kept_from" })
			const branch = row({ entryId: 1, kind: "knows", branchId: 7 })
			expect(win([main, branch], BRANCH).get(1)?.id).toBe(branch.id)
		})

		it("kept from wins at a tie", () => {
			const knows = row({ entryId: 1, kind: "knows" })
			const kept = row({ entryId: 1, kind: "kept_from" })
			expect(win([knows, kept]).get(1)?.id).toBe(kept.id)
			expect(win([kept, knows]).get(1)?.id).toBe(kept.id)
		})

		it("carries the date only where the Timeline is on", () => {
			const dated = row({ entryId: 1, kind: "knows", date: year(5) })
			const on = win([dated]).get(1)
			expect(on?.date).toEqual(year(5))
			const off = winningTies({
				rows: [dated],
				line: MAIN_LINE,
				moment: null,
				timelineOff: true
			}).get(1)
			expect(off?.id).toBe(dated.id)
			expect(off?.date).toBeNull()
		})

		it("leaves out a row that does not read", () => {
			const late = row({ entryId: 1, kind: "knows", date: year(50) })
			const got = winningTies({
				rows: [late],
				line: MAIN_LINE,
				moment: year(10),
				timelineOff: false
			})
			expect(got.size).toBe(0)
		})
	})
})

describe("a hand tie always wins (D39)", () => {
	const hand = (
		entryId: number,
		kind: "knows" | "kept_from",
		over: Partial<KnowledgeRowRead> = {}
	) => row({ entryId, kind, hand: true, ...over })
	const win = (
		rows: KnowledgeRowRead[],
		o: { line?: Line; moment?: ReturnType<typeof year> | null; off?: boolean } = {}
	) =>
		winningTies({
			rows,
			line: o.line ?? MAIN_LINE,
			moment: o.moment ?? null,
			timelineOff: o.off ?? false
		})

	for (const handKind of ["knows", "kept_from"] as const) {
		for (const play of ["was_told", "has_been_there"] as const) {
			for (const date of [null, year(5)]) {
				it(`hand ${handKind} beats ${play} (${date ? "dated" : "undated"}), either order of writing`, () => {
					const h = hand(1, handKind)
					const p = row({ entryId: 1, kind: play, date })
					// ids both ways: the play tie newer, then older
					const newer = row({ entryId: 1, kind: play, date })
					expect(win([h, p]).get(1)?.id).toBe(h.id)
					expect(win([p, h]).get(1)?.id).toBe(h.id)
					expect(win([newer, h]).get(1)?.id).toBe(h.id)
					const out = judge({ rows: [p, h] }).leftOut
					expect(out.length).toBe(handKind === "kept_from" ? 1 : 0)
				})
			}
		}
	}

	it("hand beats an ordinary tie", () => {
		const ord = row({ entryId: 1, kind: null, date: year(9) })
		const h = hand(1, "kept_from")
		expect(win([ord, h]).get(1)?.id).toBe(h.id)
		expect(judge({ rows: [ord, h] }).keptFrom).toBe(1)
	})

	it("hand beats a dated or branch knows / kept_from", () => {
		const dated = row({
			entryId: 1,
			kind: "knows",
			date: year(50)
		})
		const branched = row({ entryId: 1, kind: "knows", branchId: 7 })
		const h = hand(1, "kept_from")
		expect(win([dated, h]).get(1)?.id).toBe(h.id)
		expect(win([branched, h], { line: BRANCH }).get(1)?.id).toBe(h.id)
		const keptDated = row({ entryId: 1, kind: "kept_from", date: year(60) })
		const k = hand(1, "knows")
		expect(win([keptDated, k]).get(1)?.id).toBe(k.id)
		expect(judge({ rows: [keptDated, k] }).keptFrom).toBe(0)
	})

	it("of two hand ties the notes win, then the newest id", () => {
		const book = hand(1, "kept_from")
		const notes = hand(1, "knows", { inNotes: true })
		expect(win([book, notes]).get(1)?.id).toBe(notes.id)
		expect(win([notes, book]).get(1)?.id).toBe(notes.id)
		const a = hand(2, "kept_from")
		const b = hand(2, "knows")
		expect(win([a, b]).get(2)?.id).toBe(b.id)
		expect(win([b, a]).get(2)?.id).toBe(b.id)
		const older = hand(3, "knows", { id: 1000 })
		const newer = hand(3, "kept_from", { id: 1001 })
		expect(win([newer, older]).get(3)?.id).toBe(1001)
	})

	it("play against play is still by date (unchanged)", () => {
		const a = row({ entryId: 1, kind: "was_told", date: year(5) })
		const b = row({ entryId: 1, kind: "kept_from", date: year(9) })
		expect(win([a, b]).get(1)?.id).toBe(b.id)
	})

	it("the mark and no tie are unchanged", () => {
		expect(judge({ markedEntryIds: [1] }).notKnown).toBe(1)
		expect(
			judge({ markedEntryIds: [1], rows: [hand(1, "knows")] }).leftOut
		).toEqual([])
		expect(
			judge({ markedEntryIds: [1], rows: [hand(1, "kept_from")] }).keptFrom
		).toBe(1)
	})

	it("holds with the Timeline off", () => {
		const h = hand(1, "kept_from")
		const p = row({ entryId: 1, kind: "was_told", date: year(5) })
		expect(win([p, h], { off: true }).get(1)?.id).toBe(h.id)
		const off = judge({ rows: [p, h], timelineOff: true })
		expect(off.keptFrom).toBe(1)
	})
})
