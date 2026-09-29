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
			{ lorebookData: exportedData },
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
			{ lorebookData: legacyPayload },
			noopEmit
		)
		expect(imported.status).toBe("created")
		expect(await edgeSummary(imported.lorebook!.id)).toEqual([
			"ally: cast:Old Keeper -> cast:Old Guard"
		])
	}, 60_000)
})
