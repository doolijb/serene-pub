/**
 * The scene write paths the lorebooks audit found failing silently.
 *
 * - **The line.** A scene written from a session is on the session's line
 *   (`sessions.lorebook_branch_id`); one written anywhere else is on main. A
 *   client-supplied `branchId` is never read — `scenes:create` used to insert
 *   the raw payload, so any column could be written, unvalidated.
 * - **The capture rules.** Every captured message is one of the session's own,
 *   and no message is captured twice — refused, not trimmed.
 * - **The save race.** Review & Save used to send `activity:dismiss` beside
 *   `scenes:update`; a dismiss that won deleted the (still summary-less) scene
 *   being saved. The update now dismisses the review itself, after its write.
 * - **The replies.** `scenes:listByLorebook` names its book (the interest gate
 *   drops a scoped reply that does not), `scenes:delete` tells the lorebook
 *   views, and a `scenes:process` refusal names its scene.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { scopeOfPayload } from "$lib/shared/sockets/interest"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenes-capture-line-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

/** Every emit a handler made, in order. */
function recorder() {
	const emits: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		emits.push({ event, data })
	}
	return { emits, emit }
}

let seq = 0
/** A person, a book with one history entry, a fork, and a session reading it. */
async function makeWorld(opts: { onFork?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `capture-line-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Capture Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 1 }]))
		.returning()
	const [fork] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: lorebook.id, name: `What if ${seq}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook.id,
			lorebookBranchId: opts.onFork ? fork.id : null
		})
		.returning()
	const m1 = await insertSessionMessageRow(testDb, session.id)
	const m2 = await insertSessionMessageRow(testDb, session.id)
	const m3 = await insertSessionMessageRow(testDb, session.id)
	return { user, lorebook, history, fork, session, messages: [m1, m2, m3] }
}

describe("scenes:create — the line a scene is on", () => {
	test("a scene written from a session reading a fork is on that fork, and main does not count it", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const { entryCountsHandler } = await import("./entries")
		const w = await makeWorld({ onFork: true })

		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id,
					selectedMessageIds: [w.messages[0].id]
				}
			} as any,
			() => {}
		)
		expect(scene.branchId).toBe(w.fork.id)

		const onMain = await entryCountsHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.lorebook.id, branchId: null } as any,
			() => {}
		)
		const onFork = await entryCountsHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.lorebook.id, branchId: w.fork.id } as any,
			() => {}
		)
		expect(onMain.counts.scene).toBe(0)
		expect(onFork.counts.scene).toBe(1)
	}, 60_000)

	test("a client-supplied branchId is never read — a lorebook-side scene is on main", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld()

		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					historyEntryId: w.history.id,
					branchId: w.fork.id,
					graphed: true
				}
			} as any,
			() => {}
		)
		expect(scene.branchId).toBeNull()
		expect(scene.graphed).toBe(false)
	}, 60_000)

	test("a session reading another book puts no line of its own on this one", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld({ onFork: true })
		const [other] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Other book", userId: w.user.id })
			.returning()
		const [otherHistory] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: other.id, year: 1 }]))
			.returning()

		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: other.id,
					sessionId: w.session.id,
					historyEntryId: otherHistory.id
				}
			} as any,
			() => {}
		)
		expect(scene.branchId).toBeNull()
	}, 60_000)
})

describe("scenes:create / scenes:update — the capture rules", () => {
	test("refuses a message from another session, and writes nothing", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const a = await makeWorld()
		const b = await makeWorld()

		await expect(
			sceneCreateHandler.handler(
				fakeSocket(a.user.id),
				{
					scene: {
						lorebookId: a.lorebook.id,
						sessionId: a.session.id,
						historyEntryId: a.history.id,
						selectedMessageIds: [a.messages[0].id, b.messages[0].id]
					}
				} as any,
				() => {}
			)
		).rejects.toThrow(/not in this session/i)
		const rows = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.sessionId, a.session.id))
		expect(rows).toHaveLength(0)
	}, 60_000)

	test("refuses a message already captured in another scene", async () => {
		const { sceneCreateHandler } = await import("./scenes")
		const w = await makeWorld()
		const create = (ids: number[]) =>
			sceneCreateHandler.handler(
				fakeSocket(w.user.id),
				{
					scene: {
						lorebookId: w.lorebook.id,
						sessionId: w.session.id,
						historyEntryId: w.history.id,
						selectedMessageIds: ids
					}
				} as any,
				() => {}
			)

		await create([w.messages[0].id, w.messages[1].id])
		await expect(
			create([w.messages[1].id, w.messages[2].id])
		).rejects.toThrow(/1 of the selected messages is already in another scene/i)
		// A disjoint capture is fine.
		const { scene } = await create([w.messages[2].id])
		expect(scene.selectedMessageIds).toEqual([w.messages[2].id])
	}, 60_000)

	test("an update keeps its own capture without calling it an overlap", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const w = await makeWorld()
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id,
					selectedMessageIds: [w.messages[0].id]
				}
			} as any,
			() => {}
		)

		const res = await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					id: scene.id,
					selectedMessageIds: [w.messages[0].id, w.messages[1].id]
				}
			} as any,
			() => {}
		)
		expect(res.scene.selectedMessageIds).toEqual([
			w.messages[0].id,
			w.messages[1].id
		])
	}, 60_000)
})

describe("scenes:update — the review it finishes", () => {
	test("dismisses the review only after the write, so the ephemeral cleanup never deletes the saved scene", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeWorld()
		// A session-side scene exactly as the summarize flow makes it: no
		// summary and no resolved cast until Review & Save writes them.
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id,
					selectedMessageIds: [w.messages[0].id]
				}
			} as any,
			() => {}
		)
		const activityId = activityStore.startScene(
			{
				userId: w.user.id,
				sceneId: scene.id,
				lorebookId: w.lorebook.id,
				ephemeralOnCancel: true
			},
			new AbortController()
		)

		await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					id: scene.id,
					summary: "They met at the ford.",
					participantCharacters: [],
					mentionedCharacters: []
				},
				activityId
			} as any,
			() => {}
		)
		// The cleanup runs detached — give it the turn it would take.
		await new Promise((r) => setTimeout(r, 50))

		expect(activityStore.getById(activityId)).toBeUndefined()
		const [kept] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, scene.id))
		expect(kept?.summary).toBe("They met at the ford.")
	}, 60_000)

	test("leaves another person's review, or another scene's, alone", async () => {
		const { sceneCreateHandler, sceneUpdateHandler } = await import(
			"./scenes"
		)
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const w = await makeWorld()
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					historyEntryId: w.history.id,
					summary: "Already summarized."
				}
			} as any,
			() => {}
		)
		const otherScene = activityStore.startScene(
			{ userId: w.user.id, sceneId: scene.id + 999, lorebookId: w.lorebook.id },
			new AbortController()
		)

		await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id: scene.id, name: "Renamed" }, activityId: otherScene } as any,
			() => {}
		)
		expect(activityStore.getById(otherScene)).toBeDefined()
		activityStore.remove(otherScene)
	}, 60_000)
})

describe("the replies the lorebook views listen for", () => {
	test("scenes:listByLorebook names its book, so a scoped subscriber is sent it", async () => {
		const { sceneCreateHandler, sceneListByLorebookHandler } = await import(
			"./scenes"
		)
		const w = await makeWorld({ onFork: true })
		await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id
				}
			} as any,
			() => {}
		)
		const { emits, emit } = recorder()

		const res = await sceneListByLorebookHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.lorebook.id },
			emit
		)

		// What the gate reads off the payload actually emitted — not a copy.
		const sent = emits.find((e) => e.event === "scenes:listByLorebook")!
		expect(scopeOfPayload("scenes:listByLorebook", sent.data)).toBe(
			String(w.lorebook.id)
		)
		// Every line's scenes, each carrying its line.
		expect(res.sceneList.map((s) => s.branchId)).toEqual([w.fork.id])
	}, 60_000)

	test("scenes:delete tells the lorebook views which book and session it left", async () => {
		const { sceneCreateHandler, sceneDeleteHandler } = await import(
			"./scenes"
		)
		const w = await makeWorld()
		const { scene } = await sceneCreateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					lorebookId: w.lorebook.id,
					sessionId: w.session.id,
					historyEntryId: w.history.id
				}
			} as any,
			() => {}
		)
		const { emits, emit } = recorder()

		await sceneDeleteHandler.handler(
			fakeSocket(w.user.id),
			{ id: scene.id },
			emit
		)

		const sent = emits.find((e) => e.event === "scenes:delete")
		expect(sent?.data).toMatchObject({
			id: scene.id,
			lorebookId: w.lorebook.id,
			sessionId: w.session.id
		})
	}, 60_000)

	test("a scenes:process refusal names the scene, so the review modal hears it", async () => {
		const { sceneProcessHandler } = await import("./scenes")
		const w = await makeWorld()
		const { emits, emit } = recorder()

		await expect(
			sceneProcessHandler.handler(
				fakeSocket(w.user.id),
				{ sceneId: 987654 },
				emit
			)
		).rejects.toThrow(/scene not found/i)

		const sent = emits.find((e) => e.event === "scenes:process:error")
		expect(sent?.data).toEqual({ sceneId: 987654, error: "Scene not found." })
		expect(scopeOfPayload("scenes:process:error", sent!.data)).toBe(
			"987654"
		)
	}, 60_000)

	test("a query that fails before the run is answered in a sentence that names the scene, once", async () => {
		const { sceneProcessHandler } = await import("./scenes")
		const w = await makeWorld()
		const { emits, emit } = recorder()
		// A scene id past `integer`: the scene read itself fails, as a query.
		const pastInteger = 99_999_999_999

		await expect(
			sceneProcessHandler.handler(
				fakeSocket(w.user.id),
				{ sceneId: pastInteger },
				emit
			)
		).rejects.toThrow()

		expect(emits.filter((e) => e.event === "scenes:process:error")).toEqual([
			{
				event: "scenes:process:error",
				data: {
					sceneId: pastInteger,
					error: "The scene could not be summarized."
				}
			}
		])
	}, 60_000)

	test("a query that fails once the run started ends its card and names the scene, once", async () => {
		const { sceneProcessHandler } = await import("./scenes")
		const { activityStore } = await import("$lib/server/utils/activityStore")
		const { isFailedQuery } = await import("$lib/server/db/errors")
		const { sql } = await import("drizzle-orm")
		const w = await makeWorld()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: w.lorebook.id,
				sessionId: w.session.id,
				historyEntryId: w.history.id,
				selectedMessageIds: [w.messages[0].id]
			})
			.returning()
		const failed = await testDb
			.execute(sql`select * from no_such_table_a24`)
			.then(
				() => null,
				(e: unknown) => e
			)
		expect(isFailedQuery(failed)).toBe(true)
		// The run's one message read — taken after its card is up — fails.
		const read = vi
			.spyOn(testDb.query.sessionMessages, "findMany")
			.mockRejectedValueOnce(failed)
		const { emits, emit } = recorder()
		try {
			await expect(
				sceneProcessHandler.handler(
					fakeSocket(w.user.id),
					{ sceneId: scene.id },
					emit
				)
			).rejects.toThrow()
		} finally {
			read.mockRestore()
		}

		const card = activityStore
			.getFor(w.user.id, false)
			.find((a) => a.kind === "scene_summarize" && a.sceneId === scene.id)
		// Not left "running", which would refuse every retry.
		expect(card?.status).toBe("error")
		const refusals = emits.filter((e) => e.event === "scenes:process:error")
		expect(refusals).toHaveLength(1)
		expect(refusals[0]!.data.sceneId).toBe(scene.id)
		expect(refusals[0]!.data.error).toBe((card as any).errorMessage)
		// The person hears a sentence, never the query.
		expect(JSON.stringify(refusals)).not.toMatch(/no_such_table|select/i)
	}, 60_000)
})
