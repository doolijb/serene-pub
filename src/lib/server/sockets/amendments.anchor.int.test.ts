/**
 * A dated re-parent is checked like a re-parent (plan B0, places-graph
 * 2026-09-29).
 *
 * `entries:update` refuses an `anchorEntryId` in another book, a missing one,
 * the entry itself, and one whose chain of parents leads back to the entry.
 * An amendment's `fields` can carry the same key — "Save as of" on the Part
 * of picker — and `cleanFields` passed it through unchecked, for every entry
 * type. So a dated overlay could file an entry under its own child, or under
 * another user's entry, at a moment. It goes through the same
 * `assertAnchorEntry` now, on create and on update.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CHARACTER_LORE_TYPE_ID, ITEM_TYPE_ID, LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-amendments-anchor-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let n = 0

async function book() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `amend-anchor-${suffix}`)
	const [lorebook] = await testDb.insert(schema.lorebooks).values({ userId: user.id, name: `Umber ${suffix}` }).returning()
	let position = 0
	const entry = async (title: string, over: Record<string, unknown> = {}) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook!.id,
					typeId: WORLD_LORE_TYPE_ID,
					typeVersion: 1,
					position: position++,
					title,
					content: "…",
					...over
				} as any)
				.returning()
		)[0]!
	return { user, lorebook: lorebook!, entry }
}

const create = async (userId: number, params: Record<string, unknown>) => {
	const { amendmentsCreateHandler } = await import("./amendments")
	return amendmentsCreateHandler.handler(fakeSocket(userId), { year: 1200, ...params } as any, noopEmit)
}

const update = async (userId: number, params: Record<string, unknown>) => {
	const { amendmentsUpdateHandler } = await import("./amendments")
	return amendmentsUpdateHandler.handler(fakeSocket(userId), params as any, noopEmit)
}

const amendmentsOf = (entryId: number) =>
	testDb.select().from(schema.entryAmendments).where(eq(schema.entryAmendments.entryId, entryId))

describe("amendments:create — an overlaid anchorEntryId", () => {
	test("a dated re-parent into a cycle is refused", async () => {
		const b = await book()
		const city = await b.entry("Umber City")
		const docks = await b.entry("The Docks", { anchorEntryId: city.id })
		const pier = await b.entry("Pier Nine", { anchorEntryId: docks.id })

		// The city filed under its own grandchild, as of 1200.
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: city.id, fields: { anchorEntryId: pier.id } })
		).rejects.toThrow(/under one of its own children/)
		// And under itself.
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: city.id, fields: { anchorEntryId: city.id } })
		).rejects.toThrow(/under itself/)
		expect(await amendmentsOf(city.id)).toEqual([])
	})

	test("a parent in another book, or none at all, is refused", async () => {
		const b = await book()
		const other = await book()
		const docks = await b.entry("The Docks")
		const foreign = await other.entry("Far Tower")
		for (const anchorEntryId of [foreign.id, 987_654_321])
			await expect(
				create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, fields: { anchorEntryId } })
			).rejects.toThrow(/Parent entry not found/)
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, fields: { anchorEntryId: "the city" } })
		).rejects.toThrow(/not an entry/)
		expect(await amendmentsOf(docks.id)).toEqual([])
	})

	test("every entry type is checked, an item included", async () => {
		const b = await book()
		const chest = await b.entry("The Chest", { typeId: ITEM_TYPE_ID })
		const key = await b.entry("The Key", { typeId: ITEM_TYPE_ID, anchorEntryId: chest.id })
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: chest.id, fields: { anchorEntryId: key.id } })
		).rejects.toThrow(/under one of its own children/)
	})

	test("a place is never filed, not even as of a date (places plan B2)", async () => {
		// `core:entry/location@1` declares no `parent` field role, so a dated
		// Part of on a place is refused by the role map, whatever it names.
		const b = await book()
		const keep = await b.entry("The Keep", { typeId: LOCATION_TYPE_ID })
		const region = await b.entry("The Reach")
		const cellar = await b.entry("The Cellar", { typeId: LOCATION_TYPE_ID })
		for (const parent of [keep.id, region.id])
			await expect(
				create(b.user.id, { lorebookId: b.lorebook.id, entryId: cellar.id, fields: { anchorEntryId: parent } })
			).rejects.toThrow(/Places are never filed inside anything/)
		expect(await amendmentsOf(cellar.id)).toEqual([])
		// A dated unfiling names nothing, so it is not a filing.
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: cellar.id, fields: { anchorEntryId: null } })
	})

	test("a sound dated re-parent, and a dated unfiling, still save", async () => {
		const b = await book()
		const city = await b.entry("Umber City")
		const harbor = await b.entry("The Harbor")
		const docks = await b.entry("The Docks", { anchorEntryId: city.id })
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, fields: { anchorEntryId: harbor.id } })
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, year: 1300, fields: { anchorEntryId: null } })
		const rows = await amendmentsOf(docks.id)
		expect(rows.map((r) => (r.fields as Record<string, unknown>).anchorEntryId).sort()).toEqual([harbor.id, null].sort())
	})

	test("on a fork, a parent that exists only on that fork is sound; one on another fork is not", async () => {
		const b = await book()
		const [fork, sibling] = await testDb
			.insert(schema.lorebookBranches)
			.values([
				{ lorebookId: b.lorebook.id, name: `What if ${n}` },
				{ lorebookId: b.lorebook.id, name: `Or else ${n}` }
			])
			.returning()
		const docks = await b.entry("The Docks")
		const forkOnly = await b.entry("The Fork's Tower", { branchId: fork!.id })
		const siblingOnly = await b.entry("The Sibling's Tower", { branchId: sibling!.id })
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, branchId: fork!.id, fields: { anchorEntryId: forkOnly.id } })
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: docks.id, branchId: fork!.id, fields: { anchorEntryId: siblingOnly.id } })
		).rejects.toThrow(/another line/)
	})
})

describe("amendments:create — the line an overlay reads", () => {
	test("on a fork of a fork, a parent the ancestor fork holds is sound", async () => {
		// An overlay never cascades — it is not `anchor_entry_id` — so the
		// line rule it answers to is the reading's: whatever the amendment's
		// line can see, its ancestor forks' own rows included. The editor
		// offers such a parent (`canFileUnder`); the server refused it.
		const b = await book()
		const [outer] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: `Outer ${n}` })
			.returning()
		const [inner, sibling] = await testDb
			.insert(schema.lorebookBranches)
			.values([
				{ lorebookId: b.lorebook.id, name: `Inner ${n}`, forkedFromBranchId: outer!.id },
				{ lorebookId: b.lorebook.id, name: `Beside ${n}` }
			])
			.returning()
		const tower = await b.entry("The Outer Tower", { branchId: outer!.id })
		const stair = await b.entry("The Outer Stair", { branchId: outer!.id })
		const besideOnly = await b.entry("The Other Tower", { branchId: sibling!.id })
		await create(b.user.id, {
			lorebookId: b.lorebook.id,
			entryId: stair.id,
			branchId: inner!.id,
			fields: { anchorEntryId: tower.id }
		})
		expect((await amendmentsOf(stair.id)).map((r) => (r.fields as Record<string, unknown>).anchorEntryId)).toEqual([
			tower.id
		])
		await expect(
			create(b.user.id, {
				lorebookId: b.lorebook.id,
				entryId: stair.id,
				branchId: inner!.id,
				year: 1300,
				fields: { anchorEntryId: besideOnly.id }
			})
		).rejects.toThrow(/another line/)
	})
})

describe("amendments:create — an overlaid lorebookBindingId", () => {
	test("a cast member of another book is refused; one of this book saves", async () => {
		const b = await book()
		const other = await book()
		const member = async (lorebookId: number, name: string) =>
			(
				await testDb
					.insert(schema.lorebookBindings)
					.values({ lorebookId, name, binding: `{{char:${name.length}${n}}}` })
					.returning()
			)[0]!
		const aria = await member(b.lorebook.id, "Aria")
		const stranger = await member(other.lorebook.id, "Stranger")
		const lore = await b.entry("Aria's secret", { typeId: CHARACTER_LORE_TYPE_ID })
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: lore.id, fields: { lorebookBindingId: stranger.id } })
		).rejects.toThrow("That cast member is not in this lorebook.")
		await expect(
			create(b.user.id, { lorebookId: b.lorebook.id, entryId: lore.id, fields: { lorebookBindingId: "Aria" } })
		).rejects.toThrow("That cast member is not in this lorebook.")
		expect(await amendmentsOf(lore.id)).toEqual([])
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: lore.id, fields: { lorebookBindingId: aria.id } })
		expect((await amendmentsOf(lore.id)).map((r) => (r.fields as Record<string, unknown>).lorebookBindingId)).toEqual([
			aria.id
		])
	})
})

describe("amendments:update — the same check", () => {
	test("re-pointing a stored amendment into a cycle is refused and leaves it as it was", async () => {
		const b = await book()
		const city = await b.entry("Umber City")
		const harbor = await b.entry("The Harbor")
		const docks = await b.entry("The Docks", { anchorEntryId: city.id })
		await create(b.user.id, { lorebookId: b.lorebook.id, entryId: city.id, fields: { anchorEntryId: harbor.id } })
		const [stored] = await amendmentsOf(city.id)
		await expect(
			update(b.user.id, { lorebookId: b.lorebook.id, subject: "entry", id: stored!.id, fields: { anchorEntryId: docks.id } })
		).rejects.toThrow(/under one of its own children/)
		const [after] = await amendmentsOf(city.id)
		expect((after!.fields as Record<string, unknown>).anchorEntryId).toBe(harbor.id)
	})
})
