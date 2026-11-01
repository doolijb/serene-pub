/**
 * 🚧 World-scope writes (M0, lane T3, SHAPES F1): a slot that declares
 * `scope: 'world'` keeps its values on the book. A write from a session —
 * `set-state@1` or the socket — is re-owned onto the book the session reads
 * (`worldOwnerOf`); a session-scope slot stays on the session's layer; a
 * player's seat holds nothing that lives on the world.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-world-scope-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const SHOP_SHUT = "core:slot/shop-shut@1"
const TIRED = "core:slot/tired@1"
const GENRE = "test:genre/world-scope"

function declareSlots() {
	_clearAttributeSlots()
	const shut = defineAttributeSlot(SHOP_SHUT, {
		type: "boolean",
		descriptor: "Whether the shop is shut.",
		appliesTo: ["world"],
		scope: "world",
		default: false
	})
	const tired = defineAttributeSlot(TIRED, {
		type: "boolean",
		descriptor: "Whether the world is tired.",
		appliesTo: ["world"],
		scope: "session",
		default: false
	})
	genreKeeping(GENRE, { name: { en: "World scope" }, family: "test", slots: [shut, tired], events: {} })
}

let n = 0

async function world() {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `world-scope-${suffix}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, genreId: GENRE, lorebookId: book!.id })
		.returning()
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
		.onConflictDoUpdate({ target: schema.userSettings.userId, set: { loreWriteMode: "full" } })
	return { user, book: book!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

const setState = async () => {
	const { stateBindings } = await import("$lib/server/pipelines/runtime/bindings.state")
	return stateBindings({ runId: "run-world-scope" })["core:task/set-state@1"]!
}

const socketOf = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any

const bookRows = async (w: World, slotId: string) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "lorebook"), eq(schema.attributeValues.ownerId, w.book.id), eq(schema.attributeValues.slotId, slotId)))

const sessionRows = async (w: World, slotId: string) =>
	await testDb
		.select()
		.from(schema.attributeValues)
		.where(and(eq(schema.attributeValues.ownerKind, "session"), eq(schema.attributeValues.ownerId, w.session.id), eq(schema.attributeValues.slotId, slotId)))

const read = async (w: World, slotId: string) => {
	const { valueOf } = await import("$lib/server/state/resolve")
	return await valueOf(testDb as unknown as Db, { sessionId: w.session.id, owner: { kind: "session", id: w.session.id }, slotId })
}

describe("a world-scope slot is written to the book", () => {
	test("set-state of a world-scope flag lands on the lorebook owner and reads true for the session", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		const owner = await worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "session", id: w.session.id })
		expect(owner).toEqual({ kind: "lorebook", id: w.book.id })
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner, slotId: SHOP_SHUT, value: true }] },
			{} as any
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(await bookRows(w, SHOP_SHUT)).toHaveLength(1)
		expect(await sessionRows(w, SHOP_SHUT)).toHaveLength(0)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})

	test("a session-scope slot stays on the session layer", async () => {
		const w = await world()
		const owner = { kind: "session" as const, id: w.session.id }
		const out: any = await (await setState())(
			{ scope: { sessionId: w.session.id }, params: { mode: "apply" }, changes: [{ owner, slotId: TIRED, value: true }] },
			{} as any
		)
		expect(out.value.refused ?? []).toEqual([])
		expect(await sessionRows(w, TIRED)).toHaveLength(1)
		expect(await bookRows(w, TIRED)).toHaveLength(0)
	})

	test("the socket write routes the same way", async () => {
		const w = await world()
		const { stateSet } = await import("$lib/server/sockets/state")
		await stateSet.handler(
			socketOf(w.user.id),
			{ sessionId: w.session.id, owner: { kind: "session", id: w.session.id }, slotId: SHOP_SHUT, value: true } as any,
			() => {}
		)
		expect(await bookRows(w, SHOP_SHUT)).toHaveLength(1)
		expect(await sessionRows(w, SHOP_SHUT)).toHaveLength(0)
		expect(await read(w, SHOP_SHUT)).toBe(true)
	})
})

describe("what has nowhere to go on the world is refused", () => {
	test("a seat write of a world-scope slot refuses with the sentence", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		await expect(worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "player_seat", id: 1 })).rejects.toThrow(
			"A player's seat holds nothing that lives on the world."
		)
	})

	test("a character outside the cast refuses with the sentence", async () => {
		const w = await world()
		const { worldOwnerOf } = await import("$lib/server/state/worldScope")
		await expect(worldOwnerOf(testDb as unknown as Db, w.session.id, { kind: "session_cast", id: 999_999 })).rejects.toThrow(
			"This character is not in this world's cast, so a value that lives on the world has nowhere to go."
		)
	})
})
