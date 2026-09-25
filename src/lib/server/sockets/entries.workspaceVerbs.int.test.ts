/**
 * The two reads the lorebook workspace asks for, and the column its tree
 * nests on.
 *
 * `entries:counts` fills the navigation column, `entries:recentDecisions`
 * fills the retrieval markers on the rows, and `anchorEntryId` is what the
 * Tree view reads to file one entry under another. All three are projections
 * — nothing here writes — so what is asserted is the scoping (a book and a
 * conversation both have to be the asker's) and the shape the client is
 * allowed to believe.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entries-workspace-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function makeEntry(
	lorebookId: number,
	over: Record<string, any> = {}
): Promise<any> {
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "Umber City",
			content: "The gate is sealed.",
			keys: ["gate"],
			position: Math.floor(Math.random() * 1_000_000),
			...over
		} as any)
		.returning()
	return entry
}

async function makeSession(userId: number, lorebookId: number | null) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	return session
}

/** A receipt holding exactly the decisions a test wants explained. */
function receiptWith(
	decisions: Array<{
		source: string
		id: number
		included: boolean
	}>
) {
	return {
		nodes: [
			{
				nodeKey: "rank",
				kind: "task",
				definitionId: "core:task/rank-hybrid@1",
				output: {
					decisions: decisions.map((d) => ({
						included: d.included,
						reason: d.included ? "filled_scored" : "excluded_cap",
						candidate: {
							source: d.source,
							id: d.id,
							tokens: 10,
							signals: {},
							payload: {}
						}
					}))
				}
			}
		]
	}
}

/**
 * A receipt whose relationship mechanism reports what it walked and what it
 * sent — the shape `core:query/relationship-search@1` publishes.
 */
function receiptWithRelationships(
	diagnostics: Record<string, any>,
	kept: Array<{ type: string }> = []
) {
	return {
		nodes: [
			{
				nodeKey: "rank",
				kind: "task",
				definitionId: "core:task/rank-hybrid@1",
				output: {
					decisions: [],
					main: [],
					diagnostics: {}
				}
			},
			{
				nodeKey: "relationships",
				output: {
					main: kept.map((row, i) => ({
						id: i + 1,
						source: "relationships",
						payload: { entry: { type: row.type } }
					})),
					diagnostics: {
						relationships:
							"4 of 5 ties ranked, 2 with someone in the cast",
						...diagnostics
					}
				}
			}
		]
	}
}

let runSeq = 0

async function makeRun(
	sessionId: number,
	userId: number,
	receipt: Record<string, any>,
	over: Record<string, any> = {}
) {
	const [run] = await testDb
		.insert(schema.pipelineRuns)
		.values({
			runId: `run-${++runSeq}-${Math.random().toString(36).slice(2)}`,
			specSlug: "core:spec/turn",
			specVersion: "1.0.0",
			sessionId,
			userId,
			outcome: "ok",
			triggerSource: "test",
			seed: "seed",
			startedAt: new Date(),
			endedAt: new Date(),
			receipt,
			...over
		} as any)
		.returning()
	// What `saveReceipt` does next (L1): the rankings the receipt holds go
	// into the store the readers use.
	if (!(over.isPreview === true)) {
		const { recordRankings } = await import(
			"$lib/server/pipelines/runtime/rankingStore"
		)
		await recordRankings(testDb as any, receipt as any, {
			runRowId: run.id,
			sessionId,
			userId
		})
	}
	return run
}

describe("entries:list — the entry an entry is filed under", () => {
	test("projects anchorEntryId so the tree can nest on it", async () => {
		const { entryListHandler } = await import("./entries")
		const user = await makeUser("workspace-anchor-owner")
		const lorebook = await makeLorebook(user.id, "Anchored Book")
		const city = await makeEntry(lorebook.id, { title: "Umber City" })
		const district = await makeEntry(lorebook.id, {
			title: "Low Quarter",
			anchorEntryId: city.id
		})

		const res = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, typeId: WORLD_LORE_TYPE_ID },
			noopEmit
		)

		const rows = new Map(res.entryList.map((e: any) => [e.id, e]))
		expect(rows.get(district.id)!.anchorEntryId).toBe(city.id)
		expect(rows.get(city.id)!.anchorEntryId).toBeNull()
	}, 60_000)
})

describe("entries:counts", () => {
	test("counts every kind the navigation column has a door for", async () => {
		const { entryCountsHandler } = await import("./entries")
		const user = await makeUser("workspace-counts-owner")
		const lorebook = await makeLorebook(user.id, "Counted Book")
		await makeEntry(lorebook.id)
		await makeEntry(lorebook.id)
		await makeEntry(lorebook.id, { typeId: CHARACTER_LORE_TYPE_ID })
		const history = await makeEntry(lorebook.id, {
			typeId: HISTORY_TYPE_ID,
			title: null,
			fields: { year: 1 }
		})
		await testDb.insert(schema.scenes).values({
			lorebookId: lorebook.id,
			historyEntryId: history.id,
			name: "The gate"
		} as any)
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: lorebook.id,
			binding: "{{char:1}}",
			name: "The Keeper"
		} as any)

		const res = await entryCountsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id },
			noopEmit
		)

		expect(res.lorebookId).toBe(lorebook.id)
		expect(res.counts[WORLD_LORE_TYPE_ID]).toBe(2)
		expect(res.counts[CHARACTER_LORE_TYPE_ID]).toBe(1)
		expect(res.counts[HISTORY_TYPE_ID]).toBe(1)
		expect(res.counts.scene).toBe(1)
		expect(res.counts.cast).toBe(1)
	}, 60_000)

	test("reports zero for a kind the book has none of, rather than omitting it", async () => {
		const { entryCountsHandler } = await import("./entries")
		const user = await makeUser("workspace-counts-empty")
		const lorebook = await makeLorebook(user.id, "Empty Book")

		const res = await entryCountsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id },
			noopEmit
		)

		expect(res.counts[WORLD_LORE_TYPE_ID]).toBe(0)
		expect(res.counts.scene).toBe(0)
		expect(res.counts.cast).toBe(0)
	}, 60_000)

	test("refuses a book the asker does not own", async () => {
		const { entryCountsHandler } = await import("./entries")
		const author = await makeUser("workspace-counts-author")
		const stranger = await makeUser("workspace-counts-stranger")
		const lorebook = await makeLorebook(author.id, "Author's Book")
		await makeEntry(lorebook.id)

		await expect(
			entryCountsHandler.handler(
				fakeSocket(stranger.id),
				{ lorebookId: lorebook.id },
				noopEmit
			)
		).rejects.toThrow("Lorebook not found.")
	}, 60_000)
})

describe("entries:recentDecisions", () => {
	test("reads the newest run, and says which run it read", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-owner")
		const lorebook = await makeLorebook(user.id, "Decided Book")
		const fired = await makeEntry(lorebook.id)
		const considered = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)

		await makeRun(
			session.id,
			user.id,
			receiptWith([
				{ source: "worldLore", id: fired.id, included: false },
				{ source: "worldLore", id: considered.id, included: false }
			])
		)
		const newest = await makeRun(
			session.id,
			user.id,
			receiptWith([
				{ source: "worldLore", id: fired.id, included: true },
				{ source: "worldLore", id: considered.id, included: false }
			])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.runId).toBe(newest.runId)
		expect(res.decisions).toEqual({
			[fired.id]: "fired",
			[considered.id]: "considered"
		})
	}, 60_000)

	test("an inclusion by one branch wins over another branch's rejection", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-two-branches")
		const lorebook = await makeLorebook(user.id, "Two Branch Book")
		const entry = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)
		await makeRun(
			session.id,
			user.id,
			receiptWith([
				{ source: "worldLore", id: entry.id, included: false },
				{ source: "worldLore", id: entry.id, included: true }
			])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.decisions[entry.id]).toBe("fired")
	}, 60_000)

	test("never reports a message candidate whose id matches an entry's", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-messages")
		const lorebook = await makeLorebook(user.id, "Message Id Book")
		const entry = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)
		await makeRun(
			session.id,
			user.id,
			receiptWith([{ source: "message", id: entry.id, included: true }])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.decisions).toEqual({})
	}, 60_000)

	test("never reports an entry of another book", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-other-book")
		const mine = await makeLorebook(user.id, "My Book")
		const theirs = await makeLorebook(user.id, "Other Book")
		const outsider = await makeEntry(theirs.id)
		const session = await makeSession(user.id, mine.id)
		await makeRun(
			session.id,
			user.id,
			receiptWith([
				{ source: "worldLore", id: outsider.id, included: true }
			])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: mine.id, sessionId: session.id },
			noopEmit
		)

		expect(res.decisions).toEqual({})
	}, 60_000)

	test("answers a conversation with no recorded run with no decisions", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-no-runs")
		const lorebook = await makeLorebook(user.id, "Unrun Book")
		await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.runId).toBeUndefined()
		expect(res.decisions).toEqual({})
	}, 60_000)

	test("says nothing when the conversation reads a different lorebook", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-detached")
		const asked = await makeLorebook(user.id, "Asked Book")
		const attached = await makeLorebook(user.id, "Attached Book")
		const entry = await makeEntry(asked.id)
		const session = await makeSession(user.id, attached.id)
		await makeRun(
			session.id,
			user.id,
			receiptWith([{ source: "worldLore", id: entry.id, included: true }])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: asked.id, sessionId: session.id },
			noopEmit
		)

		expect(res.decisions).toEqual({})
		expect(res.runId).toBeUndefined()
	}, 60_000)

	/**
	 * The ceiling line's figures — what the same run did with the graph.
	 *
	 * ⚠ The run's, never one member's: the mechanism walks the speaker's whole
	 * graph under one ceiling, so "4 of 5 sent" is a fact about the turn.
	 */
	test("reports what the run sent of the graph, and the ceiling it was given", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-relationships")
		const lorebook = await makeLorebook(user.id, "Graphed Book")
		const entry = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)
		const receipt = receiptWithRelationships(
			{ considered: 5, matched: 4, maxEntries: 4 },
			[
				{ type: "ferried by" },
				{ type: "ferried by" },
				{ type: "ferried by" },
				{ type: "ferried by" }
			]
		)
		receipt.nodes[0].output.decisions = [
			{
				included: true,
				reason: "filled_scored",
				candidate: {
					source: "worldLore",
					id: entry.id,
					tokens: 10,
					signals: {},
					payload: {}
				}
			}
		] as any
		await makeRun(session.id, user.id, receipt)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.relationships).toEqual({
			sent: 4,
			considered: 5,
			cap: 4,
			cappedType: "ferried by"
		})
	}, 60_000)

	test("names no type when the ties that got through are of several", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-mixed-ties")
		const lorebook = await makeLorebook(user.id, "Mixed Book")
		const entry = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)
		const receipt = receiptWithRelationships(
			{ considered: 5, matched: 2, maxEntries: 2 },
			[{ type: "ferried by" }, { type: "keeper of" }]
		)
		receipt.nodes[0].output.decisions = [
			{
				included: true,
				reason: "filled_scored",
				candidate: {
					source: "worldLore",
					id: entry.id,
					tokens: 10,
					signals: {},
					payload: {}
				}
			}
		] as any
		await makeRun(session.id, user.id, receipt)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.relationships).toEqual({ sent: 2, considered: 5, cap: 2 })
	}, 60_000)

	test("says nothing about the graph when the run recorded no figures", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const user = await makeUser("workspace-decisions-no-graph")
		const lorebook = await makeLorebook(user.id, "Ungraphed Book")
		const entry = await makeEntry(lorebook.id)
		const session = await makeSession(user.id, lorebook.id)
		await makeRun(
			session.id,
			user.id,
			receiptWith([{ source: "worldLore", id: entry.id, included: true }])
		)

		const res = await entryRecentDecisionsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, sessionId: session.id },
			noopEmit
		)

		expect(res.decisions[entry.id]).toBe("fired")
		expect(res.relationships).toBeUndefined()
	}, 60_000)

	test("refuses a book the asker does not own", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const author = await makeUser("workspace-decisions-author")
		const stranger = await makeUser("workspace-decisions-stranger")
		const lorebook = await makeLorebook(author.id, "Author's Decided Book")
		const session = await makeSession(author.id, lorebook.id)

		await expect(
			entryRecentDecisionsHandler.handler(
				fakeSocket(stranger.id),
				{ lorebookId: lorebook.id, sessionId: session.id },
				noopEmit
			)
		).rejects.toThrow("Lorebook not found.")
	}, 60_000)

	test("refuses a conversation the asker cannot reach", async () => {
		const { entryRecentDecisionsHandler } = await import("./entries")
		const author = await makeUser("workspace-decisions-reader")
		const other = await makeUser("workspace-decisions-outsider")
		// The book is the asker's; the conversation is somebody else's, and
		// owning one is not consent to read the other.
		const lorebook = await makeLorebook(author.id, "Reader's Book")
		const otherBook = await makeLorebook(other.id, "Outsider's Book")
		const session = await makeSession(other.id, otherBook.id)

		await expect(
			entryRecentDecisionsHandler.handler(
				fakeSocket(author.id),
				{ lorebookId: lorebook.id, sessionId: session.id },
				noopEmit
			)
		).rejects.toThrow("Session not found or access denied.")
	}, 60_000)
})

describe("entries:setMarks — Off and Pin, and nothing else (L1)", () => {
	test("the owner sets both marks; the vectors are left alone; a stranger is refused", async () => {
		const { entrySetMarksHandler } = await import("./entries")
		const owner = await makeUser("marks-owner")
		const stranger = await makeUser("marks-stranger")
		const lorebook = await makeLorebook(owner.id, "Marks Book")
		const entry = await makeEntry(lorebook.id, { title: "The Gate" })
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId: entry.id,
			vectorName: "core:vec/default@1",
			chunkIndex: 0,
			model: "test-model",
			dims: 2,
			vector: [0.1, 0.2]
		} as any)

		const res: any = await entrySetMarksHandler.handler(
			fakeSocket(owner.id),
			{ entryId: entry.id, off: true, pinned: true },
			noopEmit
		)
		expect(res).toMatchObject({ off: true, pinned: true })
		const [row] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		expect(row).toMatchObject({ enabled: false, constant: true })
		const vectors = await testDb
			.select()
			.from(schema.lorebookEntryVectors)
			.where(eq(schema.lorebookEntryVectors.entryId, entry.id))
		expect(vectors).toHaveLength(1)

		const refused: any = await entrySetMarksHandler.handler(
			fakeSocket(stranger.id),
			{ entryId: entry.id, off: false },
			noopEmit
		)
		expect(refused.error).toMatch(/access denied/)
	})
})

describe("entries:sessionEntries — the lore entries widget's read (L1)", () => {
	test("lists the book with this session's rollup, filters and pages; a guest is told whose it is", async () => {
		const { entrySessionEntriesHandler } = await import("./entries")
		const owner = await makeUser("widget-owner")
		const guest = await makeUser("widget-guest")
		const lorebook = await makeLorebook(owner.id, "Widget Book")
		const gate = await makeEntry(lorebook.id, { title: "The Gate" })
		const road = await makeEntry(lorebook.id, { title: "The Road" })
		const gone = await makeEntry(lorebook.id, { title: "Old Tower" })
		await testDb.update(schema.lorebookEntries).set({ archived: true }).where(eq(schema.lorebookEntries.id, gone.id))
		await testDb.update(schema.lorebookEntries).set({ constant: true }).where(eq(schema.lorebookEntries.id, road.id))
		const session = await makeSession(owner.id, lorebook.id)
		await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id })
		await makeRun(
			session.id,
			owner.id,
			receiptWith([
				{ source: "worldLore", id: gate.id, included: true },
				{ source: "worldLore", id: road.id, included: false }
			])
		)

		const all: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, sort: "name" }, noopEmit)
		expect(all.rows.map((r: any) => r.title)).toEqual(["The Gate", "The Road"])
		expect(all.rows[0]).toMatchObject({ timesJudged: 1, timesIncluded: 1, lastIncluded: true, lastRank: 1 })
		expect(all.rows[1]).toMatchObject({ pinned: true, lastIncluded: false })

		const fired: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, filter: "fired" }, noopEmit)
		expect(fired.rows.map((r: any) => r.id)).toEqual([gate.id])
		const searched: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, query: "road" }, noopEmit)
		expect(searched.rows.map((r: any) => r.id)).toEqual([road.id])
		const paged: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, sort: "name", limit: 1, offset: 1 }, noopEmit)
		expect(paged).toMatchObject({ total: 2 })
		expect(paged.rows.map((r: any) => r.title)).toEqual(["The Road"])

		const asGuest: any = await entrySessionEntriesHandler.handler(fakeSocket(guest.id), { sessionId: session.id }, noopEmit)
		expect(asGuest).toMatchObject({ ownerOnly: true, rows: [] })

		// A page past the end is pulled back to the last real page — never
		// "this lorebook has no entries" — and says which page it served.
		const past: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, sort: "name", limit: 1, offset: 5 }, noopEmit)
		expect(past).toMatchObject({ total: 2, offset: 1 })
		expect(past.rows.map((r: any) => r.title)).toEqual(["The Road"])

		// The search is a substring: `%` and `_` match themselves.
		const wild: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, query: "%" }, noopEmit)
		expect(wild.rows).toEqual([])
		const under: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, query: "The_Road" }, noopEmit)
		expect(under.rows).toEqual([])

		// The ask's token rides back, so a panel can drop a superseded reply.
		const tagged: any = await entrySessionEntriesHandler.handler(fakeSocket(owner.id), { sessionId: session.id, request: "p:7" }, noopEmit)
		expect(tagged.request).toBe("p:7")
	})
})
