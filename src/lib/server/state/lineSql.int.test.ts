/**
 * The line rule's two forms agree: the pure one the workspace filters by
 * (`$lib/shared/lorebooks/lineReading.ts`) and the SQL one the server filters
 * by (`./lineSql.ts`), over ONE table of cases (`lineReading.cases.ts`) —
 * main, a fork at a date, a fork with no date following main, forks of forks,
 * and rows dated after a fork cut.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	amendmentsOnLine,
	lineOf,
	rowReadsOnLine,
	type LineBranch
} from "$lib/shared/lorebooks/lineReading"
import {
	CASE_BRANCHES,
	CASE_LINES,
	CASE_MOMENTS,
	CASE_ROWS
} from "$lib/shared/lorebooks/lineReading.cases"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-linesql-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** Build the case book; answer the local → real id maps. */
async function buildBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `linesql-${Math.random().toString(36).slice(2, 8)}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Lines", userId: user.id })
		.returning()

	// Branches in id order, so a parent always exists before its child.
	const branchIds = new Map<number, number>()
	for (const b of CASE_BRANCHES) {
		const [row] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book.id,
				name: b.name,
				forkedFromBranchId:
					b.forkedFromBranchId == null ? null : branchIds.get(b.forkedFromBranchId)!,
				forkYear: b.forkYear,
				forkMonth: b.forkMonth,
				forkDay: b.forkDay
			})
			.returning()
		branchIds.set(b.id, row.id)
	}
	const real = (id: number | null) => (id == null ? null : branchIds.get(id)!)
	const realBranches: LineBranch[] = CASE_BRANCHES.map((b) => ({
		...b,
		id: branchIds.get(b.id)!,
		forkedFromBranchId: real(b.forkedFromBranchId)
	}))

	// Each case row as an entry: dated rows as History (date in `fields`),
	// undated rows as world lore. And each dated row as an amendment of one
	// anchor entry, for the column-dated form.
	const entryIds = new Map<number, number>()
	for (const r of CASE_ROWS) {
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book.id,
				typeId: r.date ? HISTORY_TYPE_ID : WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title: r.date ? null : `row ${r.id}`,
				content: `row ${r.id}`,
				keys: [],
				position: r.id,
				branchId: real(r.branchId),
				fields: r.date
					? { year: r.date.year, month: r.date.month ?? null, day: r.date.day ?? null }
					: {}
			} as any)
			.returning()
		entryIds.set(r.id, row.id)
	}
	const [anchor] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "anchor",
			content: "",
			keys: [],
			position: 1000
		} as any)
		.returning()
	const amendmentIds = new Map<number, number>()
	for (const r of CASE_ROWS) {
		if (!r.date) continue
		const [row] = await testDb
			.insert(schema.entryAmendments)
			.values({
				lorebookId: book.id,
				entryId: anchor.id,
				branchId: real(r.branchId),
				year: r.date.year,
				month: r.date.month ?? null,
				day: r.date.day ?? null,
				fields: { content: `#${r.id}` }
			})
			.returning()
		amendmentIds.set(r.id, row.id)
	}
	return { book, real, realBranches, entryIds, amendmentIds, anchor }
}

const back = (m: Map<number, number>) =>
	new Map([...m.entries()].map(([local, id]) => [id, local]))

describe("the line rule: pure and SQL agree", () => {
	test("on every line, at every moment, for entries and for amendments", async () => {
		const { lineOfBook } = await import("./reading")
		const { historyDateColumns, onLineAtSql, onLineSql } = await import("./lineSql")
		const { book, real, realBranches, entryIds, amendmentIds, anchor } = await buildBook()
		const entryLocal = back(entryIds)
		const amendLocal = back(amendmentIds)
		const e = schema.lorebookEntries
		const am = schema.entryAmendments

		for (const localLine of CASE_LINES) {
			// The server's loader builds the same chain the client builds.
			const line = await lineOfBook(testDb as any, book.id, real(localLine))
			expect(line).toEqual(lineOf(real(localLine), realBranches))

			// Membership only.
			const members = await testDb
				.select({ id: e.id })
				.from(e)
				.where(
					and(
						eq(e.lorebookId, book.id),
						inArray(e.id, [...entryIds.values()]),
						onLineSql(e.branchId, line)
					)
				)
			const pureMembers = CASE_ROWS.filter((r) =>
				rowReadsOnLine({ branchId: real(r.branchId) }, line)
			).map((r) => r.id)
			expect(members.map((m) => entryLocal.get(m.id)!).sort((x, y) => x - y)).toEqual(
				pureMembers.sort((x, y) => x - y)
			)

			for (const moment of CASE_MOMENTS) {
				const label = `line ${localLine ?? "main"} @ ${JSON.stringify(moment)}`

				// Entries dated in `fields` (the counts' and sessionEntries' form).
				const rows = await testDb
					.select({ id: e.id })
					.from(e)
					.where(
						and(
							eq(e.lorebookId, book.id),
							inArray(e.id, [...entryIds.values()]),
							onLineAtSql(e.branchId, historyDateColumns(e.fields), line, moment)
						)
					)
				const pure = CASE_ROWS.filter((r) =>
					rowReadsOnLine({ branchId: real(r.branchId) }, line, r.date, moment)
				).map((r) => r.id)
				expect(
					rows.map((r) => entryLocal.get(r.id)!).sort((x, y) => x - y),
					label
				).toEqual(pure.sort((x, y) => x - y))

				// Amendments dated in columns.
				const overlays = await testDb
					.select()
					.from(am)
					.where(
						and(
							eq(am.entryId, anchor.id),
							onLineAtSql(am.branchId, { year: am.year, month: am.month, day: am.day }, line, moment)
						)
					)
				const all = await testDb.select().from(am).where(eq(am.entryId, anchor.id))
				const pureOverlays = amendmentsOnLine(
					all.map((a) => ({ ...a, branchId: a.branchId ?? null })),
					line,
					moment
				)
				expect(
					overlays.map((a) => amendLocal.get(a.id)!).sort((x, y) => x - y),
					label
				).toEqual(pureOverlays.map((a) => amendLocal.get(a.id)!).sort((x, y) => x - y))
			}
		}
	}, 60_000)

	test("a branch of another book is refused, never read as main", async () => {
		const { lineOfBook, BranchRefusal } = await import("./reading")
		const one = await buildBook()
		const two = await buildBook()
		await expect(
			lineOfBook(testDb as any, one.book.id, two.real(1))
		).rejects.toBeInstanceOf(BranchRefusal)
	}, 60_000)

	test("readingOf carries the chain; datedOnReading reads through it", async () => {
		const { readingOf, datedOnReading } = await import("./reading")
		const { book, real } = await buildBook()
		const reading = await readingOf(testDb as any, book.id, { branch: real(3) })
		expect(reading.line?.steps.map((s) => s.branchId)).toEqual([real(3), real(1), null])
		// A's Y6 row reads on C (forked from A at Y7); main's Y6 does not (cut at Y5).
		expect(datedOnReading({ branchId: real(1) }, { year: 6 }, reading)).toBe(true)
		expect(datedOnReading({ branchId: null }, { year: 6 }, reading)).toBe(false)
		const whole = await readingOf(testDb as any, book.id, { branch: real(3), forkCut: false })
		expect(datedOnReading({ branchId: null }, { year: 6 }, whole)).toBe(true)
	}, 60_000)
})
