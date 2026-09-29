/**
 * 🚧 Reading stats from the LOREBOOK, and over time (2026-09-27).
 *
 *  1. `lorebook_state` answers the book's world, cast and place values with no
 *     session, honours the owner and slot filters, and reads only what the
 *     book's vocabulary tracks (an undeclared or mechanism-kept slot is out).
 *  2. `stat_trail` by message: a swiped reply's change is not a point, and a
 *     row on another line of the book (or in a branched session) is not ours.
 *  3. The timeline orders across sessions by STORY DATE under the shared
 *     comparator — including the day-of-year books the packed value confuses.
 *  4. `both` is the timeline, then the session; the limits cut it.
 *  5. A foreign lorebook — or an owner of one — is refused, not read as empty.
 *  6. (Step 0) `storyDateOf` orders by the shared comparator.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { compareDates } from "$lib/shared/lorebooks/storyDate"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lorebook-stats-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"
const LAMPS = "test:slot/lamps@1"
const KEPT = "test:slot/kept@1"
const GHOST = "test:slot/ghost@1"
const GENRE = "test:genre/lorebook-stats"

function declareSlots() {
	_clearAttributeSlots()
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "How much punishment they can still take.",
		appliesTo: ["cast"],
		config: { min: 0, max: 100 },
		default: 20
	})
	const weather = defineAttributeSlot(WEATHER, {
		type: "enum",
		descriptor: "What the sky is doing.",
		appliesTo: ["world"],
		config: { of: ["clear", "storm"] }
	})
	const lamps = defineAttributeSlot(LAMPS, {
		type: "integer",
		descriptor: "How many lamps are lit here.",
		appliesTo: ["location"]
	})
	// A slot a mechanism keeps: never a world attribute, so never read.
	defineAttributeSlot(KEPT, {
		type: "text",
		descriptor: "Internal bookkeeping.",
		appliesTo: ["cast"],
		pickable: false
	})
	genre(GENRE, {
		name: { en: "Lorebook stats" },
		family: "test",
		slots: [hp, weather, lamps],
		customAttributes: "allow",
		events: {}
	})
}

let n = 0
const node = { key: "read", definitionId: "core:query/lorebook-state@1" } as any

async function book() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lorebook-stats-${suffix}`)
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
	const [harbor] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: 0,
			title: "Harbor",
			content: "Salt and rope."
		})
		.returning()
	const dated = async (fields: Record<string, unknown>, position: number) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					position,
					title: null,
					content: "…",
					fields
				})
				.returning()
		)[0]
	return { user, verity, lorebook, binding, harbor, dated }
}

type Book = Awaited<ReturnType<typeof book>>

async function session(b: Book, opts: { branchId?: number | null } = {}) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: b.user.id,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			lorebookId: b.lorebook.id,
			lorebookBranchId: opts.branchId ?? null
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
	ownerKind: "lorebook" | "cast_member" | "location",
	ownerId: number,
	slotId: string,
	v: unknown,
	extra: Partial<typeof schema.attributeValues.$inferInsert> = {}
) =>
	(
		await testDb
			.insert(schema.attributeValues)
			.values({ ownerKind, ownerId, slotId, value: { v }, sessionId: null, updatedBy: "user", ...extra })
			.returning()
	)[0]

const played = async (
	sessionId: number,
	ownerKind: "session" | "session_cast" | "session_location",
	ownerId: number,
	slotId: string,
	v: unknown,
	messageId: number,
	extra: Partial<typeof schema.attributeValues.$inferInsert> = {}
) =>
	await testDb.insert(schema.attributeValues).values({
		ownerKind,
		ownerId,
		slotId,
		value: { v },
		sessionId,
		validFromMessageId: messageId,
		updatedBy: "run:abc",
		...extra
	})

const host = async (scope: { sessionId?: number; lorebookId?: number }) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const services = createHost(testDb as unknown as Db, scope)
	return { read: (table: string, q: unknown, ref: any) => services.read!(table, q, ref) }
}

const values = (points: any[]) => points.map((p) => p.value)

describe("core:query/lorebook-state@1 — the book's own stats", () => {
	test("world, cast and place values with no session; untracked slots are out", async () => {
		declareSlots()
		const b = await book()
		const h1 = await b.dated({ year: 412, month: 3 }, 1)
		await durable("lorebook", b.lorebook.id, WEATHER, "storm", { historyEntryId: h1.id, sourceSessionId: 999 })
		await durable("cast_member", b.binding.id, HP, 14, { historyEntryId: h1.id })
		await durable("location", b.harbor.id, LAMPS, 3)
		await durable("cast_member", b.binding.id, KEPT, "secret")
		await durable("cast_member", b.binding.id, GHOST, "boo")

		const h = await host({ lorebookId: b.lorebook.id })
		const state: any = await h.read("lorebook_state", {}, node)
		expect(state.lorebookId).toBe(b.lorebook.id)
		expect(state.branchId).toBeNull()
		expect(state.world).toEqual({ weather: "storm", core_weather: "storm" })
		const verity = state.cast.byId[String(b.binding.id)]
		expect(verity).toMatchObject({ id: b.binding.id, name: b.verity.name, hp: 14 })
		expect(state.cast[verity.key]).toBe(verity)
		expect(state.locations.byId[String(b.harbor.id)]).toMatchObject({ name: "Harbor", lamps: 3 })
		// Fails closed: a mechanism-kept slot and an undeclared one are not the book's.
		expect(verity).not.toHaveProperty("kept")
		expect(verity).not.toHaveProperty("test_kept")
		expect(verity).not.toHaveProperty("ghost")
		expect(state.slots.map((s: any) => s.id).sort()).toEqual([HP, LAMPS, WEATHER].sort())
	})

	test("honours the owner filter and the slot filter", async () => {
		declareSlots()
		const b = await book()
		await durable("lorebook", b.lorebook.id, WEATHER, "clear")
		await durable("cast_member", b.binding.id, HP, 11)
		await durable("location", b.harbor.id, LAMPS, 2)
		const h = await host({ lorebookId: b.lorebook.id })

		const one: any = await h.read(
			"lorebook_state",
			{ owner: { kind: "cast_member", id: b.binding.id } },
			node
		)
		expect(one.world).toEqual({})
		expect(Object.keys(one.cast.byId)).toEqual([String(b.binding.id)])
		expect(one.locations.byId).toEqual({})

		const place: any = await h.read("lorebook_state", { owner: { kind: "location", id: b.harbor.id } }, node)
		expect(place.locations.byId[String(b.harbor.id)].lamps).toBe(2)
		expect(place.cast.byId).toEqual({})

		const slots: any = await h.read("lorebook_state", { slotIds: ["hp"] }, node)
		expect(slots.slots.map((s: any) => s.id)).toEqual([HP])
		expect(slots.world).toEqual({})
		expect(slots.cast.byId[String(b.binding.id)].hp).toBe(11)
		expect(slots.locations.byId[String(b.harbor.id)]).not.toHaveProperty("lamps")
	})

	test("through the binding: the scope session's own lorebook, no id needed", async () => {
		declareSlots()
		const b = await book()
		await durable("cast_member", b.binding.id, HP, 7)
		const s = await session(b)
		const h = await host({ sessionId: s.id })
		const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
		const out: any = await stateBindings()["core:query/lorebook-state@1"]!(
			{ scope: { sessionId: s.id } } as any,
			{ read: (table: any, q: any) => h.read(table, q, node) } as any
		)
		expect(out.value.main).toEqual(out.value.state)
		expect(out.value.state.cast.byId[String(b.binding.id)].hp).toBe(7)
	})
})

describe("core:query/stat-trail@1 — one stat over time", () => {
	test("by message: swiped rows are out, and it stays on its own line", async () => {
		declareSlots()
		const b = await book()
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: `fork ${n}` })
			.returning()
		const s = await session(b)
		const m1 = await message(s.id, b.verity.id)
		const m2 = await message(s.id, b.verity.id)
		const m3 = await message(s.id, b.verity.id)
		await played(s.id, "session_cast", b.verity.id, HP, 18, m1)
		await played(s.id, "session_cast", b.verity.id, HP, 12, m2)
		// A row written on the fork: not main's.
		await played(s.id, "session_cast", b.verity.id, HP, 1, m2, { branchId: fork.id })
		await played(s.id, "session_cast", b.verity.id, HP, 7, m3)
		// The reply at m3 is swiped: the swipe path retracts what it wrote.
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(testDb as unknown as Db, m3)
		// A branched session holds its own copies; they are not this session's.
		const other = await session(b)
		const om = await message(other.id, b.verity.id)
		await played(other.id, "session_cast", b.verity.id, HP, 99, om)

		const h = await host({ sessionId: s.id })
		const history: any = await h.read(
			"stat_trail",
			{ owner: { kind: "cast_member", id: b.binding.id }, slotId: "hp", mode: "messages" },
			node
		)
		expect(history.tracked).toBe(true)
		expect(history.slotId).toBe(HP)
		expect(values(history.points)).toEqual([18, 12])
		expect(history.points[0]).toMatchObject({
			layer: "session",
			anchor: { messageId: m1 },
			provenance: { updatedBy: "run:abc", sessionId: s.id, messageId: m1 }
		})

		// A session played ON the fork reads the fork's row as well.
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: fork.id })
			.where(eq(schema.sessions.id, s.id))
		const onFork: any = await h.read(
			"stat_trail",
			{ owner: { kind: "cast_member", id: b.binding.id }, slotId: "hp", mode: "messages" },
			node
		)
		expect(values(onFork.points)).toEqual([18, 12, 1])
	})

	test("the timeline orders across sessions by story date, not by write order", async () => {
		declareSlots()
		const b = await book()
		// A book that numbers days of the year in the month place: the packed
		// placement value calls these equal; the comparator does not.
		const late = await b.dated({ year: 5, month: 50 }, 1)
		const early = await b.dated({ year: 3, month: 250 }, 2)
		const mid = await b.dated({ year: 4 }, 3)
		const a = await session(b)
		const c = await session(b)
		await durable("cast_member", b.binding.id, HP, 9, { historyEntryId: late.id, sourceSessionId: a.id, updatedBy: `session:${a.id}` })
		await durable("cast_member", b.binding.id, HP, 14, { historyEntryId: early.id, sourceSessionId: c.id, updatedBy: `session:${c.id}` })
		await durable("cast_member", b.binding.id, HP, 11, { historyEntryId: mid.id, sourceSessionId: a.id })
		await durable("cast_member", b.binding.id, HP, 20) // an author's, undated

		const h = await host({ lorebookId: b.lorebook.id })
		const history: any = await h.read(
			"stat_trail",
			{ owner: { kind: "cast_member", id: b.binding.id }, slotId: HP, mode: "timeline" },
			node
		)
		expect(values(history.points)).toEqual([20, 14, 11, 9])
		expect(history.points[1]).toMatchObject({
			layer: "timeline",
			anchor: { historyEntryId: early.id, date: { year: 3, month: 250, day: null } },
			provenance: { updatedBy: `session:${c.id}`, sessionId: c.id }
		})
		expect(history.points[0].anchor).toEqual({ historyEntryId: null, date: null })
	})

	test("both: the timeline, then this session; this session's own recording is not doubled", async () => {
		declareSlots()
		const b = await book()
		const h1 = await b.dated({ year: 412, month: 3 }, 1)
		const h2 = await b.dated({ year: 412, month: 5 }, 2)
		const earlier = await session(b)
		const s = await session(b)
		await durable("lorebook", b.lorebook.id, WEATHER, "clear", { historyEntryId: h2.id, sourceSessionId: earlier.id })
		await durable("lorebook", b.lorebook.id, WEATHER, "storm", { historyEntryId: h1.id, sourceSessionId: earlier.id })
		const m1 = await message(s.id, b.verity.id)
		const m2 = await message(s.id, b.verity.id)
		await played(s.id, "session", s.id, WEATHER, "storm", m1)
		await played(s.id, "session", s.id, WEATHER, "clear", m2)
		// What write-back copied from THIS session: already a point above.
		await durable("lorebook", b.lorebook.id, WEATHER, "clear", { historyEntryId: h2.id, sourceSessionId: s.id })

		const h = await host({ sessionId: s.id })
		const merged: any = await h.read("stat_trail", { owner: "world", slotId: "weather" }, node)
		expect(merged.mode).toBe("both")
		expect(merged.points.map((p: any) => [p.layer, p.value])).toEqual([
			["timeline", "storm"],
			["timeline", "clear"],
			["session", "storm"],
			["session", "clear"]
		])

		// The limits.
		const last: any = await h.read("stat_trail", { owner: "world", slotId: "weather", last: 3 }, node)
		expect(last.points.map((p: any) => [p.layer, p.value])).toEqual([
			["timeline", "clear"],
			["session", "storm"],
			["session", "clear"]
		])
		const sinceMessage: any = await h.read(
			"stat_trail",
			{ owner: "world", slotId: "weather", sinceMessageId: m1 },
			node
		)
		expect(sinceMessage.points.map((p: any) => [p.layer, p.value])).toEqual([["session", "clear"]])
		const sinceDate: any = await h.read(
			"stat_trail",
			{ owner: "world", slotId: "weather", sinceDate: { year: 412, month: 4 } },
			node
		)
		expect(sinceDate.points.map((p: any) => [p.layer, p.value])).toEqual([
			["timeline", "clear"],
			["session", "storm"],
			["session", "clear"]
		])
	})

	test("through the binding, with since and last on its ports and params", async () => {
		declareSlots()
		const b = await book()
		const s = await session(b)
		const m1 = await message(s.id, b.verity.id)
		const m2 = await message(s.id, b.verity.id)
		await played(s.id, "session_cast", b.verity.id, HP, 15, m1)
		await played(s.id, "session_cast", b.verity.id, HP, 10, m2)
		const h = await host({ sessionId: s.id })
		const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
		const out: any = await stateBindings()["core:query/stat-trail@1"]!(
			{
				scope: { sessionId: s.id },
				owner: { kind: "session_cast", id: b.verity.id },
				since: { messageId: m1 },
				params: { slotId: "hp", mode: "messages", last: 5 }
			} as any,
			{ read: (table: any, q: any) => h.read(table, q, node) } as any
		)
		expect(values(out.value.points)).toEqual([10])
		expect(out.value.trail.owner).toEqual({ kind: "cast_member", id: b.binding.id })
	})

	test("an untracked slot has no history (fails closed)", async () => {
		declareSlots()
		const b = await book()
		await durable("cast_member", b.binding.id, KEPT, "secret")
		const h = await host({ lorebookId: b.lorebook.id })
		const history: any = await h.read(
			"stat_trail",
			{ owner: { kind: "cast_member", id: b.binding.id }, slotId: KEPT, mode: "timeline" },
			node
		)
		expect(history.tracked).toBe(false)
		expect(history.points).toEqual([])
	})
})

describe("scoping — a foreign lorebook is refused, not read as empty", () => {
	test("naming another book, or an owner of one, is a HostScopeError", async () => {
		declareSlots()
		const mine = await book()
		const theirs = await book()
		const s = await session(mine)
		const { HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const h = await host({ sessionId: s.id })

		await expect(h.read("lorebook_state", { lorebookId: theirs.lorebook.id }, node)).rejects.toBeInstanceOf(
			HostScopeError
		)
		await expect(
			h.read("stat_trail", { lorebookId: theirs.lorebook.id, owner: "world", slotId: "weather" }, node)
		).rejects.toBeInstanceOf(HostScopeError)
		// Their cast member, asked of my book.
		await expect(
			h.read("lorebook_state", { owner: { kind: "cast_member", id: theirs.binding.id } }, node)
		).rejects.toBeInstanceOf(HostScopeError)
		// Another session entirely.
		const foreign = await session(theirs)
		await expect(h.read("lorebook_state", { sessionId: foreign.id }, node)).rejects.toBeInstanceOf(HostScopeError)
		// No session and no grant: nothing to name.
		const bare = await host({})
		await expect(bare.read("lorebook_state", { lorebookId: mine.lorebook.id }, node)).rejects.toBeInstanceOf(
			HostScopeError
		)
		// My own book, named: fine.
		const ok: any = await h.read("lorebook_state", { lorebookId: mine.lorebook.id }, node)
		expect(ok.lorebookId).toBe(mine.lorebook.id)
	})
})

describe("step 0 — storyDateOf uses THE comparator", () => {
	test("the world's present is the latest date under compareDates", async () => {
		declareSlots()
		const b = await book()
		const dates = [
			{ year: 5, month: 50 },
			{ year: 3, month: 250 },
			{ year: 5 },
			{ year: 5, month: 50, day: 2 }
		]
		for (const [i, d] of dates.entries()) await b.dated(d, i + 1)
		const { storyDateOf } = await import("$lib/server/state/resolve")
		const present = await storyDateOf(testDb as unknown as Db, b.lorebook.id)
		const expected = [...dates].sort((x, y) => compareDates(y, x))[0]
		expect(present).toMatchObject(expected)
		expect(present).toMatchObject({ year: 5, month: 50, day: 2 })
	})
})
