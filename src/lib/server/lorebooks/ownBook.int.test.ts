/**
 * 🚧 A session's own book (PLAN-rulesets §26; pr-6 B §B-3).
 *
 * Claims: `ownBookFor` is the safety net for a session a path skipped, and the
 * own book is invisible to `lorebooks:list`; deleted with its session;
 * branched with it; read in the union, marked `sessionOnly`; the routing rule
 * (no book → own book; Full → the book; Review/Off → the own book, anchored);
 * "Share as a lorebook" makes it real, attached, and gives the session a fresh
 * one; `insertOwnBook` and `ensureOwnBooks` make it Gregorian with its clock
 * unset; Session notes list it; and every lorebook that existed before
 * rulesets reads Story.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { SHARE_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ownBook-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const WEATHER = "core:slot/weather@1"
const GENRE = "test:genre/own-book"
const STORY = "core:ruleset/freeform@1"

function declareSlots() {
	_clearAttributeSlots()
	const declared = [
		defineAttributeSlot(WEATHER, {
			type: "enum",
			descriptor: "What the sky is doing.",
			appliesTo: ["world"],
			config: { of: ["clear", "storm"] }
		})
	]
	genreKeeping(GENRE, { name: { en: "Own book" }, family: "test", slots: declared, events: {} })
}

let n = 0

async function world(opts: { lorebook?: boolean; mode?: "full" | "review" | "off" } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `ownBook-${suffix}`)
	if (opts.mode)
		await testDb.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: opts.mode })
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE })
		.returning()
	let lorebook: typeof schema.lorebooks.$inferSelect | undefined
	if (opts.lorebook) {
		;[lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `World ${suffix}` })
			.returning()
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: lorebook!.id })
			.where(eq(schema.sessions.id, session!.id))
	}
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		return legacy!
	}
	return { user, session: session!, lorebook, message }
}

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function place(lorebookId: number, title: string, sourceMessageId: number | null = null) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			sourceMessageId
		})
		.returning()
	return row!
}

describe("the session's own notes", () => {
	test("made lazily, once; invisible in lorebooks:list", async () => {
		const w = await world()
		const { ownBookOf, ownBookFor } = await import("./ownBook")
		expect(await ownBookOf(testDb as any, w.session.id)).toBeNull()
		const made = await ownBookFor(testDb as any, w.session.id)
		expect(made.sessionId).toBe(w.session.id)
		expect(made.name).toBe(w.session.name)
		expect(made.primaryRuleset).toBe(STORY)
		expect(made.overlayOf).toBeNull()
		// Twice is the same row.
		expect((await ownBookFor(testDb as any, w.session.id)).id).toBe(made.id)
		// A19: the session changes ruleset; the notes follow it on the next resync.
		await testDb
			.update(schema.sessions)
			.set({ primaryRuleset: "core:ruleset/vis-itineris@1", rulesetVersion: "2" })
			.where(eq(schema.sessions.id, w.session.id))
		const moved = await ownBookFor(testDb as any, w.session.id)
		expect(moved).toMatchObject({ id: made.id, primaryRuleset: "core:ruleset/vis-itineris@1", rulesetVersion: "2" })
		await testDb
			.update(schema.sessions)
			.set({ primaryRuleset: STORY, rulesetVersion: null })
			.where(eq(schema.sessions.id, w.session.id))
		expect((await ownBookFor(testDb as any, w.session.id)).primaryRuleset).toBe(STORY)

		const [real] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "A real one" })
			.returning()
		const { lorebooksListHandler } = await import("$lib/server/sockets/lorebooks")
		const res: any = await lorebooksListHandler.handler(fakeSocket(w.user.id), {} as any, noopEmit)
		const ids = res.lorebookList.map((b: any) => b.id)
		expect(ids).toContain(real!.id)
		expect(ids).not.toContain(made.id)
	})

	test("readable by the session's members and nobody else; never read into another session", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `ownBook-guest-${n}`)
		const stranger = await createTestUser(testDb, `ownBook-stranger-${n}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: guest.id })
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const { lorebookAccessFor, findOwnedBook } = await import("$lib/server/utils/ownedBook")
		expect(await lorebookAccessFor(notes.id, w.user.id, { db: testDb as any })).toBe("owner")
		expect(await lorebookAccessFor(notes.id, guest.id, { db: testDb as any })).toBe("owner")
		expect(await lorebookAccessFor(notes.id, stranger.id, { db: testDb as any, isAdmin: true })).toBeNull()
		expect(await findOwnedBook(testDb as any, guest.id, notes.id)).toBeTruthy()
		expect(await findOwnedBook(testDb as any, stranger.id, notes.id)).toBeUndefined()
	})

	test("deleted with its session", async () => {
		const w = await world()
		const { ownBookFor, purgeOwnBookOf } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		await place(notes.id, "The cellar")
		await purgeOwnBookOf(testDb as any, w.session.id)
		await testDb.delete(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(
			await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, notes.id))
		).toHaveLength(0)
		// The FK alone cascades too.
		const v = await world()
		const other = await ownBookFor(testDb as any, v.session.id)
		await testDb.delete(schema.sessions).where(eq(schema.sessions.id, v.session.id))
		expect(
			await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, other.id))
		).toHaveLength(0)
	})

	test("a session branch branches its notes as of the fork", async () => {
		const w = await world()
		const first = await w.message()
		const fork = await w.message()
		const after = await w.message()
		const { ownBookFor, ownBookOf } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		await place(notes.id, "Before anything")
		await place(notes.id, "The hall", first.id)
		await place(notes.id, "The stair", fork.id)
		await place(notes.id, "The tower", after.id)

		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(testDb as any, { sessionId: w.session.id, fromMessageId: fork.id })
		const copy = await ownBookOf(testDb as any, branch.id)
		expect(copy).toBeTruthy()
		expect(copy!.id).not.toBe(notes.id)
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, copy!.id))
		expect(rows.map((r) => r.title).sort()).toEqual(["Before anything", "The hall", "The stair"])
		const branchIds = new Set(
			(
				await testDb
					.select({ id: schema.sessionMessages.id })
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.sessionId, branch.id))
			).map((m) => m.id)
		)
		for (const r of rows.filter((r) => r.sourceMessageId != null))
			expect(branchIds.has(r.sourceMessageId!)).toBe(true)
		// The parent keeps its own, tower included.
		expect(
			await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, notes.id))
		).toHaveLength(4)
	})

	test("the union read: the book's places, then the notes' marked sessionOnly", async () => {
		const w = await world({ lorebook: true })
		await place(w.lorebook!.id, "The square")
		const { ownBookFor, lorebooksReadBy, sessionEntriesAsRead } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		expect(notes.overlayOf).toBe(w.lorebook!.id)
		await place(notes.id, "The secret door")

		const books = await lorebooksReadBy(testDb as any, w.session.id)
		expect(books.ids).toEqual([w.lorebook!.id, notes.id])
		const read = await sessionEntriesAsRead(testDb as any, w.session.id, "session", [LOCATION_TYPE_ID])
		expect(read.map((e) => [e.name, e.sessionOnly ?? false])).toEqual([
			["The square", false],
			["The secret door", true]
		])
		const { sessionPlaceNamed } = await import("$lib/server/state/entriesOnReading")
		const named = await sessionPlaceNamed(testDb as any, w.session.id, "the secret door")
		expect(named.kind).toBe("one")
	})
})

describe("where a session's world write lands", () => {
	test("no book → the notes; Full → the book; Review → the notes, anchored; Off → the notes", async () => {
		const { loreWriteTargetFor } = await import("./ownBook")
		const none = await world()
		const t0 = await loreWriteTargetFor(testDb as any, none.session.id)
		expect(t0.route).toBe("own-book")

		const full = await world({ lorebook: true, mode: "full" })
		const t1 = await loreWriteTargetFor(testDb as any, full.session.id)
		expect(t1).toMatchObject({ route: "book", lorebookId: full.lorebook!.id, sourceMessageId: null })

		const review = await world({ lorebook: true, mode: "review" })
		const said = await review.message()
		const t2 = await loreWriteTargetFor(testDb as any, review.session.id)
		expect(t2.route).toBe("own-book")
		expect(t2.lorebookId).not.toBe(review.lorebook!.id)
		expect(t2.sourceMessageId).toBe(said.id)

		const off = await world({ lorebook: true, mode: "off" })
		expect((await loreWriteTargetFor(testDb as any, off.session.id)).route).toBe("own-book")
	})

	test("recordToTimeline files the world's values where the route says", async () => {
		declareSlots()
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const { ownBookOf } = await import("./ownBook")
		const storm = async (sessionId: number) =>
			await testDb.insert(schema.attributeValues).values({
				ownerKind: "session",
				ownerId: sessionId,
				slotId: WEATHER,
				value: { v: "storm" },
				sessionId,
				validFromMessageId: null,
				updatedBy: "user"
			})
		const worldRows = async (lorebookId: number) =>
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "lorebook"),
						eq(schema.attributeValues.ownerId, lorebookId),
						eq(schema.attributeValues.slotId, WEATHER)
					)
				)

		const none = await world()
		await storm(none.session.id)
		const r0 = await recordToTimeline(testDb as any, none.session.id, { reason: "mark" })
		expect(r0.route).toBe("own-book")
		const notes0 = await ownBookOf(testDb as any, none.session.id)
		expect(await worldRows(notes0!.id)).toHaveLength(1)

		const full = await world({ lorebook: true, mode: "full" })
		await storm(full.session.id)
		const r1 = await recordToTimeline(testDb as any, full.session.id, { reason: "mark" })
		expect(r1.route).toBe("book")
		expect(await worldRows(full.lorebook!.id)).toHaveLength(1)
		expect(await ownBookOf(testDb as any, full.session.id)).toBeNull()

		const review = await world({ lorebook: true, mode: "review" })
		await storm(review.session.id)
		const said = await review.message()
		const r2 = await recordToTimeline(testDb as any, review.session.id, { reason: "mark" })
		expect(r2.route).toBe("own-book")
		expect(r2.proposed).toBe(0)
		expect(await worldRows(review.lorebook!.id)).toHaveLength(0)
		const notes2 = await ownBookOf(testDb as any, review.session.id)
		expect(notes2!.overlayOf).toBe(review.lorebook!.id)
		const rows2 = await worldRows(notes2!.id)
		expect(rows2).toHaveLength(1)
		expect(rows2[0]!.sourceMessageId).toBe(said.id)

		const off = await world({ lorebook: true, mode: "off" })
		await storm(off.session.id)
		const r3 = await recordToTimeline(testDb as any, off.session.id, { reason: "mark" })
		expect(r3.route).toBe("own-book")
		expect(await worldRows(off.lorebook!.id)).toHaveLength(0)
	})
})

describe("a room in the session's own notes reads by its name", () => {
	test("nameLoreRefs names a reference from the places it is handed when no reading names it", async () => {
		const { nameLoreRefs } = await import("$lib/server/state/resolve")
		const bag: Record<string, unknown> = { location: { entryId: 41 }, other: { entryId: 42 } }
		await nameLoreRefs(testDb as any, [bag], null, "session", [{ entryId: 41, name: "The Sunken Gate", sessionOnly: true }])
		expect(bag.location).toEqual({ entryId: 41, name: "The Sunken Gate" })
		// A reference nothing names stays bare.
		expect(bag.other).toEqual({ entryId: 42 })
	})
})

describe("Share as a lorebook", () => {
	test("the notes become a real lorebook the session reads", async () => {
		const w = await world()
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		await place(notes.id, "The cellar")
		const { sessionsShareAsLorebookHandler } = await import("$lib/server/sockets/sessions")
		const emitted: { event: string; data: any }[] = []
		const res: any = await sessionsShareAsLorebookHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, name: "Kept world" },
			(event: string, data: any) => emitted.push({ event, data })
		)
		expect(res.lorebookId).toBe(notes.id)
		// One toast, through the central `success` path.
		expect(emitted.filter((e) => e.event === "success").map((e) => e.data)).toEqual([
			{ title: "Shared as a lorebook: Kept world" }
		])
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, notes.id))
		expect(book).toMatchObject({ name: "Kept world", sessionId: null, overlayOf: null })
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session!.lorebookId).toBe(notes.id)
		const { lorebooksListHandler } = await import("$lib/server/sockets/lorebooks")
		const list: any = await lorebooksListHandler.handler(fakeSocket(w.user.id), {} as any, noopEmit)
		expect(list.lorebookList.map((b: any) => b.id)).toContain(notes.id)
		// 🚧 …and the book says the session reads it, with no session open
		// (DC walk 6: "Not read by a session").
		expect(list.lorebookList.find((b: any) => b.id === notes.id).readBy).toEqual([
			{ id: w.session.id, name: w.session.name ?? null }
		])
		// The list goes out again, so a book view open in the rail hears it.
		expect(emitted.some((e) => e.event === "lorebooks:list")).toBe(true)
		expect(emitted.some((e) => e.event === "lorebooks:sessionNotes")).toBe(true)
	})

	test("refused to a guest, and for a session that already reads a lorebook", async () => {
		const w = await world({ lorebook: true })
		const { shareAsLorebook } = await import("./ownBook")
		await expect(
			shareAsLorebook(testDb as any, { sessionId: w.session.id, userId: w.user.id })
		).rejects.toThrow(SHARE_REFUSALS.attached)
		const v = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `ownBook-g2-${n}`)
		await expect(
			shareAsLorebook(testDb as any, { sessionId: v.session.id, userId: guest.id })
		).rejects.toThrow(SHARE_REFUSALS.notOwner)
	})
})

describe("rulesets on existing rows", () => {
	test("a lorebook and a session made with no ruleset read Story", async () => {
		const w = await world({ lorebook: true })
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, w.lorebook!.id))
		expect(book).toMatchObject({ primaryRuleset: STORY, rulesetVersion: null, kind: "book" })
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session).toMatchObject({
			primaryRuleset: STORY,
			rigour: "prose",
			onRevision: "overwrite"
		})
	})
})

describe("wave 3: the notes routed whole (PLAN-rulesets §26)", () => {
	const GENRE3 = "test:genre/own-book-places"
	const LAMP = "core:slot/lamp-test@1"

	async function way(lorebookId: number, from: number, to: number) {
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId,
			fromEntryId: from,
			toEntryId: to,
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to"
		} as any)
	}

	test("the places listing and the links read are the union: the notes' places, and the ways between them", async () => {
		const w = await world()
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const hall = await place(notes.id, "The hall")
		const stair = await place(notes.id, "The stair")
		await way(notes.id, hall.id, stair.id)

		const { readSessionPlaces } = await import("$lib/server/sockets/sessionPlaces")
		const read: any = await readSessionPlaces(w.session.id, w.user.id)
		expect(read.places.map((p: any) => [p.name, p.sessionOnly])).toEqual([
			["The hall", true],
			["The stair", true]
		])
		expect(read.ways).toHaveLength(1)
		expect(read.ways[0]).toMatchObject({ from: hall.id, to: stair.id, bothWays: true })

		const { readGraphEntryLinks, loreLinkRowsOf } = await import("$lib/server/utils/graphEntryLinks")
		const links = await readGraphEntryLinks(testDb as any, w.session.id)
		expect(links).toHaveLength(1)
		// "From here:" is said from these rows.
		expect(loreLinkRowsOf(stair.id, links!).map((l) => l.linkType)).toEqual(["leads south to"])

		const { sessionPlaceNamed } = await import("$lib/server/state/entriesOnReading")
		expect(await sessionPlaceNamed(testDb as any, w.session.id, "the stair")).toMatchObject({
			kind: "one",
			entryId: stair.id
		})
	})

	test("a notes row anchors to the turn's message, not merely the newest", async () => {
		const w = await world()
		const turn = await w.message()
		const later = await w.message()
		const { loreWriteTargetFor } = await import("./ownBook")
		expect(
			(await loreWriteTargetFor(testDb as any, w.session.id, { anchorMessageId: turn.id })).sourceMessageId
		).toBe(turn.id)
		// Another session's message is no anchor: the newest stands.
		const other = await world()
		const foreign = await other.message()
		expect(
			(await loreWriteTargetFor(testDb as any, w.session.id, { anchorMessageId: foreign.id }))
				.sourceMessageId
		).toBe(later.id)
	})

	test("a place of the notes keeps its values in the notes", async () => {
		_clearAttributeSlots()
		const slots = [
			defineAttributeSlot(LAMP, {
				type: "enum",
				descriptor: "Whether the lamp is lit.",
				appliesTo: ["location"],
				config: { of: ["lit", "dark"] }
			})
		]
		genreKeeping(GENRE3, { name: { en: "Own book places" }, family: "test", slots, events: {} })
		const w = await world()
		await testDb.update(schema.sessions).set({ genreId: GENRE3 }).where(eq(schema.sessions.id, w.session.id))
		const said = await w.message()
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const hall = await place(notes.id, "The hall")
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "session_location",
			ownerId: hall.id,
			slotId: LAMP,
			value: { v: "lit" },
			sessionId: w.session.id,
			validFromMessageId: null,
			updatedBy: "user"
		})
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(testDb as any, w.session.id, { reason: "mark" })
		expect(report.route).toBe("own-book")
		expect(report.owners).toContain(`location:${hall.id}`)
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "location"),
					eq(schema.attributeValues.ownerId, hall.id),
					eq(schema.attributeValues.slotId, LAMP)
				)
			)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ branchId: null, sessionId: null, sourceMessageId: said.id })
	})

	test("Review changes: an overlay item, applied to the lorebook with its provenance, leaves the overlay", async () => {
		const w = await world({ lorebook: true, mode: "review" })
		const said = await w.message()
		const { loreWriteTargetFor, overlayItemsOf, applyOverlayItems, ownBookOf, APPLY_OVERLAY_REFUSALS } =
			await import("./ownBook")
		const target = await loreWriteTargetFor(testDb as any, w.session.id)
		expect(target.route).toBe("own-book")
		const notes = await ownBookOf(testDb as any, w.session.id)
		expect(notes!.overlayOf).toBe(w.lorebook!.id)
		const door = await place(target.lorebookId, "The secret door", target.sourceMessageId)
		const nook = await place(target.lorebookId, "The nook", target.sourceMessageId)
		await way(target.lorebookId, door.id, nook.id)

		const items = await overlayItemsOf(testDb as any, w.session.id)
		expect(items.map((i) => [i.title, i.sourceMessageId])).toEqual([
			["The secret door", said.id],
			["The nook", said.id]
		])

		// A stranger may not apply.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `ownBook-apply-${n}`)
		await expect(
			applyOverlayItems(testDb as any, { sessionId: w.session.id, userId: stranger.id })
		).rejects.toThrow(APPLY_OVERLAY_REFUSALS.notOwner)

		// One item: it moves; the link waits for its other end.
		const one = await applyOverlayItems(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			entryIds: [door.id]
		})
		expect(one.applied).toEqual([door.id])
		const [moved] = await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, door.id))
		expect(moved!.lorebookId).toBe(w.lorebook!.id)
		expect(moved!.sourceMessageId).toBe(said.id)
		expect((moved!.extraJson as any).appliedFrom).toMatchObject({
			sessionId: w.session.id,
			messageId: said.id,
			ruleset: STORY
		})
		expect((await overlayItemsOf(testDb as any, w.session.id)).map((i) => i.entryId)).toEqual([nook.id])
		const links = () =>
			testDb.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.fromEntryId, door.id))
		expect((await links())[0]!.lorebookId).toBe(notes!.id)

		// The rest (all): the link comes along with its last end.
		const all = await applyOverlayItems(testDb as any, { sessionId: w.session.id, userId: w.user.id })
		expect(all.applied).toEqual([nook.id])
		expect(await overlayItemsOf(testDb as any, w.session.id)).toEqual([])
		expect((await links())[0]!.lorebookId).toBe(w.lorebook!.id)

		// Read as the session reads: in the book, no longer "this session only".
		const { sessionEntriesAsRead } = await import("./ownBook")
		const read = await sessionEntriesAsRead(testDb as any, w.session.id, "session", [LOCATION_TYPE_ID])
		expect(read.map((e) => [e.name, e.sessionOnly ?? false]).sort()).toEqual([
			["The nook", false],
			["The secret door", false]
		])
	})

	test("Share as a lorebook carries the ruleset; the marks go", async () => {
		const w = await world()
		const { ownBookFor, shareAsLorebook, sessionEntriesAsRead } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		await place(notes.id, "The cellar")
		expect(
			(await sessionEntriesAsRead(testDb as any, w.session.id, "session", [LOCATION_TYPE_ID]))[0]!.sessionOnly
		).toBe(true)
		await shareAsLorebook(testDb as any, { sessionId: w.session.id, userId: w.user.id })
		const [book] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, notes.id))
		expect(book).toMatchObject({ primaryRuleset: STORY, kind: "book", sessionId: null })
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session!.lorebookId).toBe(notes.id)
		const read = await sessionEntriesAsRead(testDb as any, w.session.id, "session", [LOCATION_TYPE_ID])
		expect(read.map((e) => [e.name, e.sessionOnly ?? false])).toEqual([["The cellar", false]])
	})
})

describe("every session owns a book (pr-6, B §B-3)", () => {
	test("insertOwnBook is born Gregorian with its clock unset", async () => {
		const w = await world()
		const { insertOwnBook, OWN_BOOK_CALENDAR } = await import("./ownBook")
		const made = await insertOwnBook(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			name: "  ",
			overlayOf: null,
			primaryRuleset: w.session.primaryRuleset,
			rulesetVersion: null
		})
		expect(made.kind).toBe("book")
		expect(made.name).toBe("Untitled session")
		expect(made.storyCalendar).toEqual(OWN_BOOK_CALENDAR)
		expect(made).toMatchObject({
			storyClockYear: null,
			storyClockMonth: null,
			storyClockDay: null,
			storyClockHour: null,
			storyClockMinute: null
		})
	}, 60_000)

	test("ensureOwnBooks gives older sessions one, sets overlays, and is idempotent", async () => {
		const { ensureOwnBooks, ownBookOf, ownBookFor } = await import("./ownBook")
		// Earlier tests leave sessions with no own book; start from a clean count.
		await ensureOwnBooks(testDb as any)
		const a = await world()
		const b = await world()
		const attached = await world({ lorebook: true })
		const kept = await world()
		const keptBook = await ownBookFor(testDb as any, kept.session.id)
		const customCalendar = { ...(keptBook.storyCalendar as any), yearLabel: "Era" }
		await testDb
			.update(schema.lorebooks)
			.set({ storyCalendar: customCalendar, storyClockYear: 7 })
			.where(eq(schema.lorebooks.id, keptBook.id))
		const entry = await place(keptBook.id, "The keep")
		const first = await ensureOwnBooks(testDb as any)
		expect(first.made).toBe(3)
		const own = await ownBookOf(testDb as any, attached.session.id)
		expect(own!.overlayOf).toBe(attached.lorebook!.id)
		expect((await ownBookOf(testDb as any, a.session.id))!.overlayOf).toBeNull()
		expect(await ownBookOf(testDb as any, b.session.id)).not.toBeNull()
		const [keptAfter] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, keptBook.id))
		expect(keptAfter!.storyCalendar).toEqual(customCalendar)
		expect(keptAfter!.storyClockYear).toBe(7)
		const entries = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, keptBook.id))
		expect(entries.map((e) => e.id)).toEqual([entry.id])
		expect(await ensureOwnBooks(testDb as any)).toEqual({ made: 0, overlaysSet: 0 })
	}, 60_000)

	test("shareAsLorebook promotes the own book and makes a fresh one", async () => {
		const w = await world()
		const { ownBookFor, ownBookOf, shareAsLorebook } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const done = await shareAsLorebook(testDb as any, { sessionId: w.session.id, userId: w.user.id })
		expect(done.lorebookId).toBe(notes.id)
		const [promoted] = await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, notes.id))
		expect(promoted!.sessionId).toBeNull()
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session!.lorebookId).toBe(notes.id)
		const fresh = await ownBookOf(testDb as any, w.session.id)
		expect(fresh!.id).toBe(done.ownBookId)
		expect(fresh!.id).not.toBe(notes.id)
		expect(fresh!.overlayOf).toBe(notes.id)
		const again = await world({ lorebook: true })
		await expect(
			shareAsLorebook(testDb as any, { sessionId: again.session.id, userId: again.user.id })
		).rejects.toThrow(SHARE_REFUSALS.attached)
		const stranger = await world()
		await expect(
			shareAsLorebook(testDb as any, { sessionId: stranger.session.id, userId: w.user.id })
		).rejects.toThrow(SHARE_REFUSALS.notOwner)
	}, 60_000)

	test("copyOwnBookToBranch gives a branch of a session with no own book a fresh one", async () => {
		const parent = await world()
		const child = await world()
		const { copyOwnBookToBranch, ownBookOf } = await import("./ownBook")
		expect(await ownBookOf(testDb as any, parent.session.id)).toBeNull()
		const out = await testDb.transaction(async (tx) =>
			copyOwnBookToBranch(tx as any, {
				sessionId: parent.session.id,
				created: {
					id: child.session.id,
					name: child.session.name,
					userId: child.user.id,
					lorebookId: null,
					primaryRuleset: child.session.primaryRuleset,
					rulesetVersion: null
				},
				forkMessageId: 0,
				remap: new Map()
			})
		)
		const made = await ownBookOf(testDb as any, child.session.id)
		expect(out.lorebookId).toBe(made!.id)
		expect(out.entryRemap.size).toBe(0)
	}, 60_000)

	test("lorebooks:get serves an own book to its owner; sessionNotes lists it, list does not", async () => {
		const w = await world({ lorebook: true })
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const lorebooks = await import("$lib/server/sockets/lorebooks")
		const got: any = await (lorebooks as any).lorebooksGetHandler.handler(
			fakeSocket(w.user.id),
			{ id: notes.id } as any,
			noopEmit
		)
		expect(got?.lorebook?.id ?? got?.id).toBe(notes.id)
		const listed: any = await lorebooks.lorebooksSessionNotesHandler.handler(fakeSocket(w.user.id), {} as any, noopEmit)
		const row = listed.books.find((b: any) => b.id === notes.id)
		expect(row).toMatchObject({
			sessionId: w.session.id,
			sessionName: w.session.name,
			attached: { id: w.lorebook!.id, name: w.lorebook!.name }
		})
		const main: any = await lorebooks.lorebooksListHandler.handler(fakeSocket(w.user.id), {} as any, noopEmit)
		expect(main.lorebookList.map((b: any) => b.id)).not.toContain(notes.id)
	}, 60_000)
})
