import { describe, expect, it } from "vitest"
import type { Presence } from "$lib/shared/lorebooks/presence"
import {
	draftNotice,
	emptyDraft,
	readDraft,
	spansOverlap,
	spanOf,
	type PresenceDraft
} from "./presenceDraft"

function draft(over: Partial<PresenceDraft> = {}): PresenceDraft {
	return { ...emptyDraft(), ...over }
}

function presence(over: Partial<Presence> = {}): Presence {
	return {
		id: 1,
		castId: 7,
		branchId: null,
		personalPosition: 30,
		fromYear: 10,
		fromMonth: null,
		fromDay: null,
		untilYear: null,
		untilMonth: null,
		untilDay: null,
		note: null,
		...over
	}
}

describe("readDraft", () => {
	it("refuses an empty form by asking for the point in their life first", () => {
		const r = readDraft(draft())
		expect(r.ok).toBe(false)
		expect(r.ok === false && r.problem).toMatch(/where in their life/i)
	})

	it("refuses a placement with no arrival year", () => {
		const r = readDraft(draft({ personalPosition: "30" }))
		expect(r.ok === false && r.problem).toMatch(/what year they arrive/i)
	})

	it("reads a placement that only gives a year", () => {
		const r = readDraft(draft({ personalPosition: "30", fromYear: "10" }))
		expect(r.ok).toBe(true)
		expect(r.ok && r.fields).toEqual({
			personalPosition: 30,
			fromYear: 10,
			fromMonth: null,
			fromDay: null,
			untilYear: null,
			untilMonth: null,
			untilDay: null,
			note: null
		})
	})

	it("refuses a day with no month, the way the server does", () => {
		const r = readDraft(
			draft({ personalPosition: "30", fromYear: "10", fromDay: "4" })
		)
		expect(r.ok === false && r.problem).toMatch(/narrows left to right/i)
	})

	it("refuses a departure month with no departure year", () => {
		const r = readDraft(
			draft({ personalPosition: "30", fromYear: "10", untilMonth: "3" })
		)
		expect(r.ok === false && r.problem).toMatch(/needs a year to be an end/i)
	})

	it("refuses leaving before arriving", () => {
		const r = readDraft(
			draft({ personalPosition: "30", fromYear: "10", untilYear: "9" })
		)
		expect(r.ok === false && r.problem).toMatch(/before they arrived/i)
	})

	it("refuses leaving on the very moment of arriving", () => {
		const r = readDraft(
			draft({
				personalPosition: "30",
				fromYear: "10",
				fromMonth: "2",
				untilYear: "10",
				untilMonth: "2"
			})
		)
		expect(r.ok === false && r.problem).toMatch(/before they arrived/i)
	})

	it("orders the two dates element-wise, not by the packed value", () => {
		// Day 250 of year 3 really is after Mo. 3 Day 50 of year 3 under the
		// packed form's arithmetic (30250 < 30350) but before it under a
		// month-first reading. The comparator must not be the packed one.
		const r = readDraft(
			draft({
				personalPosition: "30",
				fromYear: "3",
				fromMonth: "3",
				fromDay: "50",
				untilYear: "3",
				untilMonth: "1",
				untilDay: "250"
			})
		)
		expect(r.ok === false && r.problem).toMatch(/before they arrived/i)
	})

	it("keeps a note and drops a blank one", () => {
		const kept = readDraft(
			draft({ personalPosition: "8", fromYear: "1", note: "  came back  " })
		)
		expect(kept.ok && kept.fields.note).toBe("came back")
		const blank = readDraft(
			draft({ personalPosition: "8", fromYear: "1", note: "   " })
		)
		expect(blank.ok && blank.fields.note).toBe(null)
	})

	it("refuses a point in their life that is not a whole number", () => {
		const r = readDraft(draft({ personalPosition: "thirty", fromYear: "1" }))
		expect(r.ok === false && r.problem).toMatch(/not a number/i)
	})
})

describe("what the DOM actually hands back", () => {
	// ⚠ These are the regression for a browser-only crash: `bind:value` on
	// `<input type="number">` gives Svelte a NUMBER, and `null` for an empty
	// field. Every test above builds its draft out of strings, so none of them
	// could have caught `value.trim is not a function` — which is exactly what
	// the first keystroke threw. Keep at least one number case per reader.

	it("reads a draft whose numeric fields are numbers", () => {
		const r = readDraft({
			personalPosition: 34,
			fromYear: 10,
			fromMonth: null,
			fromDay: null,
			untilYear: null,
			untilMonth: null,
			untilDay: null,
			note: ""
		})
		expect(r.ok).toBe(true)
		expect(r.ok && r.fields.personalPosition).toBe(34)
		expect(r.ok && r.fields.fromYear).toBe(10)
	})

	it("treats null as blank rather than as zero", () => {
		const r = readDraft({ ...emptyDraft(), personalPosition: null })
		expect(r.ok === false && r.problem).toMatch(/where in their life/i)
	})

	it("treats a numeric zero as given, because 0 is a position", () => {
		const r = readDraft({
			...emptyDraft(),
			personalPosition: 0,
			fromYear: 0
		})
		expect(r.ok).toBe(true)
		expect(r.ok && r.fields.personalPosition).toBe(0)
		expect(r.ok && r.fields.fromYear).toBe(0)
	})

	it("still compares numeric dates element-wise", () => {
		const r = readDraft({
			...emptyDraft(),
			personalPosition: 1,
			fromYear: 3,
			fromMonth: 3,
			fromDay: 50,
			untilYear: 3,
			untilMonth: 1,
			untilDay: 250
		})
		expect(r.ok === false && r.problem).toMatch(/before they arrived/i)
	})

	it("refuses a fractional position typed as a number", () => {
		const r = readDraft({
			...emptyDraft(),
			personalPosition: 34.5,
			fromYear: 10
		})
		expect(r.ok === false && r.problem).toMatch(/not a number/i)
	})
})

describe("spansOverlap", () => {
	const span = (
		fromYear: number,
		untilYear: number | null
	): { from: any; until: any } =>
		spanOf({ fromYear, untilYear })

	it("two open runs always overlap", () => {
		expect(spansOverlap(span(1, null), span(50, null))).toBe(true)
	})

	it("separated runs do not", () => {
		expect(spansOverlap(span(1, 10), span(20, 30))).toBe(false)
	})

	it("touching ends do not overlap, because until is exclusive", () => {
		expect(spansOverlap(span(1, 10), span(10, 20))).toBe(false)
	})

	it("a run inside another overlaps", () => {
		expect(spansOverlap(span(1, 100), span(20, 30))).toBe(true)
	})
})

describe("draftNotice", () => {
	const fields = {
		personalPosition: 34,
		fromYear: 10,
		fromMonth: null,
		fromDay: null,
		untilYear: null,
		untilMonth: null,
		untilDay: null,
		note: null
	}

	it("says nothing when nothing overlaps", () => {
		expect(
			draftNotice(fields, [presence({ fromYear: 1, untilYear: 5 })])
		).toBe(null)
	})

	it("refuses an exact repeat", () => {
		const n = draftNotice(fields, [
			presence({ personalPosition: 34, fromYear: 10, untilYear: null })
		])
		expect(n?.kind).toBe("refuse")
		expect(n?.message).toMatch(/already placed/i)
	})

	it("warns, not refuses, when two of them will be in the world", () => {
		const n = draftNotice(fields, [
			presence({ personalPosition: 50, fromYear: 1, untilYear: null })
		])
		expect(n?.kind).toBe("warn")
		expect(n?.message).toMatch(/34 and 50/)
	})

	it("warns differently about the same person twice at one age", () => {
		const n = draftNotice(fields, [
			presence({ personalPosition: 34, fromYear: 1, untilYear: 20 })
		])
		expect(n?.kind).toBe("warn")
		expect(n?.message).toMatch(/same person twice/i)
	})

	it("a repeat at a different point of their life is a warning, not a refusal", () => {
		const n = draftNotice(fields, [
			presence({ personalPosition: 12, fromYear: 10, untilYear: null })
		])
		expect(n?.kind).toBe("warn")
	})
})
