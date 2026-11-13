/**
 * 🚧 Creation modes (M0, F5): `sessions:create { mode, from? }` —
 * `new` (absent), `new-world`, `branch`, `next-chapter` — and their refusals.
 *
 * Pinned:
 *  1. no mode is today's create;
 *  2. `new-world` copies the book (new id, entries copied) and attaches the copy;
 *  3. `branch` forks at the newest live message: a branch marker and the history up to it;
 *  4. `next-chapter` closes the old session out (its open scene filed), starts on the same
 *     book and line, seeds ONLY what is declared `nextChapter: true` (an attribute value, an
 *     annex key; one not declared so is absent) and copies no message beyond the new greeting;
 *  5. each refusal sentence.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertLegacy } from "$lib/server/messages/store"
import { annexField, declareHostState, defineAttributeSlot, getGenre } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

// The summaries themselves have their own coverage (sessions.closeOut.int.test.ts).
const summaries = vi.fn()
vi.mock("$lib/server/sockets/scenes", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/sockets/scenes")>()),
	runSceneSummaries: (...args: any[]) => summaries(...args)
}))

const CARRIED_SLOT = "acme.saga:slot/renown@1"
const LEFT_SLOT = "acme.saga:slot/mood@1"
const STORY_GENRE = "core:genre/story"
const PLUGIN = "acme.saga"

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-creation-modes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)

	defineAttributeSlot(CARRIED_SLOT, {
		type: "integer",
		descriptor: "How well known they are.",
		appliesTo: ["world"],
		nextChapter: true
	})
	defineAttributeSlot(LEFT_SLOT, {
		type: "integer",
		descriptor: "How the table feels.",
		appliesTo: ["world"]
	})
	// Story's sessions track both slots: the create handler only starts genres the
	// database registers, so the registered Story genre is the one used.
	const story = getGenre(STORY_GENRE)!
	declareHostState([CARRIED_SLOT, LEFT_SLOT].map((slot) => ({ slot, role: "tool" as const, genres: [story] })))
	await testDb.insert(schema.plugins).values({
		pluginId: PLUGIN,
		name: PLUGIN,
		version: "1.0.0",
		bundleSource: "// none",
		bundleHash: `hash-${PLUGIN}`,
		enabled: true,
		manifest: {
			annexFields: [
				annexField({ key: "oath", shape: { type: "string" }, see: ["person"], nextChapter: true }),
				annexField({ key: "grudge", shape: { type: "string" }, see: ["person"] })
			]
		}
	} as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(() => summaries.mockReset())

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any
const noEmit = () => {}

let seq = 0
async function world(opts: { lines?: number } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `creation-modes-owner-${++seq}`)
	const stranger = await createTestUser(testDb, `creation-modes-stranger-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Creation book ${seq}`, userId: owner.id })
		.returning()
	await testDb.insert(schema.lorebookEntries).values([
		{ lorebookId: book.id, typeId: "core:entry/world-lore", typeVersion: 1, position: 1, title: "The keep", content: "Grey stone." },
		{ lorebookId: book.id, typeId: "core:entry/world-lore", typeVersion: 1, position: 2, title: "The ford", content: "Cold water." }
	] as any)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId: STORY_GENRE,
			lorebookId: book.id,
			name: `Tale ${seq}`
		})
		.returning()
	const lines = []
	for (let i = 0; i < (opts.lines ?? 0); i++)
		lines.push(await insertLegacy(testDb as unknown as Db, { sessionId: session.id, role: "user", content: `line ${i + 1}`, channel: "main" }))
	return { owner, stranger, book, session, lines }
}

const create = async (userId: number, params: Record<string, unknown>, emit: (e: string, d: any) => void = noEmit) => {
	const { sessionsCreateHandler } = await import("./sessions")
	return (await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{ characterIds: [], personaIds: [], ...params } as any,
		emit
	)) as any
}

const messagesOf = (sessionId: number) =>
	testDb.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId))

describe("no mode", () => {
	test("is today's create: a new session, the book attached as given", async () => {
		const w = await world()
		const res = await create(w.owner.id, { session: { name: "Plain", lorebookId: w.book.id } })
		expect(res.error ?? null).toBeNull()
		expect(res.session.lorebookId).toBe(w.book.id)
	})
})

describe("new-world", () => {
	test("copies the book and attaches the copy", async () => {
		const w = await world()
		const res = await create(w.owner.id, {
			mode: "new-world",
			session: { name: "Elsewhere", lorebookId: w.book.id }
		})
		expect(res.error ?? null).toBeNull()
		const copyId = res.session.lorebookId
		expect(copyId).not.toBe(w.book.id)
		const [copy] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, copyId))
		expect(copy.name).toBe(`${w.book.name} (copy)`)
		const titles = (
			await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, copyId))
		).map((e) => e.title)
		expect(titles.sort()).toEqual(["The ford", "The keep"])
		// The source is untouched.
		const [source] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, w.book.id))
		expect(source.name).toBe(w.book.name)
	})

	test("refuses without a world to copy", async () => {
		const w = await world()
		const emitted: any[] = []
		const res = await create(w.owner.id, { mode: "new-world", session: { name: "Nowhere" } }, (e, d) =>
			emitted.push({ e, d })
		)
		expect(res).toEqual({ error: "Choose the world to copy." })
		expect(emitted).toContainEqual({ e: "sessions:create:error", d: { error: "Choose the world to copy." } })
	})
})

describe("branch", () => {
	test("forks at the newest live message: a branch marker and the history up to it", async () => {
		const w = await world({ lines: 4 })
		const res = await create(w.owner.id, { mode: "branch", from: w.session.id, session: { name: "ignored" } })
		expect(res.error ?? null).toBeNull()
		const branchedId = res.session.id
		expect(branchedId).not.toBe(w.session.id)
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, branchedId))
		expect(row.userId).toBe(w.owner.id)
		const copied = (await messagesOf(branchedId)).map((m) => m.content)
		for (const line of ["line 1", "line 2", "line 3", "line 4"]) expect(copied).toContain(line)
	})

	test("refuses: no session chosen, and someone else's", async () => {
		const w = await world({ lines: 2 })
		expect(await create(w.owner.id, { mode: "branch", session: { name: "x" } })).toEqual({
			error: "Choose the session to branch."
		})
		expect(await create(w.stranger.id, { mode: "branch", from: w.session.id, session: { name: "x" } })).toEqual({
			error: "Only the session's owner can branch it."
		})
	})
})

/** The old session's state: a carried value, one that is not, and two annex keys. */
async function stateOfOld(w: Awaited<ReturnType<typeof world>>) {
	const { applyChangeSet, newestMessageId } = await import("$lib/server/state/write")
	const anchor = await newestMessageId(testDb as unknown as Db, w.session.id)
	await applyChangeSet(
		testDb as unknown as Db,
		{ sessionId: w.session.id, updatedBy: "user", userId: w.owner.id, messageId: anchor },
		[
			{ owner: { kind: "session", id: w.session.id }, slotId: CARRIED_SLOT, value: 7 },
			{ owner: { kind: "session", id: w.session.id }, slotId: LEFT_SLOT, value: 3 }
		],
		{ mode: "apply" }
	)
	await testDb
		.update(schema.sessions)
		.set({ annex: { [PLUGIN]: { oath: "to the ford", grudge: "the keep" } } as any })
		.where(eq(schema.sessions.id, w.session.id))
}

/** What the new session holds: the carried rows, the annex, and its messages oldest first. */
async function carriedInto(nextId: number) {
	const rowsOf = (slotId: string) =>
		testDb
			.select()
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.sessionId, nextId), eq(schema.attributeValues.slotId, slotId)))
	const [next] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, nextId))
	const messages = (await messagesOf(nextId)).sort((a, b) => a.id - b.id)
	return { carried: await rowsOf(CARRIED_SLOT), left: await rowsOf(LEFT_SLOT), next, messages }
}

describe("next-chapter", () => {
	test("closes out the old session, continues the book and line, seeds only what is declared nextChapter", async () => {
		const w = await world({ lines: 4 })
		await stateOfOld(w)

		// A character with a first message: the greeting is the new session's
		// message the carried state is anchored to.
		const [teller] = await testDb
			.insert(schema.characters)
			.values({ userId: w.owner.id, name: "Teller", description: "Tells.", firstMessage: "Chapter two begins." })
			.returning()
		const res = await create(w.owner.id, {
			mode: "next-chapter",
			from: w.session.id,
			characterIds: [teller.id],
			session: { name: "Chapter two", genreId: STORY_GENRE }
		})
		expect(res.error ?? null).toBeNull()
		const nextId = res.session.id

		// The old session was closed out: its stretch is filed as a scene.
		const filed = await testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, w.session.id))
		expect(filed.length).toBeGreaterThan(0)

		// The chapter's first message is the system row, ahead of the greeting; the seed is anchored to it.
		const held = await carriedInto(nextId)
		expect(held.messages[0]).toMatchObject({ role: "system", content: "Chapter begins." })
		expect(held.messages.map((m) => m.content)).toContain("Chapter begins.")
		expect(held.carried[0]!.validFromMessageId).toBe(held.messages[0]!.id)

		// Same book and line.
		const [old] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		const [next] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, nextId))
		expect(next.lorebookId).toBe(old.lorebookId)
		expect(next.lorebookBranchId).toBe(old.lorebookBranchId)

		// The declared value follows (a row of the new session's own layer); the undeclared one does not.
		const rowsOf = (slotId: string) =>
			testDb
				.select()
				.from(schema.attributeValues)
				.where(and(eq(schema.attributeValues.sessionId, nextId), eq(schema.attributeValues.slotId, slotId)))
		const carried = await rowsOf(CARRIED_SLOT)
		expect(carried).toHaveLength(1)
		expect(carried[0]).toMatchObject({ ownerKind: "session", ownerId: nextId })
		expect(await rowsOf(LEFT_SLOT)).toHaveLength(0)

		// The declared annex key follows; the undeclared one does not.
		const doc = ((next.annex ?? {}) as any)[PLUGIN] ?? {}
		expect(doc.oath).toBe("to the ford")
		expect(doc.grudge).toBeUndefined()

		// No history: nothing of the old lines came across.
		const contents = (await messagesOf(nextId)).map((m) => m.content)
		for (const line of ["line 1", "line 2", "line 3", "line 4"]) expect(contents).not.toContain(line)
	})

	test("with no greeting at all: the system row is still first and the seed is anchored to it", async () => {
		const w = await world({ lines: 3 })
		await stateOfOld(w)
		const res = await create(w.owner.id, {
			mode: "next-chapter",
			from: w.session.id,
			session: { name: "Chapter two, quiet", genreId: STORY_GENRE }
		})
		expect(res.error ?? null).toBeNull()
		const held = await carriedInto(res.session.id)
		expect(held.messages[0]).toMatchObject({ role: "system", content: "Chapter begins." })
		expect(held.messages).toHaveLength(1)
		expect(held.carried).toHaveLength(1)
		expect(held.carried[0]!.validFromMessageId).toBe(held.messages[0]!.id)
		expect(held.left).toHaveLength(0)
		const doc = ((held.next.annex ?? {}) as any)[PLUGIN] ?? {}
		expect(doc.oath).toBe("to the ford")
		expect(doc.grudge).toBeUndefined()
		const imprints = await testDb
			.select()
			.from(schema.sessionImprints)
			.where(eq(schema.sessionImprints.sessionId, res.session.id))
		const oath = imprints.find((r) => r.subjectKind === "annex" && r.subjectKey === `${PLUGIN}/oath`)
		expect(oath!.messageId).toBe(held.messages[0]!.id)
		expect(oath!.after).toEqual({ v: "to the ford" })
	})

	test("an archived session is not closed out again", async () => {
		const w = await world({ lines: 2 })
		await testDb.update(schema.sessions).set({ archivedAt: new Date() }).where(eq(schema.sessions.id, w.session.id))
		const res = await create(w.owner.id, { mode: "next-chapter", from: w.session.id, session: { name: "Then" } })
		expect(res.error ?? null).toBeNull()
		expect(summaries).not.toHaveBeenCalled()
		expect(await testDb.select().from(schema.scenes).where(eq(schema.scenes.sessionId, w.session.id))).toHaveLength(0)
	})

	test("a next chapter starts at the followed session's clock", async () => {
		const w = await world({ lines: 2 })
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 1200, storyClockMonth: 3, storyClockDay: 4, storyClockHour: 5, storyClockMinute: 6 })
			.where(eq(schema.sessions.id, w.session.id))
		const res = await create(w.owner.id, { mode: "next-chapter", from: w.session.id, session: { name: "Chapter two", genreId: STORY_GENRE } })
		expect(res.error ?? null).toBeNull()
		const [next] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, res.session.id))
		expect([next.storyClockYear, next.storyClockMonth, next.storyClockDay, next.storyClockHour, next.storyClockMinute]).toEqual([1200, 3, 4, 5, 6])
	}, 60_000)

	test("a following session is followed by a following one", async () => {
		const w = await world({ lines: 2 })
		const res = await create(w.owner.id, { mode: "next-chapter", from: w.session.id, session: { name: "Chapter two", genreId: STORY_GENRE } })
		expect(res.error ?? null).toBeNull()
		const [next] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, res.session.id))
		expect([next.storyClockYear, next.storyClockMonth, next.storyClockDay, next.storyClockHour, next.storyClockMinute]).toEqual([null, null, null, null, null])
	}, 60_000)

	test("refuses: no session chosen, and someone else's", async () => {
		const w = await world({ lines: 2 })
		expect(await create(w.owner.id, { mode: "next-chapter", session: { name: "x" } })).toEqual({
			error: "Choose the session this one follows."
		})
		expect(
			await create(w.stranger.id, { mode: "next-chapter", from: w.session.id, session: { name: "x" } })
		).toEqual({ error: "Only the session's owner can start its next chapter." })
	})

	test("follows a session with no lorebook: its own book is shared, and both read it", async () => {
		const w = await world({ lines: 2 })
		const [bare] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.owner.id, isGroup: false, genreId: STORY_GENRE, name: "No book" })
			.returning()
		await insertLegacy(testDb as unknown as Db, { sessionId: bare.id, role: "user", content: "a line", channel: "main" })
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const notes = await ownBookFor(testDb as unknown as Db, bare.id)
		const res = await create(w.owner.id, { mode: "next-chapter", from: bare.id, session: { name: "Chapter two", genreId: STORY_GENRE } })
		expect(res.error ?? null).toBeNull()
		const [old] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, bare.id))
		const [next] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, res.session.id))
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, notes.id))
		expect(old.lorebookId).toBe(notes.id)
		expect(next.lorebookId).toBe(notes.id)
		expect(book!.sessionId).toBeNull()
		expect((await messagesOf(res.session.id)).map((m) => m.content)).toContain("Chapter begins.")
	})
})

describe("a surfaced book (★B-3)", () => {
	/** A session whose own notes were shared as a lorebook: the book is surfaced from it. */
	async function surfaced() {
		const w = await world({ lines: 2 })
		const [bare] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.owner.id, isGroup: false, genreId: STORY_GENRE, name: "Surfacing" })
			.returning()
		await insertLegacy(testDb as unknown as Db, { sessionId: bare.id, role: "user", content: "a line", channel: "main" })
		const { ownBookFor, shareAsLorebook } = await import("$lib/server/lorebooks/ownBook")
		const notes = await ownBookFor(testDb as unknown as Db, bare.id)
		await testDb
			.insert(schema.lorebookEntries)
			.values({ lorebookId: notes.id, typeId: "core:entry/world-lore", typeVersion: 1, position: 1, title: "The mill", content: "Loud." } as any)
		await shareAsLorebook(testDb as unknown as Db, { sessionId: bare.id, userId: w.owner.id })
		return { ...w, bare, bookId: notes.id }
	}
	const SENTENCE = "This lorebook is another session's story. Start from a copy of it instead."

	const BRANCH_SENTENCE =
		"Only a lorebook of your own can be branched off at the start. Choose one of yours, or start on its latest line."
	const sessionRow = async (id: number) =>
		(await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, id)))[0]!
	/** A line of the book, played by the surfacing session (so it is the most recent). */
	async function playedLine(s: Awaited<ReturnType<typeof surfaced>>) {
		const [line] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: s.bookId, name: "Saga line" })
			.returning()
		await testDb.update(schema.sessions).set({ lorebookBranchId: line!.id }).where(eq(schema.sessions.id, s.bare.id))
		return line!
	}

	test("the owner's plain create on it starts on the book, on its most recently played line", async () => {
		const s = await surfaced()
		const line = await playedLine(s)
		const res = await create(s.owner.id, { session: { name: "Plain", genreId: STORY_GENRE, lorebookId: s.bookId } })
		expect(res.error ?? null).toBeNull()
		const row = await sessionRow(res.session.id)
		expect(row.lorebookId).toBe(s.bookId)
		expect(row.lorebookBranchId).toBe(line.id)
		expect(row.lineOnFirstWrite).toBe(false)
		const surfacing = await sessionRow(s.bare.id)
		expect(surfacing.lorebookId).toBe(s.bookId)
		expect(surfacing.lorebookBranchId).toBe(line.id)
		expect(surfacing.lineOnFirstWrite).toBe(false)
	})

	test("the owner's branch off: that line, that clock, the flag; the first write forks a line from it", async () => {
		const s = await surfaced()
		const line = await playedLine(s)
		const res = await create(s.owner.id, {
			session: {
				name: "Branching",
				genreId: STORY_GENRE,
				lorebookId: s.bookId,
				lorebookBranchId: line.id,
				storyClockYear: 1200,
				storyClockMonth: 3,
				storyClockDay: 4,
				lineOnFirstWrite: true
			}
		})
		expect(res.error ?? null).toBeNull()
		const row = await sessionRow(res.session.id)
		expect(row.lorebookId).toBe(s.bookId)
		expect(row.lorebookBranchId).toBe(line.id)
		expect([row.storyClockYear, row.storyClockMonth, row.storyClockDay]).toEqual([1200, 3, 4])
		expect(row.lineOnFirstWrite).toBe(true)
		const { ensureSessionLine } = await import("$lib/server/lorebooks/sessionLine")
		const newLine = await ensureSessionLine(testDb as unknown as Db, res.session.id)
		expect(newLine).not.toBeNull()
		expect(newLine).not.toBe(line.id)
		const [forked] = await testDb.select().from(schema.lorebookBranches).where(eq(schema.lorebookBranches.id, newLine!))
		expect(forked!.forkedFromBranchId).toBe(line.id)
		expect([forked!.forkYear, forked!.forkMonth, forked!.forkDay]).toEqual([1200, 3, 4])
		const after = await sessionRow(res.session.id)
		expect(after.lorebookBranchId).toBe(newLine)
		expect(after.lineOnFirstWrite).toBe(false)
		// The surfacing session is untouched.
		const surfacing = await sessionRow(s.bare.id)
		expect([surfacing.lorebookId, surfacing.lorebookBranchId, surfacing.lineOnFirstWrite]).toEqual([s.bookId, line.id, false])
	})

	test("another user's surfaced book, shared with them: a plain create is refused, a copy starts on a copy", async () => {
		const s = await surfaced()
		await testDb.insert(schema.lorebookShares).values({ lorebookId: s.bookId, userId: s.stranger.id } as any)
		// Not their book to read: the access denial stops it before any start.
		await expect(
			create(s.stranger.id, { session: { name: "Plain", genreId: STORY_GENRE, lorebookId: s.bookId } })
		).rejects.toThrow(/only read a lorebook you own/)
		const copy = await create(s.stranger.id, { mode: "new-world", session: { name: "Mine", genreId: STORY_GENRE, lorebookId: s.bookId } })
		expect(copy.error ?? null).toBeNull()
		expect(copy.session.lorebookId).not.toBe(s.bookId)
		const [copied] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, copy.session.lorebookId))
		expect(copied!.userId).toBe(s.stranger.id)
	})

	test("lineOnFirstWrite is refused on a copy, with no book, and on a book the asker does not own", async () => {
		const s = await surfaced()
		const copy = await create(s.owner.id, { mode: "new-world", session: { name: "C", genreId: STORY_GENRE, lorebookId: s.bookId, lineOnFirstWrite: true } })
		expect(copy).toEqual({ error: BRANCH_SENTENCE })
		const none = await create(s.owner.id, { session: { name: "N", genreId: STORY_GENRE, lineOnFirstWrite: true } })
		expect(none).toEqual({ error: BRANCH_SENTENCE })
		await testDb.insert(schema.lorebookShares).values({ lorebookId: s.book.id, userId: s.stranger.id } as any)
		// A book the asker does not own never starts: the access denial comes first.
		await expect(
			create(s.stranger.id, { session: { name: "F", genreId: STORY_GENRE, lorebookId: s.book.id, lineOnFirstWrite: true } })
		).rejects.toThrow(/only read a lorebook you own/)
	})

	test("a next chapter of the surfacing session starts on the book, and so does the chapter after that", async () => {
		const s = await surfaced()
		const one = await create(s.owner.id, { mode: "next-chapter", from: s.bare.id, session: { name: "Two", genreId: STORY_GENRE } })
		expect(one.error ?? null).toBeNull()
		expect(one.session.lorebookId).toBe(s.bookId)
		const two = await create(s.owner.id, { mode: "next-chapter", from: one.session.id, session: { name: "Three", genreId: STORY_GENRE } })
		expect(two.error ?? null).toBeNull()
		expect(two.session.lorebookId).toBe(s.bookId)
	})

	test("a copy (new-world) starts on a copy, and the original stays surfaced", async () => {
		const s = await surfaced()
		const res = await create(s.owner.id, { mode: "new-world", session: { name: "Elsewhere", lorebookId: s.bookId } })
		expect(res.error ?? null).toBeNull()
		expect(res.session.lorebookId).not.toBe(s.bookId)
		const [copy] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, res.session.lorebookId))
		expect(copy!.surfacedFromSessionId).toBeNull()
		const [source] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, s.bookId))
		expect(source!.surfacedFromSessionId).toBe(s.bare.id)
	})

	test("a branch of the surfacing session reads it", async () => {
		const s = await surfaced()
		const res = await create(s.owner.id, { mode: "branch", from: s.bare.id, session: { name: "ignored" } })
		expect(res.error ?? null).toBeNull()
		expect(res.session.lorebookId).toBe(s.bookId)
	})
})
