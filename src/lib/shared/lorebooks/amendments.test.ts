import { describe, expect, test } from "vitest"
import {
	amendmentDateProblem,
	amendmentsAfter,
	amendmentsAsOf,
	applyAmendments,
	changedFields,
	ENTRY_DATE_PARTS,
	NEVER_AMENDED,
	compareLines,
	offWindowAmendments,
	offWindowProblem,
	castAsOf,
	entryAsOf,
	groupAmendments,
	type Amendment
} from "./amendments"
import { isOnLine, lineOf, MAIN_LINE, rowsReadingOnLine } from "./lineReading"
import { compareDates, dateValue, type StoryDate } from "./storyDate"

const am = (over: Partial<Amendment> & Pick<Amendment, "id" | "year">) =>
	({ branchId: null, fields: {}, ...over }) as Amendment

/** Branch `branchId` off main, at `forkedAt` (absent: at now, no cut). */
const on = (branchId: number | null, forkedAt?: StoryDate) =>
	lineOf(
		branchId,
		branchId == null
			? []
			: [
					{
						id: branchId,
						forkYear: forkedAt?.year ?? null,
						forkMonth: forkedAt?.month ?? null,
						forkDay: forkedAt?.day ?? null
					}
				]
	)

const entry = { id: 1, name: "Verity", content: "A keeper.", enabled: true }

describe("precedence", () => {
	test("the base reads through where nothing has happened", () => {
		expect(entryAsOf(entry, [], {})).toEqual(entry)
	})

	test("an amendment overlays only the keys it names", () => {
		const out = entryAsOf(entry, [
			am({ id: 1, year: 2, fields: { content: "Newly named Keeper." } })
		])
		expect(out).toEqual({ ...entry, content: "Newly named Keeper." })
	})

	test("later wins per field, per key", () => {
		const out = entryAsOf(entry, [
			am({ id: 1, year: 2, fields: { content: "Second", name: "V" } }),
			am({ id: 2, year: 3, fields: { content: "Third" } })
		])
		expect(out.content).toBe("Third")
		// Y3 said nothing about the name, so Y2's rename stands.
		expect(out.name).toBe("V")
	})

	test("a tie on the date breaks on id, so two reads agree", () => {
		const a = [
			am({ id: 9, year: 2, month: 3, fields: { content: "nine" } }),
			am({ id: 4, year: 2, month: 3, fields: { content: "four" } })
		]
		expect(entryAsOf(entry, a).content).toBe("nine")
		expect(entryAsOf(entry, [...a].reverse()).content).toBe("nine")
	})

	test("the branch wins over main at the same date", () => {
		const out = entryAsOf(
			entry,
			[
				am({ id: 1, year: 3, fields: { content: "main" } }),
				am({
					id: 2,
					year: 3,
					branchId: 7,
					fields: { content: "branch" }
				})
			],
			{ line: on(7) }
		)
		expect(out.content).toBe("branch")
	})

	test("the branch wins even when main's amendment is LATER", () => {
		// Main is applied as a group first, then the branch as a group. A
		// branch is a different story, not a later edit to the same one.
		const out = entryAsOf(
			entry,
			[
				am({ id: 1, year: 9, fields: { content: "main, much later" } }),
				am({
					id: 2,
					year: 3,
					branchId: 7,
					fields: { content: "branch" }
				})
			],
			{ line: on(7) }
		)
		expect(out.content).toBe("branch")
	})
})

describe("the moment", () => {
	const three = [
		am({ id: 1, year: 2, fields: { content: "at Y2" } }),
		am({ id: 2, year: 4, fields: { content: "at Y4" } }),
		am({ id: 3, year: 6, fields: { content: "at Y6" } })
	]

	test("only what has happened by then applies", () => {
		expect(entryAsOf(entry, three, { moment: { year: 4 } }).content).toBe(
			"at Y4"
		)
	})

	test("an amendment dated exactly at the moment HAS happened", () => {
		expect(entryAsOf(entry, three, { moment: { year: 2 } }).content).toBe(
			"at Y2"
		)
	})

	test("before the first one, the base still reads", () => {
		expect(entryAsOf(entry, three, { moment: { year: 1 } })).toEqual(entry)
	})

	test("now applies every dated amendment, however far ahead", () => {
		// The future does not exist in a book — only dated and undated.
		expect(entryAsOf(entry, three, {}).content).toBe("at Y6")
		expect(entryAsOf(entry, three, { moment: null }).content).toBe("at Y6")
	})

	test("a partial date sorts before a fuller one in the same year", () => {
		const out = entryAsOf(entry, [
			am({ id: 1, year: 2, month: 5, fields: { content: "Y2 M5" } }),
			am({ id: 2, year: 2, fields: { content: "Y2, unsaid" } })
		])
		expect(out.content).toBe("Y2 M5")
	})
})

describe("branch isolation", () => {
	const mixed = [
		am({ id: 1, year: 2, fields: { content: "main Y2" } }),
		am({ id: 2, year: 4, branchId: 7, fields: { content: "branch 7" } }),
		am({ id: 3, year: 4, branchId: 8, fields: { content: "branch 8" } })
	]

	test("reading main ignores every branch", () => {
		expect(entryAsOf(entry, mixed, { line: MAIN_LINE }).content).toBe(
			"main Y2"
		)
	})

	test("reading a branch sees main plus its own, and no sibling's", () => {
		expect(entryAsOf(entry, mixed, { line: on(7) }).content).toBe(
			"branch 7"
		)
		expect(entryAsOf(entry, mixed, { line: on(8) }).content).toBe(
			"branch 8"
		)
	})

	test("without a fork date, all of main reaches the branch", () => {
		const out = entryAsOf(
			entry,
			[
				am({ id: 1, year: 9, fields: { name: "main renamed at Y9" } }),
				am({ id: 2, year: 4, branchId: 7, fields: { content: "b" } })
			],
			{ line: on(7) }
		)
		expect(out.name).toBe("main renamed at Y9")
	})

	test("a fork date cuts main off at the fork", () => {
		// The reading under which a branch is insulated from what main went on
		// to do. Flagged in the module as needing a ruling.
		const out = entryAsOf(
			entry,
			[
				am({ id: 1, year: 2, fields: { name: "before the fork" } }),
				am({
					id: 2,
					year: 9,
					fields: { name: "main, after the fork" }
				}),
				am({ id: 3, year: 4, branchId: 7, fields: { content: "b" } })
			],
			{ line: on(7, { year: 5 }) }
		)
		expect(out.name).toBe("before the fork")
	})

	test("the fork never extends past the moment being read", () => {
		const out = entryAsOf(
			entry,
			[am({ id: 1, year: 4, fields: { name: "main Y4" } })],
			{ line: on(7, { year: 9 }), moment: { year: 2 } }
		)
		expect(out.name).toBe("Verity")
	})
})

describe("absent versus null", () => {
	test("a key set to null CLEARS the field", () => {
		const out = entryAsOf(entry, [
			am({ id: 1, year: 2, fields: { content: null } })
		])
		expect(out.content).toBeNull()
	})

	test("a key the amendment omits passes through", () => {
		const out = entryAsOf(entry, [
			am({ id: 1, year: 2, fields: { name: "V" } })
		])
		expect(out.content).toBe("A keeper.")
	})

	test("a time RANGE is two amendments, and reads correctly at three points", () => {
		// The mechanism the design names: off at one date, on at another.
		const window = [
			am({ id: 1, year: 3, fields: { enabled: false } }),
			am({ id: 2, year: 6, fields: { enabled: true } })
		]
		expect(entryAsOf(entry, window, { moment: { year: 2 } }).enabled).toBe(
			true
		)
		expect(entryAsOf(entry, window, { moment: { year: 4 } }).enabled).toBe(
			false
		)
		expect(entryAsOf(entry, window, { moment: { year: 7 } }).enabled).toBe(
			true
		)
	})
})

describe("it does not mutate", () => {
	test("the base is left alone", () => {
		const base = { ...entry }
		entryAsOf(base, [am({ id: 1, year: 2, fields: { content: "x" } })])
		expect(base.content).toBe("A keeper.")
	})

	test("with nothing to apply it hands back the same object", () => {
		const base = { ...entry }
		expect(entryAsOf(base, [], {})).toBe(base)
	})
})

describe("amendmentsAsOf", () => {
	test("returns them in the order they will be applied", () => {
		const list = amendmentsAsOf(
			[
				am({ id: 1, year: 6, branchId: 7 }),
				am({ id: 2, year: 4 }),
				am({ id: 3, year: 2 })
			],
			{ line: on(7) }
		)
		expect(list.map((a) => a.id)).toEqual([3, 2, 1])
	})
})

describe("amendmentsAfter", () => {
	test("names what has not happened yet at this moment", () => {
		const later = amendmentsAfter(
			[
				am({ id: 1, year: 2 }),
				am({ id: 2, year: 7 }),
				am({ id: 3, year: 9 })
			],
			{ moment: { year: 4 } }
		)
		expect(later.map((a) => a.id)).toEqual([2, 3])
	})

	test("at now, nothing is still to come", () => {
		expect(amendmentsAfter([am({ id: 1, year: 9 })], {})).toEqual([])
	})

	test("a sibling branch's future is not ours", () => {
		const later = amendmentsAfter([am({ id: 1, year: 9, branchId: 8 })], {
			moment: { year: 1 },
			line: on(7)
		})
		expect(later).toEqual([])
	})
})

describe("castAsOf", () => {
	test("a cast member reads as-of exactly as an entry does", () => {
		const card = { id: 3, name: "Verity", description: "A novice." }
		const out = castAsOf(
			card,
			[
				am({
					id: 1,
					year: 5,
					fields: { description: "Keeper of the marrow." }
				})
			],
			{ moment: { year: 6 } }
		)
		expect(out.description).toBe("Keeper of the marrow.")
	})
})

describe("groupAmendments", () => {
	test("slices a book's amendments by the id they hang off", () => {
		const rows = [
			{ id: 1, entryId: 10, year: 2 },
			{ id: 2, entryId: 10, year: 3 },
			{ id: 3, entryId: 11, year: 2 }
		]
		const by = groupAmendments(rows, "entryId")
		expect(by.get(10)?.map((r) => r.id)).toEqual([1, 2])
		expect(by.get(11)?.map((r) => r.id)).toEqual([3])
		expect(by.get(99)).toBeUndefined()
	})
})

describe("applyAmendments is the same function underneath", () => {
	test("entry and character wrappers agree with it", () => {
		const a = [am({ id: 1, year: 2, fields: { name: "X" } })]
		expect(entryAsOf(entry, a)).toEqual(applyAmendments(entry, a))
		expect(castAsOf(entry, a)).toEqual(applyAmendments(entry, a))
	})
})

describe("changedFields", () => {
	const pristine = {
		id: 1,
		lorebookId: 2,
		name: "Verity",
		content: "A novice.",
		enabled: true,
		keys: "verity"
	}

	test("names only what moved", () => {
		expect(
			changedFields({ ...pristine, content: "A keeper." }, pristine)
		).toEqual({ content: "A keeper." })
	})

	test("an untouched draft says nothing, which is a refusal", () => {
		expect(changedFields({ ...pristine }, pristine)).toEqual({})
	})

	test("identity and bookkeeping are never amendable", () => {
		// An entry that is a different row at Y2 is a different entry.
		const out = changedFields(
			{
				...pristine,
				id: 99,
				lorebookId: 7,
				typeId: "other",
				position: 4,
				updatedAt: "later",
				name: "V"
			},
			pristine
		)
		expect(out).toEqual({ name: "V" })
	})

	test("clearing a field is a change, and survives as null", () => {
		const out = changedFields({ ...pristine, content: null }, pristine)
		expect(out).toEqual({ content: null })
		expect("content" in out).toBe(true)
	})

	test("false is a value, not an absence", () => {
		expect(
			changedFields({ ...pristine, enabled: false }, pristine)
		).toEqual({ enabled: false })
	})

	test("an equal array is not a change", () => {
		const a = { ...pristine, tags: ["a", "b"] }
		const b = { ...pristine, tags: ["a", "b"] }
		expect(changedFields(a, b)).toEqual({})
		expect(changedFields({ ...a, tags: ["a"] }, b)).toEqual({ tags: ["a"] })
	})

	test("what it produces is what the resolver consumes", () => {
		// The round trip the two halves promise each other: diff a draft, file
		// it as an amendment, read it back, and the read equals the draft.
		const draft = { ...pristine, content: "A keeper.", enabled: false }
		const fields = changedFields(draft, pristine)
		const read = entryAsOf(pristine, [am({ id: 1, year: 4, fields })], {
			moment: { year: 5 }
		})
		expect(read).toEqual(draft)
	})
})

describe("a date is part of the entry, never of an amendment (A18(b))", () => {
	const history = { id: 3, year: 4, month: 2, day: 9, content: "The flood." }

	test("the date parts are never amended", () => {
		for (const part of ENTRY_DATE_PARTS) expect(NEVER_AMENDED.has(part)).toBe(true)
		expect([...ENTRY_DATE_PARTS]).toEqual(["year", "month", "day"])
	})

	test("a re-date is still a change of the entry: the diff names it, for Change the base", () => {
		expect(changedFields({ ...history, year: 5, month: null }, history)).toEqual({
			year: 5,
			month: null
		})
	})

	test("an amendment naming a date part is refused in a sentence; one naming none is not", () => {
		expect(amendmentDateProblem({ content: "Later." })).toBeNull()
		expect(amendmentDateProblem({ day: 3, content: "Later." })).toMatch(
			/can't change when an entry happened/
		)
		expect(amendmentDateProblem({ year: null })).not.toBeNull()
	})

	test("the resolver never reads a date, or an identity, from an amendment", () => {
		// A row an older build stored: nothing re-dates or re-ids the entry.
		const read = entryAsOf(history, [
			am({ id: 1, year: 6, fields: { year: 1, day: 30, id: 99, content: "Later." } })
		])
		expect(read).toEqual({ ...history, content: "Later." })
	})
})

describe("which rows a line can see", () => {
	const rows = [
		{ id: 1, name: "shared" },
		{ id: 2, name: "on 7", branchId: 7 },
		{ id: 3, name: "on 8", branchId: 8 },
		{ id: 4, name: "also shared", branchId: null }
	]

	test("main sees only the shared rows", () => {
		expect(rowsReadingOnLine(rows, MAIN_LINE).map((r) => r.id)).toEqual([1, 4])
	})

	test("a branch sees the shared rows and its own", () => {
		expect(rowsReadingOnLine(rows, on(7)).map((r) => r.id)).toEqual([1, 2, 4])
	})

	test("a branch never sees a sibling's", () => {
		expect(rowsReadingOnLine(rows, on(8)).some((r) => r.id === 2)).toBe(false)
	})

	test("a row with no branch column at all is shared", () => {
		// A row written before the column existed: the wire carries no
		// `branchId` at all, which must read as shared and not as hidden.
		const legacy = { id: 9 } as { id: number; branchId?: number | null }
		expect(isOnLine(legacy, on(7))).toBe(true)
	})
})

describe("offWindowAmendments — a period, as step changes", () => {
	test("a closed window is two amendments, off then on", () => {
		const plan = offWindowAmendments({ year: 3 }, { year: 6 })
		expect(plan).toEqual([
			{ year: 3, month: null, day: null, fields: { enabled: false } },
			{ year: 6, month: null, day: null, fields: { enabled: true } }
		])
	})

	test("an open window is one amendment", () => {
		expect(offWindowAmendments({ year: 3 })).toHaveLength(1)
		expect(offWindowAmendments({ year: 3 }, null)).toHaveLength(1)
	})

	test("what it plans is what the resolver reads back", () => {
		// The round trip the gesture promises: off inside, on either side.
		const plan = offWindowAmendments(
			{ year: 3, month: 4, day: null },
			{ year: 6 }
		)
		const rows = plan.map((p, i) => am({ id: i + 1, ...p }))
		const entry = { id: 1, enabled: true }
		const readAt = (moment: any) =>
			entryAsOf(entry, rows, { moment }).enabled
		expect(readAt({ year: 2 })).toBe(true)
		expect(readAt({ year: 3, month: 3 })).toBe(true)
		expect(readAt({ year: 3, month: 4 })).toBe(false)
		expect(readAt({ year: 5 })).toBe(false)
		// `until` is exclusive: it is back ON at the end date itself.
		expect(readAt({ year: 6 })).toBe(true)
		expect(readAt({ year: 9 })).toBe(true)
	})

	test("an open window never comes back on", () => {
		const rows = offWindowAmendments({ year: 3 }).map((p, i) =>
			am({ id: i + 1, ...p })
		)
		expect(
			entryAsOf({ enabled: true }, rows, { moment: { year: 99 } }).enabled
		).toBe(false)
	})

	test("it can close a field other than enabled", () => {
		const plan = offWindowAmendments({ year: 3 }, { year: 4 }, "constant")
		expect(plan.map((p) => p.fields)).toEqual([
			{ constant: false },
			{ constant: true }
		])
	})
})

describe("offWindowProblem", () => {
	test("a good closed window has no problem", () => {
		expect(offWindowProblem({ year: 3 }, { year: 6 })).toBeNull()
	})

	test("an open window has no problem", () => {
		expect(offWindowProblem({ year: 3 })).toBeNull()
		expect(offWindowProblem({ year: 3 }, null)).toBeNull()
	})

	test("it refuses a window with no start", () => {
		expect(offWindowProblem(null)).toMatch(/date to start/)
		expect(offWindowProblem({ month: 3 } as any)).toMatch(/date to start/)
	})

	test("it refuses coming back on before going off", () => {
		expect(offWindowProblem({ year: 6 }, { year: 3 })).toMatch(
			/before it went off/
		)
	})

	test("it refuses a zero-length window", () => {
		expect(
			offWindowProblem({ year: 3, month: 2 }, { year: 3, month: 2 })
		).toMatch(/same moment/)
	})

	test("it refuses a day with no month, at either end", () => {
		expect(offWindowProblem({ year: 3, day: 4 } as any)).toMatch(
			/needs a month/
		)
		expect(
			offWindowProblem({ year: 3 }, { year: 6, day: 4 } as any)
		).toMatch(/needs a month/)
	})

	test("a finer end date inside the same year is still a window", () => {
		expect(offWindowProblem({ year: 3 }, { year: 3, month: 5 })).toBeNull()
	})
})

describe("the card a cast member is represented by", () => {
	test("an amendment can point them at a different card", () => {
		// "A different chara card for a different lifecycle" — no mechanism of
		// its own: `characterId` is a column, so it overlays like any other.
		const member = { id: 1, name: "Verity", characterId: 10 }
		const rows = [am({ id: 1, year: 20, fields: { characterId: 11 } })]
		expect(
			castAsOf(member, rows, { moment: { year: 19 } }).characterId
		).toBe(10)
		expect(
			castAsOf(member, rows, { moment: { year: 20 } }).characterId
		).toBe(11)
	})

	test("a line can give them a different card from main's", () => {
		const member = { id: 1, characterId: 10 }
		const rows = [
			am({ id: 1, year: 5, fields: { characterId: 11 } }),
			am({ id: 2, year: 5, branchId: 7, fields: { characterId: 12 } })
		]
		expect(castAsOf(member, rows, { line: MAIN_LINE }).characterId).toBe(11)
		expect(castAsOf(member, rows, { line: on(7) }).characterId).toBe(12)
	})
})

describe("compareLines — this line against main", () => {
	const shared = {
		id: 1,
		branchId: null,
		name: "Verity",
		content: "A novice."
	}
	const onLine7 = { id: 2, branchId: 7, name: "The harbour burns" }
	const onLine8 = { id: 3, branchId: 8, name: "Somebody else's" }
	const rows = [shared, onLine7, onLine8]
	const by = (m: Record<number, Amendment[]>) => (id: number) => m[id] ?? []

	test("a row written on this line has nothing to put beside it", () => {
		const out = compareLines(rows, by({}), { line: on(7) })
		expect(out).toHaveLength(1)
		expect(out[0]).toMatchObject({ id: 2, kind: "only", main: null })
	})

	test("a sibling's row is not a difference", () => {
		expect(compareLines(rows, by({}), { line: on(7) }).some((d) => d.id === 3)).toBe(
			false
		)
	})

	test("a shared row the two read differently, and the fields that do", () => {
		const out = compareLines(
			[shared],
			by({
				1: [
					am({ id: 1, year: 2, fields: { content: "main says" } }),
					am({
						id: 2,
						year: 3,
						branchId: 7,
						fields: { content: "the fork says" }
					})
				]
			}),
			{ line: on(7) }
		)
		expect(out).toHaveLength(1)
		expect(out[0].kind).toBe("differs")
		expect(out[0].fields).toEqual(["content"])
		expect(out[0].main?.content).toBe("main says")
		expect(out[0].line.content).toBe("the fork says")
	})

	test("a shared row both lines read the same is not listed", () => {
		const out = compareLines(
			[shared],
			by({ 1: [am({ id: 1, year: 2, fields: { content: "both" } })] }),
			{ line: on(7) }
		)
		expect(out).toEqual([])
	})

	test("a shared row with no overlays at all is not listed", () => {
		expect(compareLines([shared], by({}), { line: on(7) })).toEqual([])
	})

	test("MAIN is read without the fork cut", () => {
		// The load-bearing asymmetry: main is not cut off from itself, so a
		// change main made after the fork must show UP as a difference rather
		// than disappearing from both sides.
		const out = compareLines(
			[shared],
			by({
				1: [am({ id: 1, year: 9, fields: { content: "main, later" } })]
			}),
			{ line: on(7, { year: 5 }) }
		)
		expect(out).toHaveLength(1)
		expect(out[0].main?.content).toBe("main, later")
		// The line was cut at Y5, so it still reads the base.
		expect(out[0].line.content).toBe("A novice.")
	})

	test("the moment applies to both sides", () => {
		const overlays = by({
			1: [
				am({
					id: 1,
					year: 8,
					branchId: 7,
					fields: { content: "later" }
				})
			]
		})
		expect(
			compareLines([shared], overlays, { line: on(7), moment: { year: 4 } })
		).toEqual([])
		expect(
			compareLines([shared], overlays, { line: on(7), moment: { year: 9 } })
		).toHaveLength(1)
	})

	test("several fields are all named", () => {
		const out = compareLines(
			[shared],
			by({
				1: [
					am({
						id: 1,
						year: 2,
						branchId: 7,
						fields: { name: "V", content: "x" }
					})
				]
			}),
			{ line: on(7) }
		)
		expect(out[0].fields.sort()).toEqual(["content", "name"])
	})
})

describe("compareDates — the ordering key", () => {
	test("orders by year, then month, then day", () => {
		expect(compareDates({ year: 2 }, { year: 3 })).toBeLessThan(0)
		expect(
			compareDates({ year: 2, month: 5 }, { year: 2, month: 3 })
		).toBeGreaterThan(0)
		expect(
			compareDates(
				{ year: 2, month: 3, day: 1 },
				{ year: 2, month: 3, day: 9 }
			)
		).toBeLessThan(0)
	})

	test("an absent part sorts before a present one", () => {
		expect(compareDates({ year: 2 }, { year: 2, month: 5 })).toBeLessThan(0)
		expect(
			compareDates({ year: 2, month: 5 }, { year: 2, month: 5, day: 1 })
		).toBeLessThan(0)
	})

	test("equal dates compare equal", () => {
		expect(compareDates({ year: 2, month: 3 }, { year: 2, month: 3 })).toBe(
			0
		)
		expect(compareDates({ year: 2, month: null }, { year: 2 })).toBe(0)
	})

	test("⚠ it is correct where a radix-100 packing was WRONG", () => {
		// "Year 3, day 250" is an ordinary free-form habit — days of the year.
		// Radix-100 packed, month 100 of year 5 was 60000 — the same number as
		// year 6. `dateValue` now squeezes a part past 99 below the next one
		// (2026-09-30), so placement agrees; the comparator was always right.
		const a = { year: 5, month: 100, day: 0 }
		const b = { year: 6, month: 0, day: 0 }
		expect(compareDates(a, b)).toBeLessThan(0)
		expect(dateValue(a)).toBeLessThan(dateValue(b))
	})

	test("a day past 100 no longer bleeds into the month", () => {
		const a = { year: 3, month: 1, day: 250 }
		const b = { year: 3, month: 3, day: 1 }
		expect(compareDates(a, b)).toBeLessThan(0)
		// Radix-100 packed, `a` landed at 3*10000 + 100 + 250 = 30350, past
		// b's 30301. Placement now keeps it inside month 1.
		expect(dateValue(a)).toBeLessThan(dateValue(b))
	})

	test("negative years order correctly, for the era work to come", () => {
		expect(compareDates({ year: -300 }, { year: -299 })).toBeLessThan(0)
		expect(compareDates({ year: -1 }, { year: 1 })).toBeLessThan(0)
	})
})

describe("resolution is correct where the packed value collided", () => {
	const entry = { id: 1, content: "base" }

	test("a day past 100 no longer collides with a later month", () => {
		// Radix-100 packed, Y3 M3 D50 and Y3 M1 D250 were both 30350 — equal —
		// so an amendment in month 3 counted as "already happened" while the
		// reader stood in month 1. Element-wise it plainly has not (and
		// `dateValue` no longer packs them together either).
		expect(dateValue({ year: 3, month: 1, day: 250 })).toBeLessThan(
			dateValue({ year: 3, month: 3, day: 50 })
		)
		const rows = [
			am({ id: 1, year: 3, month: 3, day: 50, fields: { content: "m3" } })
		]
		expect(
			entryAsOf(entry, rows, { moment: { year: 3, month: 1, day: 250 } })
				.content
		).toBe("base")
		expect(
			entryAsOf(entry, rows, { moment: { year: 3, month: 4 } }).content
		).toBe("m3")
	})

	test("a month of 100 no longer reads as the next year", () => {
		const rows = [
			am({ id: 1, year: 5, month: 100, fields: { content: "y5 m100" } })
		]
		// Packed, Y5 M100 === Y6, so reading at Y6 applied it. It must not.
		expect(entryAsOf(entry, rows, { moment: { year: 6 } }).content).toBe(
			"y5 m100"
		)
		expect(entryAsOf(entry, rows, { moment: { year: 5 } }).content).toBe(
			"base"
		)
	})

	test("a fork cut compares element-wise too", () => {
		const rows = [
			am({
				id: 1,
				year: 3,
				month: 1,
				day: 250,
				fields: { content: "main" }
			}),
			am({
				id: 2,
				year: 3,
				month: 1,
				branchId: 7,
				fields: { content: "fork" }
			})
		]
		// The fork left at Y3 M1 D100; main's D250 is after it and must not reach.
		const out = entryAsOf(entry, rows, {
			line: on(7, { year: 3, month: 1, day: 100 })
		})
		expect(out.content).toBe("fork")
	})
})
