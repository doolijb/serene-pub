/**
 * Rebuild is for character ties only (owner ruling 2026-09-29, Q1: "Rebuild
 * is only for relationships. There should be no rebuild locations because
 * they are largely static." — places plan L1).
 *
 * It superseded ruling 6 of 2026-09-28 ("keeps its wipe-everything behaviour
 * but the confirmation warns with counts") once places took their whole shape
 * from relationships: one Rebuild would have erased every hand-drawn map.
 *
 * Pinned, for both apply modes:
 * - a place entry, and the stats recorded for it, are neither created nor
 *   deleted nor changed;
 * - a relationship with an entry at either end — a road between two places,
 *   the keeper of a place — is never created, updated or deleted;
 * - cast ties are still rebuilt (replace) or extended (extend);
 * - the list counts only what a Rebuild deletes;
 * - the build hands the builder every place's name to screen, so a place named
 *   in a scene is never minted as a character.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { applyAtReview } from "./fixtures/graphReview"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import {
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// The build reaches the builder only after resolving configs; what they hold
// is beside the point here.

/** The screen each build handed the builder, in call order. */
const capturedScreens: { name: string; category: string | null; typeId?: string }[][] = []

vi.mock("$lib/server/utils/graphBuilder", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/utils/graphBuilder")>()
	return {
		...actual,
		buildGraphFromScenes: async (opts: {
			worldLore?: { name: string; category: string | null; typeId?: string }[]
		}) => {
			capturedScreens.push(opts.worldLore ?? [])
			return {
				proposal: { nodes: [], relationships: [] },
				resolvedSceneCast: [],
				sceneLabels: [],
				seedTempIdMap: {},
				seedNodeNames: {}
			}
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-rebuild-places-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb

	// The instance's chat default, which the build runs on (see
	// narrativeGraph.buildReadsStoredCast.int.test.ts).
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection.id,
		"graph-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling.id
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

beforeEach(() => {
	capturedScreens.length = 0
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

let seq = 0
const positions = new Map<string, number>()

/**
 * A book with a cast of three, two places joined by a road, a keeper of one
 * place, one cast tie, and stats recorded for a place.
 */
async function seedBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `rebuild-places-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Rebuild Places ${seq}`, userId: user.id })
		.returning()
	const bookId = lorebook.id

	const member = async (name: string, i: number) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: bookId, binding: `{{char:${i}}}`, name })
				.returning()
		)[0]
	const aria = await member("Aria", 1)
	const bram = await member("Bram", 2)
	const cole = await member("Cole", 3)

	const entry = async (typeId: string, name: string) => {
		const key = `${bookId}:${typeId}`
		const position = (positions.get(key) ?? 0) + 1
		positions.set(key, position)
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					lorebookId: bookId,
					typeId,
					position,
					name,
					content: `${name}.`,
					keys: ""
				} as any)
			)
			.returning()
		return row
	}
	const crypt = await entry(LOCATION_TYPE_ID, "The Crypt")
	const hall = await entry(LOCATION_TYPE_ID, "The Hall")

	const [tie, road, keeper] = await testDb
		.insert(schema.narrativeRelationships)
		.values([
			// A cast tie — the one kind a rebuild derives.
			{
				lorebookId: bookId,
				fromNodeId: aria.id,
				toNodeId: bram.id,
				relationshipType: "ally",
				description: "Old friends."
			},
			// A place relationship: a road, drawn by hand.
			{
				lorebookId: bookId,
				fromEntryId: crypt.id,
				toEntryId: hall.id,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to",
				title: "the iron door",
				description: "Rusted shut in winter."
			},
			// A place relationship with a cast member at the other end.
			{
				lorebookId: bookId,
				fromNodeId: aria.id,
				toEntryId: crypt.id,
				relationshipType: "keeps",
				description: "She holds the only key."
			}
		])
		.returning()

	// The key in the crypt, recorded before play.
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "location",
		ownerId: crypt.id,
		slotId: "core:slot/inventory@1",
		value: { v: [{ name: "iron key", count: 1 }] }
	})
	await testDb.insert(schema.attributeConfigs).values({
		ownerKind: "location",
		ownerId: crypt.id,
		slotId: "core:slot/inventory@1",
		config: { max: 5 }
	})

	return { user, lorebook, aria, bram, cole, crypt, hall, tie, road, keeper }
}

type Book = Awaited<ReturnType<typeof seedBook>>

/** Everything about a book's places a rebuild must leave exactly as it was. */
async function placesOf(b: Book) {
	const ids = [b.crypt.id, b.hall.id]
	const { isNotNull, or } = await import("drizzle-orm")
	return {
		entries: await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, b.lorebook.id),
					eq(schema.lorebookEntries.typeId, LOCATION_TYPE_ID)
				)
			)
			.orderBy(schema.lorebookEntries.id),
		links: await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(
				and(
					eq(schema.narrativeRelationships.lorebookId, b.lorebook.id),
					or(
						isNotNull(schema.narrativeRelationships.fromEntryId),
						isNotNull(schema.narrativeRelationships.toEntryId)
					)
				)
			)
			.orderBy(schema.narrativeRelationships.id),
		values: await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "location"),
					inArray(schema.attributeValues.ownerId, ids)
				)
			)
			.orderBy(schema.attributeValues.id),
		configs: await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "location"),
					inArray(schema.attributeConfigs.ownerId, ids)
				)
			)
			.orderBy(schema.attributeConfigs.id)
	}
}

async function castTiesOf(b: Book) {
	const { isNotNull } = await import("drizzle-orm")
	return testDb
		.select()
		.from(schema.narrativeRelationships)
		.where(
			and(
				eq(schema.narrativeRelationships.lorebookId, b.lorebook.id),
				isNotNull(schema.narrativeRelationships.fromNodeId),
				isNotNull(schema.narrativeRelationships.toNodeId)
			)
		)
		.orderBy(schema.narrativeRelationships.id)
}

async function apply(
	b: Book,
	mode: "replace" | "extend",
	relationships: {
		fromTempId: string
		toTempId: string
		relationshipType: string
		description?: string
	}[]
) {
	const { narrativeGraphApplyProposalHandler } = await import(
		"./narrativeGraph"
	)
	await narrativeGraphApplyProposalHandler.handler(
		fakeSocket(b.user.id),
		applyAtReview(b.user.id, {
			lorebookId: b.lorebook.id,
			mode,
			proposal: { nodes: [], relationships } as any
		}),
		noopEmit
	)
}

describe("Rebuild leaves places alone (places plan L1)", () => {
	test("replace: places, their relationships and their stats survive; cast ties are rebuilt", async () => {
		const b = await seedBook()
		const before = await placesOf(b)
		expect(before.links).toHaveLength(2)
		expect(before.values).toHaveLength(1)

		await apply(b, "replace", [
			{
				fromTempId: `existing_${b.aria.id}`,
				toTempId: `existing_${b.cole.id}`,
				relationshipType: "rival"
			}
		])

		// Not one place row, place relationship or place stat moved — same
		// ids, same words, same everything.
		expect(await placesOf(b)).toEqual(before)

		// The old tie went; the proposal's is the only one.
		const ties = await castTiesOf(b)
		expect(ties.map((t) => t.id)).not.toContain(b.tie.id)
		expect(
			ties.map((t) => [t.fromNodeId, t.toNodeId, t.relationshipType])
		).toEqual([[b.aria.id, b.cole.id, "rival"]])
	}, 60_000)

	test("replace: a place link drawn on a branch survives too", async () => {
		// L1 review: neither test put a place link on a branch. Replace
		// deletes cast ties on every line; a place link on any line is kept.
		const b = await seedBook()
		const [fork] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: b.lorebook.id, name: "Flooded" })
			.returning()
		const [branchRoad] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: b.lorebook.id,
				branchId: fork!.id,
				fromEntryId: b.hall.id,
				toEntryId: b.crypt.id,
				relationshipType: "floods into",
				description: "Since the dam broke."
			})
			.returning()
		const before = await placesOf(b)
		expect(before.links.map((l) => l.id)).toContain(branchRoad!.id)

		await apply(b, "replace", [])

		expect(await placesOf(b)).toEqual(before)
		expect(await castTiesOf(b)).toHaveLength(0)
	}, 60_000)

	test("replace with an empty proposal deletes the cast ties and nothing else", async () => {
		const b = await seedBook()
		const before = await placesOf(b)

		await apply(b, "replace", [])

		expect(await placesOf(b)).toEqual(before)
		expect(await castTiesOf(b)).toHaveLength(0)
	}, 60_000)

	test("extend: places, their relationships and their stats survive; a cast tie is updated", async () => {
		const b = await seedBook()
		const before = await placesOf(b)

		await apply(b, "extend", [
			{
				fromTempId: `existing_${b.aria.id}`,
				toTempId: `existing_${b.bram.id}`,
				relationshipType: "ally",
				description: "Sworn to each other now."
			}
		])

		expect(await placesOf(b)).toEqual(before)
		const ties = await castTiesOf(b)
		expect(ties).toHaveLength(1)
		expect(ties[0].id).toBe(b.tie.id)
		expect(ties[0].description).toBe("Sworn to each other now.")
	}, 60_000)

	test("the list counts only what a Rebuild deletes: the cast ties", async () => {
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const b = await seedBook()

		const listed = await narrativeGraphListHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: b.lorebook.id },
			noopEmit
		)

		// Three links in the book; a Rebuild deletes one of them.
		expect(listed.relationships).toHaveLength(3)
		expect(listed.relationshipCounts).toEqual({ castToCast: 1 })
	}, 60_000)

	test("the build screens every place and item by name, so a place in a scene is never minted as a character", async () => {
		const b = await seedBook()
		const bookId = b.lorebook.id
		const key = `${bookId}:${ITEM_TYPE_ID}`
		positions.set(key, (positions.get(key) ?? 0) + 1)
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				lorebookId: bookId,
				typeId: ITEM_TYPE_ID,
				position: positions.get(key)!,
				name: "The Iron Key",
				content: "A key.",
				keys: ""
			} as any)
		)
		const wKey = `${bookId}:${WORLD_LORE_TYPE_ID}`
		positions.set(wKey, (positions.get(wKey) ?? 0) + 1)
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				lorebookId: bookId,
				typeId: WORLD_LORE_TYPE_ID,
				position: positions.get(wKey)!,
				name: "The Old Faith",
				content: "A creed.",
				keys: ""
			} as any)
		)
		const [historyEntry] = await testDb
			.insert(schema.lorebookEntries)
			.values(historyValues([{ lorebookId: bookId, year: 1, content: "" }]))
			.returning()
		await testDb.insert(schema.scenes).values({
			lorebookId: bookId,
			name: "Below",
			summary: "Aria went down into The Crypt.",
			historyEntryId: historyEntry.id
		})

		const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
		await narrativeGraphBuildHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookId: bookId, mode: "replace" } as any,
			noopEmit as any
		)

		expect(capturedScreens).toHaveLength(1)
		// Each with its entry type: a place or an item screens by its whole
		// title and is never opted out by its category (L1 review).
		expect(
			capturedScreens[0].map((e) => [e.name, e.typeId]).sort((x, y) => x[0]!.localeCompare(y[0]!))
		).toEqual([
			["The Crypt", LOCATION_TYPE_ID],
			["The Hall", LOCATION_TYPE_ID],
			["The Iron Key", ITEM_TYPE_ID],
			["The Old Faith", WORLD_LORE_TYPE_ID]
		])
	}, 60_000)
})
