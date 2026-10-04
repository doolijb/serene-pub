/**
 * "Move the story's clock forward" on a free-form calendar.
 *
 * No calendar is declared yet, so nothing rolls over: a day past 31 or a
 * month past 12 is an ordinary date in a book that numbers them that way, and
 * the next one is simply one more of the finest part the entry gives.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { allEntryTypes, snapshotRegistry } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { compareDates, nextStoryDate } from "$lib/shared/lorebooks/storyDate"
import { entryCheckExpression } from "$lib/server/pipelines/boot/entryProjection"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

describe("nextStoryDate — free-form, no rollover", () => {
	test("day 31 of month 1 is followed by day 32 of month 1", () => {
		expect(nextStoryDate({ year: 5, month: 1, day: 31 })).toEqual({
			year: 5,
			month: 1,
			day: 32
		})
	})

	test("a month past 12 is kept, and the day counts on", () => {
		expect(nextStoryDate({ year: 5, month: 13, day: 40 })).toEqual({
			year: 5,
			month: 13,
			day: 41
		})
	})

	test("day 28 of month 2 in a Gregorian leap year is day 29, not rolled", () => {
		expect(nextStoryDate({ year: 2023, month: 2, day: 28 })).toEqual({
			year: 2023,
			month: 2,
			day: 29
		})
	})

	test("a year-only entry advances the year and invents no month or day", () => {
		expect(nextStoryDate({ year: 3, month: null, day: null })).toEqual({
			year: 4,
			month: null,
			day: null
		})
	})

	test("a year-and-month entry advances the month and invents no day", () => {
		expect(nextStoryDate({ year: 3, month: 12, day: null })).toEqual({
			year: 3,
			month: 13,
			day: null
		})
	})

	test("the next date always sorts after its source by the shared comparator", () => {
		for (const from of [
			{ year: 5, month: 1, day: 31 },
			{ year: 5, month: 13, day: 250 },
			{ year: -2, month: null, day: null },
			{ year: 3, month: 99, day: null },
			{ year: 3, month: 1, day: 99 }
		]) {
			expect(compareDates(nextStoryDate(from), from)).toBeGreaterThan(0)
		}
	})
})

/**
 * The insert path (A15). The arithmetic above was never the whole story: the
 * next date also has to be STORED, and history's declared date range is
 * projected into a CHECK on `lorebook_entries` at boot. That CHECK once said
 * month 1–12 and day 1–31, so every free-form case above computed a date the
 * INSERT then refused.
 *
 * So each successor goes through the row builder `entries:iterateNext` uses
 * (`entryInsert`) and into a table carrying the very CHECK boot projects from
 * the registry's copy of the declaration (`entryCheckExpression` over
 * `configSchema`) — Postgres judging it, not a JS copy of the rule.
 */
describe("nextStoryDate — the next date survives the insert", () => {
	let pg: PGlite

	beforeAll(async () => {
		const declared = snapshotRegistry(allEntryTypes(), {
			release: "test"
		}).find((e) => e.id === HISTORY_TYPE_ID)
		const check = entryCheckExpression(
			HISTORY_TYPE_ID,
			1,
			declared?.configSchema as Record<string, any>
		)
		expect(check).toBeTruthy()
		pg = new PGlite()
		await pg.exec(`
			CREATE TABLE "lorebook_entries" (
				"type_id" text NOT NULL,
				"type_version" integer NOT NULL,
				"fields" jsonb NOT NULL,
				CONSTRAINT "history_dates" CHECK (${check})
			)`)
	}, 60_000)

	afterAll(async () => {
		await pg?.close()
	})

	const insert = async (date: {
		year: number
		month: number | null
		day: number | null
	}) => {
		const row = entryInsert({
			typeId: HISTORY_TYPE_ID,
			lorebookId: 1,
			position: 2,
			content: "",
			...date
		} as any)
		await pg.query(
			`INSERT INTO "lorebook_entries" ("type_id", "type_version", "fields") VALUES ($1, $2, $3)`,
			[row.typeId, row.typeVersion, JSON.stringify(row.fields)]
		)
	}

	test("day 31 of a free-form month is followed by day 32, and day 32 is stored", async () => {
		const made = nextStoryDate({ year: 5, month: 1, day: 31 })
		expect(made).toEqual({ year: 5, month: 1, day: 32 })
		await expect(insert(made)).resolves.toBeUndefined()
	})

	test("every free-form successor above is a row the database takes", async () => {
		for (const from of [
			{ year: 5, month: 13, day: 40 },
			{ year: 3, month: 12, day: null },
			{ year: 5, month: 13, day: 250 },
			{ year: 3, month: 99, day: null },
			{ year: 3, month: 1, day: 99 }
		])
			await expect(insert(nextStoryDate(from))).resolves.toBeUndefined()
	})

	test("the floor stands: a zeroth month is still refused by the CHECK", async () => {
		await expect(insert({ year: 5, month: 0, day: null })).rejects.toThrow(
			/history_dates/
		)
	})
})
