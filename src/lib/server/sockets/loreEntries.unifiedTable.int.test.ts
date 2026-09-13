/**
 * One socket namespace writes one table, and the type decides the rest.
 *
 * `world_lore_entries`, `character_lore_entries` and `history_entries` are gone
 * as readers; `lorebook_entries` is the source of truth and `entries:*` is the
 * one door to it. What this file checks is the seam: an entry created through
 * `entries:create` lands as a row of the type its payload named, with the right
 * `fields`, and comes back out as `LorebookEntry<thatType>` — including the
 * refusals the three separate namespaces used to get from having three separate
 * tables.
 *
 * The `fields` half carries the rule that has no column to protect it any
 * more: `graphed` and `isCompleted` are machine-written by the graph builder
 * and the summarizer *concurrently with* a user editing `content`, so every
 * writer merges into the jsonb and none replaces it. As columns a partial
 * `UPDATE` was safe; here a whole-object write from either side silently
 * discards the other's, which is why the merge is asserted rather than assumed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	mergeFields,
	type LorebookEntry
} from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lore-unified-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

/** The stored row behind a wire id, whatever type it claims to be. */
async function storedRow(id: number) {
	const [row] = await testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, id))
	return row
}

describe("an entry written through entries:create lands in lorebook_entries", () => {
	test("a world lore payload stores core:entry/world-lore, with category and priority in fields", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("unified-world-user")
		const lorebook = await makeLorebook(user.id, "Unified World Book")

		const created = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "  The Ashguard  ",
					content: "  Riders who patrol the ash wastes.  ",
					keys: "ashguard, riders",
					category: "factions",
					priority: 3
				} as any
			},
			noopEmit
		)

		// ⚠ The narrowing is the point, not ceremony. `entry` comes back as
		// `LorebookEntry` — the union of every declared shape — and reading
		// `category` off it without saying which type this is is exactly what
		// the brand refuses. The type id in the payload is what justifies it.
		const worldLoreEntry = created.entry as LorebookEntry<
			typeof WORLD_LORE_TYPE_ID
		>
		const row = await storedRow(worldLoreEntry.id)
		expect(row.typeId).toBe(WORLD_LORE_TYPE_ID)
		expect(row.typeVersion).toBe(1)
		expect(row.title).toBe("The Ashguard")
		// Tier one is what the engine reads for every type without asking a
		// declaration; `category` and `priority` are asked for by name only by
		// the type that declares them.
		expect(row.fields).toEqual({ category: "factions", priority: 3 })
		// `text[]`, so a delimiter-containing keyword is representable at last
		// — and the wire still gets the delimited string it always got.
		expect(row.keys).toEqual(["ashguard", "riders"])
		expect(worldLoreEntry.keys).toBe("ashguard, riders")
		expect(worldLoreEntry.name).toBe("The Ashguard")
		expect(worldLoreEntry.category).toBe("factions")
		expect(worldLoreEntry.priority).toBe(3)
	})

	test("a character lore payload stores core:entry/character-lore, anchored to its binding", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("unified-character-user")
		const lorebook = await makeLorebook(user.id, "Unified Character Book")
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: lorebook.id, binding: "{{char:1}}" })
			.returning()

		const { entry: characterLoreEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: CHARACTER_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					lorebookBindingId: binding.id,
					name: "Vell's oath",
					content: "She swore it twice.",
					priority: 2
				} as any
			},
			noopEmit
		)

		const characterLore = characterLoreEntry as LorebookEntry<
			typeof CHARACTER_LORE_TYPE_ID
		>
		const row = await storedRow(characterLoreEntry.id)
		expect(row.typeId).toBe(CHARACTER_LORE_TYPE_ID)
		expect(row.fields).toEqual({ priority: 2 })
		// The privacy anchor is a real column and a real foreign key, because a
		// reference has to be one — the wire keeps the old property name.
		expect(row.anchorBindingId).toBe(binding.id)
		expect(characterLore.lorebookBindingId).toBe(binding.id)
	})

	test("a history payload stores core:entry/history, with the date in fields and no title", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("unified-history-user")
		const lorebook = await makeLorebook(user.id, "Unified History Book")

		const { entry: historyEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "The wall fell.",
					year: 1204,
					month: 3,
					day: 7
				} as any
			},
			noopEmit
		)

		const row = await storedRow(historyEntry.id)
		expect(row.typeId).toBe(HISTORY_TYPE_ID)
		// A history entry is not named, it is *dated* — its heading is the date.
		expect(row.title).toBeNull()
		expect(row.fields).toEqual({
			year: 1204,
			month: 3,
			day: 7,
			isCompleted: false,
			graphed: false
		})
		const dated = historyEntry as LorebookEntry<typeof HISTORY_TYPE_ID>
		expect(dated.year).toBe(1204)
		expect(dated.month).toBe(3)
		expect(dated.day).toBe(7)
	})

	test("a month left out is an absent key, not a JSON null", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("unified-history-absent-user")
		const lorebook = await makeLorebook(user.id, "Absent Month Book")

		const { entry: historyEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "Some year, anyway.",
					year: 900
				} as any
			},
			noopEmit
		)

		// Absent rather than null — the state the rest of the system agrees on,
		// and the one history's missing `priority` depends on meaning *no
		// bonus* rather than *1*.
		const row = await storedRow(historyEntry.id)
		expect(Object.keys(row.fields).sort()).toEqual([
			"graphed",
			"isCompleted",
			"year"
		])
		expect(
			(historyEntry as LorebookEntry<typeof HISTORY_TYPE_ID>).month
		).toBeNull()
	})
})

describe("fields is merged, never replaced", () => {
	test("a machine writer setting graphed does not clobber a concurrent content edit", async () => {
		const { createEntryHandler, updateEntryHandler } = await import(
			"./entries"
		)
		const user = await makeUser("unified-merge-user")
		const lorebook = await makeLorebook(user.id, "Merge Book")

		const { entry: historyEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "A draft.",
					year: 1000
				} as any
			},
			noopEmit
		)

		// The summarizer's half, through the socket the compile flow saves by.
		await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					id: historyEntry.id,
					content: "Written up properly.",
					isCompleted: true
				} as any
			},
			noopEmit
		)

		// The graph builder's half, which writes `fields` directly and touches
		// nothing else — the exact statement narrativeGraph.ts issues.
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: mergeFields({ graphed: true }) })
			.where(eq(schema.lorebookEntries.id, historyEntry.id))

		const row = await storedRow(historyEntry.id)
		// Neither writer erased the other, and neither erased the date.
		expect(row.fields).toEqual({
			year: 1000,
			isCompleted: true,
			graphed: true
		})
		expect(row.content).toBe("Written up properly.")
	})

	test("a user editing content afterwards leaves both machine flags alone", async () => {
		const { createEntryHandler, updateEntryHandler } = await import(
			"./entries"
		)
		const user = await makeUser("unified-merge-back-user")
		const lorebook = await makeLorebook(user.id, "Merge Back Book")

		const { entry: historyEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "A draft.",
					year: 1000,
					isCompleted: true
				} as any
			},
			noopEmit
		)
		await testDb
			.update(schema.lorebookEntries)
			.set({ fields: mergeFields({ graphed: true }) })
			.where(eq(schema.lorebookEntries.id, historyEntry.id))

		// A content-only edit, which is what the manager sends when somebody
		// types in the box and saves.
		await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					id: historyEntry.id,
					content: "Rewritten by hand."
				} as any
			},
			noopEmit
		)

		const row = await storedRow(historyEntry.id)
		expect(row.fields).toEqual({
			year: 1000,
			isCompleted: true,
			graphed: true
		})
	})
})

describe("a payload only reaches the type it names", () => {
	test("entries:update with a world lore typeId refuses a character lore id", async () => {
		const { createEntryHandler, updateEntryHandler } = await import(
			"./entries"
		)
		const user = await makeUser("unified-crosstype-user")
		const lorebook = await makeLorebook(user.id, "Cross Type Book")
		const [binding] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: lorebook.id, binding: "{{char:1}}" })
			.returning()

		const { entry: characterLoreEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: CHARACTER_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					lorebookBindingId: binding.id,
					name: "Private",
					content: "Nobody else's business."
				} as any
			},
			noopEmit
		)

		// One table means one id space, so "not found" is enforced by the
		// `typeId` in the payload rather than by which table was queried —
		// which is the guard the three separate namespaces used to get for
		// free, and the reason every payload names its type.
		await expect(
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: WORLD_LORE_TYPE_ID,
						id: characterLoreEntry.id,
						content: "Reached through the wrong type."
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(/not found or access denied/)

		const row = await storedRow(characterLoreEntry.id)
		expect(row.content).toBe("Nobody else's business.")
	})

	test("entries:list is scoped to the type it asks for", async () => {
		const { createEntryHandler, entryListHandler } = await import(
			"./entries"
		)
		const user = await makeUser("unified-list-user")
		const lorebook = await makeLorebook(user.id, "Mixed Book")

		await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "A place",
					content: "Somewhere."
				} as any
			},
			noopEmit
		)
		await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "Something happened.",
					year: 1
				} as any
			},
			noopEmit
		)

		const world = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, typeId: WORLD_LORE_TYPE_ID },
			noopEmit
		)
		const history = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, typeId: HISTORY_TYPE_ID },
			noopEmit
		)
		expect(world.entryList.map((e) => e.name)).toEqual(["A place"])
		expect(history.entryList).toHaveLength(1)
		expect(history.entryList[0].content).toBe("Something happened.")
	})

	test("position is allocated per type, so two types can share one slot", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("unified-position-user")
		const lorebook = await makeLorebook(user.id, "Shared Slot Book")

		const create = async (entry: Record<string, any>) =>
			(
				await createEntryHandler.handler(
					fakeSocket(user.id),
					{ entry: entry as any },
					noopEmit
				)
			).entry

		// ⚠ Two allocators, and the `order` role is what picks between them. A
		// type with an authored sequence — history — **appends** past the last
		// row; one without takes the **first free slot**, which is what reuses
		// the hole a delete left. Both are what the namespace that owned each
		// type did before they collapsed.
		const world1 = await create({
			typeId: WORLD_LORE_TYPE_ID,
			lorebookId: lorebook.id,
			name: "First",
			content: ""
		})
		const world2 = await create({
			typeId: WORLD_LORE_TYPE_ID,
			lorebookId: lorebook.id,
			name: "Second",
			content: "",
			// Ignored: `position` is on the create denylist for every type now.
			// The three namespaces disagreed about that — history took a
			// client-supplied slot and the two lore namespaces did not.
			position: 900
		})
		expect([world1.position, world2.position]).toEqual([1, 2])

		const history1 = await create({
			typeId: HISTORY_TYPE_ID,
			lorebookId: lorebook.id,
			content: "",
			year: 1
		})
		const history2 = await create({
			typeId: HISTORY_TYPE_ID,
			lorebookId: lorebook.id,
			content: "",
			year: 2
		})
		expect([history1.position, history2.position]).toEqual([0, 1])

		// Unique per `(lorebook, type)` and not per lorebook: the three tables
		// could each hold position 1 in one book, and per-book uniqueness would
		// have silently reordered every existing lorebook on the way in.
		expect(history2.position).toBe(world1.position)
		const rows = await testDb
			.select({
				typeId: schema.lorebookEntries.typeId,
				position: schema.lorebookEntries.position
			})
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebook.id))
		expect(rows).toHaveLength(4)
	})

	test("an update clears the entry's vectors, so the queue re-embeds it", async () => {
		const { createEntryHandler, updateEntryHandler } = await import(
			"./entries"
		)
		const { seedEntryVectors } = await import(
			"$lib/server/pipelines/testing/fixtures"
		)
		const user = await makeUser("unified-clearvec-user")
		const lorebook = await makeLorebook(user.id, "Clear Vector Book")

		const { entry: worldLoreEntry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "Vectored",
					content: "before"
				} as any
			},
			noopEmit
		)
		await seedEntryVectors(
			testDb,
			[worldLoreEntry.id],
			[1, 0, 0],
			"test-model"
		)

		await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					id: worldLoreEntry.id,
					content: "after"
				} as any
			},
			noopEmit
		)

		// The legacy update nulled `embedding`/`embeddingModel`/`vectorizedAt`
		// on the row so a vector of text that no longer exists could not go on
		// matching. Deleting the rows is the same statement in the shape the
		// vectors live in now.
		const vectors = await testDb
			.select()
			.from(schema.lorebookEntryVectors)
			.where(
				and(eq(schema.lorebookEntryVectors.entryId, worldLoreEntry.id))
			)
		expect(vectors).toHaveLength(0)
	})
})

/**
 * A reorder is a permutation, and it has to land through a **plain** UNIQUE.
 *
 * `lorebook_entries_position_uq` is not deferrable — an earlier lane made it so
 * from the boot projector and that was rejected, because Drizzle cannot declare
 * `DEFERRABLE` and the declared schema would then have permanently disagreed
 * with the database. So the constraint is checked as every single index tuple
 * lands, and a renumber that is valid only at COMMIT is not good enough here.
 *
 * ⚠ **Every case below is a genuine permutation**: at least one intermediate
 * state of a naive row-by-row rewrite duplicates a position. Moving one row to
 * the end would prove nothing — it has no colliding intermediate at all. The
 * handler survives them by parking the affected rows in a free range first and
 * placing them afterwards, so no single row ever collides.
 */
describe("a reorder is a permutation, and lands as one", () => {
	const WORLD = WORLD_LORE_TYPE_ID
	const HISTORY = HISTORY_TYPE_ID

	/** `n` world-lore entries, named and created through the real handler. */
	async function seedWorld(
		userId: number,
		lorebookId: number,
		names: string[]
	) {
		const { createEntryHandler } = await import("./entries")
		const created = []
		for (const name of names)
			created.push(
				(
					await createEntryHandler.handler(
						fakeSocket(userId),
						{
							entry: {
								typeId: WORLD,
								lorebookId,
								name,
								content: ""
							} as any
						},
						noopEmit
					)
				).entry
			)
		return created
	}

	/** Name → position, straight off the stored rows. */
	async function positionsOf(lorebookId: number, typeId: string) {
		const rows = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					eq(schema.lorebookEntries.typeId, typeId)
				)
			)
		return new Map(rows.map((r) => [r.title ?? r.content, r.position]))
	}

	test("reverses a five-entry list, which collides at every intermediate row", async () => {
		const { updateEntryPositionsHandler } = await import("./entries")
		const user = await makeUser("unified-reorder-user")
		const lorebook = await makeLorebook(user.id, "Reorder Book")
		const names = ["A", "B", "C", "D", "E"]
		const created = await seedWorld(user.id, lorebook.id, names)
		expect(created.map((e) => e.position)).toEqual([1, 2, 3, 4, 5])

		// A full reversal: A→5 lands on E, B→4 lands on D, and so on. There is
		// no order in which these five writes can be issued one at a time
		// without some row briefly sharing a slot with another.
		await updateEntryPositionsHandler.handler(
			fakeSocket(user.id),
			{
				lorebookId: lorebook.id,
				typeId: WORLD,
				positions: created.map((e, i) => ({
					id: e.id,
					position: names.length - i
				}))
			},
			noopEmit
		)

		const after = await positionsOf(lorebook.id, WORLD)
		expect(names.map((n) => after.get(n))).toEqual([5, 4, 3, 2, 1])
	})

	test("moves an entry up, then moves one down, through the same door", async () => {
		const { updateEntryPositionsHandler } = await import("./entries")
		const user = await makeUser("unified-rotate-user")
		const lorebook = await makeLorebook(user.id, "Rotate Book")
		const created = await seedWorld(user.id, lorebook.id, [
			"A",
			"B",
			"C",
			"D"
		])
		const byName = new Map(created.map((e) => [e.name as string, e]))
		const reorder = (order: string[]) =>
			updateEntryPositionsHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					typeId: WORLD,
					positions: order.map((n, i) => ({
						id: byName.get(n)!.id,
						position: i + 1
					}))
				},
				noopEmit
			)

		// Up: D dragged to the front. D→1 collides with A before A vacates it.
		await reorder(["D", "A", "B", "C"])
		let after = await positionsOf(lorebook.id, WORLD)
		expect(["A", "B", "C", "D"].map((n) => after.get(n))).toEqual([
			2, 3, 4, 1
		])

		// Down: the same list again with A dragged to the end — the mirror of
		// the move above, and the direction a one-way fix would have missed.
		await reorder(["B", "C", "D", "A"])
		after = await positionsOf(lorebook.id, WORLD)
		expect(["A", "B", "C", "D"].map((n) => after.get(n))).toEqual([
			4, 1, 2, 3
		])
	})

	test("a reorder whose finals overlap the staging range still lands", async () => {
		const { updateEntryPositionsHandler } = await import("./entries")
		const user = await makeUser("unified-reorder-low-user")
		const lorebook = await makeLorebook(user.id, "Low Book")
		const created = await seedWorld(user.id, lorebook.id, ["A", "B", "C"])
		const move = (positions: number[]) =>
			updateEntryPositionsHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					typeId: WORLD,
					positions: created.map((e, i) => ({
						id: e.id,
						position: positions[i]
					}))
				},
				noopEmit
			)

		// Lift the list clear of the low numbers first, so the next reorder
		// aims *below* where the rows currently sit.
		await move([5, 6, 7])

		// ⚠ The case a staging range chosen from the live rows alone gets
		// wrong. Parked just under 5 the three rows would sit at 4, 3, 2 — and
		// A's final is 2, so placing A would land on C, which has not moved
		// yet. The range has to clear the requested finals too.
		await move([2, 4, 3])

		const after = await positionsOf(lorebook.id, WORLD)
		expect(["A", "B", "C"].map((n) => after.get(n))).toEqual([2, 4, 3])
	})

	test("refuses a reorder that asks two entries for one slot, and keeps the old order", async () => {
		const { updateEntryPositionsHandler } = await import("./entries")
		const user = await makeUser("unified-reorder-dupe-user")
		const lorebook = await makeLorebook(user.id, "Dupe Book")
		const created = await seedWorld(user.id, lorebook.id, ["A", "B", "C"])

		// The constraint is a real integrity guarantee, not scaffolding the
		// staging pass exists to tiptoe around: an end state with a duplicate
		// is still refused, and refused as one unit.
		await expect(
			updateEntryPositionsHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: lorebook.id,
					typeId: WORLD,
					positions: [
						{ id: created[0].id, position: 2 },
						{ id: created[1].id, position: 2 },
						{ id: created[2].id, position: 3 }
					]
				},
				noopEmit
			)
		).rejects.toThrow()

		const after = await positionsOf(lorebook.id, WORLD)
		expect(["A", "B", "C"].map((n) => after.get(n))).toEqual([1, 2, 3])
	})

	test("the position constraint still refuses a duplicate outright", async () => {
		const user = await makeUser("unified-position-uq-user")
		const lorebook = await makeLorebook(user.id, "Uniqueness Book")
		await seedWorld(user.id, lorebook.id, ["A"])

		// Not decoration, and not deferred: a second row in the same
		// (lorebook, type) at a taken slot fails on the insert itself.
		await expect(
			testDb.insert(schema.lorebookEntries).values({
				lorebookId: lorebook.id,
				typeId: WORLD,
				typeVersion: 1,
				position: 1,
				content: "collides",
				fields: {}
			})
		).rejects.toThrow(/lorebook_entries_position_uq|duplicate key/i)
	})

	test("entries:iterateNext shifts a contiguous run forward", async () => {
		const {
			createEntryHandler,
			iterateNextEntryHandler,
			entryListHandler
		} = await import("./entries")
		const user = await makeUser("unified-iterate-user")
		const lorebook = await makeLorebook(user.id, "Iterate Book")

		// Appended, one after another — the allocator an ordered type gets.
		const dated = []
		for (const content of ["one", "two", "three", "four"])
			dated.push(
				(
					await createEntryHandler.handler(
						fakeSocket(user.id),
						{
							entry: {
								typeId: HISTORY,
								lorebookId: lorebook.id,
								content,
								year: 1
							} as any
						},
						noopEmit
					)
				).entry
			)
		expect(dated.map((e) => e.position)).toEqual([0, 1, 2, 3])

		// Inserted after the *first* of four, so three rows have to move — a
		// run whose straight `SET position = position + 1` duplicates a slot on
		// its way to a finished state that does not.
		await iterateNextEntryHandler.handler(
			fakeSocket(user.id),
			{ id: dated[0].id, typeId: HISTORY },
			noopEmit
		)

		const { entryList } = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id, typeId: HISTORY },
			noopEmit
		)
		expect(entryList.map((e) => e.position)).toEqual([0, 1, 2, 3, 4])
		expect(new Set(entryList.map((e) => e.position)).size).toBe(5)
		// The blank new row sits where it was asked to, and nothing else moved
		// past anything else.
		expect(entryList.map((e) => e.content)).toEqual([
			"one",
			"",
			"two",
			"three",
			"four"
		])
	})
})

/**
 * The matcher set's newest members, through the door a person actually uses.
 *
 * `secondary_keys` and `selective_logic` are columns rather than declared
 * `fields`, because they are what the engine reads for every type without
 * consulting a declaration — the same tier as `keys`, `match_mode` and
 * `case_sensitive`. Columns have to be carried by hand through `entryInsert`,
 * `toEntryRow` and `splitUpdate`, and a field missed in any one of those is a
 * control that saves and comes back empty with nothing to report it.
 */
describe("an entry's condition round-trips through the socket", () => {
	test("stores the pair as authored and hands back the delimited string", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("condition-create-user")
		const lorebook = await makeLorebook(user.id, "Condition Book")

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "Dragon",
					content: "A dragon, not a carving of one.",
					keys: "dragon",
					secondaryKeys: "statue, mural",
					selectiveLogic: "notAny"
				} as any
			},
			noopEmit
		)

		const row = await storedRow(entry.id)
		expect(row.secondaryKeys).toEqual(["statue", "mural"])
		expect(row.selectiveLogic).toBe("notAny")
		expect(entry.secondaryKeys).toBe("statue, mural")
		expect(entry.selectiveLogic).toBe("notAny")
	})

	test("an entry that says nothing about it stores no condition at all", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("condition-absent-user")
		const lorebook = await makeLorebook(user.id, "No Condition Book")

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "Ashguard",
					content: "Riders.",
					keys: "ashguard"
				} as any
			},
			noopEmit
		)

		const row = await storedRow(entry.id)
		// The pair that means "no condition" — either half alone would be a
		// rule about nothing, and the matcher tests both.
		expect(row.secondaryKeys).toEqual([])
		expect(row.selectiveLogic).toBeNull()
	})

	test("clearing the mode clears it, rather than storing an empty string", async () => {
		const { createEntryHandler, updateEntryHandler } = await import(
			"./entries"
		)
		const user = await makeUser("condition-clear-user")
		const lorebook = await makeLorebook(user.id, "Clear Condition Book")

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "Dragon",
					content: "A dragon.",
					keys: "dragon",
					secondaryKeys: "statue",
					selectiveLogic: "notAny"
				} as any
			},
			noopEmit
		)

		const { entry: cleared } = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					id: entry.id,
					typeId: WORLD_LORE_TYPE_ID,
					secondaryKeys: "",
					selectiveLogic: null
				} as any
			},
			noopEmit
		)

		const row = await storedRow(cleared.id)
		// `""` is the absence of a mode and has to survive as NULL — a stored
		// empty string would be a fifth mode nothing implements.
		expect(row.selectiveLogic).toBeNull()
		expect(row.secondaryKeys).toEqual([])
	})
})
