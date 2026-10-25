/**
 * 🚧 Archive (pr-6, R-k): the flag, its owner-only refusals, and the one read-only rule at every door —
 * the composer, Back / Forward / Regenerate, turn controls, the action list and Run now — all back after unarchive.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	SESSION_ARCHIVED_SENTENCE,
	SESSION_ARCHIVE_REFUSALS
} from "$lib/shared/sessions/archive"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
}, 120_000)

let seq = 0
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `archive-owner-${++seq}`)
	const stranger = await createTestUser(testDb, `archive-stranger-${++seq}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId: "core:genre/story",
			composerStates: {} as any
		})
		.returning()
	return { owner, stranger, session }
}

describe("archiveSession / unarchiveSession", () => {
	test("owner only; already / not archived refuse in words", async () => {
		const { archiveSession, unarchiveSession, SessionArchiveRefusal } = await import("./archive")
		const w = await world()
		const db = testDb as unknown as Db
		await expect(archiveSession(db, { sessionId: 999_999, userId: w.owner.id })).rejects.toThrow(
			SESSION_ARCHIVE_REFUSALS.missing
		)
		await expect(archiveSession(db, { sessionId: w.session.id, userId: w.stranger.id })).rejects.toThrow(
			SESSION_ARCHIVE_REFUSALS.notOwner
		)
		await expect(unarchiveSession(db, { sessionId: w.session.id, userId: w.owner.id })).rejects.toThrow(
			SESSION_ARCHIVE_REFUSALS.notArchived
		)
		const { archivedAt } = await archiveSession(db, { sessionId: w.session.id, userId: w.owner.id })
		expect(archivedAt).toBeInstanceOf(Date)
		const err = await archiveSession(db, { sessionId: w.session.id, userId: w.owner.id }).catch((e) => e)
		expect(err).toBeInstanceOf(SessionArchiveRefusal)
		expect(err.message).toBe(SESSION_ARCHIVE_REFUSALS.already)
		await expect(unarchiveSession(db, { sessionId: w.session.id, userId: w.stranger.id })).rejects.toThrow(
			SESSION_ARCHIVE_REFUSALS.notOwner
		)
		await unarchiveSession(db, { sessionId: w.session.id, userId: w.owner.id })
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(row.archivedAt).toBeNull()
	}, 60_000)
})

describe("the read-only rule", () => {
	test("every door refuses with the sentence while archived, and opens again after unarchive", async () => {
		const { archiveSession, unarchiveSession, sessionArchivedRefusal, withSessionArchiveClosure } =
			await import("./archive")
		const { composerRefusal } = await import("./composerStates")
		const { rewindStateOf } = await import("./rewind")
		const { turnControlRefusal } = await import("$lib/server/messages/verbs")
		const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
		const { runRoutineNow } = await import("$lib/server/pipelines/routines/run")
		const w = await world()
		const db = testDb as unknown as Db
		const ids = { sessionId: w.session.id, userId: w.owner.id }

		expect(await sessionArchivedRefusal(db, w.session.id)).toBeNull()
		expect(await composerRefusal(db, w.session.id, "main", w.owner.id)).toBeNull()
		const before = await listSessionActions(db, w.session.id, { userId: w.owner.id })
		const flat = (v: Awaited<ReturnType<typeof listSessionActions>>) =>
			Object.values(v).flatMap((b: any) => [...b.primary, ...b.overflow])
		expect(flat(before).length).toBeGreaterThan(0)

		await archiveSession(db, ids)
		expect(await sessionArchivedRefusal(db, w.session.id)).toBe(SESSION_ARCHIVED_SENTENCE)
		expect(await composerRefusal(db, w.session.id, "main", w.owner.id)).toBe(
			`You can't send here yet. ${SESSION_ARCHIVED_SENTENCE}`
		)
		const state = await rewindStateOf(db, w.session.id)
		expect(state).toMatchObject({
			back: SESSION_ARCHIVED_SENTENCE,
			forward: SESSION_ARCHIVED_SENTENCE,
			regenerate: SESSION_ARCHIVED_SENTENCE
		})
		expect(await turnControlRefusal(db, w.session.id, "advance", { userId: w.owner.id })).toBe(
			SESSION_ARCHIVED_SENTENCE
		)
		const greyed = flat(await listSessionActions(db, w.session.id, { userId: w.owner.id }))
		expect(greyed.length).toBe(flat(before).length)
		for (const a of greyed) {
			expect(a.enabled).toBe(false)
			expect(a.reason).toEqual({ i18n: { en: SESSION_ARCHIVED_SENTENCE } })
		}
		expect(await runRoutineNow(db, { ...ids, registrationKey: "any" })).toEqual({
			refused: SESSION_ARCHIVED_SENTENCE
		})

		// The overlay is the payload's; the stored column is never written.
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(row.composerStates).toEqual({})
		expect(withSessionArchiveClosure(row.composerStates as any, row.archivedAt)).toEqual({
			"*": { "*": { open: false, reason: SESSION_ARCHIVED_SENTENCE, waits: false } }
		})
		expect(withSessionArchiveClosure(row.composerStates as any, null)).toBe(row.composerStates)

		await unarchiveSession(db, ids)
		expect(await composerRefusal(db, w.session.id, "main", w.owner.id)).toBeNull()
		expect((await rewindStateOf(db, w.session.id)).back).not.toBe(SESSION_ARCHIVED_SENTENCE)
		expect(await turnControlRefusal(db, w.session.id, "advance", { userId: w.owner.id })).not.toBe(
			SESSION_ARCHIVED_SENTENCE
		)
		expect(flat(await listSessionActions(db, w.session.id, { userId: w.owner.id })).some((a) => a.enabled)).toBe(
			true
		)
		expect(await runRoutineNow(db, { ...ids, registrationKey: "any" })).not.toEqual({
			refused: SESSION_ARCHIVED_SENTENCE
		})
	}, 60_000)
})
