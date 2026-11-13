/**
 * 🚧 Surfaced books (owner ★B-3, 2026-11-08): **Share as a lorebook** stamps
 * the book with the session it came from, and `surfacedBookRefusal` refuses a
 * plain read of it by anyone else — but not a next chapter, nor a copy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { SURFACED_BOOK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-surfaced-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `surfaced-${++n}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${n}` })
		.returning()
	return { user, session: session! }
}

describe("surfaced books", () => {
	test("Share as a lorebook stamps the book with its session; an ordinary book has no stamp", async () => {
		const w = await world()
		const { ownBookFor, shareAsLorebook } = await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		expect(notes.surfacedFromSessionId).toBeNull()
		const shared = await shareAsLorebook(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(shared.lorebookId).toBe(notes.id)
		const [book] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, notes.id))
		expect(book!.surfacedFromSessionId).toBe(w.session.id)
		// The fresh notes the session gets are not surfaced.
		const [fresh] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, shared.ownBookId))
		expect(fresh!.surfacedFromSessionId).toBeNull()
	})

	test("surfacedBookRefusal: null for the owner; the sentence for another user's plain read; null for an ordinary book, a next chapter and a copy", async () => {
		const w = await world()
		const { ownBookFor, shareAsLorebook, surfacedBookRefusal } =
			await import("./ownBook")
		const notes = await ownBookFor(testDb as any, w.session.id)
		const [ordinary] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Ordinary" })
			.returning()
		await shareAsLorebook(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id
		})
		const db = testDb as any
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: ordinary!.id,
				creationMode: "new",
				userId: w.user.id
			})
		).toBeNull()
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: notes.id,
				creationMode: "next-chapter",
				userId: w.user.id + 1
			})
		).toBeNull()
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: notes.id,
				creationMode: "new-world",
				userId: w.user.id + 1
			})
		).toBeNull()
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: notes.id,
				creationMode: "new",
				userId: w.user.id
			})
		).toBeNull()
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: notes.id,
				creationMode: "new",
				userId: w.user.id + 1
			})
		).toBe(SURFACED_BOOK_REFUSAL)
		// The session going makes the book ordinary.
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(
			await surfacedBookRefusal(db, {
				lorebookId: notes.id,
				creationMode: "new",
				userId: w.user.id + 1
			})
		).toBeNull()
	})
})
