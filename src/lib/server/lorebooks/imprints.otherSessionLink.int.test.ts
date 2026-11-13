/**
 * 🚧 A link kept in another session's notes never holds a lorebook entry for a
 * run's undo of it; a link in the lorebook itself, or in the same session's
 * own notes, does.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-imprints-other-session-link-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	const user = await createTestUser(testDb, `imprints-other-${++n}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${n}` })
		.returning()
	const [hall] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Hall",
			content: "…"
		})
		.returning()
	const session = async () => {
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: user.id,
				isGroup: false,
				name: `S${++n}`,
				lorebookId: book!.id
			})
			.returning()
		const ownBook = await insertOwnBook(db(), {
			sessionId: s!.id,
			userId: user.id,
			name: null,
			overlayOf: book!.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { session: s!, ownBook }
	}
	const a = await session()
	const b = await session()
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: a.session.id,
				role: "assistant",
				content: "…"
			})
			.returning()
		await testDb
			.insert(schema.messages)
			.values({
				id: legacy!.id,
				sessionId: a.session.id,
				role: "assistant"
			})
		return legacy!
	}
	const make = async (runId: string) => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db(), {
			sessionId: a.session.id,
			userId: user.id,
			runId
		})
		const out: any = await host.commit!(
			{
				name: "The Well",
				content: "Deep.",
				params: { entryType: LOCATION_TYPE_ID }
			},
			CREATE
		)
		return out.id as number
	}
	return { book: book!, hall: hall!, a, b, message, make }
}

const entry = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]
const swipe = async (messageId: number) => {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return retractStateAnchoredTo(db(), messageId, "replaced")
}
const linkInto = (lorebookId: number, to: number, from: number) =>
	testDb
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			fromEntryId: from,
			toEntryId: to,
			relationshipType: "leads to"
		})

describe("a made entry's undo and a link in another session's notes", () => {
	test("another session's own-book link does not hold it: the run's undo unmakes the entry", async () => {
		const w = await world()
		const m = await w.message()
		const well = await w.make("run-other")
		await linkInto(w.b.ownBook.id, well, w.hall.id)
		await swipe(m.id)
		expect(await entry(well)).toBeUndefined()
	})

	test("a link in the lorebook itself holds it (kept)", async () => {
		const w = await world()
		const m = await w.message()
		const well = await w.make("run-book")
		await linkInto(w.book.id, well, w.hall.id)
		await swipe(m.id)
		expect((await entry(well))?.title).toBe("The Well")
	})

	test("a link in the same session's own notes holds it (kept)", async () => {
		const w = await world()
		const m = await w.message()
		const well = await w.make("run-own")
		await linkInto(w.a.ownBook.id, well, w.hall.id)
		await swipe(m.id)
		expect((await entry(well))?.title).toBe("The Well")
	})
})
