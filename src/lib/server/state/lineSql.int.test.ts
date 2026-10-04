/**
 * The line rule's two forms agree: the pure one the workspace filters by
 * (`$lib/shared/lorebooks/lineReading.ts`) and the SQL one the server filters
 * by (`./lineSql.ts`), over ONE table of cases (`lineReading.cases.ts`) —
 * main, a fork at a date, a fork with no date following main, forks of forks,
 * and rows dated after a fork cut. Then server readers of a line against the
 * same cases: links (`rowsOnReading`), scenes (the `entries:counts` handler),
 * presences (`cardMemberAt`) and a line's present (`storyNowOf`) (the
 * client's readers: `lineConformance.test.ts`; its screens:
 * `lineConformance.screens.dom.test.ts`).
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
	rowsReadingOnLine,
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

describe("server readers of a line read by the rule", () => {
	/** The case rows a line reads at the moment, by local id. */
	const canonical = (
		real: (id: number | null) => number | null,
		line: import("$lib/shared/lorebooks/lineReading").Line,
		moment: import("$lib/shared/lorebooks/storyDate").StoryDate | null,
		rows = CASE_ROWS
	) =>
		rows
			.filter((r) => rowReadsOnLine({ branchId: real(r.branchId) }, line, r.date, moment))
			.map((r) => r.id)
			.sort((x, y) => x - y)
	const sorted = (ids: number[]) => [...ids].sort((x, y) => x - y)

	test("links: `rowsOnReading` dates each by its history entry; `onLineSql` keeps the chain", async () => {
		const { lineOfBook, readingOf, rowsOnReading } = await import("./reading")
		const { onLineSql } = await import("./lineSql")
		const { book, real, entryIds, anchor } = await buildBook()
		const [far] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title: "far end",
				content: "",
				keys: [],
				position: 1001
			} as any)
			.returning()
		const r = schema.narrativeRelationships
		const linkIds = new Map<number, number>()
		for (const row of CASE_ROWS) {
			const [link] = await testDb
				.insert(r)
				.values({
					lorebookId: book.id,
					fromEntryId: anchor.id,
					toEntryId: far.id,
					relationshipType: "leads to",
					title: `link ${row.id}`,
					branchId: real(row.branchId),
					historyEntryId: row.date ? entryIds.get(row.id)! : null
				})
				.returning()
			linkIds.set(row.id, link.id)
		}
		const local = back(linkIds)
		const all = await testDb.select().from(r).where(eq(r.lorebookId, book.id))

		for (const localLine of CASE_LINES) {
			const line = await lineOfBook(testDb as any, book.id, real(localLine))
			const members = await testDb
				.select({ id: r.id })
				.from(r)
				.where(and(eq(r.lorebookId, book.id), onLineSql(r.branchId, line)))
			expect(sorted(members.map((m) => local.get(m.id)!)), `line ${localLine ?? "main"}`).toEqual(
				sorted(
					CASE_ROWS.filter((c) => rowReadsOnLine({ branchId: real(c.branchId) }, line)).map(
						(c) => c.id
					)
				)
			)
			for (const moment of CASE_MOMENTS) {
				const reading = await readingOf(testDb as any, book.id, {
					branch: real(localLine) ?? "main",
					moment
				})
				const seen = await rowsOnReading(testDb as any, all, reading)
				expect(
					sorted(seen.map((l) => local.get(l.id)!)),
					`line ${localLine ?? "main"} @ ${JSON.stringify(moment)}`
				).toEqual(canonical(real, line, moment))
			}
		}
	}, 60_000)

	test("scenes: what `entries:counts` counts is what the pool keeps", async () => {
		const { lineOfBook } = await import("./reading")
		const { entryCountsHandler } = await import("$lib/server/sockets/entries")
		const { book, real, entryIds } = await buildBook()
		const s = schema.scenes
		for (const row of CASE_ROWS)
			await testDb.insert(s).values({
				lorebookId: book.id,
				historyEntryId: entryIds.get(row.id)!,
				name: `scene ${row.id}`,
				branchId: real(row.branchId)
			} as any)
		const all = await testDb.select().from(s).where(eq(s.lorebookId, book.id))
		for (const localLine of CASE_LINES) {
			const line = await lineOfBook(testDb as any, book.id, real(localLine))
			const res = await entryCountsHandler.handler(
				{ user: { id: book.userId } } as any,
				{ lorebookId: book.id, branchId: real(localLine) },
				() => {}
			)
			// The pool's scenes: the workspace's `lineScenes`, by the rule.
			const pool = rowsReadingOnLine(
				all.map((a) => ({ ...a, branchId: a.branchId ?? null })),
				line
			)
			expect(res.counts.scene, `line ${localLine ?? "main"}`).toBe(pool.length)
		}
	}, 60_000)

	test("presences: `cardMemberAt` stands the member where the World bar does", async () => {
		const { lineOfBook } = await import("./reading")
		const { cardMemberAt } = await import("$lib/server/sockets/amendments")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { book, real } = await buildBook()
		const user = await createTestUser(testDb, `linesql-cast-${Math.random().toString(36).slice(2, 8)}`)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Verity", description: "" } as any)
			.returning()
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book.id,
				name: "Verity",
				binding: "{{char:1}}",
				characterId: card.id
			} as any)
			.returning()
		// A presence always has an arrival: the dated case rows, placed at
		// their own id so an appearance names which it is.
		const dated = CASE_ROWS.filter((c) => c.date)
		for (const row of dated)
			await testDb.insert(schema.castPresences).values({
				lorebookId: book.id,
				lorebookBindingId: member.id,
				branchId: real(row.branchId),
				personalPosition: row.id,
				fromYear: row.date!.year,
				fromMonth: row.date!.month ?? null,
				fromDay: row.date!.day ?? null
			})
		for (const localLine of CASE_LINES) {
			const line = await lineOfBook(testDb as any, book.id, real(localLine))
			for (const moment of CASE_MOMENTS) {
				const read = await cardMemberAt(testDb as any, {
					lorebookId: book.id,
					characterId: card.id,
					at: { line, moment }
				})
				expect(
					sorted(read!.appearances.map((a) => a.personalPosition!)),
					`line ${localLine ?? "main"} @ ${JSON.stringify(moment)}`
				).toEqual(canonical(real, line, moment, dated))
			}
		}
	}, 60_000)

	test("a line's present reads its whole chain, and a line the book does not have is refused", async () => {
		const { BranchRefusal } = await import("./reading")
		const { storyNowOf } = await import("./storyTime")
		const one = await buildBook()
		const two = await buildBook()
		// C forked A at Y7, A main at Y5: its newest history is its own Y10.
		expect((await storyNowOf(testDb as any, one.book.id, one.real(3)))?.year).toBe(10)
		// E forked C at Y3: C's Y2 is the newest it can see.
		expect((await storyNowOf(testDb as any, one.book.id, one.real(5)))?.year).toBe(2)
		// Another book's line is not read as a one-level fork of this main.
		await expect(
			storyNowOf(testDb as any, one.book.id, two.real(5))
		).rejects.toBeInstanceOf(BranchRefusal)
	}, 60_000)
})
