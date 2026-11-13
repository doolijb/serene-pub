/**
 * 🚧 A session's change to an entry of its attached lorebook is a held
 * amendment (Stage B, thin slice): one `entry_amendments` row in the session's
 * own book (`base` set), the lorebook untouched, read only by the session that
 * holds it. Driven through the real outlets (`update-lore-entry@1`,
 * `create-lore-entry@1`'s `match`) in each lore write mode.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-entry-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

type Mode = "full" | "review" | "off"

/** A user, a book of theirs, and a session reading it (the owner's lore write mode `mode`). */
async function world(
	opts: {
		mode?: Mode
		clock?: { year: number; month: number; day: number }
	} = {}
) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `held-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: opts.mode ?? "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const session = await sessionOn(user.id, book!.id, opts.clock)
	return { user, book: book!, session, suffix }
}

async function sessionOn(
	userId: number,
	lorebookId: number,
	clock?: { year: number; month: number; day: number }
) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId,
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
		.returning()
	return session!
}

const messageIn = async (sessionId: number) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const hostFor = async (sessionId: number, userId: number, runId: string) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as unknown as Db, { sessionId, userId, runId })
}

async function place(lorebookId: number, title: string, category = "Rooms") {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `${title}, as written.`,
			fields: { category }
		})
		.returning()
	return row!
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!

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

/** The entry as session `sessionId` reads it (wire row, the held amendments laid on). */
async function readBy(
	sessionId: number,
	entryId: number
): Promise<Record<string, any>> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(db as unknown as Db, sessionId))!
	const overlays = await entryOverlaysFor(
		db as unknown as Db,
		row.lorebookId,
		reading,
		[entryId]
	)
	return entryAt(toEntryRow(row), overlays, reading) as any
}

/** The entry as the lorebook's own reading (no session, no holder) has it. */
async function readByBook(entryId: number): Promise<Record<string, any>> {
	const { entryOverlaysFor, entryAt, MAIN_HEAD } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const row = await stored(entryId)
	const overlays = await entryOverlaysFor(
		db as unknown as Db,
		row.lorebookId,
		MAIN_HEAD,
		[entryId]
	)
	return entryAt(toEntryRow(row), overlays, MAIN_HEAD) as any
}

/** The entry's name as `entriesAsRead` gives it on a session's reading. */
async function nameBy(
	sessionId: number,
	entryId: number
): Promise<string | undefined> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entriesAsRead } = await import("$lib/server/state/entriesOnReading")
	const row = await stored(entryId)
	const reading = (await sessionReadingOf(db as unknown as Db, sessionId))!
	return (
		await entriesAsRead(
			db as unknown as Db,
			row.lorebookId,
			reading,
			"session",
			null,
			[entryId]
		)
	)[0]?.name
}

const ownBookOf = async (sessionId: number) => {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(db as unknown as Db, sessionId)
}

describe("a change to an attached lorebook's entry is held, in every lore write mode", () => {
	it.each<Mode>(["full", "review", "off"])(
		"%s: the lorebook is untouched; one held amendment; only this session reads it",
		async (mode) => {
			const w = await world({ mode })
			const other = await sessionOn(w.user.id, w.book.id)
			const vault = await place(w.book.id, "The Vault")
			await db.insert(schema.lorebookEntryVectors).values({
				entryId: vault.id,
				vectorName: "core:vec/default@1",
				dims: 3,
				vector: [0.1, 0.2, 0.3]
			} as any)
			const m = await messageIn(w.session.id)
			const before = await stored(vault.id)

			const out: any = await (
				await hostFor(w.session.id, w.user.id, `run-${w.suffix}`)
			).commit!(
				{
					entry: vault.id,
					name: "The Strongroom",
					content: "Sealed.",
					fields: { category: "Vaults" }
				},
				UPDATE
			)
			expect(out).toEqual({
				id: vault.id,
				entryId: vault.id,
				lorebookId: w.book.id,
				route: "own-book"
			})

			// The lorebook: row, imprints, vectors and the session's line untouched.
			expect(await stored(vault.id)).toEqual(before)
			expect(
				await db
					.select()
					.from(schema.loreImprints)
					.where(eq(schema.loreImprints.sessionId, w.session.id))
			).toEqual([])
			expect(
				await db
					.select()
					.from(schema.lorebookEntryVectors)
					.where(eq(schema.lorebookEntryVectors.entryId, vault.id))
			).toHaveLength(1)
			expect(
				await db
					.select()
					.from(schema.lorebookBranches)
					.where(eq(schema.lorebookBranches.lorebookId, w.book.id))
			).toEqual([])
			const [session] = await db
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, w.session.id))
			expect(session!.lorebookBranchId).toBeNull()

			// One held amendment, in the session's own book.
			const own = await ownBookOf(w.session.id)
			const held = await heldRows(own.id)
			expect(held).toHaveLength(1)
			expect(held[0]).toMatchObject({
				lorebookId: own.id,
				entryId: vault.id,
				branchId: null,
				year: null,
				month: null,
				day: null,
				sourceMessageId: m.id,
				fields: {
					name: "The Strongroom",
					content: "Sealed.",
					category: "Vaults"
				},
				base: {
					name: { v: "The Vault" },
					content: { v: "The Vault, as written." },
					category: { v: "Rooms" }
				}
			})
			// Nothing was added to the attached lorebook.
			expect(
				await db
					.select()
					.from(schema.entryAmendments)
					.where(eq(schema.entryAmendments.lorebookId, w.book.id))
			).toEqual([])

			// The session reads it; another session of the lorebook and the lorebook itself do not.
			const mine = await readBy(w.session.id, vault.id)
			expect(mine).toMatchObject({
				name: "The Strongroom",
				content: "Sealed.",
				category: "Vaults"
			})
			expect(await nameBy(w.session.id, vault.id)).toBe("The Strongroom")
			expect(await readBy(other.id, vault.id)).toMatchObject({
				name: "The Vault",
				content: "The Vault, as written.",
				category: "Rooms"
			})
			expect(await nameBy(other.id, vault.id)).toBe("The Vault")
			expect(await readByBook(vault.id)).toMatchObject({
				name: "The Vault",
				category: "Rooms"
			})
		}
	)

	it("is dated when the session reads at a moment, undated otherwise", async () => {
		const w = await world({ clock: { year: 3, month: 2, day: 5 } })
		await messageIn(w.session.id)
		const vault = await place(w.book.id, "The Vault")
		await (
			await hostFor(w.session.id, w.user.id, `run-${w.suffix}`)
		).commit!({ entry: vault.id, fields: { category: "Vaults" } }, UPDATE)
		const [held] = await heldRows((await ownBookOf(w.session.id)).id)
		expect(held).toMatchObject({ year: 3, month: 2, day: 5 })
		expect((await readBy(w.session.id, vault.id)).category).toBe("Vaults")
	})

	it("two changes to one field in two turns: the second's base is the first's value", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		const m1 = await messageIn(w.session.id)
		await (
			await hostFor(w.session.id, w.user.id, "run-a")
		).commit!({ entry: vault.id, fields: { category: "Vaults" } }, UPDATE)
		const m2 = await messageIn(w.session.id)
		await (
			await hostFor(w.session.id, w.user.id, "run-b")
		).commit!({ entry: vault.id, fields: { category: "Treasury" } }, UPDATE)
		const held = await heldRows((await ownBookOf(w.session.id)).id)
		expect(held.map((h) => [h.sourceMessageId, h.base, h.fields])).toEqual([
			[m1.id, { category: { v: "Rooms" } }, { category: "Vaults" }],
			[m2.id, { category: { v: "Vaults" } }, { category: "Treasury" }]
		])
		expect((await readBy(w.session.id, vault.id)).category).toBe("Treasury")
	})

	it("a change that changes nothing writes nothing", async () => {
		const w = await world()
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const host = await hostFor(w.session.id, w.user.id, "run-same")
		await host.commit!(
			{
				entry: vault.id,
				content: "The Vault, as written.",
				fields: { category: "Rooms" }
			},
			UPDATE
		)
		const own = await ownBookOf(w.session.id)
		expect(await heldRows(own.id)).toEqual([])
		// Only the key that differs is kept.
		await host.commit!(
			{
				entry: vault.id,
				content: "The Vault, as written.",
				fields: { category: "Vaults" }
			},
			UPDATE
		)
		const [held] = await heldRows(own.id)
		expect(held!.fields).toEqual({ category: "Vaults" })
		expect(held!.base).toEqual({ category: { v: "Rooms" } })
		// Saying again what the session already reads changes nothing.
		await host.commit!(
			{ entry: vault.id, fields: { category: "Vaults" } },
			UPDATE
		)
		expect(await heldRows(own.id)).toHaveLength(1)
	})

	it("a change to an entry of the session's own book is written as before, with its imprint", async () => {
		const w = await world({ mode: "review" })
		await messageIn(w.session.id)
		const host = await hostFor(w.session.id, w.user.id, "run-own")
		const filed: any = await host.commit!(
			{
				name: "A gull",
				content: "It watches.",
				params: { entryType: LOCATION_TYPE_ID }
			},
			CREATE
		)
		expect(filed.route).toBe("own-book")
		const out: any = await host.commit!(
			{
				entry: filed.id,
				content: "It steals a fish.",
				fields: { category: "Birds" }
			},
			UPDATE
		)
		expect(out).toMatchObject({ entryId: filed.id, route: "own-book" })
		const row = await stored(filed.id)
		expect(row.content).toBe("It steals a fish.")
		expect((row.fields as any).category).toBe("Birds")
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toEqual([])
		const imprints = await db
			.select()
			.from(schema.loreImprints)
			.where(eq(schema.loreImprints.subjectId, filed.id))
		expect(imprints.map((i) => i.field)).toHaveLength(3)
		expect(imprints.map((i) => i.field)).toEqual(
			expect.arrayContaining([null, "content", "fields.category"])
		)
	})

	it("a match of create-lore-entry that finds an attached entry holds the change and forks no line", async () => {
		const w = await world()
		await db
			.update(schema.sessions)
			.set({ lineOnFirstWrite: true })
			.where(eq(schema.sessions.id, w.session.id))
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		const out: any = await (
			await hostFor(w.session.id, w.user.id, "run-match")
		).commit!(
			{
				name: "The Vault",
				content: "Sealed.",
				params: { entryType: LOCATION_TYPE_ID },
				match: { name: "The Vault" }
			},
			CREATE
		)
		expect(out).toMatchObject({
			entryId: vault.id,
			matched: true,
			written: false,
			route: "own-book",
			lorebookId: w.book.id
		})
		expect((await stored(vault.id)).content).toBe("The Vault, as written.")
		const [session] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(session).toMatchObject({
			lorebookBranchId: null,
			lineOnFirstWrite: true
		})
		expect(
			await db
				.select()
				.from(schema.lorebookBranches)
				.where(eq(schema.lorebookBranches.lorebookId, w.book.id))
		).toEqual([])
		const [held] = await heldRows((await ownBookOf(w.session.id)).id)
		expect(held).toMatchObject({
			entryId: vault.id,
			fields: { content: "Sealed." }
		})
	})

	it("refuses a change that would move a history entry's date, with the sentence, and writes nothing", async () => {
		const w = await world()
		await messageIn(w.session.id)
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Fall",
				content: "It fell.",
				fields: { year: 2, month: 1, day: 1 }
			})
			.returning()
		await expect(
			(await hostFor(w.session.id, w.user.id, "run-date")).commit!(
				{ entry: day!.id, fields: { year: 3, month: 1, day: 1 } },
				UPDATE
			)
		).rejects.toThrow(
			"change: 'The Fall' keeps its date in the lorebook, and a session's change cannot move it — change it in the lorebook."
		)
		expect(await heldRows((await ownBookOf(w.session.id)).id)).toEqual([])
		expect((await stored(day!.id)).fields).toMatchObject({ year: 2 })
	})

	it("a member's session on someone else's lorebook holds its change the same way", async () => {
		const owner = await world()
		const vault = await place(owner.book.id, "The Vault")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(db, `held-member-${++n}`)
		await db
			.insert(schema.userSettings)
			.values({ userId: member.id, loreWriteMode: "full" })
		const session = await sessionOn(member.id, owner.book.id)
		await messageIn(session.id)
		const out: any = await (
			await hostFor(session.id, member.id, `run-member-${n}`)
		).commit!({ entry: vault.id, fields: { category: "Vaults" } }, UPDATE)
		expect(out).toMatchObject({
			entryId: vault.id,
			lorebookId: owner.book.id,
			route: "own-book"
		})
		expect((await stored(vault.id)).fields).toMatchObject({
			category: "Rooms"
		})
		const own = await ownBookOf(session.id)
		expect(await heldRows(own.id)).toHaveLength(1)
		expect((await readBy(session.id, vault.id)).category).toBe("Vaults")
		expect((await readBy(owner.session.id, vault.id)).category).toBe(
			"Rooms"
		)
	})
})

describe("the names vocabulary", () => {
	it("a held name is the holder's alone", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const other = await sessionOn(w.user.id, w.book.id)
		const vault = await place(w.book.id, "The Vault")
		await messageIn(w.session.id)
		await (
			await hostFor(w.session.id, w.user.id, "run-names")
		).commit!({ entry: vault.id, name: "The Strongroom" }, UPDATE)
		const ownA = await ownBookOf(w.session.id)
		const ownB = await ownBookOf(other.id)
		const d = db as unknown as Db
		expect(
			(
				await loadVocabulary(d, w.book.id, { holderBookId: ownA.id })
			).gazetteer.byName.has("the strongroom")
		).toBe(true)
		expect(
			(
				await loadVocabulary(d, w.book.id, { holderBookId: ownB.id })
			).gazetteer.byName.has("the strongroom")
		).toBe(false)
		expect(
			(await loadVocabulary(d, w.book.id)).gazetteer.byName.has(
				"the strongroom"
			)
		).toBe(false)
		expect(
			(
				await loadVocabulary(d, w.book.id, { holderBookId: ownA.id })
			).gazetteer.byName.has("the vault")
		).toBe(true)
	})
})
