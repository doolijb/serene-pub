/**
 * Every SHARED reader that decides what a line reads agrees with THE rule.
 *
 * The rule is `$lib/shared/lorebooks/lineReading.ts` (its SQL form,
 * `$lib/server/state/lineSql.ts`, is checked against the same cases in
 * `lineSql.int.test.ts`). This runs each shared reader over the shared case
 * table (`lineReading.cases.ts`: main, a fork at a date, a fork at now, forks
 * of forks, rows dated past a fork cut) on every line and at every moment,
 * and asks it for exactly what `rowReadsOnLine` / `amendmentsOnLine` say.
 *
 * ⚠ Pure functions only. A reader agreeing here says nothing about a screen
 * that never calls it, or calls it with the wrong line: the screens are
 * `lineConformance.screens.dom.test.ts` (mounted, reading what they draw —
 * the Cast member page) and `cast/presencesPanel.dom.test.ts`. Not mounted
 * by any test yet, each calling a reader checked here: the pool and its
 * scenes, inhabitants and Lives members (`LorebooksWorkspace`,
 * `rowsReadingOnLine` / `entryAsOf`), `EntryWorkspace`'s scenes,
 * `GraphsWorkspace` and `PlaceLinks` (`edgesOnLine`), `AmendmentList`'s
 * "not yet" (`amendmentsAheadOnLine`), and the session's history lists
 * (`SessionWorkflowTab`, `SummarizeLoreModal`: `rowsReadingOnLine`).
 *
 * A new shared reader belongs here; a new screen, in the screens file.
 */
import { describe, expect, it } from "vitest"
import {
	amendmentsAheadOnLine,
	amendmentsOnLine,
	lineOf,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import {
	CASE_BRANCHES,
	CASE_LINES,
	CASE_MOMENTS,
	CASE_ROWS,
	type CaseRow
} from "$lib/shared/lorebooks/lineReading.cases"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import {
	amendmentsAsOf,
	compareLines,
	entryAsOf,
	type Amendment
} from "$lib/shared/lorebooks/amendments"
import {
	appearancesOf,
	presencesOnLine,
	type Presence
} from "$lib/shared/lorebooks/presence"
import { buildAxis } from "./time/livesLens"
import { edgesOnLine } from "./graphs/asOf"
import { historyEntriesOnReading } from "./time/historyOnReading"
import { maskingAmendment } from "./editor/entrySave"

const READINGS = CASE_LINES.map((id) => ({
	id,
	name: id === null ? "main" : CASE_BRANCHES.find((b) => b.id === id)!.name,
	line: lineOf(id, CASE_BRANCHES)
}))

const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b)

/** The canonical answer: the case rows the line reads at the moment. */
function canonical(
	line: Line,
	moment: StoryDate | null,
	rows: readonly CaseRow[] = CASE_ROWS
): number[] {
	return sorted(
		rows.filter((r) => rowReadsOnLine(r, line, r.date, moment)).map((r) => r.id)
	)
}

/** A presence always has an arrival date, so only the dated rows become one. */
const DATED = CASE_ROWS.filter((r) => r.date !== null)
const PRESENCES: Presence[] = DATED.map((r) => ({
	id: r.id,
	castId: 1,
	branchId: r.branchId,
	personalPosition: r.id,
	fromYear: r.date!.year,
	fromMonth: r.date!.month ?? null,
	fromDay: r.date!.day ?? null
}))

const AMENDMENTS: Amendment[] = DATED.map((r) => ({
	id: r.id,
	branchId: r.branchId,
	year: r.date!.year,
	month: r.date!.month ?? null,
	day: r.date!.day ?? null,
	fields: { content: `#${r.id}` }
}))

const at = (moment: StoryDate | null) => JSON.stringify(moment)

describe("presences", () => {
	it("the member page's list (`presencesOnLine`) reads the line's own, and each ancestor's up to its fork cut", () => {
		for (const { name, line } of READINGS)
			expect(
				sorted(presencesOnLine(PRESENCES, line).map((p) => p.id)),
				name
			).toEqual(canonical(line, null, DATED))
	})

	it("who is here (`appearancesOf`) is the same presences, up to the moment", () => {
		for (const { name, line } of READINGS)
			for (const moment of CASE_MOMENTS)
				expect(
					sorted(
						appearancesOf(1, PRESENCES, { line, moment })
							.map((a) => a.presenceId)
							.filter((id): id is number => id !== null)
					),
					`${name} @ ${at(moment)}`
				).toEqual(canonical(line, moment, DATED))
	})

	it("the Lives lens draws the same presences", () => {
		for (const { name, line } of READINGS) {
			const axis = buildAxis([{ id: 1, name: "V" }], PRESENCES, [], { line })
			expect(
				sorted(axis.lanes.flatMap((l) => l.runs.map((r) => r.presenceId))),
				name
			).toEqual(canonical(line, null, DATED))
		}
	})
})

describe("links and history", () => {
	/** Every dated case row is also a history entry that can date a link. */
	const ENTRIES = DATED.map((r) => ({ id: 100 + r.id, ...r.date! }))
	const EDGES = CASE_ROWS.map((r) => ({
		id: r.id,
		branchId: r.branchId,
		historyEntryId: r.date ? 100 + r.id : null
	}))

	it("the canvas's links (`edgesOnLine`) are dated by their history entry", () => {
		for (const { name, line } of READINGS)
			expect(
				sorted(edgesOnLine(EDGES, line, ENTRIES).map((e) => e.id)),
				name
			).toEqual(canonical(line, null))
	})

	it("the history a scene can be filed under (`historyEntriesOnReading`)", () => {
		const history = CASE_ROWS.map((r) => ({
			id: r.id,
			branchId: r.branchId,
			year: r.date?.year ?? null,
			month: r.date?.month ?? null,
			day: r.date?.day ?? null
		}))
		for (const { name, line } of READINGS)
			for (const moment of CASE_MOMENTS)
				expect(
					sorted(historyEntriesOnReading(history, line, moment).map((e) => e.id)),
					`${name} @ ${at(moment)}`
				).toEqual(canonical(line, moment))
	})
})

describe("amendments", () => {
	it("the resolver (`amendmentsAsOf` / `entryAsOf`) applies what `amendmentsOnLine` says", () => {
		for (const { name, line } of READINGS)
			for (const moment of CASE_MOMENTS) {
				const expected = amendmentsOnLine(AMENDMENTS, line, moment)
				expect(
					amendmentsAsOf(AMENDMENTS, { line, moment }).map((a) => a.id),
					`${name} @ ${at(moment)}`
				).toEqual(expected.map((a) => a.id))
				expect(
					entryAsOf({ content: "base" }, AMENDMENTS, { line, moment }).content
				).toBe(expected.at(-1)?.fields.content ?? "base")
			}
	})

	it("what is still ahead (`amendmentsAheadOnLine`, the amendments list's “not yet”) is what the head applies and the moment does not", () => {
		for (const { name, line } of READINGS)
			for (const moment of CASE_MOMENTS) {
				const applied = new Set(amendmentsOnLine(AMENDMENTS, line, moment).map((a) => a.id))
				expect(
					sorted(amendmentsAheadOnLine(AMENDMENTS, line, moment).map((a) => a.id)),
					`${name} @ ${at(moment)}`
				).toEqual(
					sorted(
						amendmentsOnLine(AMENDMENTS, line, null)
							.map((a) => a.id)
							.filter((id) => !applied.has(id))
					)
				)
			}
	})

	it("the save warning (`maskingAmendment`) names an amendment the line applies", () => {
		for (const { name, line } of READINGS)
			for (const moment of CASE_MOMENTS) {
				const winning = entryAsOf({ content: "base" }, AMENDMENTS, {
					line,
					moment
				}).content
				const applied = amendmentsOnLine(AMENDMENTS, line, moment)
				expect(
					maskingAmendment("content", winning, AMENDMENTS, line, moment)?.id ?? null,
					`${name} @ ${at(moment)}`
				).toBe(applied.at(-1)?.id ?? null)
			}
	})
})

describe("compare with main (`compareLines`)", () => {
	const dateOf = (r: CaseRow) => r.date

	it("a row the line has and main does not is one the line READS — never one past its fork cut", () => {
		for (const { name, line } of READINGS) {
			const only = compareLines(CASE_ROWS, () => [], { line }, dateOf)
			expect(
				sorted(only.map((d) => d.id)),
				name
			).toEqual(
				sorted(
					canonical(line, null).filter(
						(id) => CASE_ROWS.find((r) => r.id === id)!.branchId !== null
					)
				)
			)
			expect(only.every((d) => d.kind === "only"), name).toBe(true)
		}
	})

	it("at a moment, a row the line has not reached yet is still listed, marked later — as the pool dims it", () => {
		for (const { name, line } of READINGS) {
			const head = compareLines(CASE_ROWS, () => [], { line }, dateOf)
			for (const moment of CASE_MOMENTS) {
				const listed = compareLines(CASE_ROWS, () => [], { line, moment }, dateOf)
				expect(sorted(listed.map((d) => d.id)), `${name} @ ${at(moment)}`).toEqual(
					sorted(head.map((d) => d.id))
				)
				const reached = new Set(canonical(line, moment))
				expect(
					sorted(listed.filter((d) => d.later).map((d) => d.id)),
					`${name} @ ${at(moment)}: later`
				).toEqual(sorted(listed.map((d) => d.id).filter((id) => !reached.has(id))))
			}
		}
	})

	it("a shared row is compared only when the line reads it", () => {
		for (const { name, line } of READINGS) {
			// The line's own overlay on every row, dated before every cut: each
			// shared row the line reads now reads differently from main.
			const overlays = (id: number): Amendment[] =>
				line.branchId === null
					? []
					: [{ id, branchId: line.branchId, year: 0, fields: { content: "here" } }]
			const differs = compareLines(CASE_ROWS, overlays, { line }, dateOf).filter(
				(d) => d.kind === "differs"
			)
			expect(sorted(differs.map((d) => d.id)), name).toEqual(
				line.branchId === null
					? []
					: canonical(line, null).filter(
							(id) => CASE_ROWS.find((r) => r.id === id)!.branchId === null
						)
			)
		}
	})
})
