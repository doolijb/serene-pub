/**
 * The book lock (PLAN-lorebook-kinds §A, owner 2026-10-21): a session's
 * lorebook may be chosen, switched or removed until play has written — a line
 * that is not a greeting, or anything in its notes — and a book taken before
 * play brings its Rules. After that the session keeps its book, and says so.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { bookFixedSentence } from "$lib/shared/lorebooks/sessionNotes"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-book-lock-"))
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
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
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
		.values({ userId: user.id, isGroup: false, name: `Run ${n}`, lorebookId: first.id })
		.returning()
	return { user, first, second, session }
}

async function line(sessionId: number, metadata: Record<string, unknown> = {}) {
	await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "A line.", metadata })
}

async function sessionRow(id: number) {
	const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, id))
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
			.values({ userId: w.user.id, name: "Notes", sessionId: w.session.id, overlayOf: w.first.id })
			.returning()
		expect(await playHasWritten(db(), w.session.id)).toBe(false)
		await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes.id,
				typeId: "core:entry/world-lore",
				typeVersion: 1,
				position: 0,
				title: "A rumour",
				content: "Heard at the ferry."
			})
		expect(await playHasWritten(db(), w.session.id)).toBe(true)
	})
})

describe("sessions:setLorebook", () => {
	test("before play, a book can be switched and brings its Rules", async () => {
		const { sessionsSetLorebookHandler } = await import("$lib/server/sockets/summarize")
		const w = await world()
		await line(w.session.id, { isGreeting: true })
		await sessionsSetLorebookHandler.handler(
			socket(w.user.id),
			{ sessionId: w.session.id, lorebookId: w.second.id },
			quiet
		)
		const after = await sessionRow(w.session.id)
		expect(after.lorebookId).toBe(w.second.id)
		expect(after.primaryRuleset).toBe(VIS)
	})

	test("before play, a book on Freeform brings no rules: the session keeps its own (fix7)", async () => {
		const { sessionsSetLorebookHandler } = await import("$lib/server/sockets/summarize")
		const w = await world()
		// Started with no book, on the rules the person picked.
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: null, primaryRuleset: VIS, rigour: "scripts" })
			.where(eq(schema.sessions.id, w.session.id))
		await sessionsSetLorebookHandler.handler(
			socket(w.user.id),
			{ sessionId: w.session.id, lorebookId: w.first.id },
			quiet
		)
		const after = await sessionRow(w.session.id)
		expect(after.lorebookId).toBe(w.first.id)
		expect(w.first.primaryRuleset).toBe(FREEFORM)
		expect(after.primaryRuleset).toBe(VIS)
		expect(after.rigour).toBe("scripts")
	})

	test("once play has written, the session keeps its book, and says what to do", async () => {
		const { sessionsSetLorebookHandler } = await import("$lib/server/sockets/summarize")
		const w = await world()
		await line(w.session.id)
		await expect(
			sessionsSetLorebookHandler.handler(
				socket(w.user.id),
				{ sessionId: w.session.id, lorebookId: w.second.id },
				quiet
			)
		).rejects.toThrow(bookFixedSentence(`'${w.first.name}'`))
		await expect(
			sessionsSetLorebookHandler.handler(
				socket(w.user.id),
				{ sessionId: w.session.id, lorebookId: null },
				quiet
			)
		).rejects.toThrow("so it keeps reading it")
		const after = await sessionRow(w.session.id)
		expect(after.lorebookId).toBe(w.first.id)
		expect(after.primaryRuleset).toBe(FREEFORM)
	})

	test("a story underway with no book keeps its notes and is pointed at making them a lorebook", async () => {
		const { sessionsSetLorebookHandler } = await import("$lib/server/sockets/summarize")
		const { NOTES_KEEP_THE_WORLD } = await import("./bookLock")
		const w = await world()
		await testDb.update(schema.sessions).set({ lorebookId: null }).where(eq(schema.sessions.id, w.session.id))
		await line(w.session.id)
		await expect(
			sessionsSetLorebookHandler.handler(
				socket(w.user.id),
				{ sessionId: w.session.id, lorebookId: w.second.id },
				quiet
			)
		).rejects.toThrow(NOTES_KEEP_THE_WORLD)
	})
})

describe("sessions:update and sessions:get", () => {
	test("the session form's book change is held to the same lock", async () => {
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const w = await world()
		await line(w.session.id)
		await expect(
			sessionsUpdateHandler.handler(
				socket(w.user.id),
				{ session: { id: w.session.id, lorebookId: w.second.id } } as any,
				quiet
			)
		).rejects.toThrow("so it keeps reading it")
	})

	test("sessions:get says when the book is fixed", async () => {
		const { sessionsGetHandler } = (await import("$lib/server/sockets/sessions")) as any
		const w = await world()
		const before: any = await sessionsGetHandler.handler(socket(w.user.id), { id: w.session.id }, quiet)
		expect(before.session.lorebookFixed).toBe(false)
		await line(w.session.id)
		const after: any = await sessionsGetHandler.handler(socket(w.user.id), { id: w.session.id }, quiet)
		expect(after.session.lorebookFixed).toBe(true)
	})
})
