/**
 * `vectorization:itemUpdated` reaches the item's OWNER, admin or not
 * (plan A7).
 *
 * The badge refresh used to ride the admin-only progress emitter, so an owner
 * who is not an administrator never saw an entry, a cast member or a character
 * turn "vectorized" without reloading. Each item now goes to the one user it
 * belongs to — the book's owner, the card's owner, the session's owner — and
 * the interest gate narrows it to their tabs that asked. Nobody else hears it,
 * administrators included.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vector-owner-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

function fakeSocket(id: number, isAdmin = false) {
	const onDisconnect: Array<() => void> = []
	return {
		user: { id, isAdmin },
		on: (event: string, cb: () => void) => {
			if (event === "disconnect") onDisconnect.push(cb)
		},
		disconnect: () => onDisconnect.forEach((cb) => cb())
	}
}

const ITEM = "vectorization:itemUpdated"
const item = (over: Record<string, unknown>) => ({
	embeddingModel: "m",
	vectorizedAt: new Date().toISOString(),
	...over
})

describe("an embedded item is told to its owner (A7)", () => {
	test("a book's item reaches its non-admin owner and nobody else", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "vec-owner-book")
		const stranger = await createTestUser(testDb, "vec-owner-stranger")
		const admin = await createTestUser(testDb, "vec-owner-admin")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Owned", userId: owner.id })
			.returning()

		const { registerVectorizationHandlers } = await import("./vectorization")
		const { tellItemOwner } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)
		const ownerEmit = vi.fn()
		const strangerEmit = vi.fn()
		const adminEmit = vi.fn()
		const ownerSocket = fakeSocket(owner.id)
		registerVectorizationHandlers(ownerSocket, ownerEmit, () => {})
		registerVectorizationHandlers(fakeSocket(stranger.id), strangerEmit, () => {})
		registerVectorizationHandlers(fakeSocket(admin.id, true), adminEmit, () => {})

		const payload = item({ type: "worldLore", id: 1, lorebookId: book.id })
		await tellItemOwner(ITEM, payload)
		expect(ownerEmit).toHaveBeenCalledWith(ITEM, payload)
		expect(strangerEmit).not.toHaveBeenCalledWith(ITEM, expect.anything())
		expect(adminEmit).not.toHaveBeenCalledWith(ITEM, expect.anything())

		// Gone with the socket.
		ownerEmit.mockClear()
		ownerSocket.disconnect()
		await tellItemOwner(ITEM, payload)
		expect(ownerEmit).not.toHaveBeenCalled()
	})

	test("a character's item reaches the card's owner; a message's, the session's", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const owner = await createTestUser(testDb, "vec-owner-card")
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Maren", description: "" })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "user", content: "hello" })
			.returning()

		const { registerVectorizationHandlers } = await import("./vectorization")
		const { tellItemOwner } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)
		const emit = vi.fn()
		registerVectorizationHandlers(fakeSocket(owner.id), emit, () => {})

		const cardItem = item({ type: "character", id: card.id })
		await tellItemOwner(ITEM, cardItem)
		expect(emit).toHaveBeenCalledWith(ITEM, cardItem)

		const messageItem = item({ type: "message", id: message.id })
		await tellItemOwner(ITEM, messageItem)
		expect(emit).toHaveBeenCalledWith(ITEM, messageItem)
	})

	test("progress telemetry still goes to administrators only", async () => {
		const { registerVectorizationHandlers } = await import("./vectorization")
		const { tellItemOwner, embeddingLane } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)
		const emit = vi.fn()
		registerVectorizationHandlers(fakeSocket(424242), emit, () => {})
		;(embeddingLane as any).broadcast("idle")
		await tellItemOwner("vectorization:progress", { status: "idle" })
		expect(emit).not.toHaveBeenCalled()
	})
})
