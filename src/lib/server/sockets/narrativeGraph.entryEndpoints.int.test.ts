/**
 * An edge's ends, now that either of them can be an entry.
 *
 * Four claims, and each one is a different way the widening could have gone
 * wrong. The sockets take and return `from`/`to` rather than two node ids, and
 * `list` hands an entry endpoint back with enough on it to be drawn as a node.
 * An edge whose ends are in two different lorebooks is refused rather than
 * written into one of them. Deleting an entry takes its edges with it. And
 * absorbing a cast row rewrites the cast end of an edge and leaves the entry
 * end exactly where it was — including through the undo.
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
		path.join(os.tmpdir(), "serene-pub-entry-endpoints-int-test-")
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

async function makeLorebook(userId: number, name = "Roads") {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

async function makeBinding(lorebookId: number, name: string) {
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "", name })
		.returning()
	return binding
}

let positions = 0
async function makeEntry(lorebookId: number, title: string) {
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++positions,
			title,
			content: ""
		})
		.returning()
	return entry
}

const create = async (userId: number, params: Record<string, unknown>) => {
	const { narrativeGraphCreateRelationshipHandler } = await import(
		"./narrativeGraph"
	)
	return narrativeGraphCreateRelationshipHandler.handler(
		fakeSocket(userId),
		params as any,
		noopEmit
	)
}

const list = async (userId: number, lorebookId: number) => {
	const { narrativeGraphListHandler } = await import("./narrativeGraph")
	return narrativeGraphListHandler.handler(
		fakeSocket(userId),
		{ lorebookId } as any,
		noopEmit
	)
}

describe("createRelationship with entry endpoints", () => {
	test("joins two entries, and list draws both ends", async () => {
		const user = await makeUser("endpoints-entry-entry")
		const book = await makeLorebook(user.id)
		const room = await makeEntry(book.id, "The Room")
		const tunnel = await makeEntry(book.id, "The Tunnel")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id },
			relationshipType: "connects to",
			status: "active"
		})

		expect(relationship.from).toEqual({
			kind: "entry",
			entryId: room.id,
			name: "The Room",
			typeId: WORLD_LORE_TYPE_ID
		})
		expect(relationship.to).toMatchObject({
			kind: "entry",
			entryId: tunnel.id,
			name: "The Tunnel"
		})
		// The pre-0124 spelling reads null on an entry end, never a wrong id.
		expect(relationship.fromNodeId).toBeNull()
		expect(relationship.toNodeId).toBeNull()

		const listed = await list(user.id, book.id)
		const edge = listed.relationships.find(
			(r: any) => r.id === relationship.id
		)!
		expect(edge.from).toMatchObject({ kind: "entry", name: "The Room" })
		expect(edge.to).toMatchObject({ kind: "entry", name: "The Tunnel" })
	}, 60_000)

	test("joins a cast member to an entry, and keeps the cast id readable", async () => {
		const user = await makeUser("endpoints-cast-entry")
		const book = await makeLorebook(user.id)
		const keeper = await makeBinding(book.id, "The Keeper")
		const shrine = await makeEntry(book.id, "The Shrine")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "cast", bindingId: keeper.id },
			to: { kind: "entry", entryId: shrine.id },
			relationshipType: "keeper of",
			status: "active"
		})

		expect(relationship.from).toEqual({
			kind: "cast",
			bindingId: keeper.id
		})
		// Populated for one release, so a reader written against it still works.
		expect(relationship.fromNodeId).toBe(keeper.id)
		expect(relationship.toNodeId).toBeNull()
	}, 60_000)

	test("still takes the pre-0124 node id spelling", async () => {
		const user = await makeUser("endpoints-legacy-spelling")
		const book = await makeLorebook(user.id)
		const alice = await makeBinding(book.id, "Alice")
		const bob = await makeBinding(book.id, "Bob")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			fromNodeId: alice.id,
			toNodeId: bob.id,
			relationshipType: "ally",
			status: "active"
		})
		expect(relationship.from).toEqual({ kind: "cast", bindingId: alice.id })
		expect(relationship.to).toEqual({ kind: "cast", bindingId: bob.id })
	}, 60_000)

	test("refuses an edge whose ends are in two lorebooks", async () => {
		const user = await makeUser("endpoints-cross-book")
		const here = await makeLorebook(user.id, "Here")
		const elsewhere = await makeLorebook(user.id, "Elsewhere")
		const room = await makeEntry(here.id, "A Room")
		const foreign = await makeEntry(elsewhere.id, "A Foreign Room")

		await expect(
			create(user.id, {
				lorebookId: here.id,
				from: { kind: "entry", entryId: room.id },
				to: { kind: "entry", entryId: foreign.id },
				relationshipType: "connects to",
				status: "active"
			})
		).rejects.toThrow(/To-entry not found/)
	}, 60_000)

	test("refuses a side that names nothing", async () => {
		const user = await makeUser("endpoints-missing-side")
		const book = await makeLorebook(user.id)
		const room = await makeEntry(book.id, "Only Room")

		await expect(
			create(user.id, {
				lorebookId: book.id,
				from: { kind: "entry", entryId: room.id },
				relationshipType: "connects to",
				status: "active"
			})
		).rejects.toThrow(/To endpoint is required/)
	}, 60_000)
})

describe("updateRelationship", () => {
	test("moves an endpoint onto another entry in the same book", async () => {
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("endpoints-update")
		const book = await makeLorebook(user.id)
		const room = await makeEntry(book.id, "Start Room")
		const tunnel = await makeEntry(book.id, "Old Tunnel")
		const better = await makeEntry(book.id, "New Tunnel")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id },
			relationshipType: "leads to",
			status: "active"
		})

		const updated = await narrativeGraphUpdateRelationshipHandler.handler(
			fakeSocket(user.id),
			{
				relationship: {
					id: relationship.id,
					to: { kind: "entry", entryId: better.id }
				}
			} as any,
			noopEmit
		)
		expect(updated.relationship.to).toMatchObject({
			kind: "entry",
			entryId: better.id,
			name: "New Tunnel"
		})
	}, 60_000)

	test("refuses an endpoint from another lorebook", async () => {
		const { narrativeGraphUpdateRelationshipHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("endpoints-update-cross-book")
		const book = await makeLorebook(user.id)
		const other = await makeLorebook(user.id, "Other")
		const room = await makeEntry(book.id, "Room Here")
		const tunnel = await makeEntry(book.id, "Tunnel Here")
		const foreign = await makeEntry(other.id, "Room There")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id },
			relationshipType: "leads to",
			status: "active"
		})

		await expect(
			narrativeGraphUpdateRelationshipHandler.handler(
				fakeSocket(user.id),
				{
					relationship: {
						id: relationship.id,
						to: { kind: "entry", entryId: foreign.id }
					}
				} as any,
				noopEmit
			)
		).rejects.toThrow(/To-entry not found/)
	}, 60_000)
})

describe("deleting an entry", () => {
	test("takes its edges with it", async () => {
		const user = await makeUser("endpoints-cascade")
		const book = await makeLorebook(user.id)
		const room = await makeEntry(book.id, "Doomed Room")
		const tunnel = await makeEntry(book.id, "Surviving Tunnel")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id },
			relationshipType: "connects to",
			status: "active"
		})

		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, room.id))

		const left = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, relationship.id))
		expect(left).toEqual([])
	}, 60_000)
})

describe("absorb and undo", () => {
	test("rewrite the cast end of an edge and leave the entry end alone", async () => {
		const {
			narrativeGraphMergeNodeHandler,
			narrativeGraphUndoMergeHandler
		} = await import("./narrativeGraph")
		const user = await makeUser("endpoints-absorb")
		const book = await makeLorebook(user.id)
		const survivor = await makeBinding(book.id, "Vell")
		const absorbed = await makeBinding(book.id, "V.")
		const shrine = await makeEntry(book.id, "The Shrine")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "cast", bindingId: absorbed.id },
			to: { kind: "entry", entryId: shrine.id },
			relationshipType: "keeper of",
			status: "active"
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id } as any,
			noopEmit
		)

		const [afterMerge] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, relationship.id))
		expect(afterMerge.fromNodeId).toBe(survivor.id)
		// ⚠ The claim: the entry end is untouched by a cast merge.
		expect(afterMerge.toEntryId).toBe(shrine.id)
		expect(afterMerge.toNodeId).toBeNull()

		const [log] = await testDb
			.select()
			.from(schema.bindingMergeLogs)
			.where(eq(schema.bindingMergeLogs.lorebookId, book.id))
		await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(user.id),
			{ mergeLogId: log.id } as any,
			noopEmit
		)

		const [afterUndo] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, relationship.id))
		expect(afterUndo.toEntryId).toBe(shrine.id)
		expect(afterUndo.toNodeId).toBeNull()
		// The cast end came back on the restored row, which has a new id.
		expect(afterUndo.fromNodeId).not.toBe(survivor.id)
	}, 60_000)

	test("leave an entry-to-entry edge entirely alone", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"./narrativeGraph"
		)
		const user = await makeUser("endpoints-absorb-untouched")
		const book = await makeLorebook(user.id)
		const survivor = await makeBinding(book.id, "Kerr")
		const absorbed = await makeBinding(book.id, "K.")
		const room = await makeEntry(book.id, "Quiet Room")
		const tunnel = await makeEntry(book.id, "Quiet Tunnel")

		const { relationship } = await create(user.id, {
			lorebookId: book.id,
			from: { kind: "entry", entryId: room.id },
			to: { kind: "entry", entryId: tunnel.id },
			relationshipType: "connects to",
			status: "active"
		})

		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(user.id),
			{ nodeId: absorbed.id, parentNodeId: survivor.id } as any,
			noopEmit
		)

		const [after] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, relationship.id))
		expect(after.fromEntryId).toBe(room.id)
		expect(after.toEntryId).toBe(tunnel.id)
		expect(after.fromNodeId).toBeNull()
		expect(after.toNodeId).toBeNull()
	}, 60_000)
})
