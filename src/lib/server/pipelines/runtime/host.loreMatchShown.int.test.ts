/**
 * 🚧 `create-lore-entry@1` with `shown` and `match: { name }`: an entry the
 * writing model was shown is rewritten, one it was not shown gets a paragraph,
 * a key alone is no match, two of the name change nothing. A change to a
 * lorebook entry is written in place under Full and held under Review changes;
 * an own-book entry is changed in place.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lore-shown-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Mode = "full" | "review"

async function world(mode: Mode = "full") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `shown-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: mode })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	return { user, book: book!, session: session!, suffix }
}
type World = Awaited<ReturnType<typeof world>>

const messageIn = async (sessionId: number) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const hostFor = async (w: World, runId: string) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as unknown as Db, { sessionId: w.session.id, userId: w.user.id, runId })
}

async function lore(
	lorebookId: number,
	title: string,
	content: string,
	extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content,
			...extra
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]!

const entriesOf = (lorebookId: number) =>
	db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.lorebookId, lorebookId))

const ownBookOf = async (w: World) => {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(db as unknown as Db, w.session.id)
}

const heldRows = (ownBookId: number) =>
	db
		.select()
		.from(schema.entryAmendments)
		.where(and(eq(schema.entryAmendments.lorebookId, ownBookId), isNotNull(schema.entryAmendments.base)))
		.orderBy(schema.entryAmendments.id)

async function readBy(w: World, entryId: number): Promise<Record<string, any>> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(db as unknown as Db, w.session.id))!
	const overlays = await entryOverlaysFor(db as unknown as Db, row.lorebookId, reading, [entryId])
	return entryAt(toEntryRow(row), overlays, reading) as any
}

const imprintCount = async (w: World) =>
	(await db.select().from(schema.loreImprints).where(eq(schema.loreImprints.sessionId, w.session.id))).length

describe("create-lore-entry — shown, an entry of the session's own book", () => {
	it("is rewritten in place, keeping its name, with no entry made", async () => {
		const w = await world("review")
		await messageIn(w.session.id)
		const host = await hostFor(w, `run-own-${w.suffix}`)
		const made: any = await host.commit!({ name: "Mira", content: "A baker." }, CREATE)
		expect(made.route).toBe("own-book")
		const own = await ownBookOf(w)
		const before = (await entriesOf(own.id)).length

		const out: any = await host.commit!(
			{ name: "The Mira", content: "A baker who left town.", match: { name: "the mira" }, shown: [made.id] },
			CREATE
		)
		expect(out).toMatchObject({ id: made.id, entryId: made.id, matched: true, written: false, route: "own-book" })
		const row = await stored(made.id)
		expect(row.title).toBe("Mira")
		expect(row.content).toBe("A baker who left town.")
		expect((await entriesOf(own.id)).length).toBe(before)
		expect(out.notes).toBeUndefined()
	})

	it("takes a paragraph when it was not shown, and nothing when the text is one it already has", async () => {
		const w = await world("review")
		await messageIn(w.session.id)
		const host = await hostFor(w, `run-own-p-${w.suffix}`)
		const made: any = await host.commit!({ name: "Mira", content: "A baker.\n\nShe is tall." }, CREATE)
		const out: any = await host.commit!(
			{ name: "Mira", content: "She has a cat.", match: { name: "Mira" }, shown: [] },
			CREATE
		)
		expect(out).toMatchObject({ id: made.id, matched: true, written: false })
		expect(out.notes).toEqual([`added to 'Mira' (entry ${made.id}) as a new paragraph.`])
		expect((await stored(made.id)).content).toBe("A baker.\n\nShe is tall.\n\nShe has a cat.")

		const imprints = await imprintCount(w)
		const same: any = await host.commit!(
			{ name: "Mira", content: " She is tall. ", match: { name: "Mira" }, shown: [] },
			CREATE
		)
		expect(same.notes).toEqual([`'Mira' (entry ${made.id}) already says this; nothing was written.`])
		expect((await stored(made.id)).content).toBe("A baker.\n\nShe is tall.\n\nShe has a cat.")
		expect(await imprintCount(w)).toBe(imprints)
	})
})

describe("create-lore-entry — shown, an entry of the attached lorebook", () => {
	it("under Review changes, a shown entry's rewrite is a held amendment; the lorebook row and its name stay", async () => {
		const w = await world("review")
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const m = await messageIn(w.session.id)
		const before = await stored(mira.id)
		const out: any = await (
			await hostFor(w, `run-b-${w.suffix}`)
		).commit!({ name: "Mira the baker", content: "A baker, now a widow.", match: { name: "Mira" }, shown: [mira.id] }, CREATE)
		expect(out).toMatchObject({ entryId: mira.id, matched: true, written: false, route: "own-book", lorebookId: w.book.id })
		expect(await stored(mira.id)).toEqual(before)
		const held = await heldRows((await ownBookOf(w)).id)
		expect(held).toHaveLength(1)
		expect(held[0]).toMatchObject({
			entryId: mira.id,
			sourceMessageId: m.id,
			fields: { content: "A baker, now a widow." },
			base: { content: { v: "A baker." } }
		})
		const mine = await readBy(w, mira.id)
		expect(mine).toMatchObject({ name: "Mira", content: "A baker, now a widow." })
		expect(await imprintCount(w)).toBe(0)
	})

	it("under Review changes, an entry it was not shown takes a paragraph onto what the session reads, keeping an earlier held change", async () => {
		const w = await world("review")
		const mira = await lore(w.book.id, "Mira", "A baker.")
		await messageIn(w.session.id)
		const host = await hostFor(w, `run-c-${w.suffix}`)
		await host.commit!({ name: "Mira", content: "A baker. She is tall.", match: { name: "Mira" }, shown: [mira.id] }, CREATE)
		const out: any = await host.commit!(
			{ name: "Mira", content: "She owns a cat.", match: { name: "Mira" }, shown: [] },
			CREATE
		)
		expect(out.notes).toEqual([`added to 'Mira' (entry ${mira.id}) as a new paragraph.`])
		expect((await stored(mira.id)).content).toBe("A baker.")
		expect((await readBy(w, mira.id)).content).toBe("A baker. She is tall.\n\nShe owns a cat.")
		expect(await heldRows((await ownBookOf(w)).id)).toHaveLength(2)
	})

	it("text equal to what the session reads writes nothing: no amendment, no imprint", async () => {
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.")
		await messageIn(w.session.id)
		const out: any = await (
			await hostFor(w, `run-d-${w.suffix}`)
		).commit!({ name: "Mira", content: "A baker. ", match: { name: "Mira" }, shown: [mira.id] }, CREATE)
		expect(out).toMatchObject({ entryId: mira.id, matched: true, written: false })
		expect(out.notes).toEqual([`'Mira' (entry ${mira.id}) already says this; nothing was written.`])
		expect(await heldRows((await ownBookOf(w)).id)).toEqual([])
		expect(await imprintCount(w)).toBe(0)
	})

	it("a key alone is no match: a new entry, and the note", async () => {
		const w = await world()
		const mira = await lore(w.book.id, "Mira", "A baker.", { keys: ["baker"] })
		await messageIn(w.session.id)
		const out: any = await (
			await hostFor(w, `run-e-${w.suffix}`)
		).commit!({ name: "Baker", content: "A trade.", match: { name: "Baker" }, shown: [] }, CREATE)
		expect(out.matched).toBeUndefined()
		expect(out.id).not.toBe(mira.id)
		expect(out.notes).toEqual([`'Baker' met a key of 'Mira' (entry ${mira.id}); written as a new entry.`])
		expect((await stored(out.id)).title).toBe("Baker")
		expect((await stored(mira.id)).content).toBe("A baker.")
	})

	it("two entries of the name: nothing written, the note, the run goes on", async () => {
		const w = await world()
		const a = await lore(w.book.id, "Mira", "One.")
		const b = await lore(w.book.id, "Mira", "Two.")
		await messageIn(w.session.id)
		const before = (await entriesOf(w.book.id)).length
		const host = await hostFor(w, `run-f-${w.suffix}`)
		const out: any = await host.commit!(
			{ name: "Mira", content: "Three.", match: { name: "mira" }, shown: [a.id] },
			CREATE
		)
		expect(out).toEqual({
			lorebookId: w.book.id,
			route: "book",
			written: false,
			notes: [`2 entries answer to 'mira' — 'Mira' (entry ${a.id}), 'Mira' (entry ${b.id}); nothing was written for it.`]
		})
		expect((await entriesOf(w.book.id)).length).toBe(before)
		expect(await heldRows((await ownBookOf(w)).id)).toEqual([])
		expect(await imprintCount(w)).toBe(0)
		// The notes ride the binding's result into the run.
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const bound: any = await (coreBindings() as any)["core:outlet/create-lore-entry@1"]!(
			{ name: "Mira", content: "Three." },
			{ commit: async () => out }
		)
		expect(bound).toMatchObject({ kind: "ok", value: { written: false, notes: out.notes } })
	})

	it("a new name creates", async () => {
		const w = await world()
		await lore(w.book.id, "Mira", "A baker.")
		await messageIn(w.session.id)
		const out: any = await (
			await hostFor(w, `run-g-${w.suffix}`)
		).commit!({ name: "Zed", content: "A smith.", match: { name: "Zed" }, shown: [] }, CREATE)
		expect(out.matched).toBeUndefined()
		expect((await stored(out.id)).title).toBe("Zed")
		expect(out.notes).toBeUndefined()
	})

	it("a write without shown goes as before: two hits refuse, { key } updates", async () => {
		const w = await world()
		const a = await lore(w.book.id, "Twin", "One.", { keys: ["pair"] })
		const b = await lore(w.book.id, "Twin", "Two.")
		await messageIn(w.session.id)
		const host = await hostFor(w, `run-h-${w.suffix}`)
		await expect(
			host.commit!({ name: "Twin", content: "x", match: { name: "twin" } }, CREATE)
		).rejects.toThrow(
			new RegExp(`2 entries answer to 'twin' — 'Twin' \\(entry ${a.id}\\), 'Twin' \\(entry ${b.id}\\)\\. Name one: match \\{ entryId \\}\\.`)
		)
		const out: any = await host.commit!({ name: "Twin", content: "Changed.", match: { key: "pair" } }, CREATE)
		expect(out).toMatchObject({ entryId: a.id, matched: true, written: false })
		expect((await readBy(w, a.id)).content).toBe("Changed.")
	})
})

describe("create-lore-entry — shown, a turn takes its rewrite back", () => {
	it("a swipe takes a held rewrite and an own-book rewrite with their turn", async () => {
		const w = await world("review")
		const mira = await lore(w.book.id, "Mira", "A baker.")
		const m1 = await messageIn(w.session.id)
		const host1 = await hostFor(w, `run-i-${w.suffix}`)
		const made: any = await host1.commit!({ name: "Odo", content: "A miller." }, CREATE)
		const m2 = await messageIn(w.session.id)
		const host2 = await hostFor(w, `run-j-${w.suffix}`)
		await host2.commit!({ name: "Odo", content: "A miller, retired.", match: { name: "Odo" }, shown: [made.id] }, CREATE)
		await host2.commit!({ name: "Mira", content: "A widow.", match: { name: "Mira" }, shown: [mira.id] }, CREATE)
		expect((await stored(made.id)).content).toBe("A miller, retired.")
		expect((await readBy(w, mira.id)).content).toBe("A widow.")

		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		const taken = await retractStateAnchoredTo(db as unknown as Db, m2.id, "replaced")
		expect(taken.changed).toBe(true)
		expect((await stored(made.id)).content).toBe("A miller.")
		expect((await readBy(w, mira.id)).content).toBe("A baker.")
		expect(await heldRows((await ownBookOf(w)).id)).toEqual([])
		expect(m1.id).not.toBe(m2.id)
	})
})
