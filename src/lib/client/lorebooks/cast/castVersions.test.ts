import { describe, expect, test } from "vitest"
import { lineOf, MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import {
	castChangesWords,
	castDeleteSentence,
	castLaterCount,
	castNewVersionSave,
	castTakenAt,
	castVersionAt,
	castVersionChip,
	castVersionSave,
	castVersions
} from "./castVersions"

type Row = Sockets.Amendments.CastRow

function row(over: Partial<Row> & { id: number }): Row {
	return {
		castId: 9,
		lorebookId: 4,
		branchId: null,
		personalPosition: null,
		year: 3,
		month: null,
		day: null,
		fields: { summary: "x" },
		columns: {} as Sockets.Lorebooks.CastVersionColumns,
		historyEntryId: null,
		writeOrder: over.id,
		sourceSessionId: null,
		sourceSessionName: null,
		createdAt: "",
		updatedAt: "",
		...over
	}
}

const fork = lineOf(5, [
	{
		id: 5,
		forkedFromBranchId: null,
		forkYear: 10,
		forkMonth: null,
		forkDay: null
	}
])

describe("castVersions", () => {
	test("base first, then dated versions in date order", () => {
		const { versions } = castVersions({
			baseVersionId: 1,
			rows: [row({ id: 3, year: 9 }), row({ id: 2, year: 4 })],
			line: MAIN_LINE
		})
		expect(versions.map((v) => v.key)).toEqual(["beginning", "v:2", "v:3"])
		expect(versions[0]).toMatchObject({
			versionId: 1,
			editIds: [1],
			own: true,
			movable: false
		})
		expect(versions[1]).toMatchObject({
			movable: true,
			chip: null,
			changes: ["summary"]
		})
		expect(versions[1].readHere).toBeUndefined()
	})

	test("a member with no base has no edit ids", () => {
		const { versions } = castVersions({
			baseVersionId: null,
			rows: [],
			line: MAIN_LINE
		})
		expect(versions[0].editIds).toEqual([])
		expect(versions[0].versionId).toBeNull()
	})

	test("a person's and a session's version at one date are two nodes, reader's order", () => {
		const { versions } = castVersions({
			baseVersionId: 1,
			rows: [
				row({
					id: 2,
					writeOrder: 9,
					sourceSessionId: 8,
					sourceSessionName: "Night"
				}),
				row({ id: 3, writeOrder: 4 })
			],
			line: MAIN_LINE
		})
		const dated = versions.slice(1)
		expect(dated.map((v) => v.key)).toEqual(["v:3", "v:2"])
		expect(dated.map((v) => v.readHere)).toEqual([undefined, true])
		expect(dated[1]).toMatchObject({
			locked: true,
			movable: false,
			chip: "written in Night"
		})
		expect(dated[0].chip).toBe("at every point in their life")
	})

	test("two life points at one date: the higher life point is read", () => {
		const { versions } = castVersions({
			baseVersionId: 1,
			rows: [
				row({ id: 2, personalPosition: 5, writeOrder: 1 }),
				row({ id: 3, personalPosition: null, writeOrder: 2 }),
				row({ id: 4, personalPosition: 2, writeOrder: 3 })
			],
			line: MAIN_LINE
		})
		const dated = versions.slice(1)
		expect(dated.map((v) => v.versionId)).toEqual([3, 4, 2])
		expect(dated.at(-1)).toMatchObject({
			readHere: true,
			chip: "at 5 in their life"
		})
	})

	test("a fork: inherited main, its own, and elsewhere", () => {
		const rows = [
			row({ id: 2, year: 4 }),
			row({ id: 3, year: 12 }),
			row({ id: 4, year: 11, branchId: 5 }),
			row({ id: 5, year: 6, branchId: 77 }),
			row({ id: 6, year: 8, personalPosition: 3, branchId: 77 }),
			row({ id: 7, year: 9, branchId: 77, sourceSessionId: 1 })
		]
		const { versions, elsewhere } = castVersions({
			baseVersionId: 1,
			rows,
			line: fork
		})
		expect(versions.map((v) => [v.key, v.own])).toEqual([
			["beginning", false],
			["v:2", false],
			["v:4", true]
		])
		expect(elsewhere.map((r) => r.id)).toEqual([5, 6, 7, 3])
		expect(elsewhere.map((r) => [r.locked, r.chip])).toEqual([
			[false, null],
			[false, "at 3 in their life"],
			[true, "written in a session"],
			[false, null]
		])
	})
})

describe("castVersionChip", () => {
	test("session, life point, both", () => {
		expect(
			castVersionChip(
				row({ id: 1, sourceSessionId: 2, sourceSessionName: "A" })
			)
		).toBe("written in A")
		expect(
			castVersionChip(
				row({ id: 1, sourceSessionId: 2, personalPosition: 4 })
			)
		).toBe("written in a session · at 4 in their life")
		expect(castVersionChip(row({ id: 1 }))).toBe(
			"at every point in their life"
		)
	})
})

describe("castVersionAt", () => {
	const rows = [row({ id: 2, year: 4 }), row({ id: 3, year: 9 })]
	const { versions } = castVersions({
		baseVersionId: 1,
		rows,
		line: MAIN_LINE
	})
	const at = (
		moment: { year: number } | null,
		shown: number | null,
		line = MAIN_LINE
	) =>
		castVersionAt({
			versions,
			rows,
			line,
			moment: moment && { year: moment.year, month: null, day: null },
			shownVersionId: shown
		}).key

	test("at a moment", () => {
		expect(at({ year: 2 }, null)).toBe("beginning")
		expect(at({ year: 5 }, null)).toBe("v:2")
		expect(at({ year: 9 }, null)).toBe("v:3")
	})
	test("now on main follows the shown version", () => {
		expect(at(null, 2)).toBe("v:2")
		expect(at(null, 1)).toBe("beginning")
		expect(at(null, null)).toBe("v:3")
	})
	test("now on a fork reads the line's head", () => {
		const f = castVersions({
			baseVersionId: 1,
			rows: [...rows, row({ id: 4, year: 11, branchId: 5 })],
			line: fork
		})
		expect(
			castVersionAt({
				versions: f.versions,
				rows: [...rows, row({ id: 4, year: 11, branchId: 5 })],
				line: fork,
				moment: null,
				shownVersionId: 2
			}).key
		).toBe("v:4")
		expect(
			castVersionAt({
				versions: f.versions.slice(0, 1),
				rows: [],
				line: fork,
				moment: null,
				shownVersionId: null
			}).key
		).toBe("beginning")
	})
})

describe("castTakenAt", () => {
	const rows = [
		row({ id: 2, year: 4 }),
		row({ id: 3, year: 4, personalPosition: 6 }),
		row({ id: 4, year: 7, sourceSessionId: 1 }),
		row({ id: 5, year: 9 })
	]
	const { versions } = castVersions({
		baseVersionId: 1,
		rows,
		line: MAIN_LINE
	})
	const d = (year: number) => ({ year, month: null, day: null })
	const v = (id: number) => versions.find((x) => x.versionId === id)!

	test("a person's version at the date with the same life point", () => {
		expect(castTakenAt(versions, d(4), null, v(5))?.versionId).toBe(2)
	})
	test("a different life point is not taken", () => {
		expect(castTakenAt(versions, d(4), null, v(3))).toBeNull()
	})
	test("a session-only date is not taken", () => {
		expect(castTakenAt(versions, d(7), null, v(5))).toBeNull()
	})
	test("its own key is ignored", () => {
		expect(castTakenAt(versions, d(4), null, v(2))).toBeNull()
	})
	test("a new version: a person's version at the date with no life point", () => {
		expect(castTakenAt(versions, d(4), null, null)?.versionId).toBe(2)
		expect(castTakenAt(versions, d(7), null, null)).toBeNull()
		expect(castTakenAt(versions, d(4), 9, null)).toBeNull()
	})
})

describe("castLaterCount", () => {
	const rows = [
		row({ id: 2, year: 4 }),
		row({ id: 3, year: 4, writeOrder: 50 }),
		row({ id: 4, year: 9, sourceSessionId: 1 }),
		row({ id: 5, year: 9, branchId: 5 }),
		row({ id: 6, year: 4, writeOrder: 2 })
	]
	const { versions } = castVersions({
		baseVersionId: 1,
		rows,
		line: MAIN_LINE
	})
	test("the base counts every main row", () => {
		expect(castLaterCount(rows, versions[0])).toBe(4)
	})
	test("a dated one counts the rows ordered after it on its line", () => {
		const v2 = versions.find((v) => v.versionId === 2)!
		expect(castLaterCount(rows, v2)).toBe(3) // 3 (higher write order), 4 (later), 6 (same write order, higher id)
		const v3 = versions.find((v) => v.versionId === 3)!
		expect(castLaterCount(rows, v3)).toBe(1)
	})
	test("a same write order counts the higher id", () => {
		const same = [
			row({ id: 2, writeOrder: 1 }),
			row({ id: 3, writeOrder: 1 })
		]
		const { versions: vs } = castVersions({
			baseVersionId: 1,
			rows: same,
			line: MAIN_LINE
		})
		expect(castLaterCount(same, vs.find((v) => v.versionId === 2)!)).toBe(1)
	})
})

describe("saves", () => {
	const { versions } = castVersions({
		baseVersionId: 1,
		rows: [row({ id: 2, fields: { summary: "s", name: "N" } })],
		line: MAIN_LINE
	})
	test("the base: version part and undated part", () => {
		expect(
			castVersionSave(versions[0], { summary: "a", timbre: "t" })
		).toEqual({ undated: { timbre: "t" }, version: { summary: "a" } })
		expect(castVersionSave(versions[0], { ownName: "o" })).toEqual({
			undated: { ownName: "o" },
			version: null
		})
	})
	test("a dated one merges into its own fields", () => {
		expect(castVersionSave(versions[1], { summary: "b" })).toEqual({
			undated: null,
			version: { summary: "b", name: "N" }
		})
	})
	test("a new version", () => {
		expect(castNewVersionSave({ summary: "a", ownNickname: "n" })).toEqual({
			undated: { ownNickname: "n" },
			fields: { summary: "a" }
		})
		expect(castNewVersionSave({})).toEqual({ undated: null, fields: {} })
	})
})

describe("words", () => {
	test("castChangesWords", () => {
		expect(castChangesWords(["summary", "timbre"])).toBe(
			"changes the summary, the voice"
		)
		expect(castChangesWords(["ownName", "ownNickname"])).toBe(
			"changes the name in this book, the nickname in this book"
		)
		expect(castChangesWords([])).toBe("changes nothing")
	})
	test("castDeleteSentence", () => {
		const s = castDeleteSentence("Bianca")
		const rest =
			"From then on Bianca reads as the version before it, and this version's edit history goes with it."
		expect(s("Year 4", null)).toBe(
			`Delete the version dated Year 4? ${rest}`
		)
		expect(s("Year 4", "Fork")).toBe(
			`Delete the version dated Year 4 on Fork? ${rest}`
		)
	})
})
