import { describe, expect, test } from "vitest"
import {
	appearancesOf,
	holdsAt,
	presencesByMember,
	type Presence
} from "./presence"
import { lineOf, MAIN_LINE } from "./lineReading"

const p = (
	over: Partial<Presence> &
		Pick<Presence, "id" | "personalPosition" | "fromYear">
) => ({ castId: 1, branchId: null, ...over }) as Presence

describe("a presence holds, or it does not", () => {
	const one = p({
		id: 1,
		personalPosition: 34,
		fromYear: 500,
		untilYear: 540
	})

	test("inside the window", () => {
		expect(holdsAt(one, { year: 520 })).toBe(true)
	})
	test("at the start it has begun", () => {
		expect(holdsAt(one, { year: 500 })).toBe(true)
	})
	test("at the end it is over — until is exclusive", () => {
		expect(holdsAt(one, { year: 540 })).toBe(false)
	})
	test("before it, not yet", () => {
		expect(holdsAt(one, { year: 499 })).toBe(false)
	})
	test("an open presence never ends", () => {
		const open = p({ id: 2, personalPosition: 34, fromYear: 500 })
		expect(holdsAt(open, { year: 9999 })).toBe(true)
		expect(holdsAt(open, null)).toBe(true)
	})
	test("at NOW, a closed presence is over and an open one is here", () => {
		expect(holdsAt(one, null)).toBe(false)
		expect(
			holdsAt(p({ id: 3, personalPosition: 1, fromYear: 1 }), null)
		).toBe(true)
	})
})

describe("appearances", () => {
	test("a member who has never been placed is simply here", () => {
		// Every member in every book today. It must stay the cheapest path.
		const out = appearancesOf(1, [])
		expect(out).toEqual([
			{ castId: 1, personalPosition: null, presenceId: null }
		])
	})

	test("one presence is one appearance", () => {
		const out = appearancesOf(1, [
			p({ id: 1, personalPosition: 34, fromYear: 500 })
		])
		expect(out).toEqual([
			{ castId: 1, personalPosition: 34, presenceId: 1 }
		])
	})

	test("⚠ two overlapping presences are TWO of her", () => {
		// The whole reason this file exists.
		const out = appearancesOf(
			1,
			[
				p({ id: 1, personalPosition: 34, fromYear: 500 }),
				p({ id: 2, personalPosition: 50, fromYear: 540 })
			],
			{ moment: { year: 545 } }
		)
		expect(out.map((a) => a.personalPosition)).toEqual([34, 50])
	})

	test("the younger is listed first — a life in the order it was lived", () => {
		const out = appearancesOf(
			1,
			[
				p({ id: 1, personalPosition: 50, fromYear: 400 }),
				p({ id: 2, personalPosition: 12, fromYear: 400 })
			],
			{ moment: { year: 500 } }
		)
		expect(out.map((a) => a.personalPosition)).toEqual([12, 50])
	})

	test("only the ones standing here at this moment", () => {
		const rows = [
			p({
				id: 1,
				personalPosition: 34,
				fromYear: 500,
				untilYear: 540
			}),
			p({ id: 2, personalPosition: 50, fromYear: 540 })
		]
		expect(
			appearancesOf(1, rows, { moment: { year: 520 } }).map(
				(a) => a.personalPosition
			)
		).toEqual([34])
		expect(
			appearancesOf(1, rows, { moment: { year: 560 } }).map(
				(a) => a.personalPosition
			)
		).toEqual([50])
	})

	test("declaring presences and being in none of them means NOT here", () => {
		// The opposite of declaring none. Saying where someone is also says
		// where they are not.
		const out = appearancesOf(
			1,
			[
				p({
					id: 1,
					personalPosition: 34,
					fromYear: 500,
					untilYear: 520
				})
			],
			{ moment: { year: 900 } }
		)
		expect(out).toEqual([])
	})

	test("another member's presences are not hers", () => {
		const out = appearancesOf(1, [
			p({ id: 1, castId: 2, personalPosition: 9, fromYear: 1 })
		])
		expect(out).toEqual([
			{ castId: 1, personalPosition: null, presenceId: null }
		])
	})

	test("a sibling line's presence is not read", () => {
		const rows = [
			p({ id: 1, personalPosition: 34, fromYear: 1 }),
			p({ id: 2, personalPosition: 50, fromYear: 1, branchId: 7 })
		]
		expect(
			appearancesOf(1, rows, { line: MAIN_LINE }).map(
				(a) => a.personalPosition
			)
		).toEqual([34])
		expect(
			appearancesOf(1, rows, { line: lineOf(7, [{ id: 7 }]) }).map(
				(a) => a.personalPosition
			)
		).toEqual([34, 50])
	})

	test("ties on position break on id, so two reads agree", () => {
		const rows = [
			p({ id: 9, personalPosition: 34, fromYear: 1 }),
			p({ id: 4, personalPosition: 34, fromYear: 1 })
		]
		expect(appearancesOf(1, rows).map((a) => a.presenceId)).toEqual([4, 9])
	})
})

describe("presencesByMember", () => {
	test("slices a book's presences by who they are of", () => {
		const by = presencesByMember([
			p({ id: 1, personalPosition: 1, fromYear: 1 }),
			p({ id: 2, castId: 2, personalPosition: 1, fromYear: 1 }),
			p({ id: 3, personalPosition: 2, fromYear: 1 })
		])
		expect(by.get(1)?.map((x) => x.id)).toEqual([1, 3])
		expect(by.get(2)?.map((x) => x.id)).toEqual([2])
		expect(by.get(99)).toBeUndefined()
	})
})
