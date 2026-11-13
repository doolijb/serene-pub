/**
 * 🚧 A parent's own book outlives it while a branch rides it (plan §33.3).
 *
 * Claims: deleting a session no branch rides purges its own book; deleting a
 * parent a branch rides keeps the parent's own book and its cast members, and
 * the branch still reads them; the last branch's delete purges what it kept,
 * through a chain of any depth; and the boot sweep (`kept-own-books`) removes
 * an orphaned own book nobody rides, keeps one a live branch rides, and a
 * second run changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

// Off by default, so every other test keeps the real function.
const purge = vi.hoisted(() => ({ fail: false }))
vi.mock("$lib/server/lorebooks/ownBook", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/lorebooks/ownBook")>()
	return {
		...actual,
		purgeOwnBookOf: (...args: Parameters<typeof actual.purgeOwnBookOf>) =>
			purge.fail ? Promise.reject(new Error("purge failed")) : actual.purgeOwnBookOf(...args)
	}
})

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-kept-own-books-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = (tx: unknown) => tx as Db

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("kept-books"))
}

/** A session with its own book (made the way a birth makes it) and one line. */
async function sessionWithBook(userId: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run") })
		.returning()
	const { insertOwnBook } = await import("./ownBook")
	const book = await insertOwnBook(asDb(testDb), {
		sessionId: row!.id,
		userId,
		name: row!.name,
		overlayOf: null,
		primaryRuleset: row!.primaryRuleset,
		rulesetVersion: null
	})
	const [line] = await insertLegacyMany(testDb, [
		{
			sessionId: row!.id,
			userId,
			characterId: null,
			personaId: null,
			role: "user",
			content: "A line."
		}
	])
	return { session: row!, book, line: line! }
}

async function branchOf(s: { session: { id: number }; line: { id: number } }) {
	const { branchSession } = await import("$lib/server/sessions/branch")
	return branchSession(asDb(testDb), {
		sessionId: s.session.id,
		fromMessageId: s.line.id
	})
}

/** A branch of a branch needs a line of its own to fork from. */
async function lineOf(sessionId: number, userId: number) {
	const [m] = await insertLegacyMany(testDb, [
		{
			sessionId,
			userId,
			characterId: null,
			personaId: null,
			role: "user",
			content: "Another line."
		}
	])
	return m!
}

async function deleteThroughSocket(
	userId: number,
	id: number,
	emit: (event: string, data: any) => unknown = () => {}
) {
	const { sessionsDeleteHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return sessionsDeleteHandler.handler(
		{
			user: { id: userId },
			io: { to: () => ({ emit: () => {} }) }
		} as any,
		{ id } as any,
		emit as any
	)
}

const bookRow = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
	)[0]

const bookById = async (id: number) =>
	(
		await testDb
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, id))
	)[0]

describe("a parent's own book outlives it while a branch rides it", () => {
	it("deleting a session no branch rides purges its own book", async () => {
		const u = await user()
		const s = await sessionWithBook(u.id)
		await deleteThroughSocket(u.id, s.session.id)
		expect(await bookRow(s.session.id)).toBeUndefined()
	})

	it("deleting a parent keeps its book and cast members; the branch still reads them", async () => {
		const u = await user()
		const parent = await sessionWithBook(u.id)
		const { card } = await insertCard(asDb(testDb), {
			userId: u.id,
			name: uniq("Card"),
			description: "x"
		})
		const { member } = await insertCastMember(asDb(testDb), {
			lorebookId: parent.book.id,
			binding: "{{char:kept}}",
			characterId: card.id,
			name: "Ada"
		})
		const branch = await branchOf(parent)

		await deleteThroughSocket(u.id, parent.session.id)

		expect(await bookById(parent.book.id)).toBeDefined()
		const [kept] = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, member.id))
		expect(kept).toBeDefined()
		const { overlayChainOf } = await import("$lib/server/state/reading")
		expect(await overlayChainOf(asDb(testDb), branch.id)).toContain(
			parent.book.id
		)
	})

	it("the last branch's delete purges the kept book; with two, the second does", async () => {
		const u = await user()
		const parent = await sessionWithBook(u.id)
		const one = await branchOf(parent)
		const two = await branchOf(parent)
		await deleteThroughSocket(u.id, parent.session.id)
		expect(await bookById(parent.book.id)).toBeDefined()

		await deleteThroughSocket(u.id, one.id)
		expect(await bookById(parent.book.id)).toBeDefined()
		expect(await bookRow(two.id)).toBeDefined()

		await deleteThroughSocket(u.id, two.id)
		expect(await bookById(parent.book.id)).toBeUndefined()
		expect(await bookRow(two.id)).toBeUndefined()
	})

	it("a chain A to B to C ends with every kept book gone", async () => {
		const u = await user()
		const a = await sessionWithBook(u.id)
		const b = await branchOf(a)
		const bLine = await lineOf(b.id, u.id)
		const c = await branchOf({ session: b, line: bLine })
		const aBook = a.book.id
		const bBook = (await bookRow(b.id))!.id

		await deleteThroughSocket(u.id, a.session.id)
		await deleteThroughSocket(u.id, b.id)
		expect(await bookById(aBook)).toBeDefined()
		expect(await bookById(bBook)).toBeDefined()

		await deleteThroughSocket(u.id, c.id)
		expect(await bookById(aBook)).toBeUndefined()
		expect(await bookById(bBook)).toBeUndefined()
	})
})

describe("the delete's order", () => {
	it("the session-notes list emitted does not name the deleted session", async () => {
		const u = await user()
		const parent = await sessionWithBook(u.id)
		await branchOf(parent)
		const emits: Array<{ event: string; data: any }> = []
		const pending: Promise<void>[] = []
		await deleteThroughSocket(u.id, parent.session.id, (event, data) => {
			// The handler does not await a push: resolve the lazy form here.
			pending.push(
				(async () => {
					emits.push({
						event,
						data: typeof data === "function" ? await data() : data
					})
				})()
			)
		})
		await Promise.all(pending)
		const lists = emits.filter((e) => e.event === "lorebooks:sessionNotes")
		expect(lists.length).toBeGreaterThan(0)
		for (const l of lists) {
			const rows: any[] = l.data.books
			expect(rows.some((b) => b.sessionId === parent.session.id)).toBe(false)
		}
	})

	it("a purge failure does not refuse the delete; the boot sweep takes the book", async () => {
		const u = await user()
		const s = await sessionWithBook(u.id)
		purge.fail = true
		let res: any
		try {
			res = await deleteThroughSocket(u.id, s.session.id)
		} finally {
			purge.fail = false
		}
		expect(res.success).toBeTruthy()
		const gone = await testDb
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.session.id))
		expect(gone).toHaveLength(0)
		expect(await bookById(s.book.id)).toBeDefined()
		const { purgeKeptOwnBooks } = await import("./ownBook")
		await purgeKeptOwnBooks(asDb(testDb))
		expect(await bookById(s.book.id)).toBeUndefined()
	})
})

describe("the boot sweep (kept-own-books)", () => {
	it("removes an orphaned book nobody rides, keeps a ridden one, and a second run changes nothing", async () => {
		const { purgeKeptOwnBooks } = await import("./ownBook")
		const u = await user()
		const orphan = await sessionWithBook(u.id)
		const ridden = await sessionWithBook(u.id)
		const branch = await branchOf(ridden)
		// Rows deleted raw, as a path that skipped the purge would leave them.
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, orphan.session.id))
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, ridden.session.id))
		expect(await bookById(orphan.book.id)).toBeDefined()

		expect(await purgeKeptOwnBooks(asDb(testDb))).toBe(1)
		expect(await bookById(orphan.book.id)).toBeUndefined()
		expect(await bookById(ridden.book.id)).toBeDefined()
		expect(await bookRow(branch.id)).toBeDefined()

		const all = () => testDb.select().from(schema.lorebooks)
		const before = (await all()).map((b) => b.id).sort()
		expect(await purgeKeptOwnBooks(asDb(testDb))).toBe(0)
		expect((await all()).map((b) => b.id).sort()).toEqual(before)
	})
})
