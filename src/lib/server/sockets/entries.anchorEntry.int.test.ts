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
 * `entries:counts` is here too, because the count it gained answers a question
 * about edges rather than about rows: an entry is a **place** when it has an
 * edge to another entry, or an edge typed with a way of getting somewhere.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
	test("counts an entry with a travel edge and an entry linked to an entry, once each", async () => {
		const { entryCountsHandler } = await import("./entries")
		const { narrativeGraphCreateRelationshipHandler: createRelationship } =
			await import("./narrativeGraph")
		const user = await makeUser("counts-places")
		const book = await makeLorebook(user.id, "Mapped")

		const room = await create(user.id, book.id, "The Room")
		const tunnel = await create(user.id, book.id, "The Tunnel")
		const far = await create(user.id, book.id, "The Far Hall")
		const person = await create(user.id, book.id, "A Person")
		await create(user.id, book.id, "Unlinked Lore")

		const [keeper] = await testDb
			.insert(schema.lorebookBindings)
			.values({ lorebookId: book.id, binding: "", name: "The Keeper" })
			.returning()

		const link = (params: Record<string, unknown>) =>
			createRelationship.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					relationshipType: "connects to",
					status: "active",
					...params
				} as any,
				noopEmit
			)

		// Room ↔ tunnel, twice over, to prove an entry is counted once.
		await link({
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id }
		})
		await link({
			from: { kind: "entry", entryId: tunnel.id },
			to: { kind: "entry", entryId: far.id },
			relationshipType: "leads to"
		})
		// A cast edge with a travel type: the entry end is a place.
		await link({
			from: { kind: "cast", bindingId: keeper.id },
			to: { kind: "entry", entryId: person.id },
			relationshipType: "keeper of"
		})

		const { counts } = await entryCountsHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id } as any,
			noopEmit
		)
		// Room, tunnel and far hall. The person is on a `keeper of` edge whose
		// other end is a binding, which is neither a travel type nor an entry.
		expect(counts.places).toBe(3)
		expect(counts[WORLD_LORE_TYPE_ID]).toBe(5)
	}, 60_000)
})
