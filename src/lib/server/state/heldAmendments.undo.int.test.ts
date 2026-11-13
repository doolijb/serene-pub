/**
 * 🚧 **A turn owns what it wrote — a held amendment goes with its turn.** A
 * session's change to an entry of its attached lorebook is a held amendment
 * (`entry_amendments.base` set) filed in the session's own book, anchored to
 * the turn's message by `source_message_id` (a plain int, so the message
 * cascade cannot reach it). The one retraction rule (`retractLoreAnchoredTo`)
 * takes it back, whole, by every road a turn leaves: a swipe, a regenerate
 * (`deleteLegacyWhere`, the retake's delete), Back (and Forward puts it back,
 * ids and all), a delete, and a failed re-tell (`restoreRetractedState`).
 * Only the turn's own row goes; an earlier turn's survives.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-undo-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/**
 * A session on a book with a vault, and two turns, each of which held one
 * change to it (`turn1`: Vaults, `turn2`: Treasury) through the real outlet.
 */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `held-undo-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const [vault] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Vault",
			content: "The Vault, as written.",
			fields: { category: "Rooms" }
		})
		.returning()
	const message = async () => {
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db
			.insert(schema.messages)
			.values({
				id: legacy!.id,
				sessionId: session!.id,
				role: "assistant"
			})
		return legacy!
	}
	const hold = async (messageId: number, category: string, runId: string) => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const host = createHost(db as unknown as Db, {
			sessionId: session!.id,
			userId: user.id,
			runId
		})
		await host.commit!({ entry: vault!.id, fields: { category } }, UPDATE)
		const own = await ownBook()
		const rows = await heldRows(own.id)
		expect(rows.at(-1)!.sourceMessageId).toBe(messageId)
	}
	const ownBook = async () => {
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		return ownBookFor(db as unknown as Db, session!.id)
	}
	const heldRows = (ownBookId: number) =>
		db
			.select()
			.from(schema.entryAmendments)
			.where(
				and(
					eq(schema.entryAmendments.lorebookId, ownBookId),
					isNotNull(schema.entryAmendments.base)
				)
			)
			.orderBy(schema.entryAmendments.id)
	const held = async () => heldRows((await ownBook()).id)
	const category = async (): Promise<unknown> => {
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { entryOverlaysFor, entryAt } = await import(
			"$lib/server/state/entriesOnReading"
		)
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, vault!.id))
		const reading = (await sessionReadingOf(
			db as unknown as Db,
			session!.id
		))!
		const overlays = await entryOverlaysFor(
			db as unknown as Db,
			row!.lorebookId,
			reading,
			[row!.id]
		)
		return (entryAt(toEntryRow(row!), overlays, reading) as any).category
	}
	const m1 = await message()
	await hold(m1.id, "Vaults", `run-1-${suffix}`)
	const m2 = await message()
	await hold(m2.id, "Treasury", `run-2-${suffix}`)
	return {
		user,
		book: book!,
		session: session!,
		vault: vault!,
		m1,
		m2,
		held,
		category
	}
}

describe("a turn owns the held amendment it wrote", () => {
	it("a swipe takes only its turn's row; the earlier turn's survives", async () => {
		const w = await world()
		const [first, second] = await w.held()
		expect(await w.category()).toBe("Treasury")
		const { retractStateAnchoredTo } = await import(
			"$lib/server/state/write"
		)
		const taken = await retractStateAnchoredTo(
			db as unknown as Db,
			w.m2.id,
			"replaced"
		)
		expect(taken.changed).toBe(true)
		expect(taken.taken.heldAmendments?.map((r) => r.id)).toEqual([
			second!.id
		])
		expect((await w.held()).map((r) => r.id)).toEqual([first!.id])
		expect(await w.category()).toBe("Vaults")
		// The lorebook's own row never moved.
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.vault.id))
		expect((row!.fields as any).category).toBe("Rooms")
	})

	it("a failed re-tell puts the row back, ids and all", async () => {
		const w = await world()
		const [first, second] = await w.held()
		const { retractStateAnchoredTo, restoreRetractedState } = await import(
			"$lib/server/state/write"
		)
		const taken = await retractStateAnchoredTo(
			db as unknown as Db,
			w.m2.id,
			"replaced"
		)
		expect((await w.held()).map((r) => r.id)).toEqual([first!.id])
		expect(
			await restoreRetractedState(db as unknown as Db, taken.taken)
		).toBe(true)
		const back = await w.held()
		expect(back.map((r) => r.id)).toEqual([first!.id, second!.id])
		expect(back[1]).toEqual(second)
		expect(await w.category()).toBe("Treasury")
	})

	it("a regenerate (the retake's delete of the turn's rows) takes only its turn's row", async () => {
		const w = await world()
		const [first] = await w.held()
		const { deleteLegacyWhere } = await import("$lib/server/messages/store")
		await db.transaction(async (tx) =>
			deleteLegacyWhere(
				tx as unknown as Db,
				inArray(schema.sessionMessages.id, [w.m2.id])
			)
		)
		expect((await w.held()).map((r) => r.id)).toEqual([first!.id])
		expect(await w.category()).toBe("Vaults")
	})

	it("a delete takes only its turn's row", async () => {
		const w = await world()
		const [first] = await w.held()
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await db.transaction(async (tx) =>
			deleteLegacy(tx as unknown as Db, w.m2.id)
		)
		expect((await w.held()).map((r) => r.id)).toEqual([first!.id])
		await db.transaction(async (tx) =>
			deleteLegacy(tx as unknown as Db, w.m1.id)
		)
		expect(await w.held()).toEqual([])
		expect(await w.category()).toBe("Rooms")
	})

	it("Back takes only its turn's row; Forward (the record read back from JSON) puts it back with the same id", async () => {
		const w = await world()
		const [first, second] = await w.held()
		const {
			retractStateAnchoredTo,
			reviveRetractedState,
			restoreRetractedState
		} = await import("$lib/server/state/write")
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, w.m2.id, "leaves", {
				leavingWith: [w.m2.id]
			})
		)
		expect(undone.changed).toBe(true)
		expect((await w.held()).map((r) => r.id)).toEqual([first!.id])
		expect(await w.category()).toBe("Vaults")
		// What Back keeps on the rewound row is JSON.
		const record = reviveRetractedState(
			JSON.parse(JSON.stringify(undone.taken)),
			w.session.id
		)!
		expect(record.heldAmendments).toHaveLength(1)
		expect(await restoreRetractedState(db as unknown as Db, record)).toBe(
			true
		)
		const back = await w.held()
		expect(back.map((r) => r.id)).toEqual([first!.id, second!.id])
		expect(back[1]).toEqual(second)
		expect(await w.category()).toBe("Treasury")
	})
})
