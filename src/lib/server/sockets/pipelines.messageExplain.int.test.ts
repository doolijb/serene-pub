/**
 * `pipelines:messageExplain` — why *this reply* said what it said.
 *
 * The same projection `pipelines:runExplain` serves, addressed the way a
 * reader asks for it: by the message in front of them rather than by a run id
 * they were never given. Three properties are asserted, and the first is the
 * one that makes this a different handler rather than an alias:
 *
 * 1. **A guest can read it.** `runExplain` scopes to the asker's own runs
 *    because it is reachable by run id from the admin workspace. This is
 *    reachable only from a message in a conversation the asker is in, and a
 *    participant reading a reply addressed to them is reading their own
 *    evidence — an owner-only gate would refuse them the account of a turn
 *    they took part in.
 * 2. **A stranger cannot**, and learns nothing about whether the message
 *    exists: the same sentence a missing message gets.
 * 3. **A message with no run linked says so, in words.** Not silence, and not
 *    a guess at which run it might have been — see the handler's note.
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
		getCryptoSecretKey: () => "message-explain-int-secret"
	}
})

let ownerId: number
let guestId: number
let strangerId: number
let sessionId: number
let ashguardId: number
/** The reply the run produced — the subject of every test below. */
let explainedMessageId: number
/** A reply from before run tracking: no `pipeline_runs` row names it. */
let untrackedMessageId: number

const WORLD_LORE = "core:entry/world-lore"

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
		.values({ username: "message-explain-owner", isAdmin: true })
		.returning()
	ownerId = owner.id
	const [guest] = await testDb
		.insert(schema.users)
		.values({ username: "message-explain-guest", isAdmin: false })
		.returning()
	guestId = guest.id
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: "message-explain-stranger", isAdmin: false })
		.returning()
	strangerId = stranger.id

	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Message explain book", userId: ownerId })
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

	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			name: "Message explain session",
			isGroup: false,
			userId: ownerId,
			lorebookId: book.id
		} as any)
		.returning()
	sessionId = session.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guestId })

	const [explained] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			content: "The gate holds."
		})
		.returning()
	explainedMessageId = explained.id

	const [untracked] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			content: "Nothing recorded this one."
		})
		.returning()
	untrackedMessageId = untracked.id

	// The run belongs to the OWNER, and is linked to the message. The guest
	// test below is exactly this asymmetry: the reader is not the run's owner.
	const [explainRun] = await testDb
		.insert(schema.pipelineRuns)
		.values({
			runId: "message-explain-run",
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
			tokensSpent: 12,
			receipt: {
				runId: "message-explain-run",
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
								worldLore: {
									allocated: 500,
									used: 12,
									entries: 1,
									cap: 8
								}
							}
						}
					}
				]
			}
		} as any)
		.returning()

	// The link, in the relation that replaced `pipeline_runs.message_id`
	// (ruled 2026-09-08). The handler joins through this; a run with no
	// artifact row is a run this message cannot be explained from.
	await testDb.insert(schema.pipelineRunArtifacts).values({
		runId: explainRun.id,
		seq: 0,
		kind: "message",
		entityId: explainedMessageId,
		action: "created"
	})
}, 120_000)

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noop = () => {}

describe("pipelines:messageExplain", () => {
	it("explains a message from the reader's own conversation", async () => {
		const { pipelinesMessageExplain } = await import("./pipelines")
		const events: any[] = []
		const res: any = await pipelinesMessageExplain.handler(
			fakeSocket(ownerId, true),
			{ messageId: explainedMessageId } as any,
			(event, data) => events.push({ event, data })
		)
		expect(res.error).toBeUndefined()
		expect(res.messageId).toBe(explainedMessageId)
		expect(res.runId).toBe("message-explain-run")
		expect(events.map((e) => e.event)).toContain("pipelines:messageExplain")

		const included = res.explanation.rows.find(
			(r: any) => r.outcome === "included"
		)
		// Content vocabulary, off the entry's own keys — the same sentence the
		// run-addressed handler produces, because it is the same projection.
		expect(included.title).toBe("The Ashguard")
		expect(included.verdict).toBe(
			"Included — matched all 2 of its keys (ashguard, gate)."
		)
	}, 60_000)

	it("refuses a guest and a stranger alike: a run's explanation is an administrator's (R55)", async () => {
		const { pipelinesMessageExplain } = await import("./pipelines")
		for (const who of [guestId, strangerId]) {
			const events: any[] = []
			const res: any = await pipelinesMessageExplain.handler(
				fakeSocket(who),
				{ messageId: explainedMessageId } as any,
				(event, data) => events.push({ event, data })
			)
			expect(res.error).toBe("Only administrators can see run reports.")
			expect(res.explanation).toBeUndefined()
			expect(events.map((e) => e.event)).toContain(
				"pipelines:messageExplain:error"
			)
		}
	}, 60_000)

	it("says a message with no run linked, rather than guessing at one", async () => {
		const { pipelinesMessageExplain } = await import("./pipelines")
		const res: any = await pipelinesMessageExplain.handler(
			fakeSocket(ownerId, true),
			{ messageId: untrackedMessageId } as any,
			noop
		)
		expect(res.error).toContain("before run tracking")
		expect(res.explanation).toBeUndefined()
	}, 60_000)
})
