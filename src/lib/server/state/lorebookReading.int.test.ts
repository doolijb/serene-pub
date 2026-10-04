/**
 * 🚧 Where a read of a lorebook stands (rulings 15 and 16, 2026-09-27).
 *
 *  1. With no session, the book's MOST RECENTLY USED line is read: the line of
 *     the session holding the book's newest message; else the newest session's;
 *     else main.
 *  2. The fork cut: a branch sees main's dated rows only up to its fork date,
 *     in `lorebook_state`, in `stat_trail`'s timeline, and in the session's
 *     own resolution and story now.
 *  3. The custom reading: `branch`, `at` and `forkCut` override the defaults,
 *     still inside the book the run may read.
 *  4. A foreign branch is refused — by both queries and by the session save.
 *  5. The session's pointer (line + story clock) is persisted by its settings and
 *     honoured by its resolution and its story now.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebook-reading-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const HP = "core:slot/hp@1"
const GENRE = "test:genre/lorebook-reading"

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 100 },
		default: 20
	})
	genre(GENRE, {
		name: { en: "Lorebook reading" },
		family: "test",
		slots: [hp],
		customAttributes: "allow",
		events: {}
	})
}

let n = 0
const node = { key: "read", definitionId: "core:query/lorebook-state@1" } as any

async function book() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lorebook-reading-${suffix}`)
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${suffix}`, description: "…" })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: verity.id,
			binding: `{{char:${verity.id}}}`,
			name: verity.name
		})
		.returning()
	const dated = async (fields: Record<string, unknown>, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title: null,
					content: "…",
					fields,
					branchId
				})
				.returning()
		)[0]
	const branch = async (name: string, fork?: { year: number; month?: number; day?: number }) =>
		(
			await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: lorebook.id,
					name: `${name} ${n}`,
					forkYear: fork?.year ?? null,
					forkMonth: fork?.month ?? null,
					forkDay: fork?.day ?? null
				})
				.returning()
		)[0]
	return { user, verity, lorebook, binding, dated, branch }
}

type Book = Awaited<ReturnType<typeof book>>

async function session(b: Book, opts: { branchId?: number | null; moment?: { year: number } } = {}) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: b.user.id,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			lorebookId: b.lorebook.id,
			lorebookBranchId: opts.branchId ?? null,
			storyClockYear: opts.moment?.year ?? null
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: s.id, characterId: b.verity.id })
	return s
}

async function message(sessionId: number, characterId: number) {
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", characterId, content: "…" })
		.returning()
	await testDb.insert(schema.messages).values({ id: legacy.id, sessionId, characterId, role: "assistant" })
	return legacy.id
}

const durable = async (
	ownerId: number,
	v: unknown,
	extra: Partial<typeof schema.attributeValues.$inferInsert> = {}
) =>
	(
		await testDb
			.insert(schema.attributeValues)
			.values({ ownerKind: "cast_member", ownerId, slotId: HP, value: { v }, sessionId: null, updatedBy: "user", ...extra })
			.returning()
	)[0]

const host = async (scope: { sessionId?: number; lorebookId?: number }) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const services = createHost(testDb as unknown as Db, scope)
	return { read: (table: string, q: unknown) => services.read!(table, q, node) }
}

/**
 * A book with a branch forked at year 5: main's hp is 10 at year 3 and 30 at
 * year 7 (after the fork), and the branch's own is 44 at year 8.
 */
async function forkedBook() {
	declareSlots()
	const b = await book()
	const fork = await b.branch("fork", { year: 5 })
	const y3 = await b.dated({ year: 3 })
	const y7 = await b.dated({ year: 7 })
	const y8 = await b.dated({ year: 8 }, fork.id)
	await durable(b.binding.id, 10, { historyEntryId: y3.id })
	await durable(b.binding.id, 30, { historyEntryId: y7.id })
	return { b, fork, y3, y7, y8 }
}

const hpOf = (state: any, b: Book) => state.cast.byId[String(b.binding.id)]?.hp
const values = (history: any) => history.points.map((p: any) => p.value)
const cast = (b: Book) => ({ kind: "cast_member", id: b.binding.id })

describe("1 · no session: the most recently used line, at the head", () => {
	test("the line of the newest message; else the newest session; else main", async () => {
		declareSlots()
		const b = await book()
		const a = await b.branch("a")
		const c = await b.branch("c")
		const { mostRecentBranchOf } = await import("$lib/server/state/reading")
		const db = testDb as unknown as Db
		const h = await host({ lorebookId: b.lorebook.id })

		// Nothing played in the book at all: main.
		expect(await mostRecentBranchOf(db, b.lorebook.id)).toBeNull()
		expect(((await h.read("lorebook_state", {})) as any).branchId).toBeNull()

		const onA = await session(b, { branchId: a.id })
		const onC = await session(b, { branchId: c.id })
		// Sessions but no messages: the newest session's line.
		expect(await mostRecentBranchOf(db, b.lorebook.id)).toBe(c.id)

		await message(onC.id, b.verity.id)
		await message(onA.id, b.verity.id)
		// A was played last.
		expect(await mostRecentBranchOf(db, b.lorebook.id)).toBe(a.id)
		const state: any = await h.read("lorebook_state", {})
		expect(state.branchId).toBe(a.id)
		expect(state.moment).toBeNull()

		await message(onC.id, b.verity.id)
		expect(((await h.read("lorebook_state", {})) as any).branchId).toBe(c.id)
		const history: any = await h.read("stat_trail", { owner: cast(b), slotId: "hp", mode: "timeline" })
		expect(history.branchId).toBe(c.id)
	})
})

describe("2 · the fork cut", () => {
	test("lorebook_state: a branch sees main only up to its fork date", async () => {
		const { b, fork, y8 } = await forkedBook()
		const h = await host({ lorebookId: b.lorebook.id })
		const onMain: any = await h.read("lorebook_state", { branch: "main" })
		expect(hpOf(onMain, b)).toBe(30)
		const onFork: any = await h.read("lorebook_state", { branch: fork.id })
		expect(hpOf(onFork, b)).toBe(10)
		expect(onFork.forkedAt).toEqual({ year: 5, month: null, day: null })
		// The branch's own later row is its own.
		await durable(b.binding.id, 44, { historyEntryId: y8.id, branchId: fork.id })
		expect(hpOf(await h.read("lorebook_state", { branch: fork.id }), b)).toBe(44)
		expect(hpOf(await h.read("lorebook_state", { branch: "main" }), b)).toBe(30)
	})

	test("a fork of a fork publishes the effective cut: the earliest fork date along the chain", async () => {
		const { b, fork } = await forkedBook()
		const [child] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: b.lorebook.id,
				name: `child ${++n}`,
				forkedFromBranchId: fork.id,
				forkYear: 9
			})
			.returning()
		const h = await host({ lorebookId: b.lorebook.id })
		const onChild: any = await h.read("lorebook_state", { branch: child.id })
		// Main is read only to year 5 (the parent's fork), never to year 9.
		expect(hpOf(onChild, b)).toBe(10)
		expect(onChild.forkedAt).toEqual({ year: 5, month: null, day: null })
		const trail: any = await h.read("stat_trail", {
			owner: cast(b),
			slotId: "hp",
			mode: "timeline",
			branch: child.id
		})
		expect(trail.forkedAt).toEqual({ year: 5, month: null, day: null })
		// With the cut lifted, nothing is reported as cut.
		const uncut: any = await h.read("lorebook_state", { branch: child.id, forkCut: false })
		expect(uncut.forkedAt).toBeNull()
	})

	test("a fork made at now (no date) keeps following main", async () => {
		declareSlots()
		const b = await book()
		const now = await b.branch("now")
		const y7 = await b.dated({ year: 7 })
		await durable(b.binding.id, 30, { historyEntryId: y7.id })
		const h = await host({ lorebookId: b.lorebook.id })
		expect(hpOf(await h.read("lorebook_state", { branch: now.id }), b)).toBe(30)
	})

	test("stat_trail's timeline: main's points after the fork are not the branch's", async () => {
		const { b, fork, y8 } = await forkedBook()
		await durable(b.binding.id, 44, { historyEntryId: y8.id, branchId: fork.id })
		const h = await host({ lorebookId: b.lorebook.id })
		const q = { owner: cast(b), slotId: "hp", mode: "timeline" }
		expect(values(await h.read("stat_trail", { ...q, branch: "main" }))).toEqual([10, 30])
		expect(values(await h.read("stat_trail", { ...q, branch: fork.id }))).toEqual([10, 44])
	})

	test("a session on the branch resolves with the cut, and its story now is the branch's", async () => {
		const { b, fork } = await forkedBook()
		const s = await session(b, { branchId: fork.id })
		const db = testDb as unknown as Db
		const { valueOf, sessionLinks } = await import("$lib/server/state/resolve")
		expect(await valueOf(db, { sessionId: s.id, owner: { kind: "session_cast", id: b.verity.id }, slotId: HP })).toBe(10)
		// Its own year-8 entry is its present.
		expect((await sessionLinks(db, s.id)).storyDate).toEqual({ year: 8 })
		// A branch with no entry of its own: main's year-7 entry is past the
		// fork, so its present is main's year 3.
		const bare = await b.branch("bare", { year: 5 })
		const onBare = await session(b, { branchId: bare.id })
		expect((await sessionLinks(db, onBare.id)).storyDate).toEqual({ year: 3 })
		const onMain = await session(b)
		expect(await valueOf(db, { sessionId: onMain.id, owner: { kind: "session_cast", id: b.verity.id }, slotId: HP })).toBe(30)
		expect((await sessionLinks(db, onMain.id)).storyDate).toEqual({ year: 7 })
		// The pipeline read of the session's own book stands where the session does.
		const h = await host({ sessionId: s.id })
		const state: any = await h.read("lorebook_state", {})
		expect(state.branchId).toBe(fork.id)
		expect(hpOf(state, b)).toBe(10)
	})
})

describe("3 · the custom reading", () => {
	test("forkCut: false reads main's whole line from a branch", async () => {
		const { b, fork } = await forkedBook()
		const h = await host({ lorebookId: b.lorebook.id })
		expect(hpOf(await h.read("lorebook_state", { branch: fork.id, forkCut: false }), b)).toBe(30)
		expect(
			values(
				await h.read("stat_trail", {
					owner: cast(b),
					slotId: "hp",
					mode: "timeline",
					branch: fork.id,
					forkCut: false
				})
			)
		).toEqual([10, 30])
	})

	test("at: a story date reads as of then; 'head' is the present", async () => {
		const { b } = await forkedBook()
		const h = await host({ lorebookId: b.lorebook.id })
		const past: any = await h.read("lorebook_state", { branch: "main", at: { year: 4 } })
		expect(hpOf(past, b)).toBe(10)
		expect(past.moment).toEqual({ year: 4, month: null, day: null })
		expect(hpOf(await h.read("lorebook_state", { branch: "main", at: "head" }), b)).toBe(30)
		expect(
			values(await h.read("stat_trail", { owner: cast(b), slotId: "hp", mode: "timeline", branch: "main", at: { year: 4 } }))
		).toEqual([10])
	})

	test("branch: 'main' from a session on a branch; 'mostRecent'; 'session'", async () => {
		const { b, fork } = await forkedBook()
		const s = await session(b, { branchId: fork.id, moment: { year: 4 } })
		const h = await host({ sessionId: s.id })
		// The session's own reading by default: its line, its moment.
		const own: any = await h.read("lorebook_state", {})
		expect(own.branchId).toBe(fork.id)
		expect(own.moment).toEqual({ year: 4, month: null, day: null })
		// Main's full line, from inside a session on a branch.
		const main: any = await h.read("lorebook_state", { branch: "main" })
		expect(main.branchId).toBeNull()
		expect(main.moment).toBeNull()
		expect(hpOf(main, b)).toBe(30)
		expect(((await h.read("lorebook_state", { branch: "mostRecent" })) as any).branchId).toBe(fork.id)
		expect(((await h.read("lorebook_state", { branch: "session" })) as any).moment).toEqual({
			year: 4,
			month: null,
			day: null
		})
	})

	test("a malformed override is refused with a sentence", async () => {
		const { b } = await forkedBook()
		const { HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const h = await host({ lorebookId: b.lorebook.id })
		await expect(h.read("lorebook_state", { at: "yesterday" })).rejects.toBeInstanceOf(HostScopeError)
		await expect(h.read("lorebook_state", { branch: "sideways" })).rejects.toBeInstanceOf(HostScopeError)
		await expect(h.read("lorebook_state", { forkCut: "no" })).rejects.toBeInstanceOf(HostScopeError)
		// No session: no session line to name.
		await expect(h.read("lorebook_state", { branch: "session" })).rejects.toBeInstanceOf(HostScopeError)
	})

	test("through the bindings, on the branch/at/forkCut ports", async () => {
		const { b, fork } = await forkedBook()
		const h = await host({ lorebookId: b.lorebook.id })
		const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
		const ctx = { read: (table: any, q: any) => h.read(table, q) } as any
		const state: any = await stateBindings()["core:query/lorebook-state@1"]!(
			{ branch: fork.id, forkCut: false } as any,
			ctx
		)
		expect(hpOf(state.value.state, b)).toBe(30)
		const history: any = await stateBindings()["core:query/stat-trail@1"]!(
			{ owner: cast(b), branch: "main", at: { year: 4 }, params: { slotId: "hp", mode: "timeline" } } as any,
			ctx
		)
		expect(values(history.value.trail)).toEqual([10])
	})
})

describe("4 · a foreign branch is refused", () => {
	test("by both queries, and by the session's save", async () => {
		const { b } = await forkedBook()
		const theirs = await book()
		const theirBranch = await theirs.branch("theirs", { year: 1 })
		const { HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const h = await host({ lorebookId: b.lorebook.id })
		await expect(h.read("lorebook_state", { branch: theirBranch.id })).rejects.toBeInstanceOf(HostScopeError)
		await expect(
			h.read("stat_trail", { owner: cast(b), slotId: "hp", branch: theirBranch.id })
		).rejects.toBeInstanceOf(HostScopeError)

		const s = await session(b)
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		await expect(
			sessionsUpdateHandler.handler(
				fakeSocket(b.user.id),
				{ session: { id: s.id, lorebookBranchId: theirBranch.id } } as any,
				noEmit
			)
		).rejects.toThrow(/not a branch of this session's lorebook/)
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
		expect(row.lorebookBranchId).toBeNull()
	})
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
	}) as any
const noEmit = () => {}

describe("5 · the session's pointer", () => {
	test("a new session starts at the most recently used line, following its present (no clock of its own)", async () => {
		const { b, fork } = await forkedBook()
		const played = await session(b, { branchId: fork.id })
		await message(played.id, b.verity.id)
		const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(b.user.id),
			{ session: { name: "Next night", lorebookId: b.lorebook.id }, characterIds: [b.verity.id] } as any,
			noEmit
		)
		const [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, created.session.id))
		expect(row.lorebookBranchId).toBe(fork.id)
		expect(row.storyClockYear).toBeNull()
	})

	test("persisted by the settings save, honoured by resolution and the story's now", async () => {
		const { b, fork } = await forkedBook()
		const s = await session(b)
		const db = testDb as unknown as Db
		const { valueOf, sessionLinks } = await import("$lib/server/state/resolve")
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const hp = () => valueOf(db, { sessionId: s.id, owner: { kind: "session_cast", id: b.verity.id }, slotId: HP })
		expect(await hp()).toBe(30)

		// Point at main, year 4.
		await sessionsUpdateHandler.handler(
			fakeSocket(b.user.id),
			{ session: { id: s.id, lorebookBranchId: null, storyClockYear: 4, storyClockMonth: null } } as any,
			noEmit
		)
		let [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
		expect([row.lorebookBranchId, row.storyClockYear]).toEqual([null, 4])
		expect(await hp()).toBe(10)
		expect((await sessionLinks(db, s.id)).storyDate).toEqual({ year: 4 })
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const ctxRead: any = await createHost(db, { sessionId: s.id }).read!(
			"session_cast",
			{ sessionId: s.id },
			node
		)
		expect(ctxRead.storyTime.now).toMatchObject({ year: 4, from: "session" })

		// Onto the branch, at the head.
		await sessionsUpdateHandler.handler(
			fakeSocket(b.user.id),
			{ session: { id: s.id, lorebookBranchId: fork.id, storyClockYear: null } } as any,
			noEmit
		)
		;[row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
		expect([row.lorebookBranchId, row.storyClockYear]).toEqual([fork.id, null])
		expect(await hp()).toBe(10)
		expect((await sessionLinks(db, s.id)).storyDate).toEqual({ year: 8 })

		// A save that leaves both out leaves both alone.
		await sessionsUpdateHandler.handler(
			fakeSocket(b.user.id),
			{ session: { id: s.id, name: "Renamed" } } as any,
			noEmit
		)
		;[row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, s.id))
		expect(row.lorebookBranchId).toBe(fork.id)
	})
})
