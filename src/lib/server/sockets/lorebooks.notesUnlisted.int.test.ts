/**
 * A session's notes are never a lorebook in the lists that name lorebooks:
 * `lorebooks:sessionNotes` sends every row with `notesWritten`, and
 * `lorebooks:bindingsForCharacter` keeps notes out of the export candidates
 * but keeps them as members, named by the session's current name.
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
	insertSessionCharacterRow,
	insertWorldLoreEntryRow
} from "$lib/server/pipelines/testing/fixtures"

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
		path.join(os.tmpdir(), "serene-pub-vitest-notes-unlisted-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}${++n}`

async function mkUser() {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: uniq("notes-unlisted-user-") })
		.returning()
	return u!
}

async function mkNotesSession(userId: number) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Tale ") } as any)
		.returning()
	const [notes] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("stored "), sessionId: session!.id })
		.returning()
	return { session: session!, notes: notes! }
}

const socketOf = (userId: number) =>
	({ id: `s-${userId}`, user: { id: userId, isAdmin: false } }) as never

describe("lorebooks:sessionNotes", () => {
	test("every row is sent; notesWritten tells written from unwritten; the session name is current", async () => {
		const user = await mkUser()
		const empty = await mkNotesSession(user.id)
		const filled = await mkNotesSession(user.id)
		await insertWorldLoreEntryRow(testDb, filled.notes.id)
		await testDb
			.update(schema.sessions)
			.set({ name: "Renamed tale" })
			.where(eq(schema.sessions.id, filled.session.id))

		const { lorebooksSessionNotesHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await (lorebooksSessionNotesHandler as any).handler(
			socketOf(user.id),
			{},
			async () => {}
		)
		const byId = new Map(res.books.map((b: any) => [b.id, b]))
		expect((byId.get(empty.notes.id) as any).notesWritten).toBe(false)
		expect((byId.get(filled.notes.id) as any).notesWritten).toBe(true)
		expect((byId.get(filled.notes.id) as any).sessionName).toBe(
			"Renamed tale"
		)
	})

	test("every row names its session in sessionId and readBy, as the page reads them", async () => {
		const user = await mkUser()
		const { session, notes } = await mkNotesSession(user.id)
		const { lorebooksSessionNotesHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await (lorebooksSessionNotesHandler as any).handler(
			socketOf(user.id),
			{},
			async () => {}
		)
		const row = res.books.find((b: any) => b.id === notes.id)
		expect(row.sessionId).toBe(session.id)
		expect(row.readBy).toEqual([{ id: session.id, name: session.name }])
	})
})

describe("lorebooks:bindingsForCharacter", () => {
	test("notes are not export candidates but stay as members, named by the session now", async () => {
		const user = await mkUser()
		const { session, notes } = await mkNotesSession(user.id)
		const { card } = await insertCard(testDb as unknown as Db, {
			userId: user.id,
			name: uniq("Maren "),
			description: "A person."
		})
		const [real] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Real book" })
			.returning()
		const inNotes = (
			await insertCastMember(testDb as unknown as Db, {
				lorebookId: notes.id,
				characterId: card.id,
				binding: "{{char:1}}",
				name: card.name
			})
		).member
		const inReal = (
			await insertCastMember(testDb as unknown as Db, {
				lorebookId: real!.id,
				characterId: card.id,
				binding: "{{char:1}}",
				name: card.name
			})
		).member
		await insertSessionCharacterRow(testDb, session.id, card.id, {
			castMemberId: inNotes.id
		})
		await testDb
			.update(schema.sessions)
			.set({ name: "Renamed tale" })
			.where(eq(schema.sessions.id, session.id))

		const { lorebookBindingsForCharacterHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await (lorebookBindingsForCharacterHandler as any).handler(
			socketOf(user.id),
			{ characterId: card.id },
			async () => {}
		)
		expect(res.lorebooks).toEqual([{ id: real!.id, name: "Real book" }])
		const members = new Map(res.members.map((m: any) => [m.castId, m]))
		expect(res.members).toHaveLength(2)
		expect(members.get(inNotes.id)).toMatchObject({
			lorebookId: notes.id,
			lorebookName: "Renamed tale's notes",
			ownBookSessionId: session.id
		})
		expect(members.get(inReal.id)).toMatchObject({
			lorebookId: real!.id,
			lorebookName: "Real book",
			ownBookSessionId: null
		})
	})
})
