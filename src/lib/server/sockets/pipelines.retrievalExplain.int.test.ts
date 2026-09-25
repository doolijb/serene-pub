/**
 * `pipelines:runExplain` — the socket surface that puts the retrieval trail on
 * a screen (design §9).
 *
 * Two things are asserted here that the pure projection's test cannot reach,
 * and both are about the read, not the rendering:
 *
 * 1. **Whose run.** Scoped exactly as `pipelines:run` is — your runs, nobody
 *    else's — because this is the same receipt in a different shape and a
 *    weaker gate on the readable form would be a hole in the stronger one.
 * 2. **Whose lore.** The entry titles, keys and levers are read through the
 *    session the run names, re-checked against the asker. A `session_id` on a
 *    run row is a column somebody could have written, so a run pointed at
 *    another person's session must yield ids and no levers rather than that
 *    person's lorebook.
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
		getCryptoSecretKey: () => "retrieval-explain-int-secret"
	}
})

let ownerId: number
let strangerId: number
let ownerSessionId: number
let strangerSessionId: number
let ashguardId: number
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
		.values({ username: "explain-owner", isAdmin: true })
		.returning()
	ownerId = owner.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "explain-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Explain book", userId: ownerId })
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
	const [siege] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId: book.id,
				typeId: HISTORY,
				position: 0,
				keys: "siege",
				content: "It lasted a winter.",
				year: 412,
				enabled: false
			} as any)
		)
		.returning()
	siegeId = siege.id

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Explain session",
			isGroup: false,
			userId: ownerId,
			lorebookId: book.id
		} as any)
		.returning()
	ownerSessionId = session.id

	const [otherSession] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Stranger session",
			isGroup: false,
			userId: strangerId,
			lorebookId: book.id
		} as any)
		.returning()
	strangerSessionId = otherSession.id
}, 120_000)

function fakeSocket(userId: number, isAdmin: boolean) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

/** A receipt with one lore mechanism and one ranking node, the shape a turn writes. */
const receiptFor = () => ({
	runId: "explain-run",
	outcome: "ok",
	nodes: [
		{
			nodeKey: "lore-world",
			seq: 1,
			kind: "query",
			result: "ok",
			output: {
				hits: [{ id: ashguardId, source: "worldLore" }],
				skipped: [
					{
						id: siegeId,
						source: "historyEntry",
						reason: "entry is disabled"
					}
				],
				diagnostics: {
					scanDepth: 10,
					considered: 2,
					matched: 1,
					vectorSearch: "unavailable (no embedding model)"
				}
			}
		},
		{
			nodeKey: "rank",
			seq: 2,
			kind: "task",
			result: "ok",
			output: {
				decisions: [
					{
						candidate: {
							id: ashguardId,
							source: "worldLore",
							tokens: 12,
							signals: { keyword: 1 },
							priority: 1,
							payload: {
								name: "The Ashguard",
								content: "A wall of grey stone."
							}
						},
						score: 1,
						reason: "filled_scored",
						included: true,
						why: "scored 1.000, 12 tokens"
					}
				],
				groups: {
					worldLore: { allocated: 500, used: 12, entries: 1, cap: 8 }
				}
			}
		}
	]
})

async function seedRun(
	runId: string,
	userId: number,
	sessionId: number | null
) {
	await testDb.insert(schema.pipelineRuns).values({
		runId,
		specSlug: "core:spec/respond",
		specVersion: "1.0.0",
		userId,
		sessionId,
		outcome: "ok",
		triggerSource: "event",
		seed: "s",
		startedAt: new Date(0),
		endedAt: new Date(1000),
		elapsedMs: 1000,
		tokensSpent: 12,
		receipt: receiptFor()
	} as any)
}

describe("pipelines:runExplain", () => {
	it("explains the asker's own run, with the entry behind each row", async () => {
		const { pipelinesRunExplain } = await import("./pipelines")
		await seedRun("explain-mine", ownerId, ownerSessionId)
		const events: any[] = []
		const res: any = await pipelinesRunExplain.handler(
			fakeSocket(ownerId, true),
			{ runId: "explain-mine" } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeUndefined()
		expect(res.runId).toBe("explain-mine")
		expect(events.map((e) => e.event)).toContain("pipelines:runExplain")

		const rows = res.explanation.rows
		const included = rows.find((r: any) => r.outcome === "included")
		expect(included.title).toBe("The Ashguard")
		// Content vocabulary, off the entry's own keys — the whole reason the
		// rows are read at all rather than being taken from the receipt.
		expect(included.verdict).toBe(
			"Included — matched all 2 of its keys (ashguard, gate)."
		)
		// The levers, at the values they hold NOW.
		expect(included.entry).toMatchObject({
			id: ashguardId,
			typeId: WORLD_LORE,
			constant: false,
			enabled: true
		})

		// The skipped half, folded from the index spelling onto its budget group
		// and carrying the disabled entry's current state so "never include"
		// renders as already done rather than as an offer.
		const skipped = rows.find((r: any) => r.outcome === "skipped")
		expect(skipped.sourceLabel).toBe("History")
		// History has no title role — its manager heads a row with its date,
		// and so does this.
		expect(skipped.title).toBe("Year 412")
		expect(skipped.entry.enabled).toBe(false)

		expect(res.explanation.notes.join(" ")).toMatch(
			/Vector search: unavailable/
		)
		expect(res.explanation.ranked).toBe(true)
	})

	it("refuses another user's run by runId", async () => {
		const { pipelinesRunExplain } = await import("./pipelines")
		await seedRun("explain-private", ownerId, ownerSessionId)
		const events: any[] = []
		const res: any = await pipelinesRunExplain.handler(
			fakeSocket(strangerId, false),
			{ runId: "explain-private" } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeTruthy()
		expect(res.explanation).toBeUndefined()
		expect(events.map((e) => e.event)).toContain(
			"pipelines:runExplain:error"
		)
	})

	it("an administrator reads the book of the session the run names, whoever owns it (R55)", async () => {
		const { pipelinesRunExplain } = await import("./pipelines")
		// The run is the owner's; its `sessionId` names the stranger's session.
		// Receipts are an administrator's, and an administrator reads any
		// session's book — so the rows carry the stranger's entries, levers
		// and all, rather than the run's user's.
		await seedRun("explain-crossed", ownerId, strangerSessionId)
		const res: any = await pipelinesRunExplain.handler(
			fakeSocket(ownerId, true),
			{ runId: "explain-crossed" } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		const included = res.explanation.rows.find(
			(r: any) => r.outcome === "included"
		)
		expect(included.title).toBe("The Ashguard")
	})

	it("says a run with no session at all rather than failing", async () => {
		const { pipelinesRunExplain } = await import("./pipelines")
		await seedRun("explain-sessionless", ownerId, null)
		const res: any = await pipelinesRunExplain.handler(
			fakeSocket(ownerId, true),
			{ runId: "explain-sessionless" } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.explanation.rows.length).toBeGreaterThan(0)
		expect(
			res.explanation.rows.every((r: any) => r.entry === undefined)
		).toBe(true)
	})
})

/**
 * The record and the row, dated against each other — the drift this surface had.
 *
 * The three tests above read entry titles and keys **live** and put them beside
 * a recorded decision, which is the whole design and also the defect: rename an
 * entry after its run and the panel showed the new title against the old score,
 * with nothing saying they were never together. Each candidate now records
 * `entrySourceHash` over the title, keys and content it was scored with, and
 * this is the socket end of the comparison — the half that reads the live rows.
 *
 * ⚠ The last test here is the one that matters most. `read` and `!entries.size`
 * are different facts, and a projection that conflated them would report every
 * row of an unreadable run as a **deleted entry** — the loudest possible way to
 * be wrong about somebody's audit trail, on the exact path the suite above
 * already proves is reachable (a run pointed at another person's session).
 */
describe("pipelines:runExplain — what the entry says now, against what it said", () => {
	let wardId: number
	let bookId: number

	const storedWard = () =>
		import("drizzle-orm").then(({ eq }) =>
			testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, wardId))
				.limit(1)
				.then((r: any[]) => r[0])
		)

	/** A receipt naming the ward, fingerprinted as the run would have. */
	const wardReceipt = async () => {
		const { entrySourceHash } = await import("$lib/server/annotations")
		const row = await storedWard()
		const fingerprint = entrySourceHash(row)
		return {
			runId: "ward-run",
			outcome: "ok",
			nodes: [
				{
					nodeKey: "rank",
					seq: 1,
					kind: "task",
					result: "ok",
					output: {
						decisions: [
							{
								candidate: {
									id: wardId,
									source: "worldLore",
									tokens: 9,
									signals: { keyword: 1 },
									payload: {
										name: row.title,
										content: row.content,
										fingerprint
									}
								},
								score: 1,
								reason: "filled_scored",
								included: true,
								why: "scored 1.000, 9 tokens"
							}
						],
						groups: {}
					}
				}
			]
		}
	}

	const seedWardRun = async (runId: string, sessionId: number | null) => {
		await testDb.insert(schema.pipelineRuns).values({
			runId,
			specSlug: "core:spec/respond",
			specVersion: "1.0.0",
			userId: ownerId,
			sessionId,
			outcome: "ok",
			triggerSource: "event",
			seed: "s",
			startedAt: new Date(0),
			endedAt: new Date(1000),
			elapsedMs: 1000,
			tokensSpent: 9,
			receipt: await wardReceipt()
		} as any)
	}

	const explainAs = async (runId: string) => {
		const { pipelinesRunExplain } = await import("./pipelines")
		const res: any = await pipelinesRunExplain.handler(
			fakeSocket(ownerId, true),
			{ runId } as any,
			noop
		)
		expect(res.error).toBeUndefined()
		return res.explanation.rows.find((r: any) => r.id === wardId)
	}

	beforeAll(async () => {
		// Its own entry: the tests below edit and then delete it, and the suite
		// above asserts on the Ashguard's title, keys and levers.
		const [book] = await testDb
			.select()
			.from(schema.lorebooks)
			.limit(1)
		bookId = book.id
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const [ward] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					lorebookId: bookId,
					typeId: WORLD_LORE,
					position: 1,
					name: "The Ward",
					keys: "ward, sigil",
					content: "A circle cut into the flagstones."
				} as any)
			)
			.returning()
		wardId = ward.id
	}, 120_000)

	it("says an untouched entry is what the run scored", async () => {
		await seedWardRun("ward-untouched", ownerSessionId)
		const row = await explainAs("ward-untouched")
		expect(row.provenance).toBe("unchanged")
		expect(row.provenanceNote).toBeUndefined()
		expect(row.title).toBe("The Ward")
	})

	it("claims nothing about a run whose lore it could not read", async () => {
		// ⚠ The dangerous one. This run names no session, so there is no book
		// to read and the entry map comes back empty — the same empty map a
		// lorebook that really lost every entry produces. Reporting "deleted"
		// here would turn "I could not look" into "your lore is gone", on
		// every row at once.
		await seedWardRun("ward-crossed", null)
		const row = await explainAs("ward-crossed")
		expect(row.provenance).toBeUndefined()
		expect(row.provenanceNote).toBeUndefined()
		// And the recorded name still heads the row, as it always did.
		expect(row.title).toBe("The Ward")
	})

	it("reports an entry edited after the run, and offers the live one as a reference", async () => {
		await seedWardRun("ward-edited", ownerSessionId)
		const { eq } = await import("drizzle-orm")
		await testDb
			.update(schema.lorebookEntries)
			.set({ title: "The Ward Stone", keys: ["ward", "sigil", "stone"] })
			.where(eq(schema.lorebookEntries.id, wardId))

		const row = await explainAs("ward-edited")
		expect(row.provenance).toBe("changed")
		expect(row.provenanceNote).toMatch(/edited since the run/i)
		// ⚠ The record heads the row. A live title over an old decision is the
		// composite that never existed, and it is what this whole lane is for.
		expect(row.title).toBe("The Ward")
		expect(row.currentTitle).toBe("The Ward Stone")
		// The decision itself is untouched, and so are the levers.
		expect(row.score).toBe(1)
		expect(row.entry).toMatchObject({ id: wardId, enabled: true })
	})

	it("reports an entry deleted after the run, and keeps the decision", async () => {
		// Read before the delete rather than written as a literal: the test
		// above has already renamed this entry, so "what the run recorded" is
		// whatever stood when the receipt was seeded — which is the fact under
		// test, and a hard-coded name would be asserting test order instead.
		const recordedTitle = (await storedWard()).title
		await seedWardRun("ward-deleted", ownerSessionId)
		const { eq } = await import("drizzle-orm")
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, wardId))

		const row = await explainAs("ward-deleted")
		expect(row.provenance).toBe("deleted")
		expect(row.provenanceNote).toMatch(
			/no longer in this session's lorebook/i
		)
		expect(row.title).toBe(recordedTitle)
		expect(row.currentTitle).toBeUndefined()
		expect(row.score).toBe(1)
		// No row to write to, so no lever offers to write to it.
		expect(row.entry).toBeUndefined()
	})
})
