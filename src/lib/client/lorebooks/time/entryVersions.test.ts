import { describe, expect, it } from "vitest"
import {
	applyAmendments,
	type Amendment
} from "$lib/shared/lorebooks/amendments"
import { lineOf, MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import { formatDate } from "../sections/historyDates"
import {
	blockedSentence,
	versionDateBounds,
	addVersionBounds,
	carriedFields,
	changesWords,
	editsToVersionLabel,
	entryVersions,
	momentOfVersion,
	otherLinesRead,
	sameEverywherePlan,
	splitNewVersion,
	splitVersionSave,
	takenVersion,
	TAKEN_REDATE_SENTENCE,
	TAKEN_SAVE_SENTENCE,
	versionAt,
	versionDateProblem,
	versionRedlineIds,
	zoneOf
} from "./entryVersions"

type Row = Sockets.Amendments.EntryRow

function row(
	id: number,
	year: number,
	fields: Record<string, unknown>,
	extra: Partial<Row> = {}
): Row {
	return {
		id,
		entryId: 1,
		branchId: null,
		year,
		month: null,
		day: null,
		fields,
		historyEntryId: null,
		createdAt: "",
		updatedAt: "",
		...extra
	}
}

const branches = [
	{
		id: 7,
		forkedFromBranchId: null,
		forkYear: 5,
		forkMonth: null,
		forkDay: null
	},
	{
		id: 8,
		forkedFromBranchId: null,
		forkYear: 2,
		forkMonth: null,
		forkDay: null
	}
]
const line7 = lineOf(7, branches)
const entry = { branchId: null, year: 1, month: null, day: null }

describe("entryVersions", () => {
	it("opens with the beginning, then main's and the line's own at one date, own after main", () => {
		const rows = [
			row(5, 3, { name: "own" }, { branchId: 7 }),
			row(2, 3, { name: "main" }),
			row(3, 2, { content: "early" })
		]
		const { versions } = entryVersions({
			entry,
			amendments: rows,
			line: line7
		})
		expect(versions.map((v) => v.key)).toEqual([
			"beginning",
			"row:3",
			"row:2",
			"row:5"
		])
		expect(versions[0].date).toEqual({ year: 1, month: null, day: null })
		expect(versions[2].own).toBe(false)
		expect(versions[3].own).toBe(true)
	})

	it("fills movable and editIds: one row moves, two rows do not, the beginning has the entry's edits", () => {
		const { versions } = entryVersions({
			entry,
			amendments: [
				row(1, 3, { name: "a" }, { branchId: 7 }),
				row(2, 5, { name: "b" }, { branchId: 7 }),
				row(4, 5, { content: "c" }, { branchId: 7 })
			],
			line: line7
		})
		expect(versions.map((v) => v.movable)).toEqual([false, true, false])
		expect(versions.map((v) => [...v.editIds])).toEqual([
			[null],
			[1],
			[2, 4]
		])
	})

	it("keeps a nearer line's earlier change winning in the fold", () => {
		const rows = [
			row(2, 4, { name: "main" }),
			row(5, 3, { name: "own" }, { branchId: 7 })
		]
		const { versions } = entryVersions({
			entry,
			amendments: rows,
			line: line7
		})
		expect(versions.map((v) => v.key)).toEqual([
			"beginning",
			"row:5",
			"row:2"
		])
		const folded = applyAmendments({ name: "base" }, rows as Amendment[], {
			line: line7
		})
		expect(folded.name).toBe("own")
	})

	it("folds two rows at one date and line into one version, edit row the later", () => {
		const rows = [
			row(9, 3, { content: "b", keys: ["x"] }),
			row(4, 3, { name: "a" })
		]
		const { versions } = entryVersions({
			entry,
			amendments: rows,
			line: MAIN_LINE
		})
		expect(versions).toHaveLength(2)
		expect(versions[1].editRow!.id).toBe(9)
		expect(versions[1].rows.map((r) => r.id)).toEqual([4, 9])
		expect(versions[1].changes).toEqual(["name", "content", "keys"])
		expect(versions[1].key).toBe("row:9")
	})

	it("puts another branch's and past-the-fork rows elsewhere", () => {
		const rows = [
			row(1, 3, { name: "a" }),
			row(2, 4, { name: "b" }, { branchId: 8 }),
			row(3, 6, { name: "main after fork" })
		]
		const { versions, elsewhere } = entryVersions({
			entry,
			amendments: rows,
			line: line7
		})
		expect(versions.map((v) => v.key)).toEqual(["beginning", "row:1"])
		expect(elsewhere.map((r) => r.id)).toEqual([2, 3])
	})

	it("marks a Perpetual beginning with no date", () => {
		const { versions } = entryVersions({
			entry: { branchId: null },
			amendments: [],
			line: MAIN_LINE
		})
		expect(versions[0].date).toBeNull()
	})
})

describe("versionAt agrees with the fold", () => {
	const rows = [
		row(1, 3, { name: "a" }),
		row(2, 6, { name: "b" }, { branchId: 7 }),
		row(3, 4, { name: "c" })
	]
	const { versions } = entryVersions({ entry, amendments: rows, line: line7 })
	const base = { name: "base" }
	for (const moment of [
		null,
		{ year: 1, month: null, day: null },
		{ year: 3, month: null, day: null },
		{ year: 3, month: 5, day: null },
		{ year: 5, month: null, day: null },
		{ year: 9, month: null, day: null }
	]) {
		it(`at ${moment ? moment.year + "/" + moment.month : "now"}`, () => {
			const v = versionAt(versions, moment)
			const at = applyAmendments(base, rows as Amendment[], {
				line: line7,
				moment
			})
			const atVersion = applyAmendments(base, rows as Amendment[], {
				line: line7,
				moment: v.kind === "dated" ? v.date : null
			})
			if (v.kind === "dated") expect(atVersion).toEqual(at)
			else expect(at).toEqual(base)
		})
	}
})

describe("momentOfVersion", () => {
	it("is the date of a dated version and of a dated beginning", () => {
		const { versions } = entryVersions({
			entry,
			amendments: [row(1, 3, {})],
			line: MAIN_LINE
		})
		expect(momentOfVersion(versions, versions[1])).toEqual({
			year: 3,
			month: null,
			day: null
		})
		expect(momentOfVersion(versions, versions[0])).toEqual({
			year: 1,
			month: null,
			day: null
		})
	})
	it("is the year before the first dated version for a Perpetual beginning", () => {
		const { versions } = entryVersions({
			entry: {},
			amendments: [row(1, 3, {})],
			line: MAIN_LINE
		})
		expect(momentOfVersion(versions, versions[0])).toEqual({
			year: 2,
			month: null,
			day: null
		})
	})
	it("is null for a Perpetual entry with no dated version", () => {
		const { versions } = entryVersions({
			entry: {},
			amendments: [],
			line: MAIN_LINE
		})
		expect(momentOfVersion(versions, versions[0])).toBeNull()
	})
})

describe("zones and splits", () => {
	const { versions } = entryVersions({
		entry,
		amendments: [
			row(1, 3, { name: "a", keys: ["k"] }),
			row(2, 5, { content: "c" })
		],
		line: MAIN_LINE
	})
	const carried = carriedFields(versions)
	const none = new Set<string>()

	it("reads carried fields and zones", () => {
		expect([...carried].sort()).toEqual(["content", "keys", "name"])
		expect(zoneOf("keys", carried, none)).toBe("version")
		expect(zoneOf("enabled", carried, none)).toBe("entry")
		expect(zoneOf("enabled", carried, new Set(["enabled"]))).toBe("version")
	})

	it("sends date parts and decay to the entry with a dated version selected", () => {
		const out = splitVersionSave({
			diff: {
				year: 2,
				decayRate: 1,
				enabled: false,
				name: "n",
				keys: ["z"]
			},
			draft: {},
			selected: versions[1],
			carried,
			promoted: none
		})
		expect(out.entryPatch).toEqual({
			year: 2,
			decayRate: 1,
			enabled: false
		})
		expect(out.versionFields).toEqual({ name: "n", keys: ["z"] })
	})

	it("merges over the edited row's fields and writes promoted keys", () => {
		const out = splitVersionSave({
			diff: { content: "x" },
			draft: { enabled: false, content: "x" },
			selected: versions[2],
			carried,
			promoted: new Set(["enabled"])
		})
		expect(out.entryPatch).toBeNull()
		expect(out.versionFields).toEqual({ content: "x", enabled: false })
	})

	it("gives everything to the entry at the beginning, versionFields null", () => {
		const out = splitVersionSave({
			diff: { name: "n", keys: ["a"] },
			draft: {},
			selected: versions[0],
			carried,
			promoted: none
		})
		expect(out).toEqual({
			entryPatch: { name: "n", keys: ["a"] },
			versionFields: null
		})
	})

	it("splits a new version, allowing no fields", () => {
		expect(
			splitNewVersion({ diff: {}, draft: {}, carried, promoted: none })
		).toEqual({ entryPatch: null, fields: {} })
		expect(
			splitNewVersion({
				diff: { month: 2, name: "n" },
				draft: { constant: true },
				carried,
				promoted: new Set(["constant"])
			})
		).toEqual({
			entryPatch: { month: 2 },
			fields: { name: "n", constant: true }
		})
	})
})

describe("bounds and sentences", () => {
	const { versions } = entryVersions({
		entry,
		amendments: [row(1, 3, {}), row(2, 6, {})],
		line: MAIN_LINE
	})
	const d = (year: number) => ({ year, month: null, day: null })

	it("bounds a gap under a version, and the end", () => {
		expect(addVersionBounds(versions, versions[1])).toEqual({
			after: d(3),
			before: d(6),
			beginning: d(1)
		})
		expect(addVersionBounds(versions, versions[2]).before).toBeNull()
		expect(addVersionBounds(versions, versions[0]).after).toEqual(d(1))
		expect(versionDateBounds(versions)).toEqual({
			after: null,
			before: null,
			beginning: d(1)
		})
	})

	it("says each problem", () => {
		const b = addVersionBounds(versions, versions[1])
		expect(versionDateProblem(d(0), b)).toBe(
			`This entry began at ${formatDate(d(1))}, so a version can't be dated before it.`
		)
		expect(versionDateProblem(d(7), b)).toBe(
			`Pick a date after ${formatDate(d(3))} and before ${formatDate(d(6))}.`
		)
		expect(versionDateProblem(d(3), b)).not.toBeNull()
		expect(versionDateProblem(d(4), b)).toBeNull()
		expect(
			versionDateProblem(d(2), addVersionBounds(versions, versions[2]))
		).toBe(`Pick a date after ${formatDate(d(6))}.`)
		expect(
			versionDateProblem(d(5), {
				after: null,
				before: d(4),
				beginning: null
			})
		).toBe(`Pick a date before ${formatDate(d(4))}.`)
		expect(versionDateProblem(d(2), versionDateBounds(versions))).toBeNull()
	})

	it("names the taken sentences", () => {
		expect(TAKEN_SAVE_SENTENCE(d(3))).toBe(
			`${formatDate(d(3))} already has a version on this line. Saving changes that version.`
		)
		expect(TAKEN_REDATE_SENTENCE(d(3))).toMatch(/Pick another date\.$/)
	})
})

describe("takenVersion", () => {
	it("ignores inherited rows", () => {
		const { versions } = entryVersions({
			entry,
			amendments: [row(1, 3, {}), row(2, 4, {}, { branchId: 7 })],
			line: line7
		})
		const d = (year: number) => ({ year, month: null, day: null })
		expect(takenVersion(versions, d(3), 7)).toBeNull()
		expect(takenVersion(versions, d(3), null)!.key).toBe("row:1")
		expect(takenVersion(versions, d(4), 7)!.key).toBe("row:2")
	})
})

describe("sameEverywherePlan", () => {
	it("rewrites own carriers and keeps other keys", () => {
		const { versions } = entryVersions({
			entry,
			amendments: [
				row(1, 3, { keys: ["a"], name: "n" }, { branchId: 7 }),
				row(2, 4, { name: "m" }, { branchId: 7 })
			],
			line: line7
		})
		const plan = sameEverywherePlan("keys", versions, ["z"])
		expect(plan.rewrites).toEqual([{ id: 1, fields: { name: "n" } }])
		expect(plan.versionsChanged).toBe(1)
		expect(plan.entryPatch).toEqual({ keys: ["z"] })
		expect(plan.blockedBy).toBeNull()
	})
	it("is blocked by an inherited carrier", () => {
		const { versions } = entryVersions({
			entry,
			amendments: [row(1, 3, { keys: ["a"] })],
			line: line7
		})
		const plan = sameEverywherePlan("keys", versions, ["z"])
		expect(plan.blockedBy!.key).toBe("row:1")
		expect(blockedSentence(plan.blockedBy!, "Main")).toBe(
			`Main's version of ${formatDate({ year: 3, month: null, day: null })} sets it too, so it differs by version there.`
		)
	})
})

describe("otherLinesRead", () => {
	it("tests branches other than the entry's own", () => {
		expect(otherLinesRead({ branchId: null, year: 1 }, [])).toBe(false)
		expect(otherLinesRead({ branchId: null, year: 1 }, branches)).toBe(true)
		expect(otherLinesRead({ branchId: 7, year: 1 }, [branches[0]])).toBe(
			false
		)
		// Dated past the fork of branch 8 (year 2) and 7 (year 5): neither reads it.
		expect(otherLinesRead({ branchId: null, year: 9 }, branches)).toBe(
			false
		)
	})
})

describe("changesWords", () => {
	it("names fields in the reader's words", () => {
		expect(changesWords(["keys", "enabled", "anchorEntryId"])).toBe(
			"changes triggers, on or off, part of"
		)
		expect(changesWords(["weird"])).toBe("changes weird")
		expect(changesWords([])).toBe("changes nothing")
	})
})

describe("edit history of a version", () => {
	it("words the scoped fold", () => {
		expect(editsToVersionLabel(2)).toBe("Edits to this version · 2")
	})

	it("owns null for the beginning and the rows' ids for a dated version", () => {
		const { versions } = entryVersions({
			entry: { year: 1 },
			amendments: [row(4, 7, { name: "a" }), row(9, 7, { content: "b" })],
			line: MAIN_LINE
		})
		expect(versionRedlineIds(versions[0])).toEqual([null])
		expect(versionRedlineIds(versions[1])).toEqual([4, 9])
	})
})
