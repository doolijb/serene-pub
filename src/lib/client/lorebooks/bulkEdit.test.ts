import { describe, expect, test } from "vitest"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { LineBranch } from "$lib/shared/lorebooks/lineReading"
import type { TreeRow } from "$lib/shared/lorebooks/moveDownTheTree"
import {
	BULK_LABELS,
	bulkDeleteCopy,
	bulkMoveCount,
	bulkMoveProblem,
	bulkNotCommonCopy,
	bulkReport,
	filedUnderCount,
	planBulk,
	runBulk,
	toggleActions,
	withParentOutcome,
	type BulkAction,
	type BulkRow
} from "./bulkEdit"

const row = (id: number, over: Partial<BulkRow> = {}): BulkRow => ({
	id,
	typeId: "character",
	name: `E${id}`,
	pinned: false,
	off: false,
	archived: false,
	branchId: null,
	listed: true,
	...over
})
const lineName = (id: number | null) => (id == null ? "main" : `line ${id}`)

describe("planBulk", () => {
	test("an unlisted row is skipped for every action with the sentence", () => {
		const actions: BulkAction[] = [
			"beginning",
			"decay",
			"pin",
			"unpin",
			"off",
			"on",
			"archive",
			"unarchive",
			"delete"
		]
		for (const a of actions) {
			const plan = planBulk(a, [row(1, { listed: false, branchId: 4 })], {
				lineName
			})
			expect(plan.send).toEqual([])
			expect(plan.skip).toEqual([
				{
					id: 1,
					name: "E1",
					reason: "On line 4: only Move down the tree… reaches it from here."
				}
			])
		}
	})
	test("History is skipped for beginning, kept for decay", () => {
		const h = row(1, { typeId: HISTORY_TYPE_ID })
		expect(planBulk("beginning", [h], { lineName }).skip[0].reason).toBe(
			"A History entry takes no beginning: its date is its own."
		)
		expect(planBulk("decay", [h], { lineName }).send).toEqual([h])
	})
	test("already as asked is left out of send and skip", () => {
		const cases: [BulkAction, Partial<BulkRow>][] = [
			["pin", { pinned: true }],
			["unpin", {}],
			["off", { off: true }],
			["on", {}],
			["archive", { archived: true }],
			["unarchive", {}]
		]
		for (const [a, over] of cases) {
			const plan = planBulk(a, [row(1, over)], { lineName })
			expect(plan).toEqual({ send: [], skip: [], withParent: [] })
		}
		expect(planBulk("pin", [row(1)], { lineName }).send).toHaveLength(1)
		expect(
			planBulk("on", [row(1, { off: true })], { lineName }).send
		).toHaveLength(1)
	})
	test("delete: a child under a selected parent goes with it, also through an unselected middle", () => {
		const parents = new Map<number, number | null>([
			[1, null],
			[2, 1],
			[3, 9],
			[9, 1]
		])
		const rows = [row(1), row(2), row(3)]
		const plan = planBulk("delete", rows, { lineName, parents })
		expect(plan.send.map((r) => r.id)).toEqual([1])
		expect(plan.withParent.map((r) => r.id)).toEqual([2, 3])
	})
	test("delete without parents sends all", () => {
		expect(
			planBulk("delete", [row(1), row(2)], { lineName }).send
		).toHaveLength(2)
	})
})

describe("planBulk, knowledge", () => {
	test("notCommon leaves out the marked; common leaves out the unmarked, silently", () => {
		const rows = [row(1, { notCommon: true }), row(2)]
		const a = planBulk("notCommon", rows, { lineName })
		expect(a.send.map((r) => r.id)).toEqual([2])
		expect(a.skip).toEqual([])
		const b = planBulk("common", rows, { lineName })
		expect(b.send.map((r) => r.id)).toEqual([1])
		expect(b.skip).toEqual([])
	})
	test("a could-exist-here row is skipped with its sentence; a History entry is sent", () => {
		const far = row(1, { listed: false, branchId: 4 })
		expect(planBulk("notCommon", [far], { lineName }).skip[0].reason).toBe(
			"On line 4: only Move down the tree… reaches it from here."
		)
		const h = row(2, { typeId: HISTORY_TYPE_ID })
		expect(planBulk("notCommon", [h], { lineName }).send).toEqual([h])
	})
})

describe("toggleActions, knowledge", () => {
	test("common only when every listed selected row is marked", () => {
		expect(toggleActions([]).knowledge).toBe("notCommon")
		expect(
			toggleActions([
				row(1, { notCommon: true }),
				row(2, { notCommon: true })
			]).knowledge
		).toBe("common")
		expect(
			toggleActions([row(1, { notCommon: true }), row(2)]).knowledge
		).toBe("notCommon")
		expect(
			toggleActions([
				row(1, { notCommon: true }),
				row(2, { listed: false })
			]).knowledge
		).toBe("common")
	})
	test("labels", () => {
		expect(BULK_LABELS.notCommon).toBe("Mark not common knowledge…")
		expect(BULK_LABELS.common).toBe("Mark common knowledge")
	})
})

describe("bulkNotCommonCopy", () => {
	test("one and many", () => {
		expect(bulkNotCommonCopy(1)).toEqual({
			title: "Mark 1 entry not common knowledge?",
			message:
				"Only the cast members tied to it will read it when they speak; every other cast member stops reading it."
		})
		expect(bulkNotCommonCopy(3)).toEqual({
			title: "Mark 3 entries not common knowledge?",
			message:
				"Only the cast members tied to them will read them when they speak; every other cast member stops reading them."
		})
	})
})

describe("toggleActions", () => {
	test("both ways, none selected = first word", () => {
		expect(toggleActions([])).toEqual({
			pin: "pin",
			off: "off",
			archive: "archive",
			knowledge: "notCommon"
		})
		expect(
			toggleActions([
				row(1, { pinned: true, off: true, archived: true }),
				row(2, { pinned: true, off: true, archived: true })
			])
		).toMatchObject({ pin: "unpin", off: "on", archive: "unarchive" })
		expect(toggleActions([row(1, { pinned: true }), row(2)]).pin).toBe(
			"pin"
		)
	})
	test("unlisted rows are ignored", () => {
		expect(
			toggleActions([
				row(1, { pinned: true, listed: true }),
				row(2, { pinned: false, listed: false })
			]).pin
		).toBe("unpin")
	})
})

describe("runBulk", () => {
	test("sequential; a refusal is kept and the rest go on; a note is kept", async () => {
		const log: string[] = []
		const progress: number[] = []
		const out = await runBulk(
			[row(1), row(2), row(3), row(4)],
			async (r) => {
				log.push(`start ${r.id}`)
				await new Promise((x) => setTimeout(x, 5))
				log.push(`end ${r.id}`)
				if (r.id === 2) throw new Error("Nope.")
				if (r.id === 3) throw "x"
				return r.id === 4 ? "Still decided otherwise." : null
			},
			(n) => progress.push(n)
		)
		expect(log).toEqual([
			"start 1",
			"end 1",
			"start 2",
			"end 2",
			"start 3",
			"end 3",
			"start 4",
			"end 4"
		])
		expect(out.changed).toBe(2)
		expect(out.refused).toEqual([
			{ id: 2, name: "E2", reason: "Nope." },
			{ id: 3, name: "E3", reason: "The entry could not be changed." }
		])
		expect(out.notes).toEqual([
			{ id: 4, name: "E4", reason: "Still decided otherwise." }
		])
		expect(progress).toEqual([1, 2, 3, 4])
	})
})

describe("bulkReport", () => {
	const none = { refused: [], skipped: [], notes: [] }
	test("headlines", () => {
		expect(bulkReport({ changed: 0, ...none }).headline).toBe(
			"No entry changed."
		)
		expect(bulkReport({ changed: 1, ...none }).headline).toBe(
			"1 entry changed."
		)
		expect(bulkReport({ changed: 3, ...none }).headline).toBe(
			"3 entries changed."
		)
	})
	test("lines: skipped, refused, notes", () => {
		const n = (name: string, reason: string) => ({ id: 0, name, reason })
		expect(
			bulkReport({
				changed: 1,
				notes: [n("C", "c")],
				refused: [n("B", "b")],
				skipped: [n("A", "a")]
			}).lines
		).toEqual(["A: a", "B: b", "C: c"])
	})
})

describe("bulkDeleteCopy", () => {
	const tail =
		"Their relationships, amendments and edit history are deleted with them. This cannot be undone."
	test("singular, plain", () => {
		expect(
			bulkDeleteCopy({ count: 1, filedUnder: 0, lines: false })
		).toEqual({
			title: "Delete 1 entry?",
			message: tail
		})
	})
	test("plural with filed-under and lines", () => {
		expect(
			bulkDeleteCopy({ count: 3, filedUnder: 1, lines: true })
		).toEqual({
			title: "Delete 3 entries?",
			message: `1 entry filed under them go too. ${tail} Each goes from every line that reads it, not only this one.`
		})
		expect(
			bulkDeleteCopy({ count: 2, filedUnder: 2, lines: false }).message
		).toBe(`2 entries filed under them go too. ${tail}`)
	})
})

describe("bulkDeleteCopy, filed-under not known", () => {
	test("null says it with no number; 0 says nothing; 2 counts", () => {
		const m = (filedUnder: number | null) =>
			bulkDeleteCopy({ count: 2, filedUnder, lines: false }).message
		expect(m(null)).toMatch(/^Entries filed under them go too\. Their/)
		expect(m(0)).not.toContain("filed under")
		expect(m(2)).toMatch(/^2 entries filed under them go too\./)
	})
})

describe("withParentOutcome", () => {
	const parents = new Map<number, number | null>([
		[1, null],
		[2, 1],
		[3, 2]
	])
	const rows = [
		row(1, { name: "Top" }),
		row(2, { name: "Mid" }),
		row(3, { name: "Low" })
	]
	const run = (refused: number[]) =>
		withParentOutcome({
			send: [rows[0]],
			withParent: [rows[1], rows[2]],
			selected: rows,
			refusedIds: new Set(refused),
			parents
		})
	test("children of a deleted parent went", () => {
		const o = run([])
		expect(o.went.map((r) => r.id)).toEqual([2, 3])
		expect(o.notes).toEqual([])
	})
	test("children of a refused parent are kept, naming the nearest selected ancestor", () => {
		const o = run([1])
		expect(o.went).toEqual([])
		expect(o.notes).toEqual([
			{ id: 2, name: "Mid", reason: "Not deleted: Top was not." },
			{ id: 3, name: "Low", reason: "Not deleted: Mid was not." }
		])
	})
})

describe("bulkMoveCount", () => {
	const t = (
		id: number,
		branchId: number | null,
		anchorEntryId: number | null
	) => ({ id, branchId, anchorEntryId, typeId: "x", name: "n" }) as any
	test("the selection alone", () => {
		expect(bulkMoveCount([1, 2], [t(1, 5, null), t(2, 5, null)])).toBe(2)
	})
	test("entries taken along count once", () => {
		const rows = [t(1, 5, 9), t(9, 5, null), t(2, 5, 1), t(3, 6, 1)]
		expect(bulkMoveCount([1], rows)).toBe(3)
	})
	test("none taken along from main", () => {
		expect(bulkMoveCount([1], [t(1, null, 9), t(9, null, null)])).toBe(1)
	})
})

describe("filedUnderCount", () => {
	test("counts unselected descendants, once, and survives a cycle", () => {
		const parents = new Map<number, number | null>([
			[1, null],
			[2, 1],
			[3, 2],
			[4, 1],
			[5, 6],
			[6, 5]
		])
		expect(filedUnderCount([1], new Set([1, 4]), parents)).toBe(2)
		expect(filedUnderCount([5], new Set([5]), parents)).toBe(1)
	})
})

describe("bulkMoveProblem", () => {
	const branches: LineBranch[] = [
		{ id: 1, forkedFromBranchId: null, forkYear: 3 },
		{ id: 2, forkedFromBranchId: 1, forkYear: 5 }
	]
	const t = (id: number, over: Partial<TreeRow> = {}): TreeRow => ({
		id,
		name: `E${id}`,
		isHistory: false,
		branchId: 2,
		anchorEntryId: null,
		date: null,
		...over
	})
	const words = { lineName, date: () => "d", timeline: true }
	test("empty = null; one line = null", () => {
		expect(bulkMoveProblem([], [], branches, words)).toBeNull()
		expect(
			bulkMoveProblem([1, 2], [t(1), t(2)], branches, words)
		).toBeNull()
	})
	test("two lines", () => {
		expect(
			bulkMoveProblem(
				[1, 2],
				[t(1), t(2, { branchId: 1 })],
				branches,
				words
			)
		).toBe("Move entries from one line at a time.")
	})
	test("a main row", () => {
		expect(
			bulkMoveProblem([1], [t(1, { branchId: null })], branches, words)
		).toBe("E1 is on main, the bottom of the tree.")
	})
	test("a History row", () => {
		expect(
			bulkMoveProblem([1], [t(1, { isHistory: true })], branches, words)
		).toBe(
			"E1 is a History entry. History entries stay on their line, one for each date."
		)
	})
	test("labels", () => {
		expect(BULK_LABELS.off).toBe("Switch off")
	})
})
