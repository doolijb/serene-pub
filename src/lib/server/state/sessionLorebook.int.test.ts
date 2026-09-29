/**
 * A session's lorebook is ONE binding on the session row (`sessions.lorebook_id`);
 * the `session_lorebooks` junction is unused legacy that nothing writes
 * (sockets/sessions.ts). State read the junction, so for every session created
 * the real way the lorebook layer, a list's lore references and item supply
 * all found no lorebook (found by the phase 3c live check, 2026-09-26). These
 * sessions are built the way sessions are created today: `lorebookId` set, no
 * join row.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { attributeSlots, defineAttributeSlot, genre, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-state-session-lorebook-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const BAG = "test:slot/bag@1"
const db = () => testDb as unknown as Db

async function realSession() {
	_clearAttributeSlots()
	defineAttributeSlot(BAG, {
		shape: "core:stat-shape/list@1",
		label: { en: "Bag" },
		descriptor: "What they carry.",
		appliesTo: ["cast", "world"]
	})
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `session-lorebook-${Math.random().toString(36).slice(2)}`)
	const [lorebook] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: "World" }).returning()
	const GENRE = "test:genre/session-lorebook"
	genre(GENRE, { name: { en: "Real" }, family: "test", slots: attributeSlots(), events: {} })
	// The real shape: the binding is the session row's column, and no
	// `session_lorebooks` row exists.
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: "Run", genreId: GENRE, lorebookId: lorebook.id })
		.returning()
	const [key] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: lorebook.id,
			typeId: "core:entry/item",
			typeVersion: 1,
			position: 0,
			title: "Rusty key",
			content: "…",
			fields: { supply: "unique" }
		})
		.returning()
	return { user, lorebook, session, key }
}

describe("state reads the session's lorebook from sessions.lorebook_id", () => {
	test("sessionLinks names it", async () => {
		const w = await realSession()
		const { sessionLinks } = await import("$lib/server/state/resolve")
		expect((await sessionLinks(db(), w.session.id)).lorebookId).toBe(w.lorebook.id)
	})

	test("a list may hold a reference to one of its entries", async () => {
		const w = await realSession()
		const { applyChange } = await import("$lib/server/state/write")
		const { valueOf } = await import("$lib/server/state/resolve")
		const owner = { kind: "session" as const, id: w.session.id }
		await applyChange(
			db(),
			{ sessionId: w.session.id, updatedBy: "user" },
			{ owner, slotId: BAG, op: "add", items: [{ entryId: w.key.id, count: 1 }] }
		)
		expect(await valueOf(db(), { sessionId: w.session.id, owner, slotId: BAG })).toEqual([
			{ entryId: w.key.id }
		])
	})

	test("item supply answers for its items", async () => {
		const w = await realSession()
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		expect(await itemSupplyFor(db(), w.session.id)).toEqual([
			expect.objectContaining({ entryId: w.key.id, supply: "unique", limit: 1, held: 0, remaining: 1 })
		])
	})
})
