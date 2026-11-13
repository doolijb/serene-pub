/**
 * The book lock (★B-5, owner 2026-11-08): a session keeps the lorebook it
 * started with — refused before play and after, for an own-book session and an
 * overlay session alike; the same value is accepted. `playHasWritten` stays
 * (closeOut and the catch-up read it).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-book-lock-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const VIS = "core:ruleset/vis-itineris@1"
const FREEFORM = "core:ruleset/freeform@1"
let n = 0
const db = () => testDb as unknown as Db
const socket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: {
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any
const quiet = (() => {}) as any

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `book-lock-${++n}`)
	const [first] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `First ${n}` })
		.returning()
	const [second] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Second ${n}`, primaryRuleset: VIS })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${n}`,
			lorebookId: first.id
		})
		.returning()
	return { user, first, second, session }
}

async function line(sessionId: number, metadata: Record<string, unknown> = {}) {
	await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "A line.", metadata })
}

async function sessionRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, id))
	return row
}

describe("playHasWritten", () => {
	test("a greeting is not play; any other line is", async () => {
		const { playHasWritten } = await import("./bookLock")
		const w = await world()
		expect(await playHasWritten(db(), w.session.id)).toBe(false)
		await line(w.session.id, { isGreeting: true })
		expect(await playHasWritten(db(), w.session.id)).toBe(false)
		await line(w.session.id)
		expect(await playHasWritten(db(), w.session.id)).toBe(true)
	})

	test("anything in the session's notes is play too", async () => {
		const { playHasWritten } = await import("./bookLock")
		const w = await world()
		const [notes] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: w.user.id,
				name: "Notes",
				sessionId: w.session.id,
				overlayOf: w.first.id
			})
			.returning()
		expect(await playHasWritten(db(), w.session.id)).toBe(false)
		await testDb.insert(schema.lorebookEntries).values({
			lorebookId: notes.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 0,
			title: "A rumour",
			content: "Heard at the ferry."
		})
		expect(await playHasWritten(db(), w.session.id)).toBe(true)
	})

	test("a notes member this session's own seat holds is the seat, not play (★f-pass-1)", async () => {
		const { playHasWritten } = await import("./bookLock")
		const w = await world()
		const [notes] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: w.user.id,
				name: "Notes",
				sessionId: w.session.id,
				overlayOf: w.first.id
			})
			.returning()
		const [seated] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: notes.id, binding: "{{char:1}}" })
			.returning()
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: w.session.id, castMemberId: seated.id, seatName: "Theo" })
		expect(await playHasWritten(db(), w.session.id)).toBe(false)
		await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: notes.id, binding: "{{char:2}}" })
		expect(await playHasWritten(db(), w.session.id)).toBe(true)
	})
})

describe("the book lock", () => {
	const update = async (userId: number, session: Record<string, unknown>) => {
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		return sessionsUpdateHandler.handler(socket(userId), { session } as any, quiet)
	}

	test("bookChangeRefusal is pure: the same book (null too) passes, any other is refused", async () => {
		const { bookChangeRefusal } = await import("./bookLock")
		expect(bookChangeRefusal({ lorebookId: 4 }, 4)).toBeNull()
		expect(bookChangeRefusal({ lorebookId: null }, null)).toBeNull()
		expect(bookChangeRefusal({ lorebookId: null }, 4)).toBe(BOOK_LOCK_REFUSAL)
		expect(bookChangeRefusal({ lorebookId: 4 }, 5)).toBe(BOOK_LOCK_REFUSAL)
		expect(bookChangeRefusal({ lorebookId: 4 }, null)).toBe(BOOK_LOCK_REFUSAL)
	})

	for (const played of [false, true]) {
		const when = played ? "after play" : "before play"

		test(`an own-book session may not take a book ${when}`, async () => {
			const w = await world()
			await testDb
				.update(schema.sessions)
				.set({ lorebookId: null })
				.where(eq(schema.sessions.id, w.session.id))
			if (played) await line(w.session.id)
			await expect(update(w.user.id, { id: w.session.id, lorebookId: w.second.id })).rejects.toThrow(
				BOOK_LOCK_REFUSAL
			)
			expect((await sessionRow(w.session.id)).lorebookId).toBeNull()
		})

		test(`an overlay session may not switch or drop its book ${when}`, async () => {
			const w = await world()
			if (played) await line(w.session.id)
			await expect(update(w.user.id, { id: w.session.id, lorebookId: w.second.id })).rejects.toThrow(
				BOOK_LOCK_REFUSAL
			)
			await expect(update(w.user.id, { id: w.session.id, lorebookId: null })).rejects.toThrow(
				BOOK_LOCK_REFUSAL
			)
			const after = await sessionRow(w.session.id)
			expect(after.lorebookId).toBe(w.first.id)
			expect(after.primaryRuleset).toBe(FREEFORM)
		})
	}

	test("the same book is accepted and the other fields still save (old clients post every field)", async () => {
		const w = await world()
		await line(w.session.id)
		await update(w.user.id, { id: w.session.id, lorebookId: w.first.id, name: "Renamed" })
		const after = await sessionRow(w.session.id)
		expect(after.name).toBe("Renamed")
		expect(after.lorebookId).toBe(w.first.id)

		await testDb
			.update(schema.sessions)
			.set({ lorebookId: null })
			.where(eq(schema.sessions.id, w.session.id))
		await update(w.user.id, { id: w.session.id, lorebookId: null, name: "Again" })
		const own = await sessionRow(w.session.id)
		expect(own.name).toBe("Again")
		expect(own.lorebookId).toBeNull()
	})

	test("sessions:setLorebook is gone: the summarize handlers no longer register it", async () => {
		const { registerSummarizeHandlers } = await import("$lib/server/sockets/summarize")
		const events: string[] = []
		registerSummarizeHandlers(
			socket(1),
			() => {},
			(_s, handler) => {
				events.push(handler.event)
			}
		)
		expect(events).not.toContain("sessions:setLorebook")
		expect(events).toContain("sessions:summarize")
	})
})

describe("sessions:get", () => {
	test("sessions:get says when the book is fixed", async () => {
		const { sessionsGetHandler } = (await import(
			"$lib/server/sockets/sessions"
		)) as any
		const w = await world()
		const before: any = await sessionsGetHandler.handler(
			socket(w.user.id),
			{ id: w.session.id },
			quiet
		)
		expect(before.session.lorebookFixed).toBe(false)
		await line(w.session.id)
		const after: any = await sessionsGetHandler.handler(
			socket(w.user.id),
			{ id: w.session.id },
			quiet
		)
		expect(after.session.lorebookFixed).toBe(true)
	})
})
