/**
 * Edit Session never puts back an author's note saved from its widget
 * (owner ruling 2026-10-03). The form sends only the genre fields the person
 * changed there; `sessions:update` merges them over what is stored; and every
 * write that moves the stored fields pushes `sessions:genreFieldsChanged`, so
 * an open form can follow the fields nobody touched in it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CHAT_GENRE_ID } from "@serene-pub/core-catalog"
import { changedGenreFields } from "$lib/client/components/sessionForms/genreFieldsPatch"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-genre-fields-merge-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const NOTE_LOADED = { text: "It is raining.", depth: 4, interval: 1, role: "system" }
const NOTE_FROM_WIDGET = { text: "The storm has passed.", depth: 2, interval: 1, role: "system" }

async function makeOwner(username: string) {
	const [user] = await testDb.insert(schema.users).values({ username }).returning()
	return user
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } } as any
}

async function chatSession(userId: number, genreFields: Record<string, unknown>) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: CHAT_GENRE_ID, genreFields } as any)
		.returning()
	return row
}

async function storedFields(sessionId: number) {
	const [row] = await testDb
		.select({ genreFields: schema.sessions.genreFields })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return (row.genreFields ?? {}) as Record<string, unknown>
}

describe("Edit Session and the Author's note widget (2026-10-03)", () => {
	test("widget saves the note, then the form saves without touching it — the note is kept", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const { sessionsSetAuthorsNote } = await import("./authorsNote")
		const owner = await makeOwner("gf-merge-owner-1")
		const loaded = { authorsNote: NOTE_LOADED, characterDetail: "full" }
		const s = await chatSession(owner.id, loaded)

		// The form opens: it holds what was loaded.
		const formFields = JSON.parse(JSON.stringify(loaded))

		// The widget saves a newer note while the form is open.
		const widgetEmits: Array<[string, any]> = []
		await sessionsSetAuthorsNote.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, note: NOTE_FROM_WIDGET } as any,
			(e: string, d: any) => widgetEmits.push([e, d])
		)
		expect((await storedFields(s.id)).authorsNote).toEqual(NOTE_FROM_WIDGET)
		const pushed = widgetEmits.find(([e]) => e === "sessions:genreFieldsChanged")
		expect(pushed?.[1]).toEqual({
			sessionId: s.id,
			genreFields: { authorsNote: NOTE_FROM_WIDGET, characterDetail: "full" }
		})

		// The person changes another field and saves; the note is untouched.
		formFields.characterDetail = "brief"
		const patch = changedGenreFields(formFields, loaded)
		expect(patch).toEqual({ characterDetail: "brief" })
		const formEmits: Array<[string, any]> = []
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: s.id, name: "Renamed", genreFields: patch } } as any,
			(e: string, d: any) => formEmits.push([e, d])
		)

		expect(await storedFields(s.id)).toEqual({
			authorsNote: NOTE_FROM_WIDGET,
			characterDetail: "brief"
		})
		expect(formEmits.find(([e]) => e === "sessions:genreFieldsChanged")?.[1]).toEqual({
			sessionId: s.id,
			genreFields: { authorsNote: NOTE_FROM_WIDGET, characterDetail: "brief" }
		})
	}, 60_000)

	test("a form save that changed no genre field sends none, and nothing moves or is pushed", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeOwner("gf-merge-owner-2")
		const loaded = { authorsNote: NOTE_LOADED }
		const s = await chatSession(owner.id, loaded)
		expect(changedGenreFields(JSON.parse(JSON.stringify(loaded)), loaded)).toBeUndefined()

		const emits: Array<[string, any]> = []
		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{ session: { id: s.id, name: "Only the name" } } as any,
			(e: string, d: any) => emits.push([e, d])
		)
		expect(await storedFields(s.id)).toEqual(loaded)
		expect(emits.some(([e]) => e === "sessions:genreFieldsChanged")).toBe(false)
	}, 60_000)

	test("sessions:update merges a partial genreFields over the stored ones (undeclared keys still dropped)", async () => {
		const { sessionsUpdateHandler } = await import("./sessions")
		const owner = await makeOwner("gf-merge-owner-3")
		const s = await chatSession(owner.id, { authorsNote: NOTE_LOADED, characterDetail: "full" })

		await sessionsUpdateHandler.handler(
			fakeSocket(owner.id),
			{
				session: { id: s.id, genreFields: { characterDetail: "speaker-only", notAField: 1 } }
			} as any,
			() => {}
		)
		expect(await storedFields(s.id)).toEqual({
			authorsNote: NOTE_LOADED,
			characterDetail: "speaker-only"
		})
	}, 60_000)

	test("a widget save of the note already stored moves nothing and pushes nothing", async () => {
		const { sessionsSetAuthorsNote } = await import("./authorsNote")
		const owner = await makeOwner("gf-merge-owner-4")
		const s = await chatSession(owner.id, { authorsNote: NOTE_LOADED })
		const emits: Array<[string, any]> = []
		await sessionsSetAuthorsNote.handler(
			fakeSocket(owner.id),
			{ sessionId: s.id, note: NOTE_LOADED } as any,
			(e: string, d: any) => emits.push([e, d])
		)
		expect(emits.some(([e]) => e === "sessions:genreFieldsChanged")).toBe(false)
		expect(emits.find(([e]) => e === "sessions:setAuthorsNote")?.[1].note.note).toEqual(NOTE_LOADED)
	}, 60_000)
})
