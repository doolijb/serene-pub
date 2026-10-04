/**
 * An edge whose endpoint is an entry, and an entry filed under another, both
 * cross a file.
 *
 * The export addresses an endpoint by kind — a cast binding's local id or an
 * entry's — so a road between two places, a keeper of a place, and a district
 * inside its city all survive a round trip. The flat cast ids stay written
 * beside the new shape, and a file that predates it still imports its cast
 * edges.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { loadBookEntries } from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-entry-edges-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

/**
 * Export is disabled (owner ruling 2026-09-28) and its handler refuses; these
 * round trips drive the dormant builder directly, which is the half the import's
 * unchanged-vs-conflict check still uses.
 */
async function dormantExport(
	socket: { user: { id: number } },
	params: {
		id: number
		includeCharacters?: boolean
		includePersonas?: boolean
		includeNarrativeGraph?: boolean
	},
	_emit?: unknown
) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { id, ...options } = params
	const { name, specBookWithGraph } = await buildLorebookExportData(
		id,
		socket.user.id,
		options
	)
	return {
		blob: Buffer.from(JSON.stringify(specBookWithGraph, null, 2), "utf-8"),
		filename: `${name}.v3.json`
	}
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/** A book holding every endpoint pairing plus a nested entry. */
async function seedLinkedBook(userId: number, name: string) {
	const { lorebooksCreateHandler } = await import("./lorebooks")
	const { lorebook } = await lorebooksCreateHandler.handler(
		fakeSocket(userId),
		{ name },
		noopEmit
	)

	const [city] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{ lorebookId: lorebook.id, name: "City", content: "A city." }
			])
		)
		.returning()
	const [district] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "District",
					content: "A district of the city.",
					anchorEntryId: city.id
				}
			])
		)
		.returning()
	const [tunnel] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			worldLoreValues([
				{
					lorebookId: lorebook.id,
					name: "Tunnel",
					content: "A tunnel."
				}
			])
		)
		.returning()

	const [keeper] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:1}}",
			name: "Keeper"
		})
		.returning()
	const [guard] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			binding: "{{char:2}}",
			name: "Guard"
		})
		.returning()

	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: lorebook.id,
			fromNodeId: keeper.id,
			toNodeId: guard.id,
			relationshipType: "ally",
			description: "cast to cast"
		},
		{
			lorebookId: lorebook.id,
			fromEntryId: district.id,
			toEntryId: tunnel.id,
			relationshipType: "connects to",
			description: "entry to entry"
		},
		{
			lorebookId: lorebook.id,
			fromNodeId: keeper.id,
			toEntryId: tunnel.id,
			relationshipType: "keeper of",
			description: "cast to entry"
		}
	])

	return { lorebook, city, district, tunnel, keeper, guard }
}

/** Every edge of a book as `type: from -> to`, named rather than numbered. */
async function edgeSummary(lorebookId: number) {
	const entries = await loadBookEntries(testDb, lorebookId)
	const entryNameById = new Map(entries.map((e) => [e.id, e.name]))
	const bindings = await testDb.query.lorebookBindings.findMany({
		where: (b, { eq }) => eq(b.lorebookId, lorebookId)
	})
	const bindingNameById = new Map(bindings.map((b) => [b.id, b.name]))
	const rows = await testDb.query.narrativeRelationships.findMany({
		where: (r, { eq }) => eq(r.lorebookId, lorebookId)
	})
	const endpoint = (nodeId: number | null, entryId: number | null) =>
		nodeId !== null
			? `cast:${bindingNameById.get(nodeId) ?? "MISSING"}`
			: `entry:${entryNameById.get(entryId!) ?? "MISSING"}`
	return rows
		.map(
			(r) =>
				`${r.relationshipType}: ${endpoint(r.fromNodeId, r.fromEntryId)} -> ${endpoint(r.toNodeId, r.toEntryId)}`
		)
		.sort()
}

const LINKED_BOOK_EDGES = [
	"ally: cast:Keeper -> cast:Guard",
	"connects to: entry:District -> entry:Tunnel",
	"keeper of: cast:Keeper -> entry:Tunnel"
].sort()

describe("entry endpoints and anchors across an export (PGlite integration)", () => {
	test("a book with a cast edge, an entry edge, a cast-to-entry edge and a nested entry round trips", async () => {
		const { lorebookImportHandler } = await import(
			"./lorebooks"
		)
		const author = await makeUser("edges-author")
		const recipient = await makeUser("edges-recipient")

		const seeded = await seedLinkedBook(author.id, "Linked Book")
		expect(await edgeSummary(seeded.lorebook.id)).toEqual(LINKED_BOOK_EDGES)

		const exported = await dormantExport(
			fakeSocket(author.id),
			{ id: seeded.lorebook.id },
			noopEmit
		)
		const exportedData = JSON.parse(exported.blob.toString("utf-8"))

		// The file addresses each endpoint by kind, and still writes the flat
		// cast ids beside them.
		const rels = exportedData.extensions.serenepub.narrativeGraph
			.relationships as any[]
		expect(rels).toHaveLength(3)
		const castEdge = rels.find((r) => r.relationshipType === "ally")
		expect(castEdge.from.kind).toBe("cast")
		expect(castEdge.to.kind).toBe("cast")
		expect(castEdge.fromLocalId).toBe(castEdge.from.node)
		expect(castEdge.toLocalId).toBe(castEdge.to.node)

		const entryLocalIdByName = new Map(
			(exportedData.entries as any[]).map((e) => [
				e.name,
				e.extensions.serenepub.entryLocalId
			])
		)
		const entryEdge = rels.find((r) => r.relationshipType === "connects to")
		expect(entryEdge.from).toEqual({
			kind: "entry",
			entry: entryLocalIdByName.get("District")
		})
		expect(entryEdge.to).toEqual({
			kind: "entry",
			entry: entryLocalIdByName.get("Tunnel")
		})
		// An entry endpoint has no flat spelling, so an older importer skips
		// this row rather than reading half of it.
		expect(entryEdge.fromLocalId).toBeUndefined()
		expect(entryEdge.toLocalId).toBeUndefined()

		const mixedEdge = rels.find((r) => r.relationshipType === "keeper of")
		expect(mixedEdge.from.kind).toBe("cast")
		expect(mixedEdge.to).toEqual({
			kind: "entry",
			entry: entryLocalIdByName.get("Tunnel")
		})

		// Part of: the district states its city by local id.
		const districtWire = (exportedData.entries as any[]).find(
			(e) => e.name === "District"
		)
		expect(districtWire.extensions.serenepub.anchorEntryLocalId).toBe(
			entryLocalIdByName.get("City")
		)

		const imported = await lorebookImportHandler.handler(
			fakeSocket(recipient.id),
			{ lorebookJson: JSON.stringify(exportedData) },
			noopEmit
		)
		expect(imported.status).toBe("created")
		const copyId = imported.lorebook!.id

		expect(await edgeSummary(copyId)).toEqual(LINKED_BOOK_EDGES)

		const copyEntries = await loadBookEntries(testDb, copyId)
		const byName = new Map(copyEntries.map((e) => [e.name, e]))
		expect(byName.get("District")!.anchorEntryId).toBe(
			byName.get("City")!.id
		)
		expect(byName.get("City")!.anchorEntryId).toBeNull()

		// Every endpoint points inside the copy, never back at the original.
		const copyEntryIds = new Set(copyEntries.map((e) => e.id))
		const copyBindingIds = new Set(
			(
				await testDb.query.lorebookBindings.findMany({
					where: (b, { eq }) => eq(b.lorebookId, copyId)
				})
			).map((b) => b.id)
		)
		const copyEdges = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, copyId)
		})
		for (const edge of copyEdges) {
			for (const entryId of [edge.fromEntryId, edge.toEntryId])
				if (entryId !== null)
					expect(copyEntryIds.has(entryId)).toBe(true)
			for (const nodeId of [edge.fromNodeId, edge.toNodeId])
				if (nodeId !== null)
					expect(copyBindingIds.has(nodeId)).toBe(true)
		}
	}, 60_000)

	test("a file written before endpoint kinds still imports its cast edges", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const user = await makeUser("edges-legacy-user")

		// An export as it was written when a relationship named two nodes and
		// nothing else: no `from`/`to`, no entry local ids.
		const legacyPayload = {
			name: "Legacy Graph Book",
			description: "",
			entries: [
				{
					keys: ["ruin"],
					content: "A ruin.",
					enabled: true,
					insertion_order: 0,
					case_sensitive: false,
					use_regex: false,
					constant: false,
					name: "Ruin",
					comment: "Ruin",
					id: 1,
					extensions: { serenepub: { entryType: "world" } }
				}
			],
			extensions: {
				serenepub: {
					version: 1,
					characters: [],
					personas: [],
					bindings: [
						{
							localId: 1,
							bindingText: "{{char:1}}",
							kind: "persona",
							characterLocalId: null,
							personaLocalId: null
						},
						{
							localId: 2,
							bindingText: "{{char:2}}",
							kind: "persona",
							characterLocalId: null,
							personaLocalId: null
						}
					],
					narrativeGraph: {
						version: 1,
						nodes: [
							{
								localId: 10,
								name: "Old Keeper",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								absorbedAliases: [],
								summary: null,
								bindingLocalId: 1,
								parentLocalId: null,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							},
							{
								localId: 11,
								name: "Old Guard",
								nodeState: "active",
								nodeVisibility: "normal",
								aliases: [],
								absorbedAliases: [],
								summary: null,
								bindingLocalId: 2,
								parentLocalId: null,
								historyEntryLocalId: null,
								sceneLocalId: null,
								characterUuids: []
							}
						],
						relationships: [
							{
								fromLocalId: 10,
								toLocalId: 11,
								relationshipType: "ally",
								description: "cast to cast",
								visibility: "acknowledged",
								status: "active",
								reason: null,
								historyEntryLocalId: null,
								sceneLocalId: null
							}
						]
					}
				}
			}
		}

		const imported = await lorebookImportHandler.handler(
			fakeSocket(user.id),
			{ lorebookJson: JSON.stringify(legacyPayload) },
			noopEmit
		)
		expect(imported.status).toBe("created")
		expect(await edgeSummary(imported.lorebook!.id)).toEqual([
			"ally: cast:Old Keeper -> cast:Old Guard"
		])
	}, 60_000)
})

/**
 * A place's relationships (plan B1, places-graph 2026-09-29).
 *
 * A way between two places is ONE relationship row: its **name** (column
 * `title`, `name` on the wire, as an entry's), its relationship type read from
 * the `from` end, its **reverse relationship type** read from the `to` end
 * (null is one way), and its description. So one two-way door is one row, and
 * the writers refuse a second row that says what one already says:
 *
 * - the same link again, on the same line at the same date with the same name
 *   (case aside) — two differently named doors between the same rooms stay two;
 * - a **mirror**: a row drawn from the far end whose words, read from either
 *   end, one already says.
 */
describe("a place's relationships: name, reverse, one of each (plan B1)", () => {
	type End = { kind: "cast"; bindingId: number } | { kind: "entry"; entryId: number }
	const at = (entryId: number): End => ({ kind: "entry", entryId })
	const cast = (bindingId: number): End => ({ kind: "cast", bindingId })

	let seq = 0
	async function placesBook() {
		const user = await makeUser(`places-b1-${++seq}`)
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: `Places ${seq}` },
			noopEmit
		)
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const { LOCATION_TYPE_ID, HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
		let position = 0
		const entry = async (typeId: string, name: string) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values(
						entryInsert({ typeId, lorebookId: lorebook.id, name, content: `${name}.`, position: position++ } as any)
					)
					.returning()
			)[0]!
		const place = (name: string) => entry(LOCATION_TYPE_ID, name)
		const chapter = () => entry(HISTORY_TYPE_ID, "")
		// One member per tag per book: two names of one length shared a tag.
		let tagN = 0
		const member = async (name: string) =>
			(
				await testDb
					.insert(schema.lorebookBindings)
					.values({ lorebookId: lorebook.id, binding: `{{char:${++tagN}}}`, name })
					.returning()
			)[0]!
		const fork = async (name: string) =>
			(await testDb.insert(schema.lorebookBranches).values({ lorebookId: lorebook.id, name }).returning())[0]!
		return { user, lorebook, place, chapter, member, fork }
	}
	type Book = Awaited<ReturnType<typeof placesBook>>

	async function draw(b: Book, from: End, to: End, extra: Record<string, unknown> = {}) {
		const { narrativeGraphCreateRelationshipHandler } = await import("./narrativeGraph")
		const { relationship } = await narrativeGraphCreateRelationshipHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id, from, to, relationshipType: "leads to", status: "active", ...extra } as any,
			noopEmit
		)
		return relationship
	}
	async function edit(b: Book, relationship: Record<string, unknown>) {
		const { narrativeGraphUpdateRelationshipHandler } = await import("./narrativeGraph")
		return (
			await narrativeGraphUpdateRelationshipHandler.handler(fakeSocket(b.user.id), { relationship } as any, noopEmit)
		).relationship
	}
	const stored = async (b: Book) =>
		testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, b.lorebook.id),
			orderBy: (r, { asc }) => asc(r.id)
		})

	test("a relationship carries its name and its reverse relationship type, trimmed, as `name` on the wire", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const door = await draw(b, at(guardroom.id), at(hall.id), {
			name: "  the rusted iron door ",
			relationshipType: " leads north to ",
			reverseRelationshipType: " leads south to "
		})
		expect(door).toMatchObject({
			name: "the rusted iron door",
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to"
		})
		// The column's own spelling stays off the wire.
		expect(door).not.toHaveProperty("title")
		const [row] = await stored(b)
		expect(row).toMatchObject({ title: "the rusted iron door", reverseRelationshipType: "leads south to" })

		// Said nothing: unnamed, one way. A blank reverse is one way too.
		const plain = await draw(b, at(hall.id), at(guardroom.id), { reverseRelationshipType: "   " })
		expect(plain).toMatchObject({ name: "", reverseRelationshipType: null })

		// The list reads them the same way.
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const list = await narrativeGraphListHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id } as any,
			noopEmit
		)
		expect(list.relationships.find((r) => r.id === door.id)).toMatchObject({
			name: "the rusted iron door",
			reverseRelationshipType: "leads south to"
		})
	})

	test("two differently named doors between the same rooms are two relationships", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		await draw(b, at(guardroom.id), at(hall.id), { name: "the rusted iron door" })
		await draw(b, at(guardroom.id), at(hall.id), { name: "the trapdoor" })
		expect((await stored(b)).map((r) => r.title)).toEqual(["the rusted iron door", "the trapdoor"])
	})

	test("the same link again is refused, whatever its case — on another line or date it is another link", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		await draw(b, at(guardroom.id), at(hall.id))
		await expect(draw(b, at(guardroom.id), at(hall.id), { relationshipType: "Leads To" })).rejects.toThrow(
			"These two are already linked that way."
		)
		await expect(draw(b, at(guardroom.id), at(hall.id), { name: "" })).rejects.toThrow(/already linked that way/)
		const fork = await b.fork("What if")
		await draw(b, at(guardroom.id), at(hall.id), { branchId: fork.id })
		const chapter = await b.chapter()
		await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: chapter.id })
		expect(await stored(b)).toHaveLength(3)
	})

	test("a mirror is refused: a row from the far end that says what one already says", async () => {
		const b = await placesBook()
		const tavern = await b.place("The Rusty Flagon")
		const chapel = await b.place("The Chapel")
		await draw(b, at(tavern.id), at(chapel.id), {
			relationshipType: "connects to",
			reverseRelationshipType: "connects to"
		})
		// Drawn again from the chapel: the tavern's row already says it.
		await expect(draw(b, at(chapel.id), at(tavern.id), { relationshipType: "connects to" })).rejects.toThrow(
			/already linked that way/
		)

		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		await draw(b, at(guardroom.id), at(hall.id), { relationshipType: "leads north to" })
		// A two-way row from the hall whose way back is the guardroom's own words.
		await expect(
			draw(b, at(hall.id), at(guardroom.id), {
				relationshipType: "leads south to",
				reverseRelationshipType: "Leads North To"
			})
		).rejects.toThrow(/already linked that way/)
		// Other words the other way are another way.
		await draw(b, at(hall.id), at(guardroom.id), { relationshipType: "leads south to" })
		expect(await stored(b)).toHaveLength(3)
	})

	test("an update may not make a duplicate; rewording in place keeps the row", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const iron = await draw(b, at(guardroom.id), at(hall.id), { name: "the rusted iron door" })
		const trap = await draw(b, at(guardroom.id), at(hall.id), { name: "the trapdoor" })
		await expect(edit(b, { id: trap.id, name: "The Rusted Iron Door" })).rejects.toThrow(/already linked that way/)

		const reworded = await edit(b, {
			id: iron.id,
			name: " the iron door ",
			reverseRelationshipType: "leads back to",
			description: "Rust flakes off it."
		})
		expect(reworded).toMatchObject({
			id: iron.id,
			name: "the iron door",
			reverseRelationshipType: "leads back to",
			description: "Rust flakes off it."
		})
		// The canvas resends the whole row, unchanged: nothing to judge.
		const resent = await edit(b, { ...reworded })
		expect(resent.id).toBe(iron.id)
		// Clearing the reverse makes it one way.
		expect((await edit(b, { id: iron.id, reverseRelationshipType: "" })).reverseRelationshipType).toBeNull()
		expect(await stored(b)).toHaveLength(2)
	})

	test("a tie between two cast members never keeps a reverse relationship type", async () => {
		const b = await placesBook()
		const aria = await b.member("Aria")
		const bram = await b.member("Bram")
		const shrine = await b.place("The Shrine")
		const tie = await draw(b, cast(aria.id), cast(bram.id), {
			relationshipType: "ally",
			reverseRelationshipType: "ally"
		})
		expect(tie.reverseRelationshipType).toBeNull()
		expect((await edit(b, { id: tie.id, reverseRelationshipType: "ally" })).reverseRelationshipType).toBeNull()
		// With an entry at one end it is kept.
		const keeper = await draw(b, cast(aria.id), at(shrine.id), {
			relationshipType: "keeps",
			reverseRelationshipType: "is kept by"
		})
		expect(keeper.reverseRelationshipType).toBe("is kept by")
		// Moving that end onto a cast member takes the reverse with it.
		expect((await edit(b, { id: keeper.id, to: cast(bram.id) })).reverseRelationshipType).toBeNull()
	})

	test("the session's link reader carries the name and the reverse", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const door = await draw(b, at(guardroom.id), at(hall.id), {
			name: "the rusted iron door",
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to"
		})
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: b.user.id, isGroup: false, lorebookId: b.lorebook.id })
			.returning()
		const { readGraphEntryLinks } = await import("$lib/server/utils/graphEntryLinks")
		const links = await readGraphEntryLinks(testDb as any, session!.id)
		expect(links?.find((l) => l.id === door.id)).toMatchObject({
			name: "the rusted iron door",
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to"
		})
	})

	test("an export and import carry the name and the reverse", async () => {
		const { lorebookImportHandler } = await import("./lorebooks")
		const b = await placesBook()
		const recipient = await makeUser(`places-b1-recipient-${seq}`)
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		await draw(b, at(guardroom.id), at(hall.id), {
			name: "the rusted iron door",
			relationshipType: "leads north to",
			reverseRelationshipType: "leads south to"
		})
		await draw(b, at(hall.id), at(guardroom.id), { relationshipType: "slopes down to" })
		const exported = await dormantExport(fakeSocket(b.user.id), { id: b.lorebook.id })
		const data = JSON.parse(exported.blob.toString("utf-8"))
		const imported = await lorebookImportHandler.handler(
			fakeSocket(recipient.id),
			{ lorebookJson: JSON.stringify(data) },
			noopEmit
		)
		const rows = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, imported.lorebook!.id)
		})
		expect(
			rows
				.map((r) => [r.relationshipType, r.title, r.reverseRelationshipType])
				.sort((x, y) => String(x[0]).localeCompare(String(y[0])))
		).toEqual([
			["leads north to", "the rusted iron door", "leads south to"],
			["slopes down to", "", null]
		])
	}, 60_000)

	/*
	 * A dated link keeps its row when its history entry goes: the date is
	 * `ON DELETE SET NULL`, so the row turns undated. The date is also part of
	 * the one-row-per-way key, so a link that already stands undated — or at a
	 * second date going in the same delete — would become its own twin, and
	 * the whole delete used to fail on a raw unique violation (review round,
	 * 2026-09-29). The twins fold instead: the most description survives, then
	 * the oldest — the rule 0193 folded stored duplicates by.
	 */
	async function deleteEntry(b: Book, id: number, typeId: string) {
		const { deleteEntryHandler } = await import("./entries")
		return deleteEntryHandler.handler(fakeSocket(b.user.id), { id, typeId } as any, noopEmit)
	}
	const HISTORY = async () => (await import("$lib/shared/entries/types")).HISTORY_TYPE_ID

	test("deleting a history entry folds the link it dated into the same link undated", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const chapter = await b.chapter()
		const undated = await draw(b, at(guardroom.id), at(hall.id))
		const dated = await draw(b, at(guardroom.id), at(hall.id), {
			historyEntryId: chapter.id,
			description: "Rust flakes off it."
		})
		// Another way between the same rooms is not a twin.
		const trap = await draw(b, at(guardroom.id), at(hall.id), { name: "the trapdoor", historyEntryId: chapter.id })

		await deleteEntry(b, chapter.id, await HISTORY())

		const rows = await stored(b)
		expect(rows.map((r) => [r.id, r.historyEntryId, r.description])).toEqual([
			[dated.id, null, "Rust flakes off it."],
			[trap.id, null, ""]
		])
		expect(rows.some((r) => r.id === undated.id)).toBe(false)

		// On a tie the oldest survives.
		const tower = await b.place("The Tower")
		const again = await b.chapter()
		const first = await draw(b, at(hall.id), at(tower.id))
		await draw(b, at(hall.id), at(tower.id), { historyEntryId: again.id })
		await deleteEntry(b, again.id, await HISTORY())
		expect((await stored(b)).filter((r) => r.toEntryId === tower.id).map((r) => r.id)).toEqual([first.id])
	}, 60_000)

	test("a twin with an empty description never outlives one with words", async () => {
		const b = await placesBook()
		const cellar = await b.place("The Cellar")
		const hall = await b.place("The Hall")
		const chapter = await b.chapter()
		await draw(b, at(cellar.id), at(hall.id))
		const said = await draw(b, at(cellar.id), at(hall.id), {
			historyEntryId: chapter.id,
			description: "Down the cellar stairs."
		})

		await deleteEntry(b, chapter.id, await HISTORY())

		expect((await stored(b)).map((r) => [r.id, r.historyEntryId, r.description])).toEqual([
			[said.id, null, "Down the cellar stairs."]
		])
	}, 60_000)

	test("one delete taking two history entries folds the links each dated", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const era = await b.chapter()
		const [one, two] = [await b.chapter(), await b.chapter()]
		// Both filed under the era, so its delete cascades to them in one statement.
		for (const c of [one, two])
			await testDb
				.update(schema.lorebookEntries)
				.set({ anchorEntryId: era.id })
				.where(eq(schema.lorebookEntries.id, c.id))
		const early = await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: one.id, description: "Open." })
		await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: two.id })

		await deleteEntry(b, era.id, await HISTORY())

		expect((await stored(b)).map((r) => [r.id, r.historyEntryId])).toEqual([[early.id, null]])
	}, 60_000)

	test("deleting a fork keeps a child fork's link dated by the fork's history entry: the entry moves to the child (plan A17)", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const fork = await b.fork("What if")
		const [child] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "What if, then", forkedFromBranchId: fork.id })
			.returning()
		// Written on the fork; the child reads its parent's history.
		const chapter = await b.chapter()
		await testDb
			.update(schema.lorebookEntries)
			.set({ branchId: fork.id })
			.where(eq(schema.lorebookEntries.id, chapter.id))
		const undated = await draw(b, at(guardroom.id), at(hall.id), { branchId: child!.id })
		const dated = await draw(b, at(guardroom.id), at(hall.id), { branchId: child!.id, historyEntryId: chapter.id })

		const { amendmentsDeleteBranchHandler } = await import("./amendments")
		await amendmentsDeleteBranchHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id, id: fork.id },
			noopEmit
		)

		expect((await stored(b)).map((r) => [r.id, r.historyEntryId, r.branchId])).toEqual([
			[undated.id, null, child!.id],
			[dated.id, chapter.id, child!.id]
		])
		const kept = await testDb.query.lorebookEntries.findFirst({
			where: (e, { eq }) => eq(e.id, chapter.id)
		})
		expect(kept?.branchId).toBe(child!.id)
	}, 60_000)

	test("deleting a fork folds a child fork's link dated by a history entry of the fork the child never read", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const fork = await b.fork("What if")
		// The child left the fork at Year 3; the fork's chapter is Year 5.
		const [child] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "What if, then", forkedFromBranchId: fork.id, forkYear: 3 })
			.returning()
		const chapter = await b.chapter()
		await testDb
			.update(schema.lorebookEntries)
			.set({ branchId: fork.id, fields: { year: 5 } })
			.where(eq(schema.lorebookEntries.id, chapter.id))
		const undated = await draw(b, at(guardroom.id), at(hall.id), { branchId: child!.id })
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: b.lorebook.id,
			fromEntryId: guardroom.id,
			toEntryId: hall.id,
			relationshipType: "leads to",
			status: "active",
			description: (undated as any).description,
			branchId: child!.id,
			historyEntryId: chapter.id
		} as any)

		const { amendmentsDeleteBranchHandler } = await import("./amendments")
		await amendmentsDeleteBranchHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id, id: fork.id },
			noopEmit
		)

		expect((await stored(b)).map((r) => [r.id, r.historyEntryId, r.branchId])).toEqual([
			[undated.id, null, child!.id]
		])
	}, 60_000)

	test("a book holding a dated and an undated version of one link can be overwritten and deleted", async () => {
		const { lorebookImportResolveHandler, lorebooksDeleteHandler } = await import("./lorebooks")
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const [one, two] = [await b.chapter(), await b.chapter()]
		await draw(b, at(guardroom.id), at(hall.id))
		await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: one.id })
		await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: two.id })

		const exported = await dormantExport(fakeSocket(b.user.id), { id: b.lorebook.id })
		const data = JSON.parse(exported.blob.toString("utf-8"))
		// Overwrite answers a held import; hold this file as a conflict would.
		const { holdImport } = await import("$lib/server/imports/heldImports")
		const heldImportId = holdImport(b.user.id, "lorebook", {
			lorebookJson: JSON.stringify(data)
		})
		await lorebookImportResolveHandler.handler(
			fakeSocket(b.user.id),
			{ action: "overwrite", existingId: b.lorebook.id, heldImportId },
			noopEmit
		)
		// The file's own three versions are back.
		expect(await stored(b)).toHaveLength(3)

		await lorebooksDeleteHandler.handler(fakeSocket(b.user.id), { id: b.lorebook.id } as any, noopEmit)
		expect(await stored(b)).toHaveLength(0)
	}, 60_000)

	test("the scene backfill leaves undated a link whose twin already stands at the scene's date", async () => {
		const b = await placesBook()
		const guardroom = await b.place("The Guardroom")
		const hall = await b.place("The Drowned Hall")
		const aria = await b.member("Aria")
		const bram = await b.member("Bram")
		const chapter = await b.chapter()
		const [scene] = await testDb
			.insert(schema.scenes)
			.values({ lorebookId: b.lorebook.id, historyEntryId: chapter.id })
			.returning()
		const dated = await draw(b, at(guardroom.id), at(hall.id), { historyEntryId: chapter.id })
		const [fromScene, tie] = await testDb
			.insert(schema.narrativeRelationships)
			.values([
				{ lorebookId: b.lorebook.id, fromEntryId: guardroom.id, toEntryId: hall.id, relationshipType: "Leads To", sceneId: scene!.id },
				{ lorebookId: b.lorebook.id, fromNodeId: aria.id, toNodeId: bram.id, relationshipType: "ally", sceneId: scene!.id }
			])
			.returning()

		const { backfillRelationshipHistoryEntries } = await import("$lib/server/utils/graphBackfill")
		expect(await backfillRelationshipHistoryEntries(testDb as any)).toBe(1)

		const byId = new Map((await stored(b)).map((r) => [r.id, r.historyEntryId]))
		expect(byId.get(dated.id)).toBe(chapter.id)
		expect(byId.get(fromScene!.id)).toBeNull()
		expect(byId.get(tie!.id)).toBe(chapter.id)
	}, 60_000)

	test("a cast merge never folds a two-way link into a one-way one", async () => {
		const b = await placesBook()
		const shrine = await b.place("The Shrine")
		const alice = await b.member("Alice")
		const bob = await b.member("Bob")
		const twoWay = await draw(b, at(shrine.id), cast(alice.id), {
			relationshipType: "guarded by",
			reverseRelationshipType: "guards"
		})
		const oneWay = await draw(b, at(shrine.id), cast(bob.id), {
			relationshipType: "guarded by",
			description: "A long watch, and a longer description."
		})

		// Alice would hold both: one saying part of what the other says,
		// which one row per way refuses (B1). Folding would lose the way
		// back or the description, so the person is asked instead.
		const { narrativeGraphMergeNodeHandler } = await import("./narrativeGraph")
		await expect(
			narrativeGraphMergeNodeHandler.handler(
				fakeSocket(b.user.id),
				{ nodeId: bob.id, parentNodeId: alice.id },
				noopEmit
			)
		).rejects.toThrow(
			'Alice would be linked to "The Shrine" twice the same way. Change or delete one of those links, then merge again.'
		)

		expect(
			(await stored(b)).map((r) => [r.id, r.toNodeId, r.relationshipType, r.reverseRelationshipType])
		).toEqual([
			[twoWay.id, alice.id, "guarded by", "guards"],
			[oneWay.id, bob.id, "guarded by", null]
		])
	}, 60_000)
})
