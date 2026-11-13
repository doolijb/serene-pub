/**
 * 🚧 `foldInParent`: the attached book copied into the session's own notes, the session reading only its notes.
 * The session reads the same before and after (the guard), the book is never written but for the session's
 * scene captures, and a fold that would read differently rolls back whole.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
import {
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { FOLD_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import { LOREBOOK_TABLES } from "./tableRegistry"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-foldInParent-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
const MOOD = "test:slot/fold-mood@1"
const LAMPS = "test:slot/fold-lamps@1"
const HP = "test:slot/fold-hp@1"
const GENRE = "test:genre/fold-in-parent"
let n = 0

function declareSlots() {
	_clearAttributeSlots()
	const mood = defineAttributeSlot(MOOD, {
		type: "text",
		descriptor: "The world's mood.",
		appliesTo: ["world"],
		scope: "world"
	})
	const lamps = defineAttributeSlot(LAMPS, {
		type: "integer",
		descriptor: "Lamps a place has lit.",
		appliesTo: ["location"],
		scope: "world"
	})
	const hp = defineAttributeSlot(HP, {
		type: "integer",
		descriptor: "A person's hit points.",
		appliesTo: ["cast"],
		scope: "world",
		default: 10,
		config: { min: 0, max: 99 }
	})
	genreKeeping(GENRE, {
		name: { en: "Fold in parent" },
		family: "test",
		slots: [mood, lamps, hp],
		events: {}
	})
}

async function place(
	lorebookId: number,
	title: string,
	extra: Record<string, unknown> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: 1,
			title,
			...extra
		} as any)
		.returning()
	return row!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: `${name} ${++n}`,
			description: "",
			uuid: crypto.randomUUID()
		} as any)
		.returning()
	return row!
}

/**
 * A session reading a book of its own owner's: the book holds two people (one with a card, with a later dated
 * version), a place, a dated entry, a line "Night" and values; the session's notes hold their own place under the book's,
 * their own world value on the same slot, and a rule-fed field; two seats, lines, a ref in the annex and a scene.
 */
async function world(opts: { onNight?: boolean } = {}) {
	declareSlots()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { ownBookFor } = await import("./ownBook")
	const user = await createTestUser(testDb, `fold-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Parent ${n}` })
		.returning()
	const anna = await card(user.id, "Anna")
	const m1 = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: "{{char:1}}",
		name: "Anna",
		characterId: anna.id,
		summary: "Knows {{char:2}}."
	} as any)
	const m2 = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: "{{char:2}}",
		name: "Bruno"
	} as any)
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 3 })
		.where(eq(schema.lorebooks.id, book!.id))
	await insertCharacterVersions(db(), [
		{
			castMemberId: m1.member.id,
			lorebookId: book!.id,
			name: "Anna later",
			year: 3,
			nodeState: "active",
			nodeVisibility: "normal",
			writtenBy: "user"
		} as any
	])
	const [night] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: "Night", forkYear: 2 })
		.returning()
	const square = await place(book!.id, "The square")
	const market = await place(book!.id, "Night market", {
		position: 2,
		branchId: night!.id
	})
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: book!.id, year: 5, month: 1, day: 2 }])
		)
		.returning()
	const [lateOnMain] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book!.id, year: 7 }]))
		.returning()
	const [lateOnNight] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: book!.id, year: 9, branchId: night!.id } as any
			])
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${n}`,
			genreId: GENRE,
			lorebookId: book!.id,
			...(opts.onNight
				? { lorebookBranchId: night!.id, storyClockYear: 6 }
				: {}),
			annex: { "test:owner": { note: "kept" } },
			annexAudiences: {
				"test:owner": { note: [`seated-member:${m1.member.id}`] }
			}
		} as any)
		.returning()
	const notes = await ownBookFor(testDb as any, session!.id)
	await testDb
		.update(schema.lorebooks)
		.set({
			extraJson: {
				ruleFed: {
					entryFields: { [square.id]: { mood: "hushed" } },
					castStates: { [m2.member.id]: "away" }
				}
			},
			annex: { "test:owner": { own: "mine" } }
		})
		.where(eq(schema.lorebooks.id, notes.id))
	const door = await place(notes.id, "The secret door", {
		anchorEntryId: square.id
	})
	// Values: the book's world and each person's; the notes' own world value on the same slot, written first.
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: notes.id,
		slotId: MOOD,
		value: { v: "stormy" },
		sessionId: null
	} as any)
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: book!.id,
		slotId: MOOD,
		value: { v: "calm" },
		sessionId: null
	} as any)
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "location",
		ownerId: square.id,
		slotId: LAMPS,
		value: { v: 4 },
		sessionId: null
	} as any)
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "cast_member",
		ownerId: m1.member.id,
		slotId: LAMPS,
		value: { v: 1 },
		sessionId: session!.id
	} as any)
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "session_location",
		ownerId: square.id,
		slotId: LAMPS,
		value: { v: 6 },
		sessionId: session!.id
	} as any)
	// Seats and lines.
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: anna.id,
		castMemberId: m1.member.id,
		isActive: true
	} as any)
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		castMemberId: m2.member.id,
		isActive: true,
		position: 1
	} as any)
	const line1 = await insertSessionMessageRow(testDb, session!.id, {
		role: "assistant",
		content: "Hello.",
		characterId: anna.id,
		castMemberId: m1.member.id
	} as any)
	await insertSessionMessageRow(testDb, session!.id, {
		role: "assistant",
		content: "Grr.",
		castMemberId: m2.member.id
	} as any)
	await testDb.insert(schema.widgetSettings).values({
		sessionId: session!.id,
		userId: user.id,
		widgetInstanceId: "fold-w",
		values: { pickMembers: [`seated-member:${m1.member.id}`] }
	} as any)
	// A scene of this session in the book, and another session's.
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: book!.id,
			sessionId: session!.id,
			historyEntryId: history!.id,
			name: "Scene 1",
			channel: "main",
			selectedMessageIds: [line1!.id]
		} as any)
		.returning()
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: scene!.id,
		bindingId: m1.member.id,
		role: "participant"
	} as any)
	const [other] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Other ${n}`,
			lorebookId: book!.id
		} as any)
		.returning()
	const [otherScene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: book!.id,
			sessionId: other!.id,
			historyEntryId: history!.id,
			name: "Other scene",
			channel: "main",
			selectedMessageIds: []
		} as any)
		.returning()
	return {
		user,
		book: book!,
		anna,
		m1: m1.member,
		m2: m2.member,
		night: night!,
		square,
		market,
		history: history!,
		lateOnMain: lateOnMain!,
		lateOnNight: lateOnNight!,
		session: session!,
		notes,
		door,
		scene: scene!,
		other: other!,
		otherScene: otherScene!
	}
}
type World = Awaited<ReturnType<typeof world>>

const fold = async (w: World, userId = w.user.id) => {
	const { foldInParent } = await import("./foldInParent")
	return foldInParent(db(), { sessionId: w.session.id, userId })
}

const readOf = async (
	sessionId: number,
	owner: { kind: any; id: number },
	slotId: string
) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as any, { sessionId, owner, slotId })
}

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!
const bookRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, id))
	)[0]!
const entriesIn = (id: number) =>
	testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, id))
		.orderBy(asc(schema.lorebookEntries.id))
const membersIn = (id: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, id))
		.orderBy(asc(schema.lorebookBindings.id))

/** What the session reads: its entries by name, and its seats' members by shown name. */
async function reads(sessionId: number) {
	const { sessionEntriesAsRead } = await import("./ownBook")
	const { seatMembersAsRead } = await import(
		"$lib/server/pipelines/prompt/seatCards"
	)
	const entries = (
		await sessionEntriesAsRead(db(), sessionId, "session", null)
	)
		.map((e) => `${e.typeId}:${e.name}`)
		.sort()
	const seats = await testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))
	const members = await seatMembersAsRead(
		db(),
		sessionId,
		seats.map((s) => ({
			castMemberId: s.castMemberId,
			character: s.characterId != null ? { id: s.characterId } : null
		})),
		{ cardless: true }
	)
	return {
		entries,
		members: members.map(
			(m) =>
				m && {
					name: m.name,
					shownName: m.shownName,
					description: m.description,
					summary: m.summary
				}
		)
	}
}

/** Every row a book holds in every registered table, whole, by the table's own scope (the template layer of the attribute tables: a session's rows are the session's). */
async function dump(bookId: number): Promise<Record<string, any[]>> {
	const ids = async (table: any, col: any) =>
		(
			await testDb
				.select({ id: table.id })
				.from(table)
				.where(eq(col, bookId))
		).map((r: any) => r.id as number)
	const members = await ids(
		schema.lorebookBindings,
		schema.lorebookBindings.lorebookId
	)
	const entries = await ids(
		schema.lorebookEntries,
		schema.lorebookEntries.lorebookId
	)
	const scenes = await ids(schema.scenes, schema.scenes.lorebookId)
	const sets = members.length
		? (
				await testDb
					.select({ id: schema.spriteSets.id })
					.from(schema.spriteSets)
					.where(inArray(schema.spriteSets.castMemberId, members))
			).map((r) => r.id)
		: []
	const out: Record<string, any[]> = { lorebooks: [await bookRow(bookId)] }
	for (const spec of LOREBOOK_TABLES) {
		const t = spec.table as any
		const name = (spec.table as any)[Symbol.for("drizzle:Name")] as string
		const some = (col: any, list: number[]) =>
			list.length
				? testDb.select().from(t).where(inArray(col, list))
				: Promise.resolve([])
		let rows: any[]
		if (spec.scope === "book")
			rows = await testDb.select().from(t).where(eq(t.lorebookId, bookId))
		else if (spec.scope === "entry") rows = await some(t.entryId, entries)
		else if (spec.scope === "scene") rows = await some(t.sceneId, scenes)
		else if (spec.scope === "binding")
			rows = t.castMemberId
				? await some(t.castMemberId, members)
				: await some(t.spriteSetId, sets)
		else {
			rows = []
			for (const [kind, list] of [
				["lorebook", [bookId]],
				["cast_member", members],
				["location", entries]
			] as Array<[string, number[]]>)
				if (list.length)
					rows.push(
						...(await testDb
							.select()
							.from(t)
							.where(
								and(
									eq(t.ownerKind, kind),
									inArray(t.ownerId, list),
									isNull(t.sessionId)
								)
							))
					)
		}
		out[name] = rows
			.sort((a, b) => a.id - b.id)
			.map((r) => JSON.parse(JSON.stringify(r)))
	}
	return out
}

/** Everything a fold may touch of the session, its notes and the book, whole. */
async function everything(w: World) {
	return JSON.parse(
		JSON.stringify({
			session: await sessionRow(w.session.id),
			seats: await testDb
				.select()
				.from(schema.sessionCharacters)
				.where(eq(schema.sessionCharacters.sessionId, w.session.id))
				.orderBy(asc(schema.sessionCharacters.id)),
			messages: await testDb
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, w.session.id))
				.orderBy(asc(schema.sessionMessages.id)),
			widgets: await testDb
				.select()
				.from(schema.widgetSettings)
				.where(eq(schema.widgetSettings.sessionId, w.session.id)),
			sessionValues: await testDb
				.select()
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.sessionId, w.session.id))
				.orderBy(asc(schema.attributeValues.id)),
			parent: await dump(w.book.id),
			notes: await dump(w.notes.id)
		})
	)
}

describe("foldInParent on main", () => {
	test("the session reads only its notes, as it read before; the seats, speakers and refs are on the copies", async () => {
		const w = await world()
		const before = await reads(w.session.id)
		expect(before.entries).toContain(`${LOCATION_TYPE_ID}:The square`)
		expect(before.entries).toContain(`${LOCATION_TYPE_ID}:The secret door`)

		const done = await fold(w)

		expect(done).toMatchObject({
			lorebookId: w.notes.id,
			foldedFrom: { id: w.book.id, name: w.book.name }
		})
		// Each live character seat's member ref moved: a removed then an added.
		expect(done.seatChanges.map((c) => c.change)).toEqual([
			"removed",
			"added",
			"removed",
			"added"
		])
		const session = await sessionRow(w.session.id)
		expect(session.lorebookId).toBeNull()
		expect(session.lorebookBranchId).toBeNull()
		expect((await bookRow(w.notes.id)).overlayOf).toBeNull()
		expect(await reads(w.session.id)).toEqual(before)

		// Members: each person of the book has a copy in the notes; seats and stamps follow.
		const copies = await membersIn(w.notes.id)
		const anna = copies.find(
			(m) => m.name === "Anna" && m.characterId === w.anna.id
		)!
		const bruno = copies.find((m) => m.name === "Bruno")!
		expect(anna.id).not.toBe(w.m1.id)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, w.session.id))
			.orderBy(asc(schema.sessionCharacters.id))
		expect(
			seats.map((s) => [
				s.characterId,
				s.castMemberId,
				s.isActive,
				s.position
			])
		).toEqual([
			[w.anna.id, anna.id, true, 0],
			[null, bruno.id, true, 1]
		])
		const lines = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
			.orderBy(asc(schema.sessionMessages.id))
		expect(lines.map((l) => l.castMemberId)).toEqual([anna.id, bruno.id])
		expect(session.annexAudiences).toEqual({
			"test:owner": { note: [`seated-member:${anna.id}`] }
		})
		const [widget] = await testDb
			.select()
			.from(schema.widgetSettings)
			.where(eq(schema.widgetSettings.sessionId, w.session.id))
		expect((widget!.values as any).pickMembers).toEqual([
			`seated-member:${anna.id}`
		])

		// The session's own rows follow the copies.
		const entries = await entriesIn(w.notes.id)
		const square = entries.find((e) => e.title === "The square")!
		const door = entries.find((e) => e.title === "The secret door")!
		expect(square.id).not.toBe(w.square.id)
		expect(door.anchorEntryId).toBe(square.id)
		expect(
			new Set(
				entries
					.filter((e) => e.typeId === LOCATION_TYPE_ID)
					.map((e) => e.position)
			).size
		).toBe(entries.filter((e) => e.typeId === LOCATION_TYPE_ID).length)
		const mine = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.session.id))
			.orderBy(asc(schema.attributeValues.id))
		expect(mine.map((r) => [r.ownerKind, r.ownerId])).toEqual([
			["cast_member", anna.id],
			["session_location", square.id]
		])
		const fed = ((await bookRow(w.notes.id)).extraJson as any).ruleFed
		expect(fed.entryFields).toEqual({ [square.id]: { mood: "hushed" } })
		expect(fed.castStates).toEqual({ [bruno.id]: "away" })

		// The book's facts and the annex: the book's under the notes'.
		const notes = await bookRow(w.notes.id)
		expect(notes.annex).toEqual({ "test:owner": { own: "mine" } })
		const tags = (await membersIn(w.notes.id)).map((m) => m.binding)
		expect(new Set(tags).size).toBe(tags.length)
		expect(notes.nextBindingNumber).toBeGreaterThan(
			Math.max(...tags.map((t) => Number(/\d+/.exec(t)![0])))
		)

		// "Night" is on the notes too.
		const lines2 = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, w.notes.id))
		expect(lines2.map((l) => l.name)).toEqual(["Night"])
	})

	test("the notes' own world value is still the one read, above the copied one", async () => {
		const w = await world()
		const world_ = { kind: "session", id: w.session.id }
		await fold(w)
		expect(await readOf(w.session.id, world_, MOOD)).toBe("stormy")
		const rows = (
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "lorebook"),
						eq(schema.attributeValues.ownerId, w.notes.id)
					)
				)
		).sort((a, b) => a.id - b.id)
		expect(rows.map((r) => (r.value as any).v)).toEqual(["calm", "stormy"])
	})
})

describe("foldInParent on a line with a clock", () => {
	test("the session moves to the copy of its line; the clock stays; reads are equal", async () => {
		const w = await world({ onNight: true })
		const before = await reads(w.session.id)
		expect(before.entries.length).toBeGreaterThan(0)

		await fold(w)

		const session = await sessionRow(w.session.id)
		const [night] = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, session.lorebookBranchId!))
		expect(night!.lorebookId).toBe(w.notes.id)
		expect(night!.name).toBe("Night")
		expect(session.lorebookBranchId).not.toBe(w.night.id)
		expect(session.storyClockYear).toBe(6)
		expect(session.lorebookId).toBeNull()
		expect(await reads(w.session.id)).toEqual(before)
		// Dated rows on main after the fork and on Night came across with their lines.
		const copies = await entriesIn(w.notes.id)
		expect(
			copies.filter((e) => e.branchId === night!.id).length
		).toBeGreaterThan(0)
	})
})

describe("foldInParent and the captures", () => {
	test("this session's scene moves to the notes with its cast on the copies; the duplicate is gone; another session's stays", async () => {
		const w = await world()
		await fold(w)
		const [scene] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, w.scene.id))
		expect(scene!.lorebookId).toBe(w.notes.id)
		expect(scene!.sessionId).toBe(w.session.id)
		const anna = (await membersIn(w.notes.id)).find(
			(m) => m.characterId === w.anna.id
		)!
		const cast = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, w.scene.id))
		expect(cast.map((c) => c.bindingId)).toEqual([anna.id])
		expect(
			(await entriesIn(w.notes.id)).some(
				(e) => e.id === scene!.historyEntryId
			)
		).toBe(true)
		// One scene of it in the notes, not two; the other session's stays in the book, with a capture-less copy beside it.
		const inNotes = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, w.notes.id))
		expect(inNotes.filter((s) => s.name === "Scene 1")).toHaveLength(1)
		expect(
			inNotes
				.filter((s) => s.name === "Other scene")
				.map((s) => s.sessionId)
		).toEqual([null])
		const [other] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, w.otherScene.id))
		expect(other!.lorebookId).toBe(w.book.id)
		expect(
			await testDb
				.select()
				.from(schema.scenes)
				.where(
					and(
						eq(schema.scenes.lorebookId, w.book.id),
						eq(schema.scenes.sessionId, w.session.id)
					)
				)
		).toHaveLength(0)
	})

	test("the book is byte-identical but for this session's captures", async () => {
		const w = await world()
		const before = await dump(w.book.id)
		await fold(w)
		const after = await dump(w.book.id)
		const captured = new Set([w.scene.id])
		const expected = {
			...before,
			scenes: before.scenes!.filter((s) => !captured.has(s.id)),
			scene_characters: before.scene_characters!.filter(
				(c) => !captured.has(c.sceneId)
			)
		}
		expect(after).toEqual(expected)
	})
})

describe("foldInParent refusals and rollback", () => {
	test("a second fold, a stranger and a missing session are refused in the ruled words", async () => {
		const { OwnBookRefusal } = await import("./ownBook")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { foldInParent } = await import("./foldInParent")
		const w = await world()
		const stranger = await createTestUser(testDb, `fold-stranger-${++n}`)
		const notOwner = await fold(w, stranger.id).catch((e) => e)
		expect(notOwner).toBeInstanceOf(OwnBookRefusal)
		expect(notOwner.message).toBe(FOLD_REFUSALS.notOwner)
		await fold(w)
		const second = await fold(w).catch((e) => e)
		expect(second).toBeInstanceOf(OwnBookRefusal)
		expect(second.message).toBe(FOLD_REFUSALS.alreadyOwn)
		const gone = await foldInParent(db(), {
			sessionId: 987654,
			userId: w.user.id
		}).catch((e) => e)
		expect(gone.message).toBe(FOLD_REFUSALS.missing)
	})

	test("a guard that finds a difference rolls the whole fold back", async () => {
		const w = await world()
		const before = await everything(w)
		const memberAsRead = await import("$lib/server/cast/memberAsRead")
		const real = memberAsRead.membersAsRead
		let calls = 0
		const spy = vi
			.spyOn(memberAsRead, "membersAsRead")
			.mockImplementation(async (...args) => {
				const out = await real(...args)
				if (++calls < 2) return out
				for (const [id, m] of out)
					out.set(id, { ...m, name: `${m.name} (changed)` })
				return out
			})
		try {
			const { OwnBookRefusal } = await import("./ownBook")
			const err = await fold(w).catch((e) => e)
			expect(err).toBeInstanceOf(OwnBookRefusal)
			expect(err.message).toBe(
				FOLD_REFUSALS.readsDifferently(w.book.name)
			)
			expect(String(err.cause)).toMatch(/^seat character:\d+: name/)
		} finally {
			spy.mockRestore()
		}
		expect(await everything(w)).toEqual(before)
	})
})

describe("reseatOnto", () => {
	test("re-points the seats named in the moves and nothing else on a seat", async () => {
		const w = await world()
		const { reseatOnto } = await import("$lib/server/sessions/seats")
		const seatsBefore = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, w.session.id))
			.orderBy(asc(schema.sessionCharacters.id))
		const { moved } = await testDb.transaction((tx) =>
			reseatOnto(
				tx as unknown as Db,
				w.session.id,
				new Map([[w.m1.id, w.m2.id]])
			)
		)
		expect(moved).toBe(1)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, w.session.id))
			.orderBy(asc(schema.sessionCharacters.id))
		expect(seats.map((s) => s.castMemberId)).toEqual([w.m2.id, w.m2.id])
		expect(seats.map(({ castMemberId: _c, ...s }) => s)).toEqual(
			seatsBefore.map(({ castMemberId: _c, ...s }) => s)
		)
	})
})

// ── The notes' members, member overlays, riders, Back and Forward ───────────

async function slotValue(
	kind: string,
	ownerId: number,
	slotId: string,
	v: unknown,
	sessionId: number | null = null,
	extra: Record<string, unknown> = {}
) {
	const [row] = await testDb
		.insert(schema.attributeValues)
		.values({
			ownerKind: kind,
			ownerId,
			slotId,
			value: { v },
			sessionId,
			...extra
		} as any)
		.returning()
	return row!
}

const hpOf = (w: World, cardId: number) =>
	readOf(w.session.id, { kind: "session_cast", id: cardId }, HP)

/** A member overlay of `memberId` in the notes, with one dated version that changes the description. */
async function overlayOf(w: World, memberId: number, withCard = false) {
	const { member } = await insertCastMember(db(), {
		lorebookId: w.notes.id,
		binding: "{{char:1}}",
		name: "Anna",
		overlayOf: memberId,
		...(withCard ? { characterId: w.anna.id } : {})
	} as any)
	const [version] = await insertCharacterVersions(db(), [
		{
			castMemberId: member.id,
			lorebookId: w.notes.id,
			name: "Anna",
			description: "Changed by the session",
			year: 4,
			nodeState: "active",
			nodeVisibility: "normal",
			writtenBy: `run:${w.session.id}`,
			sourceSessionId: w.session.id
		} as any
	])
	return { member, version: version! }
}

/** A person as members read: the fields a prompt shows. */
async function personRead(sessionId: number, memberId: number) {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	const m = (await membersAsRead(db(), [memberId], { sessionId })).get(
		memberId
	)
	return (
		m && {
			name: m.name,
			shownName: m.shownName,
			description: m.description,
			summary: m.summary
		}
	)
}

describe("foldInParent: a notes member that holds the card a member of the book holds", () => {
	test("folds into the copy: its values on top, every reference on the copy, the notes member gone", async () => {
		const w = await world()
		const { member: n1 } = await insertCastMember(db(), {
			lorebookId: w.notes.id,
			binding: "{{char:1}}",
			name: "Anna (notes)",
			characterId: w.anna.id
		} as any)
		await slotValue("cast_member", w.m1.id, HP, 3)
		await slotValue("cast_member", n1.id, HP, 7)
		await slotValue("cast_member", n1.id, HP, 8, w.session.id)
		const nook = await place(w.notes.id, "Anna's nook", {
			position: 5,
			anchorBindingId: n1.id
		})
		await testDb.insert(schema.sceneCharacters).values({
			sceneId: w.scene.id,
			bindingId: n1.id,
			role: "witness"
		} as any)
		const [link] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.notes.id,
				fromNodeId: n1.id,
				toEntryId: w.square.id,
				relationshipType: "knows"
			} as any)
			.returning()
		const before = await reads(w.session.id)
		// The session read the book's value; the notes' values were never read, and sit on top after the fold.
		expect(await hpOf(w, w.anna.id)).toBe(3)

		await fold(w)

		const members = await membersIn(w.notes.id)
		expect(members.some((m) => m.id === n1.id)).toBe(false)
		const anna = members.find((m) => m.characterId === w.anna.id)!
		expect(anna.id).not.toBe(w.m1.id)
		expect(await reads(w.session.id)).toEqual(before)
		expect(await hpOf(w, w.anna.id)).toBe(8)
		const owned = (
			await testDb
				.select()
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "cast_member"),
						eq(schema.attributeValues.slotId, HP)
					)
				)
				.orderBy(asc(schema.attributeValues.id))
		).filter((r) => r.ownerId === anna.id || r.ownerId === n1.id)
		expect(owned.map((r) => [r.ownerId, (r.value as any).v])).toEqual([
			[anna.id, 3],
			[anna.id, 7],
			[anna.id, 8]
		])
		// No row names the notes member.
		const [anchored] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, nook.id))
		expect(anchored!.anchorBindingId).toBe(anna.id)
		const cast = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, w.scene.id))
		expect(cast.map((c) => [c.bindingId, c.role]).sort()).toEqual(
			[
				[anna.id, "participant"],
				[anna.id, "witness"]
			].sort()
		)
		const [edge] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, link!.id))
		expect(edge!.fromNodeId).toBe(anna.id)
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, w.session.id))
		expect(seats.some((s) => s.castMemberId === n1.id)).toBe(false)
		expect((await sessionRow(w.session.id)).annexAudiences).toEqual({
			"test:owner": { note: [`seated-member:${anna.id}`] }
		})
	})

	test("the notes member's tags in the notes' own text follow it to the copy; the book's text is untouched", async () => {
		const w = await world()
		const { member: n1 } = await insertCastMember(db(), {
			lorebookId: w.notes.id,
			binding: "{{char:1}}",
			name: "Anna (notes)",
			characterId: w.anna.id
		} as any)
		const { member: bob } = await insertCastMember(db(), {
			lorebookId: w.notes.id,
			binding: "{{char:2}}",
			name: "Bob"
		} as any)
		const wave = await place(w.notes.id, "Wave", {
			position: 9,
			content: "{{char:1}} waves at {{char:2}}"
		})
		const [bobVersion] = await insertCharacterVersions(db(), [
			{
				castMemberId: bob.id,
				lorebookId: w.notes.id,
				name: "Bob",
				description: "Bob owes {{char:1}} a favour",
				year: 4,
				nodeState: "active",
				nodeVisibility: "normal",
				writtenBy: `run:${w.session.id}`,
				sourceSessionId: w.session.id
			} as any
		])
		const bookBefore = await dump(w.book.id)

		await fold(w)

		const members = await membersIn(w.notes.id)
		const anna = members.find(
			(m) => m.characterId === w.anna.id && m.id !== n1.id
		)!
		const bobNow = members.find((m) => m.id === bob.id)!
		const annaNumber = Number(/\d+/.exec(anna.binding)![0])
		// The copy's number is fresh: neither the notes member's nor one the notes held.
		expect(annaNumber).not.toBe(1)
		expect(annaNumber).not.toBe(2)
		const [entry] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, wave.id))
		expect(entry!.content).toBe(
			`{{char:${annaNumber}}} waves at ${bobNow.binding}`
		)
		const [version] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, bobVersion!.id))
		expect(version!.description).toBe(
			`Bob owes {{char:${annaNumber}}} a favour`
		)
		// No row of the notes names the notes member's number any longer.
		const dumped = JSON.stringify(await dump(w.notes.id))
		expect(dumped).not.toContain("{{char:1}}")
		const after = await dump(w.book.id)
		expect(after).toEqual({
			...bookBefore,
			scenes: bookBefore.scenes!.filter((s) => s.id !== w.scene.id),
			scene_characters: bookBefore.scene_characters!.filter(
				(c) => c.sceneId !== w.scene.id
			)
		})
	})

	test("a second boot of the fold changes nothing: the fold is refused, nothing written", async () => {
		const w = await world()
		await insertCastMember(db(), {
			lorebookId: w.notes.id,
			binding: "{{char:1}}",
			name: "Anna (notes)",
			characterId: w.anna.id
		} as any)
		await fold(w)
		const after = await everything(w)
		const again = await fold(w).catch((e) => e)
		expect(again.message).toBe(FOLD_REFUSALS.alreadyOwn)
		expect(await everything(w)).toEqual(after)
	})
})

describe("foldInParent: a member overlay", () => {
	test("the session reads the same on the copy: the overlay's version and value carried, the overlay gone", async () => {
		const w = await world()
		const { member: ov, version } = await overlayOf(w, w.m1.id, true)
		await slotValue("cast_member", ov.id, HP, 5, w.session.id)
		const before = await reads(w.session.id)
		expect(before.members[0]!.description).toBe("Changed by the session")

		await fold(w)

		const after = await reads(w.session.id)
		expect(after).toEqual(before)
		const members = await membersIn(w.notes.id)
		expect(members.some((m) => m.id === ov.id)).toBe(false)
		const anna = members.find((m) => m.characterId === w.anna.id)!
		const carried = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, anna.id))
		const mine = carried.find(
			(v) => v.description === "Changed by the session"
		)!
		expect(mine.lorebookId).toBe(w.notes.id)
		expect(mine.branchId).toBeNull()
		expect(mine.id).not.toBe(version.id)
		// Fresh write order above every copied row's.
		for (const v of carried.filter((v) => v.id !== mine.id))
			expect(Number(mine.writeOrder)).toBeGreaterThan(
				Number(v.writeOrder)
			)
		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.slotId, HP)
				)
			)
		expect(
			values
				.filter((r) => r.ownerId === anna.id || r.ownerId === ov.id)
				.map((r) => r.ownerId)
		).toEqual([anna.id])
		expect(
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.id, version.id))
		).toHaveLength(0)
	})

	test("on a line with a clock, the carried version is filed on the session's line and still wins", async () => {
		const w = await world({ onNight: true })
		await overlayOf(w, w.m1.id)
		const before = await reads(w.session.id)
		expect(before.members[0]!.description).toBe("Changed by the session")
		await fold(w)
		expect(await reads(w.session.id)).toEqual(before)
		const session = await sessionRow(w.session.id)
		const anna = (await membersIn(w.notes.id)).find(
			(m) => m.characterId === w.anna.id
		)!
		const [mine] = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, anna.id))
		).filter((v) => v.description === "Changed by the session")
		expect(mine!.branchId).toBe(session.lorebookBranchId)
	})
})

describe("foldInParent: riders and other sessions", () => {
	test("a branch riding the notes reads the same after the fold; the overlay stays, its card released", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const { sessionEntriesAsRead } = await import("./ownBook")
		const w = await world()
		const { member: ov, version } = await overlayOf(w, w.m1.id, true)
		const [firstLine] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
			.orderBy(asc(schema.sessionMessages.id))
		const branch = await branchSession(db(), {
			sessionId: w.session.id,
			fromMessageId: firstLine!.id
		})
		const riderReads = async () => ({
			m1: await personRead(branch.id, w.m1.id),
			m2: await personRead(branch.id, w.m2.id),
			entries: (
				await sessionEntriesAsRead(db(), branch.id, "session", null)
			)
				.map((e) => `${e.typeId}:${e.name}`)
				.sort(),
			mood: await readOf(
				branch.id,
				{ kind: "session", id: branch.id },
				MOOD
			)
		})
		const before = await riderReads()
		expect(before.m1!.description).toBe("Changed by the session")

		await fold(w)

		expect(await riderReads()).toEqual(before)
		const [kept] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, ov.id))
		expect(kept!.characterId).toBeNull()
		expect(kept!.overlayOf).toBe(w.m1.id)
		expect(
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.id, version.id))
		).toHaveLength(1)
	})

	test("another session on the book reads the same, and the book is byte-identical but for this session's captures", async () => {
		const { ownBookFor } = await import("./ownBook")
		const w = await world()
		await overlayOf(w, w.m1.id, true)
		await insertCastMember(db(), {
			lorebookId: w.notes.id,
			binding: "{{char:2}}",
			name: "Anna (notes)",
			characterId: w.anna.id
		} as any).catch(() => {})
		await ownBookFor(testDb as any, w.other.id)
		const otherReads = async () => ({
			...(await reads(w.other.id)),
			m1: await personRead(w.other.id, w.m1.id),
			m2: await personRead(w.other.id, w.m2.id)
		})
		const before = await otherReads()
		const bookBefore = await dump(w.book.id)
		await fold(w)
		expect(await otherReads()).toEqual(before)
		const after = await dump(w.book.id)
		const captured = new Set([w.scene.id])
		expect(after).toEqual({
			...bookBefore,
			scenes: bookBefore.scenes!.filter((s) => !captured.has(s.id)),
			scene_characters: bookBefore.scene_characters!.filter(
				(c) => !captured.has(c.sceneId)
			)
		})
	})
})

describe("foldInParent: Back and Forward after the fold", () => {
	/** A turn written on: a person's line, a reply, a tied cast version and a tied value. */
	async function playTurn(w: World) {
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { writeCastVersion } = await import(
			"$lib/server/characters/versions"
		)
		const { setValue } = await import("$lib/server/state/write")
		await insertLegacy(db(), {
			sessionId: w.session.id,
			role: "user",
			userId: w.user.id,
			content: "Go on."
		} as any)
		const reply = await insertLegacy(db(), {
			sessionId: w.session.id,
			role: "assistant",
			content: "It rains."
		} as any)
		const { version } = await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: w.m1.id,
				changes: { summary: "Wrote at the turn." },
				writtenBy: `run:${w.session.id}`,
				session: { id: w.session.id }
			})
		)
		await setValue(
			db(),
			{
				sessionId: w.session.id,
				updatedBy: `user:${w.user.id}`,
				userId: w.user.id,
				messageId: reply.id
			},
			{
				owner: { kind: "session", id: w.session.id },
				slotId: MOOD,
				value: "drizzle"
			}
		)
		return { reply: reply.id, version }
	}

	const readsAndMood = async (w: World) => ({
		...(await reads(w.session.id)),
		mood: await readOf(
			w.session.id,
			{ kind: "session", id: w.session.id },
			MOOD
		)
	})

	test("Back takes the copies in the notes and leaves the book alone; Forward restores them; the reads match a session that never folded", async () => {
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const args = (w: World) => ({
			sessionId: w.session.id,
			userId: w.user.id
		})

		// The control: the same turn, never folded.
		const c = await world()
		await playTurn(c)
		const controlWritten = await readsAndMood(c)
		expect(await rewindTurn(db(), args(c))).toMatchObject({ ok: true })
		const controlBack = await readsAndMood(c)
		expect(await forwardTurn(db(), args(c))).toMatchObject({ ok: true })
		const controlForward = await readsAndMood(c)
		expect(controlForward).toEqual(controlWritten)
		// Back of the tied value: the notes' own world value, written before the fold, reads on top (the control reads the book's).

		const w = await world()
		const { reply, version } = await playTurn(w)
		await fold(w)
		expect(await readsAndMood(w)).toEqual(controlWritten)
		const copies = async () =>
			(
				await testDb
					.select()
					.from(schema.characterVersions)
					.where(eq(schema.characterVersions.sourceMessageId, reply))
			).filter((v) => v.lorebookId === w.notes.id)
		expect(await copies()).toHaveLength(1)
		const bookBefore = await dump(w.book.id)
		const originals = async () =>
			(
				await testDb
					.select()
					.from(schema.characterVersions)
					.where(eq(schema.characterVersions.id, version.id))
			).length

		for (let round = 0; round < 2; round++) {
			expect(await rewindTurn(db(), args(w))).toMatchObject({ ok: true })
			expect(await copies()).toHaveLength(0)
			expect(await readsAndMood(w)).toEqual({
				...controlBack,
				mood: "stormy"
			})
			expect(await dump(w.book.id)).toEqual(bookBefore)
			expect(await originals()).toBe(1)
			expect(await forwardTurn(db(), args(w))).toMatchObject({ ok: true })
			expect(await copies()).toHaveLength(1)
			expect(await readsAndMood(w)).toEqual(controlForward)
			expect(await dump(w.book.id)).toEqual(bookBefore)
		}
		await rewindTurn(db(), args(w))
		expect(await readsAndMood(w)).toEqual({
			...controlBack,
			mood: "stormy"
		})
	})
})

describe.skipIf(!process.env.FOLD_PERF)("foldInParent on a large book", () => {
	test("2,000 entries, 200 members of 5 versions, 1,000 links and 2,000 values fold into non-empty notes", async () => {
		const w = await world()
		const book = w.book.id
		const t0 = Date.now()
		await testDb.insert(schema.lorebookEntries).values(
			Array.from({ length: 2000 }, (_, i) => ({
				lorebookId: book,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: 100 + i,
				title: `Place ${i}`,
				content: `Place ${i} on {{char:1}}.`
			})) as any
		)
		const places = await entriesIn(book)
		const mine = places.filter((p) => p.title?.startsWith("Place "))
		for (let i = 0; i < 200; i++) {
			const { member } = await insertCastMember(db(), {
				lorebookId: book,
				binding: `{{char:${100 + i}}}`,
				name: `Person ${i}`
			} as any)
			await insertCharacterVersions(
				db(),
				Array.from({ length: 4 }, (_, v) => ({
					castMemberId: member.id,
					lorebookId: book,
					name: `Person ${i}`,
					description: `Version ${v}`,
					year: v + 1,
					nodeState: "active",
					nodeVisibility: "normal",
					writtenBy: "user"
				})) as any
			)
		}
		await testDb.insert(schema.narrativeRelationships).values(
			Array.from({ length: 1000 }, (_, i) => ({
				lorebookId: book,
				fromEntryId: mine[i]!.id,
				toEntryId: mine[i + 1]!.id,
				relationshipType: "leads to"
			})) as any
		)
		await testDb.insert(schema.attributeValues).values(
			Array.from({ length: 2000 }, (_, i) => ({
				ownerKind: "location",
				ownerId: mine[i]!.id,
				slotId: LAMPS,
				value: { v: i },
				sessionId: null
			})) as any
		)
		console.error(`fold perf: built the book in ${Date.now() - t0} ms`)
		const t1 = Date.now()
		await fold(w)
		console.error(`fold perf: folded in ${Date.now() - t1} ms`)
		expect((await sessionRow(w.session.id)).lorebookId).toBeNull()
	})
})

describe("foldInParent: branching a folded session carries its line", () => {
	const linesOf = (sessionId: number) =>
		testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
			.orderBy(asc(schema.sessionMessages.id))

	/** The entries a session reads, with their names as read (amendments applied). */
	async function entriesRead(sessionId: number) {
		const { sessionEntriesAsRead } = await import("./ownBook")
		return (await sessionEntriesAsRead(db(), sessionId, "session", null))
			.map((e: any) => `${e.typeId}:${e.name}`)
			.sort()
	}

	/** A folded session on Night: an amendment dated on the line, a version of Anna on the line, an entry anchored to its second line. */
	async function foldedOnNight() {
		const w = await world({ onNight: true })
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: w.book.id,
			entryId: w.market.id,
			branchId: w.night.id,
			year: 4,
			fields: { name: "Lanterns after dark" }
		} as any)
		await insertCharacterVersions(db(), [
			{
				castMemberId: w.m1.id,
				lorebookId: w.book.id,
				branchId: w.night.id,
				name: "Anna",
				description: "Anna by night",
				year: 5,
				nodeState: "active",
				nodeVisibility: "normal",
				writtenBy: "user"
			} as any
		])
		await fold(w)
		const session = await sessionRow(w.session.id)
		const [first, second] = await linesOf(w.session.id)
		const [late] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.notes.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: 50,
				title: "The late lamp",
				branchId: session.lorebookBranchId,
				sourceMessageId: second!.id
			} as any)
			.returning()
		return { w, session, first: first!, second: second!, late: late! }
	}

	test("a branch from the last message stands on its own copy of the line and reads what its parent reads", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { w, session, second } = await foldedOnNight()
		const parentEntries = await entriesRead(w.session.id)
		expect(
			parentEntries.some((e) => e.includes("Lanterns after dark"))
		).toBe(true)
		expect(parentEntries.some((e) => e.includes("The late lamp"))).toBe(
			true
		)

		const b = await branchSession(db(), {
			sessionId: w.session.id,
			fromMessageId: second.id
		})

		const row = await sessionRow(b.id)
		expect(row.lorebookId).toBeNull()
		expect(row.lineOnFirstWrite).toBe(false)
		const [own] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, b.id))
		expect(own!.id).not.toBe(w.notes.id)
		const [line] = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, row.lorebookBranchId!))
		expect(line!.lorebookId).toBe(own!.id)
		expect(line!.name).toBe("Night")
		expect(row.lorebookBranchId).not.toBe(session.lorebookBranchId)
		expect(await entriesRead(b.id)).toEqual(parentEntries)
		expect((await sessionReadingOf(db(), b.id))!.moment).toEqual(
			(await sessionReadingOf(db(), w.session.id))!.moment
		)
		// The amendment came across with its entry, on the copied line.
		const amended = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, own!.id))
		expect(amended.map((a) => a.branchId)).toEqual([line!.id])
	})

	test("an entry the parent wrote on the line after the fork stays behind", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const { w, first } = await foldedOnNight()
		const b = await branchSession(db(), {
			sessionId: w.session.id,
			fromMessageId: first.id
		})
		expect(
			(await entriesRead(w.session.id)).some((e) =>
				e.includes("The late lamp")
			)
		).toBe(true)
		const rest = await entriesRead(b.id)
		expect(rest.some((e) => e.includes("The late lamp"))).toBe(false)
		expect(rest.some((e) => e.includes("Lanterns after dark"))).toBe(true)
	})

	test(
		"a branch reads the people its parent reads on the line",
		async () => {
			const { branchSession } = await import(
				"$lib/server/sessions/branch"
			)
			const { w, second } = await foldedOnNight()
			const b = await branchSession(db(), {
				sessionId: w.session.id,
				fromMessageId: second.id
			})
			const anna = (await membersIn(w.notes.id)).find(
				(m) => m.characterId === w.anna.id
			)!
			expect((await personRead(w.session.id, anna.id))!.description).toBe(
				"Anna by night"
			)
			expect(await personRead(b.id, anna.id)).toEqual(
				await personRead(w.session.id, anna.id)
			)
			expect((await reads(b.id)).members).toEqual(
				(await reads(w.session.id)).members
			)
		}
	)

	test("a branch of a session on its notes' main stands on main, with the entries it read", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const w = await world()
		await fold(w)
		const [first] = await linesOf(w.session.id)
		const parentEntries = await entriesRead(w.session.id)
		const b = await branchSession(db(), {
			sessionId: w.session.id,
			fromMessageId: first!.id
		})
		const row = await sessionRow(b.id)
		expect(row.lorebookBranchId).toBeNull()
		expect(row.lineOnFirstWrite).toBe(false)
		expect(await entriesRead(b.id)).toEqual(parentEntries)
	})
})

describe("foldInParent: a branch whose ancestor holds an overlay of a member of the book", () => {
	test("folds, the ancestor's overlay carried onto the copy and itself untouched", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const w = await world()
		const { member: ov } = await overlayOf(w, w.m1.id, true)
		const [first] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, w.session.id))
			.orderBy(asc(schema.sessionMessages.id))
		const b = await branchSession(db(), {
			sessionId: w.session.id,
			fromMessageId: first!.id
		})
		const ancestorRows = async () => ({
			member: (await membersIn(w.notes.id)).find((m) => m.id === ov.id),
			versions: await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, ov.id))
				.orderBy(asc(schema.characterVersions.id))
		})
		const readsOf = async (id: number) => ({
			...(await reads(id)),
			m1: await personRead(id, w.m1.id)
		})
		const before = await readsOf(b.id)
		const parentBefore = await readsOf(w.session.id)
		const overlayBefore = await ancestorRows()
		expect(before.m1!.description).toBe("Changed by the session")
		expect(overlayBefore.versions.length).toBeGreaterThan(0)

		const done = await (async () => {
			const { foldInParent } = await import("./foldInParent")
			return foldInParent(db(), { sessionId: b.id, userId: w.user.id })
		})()

		expect(done.foldedFrom.id).toBe(w.book.id)
		expect(await reads(b.id)).toEqual({
			entries: before.entries,
			members: before.members
		})
		const anna = (await membersIn(done.lorebookId)).find(
			(m) => m.characterId === w.anna.id
		)!
		expect(await personRead(b.id, anna.id)).toEqual(before.m1)
		expect(await ancestorRows()).toEqual(overlayBefore)
		expect(await readsOf(w.session.id)).toEqual(parentBefore)
		// The carried row is the branch's own: its source is the branch, nothing anchors it.
		const carried = (
			await testDb
				.select()
				.from(schema.characterVersions)
				.where(eq(schema.characterVersions.castMemberId, anna.id))
		).filter((v) => v.description === "Changed by the session")
		expect(carried).toHaveLength(1)
		expect(carried[0]!.sourceSessionId).toBe(b.id)
		expect(carried[0]!.sourceMessageId).toBeNull()
		expect(carried[0]!.validFromMessageId).toBeNull()

		await expect(
			(async () => {
				const { foldInParent } = await import("./foldInParent")
				return foldInParent(db(), {
					sessionId: b.id,
					userId: w.user.id
				})
			})()
		).rejects.toThrow(FOLD_REFUSALS.alreadyOwn)
	})
})
