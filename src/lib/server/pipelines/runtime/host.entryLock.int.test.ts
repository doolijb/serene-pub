/**
 * 🚧 The entry lock at the host's writers: while an entry is locked no run
 * writes it. A refused write is a note and `written: false`, never a throw —
 * the reply goes on and its other writes land. Driven through the real outlets
 * (`update-lore-entry@1`, `create-lore-entry@1`'s `match`, a history day).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { RUN_LOCK_SENTENCES } from "$lib/shared/lorebooks/runLocks"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const CREATE = { key: "file", definitionId: "core:outlet/create-lore-entry" } as any
const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entry-lock-host-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(mode: "full" | "review" = "full") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `entry-lock-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: mode })
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const host = async () => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as unknown as Db, { sessionId: session!.id, userId: user.id, runId: `run-${suffix}` })
	}
	return { user, book: book!, session: session!, host }
}

async function place(lorebookId: number, title: string, locked: boolean) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `${title}, as written.`,
			fields: { category: "Rooms" },
			entryLock: locked
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
const amendments = () => db.select().from(schema.entryAmendments)
const sentence = (title: string) => RUN_LOCK_SENTENCES.entry(`'${title}'`)

describe("update-lore-entry on a locked entry", () => {
	it.each(["full", "review"] as const)("%s: nothing is written or held, the note names it, nothing throws; unlocked it works", async (mode) => {
		const w = await world(mode)
		const vault = await place(w.book.id, "The Vault", true)
		const before = await stored(vault.id)
		const amendedBefore = await amendments()
		const out: any = await (await w.host()).commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(out).toMatchObject({ entryId: vault.id, lorebookId: w.book.id, written: false })
		expect(out.notes).toEqual([sentence("The Vault")])
		expect(await stored(vault.id)).toEqual(before)
		expect(await amendments()).toEqual(amendedBefore)
		expect(
			await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, w.book.id))
		).toHaveLength(1)

		await db.update(schema.lorebookEntries).set({ entryLock: false }).where(eq(schema.lorebookEntries.id, vault.id))
		const again: any = await (await w.host()).commit!({ entry: vault.id, content: "Sealed." }, UPDATE)
		expect(again.written).toBeUndefined()
		if (mode === "full") expect((await stored(vault.id)).content).toBe("Sealed.")
		else expect((await amendments()).length).toBeGreaterThan(amendedBefore.length)
	})

	it("a step's two writes: the locked one is a note, the other lands, the reply is not halted", async () => {
		const w = await world()
		const locked = await place(w.book.id, "The Vault", true)
		const free = await place(w.book.id, "The Hall", false)
		const host = await w.host()
		const a: any = await host.commit!({ entry: locked.id, content: "Sealed." }, UPDATE)
		const b: any = await host.commit!({ entry: free.id, content: "Open." }, UPDATE)
		expect(a.written).toBe(false)
		expect(b.written).toBeUndefined()
		expect((await stored(locked.id)).content).toBe("The Vault, as written.")
		expect((await stored(free.id)).content).toBe("Open.")
	})
})

describe("create-lore-entry whose match finds a locked entry", () => {
	it.each([
		["by id", (id: number) => ({ match: { entryId: id } })],
		["by name", () => ({ match: { name: "The Vault" } })],
		["by name, shown nothing (appended)", () => ({ match: { name: "The Vault" }, shown: [] })]
	])("%s: nothing written, the note names it, no paragraph note, no throw", async (_label, extra) => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault", true)
		const before = await stored(vault.id)
		const amendedBefore = await amendments()
		const out: any = await (await w.host()).commit!(
			{ name: "The Vault", content: "Sealed.", params: { entryType: LOCATION_TYPE_ID }, ...extra(vault.id) },
			CREATE
		)
		expect(out.notes).toContain(sentence("The Vault"))
		expect((out.notes as string[]).some((x) => x.includes("as a new paragraph"))).toBe(false)
		expect(await stored(vault.id)).toEqual(before)
		expect(await amendments()).toEqual(amendedBefore)
	})
})

describe("a history day filed onto while locked", () => {
	it("nothing is filed, the note is the lock sentence, nothing throws", async () => {
		const w = await world()
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				content: "The gate fell.",
				fields: { year: 3, month: 2, day: 9 },
				entryLock: true
			})
			.returning()
		const before = await stored(day!.id)
		const out: any = await (await w.host()).commit!(
			{ content: "The bells rang.", params: { entryType: HISTORY_TYPE_ID }, fields: { year: 3, month: 2, day: 9 } },
			CREATE
		)
		expect(out.notes).toEqual([RUN_LOCK_SENTENCES.entry(`'entry ${day!.id}'`)])
		expect(await stored(day!.id)).toEqual(before)
		expect(
			await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, w.book.id))
		).toHaveLength(1)
	})
})
