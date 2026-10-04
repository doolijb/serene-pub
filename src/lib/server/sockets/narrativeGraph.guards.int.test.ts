/**
 * The relationship writers' two standing guards (plan B0, places-graph
 * 2026-09-29), held by the server in `utils/relationshipGuards.ts`.
 *
 * - **No self-link**, for both kinds of end, on create and on an update that
 *   moves an end. The database refused nothing: an entry, or a cast member,
 *   could be linked to itself from the canvas, and a pipeline's
 *   `link-lore-entries@1` / `create-lore-entry@1` `links` could write one.
 *   (The CHECK on entry ends is B1's; cast ends are refused here only, since a
 *   0.5.x import can still carry a cast self-loop and the cast merge is what
 *   deletes those.)
 * - **The line.** A relationship belongs to the line it was drawn on. Editing
 *   or deleting one from another line would rewrite that line — main included —
 *   and only the canvas's `relLockedReason` said so. The client now states the
 *   line it reads (`branchId`, absent or null is main) and the server refuses a
 *   row that is not that line's own.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { entryInsert, WORLD_LORE_TYPE_ID } from "$lib/server/utils/lorebookEntries"
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-graph-guards-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let seq = 0
async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `graph-guards-${++seq}`)
	const [lorebook] = await testDb.insert(schema.lorebooks).values({ name: `Guards ${seq}`, userId: user.id }).returning()
	// One member per tag per book: two names of one length shared a tag.
	let tagN = 0
	const member = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: lorebook!.id, binding: `{{char:${++tagN}}}`, name })
				.returning()
		)[0]!
	let position = 0
	const place = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(entryInsert({ typeId: WORLD_LORE_TYPE_ID, lorebookId: lorebook!.id, name, content: name, position: position++ }))
				.returning()
		)[0]!
	const fork = async (name: string) =>
		(await testDb.insert(schema.lorebookBranches).values({ lorebookId: lorebook!.id, name }).returning())[0]!
	return { user, lorebook: lorebook!, member, place, fork }
}

const handlers = () => import("./narrativeGraph")

type End = { kind: "cast"; bindingId: number } | { kind: "entry"; entryId: number }
const entryEnd = (entryId: number): End => ({ kind: "entry", entryId })
const castEnd = (bindingId: number): End => ({ kind: "cast", bindingId })

async function draw(b: Awaited<ReturnType<typeof makeBook>>, from: End, to: End, branchId: number | null = null) {
	const { narrativeGraphCreateRelationshipHandler } = await handlers()
	return narrativeGraphCreateRelationshipHandler.handler(
		fakeSocket(b.user.id),
		{ lorebookId: b.lorebook.id, from, to, relationshipType: "leads to", status: "active", branchId } as any,
		noopEmit
	)
}

async function edit(userId: number, relationship: Record<string, unknown>, branchId?: number | null) {
	const { narrativeGraphUpdateRelationshipHandler } = await handlers()
	return narrativeGraphUpdateRelationshipHandler.handler(
		fakeSocket(userId),
		{ relationship, ...(branchId !== undefined ? { branchId } : {}) } as any,
		noopEmit
	)
}

async function remove(userId: number, id: number, branchId?: number | null) {
	const { narrativeGraphDeleteRelationshipHandler } = await handlers()
	return narrativeGraphDeleteRelationshipHandler.handler(
		fakeSocket(userId),
		{ id, ...(branchId !== undefined ? { branchId } : {}) } as any,
		noopEmit
	)
}

const rowsOf = (lorebookId: number) =>
	testDb.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.lorebookId, lorebookId))

describe("self-links are refused", () => {
	test("on create, for an entry end and for a cast end", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const aria = await b.member("Aria")
		await expect(draw(b, entryEnd(hall.id), entryEnd(hall.id))).rejects.toThrow(/can be linked to itself/)
		await expect(draw(b, castEnd(aria.id), castEnd(aria.id))).rejects.toThrow(/can be linked to itself/)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
		// A link between two different ends is untouched by the guard.
		const cellar = await b.place("The Cellar")
		await draw(b, entryEnd(hall.id), entryEnd(cellar.id))
		expect(await rowsOf(b.lorebook.id)).toHaveLength(1)
	})

	test("on an update that moves an end onto the other", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const aria = await b.member("Aria")
		const bram = await b.member("Bram")
		const { relationship: road } = await draw(b, entryEnd(hall.id), entryEnd(cellar.id))
		const { relationship: tie } = await draw(b, castEnd(aria.id), castEnd(bram.id))

		await expect(edit(b.user.id, { id: road.id, to: entryEnd(hall.id) })).rejects.toThrow(/can be linked to itself/)
		await expect(edit(b.user.id, { id: road.id, from: entryEnd(cellar.id) })).rejects.toThrow(/can be linked to itself/)
		await expect(edit(b.user.id, { id: tie.id, to: castEnd(aria.id) })).rejects.toThrow(/can be linked to itself/)
		const rows = await rowsOf(b.lorebook.id)
		expect(rows.find((r) => r.id === road.id)).toMatchObject({ fromEntryId: hall.id, toEntryId: cellar.id })
		expect(rows.find((r) => r.id === tie.id)).toMatchObject({ fromNodeId: aria.id, toNodeId: bram.id })
	})

	test("a 0.5.x cast self-loop already stored can still be reworded and deleted", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria")
		const [loop] = await testDb
			.insert(schema.narrativeRelationships)
			.values({ lorebookId: b.lorebook.id, fromNodeId: aria.id, toNodeId: aria.id, relationshipType: "doubts", status: "active" })
			.returning()
		const { relationship } = await edit(b.user.id, { id: loop!.id, description: "Since the ford." })
		expect(relationship.description).toBe("Since the ford.")
		// The canvas saves the whole relationship, its ends included, unchanged:
		// ends that name what the row already holds move nothing.
		const { relationship: saved } = await edit(b.user.id, {
			id: loop!.id,
			from: castEnd(aria.id),
			to: castEnd(aria.id),
			relationshipType: "doubts",
			status: "active",
			description: "Since the flood."
		})
		expect(saved.description).toBe("Since the flood.")
		await remove(b.user.id, loop!.id)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
	})
})

describe("update and delete come from the line that owns the row", () => {
	test("a fork's relationship is refused from main, and changed from the fork", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const fork = await b.fork("What if")
		const { relationship } = await draw(b, entryEnd(hall.id), entryEnd(cellar.id), fork.id)

		// Main, said outright and by saying nothing.
		await expect(edit(b.user.id, { id: relationship.id, description: "A stair." }, null)).rejects.toThrow(
			/belongs to What if/
		)
		await expect(edit(b.user.id, { id: relationship.id, description: "A stair." })).rejects.toThrow(/belongs to What if/)
		await expect(remove(b.user.id, relationship.id)).rejects.toThrow(/belongs to What if/)
		expect(await rowsOf(b.lorebook.id)).toHaveLength(1)

		const { relationship: edited } = await edit(b.user.id, { id: relationship.id, description: "A stair." }, fork.id)
		expect(edited.description).toBe("A stair.")
		await remove(b.user.id, relationship.id, fork.id)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
	})

	test("main's relationship is refused from a fork", async () => {
		const b = await makeBook()
		const aria = await b.member("Aria")
		const bram = await b.member("Bram")
		const fork = await b.fork("Or else")
		const { relationship } = await draw(b, castEnd(aria.id), castEnd(bram.id))
		await expect(edit(b.user.id, { id: relationship.id, status: "ended" }, fork.id)).rejects.toThrow(/belongs to main/)
		await expect(remove(b.user.id, relationship.id, fork.id)).rejects.toThrow(/belongs to main/)
		const [row] = await rowsOf(b.lorebook.id)
		expect(row?.status).toBe("active")
	})

	test("a sibling fork's relationship is refused from this fork", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const cellar = await b.place("The Cellar")
		const mine = await b.fork("Mine")
		const theirs = await b.fork("Theirs")
		const { relationship } = await draw(b, entryEnd(hall.id), entryEnd(cellar.id), theirs.id)
		await expect(remove(b.user.id, relationship.id, mine.id)).rejects.toThrow(/belongs to Theirs/)
		expect(await rowsOf(b.lorebook.id)).toHaveLength(1)
	})
})

describe("the lore-link outlets refuse a self-link", () => {
	const LINK = { key: "link", definitionId: "core:outlet/link-lore-entries" }
	const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }

	async function sessionOn(b: Awaited<ReturnType<typeof makeBook>>) {
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: b.user.id, isGroup: false, lorebookId: b.lorebook.id })
			.returning()
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(testDb as any, { sessionId: session!.id })
	}

	test("link-lore-entries, by id and by name", async () => {
		const b = await makeBook()
		const hall = await b.place("The Hall")
		const h = await sessionOn(b)
		await expect(h.commit!({ from: hall.id, to: hall.id }, LINK as any)).rejects.toThrow(/link: .*can be linked to itself/)
		await expect(h.commit!({ from: hall.id, to: " the hall " }, LINK as any)).rejects.toThrow(/can be linked to itself/)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
	})

	test("create-lore-entry whose links name the entry itself fails with the entry", async () => {
		const b = await makeBook()
		const h = await sessionOn(b)
		await expect(
			h.commit!(
				{ name: "The Mirror Room", content: "Glass.", links: ["The Mirror Room"] },
				SAVE as any
			)
		).rejects.toThrow(/can be linked to itself/)
		expect(await rowsOf(b.lorebook.id)).toEqual([])
		const entries = await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, b.lorebook.id))
		expect(entries).toEqual([])
	})
})

describe("the lorebook import", () => {
	test("skips an entry linked to itself, and keeps the rest of the file", async () => {
		// The import writes relationships from the file, not through the guard:
		// a row the file carries is not a new link anybody drew. An entry-ended
		// self-loop is still nothing a book can hold (B1's CHECK will say so),
		// so it is dropped at the door; the book and its sound links land.
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await createTestUser(testDb, `graph-guards-import-${++seq}`)
		const entry = (localId: number, name: string) => ({
			keys: [name.toLowerCase()],
			content: `${name}.`,
			enabled: true,
			insertion_order: localId,
			case_sensitive: false,
			use_regex: false,
			constant: false,
			name,
			comment: name,
			id: localId,
			extensions: { serenepub: { entryType: "world", entryLocalId: localId } }
		})
		const link = (from: number, to: number, relationshipType: string) => ({
			from: { kind: "entry", entry: from },
			to: { kind: "entry", entry: to },
			relationshipType,
			description: "",
			visibility: "acknowledged",
			status: "active",
			reason: null,
			historyEntryLocalId: null,
			sceneLocalId: null
		})
		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{
				lorebookJson: JSON.stringify({
					name: `Looped ${seq}`,
					description: "",
					entries: [entry(1, "Hall"), entry(2, "Cellar")],
					extensions: {
						serenepub: {
							version: 1,
							characters: [],
							personas: [],
							bindings: [],
							narrativeGraph: {
								version: 1,
								nodes: [],
								relationships: [link(1, 1, "leads to itself"), link(1, 2, "leads down to")]
							}
						}
					}
				})
			},
			noopEmit
		)
		expect(imported.status).toBe("created")
		const rows = await rowsOf(imported.lorebook!.id)
		expect(rows.map((r) => r.relationshipType)).toEqual(["leads down to"])
	})
})
