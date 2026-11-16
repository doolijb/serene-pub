/**
 * 🚧 The `timeline-switch` boot pass (`lorebooks/timelinePass.ts`).
 *
 * Claims: a lorebook with nothing dated is off, and each stored fact that
 * dates a book (any history entry included) turns it on; a starter kit is
 * never decided; a session of a story-time genre, or one whose genre does not
 * resolve, keeps the book it reads or owns on, archived or not, while a
 * real-time genre's session does not; a session's notes born with their
 * calendar are off until something dates them, and notes over a lorebook copy
 * that lorebook's result; run through its boot marker the pass runs once, so a
 * later switch stands and no flag moves on a second boot.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { insertOwnBook } from "./ownBook"
import { settleTimelineSwitches } from "./timelinePass"

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timelinePass-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
let order = 0
let userId: number

async function user() {
	if (userId) return userId
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "timeline-pass")).id
	return userId
}

async function book(extra: Partial<typeof schema.lorebooks.$inferInsert> = {}) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: await user(), name: `Book ${++n}`, ...extra })
		.returning()
	return row!
}

async function entry(bookId: number, typeId: string, fields: Record<string, unknown> = {}) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId,
			typeVersion: 1,
			position: ++order,
			title: `Entry ${order}`,
			content: "…",
			fields
		})
		.returning()
	return row!
}

const dated = (bookId: number, year: unknown) => entry(bookId, HISTORY_TYPE_ID, { year })

async function member(bookId: number) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: bookId, binding: `{{char:m-${++n}}}`, characterId: null, name: "Raw", description: "Raw." })
		.returning()
	return row!
}

async function session(extra: Partial<typeof schema.sessions.$inferInsert> = {}) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: await user(),
			isGroup: false,
			name: `Run ${++n}`,
			// A real-time genre unless a case names another: the genre's own time rule is under test.
			genreId: "core:genre/chat",
			...extra
		})
		.returning()
	return row!
}

async function flag(id: number) {
	const [row] = await testDb
		.select({ t: schema.lorebooks.timelineEnabled })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, id))
	return row!.t
}

const allFlags = async () =>
	(
		await testDb
			.select({ id: schema.lorebooks.id, t: schema.lorebooks.timelineEnabled })
			.from(schema.lorebooks)
			.orderBy(asc(schema.lorebooks.id))
	).map((r) => `${r.id}:${r.t}`)

let facts: Record<string, number> = {}
let realTimeBook: number
let plain: number
let notes: Record<string, number> = {}
let beforeRun: string[]

beforeAll(async () => {
	plain = (await book()).id
	facts.clock = (await book({ storyClockYear: 5 })).id
	facts.branch = (await book()).id
	await testDb.insert(schema.lorebookBranches).values({ lorebookId: facts.branch, name: "Other", forkYear: 1 })
	facts.sessionClock = (await book()).id
	await session({ lorebookId: facts.sessionClock, storyClockYear: 3 })
	facts.historyYear = (await book()).id
	await dated(facts.historyYear, 1200)
	facts.historyString = (await book()).id
	await dated(facts.historyString, "1200")
	facts.entryAmendment = (await book()).id
	const place = await entry(facts.entryAmendment, LOCATION_TYPE_ID)
	await testDb
		.insert(schema.entryAmendments)
		.values({ lorebookId: facts.entryAmendment, entryId: place.id, year: 2, fields: { name: "Later" } })
	facts.heldAmendment = (await book()).id
	const held = await entry(facts.heldAmendment, LOCATION_TYPE_ID)
	await testDb.insert(schema.entryAmendments).values({
		lorebookId: facts.heldAmendment,
		entryId: held.id,
		year: null,
		fields: { name: "Held" },
		base: { name: { v: "Was" } },
		sourceMessageId: 5
	})
	facts.castAmendment = (await book()).id
	const m1 = await member(facts.castAmendment)
	await testDb
		.insert(schema.castAmendments)
		.values({ lorebookBindingId: m1.id, lorebookId: facts.castAmendment, year: 3, fields: { name: "Later" } } as any)
	facts.castVersion = (await book()).id
	const m2 = await member(facts.castVersion)
	await testDb.insert(schema.characterVersions).values({
		castMemberId: m2.id,
		lorebookId: facts.castVersion,
		nodeState: "active",
		nodeVisibility: "normal",
		writeOrder: 1_000_000 + ++order,
		year: 4,
		name: "Later",
		follows: []
	})
	facts.link = (await book()).id
	const a = await entry(facts.link, LOCATION_TYPE_ID)
	const b = await entry(facts.link, LOCATION_TYPE_ID)
	const day = await dated(facts.link, 7)
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: facts.link,
		fromEntryId: a.id,
		toEntryId: b.id,
		relationshipType: "leads to",
		historyEntryId: day.id
	})
	facts.stat = (await book()).id
	const statDay = await entry(facts.stat, HISTORY_TYPE_ID, {})
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: facts.stat,
		slotId: "test:slot/x@1",
		value: { v: 1 },
		historyEntryId: statDay.id,
		updatedBy: "test"
	} as any)
	facts.calendar = (
		await book({
			storyCalendar: { months: [{ name: "Only", days: 30 }] } as any
		})
	).id
	facts.presence = (await book()).id
	const placed = await member(facts.presence)
	await testDb
		.insert(schema.castPresences)
		.values({ lorebookBindingId: placed.id, lorebookId: facts.presence, personalPosition: 1, fromYear: 2 } as any)
	facts.stampedScene = (await book()).id
	await testDb
		.insert(schema.scenes)
		.values({ lorebookId: facts.stampedScene, name: "Stamped", selectedMessageIds: [], openedStoryClockYear: 6 } as any)

	facts.historyBare = (await book()).id
	await dated(facts.historyBare, undefined)
	facts.storySession = (await book()).id
	await session({ lorebookId: facts.storySession, genreId: "core:genre/story" })
	facts.storyArchived = (await book()).id
	await session({ lorebookId: facts.storyArchived, genreId: "core:genre/story", archivedAt: new Date() })
	facts.laterStory = (await book()).id
	await session({ lorebookId: facts.laterStory, genreId: "core:genre/chat" })
	await session({ lorebookId: facts.laterStory, genreId: "core:genre/lair", archivedAt: new Date() })
	facts.unresolved = (await book()).id
	await session({ lorebookId: facts.unresolved, genreId: "plugin:genre/gone" })
	facts.kit = (await book({ kind: "starter_kit" })).id
	realTimeBook = (await book()).id
	await session({ lorebookId: realTimeBook, genreId: "core:genre/chat" })
	await session({ lorebookId: realTimeBook, genreId: "core:genre/guide" })

	// Notes that are their session's whole world.
	const quiet = await session()
	notes.quiet = (
		await insertOwnBook(db(), {
			sessionId: quiet.id,
			userId: await user(),
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
	).id
	const storyWorld = await session({ genreId: "core:genre/story" })
	notes.storyWorld = (
		await insertOwnBook(db(), {
			sessionId: storyWorld.id,
			userId: await user(),
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
	).id
	const unresolvedWorld = await session({ genreId: "plugin:genre/gone" })
	notes.unresolvedWorld = (
		await insertOwnBook(db(), {
			sessionId: unresolvedWorld.id,
			userId: await user(),
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
	).id
	const clocked = await session({ storyClockYear: 9 })
	notes.clocked = (
		await insertOwnBook(db(), {
			sessionId: clocked.id,
			userId: await user(),
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
	).id
	// Notes over books: one over a dated book, one over a plain one.
	for (const [key, over] of [
		["overDated", facts.clock],
		["overPlain", plain]
	] as const) {
		const s = await session({ lorebookId: over })
		notes[key] = (
			await insertOwnBook(db(), {
				sessionId: s.id,
				userId: await user(),
				name: null,
				overlayOf: over,
				primaryRuleset: "core:ruleset/freeform@1",
				rulesetVersion: null
			})
		).id
	}
	beforeRun = await allFlags()
}, 60_000)

describe("timeline-switch pass", () => {
	test("a book with nothing dated is off; each stored fact turns its book on; an undated history entry does too (a held, undated amendment does not)", async () => {
		expect(beforeRun.every((s) => s.endsWith(":true"))).toBe(true)
		const { runWithBootMarker } = await import("$lib/server/startup/bootMarkers")
		await runWithBootMarker(db(), {
			name: "timeline-switch",
			doneMarker: "timeline-switch",
			run: () => settleTimelineSwitches(db()).then(() => {})
		})
		expect(await flag(plain)).toBe(false)
		expect(await flag(realTimeBook)).toBe(false)
		expect(await flag(facts.heldAmendment)).toBe(false)
		for (const [name, id] of Object.entries(facts)) {
			if (name === "heldAmendment") continue
			expect(await flag(id), name).toBe(true)
		}
	})

	test("a lorebook the pass switched off is marked, one it left on is not, and a copy never carries the mark", async () => {
		const mark = async (id: number) =>
			(
				await testDb
					.select({ extraJson: schema.lorebooks.extraJson })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, id))
			)[0]!.extraJson?.timelineOffByPass
		expect(typeof (await mark(plain))).toBe("string")
		expect(await mark(facts.clock!)).toBeUndefined()
		const { duplicateLorebookRows } = await import("$lib/server/utils/lorebookDuplicate")
		const copy = await testDb.transaction((tx) =>
			duplicateLorebookRows(tx as unknown as Db, plain, userId, "Copy of plain")
		)
		expect(await flag(copy.id)).toBe(false)
		expect(await mark(copy.id)).toBeUndefined()
	})

	test("each reason to stay on is held by its own book; a real-time genre's sessions are not one", async () => {
		for (const name of ["historyBare", "storySession", "storyArchived", "laterStory", "unresolved", "kit"])
			expect(await flag(facts[name]!), name).toBe(true)
		expect(await flag(realTimeBook)).toBe(false)
	})

	test("a starter kit is never decided, even when the pass would turn it off", async () => {
		const kit = (await book({ kind: "starter_kit" })).id
		await testDb.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, kit))
		await settleTimelineSwitches(db())
		expect(await flag(kit)).toBe(true)
		await testDb.update(schema.lorebooks).set({ timelineEnabled: false }).where(eq(schema.lorebooks.id, kit))
		await settleTimelineSwitches(db())
		expect(await flag(kit)).toBe(false)
	})

	test("notes: born calendar and nothing dated is off, a session clock is on, notes over a book copy that book", async () => {
		expect(await flag(notes.quiet)).toBe(false)
		expect(await flag(notes.storyWorld)).toBe(true)
		expect(await flag(notes.unresolvedWorld)).toBe(true)
		expect(await flag(notes.clocked)).toBe(true)
		expect(await flag(notes.overDated)).toBe(true)
		expect(await flag(notes.overPlain)).toBe(false)
	})

	test("one-shot: a later switch stands, a later dated row switches nothing on, a second boot moves nothing", async () => {
		await testDb.update(schema.lorebooks).set({ timelineEnabled: false }).where(eq(schema.lorebooks.id, facts.clock))
		await dated(plain, 50)
		const after = await allFlags()
		const { runWithBootMarker } = await import("$lib/server/startup/bootMarkers")
		let ran = false
		await runWithBootMarker(db(), {
			name: "timeline-switch",
			doneMarker: "timeline-switch",
			run: () => {
				ran = true
				return settleTimelineSwitches(db()).then(() => {})
			}
		})
		expect(ran).toBe(false)
		expect(await flag(facts.clock)).toBe(false)
		expect(await flag(plain)).toBe(false)
		expect(await allFlags()).toEqual(after)
	})

	test("the pass itself counts what it set and, run again on its result, changes nothing", async () => {
		await testDb.update(schema.lorebooks).set({ timelineEnabled: true })
		const first = await settleTimelineSwitches(db())
		expect(first.on).toBeGreaterThan(0)
		expect(first.off).toBeGreaterThan(0)
		expect(first.notesCopied).toBeGreaterThanOrEqual(0)
		const settled = await allFlags()
		await settleTimelineSwitches(db())
		expect(await allFlags()).toEqual(settled)
	})
})
