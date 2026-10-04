/**
 * Lorebooks plan Phase D (hygiene), two entry facts nothing kept:
 *
 * - **`provenance` was never written.** Every row stayed `human`, so the
 *   rail's "machine-written" scope always counted 0. A summarize review saved
 *   through `entries:create` now writes `summarizer` — decided from the
 *   server's own record of the review (`activityId`), never from the payload.
 * - **Ranking evidence outlived its entry.** `ranking_decisions` and
 *   `ranking_subject_stats` name a lore entry by a text id with no foreign key,
 *   so a deleted entry's rows stayed (the usage panel showed `#id`). The
 *   delete now sweeps them, for the row and everything filed under it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-entries-provenance-rankings-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `provenance-rankings-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book!.id })
		.returning()
	return { user, book: book!, session: session! }
}

async function create(
	userId: number,
	lorebookId: number,
	name: string,
	extra: Record<string, unknown> = {}
) {
	const { createEntryHandler } = await import("./entries")
	const { entry } = await createEntryHandler.handler(
		fakeSocket(userId),
		{
			entry: {
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name,
				content: "Written.",
				keys: []
			},
			...extra
		} as any,
		noopEmit
	)
	const [row] = await testDb
		.select({ provenance: schema.lorebookEntries.provenance })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entry.id))
	return { entry, provenance: row!.provenance }
}

/** A summarize run finished and waiting in review, as the activity store holds it. */
async function review(w: Awaited<ReturnType<typeof world>>, lorebookId = w.book.id) {
	const { activityStore } = await import("$lib/server/utils/activityStore")
	const id = activityStore.startSessionSummarize({
		userId: w.user.id,
		sessionId: w.session.id,
		loreType: "world",
		lorebookId
	})
	activityStore.updateSessionSummarize(id, {
		status: "review",
		pendingResult: { content: "Written.", raw: "Written." }
	})
	return id
}

describe("entries:create — provenance is the server's answer", () => {
	test("a summarize review's save is machine-written", async () => {
		const w = await world()
		const activityId = await review(w)
		const { provenance } = await create(w.user.id, w.book.id, "Summarised", {
			sessionId: w.session.id,
			activityId
		})
		expect(provenance).toBe("summarizer")
	})

	test("a person's create is human, and naming a review that is not this save's claims nothing", async () => {
		const w = await world()
		expect((await create(w.user.id, w.book.id, "Typed")).provenance).toBe("human")
		// The payload's own claim is never read.
		expect(
			(await create(w.user.id, w.book.id, "Claimed", { provenance: "summarizer" }))
				.provenance
		).toBe("human")
		expect(
			(
				await create(w.user.id, w.book.id, "Made up", {
					activityId: "no-such-activity"
				})
			).provenance
		).toBe("human")
		// Another person's review.
		const other = await world()
		const theirs = await review(other)
		expect(
			(await create(w.user.id, w.book.id, "Borrowed", { activityId: theirs }))
				.provenance
		).toBe("human")
	})
})

describe("entries:delete — the ranking evidence goes with the entry", () => {
	test("decisions and rollups for the entry and everything filed under it are swept; others stay", async () => {
		const w = await world()
		const { entry: parent } = await create(w.user.id, w.book.id, "The Keep")
		const { entry: child } = await create(w.user.id, w.book.id, "The Cellar")
		const { entry: control } = await create(w.user.id, w.book.id, "The Harbor")
		await testDb
			.update(schema.lorebookEntries)
			.set({ anchorEntryId: parent.id })
			.where(eq(schema.lorebookEntries.id, child.id))

		const [run] = await testDb
			.insert(schema.pipelineRuns)
			.values({
				runId: `run-sweep-${w.session.id}`,
				specSlug: "test:spec/sweep",
				specVersion: "1.0.0",
				userId: w.user.id,
				sessionId: w.session.id,
				outcome: "ok",
				triggerSource: "event",
				seed: "s",
				startedAt: new Date(0),
				endedAt: new Date(1000),
				elapsedMs: 1000,
				tokensSpent: 4,
				receipt: { outcome: "ok", nodes: [] }
			} as any)
			.returning()
		const [ranking] = await testDb
			.insert(schema.rankings)
			.values({
				runId: run!.id,
				nodeKey: "rank",
				definitionId: "core:task/rank@1",
				sessionId: w.session.id
			})
			.returning()
		const ids = [parent.id, child.id, control.id].map(String)
		for (const subjectId of ids) {
			await testDb.insert(schema.rankingDecisions).values({
				rankingId: ranking!.id,
				subjectKind: "lore-entry",
				subjectId,
				included: true,
				reason: "filled_scored"
			})
			await testDb.insert(schema.rankingSubjectStats).values({
				sessionId: w.session.id,
				subjectKind: "lore-entry",
				subjectId,
				timesJudged: 1,
				timesIncluded: 1
			})
		}
		// A package's subject sharing an id is not a lore entry's evidence.
		await testDb.insert(schema.rankingSubjectStats).values({
			sessionId: w.session.id,
			subjectKind: "test:thing",
			subjectId: String(parent.id),
			timesJudged: 1,
			timesIncluded: 0
		})

		const { deleteEntryHandler } = await import("./entries")
		await deleteEntryHandler.handler(
			fakeSocket(w.user.id),
			{ id: parent.id, typeId: WORLD_LORE_TYPE_ID } as any,
			noopEmit
		)

		const decisions = await testDb
			.select({ subjectId: schema.rankingDecisions.subjectId })
			.from(schema.rankingDecisions)
			.where(eq(schema.rankingDecisions.rankingId, ranking!.id))
		expect(decisions.map((d) => d.subjectId)).toEqual([String(control.id)])
		const stats = await testDb
			.select({
				subjectKind: schema.rankingSubjectStats.subjectKind,
				subjectId: schema.rankingSubjectStats.subjectId
			})
			.from(schema.rankingSubjectStats)
			.where(
				and(
					eq(schema.rankingSubjectStats.sessionId, w.session.id),
					inArray(schema.rankingSubjectStats.subjectId, ids)
				)
			)
		expect(stats).toEqual(
			expect.arrayContaining([
				{ subjectKind: "lore-entry", subjectId: String(control.id) },
				{ subjectKind: "test:thing", subjectId: String(parent.id) }
			])
		)
		expect(stats).toHaveLength(2)
	})
})

describe("purgeLorebook — book delete and overwrite import sweep the book's ranking evidence", () => {
	test("every entry of the purged book loses its rows; another book's entry keeps them", async () => {
		const w = await world()
		const { entry: a } = await create(w.user.id, w.book.id, "The Mill")
		const { entry: b } = await create(w.user.id, w.book.id, "The Weir")
		const [otherBook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: `Other ${w.book.id}` })
			.returning()
		const { entry: kept } = await create(w.user.id, otherBook!.id, "The Ford")
		const ids = [a.id, b.id, kept.id].map(String)
		for (const subjectId of ids)
			await testDb.insert(schema.rankingSubjectStats).values({
				sessionId: w.session.id,
				subjectKind: "lore-entry",
				subjectId,
				timesJudged: 1,
				timesIncluded: 1
			})

		const { purgeLorebook } = await import("$lib/server/lorebooks/tableRegistry")
		await testDb.transaction(async (tx) => purgeLorebook(tx as any, w.book.id))

		const stats = await testDb
			.select({ subjectId: schema.rankingSubjectStats.subjectId })
			.from(schema.rankingSubjectStats)
			.where(
				and(
					eq(schema.rankingSubjectStats.sessionId, w.session.id),
					inArray(schema.rankingSubjectStats.subjectId, ids)
				)
			)
		expect(stats.map((s) => s.subjectId)).toEqual([String(kept.id)])
	})
})
