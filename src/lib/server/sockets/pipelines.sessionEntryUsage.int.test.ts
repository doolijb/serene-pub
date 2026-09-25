/**
 * `pipelines:sessionEntryUsage` — everything that has ever fired in a session.
 *
 * Every run's receipt has always recorded what fired and nothing added them
 * up, so the author's real question — *which of my entries is this session
 * actually using?* — was answered by opening runs one at a time. Four things
 * are asserted here, and none of them can be reached by the pure projection's
 * test because all four are about the read:
 *
 * 1. **It aggregates.** One row per entry across many runs, with the count and
 *    the last time, and an entry that was only ever *left out* is not in it —
 *    "fired" is a claim about what reached a prompt.
 * 2. **It folds the spellings.** The vector mechanism records `historyEntry`
 *    and the ranker records `history`; the fold happens before the grouping,
 *    because one entry arriving as two rows is the panel contradicting itself
 *    about its own tally.
 * 3. **The book's owner reads it, and admins (R58).** Every turn in the
 *    session counts, guests' included; a guest gets nothing. Read from the
 *    ranking store (L1), never a receipt.
 * 4. **Nothing is forgotten.** Read from the rollup, which retention never
 *    prunes: a tally that silently stopped counting at some depth is a wrong
 *    answer, and "this entry never fires" is what somebody would conclude.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "session-entry-usage-int-secret"
	}
})

let ownerId: number
let guestId: number
let strangerId: number
let sessionId: number
let otherSessionId: number
let emptySessionId: number
let ashguardId: number
let roadId: number
let siegeId: number

const WORLD_LORE = "core:entry/world-lore"
const HISTORY = "core:entry/history"

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	// The entry rows carry a real FK into the type registry, so the registry
	// has to exist before one can be written.
	await bootstrapPipelines(testDb as any)

	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: "usage-owner", isAdmin: true })
		.returning()
	ownerId = owner.id
	const [guest] = await testDb
		.insert(schema.users)
		.values({ username: "usage-guest", isAdmin: false })
		.returning()
	guestId = guest.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "usage-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Usage book", userId: ownerId })
		.returning()

	// Through `entryInsert` rather than raw values: each type's `fields` is a
	// CHECK constraint projected from its declaration, so a hand-written row
	// fails on the declared half rather than on anything this test is about.
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	const [ashguard] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: WORLD_LORE,
				position: 0,
				name: "The Ashguard",
				keys: "ashguard, gate",
				content: "A wall of grey stone."
			} as any)
		)
		.returning()
	ashguardId = ashguard.id
	const [road] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: WORLD_LORE,
				position: 1,
				name: "The Silver Road",
				keys: "road",
				content: "It runs north."
			} as any)
		)
		.returning()
	roadId = road.id
	const [siege] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: HISTORY,
				position: 0,
				keys: "siege",
				content: "It lasted a winter.",
				year: 412
			} as any)
		)
		.returning()
	siegeId = siege.id

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Usage session",
			isGroup: false,
			userId: ownerId,
			lorebookId: book.id
		} as any)
		.returning()
	sessionId = session.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guestId })

	const [other] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Stranger session",
			isGroup: false,
			userId: strangerId,
			lorebookId: book.id
		} as any)
		.returning()
	otherSessionId = other.id

	const [empty] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Untouched session",
			isGroup: false,
			userId: strangerId,
			lorebookId: book.id
		} as any)
		.returning()
	emptySessionId = empty.id
}, 120_000)

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

/** One decision, at the granularity the ranker publishes them. */
const decision = (
	id: number,
	source: string,
	tokens: number,
	included = true,
	name?: string
) => ({
	candidate: {
		id,
		source,
		tokens,
		signals: { keyword: 1 },
		payload: name ? { name } : {}
	},
	score: 1,
	reason: included ? "filled_scored" : "excluded_budget",
	included,
	why: `scored 1.000, ${tokens} tokens`
})

const receiptFor = (decisions: any[], startedAt?: number) => ({
	runId: "seeded",
	...(startedAt ? { startedAt } : {}),
	outcome: "ok",
	nodes: [
		{
			nodeKey: "lore-world",
			seq: 1,
			kind: "query",
			result: "ok",
			output: {}
		},
		{
			nodeKey: "rank",
			seq: 2,
			kind: "task",
			definitionId: "core:task/rank-hybrid@1",
			result: "ok",
			output: { decisions, groups: {} }
		}
	]
})

let seq = 0
async function seedRun(opts: {
	runId: string
	userId: number
	sessionId: number | null
	decisions: any[]
	isPreview?: boolean
}) {
	// Ordered by row id, and each run gets a distinct wall clock so
	// "most recently" is a fact rather than a tie.
	const at = new Date(Date.UTC(2026, 0, 1 + seq++))
	const [row] = await testDb.insert(schema.pipelineRuns).values({
		runId: opts.runId,
		specSlug: "core:spec/respond",
		specVersion: "1.0.0",
		userId: opts.userId,
		sessionId: opts.sessionId,
		outcome: "ok",
		triggerSource: "event",
		seed: "s",
		isPreview: !!opts.isPreview,
		startedAt: at,
		endedAt: at,
		elapsedMs: 10,
		tokensSpent: 10,
		receipt: receiptFor(opts.decisions)
	} as any).returning({ id: schema.pipelineRuns.id })
	// What `saveReceipt` does next (L1) — a preview is never recorded.
	if (!opts.isPreview) {
		const { recordRankings } = await import("$lib/server/pipelines/runtime/rankingStore")
		await recordRankings(testDb as any, receiptFor(opts.decisions, at.getTime()) as any, {
			runRowId: row.id,
			sessionId: opts.sessionId,
			userId: opts.userId
		})
	}
	return at
}

describe("pipelines:sessionEntryUsage — the tally across a session", () => {
	let lastAshguardAt: Date

	beforeAll(async () => {
		// Three turns. The Ashguard fires in all three, the Siege in the last
		// two — once under the index spelling and once under the budget one.
		// The Silver Road is judged twice and never let in.
		await seedRun({
			runId: "usage-1",
			userId: ownerId,
			sessionId,
			decisions: [
				decision(ashguardId, "worldLore", 40, true, "The Ashguard"),
				decision(roadId, "worldLore", 20, false, "The Silver Road")
			]
		})
		await seedRun({
			runId: "usage-2",
			userId: ownerId,
			sessionId,
			decisions: [
				decision(ashguardId, "worldLore", 40, true, "The Ashguard"),
				decision(siegeId, "historyEntry", 15, true),
				decision(roadId, "worldLore", 20, false, "The Silver Road")
			]
		})
		lastAshguardAt = await seedRun({
			runId: "usage-3",
			userId: ownerId,
			sessionId,
			decisions: [
				decision(ashguardId, "worldLore", 44, true, "The Ashguard"),
				decision(siegeId, "history", 15, true)
			]
		})
		// A preview assembles a prompt and never sends it.
		await seedRun({
			runId: "usage-preview",
			userId: ownerId,
			sessionId,
			isPreview: true,
			decisions: [
				decision(roadId, "worldLore", 20, true, "The Silver Road")
			]
		})
		// The guest's own turn in the same session, and a run in a session
		// this asker cannot reach.
		await seedRun({
			runId: "usage-guest",
			userId: guestId,
			sessionId,
			decisions: [
				decision(roadId, "worldLore", 20, true, "The Silver Road")
			]
		})
		await seedRun({
			runId: "usage-elsewhere",
			userId: strangerId,
			sessionId: otherSessionId,
			decisions: [
				decision(ashguardId, "worldLore", 40, true, "The Ashguard")
			]
		})
	}, 60_000)

	it("counts every entry that reached a prompt, most-used first", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeUndefined()
		expect(events.map((e) => e.event)).toContain(
			"pipelines:sessionEntryUsage"
		)

		// Frequency leads, because the question is which entries are *shaping*
		// the session — an entry in most of the turns is doing the work whether
		// or not it happened to fire in the last one.
		// The guest's turn counts too (R58): the Silver Road went in once.
		expect(res.entries.map((e: any) => e.title)).toEqual([
			"The Ashguard",
			"Year 412",
			"The Silver Road"
		])
		const top = res.entries[0]
		expect(top.usedInRuns).toBe(3)
		expect(top.judgedInRuns).toBe(3)
		expect(top.lastUsedAt).toBe(lastAshguardAt.toISOString())
		expect(top.lastRunId).toBe("usage-3")
		// What it cost the LAST time it went in, not the first.
		expect(top.tokens).toBe(44)
		// The levers, at the values they hold now — the same pair the single
		// run's rows offer, written through the same verb.
		expect(top.entry).toMatchObject({
			id: ashguardId,
			typeId: WORLD_LORE,
			constant: false,
			enabled: true
		})
	})

	it("counts an entry only for the turns it reached a prompt in", async () => {
		// The Silver Road was judged in three turns and let in once (the
		// guest's). "Fired" is a claim about what reached a prompt.
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId } as any,
			noop
		)
		const road = res.entries.find((e: any) => e.title === "The Silver Road")
		expect(road).toMatchObject({ usedInRuns: 1, judgedInRuns: 3 })
	})

	it("folds the index spelling onto the budget group, so one entry is one row", async () => {
		// `historyEntry` in one turn and `history` in the next is one entry
		// that fired twice, not two entries that fired once.
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId } as any,
			noop
		)
		const history = res.entries.filter((e: any) => e.id === siegeId)
		expect(history).toHaveLength(1)
		expect(history[0].usedInRuns).toBe(2)
		expect(history[0].sourceLabel).toBe("History")
		// History declares no title role — it is dated, not named — so its
		// heading is the one its own manager writes.
		expect(history[0].title).toBe("Year 412")
	})

	it("says what it found before it says how much of it there was", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId } as any,
			noop
		)
		expect(res.summary).toBe(
			"“The Ashguard” is what this session reaches for most — it has gone " +
				"into 3 of the 3 turns it was weighed in, alongside 2 other entries."
		)
		// The preview is left out, and said to be left out — otherwise the
		// tally quietly disagrees with the run list beside it.
		expect(res.notes.join(" ")).toMatch(
			/1 preview is not counted: a preview assembles a prompt and never sends it\./
		)
		expect(res.runsTotal).toBe(4)
		expect(res.runsRead).toBe(4)
	})

	it("keeps counting past retention: the rollup is never pruned", async () => {
		// ⚠ Retention trims the per-turn decisions to one round (R68).
		// A tally read from those would quietly forget old turns and tell an
		// author "this never fires"; the rollup keeps every turn's count.
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const [book] = await testDb.select().from(schema.lorebooks).limit(1)
		const [kept] = await testDb
			.insert(schema.sessions)
			.values({ name: "Retention session", isGroup: false, userId: ownerId, lorebookId: book.id } as any)
			.returning()
		// One speaker, three turns: the round keeps only the newest (R68).
		for (const runId of ["kept-1", "kept-2", "kept-3"])
			await seedRun({
				runId,
				userId: ownerId,
				sessionId: kept.id,
				decisions: [decision(ashguardId, "worldLore", 40, true, "The Ashguard")]
			})
		const retained = await testDb
			.select()
			.from(schema.rankings)
			.where((await import("drizzle-orm")).eq(schema.rankings.sessionId, kept.id))
		expect(retained).toHaveLength(1)
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId: kept.id } as any,
			noop
		)
		expect(res.entries[0]).toMatchObject({ usedInRuns: 3, judgedInRuns: 3, lastRunId: "kept-3" })
		expect(res.notes.join(" ")).not.toMatch(/newest/)
	})

	it("reports the tail it did not list rather than dropping it", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId, limit: 1 } as any,
			noop
		)
		expect(res.entries).toHaveLength(1)
		expect(res.omitted).toBe(2)
		expect(res.notes.join(" ")).toMatch(/2 further entries fired less often/)
	})

	it("a guest gets nothing: the usage is the book owner's (R58)", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(guestId),
			{ sessionId } as any,
			noop
		)
		expect(res.error).toMatch(/owner's to read/)
		expect(res.entries).toBeUndefined()
	})

	it("an administrator counts every user's turns, the guest's included (R55)", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(strangerId, true),
			{ sessionId } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.runsTotal).toBe(4)
	})

	it("refuses a session the asker cannot reach", async () => {
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(strangerId),
			{ sessionId } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeTruthy()
		expect(res.entries).toBeUndefined()
		expect(events.map((e) => e.event)).toContain(
			"pipelines:sessionEntryUsage:error"
		)
	})

	it("says a session with no turns rather than failing", async () => {
		// An empty tally and a refusal are different answers, and the panel
		// renders them differently — an empty list under a sentence saying
		// nothing has fired is not an error state.
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(strangerId, true),
			{ sessionId: emptySessionId } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.entries).toHaveLength(0)
		expect(res.runsTotal).toBe(0)
		expect(res.summary).toBe(
			"This session has no recorded turns yet, so nothing has fired in it."
		)
	})

	it("a malformed decision is never recorded, so the tally cannot fail on it", async () => {
		// ⚠ A node outside core can publish anything under `decisions`. The
		// store's writer drops what names no entry, so one such run costs
		// that run's odd rows, never the answer.
		const { pipelinesSessionEntryUsage } = await import("./pipelines")
		const [odd] = await testDb
			.insert(schema.sessions)
			.values({ name: "Odd session", isGroup: false, userId: ownerId, lorebookId: (await testDb.select().from(schema.lorebooks).limit(1))[0].id } as any)
			.returning()
		await seedRun({
			runId: "odd-shapes",
			userId: ownerId,
			sessionId: odd.id,
			decisions: [
				{ candidate: { id: "5", source: "worldLore" }, included: true },
				{ included: true },
				{ candidate: { id: ashguardId, source: "worldLore", tokens: 12.5 }, included: true, reason: "keyword" }
			]
		})
		const res: any = await pipelinesSessionEntryUsage.handler(
			fakeSocket(ownerId),
			{ sessionId: odd.id } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.entries).toHaveLength(1)
		expect(res.entries[0].title).toBe("The Ashguard")
		// Whole tokens in the store.
		expect(res.entries[0].tokens).toBe(13)
	})

	it("carries the session on a run, so a receipt on screen can ask for this", async () => {
		// Without it the panel showing one run's decisions has no way to ask
		// what has fired across the session those decisions belong to.
		const { pipelinesRun } = await import("./pipelines")
		// Read as an administrator: a receipt is theirs (R55).
		const res: any = await pipelinesRun.handler(
			fakeSocket(ownerId, true),
			{ runId: "usage-3" } as any,
			noop
		)
		expect(res.run.sessionId).toBe(sessionId)
	})
})
