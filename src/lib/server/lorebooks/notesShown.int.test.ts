/**
 * `notesShown`: a session's notes are named by the session's current name and
 * are listed unless empty — empty meaning nothing beyond seated characters'
 * members' base versions.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import {
	insertHistoryEntryRow,
	insertSessionCharacterRow,
	insertWorldLoreEntryRow,
	insertNarrativeRelationshipRow
} from "$lib/server/pipelines/testing/fixtures"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { activityStore } from "$lib/server/utils/activityStore"
import { tellIndexingActivity } from "$lib/server/embedding/indexingActivity"
import { castLiftNotes } from "$lib/server/admin/castLiftNotes"
import { bookShownName, bookShownNames, writtenNotesOf } from "./notesShown"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-notes-shown-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}${++n}`

async function mkUser() {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: uniq("notes-shown-user-") })
		.returning()
	return u!
}

/** A notes-only session (no attached lorebook) with its notes and one seated character. */
async function notesWithSeat() {
	const user = await mkUser()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: uniq("Tale ") } as any)
		.returning()
	const [notes] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: uniq("stored notes name "),
			sessionId: session!.id
		})
		.returning()
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: uniq("Seated "),
		description: "A person."
	})
	const { member } = await insertCastMember(db(), {
		lorebookId: notes!.id,
		characterId: card.id,
		binding: "{{char:1}}",
		name: card.name
	})
	await insertSessionCharacterRow(testDb, session!.id, card.id, {
		castMemberId: member.id
	})
	return { user, session: session!, notes: notes!, member }
}

const written = async (id: number) => (await writtenNotesOf(db(), [id])).has(id)

describe("writtenNotesOf", () => {
	test("no ids is an empty set", async () => {
		expect((await writtenNotesOf(db(), [])).size).toBe(0)
	})

	test("notes holding only seated characters' members are unwritten", async () => {
		const { notes } = await notesWithSeat()
		expect(await written(notes.id)).toBe(false)
	})

	test("an entry makes them written", async () => {
		const { notes } = await notesWithSeat()
		await insertWorldLoreEntryRow(testDb, notes.id)
		expect(await written(notes.id)).toBe(true)
	})

	test("a place makes them written", async () => {
		const { notes } = await notesWithSeat()
		const entry = await insertWorldLoreEntryRow(testDb, notes.id)
		await testDb
			.update(schema.lorebookEntries)
			.set({ typeId: LOCATION_TYPE_ID })
			.where(eq(schema.lorebookEntries.id, entry.id))
		expect(await written(notes.id)).toBe(true)
	})

	test("a history day makes them written", async () => {
		const { notes } = await notesWithSeat()
		await insertHistoryEntryRow(testDb, notes.id, { year: 1 } as any)
		expect(await written(notes.id)).toBe(true)
	})

	test("a scene with a summary makes them written", async () => {
		const { notes, session } = await notesWithSeat()
		await testDb.insert(schema.scenes).values({
			sessionId: session.id,
			lorebookId: notes.id,
			summary: "They met."
		} as any)
		expect(await written(notes.id)).toBe(true)
	})

	test("a held change makes them written", async () => {
		const { notes, user } = await notesWithSeat()
		// The changed entry is a real book's; the held change is filed in the notes.
		const [real] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: uniq("Real ") })
			.returning()
		const entry = await insertWorldLoreEntryRow(testDb, real!.id)
		expect(await written(notes.id)).toBe(false)
		await testDb.insert(schema.entryAmendments).values({
			lorebookId: notes.id,
			entryId: entry.id,
			base: { name: { v: "x" } },
			fields: { name: "y" }
		} as any)
		expect(await written(notes.id)).toBe(true)
	})

	test("a link makes them written", async () => {
		const { notes, session, user, member: first } = await notesWithSeat()
		const { card } = await insertCard(db(), {
			userId: user.id,
			name: uniq("Second "),
			description: "Another."
		})
		const { member: second } = await insertCastMember(db(), {
			lorebookId: notes.id,
			characterId: card.id,
			binding: "{{char:2}}",
			name: card.name
		})
		await insertSessionCharacterRow(testDb, session.id, card.id, {
			castMemberId: second.id
		})
		expect(await written(notes.id)).toBe(false)
		await insertNarrativeRelationshipRow(
			testDb,
			notes.id,
			first.id,
			second.id,
			{
				relationshipType: "knows"
			} as any
		)
		expect(await written(notes.id)).toBe(true)
	})

	test("a set clock makes them written", async () => {
		const { notes } = await notesWithSeat()
		await testDb
			.update(schema.lorebooks)
			.set({
				storyClockYear: 3,
				storyClockMonth: 1,
				storyClockDay: 1,
				storyClockHour: 0,
				storyClockMinute: 0
			} as any)
			.where(eq(schema.lorebooks.id, notes.id))
		expect(await written(notes.id)).toBe(true)
	})

	test("a cast member no seat points at makes them written", async () => {
		const { notes } = await notesWithSeat()
		await insertCastMember(db(), {
			lorebookId: notes.id,
			characterId: null,
			binding: "{{char:9}}",
			name: "Stranger"
		})
		expect(await written(notes.id)).toBe(true)
	})

	test("a dated version of a seated member makes them written", async () => {
		const { notes, member } = await notesWithSeat()
		await testDb
			.update(schema.characterVersions)
			.set({ year: 5, month: 1, day: 1 })
			.where(eq(schema.characterVersions.castMemberId, member.id))
		expect(await written(notes.id)).toBe(true)
	})

	test("answers many books in one call, each by its own state", async () => {
		const a = await notesWithSeat()
		const b = await notesWithSeat()
		await insertWorldLoreEntryRow(testDb, b.notes.id)
		const set = await writtenNotesOf(db(), [a.notes.id, b.notes.id])
		expect(set.has(a.notes.id)).toBe(false)
		expect(set.has(b.notes.id)).toBe(true)
	})
})

describe("bookShownName", () => {
	test("notes are named by the session's current name, never the stored name", async () => {
		const { notes, session } = await notesWithSeat()
		await testDb
			.update(schema.sessions)
			.set({ name: "Renamed" })
			.where(eq(schema.sessions.id, session.id))
		expect(await bookShownName(db(), notes)).toBe("Renamed's notes")
		const names = await bookShownNames(db(), [notes])
		expect(names.get(notes.id)).toBe("Renamed's notes")
	})

	test("a real book and a surfaced book keep their own name", async () => {
		const user = await mkUser()
		const [real] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "My book" })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, name: "Gone" } as any)
			.returning()
		const [surfaced] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: user.id,
				name: "Surfaced one",
				surfacedFromSessionId: session!.id
			} as any)
			.returning()
		expect(await bookShownName(db(), real!)).toBe("My book")
		expect(await bookShownName(db(), surfaced!)).toBe("Surfaced one")
		const names = await bookShownNames(db(), [real!, surfaced!])
		expect(names.get(real!.id)).toBe("My book")
		expect(names.get(surfaced!.id)).toBe("Surfaced one")
	})

	test("an unnamed session's notes read Session notes", async () => {
		const { notes, session } = await notesWithSeat()
		await testDb
			.update(schema.sessions)
			.set({ name: null })
			.where(eq(schema.sessions.id, session.id))
		expect(await bookShownName(db(), notes)).toBe("Session notes")
	})
})

describe("names in Activity and the admin list", () => {
	test("an indexing activity for notes is named by the session's new name", async () => {
		const { notes, session } = await notesWithSeat()
		await insertWorldLoreEntryRow(testDb, notes.id)
		await testDb
			.update(schema.sessions)
			.set({ name: "Brand new" })
			.where(eq(schema.sessions.id, session.id))
		await tellIndexingActivity(db(), "vectorization:itemUpdated", {
			type: "worldLore",
			id: 1,
			lorebookId: notes.id,
			embeddingModel: "m",
			vectorizedAt: new Date().toISOString()
		})
		const mine = activityStore
			.getFor(notes.userId!, false)
			.filter((a) => a.kind === "lorebook_indexing") as any[]
		expect(mine.find((a) => a.lorebookId === notes.id)?.lorebookLabel).toBe(
			"Brand new's notes"
		)
		activityStore.endAllLorebookIndexing()
	})

	test("the lift-note list names notes by the session's new name", async () => {
		const { notes, session, member } = await notesWithSeat()
		await testDb
			.update(schema.characterVersions)
			.set({
				note: JSON.stringify({
					v: 1,
					differences: [],
					mixedGreetings: true
				})
			})
			.where(eq(schema.characterVersions.castMemberId, member.id))
		await testDb
			.update(schema.sessions)
			.set({ name: "Lifted tale" })
			.where(eq(schema.sessions.id, session.id))
		const list = await castLiftNotes(db())
		expect(
			list.members.find((m) => m.lorebookId === notes.id)?.lorebookName
		).toBe("Lifted tale's notes")
	})
})
