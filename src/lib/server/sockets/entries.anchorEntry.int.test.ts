/**
 * "Part of": the re-parent, and the four ways it is refused.
 *
 * `anchor_entry_id` has been a column with no write path since it was declared
 * — `WritableColumns` excluded it and `splitUpdate` never emitted it — so the
 * tree the workspace draws could be read and never edited. It can be written
 * now, and the whole of the risk is in what the server refuses: a parent in
 * another lorebook, a parent that is not there, the entry itself, and a parent
 * whose own chain of parents comes back round to the entry being moved.
 *
 * `entries:counts` is here too, for its `places` figure: a place is a
 * `core:entry/location` entry (decided 2026-09-28), the Places board's rule.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
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
		path.join(os.tmpdir(), "serene-pub-anchor-entry-int-test-")
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

async function makeLorebook(userId: number, name = "Places") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

const create = async (
	userId: number,
	lorebookId: number,
	name: string,
	extra: Record<string, unknown> = {}
) => {
	const { createEntryHandler } = await import("./entries")
	const { entry } = await createEntryHandler.handler(
		fakeSocket(userId),
		{
			entry: {
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name,
				content: "",
				...extra
			}
		} as any,
		noopEmit
	)
	return entry
}

const update = async (userId: number, patch: Record<string, unknown>) => {
	const { updateEntryHandler } = await import("./entries")
	return updateEntryHandler.handler(
		fakeSocket(userId),
		{ entry: { typeId: WORLD_LORE_TYPE_ID, ...patch } } as any,
		noopEmit
	)
}

describe("anchorEntryId, the re-parent", () => {
	test("files an entry under another and reads it back", async () => {
		const user = await makeUser("anchor-reparent")
		const book = await makeLorebook(user.id)
		const city = await create(user.id, book.id, "Umber City")
		const district = await create(user.id, book.id, "The Docks")

		const { entry } = await update(user.id, {
			id: district.id,
			anchorEntryId: city.id
		})
		expect(entry.anchorEntryId).toBe(city.id)

		// And back to the top level, which is what null means.
		const { entry: root } = await update(user.id, {
			id: district.id,
			anchorEntryId: null
		})
		expect(root.anchorEntryId).toBeNull()
	}, 60_000)

	test("takes a parent on create", async () => {
		const user = await makeUser("anchor-create")
		const book = await makeLorebook(user.id)
		const city = await create(user.id, book.id, "Ash City")
		const district = await create(user.id, book.id, "Ash Docks", {
			anchorEntryId: city.id
		})
		expect(district.anchorEntryId).toBe(city.id)
	}, 60_000)

	test("refuses the entry itself", async () => {
		const user = await makeUser("anchor-self")
		const book = await makeLorebook(user.id)
		const city = await create(user.id, book.id, "Lone City")

		await expect(
			update(user.id, { id: city.id, anchorEntryId: city.id })
		).rejects.toThrow(/under itself/)
	}, 60_000)

	test("refuses a cycle", async () => {
		const user = await makeUser("anchor-cycle")
		const book = await makeLorebook(user.id)
		const region = await create(user.id, book.id, "The Reach")
		const city = await create(user.id, book.id, "Reach City")
		const district = await create(user.id, book.id, "Reach Docks")

		await update(user.id, { id: city.id, anchorEntryId: region.id })
		await update(user.id, { id: district.id, anchorEntryId: city.id })

		// Filing the region under its own grandchild closes the loop.
		await expect(
			update(user.id, { id: region.id, anchorEntryId: district.id })
		).rejects.toThrow(/own children/)

		const [unchanged] = await testDb
			.select({ anchorEntryId: schema.lorebookEntries.anchorEntryId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, region.id))
		expect(unchanged.anchorEntryId).toBeNull()
	}, 60_000)

	test("refuses a parent in another lorebook", async () => {
		const user = await makeUser("anchor-cross-book")
		const here = await makeLorebook(user.id, "Here")
		const elsewhere = await makeLorebook(user.id, "Elsewhere")
		const district = await create(user.id, here.id, "Local Docks")
		const foreign = await create(user.id, elsewhere.id, "Foreign City")

		await expect(
			update(user.id, { id: district.id, anchorEntryId: foreign.id })
		).rejects.toThrow(/Parent entry not found/)
	}, 60_000)

	test("refuses a parent that does not exist", async () => {
		const user = await makeUser("anchor-missing")
		const book = await makeLorebook(user.id)
		const district = await create(user.id, book.id, "Orphan Docks")

		await expect(
			update(user.id, { id: district.id, anchorEntryId: 9_999_999 })
		).rejects.toThrow(/Parent entry not found/)
	}, 60_000)
})

describe("a place is never filed under anything (places plan B2)", () => {
	// Owner ruling 2026-09-29: places join by relationships, never by
	// nesting. `core:entry/location@1` declares no `parent` field role, and
	// the server asks the role map — the refusal follows the declaration,
	// never a type id written into the handler.
	test("refuses a place filed under a place, or under world lore, on create and update", async () => {
		const user = await makeUser("anchor-place")
		const book = await makeLorebook(user.id)
		const keep = await create(user.id, book.id, "The Keep", {
			typeId: LOCATION_TYPE_ID
		})
		const region = await create(user.id, book.id, "The Reach")

		for (const parent of [keep.id, region.id])
			await expect(
				create(user.id, book.id, "The Cellar", {
					typeId: LOCATION_TYPE_ID,
					anchorEntryId: parent
				})
			).rejects.toThrow(/Places are never filed inside anything/)

		const cellar = await create(user.id, book.id, "The Cellar", {
			typeId: LOCATION_TYPE_ID
		})
		const { updateEntryHandler } = await import("./entries")
		for (const parent of [keep.id, region.id])
			await expect(
				updateEntryHandler.handler(
					fakeSocket(user.id),
					{
						entry: {
							typeId: LOCATION_TYPE_ID,
							id: cellar.id,
							anchorEntryId: parent
						}
					} as any,
					noopEmit
				)
			).rejects.toThrow(/Link them instead/)

		// The editor resends a place's (empty) Part of on every save: top
		// level is not a filing, so it still saves.
		const { entry } = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: LOCATION_TYPE_ID,
					id: cellar.id,
					anchorEntryId: null,
					content: "Damp."
				}
			} as any,
			noopEmit
		)
		expect(entry.anchorEntryId).toBeNull()
		expect(entry.content).toBe("Damp.")
	}, 60_000)

	// Owner 2026-10-02: history is always top level relative to other lore,
	// scoped by its line and date. `core:entry/history@1` declares no
	// `parent` (needs `npm run sdk:build` to reach the app).
	test("refuses a history entry filed under anything; lore may still sit under one", async () => {
		const user = await makeUser("anchor-history")
		const book = await makeLorebook(user.id)
		const city = await create(user.id, book.id, "Umber")
		await expect(
			create(user.id, book.id, "The Founding", {
				typeId: HISTORY_TYPE_ID,
				year: 1,
				anchorEntryId: city.id
			})
		).rejects.toThrow(/History entries are never filed inside anything/)

		const founding = await create(user.id, book.id, "The Founding", {
			typeId: HISTORY_TYPE_ID,
			year: 1
		})
		expect(founding.anchorEntryId ?? null).toBeNull()
		const { updateEntryHandler } = await import("./entries")
		await expect(
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: HISTORY_TYPE_ID,
						id: founding.id,
						anchorEntryId: city.id
					}
				} as any,
				noopEmit
			)
		).rejects.toThrow(/Link them instead/)

		// Other lore may still be filed under a history entry.
		const charter = await create(user.id, book.id, "The Charter", {
			anchorEntryId: founding.id
		})
		expect(charter.anchorEntryId).toBe(founding.id)
	}, 60_000)

	test("world lore under world lore still files", async () => {
		const user = await makeUser("anchor-lore-still")
		const book = await makeLorebook(user.id)
		const city = await create(user.id, book.id, "Umber")
		const district = await create(user.id, book.id, "Umber Docks", {
			anchorEntryId: city.id
		})
		expect(district.anchorEntryId).toBe(city.id)
	}, 60_000)
})

describe("the wire row's own two facts", () => {
	test("carries archived and provenance, and lets a client set only the first", async () => {
		const user = await makeUser("archived-provenance")
		const book = await makeLorebook(user.id, "Shelved")
		const entry = await create(user.id, book.id, "Old Note")

		// Projected on every row, at the column's own defaults.
		expect(entry.archived).toBe(false)
		expect(entry.provenance).toBe("human")

		const { entry: archived } = await update(user.id, {
			id: entry.id,
			archived: true
		})
		expect(archived.archived).toBe(true)

		// ⚠ Not writable: a payload claiming to be the summarizer is a payload
		// claiming a machine writer may overwrite what a person typed.
		const { entry: claimed } = await update(user.id, {
			id: entry.id,
			provenance: "summarizer"
		} as any)
		expect(claimed.provenance).toBe("human")
	}, 60_000)

	test("takes archived on create", async () => {
		const user = await makeUser("archived-on-create")
		const book = await makeLorebook(user.id, "Shelved Too")
		const entry = await create(user.id, book.id, "Born Shelved", {
			archived: true
		})
		expect(entry.archived).toBe(true)
	}, 60_000)
})

describe("entries:counts — places", () => {
	// Decided 2026-09-28: a place is a `core:entry/location` entry — one
	// definition for the rail's count and the Places board. Edges no longer
	// make an entry a place.
	test("counts location entries, and nothing an edge touches", async () => {
		const { entryCountsHandler } = await import("./entries")
		const { narrativeGraphCreateRelationshipHandler: createRelationship } =
			await import("./narrativeGraph")
		const user = await makeUser("counts-places")
		const book = await makeLorebook(user.id, "Mapped")

		const room = await create(user.id, book.id, "The Room", {
			typeId: LOCATION_TYPE_ID
		})
		await create(user.id, book.id, "The Tunnel", {
			typeId: LOCATION_TYPE_ID
		})
		await create(user.id, book.id, "Shelved Hall", {
			typeId: LOCATION_TYPE_ID,
			archived: true
		})
		const lore = await create(user.id, book.id, "A Road Story")

		// A travel edge between a location and a lore row: the lore row is
		// still not a place.
		await createRelationship.handler(
			fakeSocket(user.id),
			{
				lorebookId: book.id,
				relationshipType: "connects to",
				status: "active",
				from: { kind: "entry", entryId: room.id },
				to: { kind: "entry", entryId: lore.id }
			} as any,
			noopEmit
		)

		const { counts } = await entryCountsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id } as any,
			noopEmit
		)
		// The archived hall is out, as the default list leaves it out.
		expect(counts.places).toBe(2)
		expect(counts[LOCATION_TYPE_ID]).toBe(2)
		expect(counts[WORLD_LORE_TYPE_ID]).toBe(1)
	}, 60_000)
})
