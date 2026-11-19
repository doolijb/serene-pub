/**
 * D50 (owner, 2026-11-16): a lorebook a session plays on is not deleted; the
 * refusal names the asker's sessions and counts everyone else's.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { bookDeleteSentence } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-book-delete-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db
const socket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: {
			to: () => ({ emit: () => {} }),
			in: () => ({ fetchSockets: async () => [] })
		}
	}) as any

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `book-delete-${++n}`)
}
async function book(userId: number, name: string) {
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name })
		.returning()
	return b!
}
/** A session of `userId` on `bookId`, with its own notes overlaying the book. */
async function play(userId: number, bookId: number, name: string) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name, lorebookId: bookId })
		.returning()
	const [notes] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId,
			name: `Notes ${name}`,
			sessionId: s!.id,
			overlayOf: bookId
		})
		.returning()
	return { session: s!, notes: notes! }
}
async function del(userId: number, id: number) {
	const { lorebooksDeleteHandler } = await import(
		"$lib/server/sockets/lorebooks"
	)
	const events: { event: string; payload: any }[] = []
	await (lorebooksDeleteHandler as any)
		.handler(socket(userId), { id }, (event: string, payload: any) =>
			events.push({ event, payload })
		)
		.catch(() => {}) // refusable emits :error, then rethrows
	return events
}
const bookRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, id))
	)[0]

describe("lorebooks:delete refuses a book a session plays on", () => {
	test("refused with the sentence naming the session; book, link and notes stay", async () => {
		const u = await user()
		const b = await book(u.id, "Saltmarsh")
		const p = await play(u.id, b.id, "Fog run")
		const events = await del(u.id, b.id)
		const err = events.find((e) => e.event === "lorebooks:delete:error")
		expect(err?.payload.error).toBe(
			bookDeleteSentence("Saltmarsh", {
				named: [{ id: p.session.id, name: "Fog run" }],
				others: 0
			})
		)
		expect(err?.payload.error).toContain("Fog run")
		expect(events.some((e) => e.event === "lorebooks:delete")).toBe(false)
		expect(await bookRow(b.id)).toBeTruthy()
		const [s] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, p.session.id))
		expect(s!.lorebookId).toBe(b.id)
		const notes = await testDb
			.select()
			.from(schema.lorebooks)
			.where(
				and(
					eq(schema.lorebooks.sessionId, p.session.id),
					eq(schema.lorebooks.overlayOf, b.id)
				)
			)
		expect(notes).toHaveLength(1)
	})

	test("more than five own sessions say 'and n more'; another person's are counted, never named", async () => {
		const u = await user()
		const other = await user()
		const b = await book(u.id, "Crowded")
		for (let i = 0; i < 7; i++) await play(u.id, b.id, `Mine ${i}`)
		await testDb.insert(schema.sessions).values({
			userId: other.id,
			isGroup: false,
			name: "Secret run",
			lorebookId: b.id
		})
		const events = await del(u.id, b.id)
		const msg = events.find((e) => e.event === "lorebooks:delete:error")!
			.payload.error as string
		expect(msg).toMatch(/and 2 more/)
		expect(msg).not.toMatch(/another person/i)
		expect(msg).not.toContain("Secret run")
		expect(await bookRow(b.id)).toBeTruthy()
	})

	test("a branch that reads notes kept past their session counts as playing", async () => {
		const u = await user()
		const b = await book(u.id, "Kept")
		const p = await play(u.id, b.id, "Parent")
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: null })
			.where(eq(schema.sessions.id, p.session.id))
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, p.session.id))
		const [branch] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				name: "Branch",
				branchAncestry: [{ sessionId: p.session.id, mark: 0 }]
			} as any)
			.returning()
		const refusal = await (
			await import("./bookLock")
		).bookDeleteRefusal(db(), b.id, u.id)
		expect(refusal).toBe(
			bookDeleteSentence("Kept", {
				named: [{ id: branch!.id, name: "Branch" }],
				others: 0
			})
		)
	})

	test("a session of a deleted account does not block", async () => {
		const u = await user()
		const gone = await user()
		const b = await book(u.id, "Orphaned")
		await play(gone.id, b.id, "Nobody's")
		await testDb
			.update(schema.users)
			.set({ isDeleted: true })
			.where(eq(schema.users.id, gone.id))
		const { bookDeleteRefusal } = await import("./bookLock")
		expect(await bookDeleteRefusal(db(), b.id, u.id)).toBeNull()
	})

	test("a session's own notes are not deleted through lorebooks:delete", async () => {
		const u = await user()
		const b = await book(u.id, "Played")
		const p = await play(u.id, b.id, "Run")
		const events = await del(u.id, p.notes.id)
		expect(
			events.find((e) => e.event === "lorebooks:delete:error")?.payload
				.error
		).toBe("Lorebook not found.")
		expect(await bookRow(p.notes.id)).toBeTruthy()
	})

	test("allowed once the session is deleted", async () => {
		const u = await user()
		const b = await book(u.id, "Freed")
		const p = await play(u.id, b.id, "Gone")
		await testDb
			.delete(schema.sessions)
			.where(eq(schema.sessions.id, p.session.id))
		await testDb
			.delete(schema.lorebooks)
			.where(eq(schema.lorebooks.id, p.notes.id))
		const events = await del(u.id, b.id)
		expect(
			events.find((e) => e.event === "lorebooks:delete")?.payload
				.lorebookId
		).toBe(b.id)
		expect(await bookRow(b.id)).toBeUndefined()
	})

	test("allowed once nothing reads the book (a merge's state)", async () => {
		const u = await user()
		const b = await book(u.id, "Merged")
		const p = await play(u.id, b.id, "Merged run")
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: null })
			.where(eq(schema.sessions.id, p.session.id))
		await testDb
			.update(schema.lorebooks)
			.set({ overlayOf: null })
			.where(eq(schema.lorebooks.id, p.notes.id))
		const events = await del(u.id, b.id)
		expect(
			events.find((e) => e.event === "lorebooks:delete")?.payload
				.lorebookId
		).toBe(b.id)
		expect(await bookRow(b.id)).toBeUndefined()
	})

	test("a book no session reads deletes as before", async () => {
		const u = await user()
		const b = await book(u.id, "Idle")
		const events = await del(u.id, b.id)
		expect(
			events.find((e) => e.event === "lorebooks:delete")?.payload
				.lorebookId
		).toBe(b.id)
		expect(await bookRow(b.id)).toBeUndefined()
	})
})

describe("Back of a made lorebook", () => {
	async function madeRow(userId: number, bookId: number) {
		const [anchor] = await testDb
			.insert(schema.sessions)
			.values({ userId, isGroup: false, name: "Maker" })
			.returning()
		const [row] = await testDb
			.insert(schema.stateProposals)
			.values({
				sessionId: anchor!.id,
				kind: "library",
				status: "accepted",
				payload: {
					kind: "library",
					op: "create-lorebook",
					input: {},
					by: userId,
					label: "Made",
					result: { lorebookId: bookId },
					document: { name: "Made" }
				}
			} as any)
			.returning()
		return row!
	}
	const payloadOf = async (id: number) =>
		(
			await testDb
				.select()
				.from(schema.stateProposals)
				.where(eq(schema.stateProposals.id, id))
		)[0]!.payload as any

	test("the book stays and the payload loses its document when a session reads it", async () => {
		const { undoLibraryChange } = await import("$lib/server/library/writes")
		const u = await user()
		const b = await book(u.id, "Made")
		await play(u.id, b.id, "Reader")
		const row = await madeRow(u.id, b.id)
		await expect(undoLibraryChange(db(), row)).rejects.toThrow(
			"Made stayed: a session plays on it."
		)
		expect(await bookRow(b.id)).toBeTruthy()
		expect((await payloadOf(row.id)).document).toBeUndefined()
	})

	test("Back's result carries the sentence for the book it left", async () => {
		const { revertLibraryChangesAnchoredTo } = await import(
			"$lib/server/library/writes"
		)
		const u = await user()
		const b = await book(u.id, "Made")
		await play(u.id, b.id, "Reader")
		const row = await madeRow(u.id, b.id)
		const [msg] = await testDb
			.insert(schema.messages)
			.values({ sessionId: row.sessionId, role: "user" } as any)
			.returning()
		await testDb
			.update(schema.stateProposals)
			.set({ messageId: msg!.id })
			.where(eq(schema.stateProposals.id, row.id))
		const out = await revertLibraryChangesAnchoredTo(db(), [msg!.id])
		expect(out).toEqual({
			changed: false,
			stayed: ["Made stayed: a session plays on it."]
		})
		expect(await bookRow(b.id)).toBeTruthy()
	})

	test("with no reader it is deleted as before", async () => {
		const { undoLibraryChange } = await import("$lib/server/library/writes")
		const u = await user()
		const b = await book(u.id, "Made")
		const row = await madeRow(u.id, b.id)
		await undoLibraryChange(db(), row)
		expect(await bookRow(b.id)).toBeUndefined()
	})
})
