/**
 * The backstop: a lore write that reached the store with no date, on a story
 * that has one, is refused in words (`undatedLoreWriteRefusal`), not stored
 * undated. `loreWriteDateOf` is mocked to answer `undatable` (the outlets
 * believe the story has no date); the backstop reads the truth through its own
 * non-exported reader, so on a truly dated session it refuses, and on a truly
 * undatable one it lets the undated write through.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { ITEM_TYPE_ID, LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/state/storyTime", async (orig) => ({
	...(await orig<typeof import("$lib/server/state/storyTime")>()),
	loreWriteDateOf: vi.fn(async () => ({ kind: "undatable" }))
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const CREATE = { key: "file", definitionId: "core:outlet/create-lore-entry" } as any
const DAY = { year: 10, month: 2, day: 5 }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-undated-backstop-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A user, a timeline lorebook, a session on it: `dated` sets the session clock; otherwise nothing is dated. */
async function world(opts: { dated: boolean; mode?: "full" | "review" }) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `undated-backstop-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}`, timelineEnabled: true })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			...(opts.dated
				? { storyClockYear: DAY.year, storyClockMonth: DAY.month, storyClockDay: DAY.day }
				: {})
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
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: session!.id, role: "assistant", content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db as unknown as Db, {
		sessionId: session!.id,
		userId: user.id,
		runId: `run-${suffix}`
	} as any)
	return { book: book!, session: session!, vault: vault!, host }
}

const stored = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!
const rowOf = async (id: number) => {
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	return toEntryRow(await stored(id)) as any
}
const entriesIn = (lorebookId: number) =>
	db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, lorebookId))
const amendments = () => db.select().from(schema.entryAmendments)

describe("the backstop on a session that is truly dated (the outlets were told 'undatable')", () => {
	it("update-lore-entry on an attached entry is refused, the entry unchanged, no amendment", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const w = await world({ dated: true })
		await expect(w.host.commit!({ entry: w.vault.id, content: "Sealed." }, UPDATE)).rejects.toThrow(
			UNDATED_LORE_WRITE_SENTENCE
		)
		expect(await stored(w.vault.id)).toMatchObject({ content: "The Vault, as written." })
		expect((await amendments()).filter((r) => r.entryId === w.vault.id)).toHaveLength(0)
	})

	it("under Review changes, a held change is refused, no amendment", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const w = await world({ dated: true, mode: "review" })
		await expect(w.host.commit!({ entry: w.vault.id, content: "Sealed." }, UPDATE)).rejects.toThrow(
			UNDATED_LORE_WRITE_SENTENCE
		)
		expect(await stored(w.vault.id)).toMatchObject({ content: "The Vault, as written." })
		expect((await amendments()).filter((r) => r.entryId === w.vault.id)).toHaveLength(0)
	})

	it("create-lore-entry of an Item is refused, no new row; a World lore entry is written Perpetual", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const w = await world({ dated: true })
		await expect(
			w.host.commit!({ name: "A key", content: "A key.", params: { entryType: ITEM_TYPE_ID } }, CREATE)
		).rejects.toThrow(UNDATED_LORE_WRITE_SENTENCE)
		expect(await entriesIn(w.book.id)).toHaveLength(1)
		const lore: any = await w.host.commit!(
			{ name: "The Fall", content: "It fell.", params: { entryType: WORLD_LORE_TYPE_ID } },
			CREATE
		)
		expect(await rowOf(lore.id)).toMatchObject({ year: null, month: null, day: null })
		expect(await entriesIn(w.book.id)).toHaveLength(2)
	})
})

describe("the control: a session that is truly undatable (the mock still on)", () => {
	it("update-lore-entry succeeds undated, in place", async () => {
		const w = await world({ dated: false })
		await w.host.commit!({ entry: w.vault.id, content: "Sealed." }, UPDATE)
		expect(await stored(w.vault.id)).toMatchObject({ content: "Sealed." })
		expect((await amendments()).filter((r) => r.entryId === w.vault.id)).toHaveLength(0)
	})

	it("under Review changes, the held change is written undated", async () => {
		const w = await world({ dated: false, mode: "review" })
		await w.host.commit!({ entry: w.vault.id, content: "Sealed." }, UPDATE)
		expect(await stored(w.vault.id)).toMatchObject({ content: "The Vault, as written." })
		const held = (await amendments()).filter((r) => r.entryId === w.vault.id)
		expect(held).toHaveLength(1)
		expect(held[0]).toMatchObject({ year: null, month: null, day: null })
	})

	it("create-lore-entry of an Item is written undated", async () => {
		const w = await world({ dated: false })
		const item: any = await w.host.commit!(
			{ name: "A key", content: "A key.", params: { entryType: ITEM_TYPE_ID } },
			CREATE
		)
		expect(await rowOf(item.id)).toMatchObject({ year: null, month: null, day: null })
	})
})

describe("the backstop on a cast member's story write", () => {
	async function castWorld(dated: boolean) {
		const w = await world({ dated })
		const { insertCastMember } = await import("$lib/server/characters/versions")
		const { member } = await insertCastMember(db as unknown as Db, {
			lorebookId: w.book.id,
			binding: `{{char:backstop-${++n}}}`,
			characterId: null,
			name: `Ada ${n}`,
			description: "Her own description."
		})
		const [legacy] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: w.session.id, role: "assistant", content: "…" })
			.returning()
		await db.insert(schema.messages).values({ id: legacy!.id, sessionId: w.session.id, role: "assistant" })
		return { ...w, member, messageId: legacy!.id }
	}
	const versionsOf = async (memberId: number) =>
		db.select().from(schema.characterVersions).where(eq(schema.characterVersions.castMemberId, memberId))
	const write = async (c: Awaited<ReturnType<typeof castWorld>>, description: string) => {
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		return writeCastVersion(db as unknown as Db, {
			member: c.member.id,
			changes: { description },
			writtenBy: "run:backstop",
			session: { id: c.session.id, messageId: c.messageId }
		})
	}

	it("a new version on a truly dated session is refused, nothing written", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const c = await castWorld(true)
		const before = (await versionsOf(c.member.id)).length
		await expect(write(c, "Changed.")).rejects.toThrow(UNDATED_LORE_WRITE_SENTENCE)
		expect(await versionsOf(c.member.id)).toHaveLength(before)
	})

	it("a merge into the current version is refused too, the version unchanged", async () => {
		const { UNDATED_LORE_WRITE_SENTENCE } = await import("$lib/server/state/storyTime")
		const c = await castWorld(false)
		await write(c, "First.")
		const before = await versionsOf(c.member.id)
		await db
			.update(schema.sessions)
			.set({ storyClockYear: DAY.year, storyClockMonth: DAY.month, storyClockDay: DAY.day })
			.where(eq(schema.sessions.id, c.session.id))
		await expect(write(c, "Second.")).rejects.toThrow(UNDATED_LORE_WRITE_SENTENCE)
		expect(await versionsOf(c.member.id)).toEqual(before)
	})

	it("the control: on a truly undatable session the undated write is stored", async () => {
		const c = await castWorld(false)
		const before = (await versionsOf(c.member.id)).length
		await write(c, "Changed.")
		expect((await versionsOf(c.member.id)).length).toBeGreaterThan(before - 1)
	})
})
