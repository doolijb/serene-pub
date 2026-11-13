/**
 * ★bk-fold-1 (owner 2026-11-08): a session on its own notes reads them on its
 * own line and moment, like any book. `sessionReadingOf` answers for the own
 * book when no book is attached (`onOwnBook`); the union readers read the notes
 * at that reading and never twice.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"

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
		path.join(os.tmpdir(), "serene-pub-vitest-own-notes-reading-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const SHUT = "test:slot/own-notes-shut@1"
const GENRE = "test:genre/own-notes-reading"

function declareSlots() {
	_clearAttributeSlots()
	const shut = defineAttributeSlot(SHUT, {
		type: "boolean",
		descriptor: "Whether the shop is shut.",
		appliesTo: ["world"],
		scope: "world",
		default: false
	})
	genreKeeping(GENRE, {
		name: { en: "Own notes" },
		family: "test",
		slots: [shut],
		events: {}
	})
}

let n = 0
let order = 0

/** A session on its own notes alone (or on an attached book) with its own book made. */
async function setup(
	opts: { attached?: boolean; clock?: { year: number } } = {}
) {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `own-notes-${suffix}`)
	let attachedId: number | null = null
	if (opts.attached) {
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `Shared ${suffix}` })
			.returning()
		attachedId = shared!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: attachedId,
			storyClockYear: opts.clock?.year ?? null
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	return { user, session: session!, own, attachedId }
}
type Setup = Awaited<ReturnType<typeof setup>>

async function entry(
	bookId: number,
	title: string,
	extra: {
		typeId?: string
		fields?: Record<string, unknown>
		branchId?: number | null
	} = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId: extra.typeId ?? HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++order,
			title,
			content: `${title}.`,
			fields: extra.fields ?? {},
			branchId: extra.branchId ?? null
		})
		.returning()
	return row!
}

const history = (
	bookId: number,
	title: string,
	year: number | null,
	branchId: number | null = null
) => entry(bookId, title, { fields: year == null ? {} : { year }, branchId })

const place = (bookId: number, title: string, branchId: number | null = null) =>
	entry(bookId, title, { typeId: LOCATION_TYPE_ID, branchId })

async function branchOf(bookId: number, name: string, forkYear: number) {
	const [row] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: bookId, name, forkYear })
		.returning()
	return row!
}

/** A member of `bookId` for a fresh card, with its base version and an optional dated late version. */
async function member(
	s: Setup,
	bookId: number,
	name: string,
	late?: { year: number; name: string; branchId?: number | null }
) {
	const { insertCastMember } = await import("$lib/server/characters/versions")
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: s.user.id, name, description: `${name} card.` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: bookId,
		binding: `{{char:${name}-${++n}}}`,
		characterId: card!.id,
		name: ""
	})
	if (late)
		await testDb.insert(schema.characterVersions).values({
			castMemberId: member.id,
			lorebookId: bookId,
			nodeState: "active",
			nodeVisibility: "normal",
			writeOrder: 1_000_000 + ++order,
			year: late.year,
			branchId: late.branchId ?? null,
			name: late.name,
			follows: []
		})
	return member
}

/** A durable world value in `bookId`, dated by a history entry when `year` is given. */
async function worldValue(
	bookId: number,
	v: boolean,
	opts: { year?: number; branchId?: number | null } = {}
) {
	const dated =
		opts.year != null
			? await history(bookId, `Value dated ${opts.year}`, opts.year)
			: null
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: bookId,
		slotId: SHUT,
		value: { v },
		branchId: opts.branchId ?? null,
		historyEntryId: dated?.id ?? null,
		validFromMessageId: null
	})
}

const readingOf = async (sessionId: number) =>
	(await import("$lib/server/state/reading")).sessionReadingOf(
		db(),
		sessionId
	)

const entryTitles = async (sessionId: number) => {
	const { sessionEntriesAsRead } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	return (await sessionEntriesAsRead(db(), sessionId, "session", null))
		.filter((e) => !e.unseen)
		.map((e) => e.name)
		.sort()
}

const memberName = async (sessionId: number, memberId: number) => {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	return (await membersAsRead(db(), [memberId], { sessionId })).get(memberId)
		?.name
}

const placeNames = async (s: Setup) => {
	const { readSessionPlaces } = await import(
		"$lib/server/sockets/sessionPlaces"
	)
	return (await readSessionPlaces(s.session.id, s.user.id)).places
		.map((p) => p.name)
		.sort()
}

const worldNow = async (s: Setup) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(db(), {
		sessionId: s.session.id,
		owner: { kind: "session", id: s.session.id },
		slotId: SHUT
	})
}

async function ownNotes(s: Setup) {
	await history(s.own.id, "Undated note", null)
	await history(s.own.id, "Early note", 5)
	await history(s.own.id, "Late note", 50)
	await place(s.own.id, "The Cellar")
	const maren = await member(s, s.own.id, "Maren", {
		year: 50,
		name: "Maren deceased"
	})
	await worldValue(s.own.id, false)
	await worldValue(s.own.id, true, { year: 50 })
	return { maren }
}

describe("a session on its own notes alone reads them on its reading", () => {
	test("with no clock and no line the reading is the own book on main at the head, and every read equals main's head", async () => {
		const s = await setup()
		const { maren } = await ownNotes(s)
		const reading = await readingOf(s.session.id)
		expect(reading).toMatchObject({
			lorebookId: s.own.id,
			branchId: null,
			moment: null,
			forkedAt: null,
			onOwnBook: true
		})
		expect(await entryTitles(s.session.id)).toEqual([
			"Early note",
			"Late note",
			"The Cellar",
			"Undated note",
			"Value dated 50"
		])
		expect(await memberName(s.session.id, maren.id)).toBe("Maren deceased")
		expect(await placeNames(s)).toEqual(["The Cellar"])
		expect(await worldNow(s)).toBe(true)
	})

	test("an attached session reads its notes at main's head, with no onOwnBook", async () => {
		const s = await setup({ attached: true, clock: { year: 1 } })
		await ownNotes(s)
		await history(s.attachedId!, "Shared note", null)
		const reading = await readingOf(s.session.id)
		expect(reading).toMatchObject({
			lorebookId: s.attachedId,
			moment: { year: 1 }
		})
		expect(reading?.onOwnBook).toBeUndefined()
		const { sessionEntriesAsRead } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const read = (
			await sessionEntriesAsRead(db(), s.session.id, "session", null)
		).filter((e) => !e.unseen)
		expect(read.filter((e) => !e.sessionOnly).map((e) => e.name)).toEqual([
			"Shared note"
		])
		expect(
			read
				.filter((e) => e.sessionOnly)
				.map((e) => e.name)
				.sort()
		).toEqual([
			"Early note",
			"Late note",
			"The Cellar",
			"Undated note",
			"Value dated 50"
		])
	})
})

describe("a session clock cuts the own notes", () => {
	test("rows dated after the clock are hidden, undated rows show", async () => {
		const s = await setup({ clock: { year: 10 } })
		const { maren } = await ownNotes(s)
		expect(await readingOf(s.session.id)).toMatchObject({
			lorebookId: s.own.id,
			moment: { year: 10 },
			onOwnBook: true
		})
		expect(await entryTitles(s.session.id)).toEqual([
			"Early note",
			"The Cellar",
			"Undated note"
		])
		expect(await memberName(s.session.id, maren.id)).toBe("Maren")
		expect(await placeNames(s)).toEqual(["The Cellar"])
		expect(await worldNow(s)).toBe(false)
	})

	test("the own book's own clock stands in when the session has none", async () => {
		const s = await setup()
		await testDb
			.update(schema.lorebooks)
			.set({ storyClockYear: 10 })
			.where(eq(schema.lorebooks.id, s.own.id))
		const { maren } = await ownNotes(s)
		expect(await readingOf(s.session.id)).toMatchObject({
			moment: { year: 10 },
			onOwnBook: true
		})
		expect(await entryTitles(s.session.id)).toEqual([
			"Early note",
			"The Cellar",
			"Undated note"
		])
		expect(await memberName(s.session.id, maren.id)).toBe("Maren")
	})
})

describe("a session on a line of its own book", () => {
	async function onLine() {
		const s = await setup()
		const b = await branchOf(s.own.id, "B", 10)
		const c = await branchOf(s.own.id, "C", 10)
		await history(s.own.id, "Main early", 5)
		await history(s.own.id, "Main late", 15)
		await history(s.own.id, "On B", null, b.id)
		await history(s.own.id, "On C", null, c.id)
		await place(s.own.id, "Main hall")
		await place(s.own.id, "B hall", b.id)
		await place(s.own.id, "C hall", c.id)
		const maren = await member(s, s.own.id, "Maren", {
			year: 15,
			name: "Maren on main later"
		})
		await testDb.insert(schema.characterVersions).values({
			castMemberId: maren.id,
			lorebookId: s.own.id,
			nodeState: "active",
			nodeVisibility: "normal",
			writeOrder: 2_000_000 + ++order,
			year: 11,
			branchId: b.id,
			name: "Maren on B",
			follows: []
		})
		await worldValue(s.own.id, false)
		await worldValue(s.own.id, true, { year: 15 })
		await worldValue(s.own.id, true, { branchId: b.id })
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: b.id })
			.where(eq(schema.sessions.id, s.session.id))
		return { s, b, maren }
	}

	test("entries, members, places and values read the line and main up to the fork", async () => {
		const { s, b, maren } = await onLine()
		expect(await readingOf(s.session.id)).toMatchObject({
			lorebookId: s.own.id,
			branchId: b.id,
			forkedAt: { year: 10 },
			onOwnBook: true
		})
		expect(await entryTitles(s.session.id)).toEqual([
			"B hall",
			"Main early",
			"Main hall",
			"On B"
		])
		expect(await memberName(s.session.id, maren.id)).toBe("Maren on B")
		expect(await placeNames(s)).toEqual(["B hall", "Main hall"])
		expect(await worldNow(s)).toBe(true)
	})

	test("a stale line id reads main", async () => {
		const { s } = await onLine()
		// A line of another book: the handler never allows it, and the reading refuses it.
		const [other] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: s.user.id, name: "Other" })
			.returning()
		const elsewhere = await branchOf(other!.id, "Elsewhere", 1)
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: elsewhere.id })
			.where(eq(schema.sessions.id, s.session.id))
		expect(await readingOf(s.session.id)).toMatchObject({
			lorebookId: s.own.id,
			branchId: null,
			onOwnBook: true
		})
		expect(await entryTitles(s.session.id)).toEqual([
			"Main early",
			"Main hall",
			"Main late",
			"Value dated 15"
		])
	})
})

describe("nothing is read twice", () => {
	test("each own entry and room appears once", async () => {
		const s = await setup()
		await ownNotes(s)
		const { sessionEntriesAsRead } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const ids = (
			await sessionEntriesAsRead(db(), s.session.id, "session", null)
		).map((e) => e.entryId)
		expect(new Set(ids).size).toBe(ids.length)
		const places = await placeNames(s)
		expect(places).toEqual([...new Set(places)])
		expect(places).toEqual(["The Cellar"])
	})
})

describe("the stat trail", () => {
	test("an own-book session answers from the session layer", async () => {
		const s = await setup({ clock: { year: 10 } })
		await ownNotes(s)
		const { sessionStatTrail } = await import("$lib/server/state/statTrail")
		const trail = await sessionStatTrail(db(), {
			sessionId: s.session.id,
			owner: { kind: "session", id: s.session.id },
			slotId: SHUT
		})
		expect(trail.changes).toEqual([])
	})
})
