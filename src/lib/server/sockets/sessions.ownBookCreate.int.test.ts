/**
 * Every session owns a book from its birth (pr-6, B §B-3, pass 11): the one
 * `sessions:create` makes, with or without a shared lorebook and of any genre
 * (R-g: Guide gets one like the rest), born Gregorian with its clock unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-own-book-create-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The genres a session can be made of are the registered ones.
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any
const noEmit = () => {}

let seq = 0

async function makeUser() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `own-book-create-${++seq}` })
		.returning()
	return user!
}

async function ownBookRow(sessionId: number) {
	const [book] = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	return book
}

async function expectBorn(sessionId: number, userId: number, overlayOf: number | null) {
	const { OWN_BOOK_CALENDAR } = await import("$lib/server/lorebooks/ownBook")
	const book = await ownBookRow(sessionId)
	expect(book).toBeTruthy()
	expect(book).toMatchObject({
		userId,
		kind: "book",
		overlayOf,
		storyClockYear: null,
		storyClockMonth: null,
		storyClockDay: null,
		storyClockHour: null,
		storyClockMinute: null
	})
	expect(book!.storyCalendar).toEqual(OWN_BOOK_CALENDAR)
}

describe("sessions:create gives the session its own book", () => {
	test("with no lorebook", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser()
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{ session: { name: "Alone" }, characterIds: [], personaIds: [] } as any,
			noEmit
		)
		await expectBorn(created.session.id, user.id, null)
		expect((await ownBookRow(created.session.id))!.name).toBe("Alone")
	}, 60_000)

	test("with a lorebook, the own book overlays it", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser()
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Shared world" })
			.returning()
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{ session: { name: "Together", lorebookId: shared!.id }, characterIds: [], personaIds: [] } as any,
			noEmit
		)
		await expectBorn(created.session.id, user.id, shared!.id)
	}, 60_000)

	test("a Guide-genre session too", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const user = await makeUser()
		const created: any = await sessionsCreateHandler.handler(
			fakeSocket(user.id),
			{
				session: { name: "Guided", genreId: "core:genre/guide" },
				characterIds: [],
				personaIds: []
			} as any,
			noEmit
		)
		expect(created.error ?? null).toBeNull()
		await expectBorn(created.session.id, user.id, null)
	}, 60_000)
})
