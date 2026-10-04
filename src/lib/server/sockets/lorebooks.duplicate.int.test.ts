/**
 * `lorebooks:duplicate` — an EXACT copy of a book (owner ruling 2026-09-28):
 * every row the book owns, written again under new ids in one transaction.
 *
 * The rich fixture below has one of everything — branches including a fork of
 * a fork, entry and cast amendments, presences, both link endpoint kinds,
 * scenes with cast, tags, a story calendar and clock, an item with a supply,
 * archived rows, and a card another user owns — and the copy must equal the
 * original once ids are replaced by stable labels. Owner only, the same rule
 * as delete.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import {
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import {
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	entryInsert,
	loadBookEntries
} from "$lib/server/utils/lorebookEntries"
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
		path.join(os.tmpdir(), "serene-pub-lb-duplicate-int-test-")
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

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

/** A book with one of everything a copy has to carry. */
async function seedBook(userId: number, name: string) {
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
					content: "A district.",
					anchorEntryId: city.id
				}
			])
		)
		.returning()
	const [chapter] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: lorebook.id,
					content: "The founding.",
					year: 1200
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

	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			historyEntryId: chapter.id,
			name: "The meeting",
			summary: "They meet.",
			selectedMessageIds: []
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values({
		sceneId: scene.id,
		bindingId: keeper.id,
		role: "participant",
		ordinal: 0
	})

	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: lorebook.id,
			fromNodeId: keeper.id,
			toEntryId: district.id,
			relationshipType: "keeper of",
			description: "cast to entry"
		},
		{
			lorebookId: lorebook.id,
			fromEntryId: district.id,
			toEntryId: city.id,
			relationshipType: "connects to",
			description: "entry to entry"
		}
	])

	return { lorebook, city, district, chapter, keeper, scene }
}

/** Next free position per (book, type), for rows seeded through entryInsert. */
const positions = new Map<string, number>()
async function insertEntry(
	lorebookId: number,
	data: Record<string, any>,
	extra: Record<string, any> = {}
) {
	const key = `${lorebookId}:${data.typeId}`
	const position = (positions.get(key) ?? 100) + 1
	positions.set(key, position)
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({ lorebookId, position, ...data } as any),
			...extra
		})
		.returning()
	return row
}

/**
 * A book with one of everything the owner ruling names, including rows that
 * point at each other across tables.
 */
async function seedRichBook(ownerId: number, strangerId: number) {
	const base = await seedBook(ownerId, "Rich Source")
	const bookId = base.lorebook.id

	await testDb
		.update(schema.lorebooks)
		.set({
			description: "A rich book.",
			extraJson: { scanDepth: 4 },
			storyCalendar: {
				months: [
					{ name: "Frost", days: 30 },
					{ name: "Thaw", days: 30 }
				]
			} as any,
			storyClockYear: 1201,
			storyClockMonth: 2,
			storyClockDay: 3,
			nextBindingNumber: 9
		})
		.where(eq(schema.lorebooks.id, bookId))

	// A card another user owns, bound here.
	const [foreignCard] = await testDb
		.insert(schema.characters)
		.values({ userId: strangerId, name: "Wanderer", description: "" })
		.returning()
	const [wanderer] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: bookId,
			binding: "{{char:2}}",
			characterId: foreignCard.id,
			name: "Wanderer",
			aliases: ["the stranger"],
			absorbedAliases: ["old man"],
			spriteSet: "travelling",
			parentNodeId: null
		})
		.returning()
	const [alias] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: bookId,
			binding: "{{char:3}}",
			name: "Hooded figure",
			parentNodeId: wanderer.id,
			historyEntryId: base.chapter.id,
			sceneId: base.scene.id,
			nodeState: "dormant" as any
		})
		.returning()

	// Branches: a fork, and a fork of that fork.
	const [northRoad] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: bookId, name: "North road", forkYear: 1200 })
		.returning()
	const [ambush] = await testDb
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: bookId,
			name: "Ambush",
			forkedFromBranchId: northRoad.id,
			forkYear: 1201,
			forkMonth: 1,
			storyClockYear: 1201,
			storyClockMonth: 1,
			storyClockDay: 20
		})
		.returning()

	const tavern = await insertEntry(bookId, {
		typeId: LOCATION_TYPE_ID,
		name: "Tavern",
		content: "A tavern.",
		keys: "tavern"
	})
	const sword = await insertEntry(
		bookId,
		{
			typeId: ITEM_TYPE_ID,
			name: "Sword",
			content: "A sword.",
			supply: "limited",
			supplyLimit: 2,
			anchorEntryId: tavern.id
		},
		{ provenance: "model" }
	)
	const archived = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "Old rumour",
		content: "Forgotten.",
		archived: true,
		enabled: false
	})
	const branchOnly = await insertEntry(bookId, {
		typeId: "core:entry/world-lore",
		name: "Ambush camp",
		content: "Only on the ambush line.",
		branchId: ambush.id
	})
	const privateLore = await insertEntry(bookId, {
		typeId: "core:entry/character-lore",
		name: "Wanderer's secret",
		content: "He is a king.",
		lorebookBindingId: wanderer.id,
		branchId: northRoad.id
	})

	// A branch scene and a branch link, dated by a history entry.
	const ambushChapter = await insertEntry(bookId, {
		typeId: "core:entry/history",
		content: "The ambush.",
		year: 1201,
		month: 2,
		branchId: ambush.id
	})
	const [ambushScene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: bookId,
			historyEntryId: ambushChapter.id,
			branchId: ambush.id,
			name: "Arrows",
			summary: "Arrows fly.",
			selectedMessageIds: [],
			graphed: true
		})
		.returning()
	await testDb.insert(schema.sceneCharacters).values([
		{ sceneId: ambushScene.id, bindingId: wanderer.id, role: "participant" },
		{ sceneId: ambushScene.id, bindingId: alias.id, role: "mentioned", ordinal: 1 }
	])
	await testDb.insert(schema.narrativeRelationships).values([
		{
			lorebookId: bookId,
			fromNodeId: wanderer.id,
			toNodeId: base.keeper.id,
			relationshipType: "distrusts",
			description: "cast to cast",
			visibility: "secret" as any,
			status: "ended",
			reason: "betrayal",
			historyEntryId: ambushChapter.id,
			sceneId: ambushScene.id,
			branchId: ambush.id
		},
		{
			lorebookId: bookId,
			fromEntryId: sword.id,
			toEntryId: tavern.id,
			relationshipType: "kept in",
			reverseRelationshipType: "holds",
			title: "the strongbox",
			description: "entry to entry"
		}
	])

	// Amendments — one whose fields name other rows.
	await testDb.insert(schema.entryAmendments).values([
		{
			lorebookId: bookId,
			entryId: sword.id,
			year: 1201,
			month: 1,
			fields: { content: "A broken sword.", anchorEntryId: base.city.id },
			historyEntryId: base.chapter.id
		},
		{
			lorebookId: bookId,
			entryId: privateLore.id,
			branchId: ambush.id,
			year: 1201,
			fields: { content: "He was a king.", lorebookBindingId: base.keeper.id }
		}
	])
	await testDb.insert(schema.castAmendments).values({
		lorebookId: bookId,
		lorebookBindingId: wanderer.id,
		branchId: northRoad.id,
		year: 1201,
		month: 2,
		personalPosition: 3,
		fields: { name: "The King", parentNodeId: base.keeper.id },
		historyEntryId: ambushChapter.id
	})
	await testDb.insert(schema.castPresences).values([
		{
			lorebookId: bookId,
			lorebookBindingId: wanderer.id,
			personalPosition: 1,
			fromYear: 1200,
			untilYear: 1201,
			untilMonth: 2,
			note: "on the road"
		},
		{
			lorebookId: bookId,
			lorebookBindingId: base.keeper.id,
			branchId: ambush.id,
			personalPosition: 1,
			fromYear: 1201,
			fromMonth: 1
		}
	])

	// Tags, attribute rows, cast curation.
	const [tag] = await testDb
		.insert(schema.tags)
		.values({ userId: ownerId, name: "fantasy" })
		.returning()
	await testDb
		.insert(schema.lorebookTags)
		.values({ lorebookId: bookId, tagId: tag.id })
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "cast_member",
			ownerId: wanderer.id,
			slotId: "core:slot/hp@1",
			value: { v: 12 },
			historyEntryId: ambushChapter.id,
			branchId: ambush.id
		},
		{
			ownerKind: "lorebook",
			ownerId: bookId,
			slotId: "core:slot/weather@1",
			value: { v: "rain" }
		},
		{
			ownerKind: "location",
			ownerId: tavern.id,
			slotId: "core:slot/stock@1",
			value: { v: 3 }
		}
	])
	await testDb.insert(schema.attributeConfigs).values({
		ownerKind: "cast_member",
		ownerId: wanderer.id,
		slotId: "core:slot/hp@1",
		config: { max: 20 }
	})
	await testDb.insert(schema.dismissedDuplicatePairs).values({
		lorebookId: bookId,
		bindingIdA: base.keeper.id,
		bindingIdB: wanderer.id
	})

	// Rows a table registry (plan B1) iterates that the fields above leave
	// empty: one in each, so a table the copy skips shows up in the counts.
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: "test:sheet/duplicate@1", props: {} })
		.onConflictDoNothing()
	await testDb.insert(schema.ownerSheets).values([
		{ ownerKind: "cast_member", ownerId: wanderer.id, sheetId: "test:sheet/duplicate@1" },
		{ ownerKind: "location", ownerId: tavern.id, sheetId: "test:sheet/duplicate@1", position: 1 }
	])
	await testDb.insert(schema.lorebookEntryVectors).values({
		entryId: tavern.id,
		vectorName: "core:vec/default@1",
		dims: 2,
		vector: [0.5, 0.5]
	} as any)
	await testDb.insert(schema.entryAnnotations).values([
		{
			entryId: sword.id,
			entityKey: `entry:${tavern.id}`,
			surface: "Tavern",
			normalized: "tavern",
			tier: "gazetteer",
			refEntryId: tavern.id,
			extractorVersion: "test",
			sourceHash: "h",
			gazetteerHash: "g"
		},
		{
			entryId: sword.id,
			entityKey: `character:${foreignCard.id}`,
			surface: "Wanderer",
			normalized: "wanderer",
			tier: "gazetteer",
			characterId: foreignCard.id,
			extractorVersion: "test",
			sourceHash: "h",
			gazetteerHash: "g"
		}
	] as any)
	await testDb.insert(schema.bindingSuggestions).values({
		lorebookId: bookId,
		entityKey: "open:the ferryman",
		surface: "the Ferryman",
		exampleSourceKind: "entry",
		exampleSourceId: tavern.id
	})
	await testDb.insert(schema.bindingMergeLogs).values({
		lorebookId: bookId,
		userId: ownerId,
		survivorId: base.keeper.id,
		absorbedSnapshot: { name: "Gone" }
	} as any)

	return {
		...base,
		foreignCard,
		wanderer,
		alias,
		northRoad,
		ambush,
		branchOnly,
		tavern,
		sword
	}
}

/**
 * Everything a book owns, with every id replaced by a stable label, so two
 * books compare equal exactly when one is a copy of the other.
 */
async function snapshot(bookId: number) {
	const q = testDb.query
	const book = await q.lorebooks.findFirst({
		where: (l, { eq }) => eq(l.id, bookId)
	})
	const branches = await q.lorebookBranches.findMany({
		where: (b, { eq }) => eq(b.lorebookId, bookId)
	})
	const bindings = await q.lorebookBindings.findMany({
		where: (b, { eq }) => eq(b.lorebookId, bookId)
	})
	const entries = await q.lorebookEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, bookId)
	})
	const scenes = await q.scenes.findMany({
		where: (s, { eq }) => eq(s.lorebookId, bookId),
		with: { characters: true }
	})
	const labelOf = <T extends { id: number }>(
		rows: T[],
		label: (r: T) => string
	) => new Map(rows.map((r) => [r.id, label(r)]))
	const branchL = labelOf(branches, (b) => `branch:${b.name}`)
	const bindingL = labelOf(bindings, (b) => `binding:${b.binding}`)
	const entryL = labelOf(entries, (e) => `entry:${e.typeId}#${e.position}`)
	const sceneL = labelOf(scenes, (s) => `scene:${s.name}`)
	const L = (m: Map<number, string>, id: number | null | undefined) =>
		id == null ? null : (m.get(id) ?? `FOREIGN:${id}`)
	const strip = ({ id, lorebookId, createdAt, updatedAt, ...r }: any) => r
	const sortBy = (rows: any[]) =>
		rows.sort((a, b) =>
			JSON.stringify(a).localeCompare(JSON.stringify(b))
		)
	const remapFields = (f: Record<string, any>) => {
		const out = { ...f }
		for (const k of ["anchorEntryId", "historyEntryId"])
			if (k in out) out[k] = L(entryL, out[k])
		for (const k of ["lorebookBindingId", "parentNodeId"])
			if (k in out) out[k] = L(bindingL, out[k])
		return out
	}

	const { id, uuid, name, createdAt, updatedAt, ...bookRest } = book as any
	const inBook = async (table: any) =>
		testDb.select().from(table).where(eq(table.lorebookId, bookId))
	const entryIds = entries.map((e) => e.id)
	const bindingIds = bindings.map((b) => b.id)

	const attributes = async (table: any) => {
		const rows: any[] = await testDb.select().from(table)
		return sortBy(
			rows
				.filter(
					(r) =>
						(r.ownerKind === "lorebook" && r.ownerId === bookId) ||
						(r.ownerKind === "cast_member" &&
							bindingIds.includes(r.ownerId)) ||
						(r.ownerKind === "location" && entryIds.includes(r.ownerId))
				)
				.map(({ id, createdAt, ...r }) => ({
					...r,
					ownerId:
						r.ownerKind === "lorebook"
							? "book"
							: r.ownerKind === "cast_member"
								? L(bindingL, r.ownerId)
								: L(entryL, r.ownerId),
					branchId: L(branchL, r.branchId),
					historyEntryId: L(entryL, r.historyEntryId),
					sceneId: L(sceneL, r.sceneId)
				}))
		)
	}

	return {
		book: bookRest,
		branches: sortBy(
			branches.map((b) => ({
				...strip(b),
				forkedFromBranchId: L(branchL, b.forkedFromBranchId)
			}))
		),
		bindings: sortBy(
			bindings.map((b) => ({
				...strip(b),
				parentNodeId: L(bindingL, b.parentNodeId),
				sceneId: L(sceneL, b.sceneId),
				historyEntryId: L(entryL, b.historyEntryId)
			}))
		),
		entries: sortBy(
			entries.map((e) => ({
				...strip(e),
				anchorBindingId: L(bindingL, e.anchorBindingId),
				anchorEntryId: L(entryL, e.anchorEntryId),
				branchId: L(branchL, e.branchId)
			}))
		),
		scenes: sortBy(
			scenes.map(({ characters, sessionId, selectedMessageIds, ...s }) => ({
				...strip(s),
				historyEntryId: L(entryL, s.historyEntryId),
				branchId: L(branchL, s.branchId),
				cast: characters
					.map((c: any) => `${c.role}:${L(bindingL, c.bindingId)}:${c.ordinal}`)
					.sort()
			}))
		),
		links: sortBy(
			(await inBook(schema.narrativeRelationships)).map((r: any) => ({
				...strip(r),
				fromNodeId: L(bindingL, r.fromNodeId),
				toNodeId: L(bindingL, r.toNodeId),
				fromEntryId: L(entryL, r.fromEntryId),
				toEntryId: L(entryL, r.toEntryId),
				historyEntryId: L(entryL, r.historyEntryId),
				sceneId: L(sceneL, r.sceneId),
				branchId: L(branchL, r.branchId)
			}))
		),
		entryAmendments: sortBy(
			(await inBook(schema.entryAmendments)).map((a: any) => ({
				...strip(a),
				entryId: L(entryL, a.entryId),
				branchId: L(branchL, a.branchId),
				historyEntryId: L(entryL, a.historyEntryId),
				fields: remapFields(a.fields)
			}))
		),
		castAmendments: sortBy(
			(await inBook(schema.castAmendments)).map((a: any) => ({
				...strip(a),
				lorebookBindingId: L(bindingL, a.lorebookBindingId),
				branchId: L(branchL, a.branchId),
				historyEntryId: L(entryL, a.historyEntryId),
				fields: remapFields(a.fields)
			}))
		),
		presences: sortBy(
			(await inBook(schema.castPresences)).map((p: any) => ({
				...strip(p),
				lorebookBindingId: L(bindingL, p.lorebookBindingId),
				branchId: L(branchL, p.branchId)
			}))
		),
		tags: (await inBook(schema.lorebookTags)).map((t: any) => t.tagId).sort(),
		// A pair is unordered: each is stored smaller id first, and a copy
		// may number the two the other way round.
		dismissed: sortBy(
			(await inBook(schema.dismissedDuplicatePairs)).map((d: any) =>
				[L(bindingL, d.bindingIdA), L(bindingL, d.bindingIdB)].sort()
			)
		),
		attributeValues: await attributes(schema.attributeValues),
		attributeConfigs: await attributes(schema.attributeConfigs)
	}
}

describe("lorebooks:duplicate — exact copy (PGlite integration)", () => {
	test("the copy equals the original modulo ids", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-exact-owner")
		const stranger = await makeUser("lb-dup-exact-stranger")
		const source = await seedRichBook(owner.id, stranger.id)

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		expect(copy.name).toBe("Rich Source (copy)")

		const before = await snapshot(source.lorebook.id)
		const after = await snapshot(copy.id)

		// No reference in the copy leaks out to the original's rows.
		expect(JSON.stringify(after)).not.toContain("FOREIGN:")
		expect(after).toEqual(before)

		// Spot checks the equality above already implies, named for the reader.
		expect(after.branches).toContainEqual(
			expect.objectContaining({
				name: "Ambush",
				forkedFromBranchId: "branch:North road"
			})
		)
		expect(after.bindings).toContainEqual(
			expect.objectContaining({
				characterId: source.foreignCard.id,
				spriteSet: "travelling"
			})
		)
		expect(after.entries).toContainEqual(
			expect.objectContaining({
				typeId: ITEM_TYPE_ID,
				provenance: "model",
				fields: expect.objectContaining({ supply: "limited", supplyLimit: 2 })
			})
		)
		expect(after.entries).toContainEqual(
			expect.objectContaining({ archived: true, enabled: false })
		)
		expect(after.book.storyClockYear).toBe(1201)
		expect(after.book.nextBindingNumber).toBe(9)
		expect(after.entryAmendments.length).toBe(2)
		expect(after.castAmendments.length).toBe(1)
		expect(after.presences.length).toBe(2)
		expect(after.tags.length).toBe(1)
		expect(after.attributeValues.length).toBe(3)
		expect(after.attributeConfigs.length).toBe(1)

		// The source is untouched and the stranger's card was not copied.
		const cards = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, owner.id)
		})
		expect(cards).toHaveLength(0)
	}, 60_000)

	test("the owner's own bound cards are referenced, never recreated or rewritten (finding #23)", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-owned-cards")
		const source = await seedBook(owner.id, "Owned Cards")
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Maren", description: "Smith." })
			.returning()
		const [persona] = await testDb
			.insert(schema.characters)
			.values({
				userId: owner.id,
				name: "Traveller",
				description: "",
				isPersona: true
			} as any)
			.returning()
		await testDb.insert(schema.lorebookBindings).values([
			{
				lorebookId: source.lorebook.id,
				binding: "{{char:2}}",
				characterId: card.id,
				name: "Maren"
			},
			{
				lorebookId: source.lorebook.id,
				binding: "{{char:3}}",
				characterId: persona.id,
				name: "Traveller"
			}
		])
		const before = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, owner.id),
			orderBy: (c, { asc }) => asc(c.id)
		})

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		const after = await testDb.query.characters.findMany({
			where: (c, { eq }) => eq(c.userId, owner.id),
			orderBy: (c, { asc }) => asc(c.id)
		})
		expect(after).toEqual(before)
		const copyCards = (
			await testDb.query.lorebookBindings.findMany({
				where: (b, { eq }) => eq(b.lorebookId, copy.id)
			})
		)
			.map((b) => b.characterId)
			.filter((id) => id !== null)
			.sort()
		expect(copyCards).toEqual([card.id, persona.id].sort())
	}, 60_000)

	test("a scene's session capture stays with the original", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-capture")
		const source = await seedBook(owner.id, "Captured")
		await testDb
			.update(schema.scenes)
			.set({ selectedMessageIds: [11, 12] })
			.where(eq(schema.scenes.id, source.scene.id))

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		const [scene] = await testDb.query.scenes.findMany({
			where: (s, { eq }) => eq(s.lorebookId, copy.id)
		})
		expect(scene.sessionId).toBeNull()
		expect(scene.selectedMessageIds).toEqual([])
	}, 60_000)

	test("the copy's next cast member takes the next free token", async () => {
		const { lorebooksDuplicateHandler, createLorebookBindingHandler } =
			await import("./lorebooks")
		const owner = await makeUser("lb-dup-token")
		const source = await seedBook(owner.id, "Tokens")
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: source.lorebook.id,
			binding: "{{char:2}}",
			name: "Second"
		})
		// A book whose counter fell behind its own tokens (legacy data).
		await testDb
			.update(schema.lorebooks)
			.set({ nextBindingNumber: 1 })
			.where(eq(schema.lorebooks.id, source.lorebook.id))

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		const { lorebookBinding } = await createLorebookBindingHandler.handler(
			fakeSocket(owner.id),
			{ lorebookBinding: { lorebookId: copy.id, name: "Third" } } as any,
			noopEmit
		)
		expect(lorebookBinding.binding).toBe("{{char:3}}")
	}, 60_000)
})

describe("lorebooks:duplicate (PGlite integration)", () => {
	test("copies entries, bindings, scenes and both endpoint kinds, under new ids", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const user = await makeUser("lb-dup-owner")
		const source = await seedBook(user.id, "Source Book")

		const emitted: string[] = []
		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: source.lorebook.id },
			(event: string) => emitted.push(event)
		)

		expect(copy.id).not.toBe(source.lorebook.id)
		expect(copy.name).toBe("Source Book (copy)")
		expect(copy.uuid).not.toBe(source.lorebook.uuid)
		expect(emitted).toContain("lorebooks:list")
		expect(emitted).toContain("lorebooks:duplicate")

		const sourceEntries = await loadBookEntries(testDb, source.lorebook.id)
		const copyEntries = await loadBookEntries(testDb, copy.id)
		expect(copyEntries).toHaveLength(sourceEntries.length)
		const copyEntryIds = new Set(copyEntries.map((e) => e.id))
		for (const entry of copyEntries)
			expect(sourceEntries.some((e) => e.id === entry.id)).toBe(false)

		const byName = new Map(copyEntries.map((e) => [e.name, e]))
		expect(byName.get("District")!.anchorEntryId).toBe(
			byName.get("City")!.id
		)

		const copyBindings = await testDb.query.lorebookBindings.findMany({
			where: (b, { eq }) => eq(b.lorebookId, copy.id)
		})
		expect(copyBindings.map((b) => b.name)).toEqual(["Keeper"])
		const copyBindingIds = new Set(copyBindings.map((b) => b.id))
		expect(copyBindingIds.has(source.keeper.id)).toBe(false)

		const copyScenes = await testDb.query.scenes.findMany({
			where: (s, { eq }) => eq(s.lorebookId, copy.id),
			with: { characters: true }
		})
		expect(copyScenes).toHaveLength(1)
		expect(copyScenes[0].name).toBe("The meeting")
		expect(copyScenes[0].characters.map((c: any) => c.bindingId)).toEqual([
			copyBindings[0].id
		])

		const copyEdges = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, copy.id)
		})
		expect(copyEdges.map((r) => r.relationshipType).sort()).toEqual([
			"connects to",
			"keeper of"
		])
		for (const edge of copyEdges) {
			for (const entryId of [edge.fromEntryId, edge.toEntryId])
				if (entryId !== null)
					expect(copyEntryIds.has(entryId)).toBe(true)
			for (const nodeId of [edge.fromNodeId, edge.toNodeId])
				if (nodeId !== null)
					expect(copyBindingIds.has(nodeId)).toBe(true)
		}

		// The source is untouched by its own copy.
		const sourceEdges = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, source.lorebook.id)
		})
		expect(sourceEdges).toHaveLength(2)
	}, 60_000)

	test("takes the name it is given", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const user = await makeUser("lb-dup-named")
		const source = await seedBook(user.id, "Named Source")

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: source.lorebook.id, name: "Second Draft" },
			noopEmit
		)
		expect(copy.name).toBe("Second Draft")
	}, 60_000)

	test("carries a relationship's name and reverse relationship type (plan B1)", async () => {
		// The copy writes each row with `...row`, so the two B1 columns ride
		// along with no code of their own — this pins that it stays so.
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const user = await makeUser("lb-dup-way-words")
		const source = await seedBook(user.id, "Two-way Source")
		await testDb
			.update(schema.narrativeRelationships)
			.set({ title: "the old stair", reverseRelationshipType: "connects to" })
			.where(eq(schema.narrativeRelationships.fromEntryId, source.district.id))

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		const copied = await testDb.query.narrativeRelationships.findMany({
			where: (r, { eq }) => eq(r.lorebookId, copy.id)
		})
		const way = copied.find((r) => r.relationshipType === "connects to")
		expect(way).toMatchObject({
			title: "the old stair",
			reverseRelationshipType: "connects to"
		})
		const tie = copied.find((r) => r.relationshipType === "keeper of")
		expect(tie).toMatchObject({ title: "", reverseRelationshipType: null })
	}, 60_000)

	test("refuses a book the caller does not own", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-other-owner")
		const stranger = await makeUser("lb-dup-stranger")
		const source = await seedBook(owner.id, "Private Book")

		await expect(
			lorebooksDuplicateHandler.handler(
				fakeSocket(stranger.id),
				{ lorebookId: source.lorebook.id },
				noopEmit
			)
		).rejects.toThrow(/not found/i)

		const strangerBooks = await testDb.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, stranger.id)
		})
		expect(strangerBooks).toHaveLength(0)
	}, 60_000)
})

describe("lorebooks:duplicate — dismissed duplicate pairs (plan A8)", () => {
	test("each pair is copied once, smaller id first, whatever order the cast is copied in", async () => {
		const { lorebooksCreateHandler, lorebooksDuplicateHandler } =
			await import("./lorebooks")
		const user = await makeUser("lb-dup-dismissed")
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: "Pairs" },
			noopEmit
		)
		const member = async (n: number, name: string) =>
			(
				await testDb
					.insert(schema.lorebookBindings)
					.values({ lorebookId: lorebook.id, binding: `{{char:${n}}}`, name })
					.returning()
			)[0]
		const ada = await member(1, "Ada")
		const bea = await member(2, "Bea")
		const cy = await member(3, "Cy")
		// Retagged after the others (a new index entry, not an in-place
		// update), Ada is read back after them by a plain select, so the copy
		// numbers her last: her pair with Bea flips.
		await testDb
			.update(schema.lorebookBindings)
			.set({ binding: "{{char:9}}" })
			.where(eq(schema.lorebookBindings.id, ada.id))
		const read = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebook.id))
		expect(read.at(-1)!.id).toBe(ada.id)
		await testDb.insert(schema.dismissedDuplicatePairs).values([
			{ lorebookId: lorebook.id, bindingIdA: ada.id, bindingIdB: bea.id },
			// Both orders of one pair: the unique index cannot tell them apart.
			{ lorebookId: lorebook.id, bindingIdA: bea.id, bindingIdB: cy.id },
			{ lorebookId: lorebook.id, bindingIdA: cy.id, bindingIdB: bea.id }
		])

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: lorebook.id },
			noopEmit
		)

		const names = new Map(
			(
				await testDb
					.select({
						id: schema.lorebookBindings.id,
						name: schema.lorebookBindings.name
					})
					.from(schema.lorebookBindings)
					.where(eq(schema.lorebookBindings.lorebookId, copy.id))
			).map((b) => [b.id, b.name])
		)
		const pairs = await testDb
			.select()
			.from(schema.dismissedDuplicatePairs)
			.where(eq(schema.dismissedDuplicatePairs.lorebookId, copy.id))
		expect(pairs.every((p) => p.bindingIdA < p.bindingIdB)).toBe(true)
		expect(
			pairs
				.map((p) => [names.get(p.bindingIdA), names.get(p.bindingIdB)].sort().join("+"))
				.sort()
		).toEqual(["Ada+Bea", "Bea+Cy"])
	}, 60_000)
})

describe("lorebooks:duplicate and delete — the table registry (plan B1)", () => {
	test("every registered table is copied row for row, the deliberate exclusion empty", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const { LOREBOOK_TABLES } = await import("$lib/server/lorebooks/tableRegistry")
		const owner = await makeUser("lb-dup-registry-owner")
		const stranger = await makeUser("lb-dup-registry-stranger")
		const source = await seedRichBook(owner.id, stranger.id)

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)

		const counts: Record<string, [number, number]> = {}
		for (const spec of LOREBOOK_TABLES)
			counts[getTableConfig(spec.table).name] = [
				await spec.count(testDb as any, source.lorebook.id),
				await spec.count(testDb as any, copy.id)
			]
		for (const spec of LOREBOOK_TABLES) {
			const name = getTableConfig(spec.table).name
			const [from, to] = counts[name]
			// The fixture holds a row in every table, so a table the copy
			// skips cannot pass by being empty on both sides.
			expect([name, from > 0]).toEqual([name, true])
			expect([name, to]).toEqual([name, spec.notCopied ? 0 : from])
		}
	}, 60_000)

	test("an annotation naming an entry names the copy's entry; a card stays the card", async () => {
		const { lorebooksDuplicateHandler } = await import("./lorebooks")
		const owner = await makeUser("lb-dup-annotation-owner")
		const stranger = await makeUser("lb-dup-annotation-stranger")
		const source = await seedRichBook(owner.id, stranger.id)

		const { lorebook: copy } = await lorebooksDuplicateHandler.handler(
			fakeSocket(owner.id),
			{ lorebookId: source.lorebook.id },
			noopEmit
		)
		const copied = await testDb.query.lorebookEntries.findMany({
			where: (e, { eq }) => eq(e.lorebookId, copy.id)
		})
		const tavern = copied.find((e) => e.typeId === LOCATION_TYPE_ID)!
		const sword = copied.find((e) => e.typeId === ITEM_TYPE_ID)!
		const keys = (
			await testDb
				.select()
				.from(schema.entryAnnotations)
				.where(eq(schema.entryAnnotations.entryId, sword.id))
		)
			.map((a) => `${a.entityKey}|${a.refEntryId}`)
			.sort()
		expect(keys).toEqual(
			[`character:${source.foreignCard.id}|null`, `entry:${tavern.id}|${tavern.id}`].sort()
		)
		const sheets = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(eq(schema.ownerSheets.ownerId, tavern.id))
		expect(sheets.map((s) => [s.ownerKind, s.sheetId])).toEqual([
			["location", "test:sheet/duplicate@1"]
		])
	}, 60_000)

	test("book delete leaves no row behind in any registered table", async () => {
		const { lorebooksDeleteHandler } = await import("./lorebooks")
		const { LOREBOOK_TABLES, bookStatOwners } = await import(
			"$lib/server/lorebooks/tableRegistry"
		)
		const owner = await makeUser("lb-delete-registry-owner")
		const stranger = await makeUser("lb-delete-registry-stranger")
		const source = await seedRichBook(owner.id, stranger.id)
		const owners = await bookStatOwners(testDb as any, source.lorebook.id)
		const entryIds = (
			await testDb
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, source.lorebook.id))
		).map((e) => e.id)

		await lorebooksDeleteHandler.handler(
			fakeSocket(owner.id),
			{ id: source.lorebook.id },
			noopEmit
		)

		for (const spec of LOREBOOK_TABLES) {
			const t = spec.table as any
			let left: unknown[]
			if (typeof spec.scope === "object")
				left = (
					await Promise.all(
						owners
							.filter(([, ids]) => ids.length > 0)
							.map(([kinds, ids]) =>
								testDb
									.select()
									.from(t)
									.where(and(inArray(t.ownerKind, kinds), inArray(t.ownerId, ids)))
							)
					)
				).flat()
			else if (spec.scope === "entry")
				left = await testDb.select().from(t).where(inArray(t.entryId, entryIds))
			else if (spec.scope === "scene")
				left = await testDb
					.select()
					.from(t)
					.where(inArray(t.sceneId, [source.scene.id]))
			else left = await testDb.select().from(t).where(eq(t.lorebookId, source.lorebook.id))
			expect([getTableConfig(spec.table).name, left.length]).toEqual([
				getTableConfig(spec.table).name,
				0
			])
		}
	}, 60_000)
})
