/**
 * Deleting a place takes its stats with it (plan B0, places-graph 2026-09-29).
 *
 * A place's stats are rows owned by `location` (the durable layer) and
 * `session_location` (each session's layer), both by the entry's id — and an
 * owner id has no foreign key, because it names a different table per kind.
 * So `entries:delete` left a deleted place's `attribute_values`,
 * `attribute_configs` and `owner_sheets` behind, for the place and for every
 * entry the `anchor_entry_id` cascade took with it. Import-overwrite and
 * duplicate already clean up; delete does too now.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entries-delete-stats-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}
const STASH = "test:slot/stash@1"
const OWNED_KINDS = ["location", "session_location"] as const

let n = 0

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `delete-stats-${suffix}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `Keep ${suffix}` }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const sheetId = `test:sheet/room-${suffix}@1`
	await testDb.insert(schema.attributeSheets).values({ id: sheetId, userId: user.id, props: {} })
	let position = 0
	const entry = async (title: string, typeId: string, anchorEntryId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({ lorebookId: book!.id, typeId, typeVersion: 1, position: position++, title, content: "…", anchorEntryId })
				.returning()
		)[0]!
	// The keep, a room filed inside it (a place under a place, still legal
	// until B1), and an altar filed under the room — all three go with it.
	const keep = await entry("The Keep", LOCATION_TYPE_ID)
	const cellar = await entry("The Cellar", LOCATION_TYPE_ID, keep.id)
	const altar = await entry("The Altar", WORLD_LORE_TYPE_ID, cellar.id)
	// Another place of the book, never deleted: its rows are the control.
	const harbor = await entry("The Harbor", LOCATION_TYPE_ID)
	return { user, book: book!, session: session!, sheetId, keep, cellar, altar, harbor }
}

/** Stats on a place at both layers: a value, a config and a sheet each. */
async function stock(w: Awaited<ReturnType<typeof world>>, placeId: number) {
	for (const kind of OWNED_KINDS) {
		const sessionId = kind === "session_location" ? w.session.id : null
		await testDb.insert(schema.attributeValues).values({
			ownerKind: kind,
			ownerId: placeId,
			slotId: STASH,
			value: { v: ["lantern", "rope"] },
			sessionId
		})
		await testDb.insert(schema.attributeConfigs).values({
			ownerKind: kind,
			ownerId: placeId,
			slotId: STASH,
			config: { max: 9 },
			sessionId
		})
		await testDb.insert(schema.ownerSheets).values({ ownerKind: kind, ownerId: placeId, sheetId: w.sheetId, sessionId })
	}
}

/** Every owner row any of `ids` holds as a place, in all three tables. */
async function ownerRows(ids: number[]) {
	const count = async (table: typeof schema.attributeValues | typeof schema.attributeConfigs | typeof schema.ownerSheets) =>
		(
			await testDb
				.select({ id: table.id })
				.from(table as any)
				.where(and(inArray(table.ownerKind, [...OWNED_KINDS]), inArray(table.ownerId, ids)))
		).length
	return {
		values: await count(schema.attributeValues),
		configs: await count(schema.attributeConfigs),
		sheets: await count(schema.ownerSheets)
	}
}

const del = async (userId: number, id: number, typeId: string) => {
	const { deleteEntryHandler } = await import("./entries")
	return deleteEntryHandler.handler(fakeSocket(userId), { id, typeId } as any, noopEmit)
}

describe("entries:delete on a place", () => {
	test("a place with inventory leaves zero owner rows, at both layers", async () => {
		const w = await world()
		await stock(w, w.harbor.id)
		await stock(w, w.keep.id)
		expect(await ownerRows([w.keep.id])).toEqual({ values: 2, configs: 2, sheets: 2 })

		await del(w.user.id, w.harbor.id, LOCATION_TYPE_ID)

		expect(await ownerRows([w.harbor.id])).toEqual({ values: 0, configs: 0, sheets: 0 })
		// The other place keeps every row it had.
		expect(await ownerRows([w.keep.id])).toEqual({ values: 2, configs: 2, sheets: 2 })
	})

	test("every entry the cascade took is cleaned too", async () => {
		const w = await world()
		await stock(w, w.keep.id)
		await stock(w, w.cellar.id)
		await stock(w, w.harbor.id)

		await del(w.user.id, w.keep.id, LOCATION_TYPE_ID)

		const gone = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(inArray(schema.lorebookEntries.id, [w.keep.id, w.cellar.id, w.altar.id]))
		expect(gone).toEqual([])
		expect(await ownerRows([w.keep.id, w.cellar.id, w.altar.id])).toEqual({ values: 0, configs: 0, sheets: 0 })
		expect(await ownerRows([w.harbor.id])).toEqual({ values: 2, configs: 2, sheets: 2 })
	})

	test("a refused delete (not the caller's book) removes nothing", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `delete-stats-stranger-${n}`)
		await stock(w, w.harbor.id)
		await expect(del(stranger.id, w.harbor.id, LOCATION_TYPE_ID)).rejects.toThrow(/not found or access denied/)
		expect(await ownerRows([w.harbor.id])).toEqual({ values: 2, configs: 2, sheets: 2 })
		const [still] = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.harbor.id))
		expect(still?.id).toBe(w.harbor.id)
	})
})
