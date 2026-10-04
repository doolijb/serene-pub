/**
 * A recording's refused values reach the person who caused it (plan A18,
 * Wave 4 leftover).
 *
 * Recording a session onto the world's timeline (`recordToTimeline`) writes
 * each value through the book's own door, and a value the book will not take
 * — a story time its calendar cannot place — is left out and named in the
 * report's `refused`. Nobody read that list: the scene save and the session
 * delete that record a session both threw the report away. Their replies now
 * carry it (`notRecorded`), each sentence naming whose value it was.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import { defineAttributeSlot, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (orig) => ({
	...(await orig<any>()),
	broadcastToSessionUsers: vi.fn(async () => {})
}))
vi.mock("$lib/server/sessions/rowPush", async (orig) => ({
	...(await orig<any>()),
	broadcastSessionRow: vi.fn(() => {})
}))
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (orig) => ({
	...(await orig<any>()),
	emitSessionEvent: vi.fn(async () => {})
}))

const BORN = "test:slot/recording-born@1"
const GENRE = "test:genre/recording-refusals"

/** Three months: Thaw 30, Bloom 31, Ember 28. */
const THAW: StoryCalendar = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 },
		{ name: "Ember", days: 28 }
	],
	weekdays: ["Moonday", "Ashday", "Restday"],
	firstWeekday: 0,
	yearLabel: "Year"
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-recording-refusals-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const born = defineAttributeSlot(BORN, {
		shape: "core:stat-shape/story-time@1",
		descriptor: "When they were born.",
		appliesTo: ["cast", "world", "location"]
	})
	genre(GENRE, { name: { en: "Born" }, family: "test", slots: [born], events: {} })
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) =>
	({
		user: { id: userId },
		io: { to: () => ({ emit() {} }) },
		emit() {},
		join() {},
		rooms: new Set()
	}) as any
const noop = () => {}

let n = 0
/**
 * A Full-mode book with a calendar, a session on it seating Verity, and a
 * birth date on her CARD the calendar cannot place (Ember has no day 30 —
 * the card's layer is shared between books, so no calendar checked it).
 */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `recording-refusals-${++n}`)
	await testDb.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Ashfall ${n}`, userId: user.id, storyCalendar: THAW })
		.returning()
	const [verity] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "…" })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: "Run", genreId: GENRE, lorebookId: book!.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({ sessionId: session!.id, characterId: verity!.id })
	await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, characterId: verity!.id, binding: "{{char:1}}", name: "Verity" })
	await testDb
		.insert(schema.attributeValues)
		.values({ ownerKind: "card", ownerId: verity!.id, slotId: BORN, value: { v: "3-03-30" } })
	return { user, book: book!, session: session! }
}

describe("the values a recording refuses are said to whoever recorded", () => {
	test("a scene saved from the session says which values it could not record, and whose", async () => {
		const w = await world()
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				title: "Year 3",
				content: "",
				keys: [],
				position: 1,
				fields: { year: 3 }
			} as any)
			.returning()
		const { sceneCreateHandler } = await import("./scenes")
		const res: any = await sceneCreateHandler.handler(
			socketOf(w.user.id),
			{
				scene: {
					lorebookId: w.book.id,
					sessionId: w.session.id,
					historyEntryId: entry!.id,
					summary: "What happened."
				}
			} as any,
			noop
		)
		expect(res.scene.id).toBeGreaterThan(0)
		expect(res.notRecorded).toEqual([
			expect.stringMatching(/^Verity · .*does not fit this book's calendar/)
		])
	})

	test("a session deleted says which values its last recording could not keep", async () => {
		const w = await world()
		const { sessionsDeleteHandler } = await import("./sessions")
		const res: any = await sessionsDeleteHandler.handler(
			socketOf(w.user.id),
			{ id: w.session.id },
			noop
		)
		expect(res.id).toBe(w.session.id)
		expect(res.notRecorded).toEqual([
			expect.stringMatching(/^Verity · .*does not fit this book's calendar/)
		])
	})
})
