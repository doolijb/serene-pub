/**
 * pr-6 B-2 (ledger A5, A7, A8): `sessions:update` refuses the row's two
 * documents, `sessions:saveDraft` is one statement, `sessions:genreOf` answers
 * one genre row, and the channel filter escapes its LIKE.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-row-writes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The genres are rows once the registry has synced and pipelines booted.
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function scenario() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `rw-owner-${Date.now()}`)
	const guest = await createTestUser(testDb, `rw-guest-${Date.now()}`)
	const stranger = await createTestUser(testDb, `rw-stranger-${Date.now()}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, metadata: { keep: "me" } as any })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	return { owner, guest, stranger, session }
}

describe("sessions:update — the row's documents", () => {
	test("a session carrying metadata (or drafts) is refused in one sentence and nothing changes", async () => {
		const { sessionsUpdateHandler: h } = await import("./sessions")
		const { SESSION_UPDATE_REFUSALS } = await import("$lib/server/sessions/updateRefusals")
		const s = await scenario()
		for (const key of ["metadata", "drafts"]) {
			const emitted: Array<{ event: string; data: any }> = []
			await expect(
				h.handler(
					fakeSocket(s.owner.id),
					{ session: { id: s.session.id, [key]: {} } } as any,
					(event: string, data: any) => emitted.push({ event, data })
				)
			).rejects.toThrow(SESSION_UPDATE_REFUSALS.rowDocuments)
			expect(emitted.find((e) => e.event === "sessions:update:error")?.data.error).toBe(
				SESSION_UPDATE_REFUSALS.rowDocuments
			)
		}
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, s.session.id))
		expect(row.metadata).toEqual({ keep: "me" })
		expect(row.drafts ?? {}).toEqual({})
	}, 60_000)
})

describe("sessions:saveDraft", () => {
	test("two people's drafts both stay; an empty save removes only the caller's", async () => {
		const { sessionsSaveDraftHandler: h } = await import("./sessions")
		const s = await scenario()
		const draftsOf = async () =>
			(await testDb.select({ d: schema.sessions.drafts }).from(schema.sessions).where(eq(schema.sessions.id, s.session.id)))[0].d
		await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, content: "owner's \"words\" {x}" }, noopEmit)
		await h.handler(fakeSocket(s.guest.id), { sessionId: s.session.id, content: "guest's words" }, noopEmit)
		expect(await draftsOf()).toEqual({
			[String(s.owner.id)]: "owner's \"words\" {x}",
			[String(s.guest.id)]: "guest's words"
		})
		const res = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, content: "" }, noopEmit)
		expect(res).toEqual({ success: true })
		expect(await draftsOf()).toEqual({ [String(s.guest.id)]: "guest's words" })
		const refused = await h.handler(fakeSocket(s.stranger.id), { sessionId: s.session.id, content: "x" }, noopEmit)
		expect(refused).toEqual({ success: false })
	}, 60_000)
})

describe("sessions:genreOf", () => {
	test("answers the session's genre row, and null for a stranger", async () => {
		const { sessionsGenreOfHandler: h } = await import("./sessions")
		const s = await scenario()
		const mine = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id }, noopEmit)
		expect(mine.sessionId).toBe(s.session.id)
		const { sessionGenreOf } = await import("$lib/server/sessions/annexFields")
		const genreId = await sessionGenreOf(testDb as any, s.session.id)
		// The standard genre is among the offered ones on a fresh test database.
		expect(mine.genre?.genreId).toBe(genreId)
		const theirs = await h.handler(fakeSocket(s.stranger.id), { sessionId: s.session.id }, noopEmit)
		expect(theirs).toEqual({ sessionId: s.session.id, genre: null })
	}, 60_000)
})

describe("sessions:messagesPage — the escaped channel filter", () => {
	test("`a_b` does not match a channel `axb`", async () => {
		const { sessionsMessagesPageHandler: h } = await import("./sessions")
		const s = await scenario()
		await testDb.insert(schema.sessionMessages).values([
			{ sessionId: s.session.id, userId: s.owner.id, role: "user", content: "under_score", channel: "a_b" },
			{ sessionId: s.session.id, userId: s.owner.id, role: "user", content: "wildcard", channel: "axb" }
		])
		const page = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, channel: "a_b" }, noopEmit)
		expect(page.error).toBeUndefined()
		expect(page.rows.map((r) => r.channel)).toEqual(["a_b"])
	}, 60_000)
})
