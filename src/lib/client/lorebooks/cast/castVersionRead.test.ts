import { describe, expect, test } from "vitest"
import { lineOf, MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import {
	afterBaseWrite,
	asVersionAmendments,
	foldMoment,
	readCastVersion,
	withBaseVersion,
	type CastVersionOverlay
} from "./castVersionRead"

/** A cast version in column names; a card-less one by default. */
function columns(
	over: Partial<Sockets.Lorebooks.CastVersionColumns> = {}
): Sockets.Lorebooks.CastVersionColumns {
	return {
		name: "Bianca",
		aliases: [],
		summary: null,
		description: null,
		personality: null,
		scenario: null,
		firstMessage: null,
		alternateGreetings: [],
		groupOnlyGreetings: [],
		exampleDialogues: null,
		faceMediaId: null,
		postHistoryInstructions: null,
		creatorNotes: null,
		likeness: null,
		retold: {},
		ownName: null,
		ownNickname: null,
		timbre: null,
		spriteSet: null,
		nodeState: "active",
		nodeVisibility: "normal",
		characterId: null,
		...over
	}
}

function change(
	id: number,
	year: number,
	cols: Sockets.Lorebooks.CastVersionColumns,
	extra: Partial<CastVersionOverlay> = {}
): CastVersionOverlay {
	return {
		id,
		branchId: null,
		year,
		month: null,
		day: null,
		columns: cols,
		...extra
	}
}

const base = columns({
	personality: "Own words",
	description: "Own description"
})
// The row the server sends: the version in force at the present (Y10).
const carded = columns({
	name: null,
	personality: "Own words",
	description: "From the card",
	characterId: 7
})
const row = {
	id: 1,
	castVersionId: 22,
	...carded,
	// The row's own name: a carded version has none of its own.
	name: "Bianca" as string | null,
	baseColumns: base
}
const changes = [
	change(
		21,
		5,
		columns({ personality: "Y5 words", description: "Own description" })
	),
	change(22, 8, carded)
]
const main = { line: MAIN_LINE }

describe("readCastVersion — a member from their versions", () => {
	test("before the first change reads the base version", () => {
		const read = readCastVersion(
			row,
			changes,
			{ ...main, moment: { year: 2 } },
			{ year: 10 }
		)
		expect(read.personality).toBe("Own words")
		expect(read.description).toBe("Own description")
		expect(read.characterId).toBeNull()
		expect(read.name).toBe("Bianca")
	})

	test("at a moment after a change reads that version whole", () => {
		const y6 = readCastVersion(
			row,
			changes,
			{ ...main, moment: { year: 6 } },
			{ year: 10 }
		)
		expect(y6.personality).toBe("Y5 words")
		expect(y6.characterId).toBeNull()
		const y9 = readCastVersion(
			row,
			changes,
			{ ...main, moment: { year: 9 } },
			{ year: 10 }
		)
		expect(y9.characterId).toBe(7)
		expect(y9.description).toBe("From the card")
		// whole, not a diff: the Y5 personality does not survive the Y8 version
		expect(y9.personality).toBe("Own words")
	})

	test("on main at now reads at the present, and equals the row the server sent", () => {
		const read = readCastVersion(row, changes, main, { year: 10 })
		expect(read).toEqual(row)
	})

	test("a change dated after the present does not apply on main at now", () => {
		const later = [
			...changes,
			change(23, 20, columns({ personality: "Y20 words" }))
		]
		const read = readCastVersion(row, later, main, { year: 10 })
		expect(read.personality).toBe("Own words")
		expect(read).toEqual(row)
		// a moment past it does
		const past = readCastVersion(
			row,
			later,
			{ ...main, moment: { year: 21 } },
			{ year: 10 }
		)
		expect(past.personality).toBe("Y20 words")
	})

	test("with no present, main at now reads the head", () => {
		const later = [
			...changes,
			change(23, 20, columns({ personality: "Y20 words" }))
		]
		expect(readCastVersion(row, later, main, null).personality).toBe(
			"Y20 words"
		)
	})

	test("a branch at now has no present cap, and reads its own versions after the fork", () => {
		const line = lineOf(3, [
			{
				id: 3,
				forkedFromBranchId: null,
				forkYear: 7,
				forkMonth: null,
				forkDay: null
			}
		])
		const fork = [
			...changes,
			change(30, 12, columns({ personality: "Fork words" }), {
				branchId: 3
			})
		]
		// main's Y8 change is past the fork cut (Y7): only the Y5 version of main
		const read = readCastVersion(row, fork, { line }, { year: 10 })
		expect(read.personality).toBe("Fork words")
		const early = readCastVersion(
			row,
			fork,
			{ line, moment: { year: 6 } },
			{ year: 10 }
		)
		expect(early.personality).toBe("Y5 words")
	})

	test("a carded version's null name keeps the row's name; a card-less one's applies", () => {
		const read = readCastVersion(
			row,
			changes,
			{ ...main, moment: { year: 9 } },
			null
		)
		expect(read.name).toBe("Bianca")
		const renamed = [change(40, 3, columns({ name: "Bianca Rossi" }))]
		expect(
			readCastVersion(
				row,
				renamed,
				{ ...main, moment: { year: 4 } },
				null
			).name
		).toBe("Bianca Rossi")
	})

	test("without baseColumns the row is the base", () => {
		const bare = { id: 1, personality: "x", baseColumns: null }
		expect(readCastVersion(bare, [], main, null)).toBe(bare)
	})

	test("per appearance: a life-point change applies only at or past that point", () => {
		const life = [
			change(50, 5, columns({ personality: "Scarred" }), {
				personalPosition: 40
			})
		]
		const at = { ...main, moment: { year: 6 } }
		const filter = (pos: number | null) =>
			life.filter(
				(m) =>
					m.personalPosition == null ||
					pos == null ||
					m.personalPosition <= pos
			)
		expect(readCastVersion(row, filter(34), at, null).personality).toBe(
			"Own words"
		)
		expect(readCastVersion(row, filter(50), at, null).personality).toBe(
			"Scarred"
		)
	})
})

describe("foldMoment", () => {
	test("a moment being read is read; now on main is the present; now on a branch is the head", () => {
		const line = lineOf(3, [{ id: 3, forkedFromBranchId: null }])
		expect(
			foldMoment({ line: MAIN_LINE, moment: { year: 3 } }, { year: 10 })
		).toEqual({ year: 3 })
		expect(foldMoment({ line: MAIN_LINE }, { year: 10 })).toEqual({
			year: 10
		})
		expect(foldMoment({ line: MAIN_LINE }, null)).toBeNull()
		expect(foldMoment({ line }, { year: 10 })).toBeNull()
	})
})

describe("afterBaseWrite", () => {
	test("a write to the base version goes into the base columns", () => {
		const shown = { ...row, castVersionId: 99 }
		const next = afterBaseWrite(shown, changes, { personality: "New" })
		const read = readCastVersion(
			next.row,
			next.overlays,
			{ ...main, moment: { year: 2 } },
			{ year: 10 }
		)
		expect(read.personality).toBe("New")
	})

	test("a write to the shown Changes row goes into that row's columns", () => {
		const next = afterBaseWrite(row, changes, { personality: "New" })
		expect(
			(next.overlays.find((o) => o.id === 22)?.columns as any)
				?.personality
		).toBe("New")
		expect(
			(next.overlays.find((o) => o.id === 21)?.columns as any)
				?.personality
		).toBe("Y5 words")
		expect(
			readCastVersion(next.row, next.overlays, main, { year: 10 })
				.personality
		).toBe("New")
	})

	test("the row's aliases are its own: the base never overwrites them, a change applies them only where it changed them", () => {
		const own = {
			...row,
			aliases: ["Bee", "Card name"],
			baseColumns: columns({ aliases: ["Bee"] })
		}
		expect(withBaseVersion(own).aliases).toEqual(["Bee", "Card name"])
		const unchanged = change(29, 4, columns({ aliases: ["Bee"] }))
		const renamed = change(30, 5, columns({ aliases: ["Bee", "Queen"] }), {
			fields: { aliases: ["Bee", "Queen"] }
		})
		expect(
			readCastVersion(
				own,
				[unchanged],
				{ ...main, moment: { year: 4 } },
				{ year: 10 }
			).aliases
		).toEqual(["Bee", "Card name"])
		expect(
			readCastVersion(
				own,
				[unchanged, renamed],
				{ ...main, moment: { year: 6 } },
				{ year: 10 }
			).aliases
		).toEqual(["Bee", "Queen"])
		expect(asVersionAmendments([unchanged])[0].fields).not.toHaveProperty(
			"aliases"
		)
	})
})
