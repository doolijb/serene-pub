/**
 * A book's places, their links, their stats and its items survive a file, and
 * the file carries main only (plan A4 + A26).
 *
 * Lorebook export is paused, but `characters:exportCard` still embeds a whole
 * book through the same builder, and the import's unchanged-vs-conflict check
 * rebuilds one. So both halves are live today:
 *
 * - **A4.** The builder read every line: a branch's own entries, scenes and
 *   links went out as if they were main's, and came back as main's.
 * - **A26.** A place and an item were written as world lore and came back as
 *   world lore, so the rooms listing, a place's stats, an item's supply and
 *   every in-app `matchMode` edit were lost on the trip.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
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
		path.join(os.tmpdir(), "serene-pub-places-export-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

const INVENTORY = "core:slot/inventory@1"
const LAMPS = "test:slot/lamps@1"
const HP = "core:slot/hp@1"
const WEATHER = "core:slot/weather@1"

let seq = 0

/**
 * A book with two places joined by a named two-way link, three items (one
 * archived by a machine writer), a world entry whose whole-word flag the
 * author changed in the app, a history entry and a scene, stats at every
 * book-owned layer — and a branch holding its own place, link, scene and
 * stat, none of which may leave the book.
 */
async function seedBook() {
	const n = ++seq
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `places-export-${n}`)
	const { lorebooksCreateHandler } = await import("./lorebooks")
	const { lorebook } = await lorebooksCreateHandler.handler(
		fakeSocket(user.id),
		{ name: `Crypt Book ${n}` },
		noopEmit
	)
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	const {
		HISTORY_TYPE_ID,
		ITEM_TYPE_ID,
		LOCATION_TYPE_ID,
		WORLD_LORE_TYPE_ID
	} = await import("$lib/shared/entries/types")

	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "A delver." })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: character.id,
			binding: "{{char:1}}",
			name: "Verity",
			spriteSet: "winter"
		})
		.returning()
	const [branch] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: lorebook.id, name: "What if" })
		.returning()

	const positions = new Map<string, number>()
	const entry = async (
		typeId: string,
		values: Record<string, unknown>
	) => {
		const position = positions.get(typeId) ?? 0
		positions.set(typeId, position + 1)
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				...entryInsert({
					typeId,
					lorebookId: lorebook.id,
					position,
					content: `${values.name ?? "An entry"}.`,
					...values
				} as any),
				...(values.provenance
					? { provenance: values.provenance as string }
					: {})
			})
			.returning()
		return row!
	}

	const crypt = await entry(LOCATION_TYPE_ID, {
		name: "The Crypt",
		keys: ["crypt"],
		category: "Undercroft",
		priority: 2
	})
	const chapel = await entry(LOCATION_TYPE_ID, {
		name: "The Chapel",
		keys: ["chapel"]
	})
	const key = await entry(ITEM_TYPE_ID, {
		name: "Iron Key",
		keys: ["key"],
		supply: "unique"
	})
	const torch = await entry(ITEM_TYPE_ID, {
		name: "Torch",
		keys: ["torch"],
		supply: "limited",
		supplyLimit: 3
	})
	await entry(ITEM_TYPE_ID, {
		name: "Old Map",
		keys: ["map"],
		archived: true,
		recursionDepth: 2,
		provenance: "summarizer"
	})
	await entry(WORLD_LORE_TYPE_ID, {
		name: "Bells",
		keys: ["bell"],
		// Whole words, the SillyTavern file said; substring, the author
		// has since chosen in the editor.
		matchMode: "substring",
		extraJson: { match_whole_words: true, probability: 80 }
	})
	const year1 = await entry(HISTORY_TYPE_ID, { year: 1 })
	const [mainScene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			historyEntryId: year1.id,
			name: "The descent",
			selectedMessageIds: []
		})
		.returning()

	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook.id,
		fromEntryId: crypt.id,
		toEntryId: chapel.id,
		relationshipType: "leads up to",
		reverseRelationshipType: "leads down to",
		title: "the narrow stair"
	})

	// Stats set before play, at every layer the book owns.
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "location",
			ownerId: crypt.id,
			slotId: INVENTORY,
			value: { v: [{ entryId: key.id }, { entryId: torch.id, count: 2 }, "bones"] }
		},
		{
			ownerKind: "location",
			ownerId: chapel.id,
			slotId: LAMPS,
			value: { v: 3 },
			historyEntryId: year1.id,
			note: "Lit for the vigil."
		},
		{
			ownerKind: "cast_member",
			ownerId: member.id,
			slotId: HP,
			value: { v: 12 }
		},
		{
			ownerKind: "lorebook",
			ownerId: lorebook.id,
			slotId: WEATHER,
			value: { v: "storm" }
		}
	])
	await testDb.insert(schema.attributeConfigs).values({
		ownerKind: "location",
		ownerId: crypt.id,
		slotId: LAMPS,
		config: { max: 5 }
	})

	// The branch's own rows.
	const [branchRoom] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({
				typeId: LOCATION_TYPE_ID,
				lorebookId: lorebook.id,
				position: positions.get(LOCATION_TYPE_ID)!,
				name: "The Flooded Vault",
				content: "Only on the branch."
			} as any),
			branchId: branch.id
		})
		.returning()
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: lorebook.id,
		fromEntryId: crypt.id,
		toEntryId: branchRoom.id,
		relationshipType: "floods into",
		branchId: branch.id
	})
	await testDb.insert(schema.scenes).values({
		lorebookId: lorebook.id,
		historyEntryId: year1.id,
		name: "The flood",
		selectedMessageIds: [],
		branchId: branch.id
	})
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "location",
		ownerId: crypt.id,
		slotId: LAMPS,
		value: { v: 9 },
		branchId: branch.id
	})

	return { user, lorebook, character, member, crypt, chapel, key, torch, year1, mainScene }
}

async function exportBook(lorebookId: number, userId: number) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(
		lorebookId,
		userId
	)
	return JSON.parse(JSON.stringify(specBookWithGraph))
}

describe("a card export carries the book's main line only (plan A4)", () => {
	test("no branch entry, scene, link or stat leaves in the card's book", async () => {
		const b = await seedBook()
		const { charactersExportCard } = await import("./characters")
		const exported = await charactersExportCard.handler(
			fakeSocket(b.user.id),
			{ id: b.character.id, format: "json", lorebookId: b.lorebook.id },
			noopEmit
		)
		const book = JSON.parse(exported.blob.toString("utf-8")).data
			.character_book

		const names = book.entries.map((e: any) => e.name ?? "")
		expect(names).not.toContain("The Flooded Vault")
		expect(names).toContain("The Crypt")

		const serenepub = book.extensions.serenepub
		expect(
			serenepub.narrativeGraph.relationships.map(
				(r: any) => r.relationshipType
			)
		).toEqual(["leads up to"])
		const scenes = book.entries.flatMap(
			(e: any) => e.extensions.serenepub.scenes ?? []
		)
		expect(scenes.map((s: any) => s.name)).toEqual(["The descent"])
		expect(
			serenepub.stats.values.filter((v: any) => v.slotId === LAMPS)
		).toEqual([
			expect.objectContaining({ value: { v: 3 } })
		])
	}, 60_000)
})

describe("places, ways, stats and items survive a file (plan A26)", () => {
	test("the wire names each type, and a foreign reader still sees plain entries", async () => {
		const b = await seedBook()
		const data = await exportBook(b.lorebook.id, b.user.id)

		const byName = new Map<string, any>(
			data.entries.map((e: any) => [e.name ?? "", e])
		)
		expect(data.extensions.serenepub.formatVersion).toBe(2)
		expect(byName.get("The Crypt").extensions.serenepub.entryType).toBe(
			"location"
		)
		expect(byName.get("Torch").extensions.serenepub).toMatchObject({
			entryType: "item",
			supply: "limited",
			supplyLimit: 3
		})

		// SillyTavern reads these, and never the serenepub bag.
		for (const e of data.entries) {
			expect(Array.isArray(e.keys)).toBe(true)
			expect(typeof e.content).toBe("string")
			expect(typeof e.enabled).toBe("boolean")
			expect(typeof e.insertion_order).toBe("number")
		}
		// An archived entry does not fire there; a changed matchMode reads as
		// the author left it.
		expect(byName.get("Old Map").enabled).toBe(false)
		expect(byName.get("Bells").extensions.match_whole_words).toBe(false)
		expect(byName.get("Bells").extensions.probability).toBe(80)
	}, 60_000)

	test("a round trip restores every place, link, stat and item, and re-imports as unchanged", async () => {
		const b = await seedBook()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const recipient = await createTestUser(
			testDb,
			`places-export-recipient-${seq}`
		)
		const data = await exportBook(b.lorebook.id, b.user.id)

		const { lorebookImportHandler } = await import("./lorebooks")
		const created = await lorebookImportHandler.handler(
			fakeSocket(recipient.id),
			{ lorebookJson: JSON.stringify(data) },
			noopEmit
		)
		expect(created.status).toBe("created")
		const bookId = created.lorebook!.id

		const { loadBookEntries } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const { ITEM_TYPE_ID, LOCATION_TYPE_ID } = await import(
			"$lib/shared/entries/types"
		)
		const entries = await loadBookEntries(testDb, bookId)
		const named = (name: string) => entries.find((e) => e.name === name)!

		expect(
			entries
				.filter((e) => e.typeId === LOCATION_TYPE_ID)
				.map((e) => e.name)
				.sort()
		).toEqual(["The Chapel", "The Crypt"])
		expect(named("The Crypt")).toMatchObject({
			category: "Undercroft",
			priority: 2
		})
		expect(
			entries
				.filter((e) => e.typeId === ITEM_TYPE_ID)
				.map((e) => e.name)
				.sort()
		).toEqual(["Iron Key", "Old Map", "Torch"])
		expect(named("Torch")).toMatchObject({
			supply: "limited",
			supplyLimit: 3
		})
		expect(named("Iron Key")).toMatchObject({ supply: "unique" })
		expect(named("Old Map")).toMatchObject({
			archived: true,
			enabled: true,
			recursionDepth: 2,
			provenance: "summarizer"
		})
		expect(named("Bells").matchMode).toBe("substring")

		const [binding] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
		expect(binding.spriteSet).toBe("winter")

		const [link] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, bookId))
		expect(link).toMatchObject({
			fromEntryId: named("The Crypt").id,
			toEntryId: named("The Chapel").id,
			relationshipType: "leads up to",
			reverseRelationshipType: "leads down to",
			title: "the narrow stair"
		})

		const history = entries.find((e) => e.typeId.includes("history"))!
		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(isNull(schema.attributeValues.sessionId))
		const valueOf = (kind: string, ownerId: number, slotId: string) =>
			values.filter(
				(v) =>
					v.ownerKind === kind &&
					v.ownerId === ownerId &&
					v.slotId === slotId
			)
		// The inventory's references point at the COPIES of the key and torch.
		expect(
			valueOf("location", named("The Crypt").id, INVENTORY).map(
				(v) => v.value
			)
		).toEqual([
			{
				v: [
					{ entryId: named("Iron Key").id },
					{ entryId: named("Torch").id, count: 2 },
					"bones"
				]
			}
		])
		expect(valueOf("location", named("The Chapel").id, LAMPS)).toEqual([
			expect.objectContaining({
				value: { v: 3 },
				historyEntryId: history.id,
				branchId: null,
				note: "Lit for the vigil."
			})
		])
		expect(
			valueOf("cast_member", binding.id, HP).map((v) => v.value)
		).toEqual([{ v: 12 }])
		expect(valueOf("lorebook", bookId, WEATHER).map((v) => v.value)).toEqual(
			[{ v: "storm" }]
		)
		const configs = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "location"),
					eq(schema.attributeConfigs.ownerId, named("The Crypt").id)
				)
			)
		expect(configs.map((c) => [c.slotId, c.config])).toEqual([
			[LAMPS, { max: 5 }]
		])

		// The file is a fixed point against the book it made: nothing
		// regrouped, renumbered or dropped on the way in.
		const again = await lorebookImportHandler.handler(
			fakeSocket(recipient.id),
			{ lorebookJson: JSON.stringify(data) },
			noopEmit
		)
		expect(again.status).toBe("unchanged")
		expect(again.lorebook?.id).toBe(bookId)
	}, 60_000)

	test("an overwrite from the file replaces the book's stats rather than stacking them", async () => {
		const b = await seedBook()
		const data = await exportBook(b.lorebook.id, b.user.id)
		data.entries.find((e: any) => e.name === "The Crypt").content =
			"A colder crypt."

		const { lorebookImportHandler, lorebookImportResolveHandler } =
			await import("./lorebooks")
		const conflict = await lorebookImportHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookJson: JSON.stringify(data) },
			noopEmit
		)
		expect(conflict.status).toBe("conflict")
		await lorebookImportResolveHandler.handler(
			fakeSocket(b.user.id),
			{
				heldImportId: conflict.conflict!.heldImportId,
				action: "overwrite",
				existingId: b.lorebook.id
			},
			noopEmit
		)

		const weather = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "lorebook"),
					eq(schema.attributeValues.ownerId, b.lorebook.id)
				)
			)
		expect(weather.map((v) => v.value)).toEqual([{ v: "storm" }])

		const { loadBookEntries } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const crypt = (await loadBookEntries(testDb, b.lorebook.id)).find(
			(e) => e.name === "The Crypt"
		)!
		const lamps = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "location"),
					eq(schema.attributeConfigs.ownerId, crypt.id)
				)
			)
		expect(lamps.map((c) => c.config)).toEqual([{ max: 5 }])
		// And the file, re-imported, now reads as the book.
		const again = await lorebookImportHandler.handler(
			fakeSocket(b.user.id),
			{ lorebookJson: JSON.stringify(data) },
			noopEmit
		)
		expect(again.status).toBe("unchanged")
	}, 60_000)
})

/** Every lore reference a stored value holds, however deep. */
function entryIdsIn(value: unknown): number[] {
	if (Array.isArray(value)) return value.flatMap(entryIdsIn)
	if (value && typeof value === "object")
		return [
			...("entryId" in value ? [(value as any).entryId as number] : []),
			...Object.values(value).flatMap(entryIdsIn)
		]
	return []
}

/** Import a file as `userId`, answering a conflict with Overwrite when asked. */
async function importFile(userId: number, data: unknown) {
	const { lorebookImportHandler } = await import("./lorebooks")
	return lorebookImportHandler.handler(
		fakeSocket(userId),
		{ lorebookJson: JSON.stringify(data) },
		noopEmit
	)
}

async function overwrite(userId: number, heldImportId: string, existingId: number) {
	const { lorebookImportResolveHandler } = await import("./lorebooks")
	return lorebookImportResolveHandler.handler(
		fakeSocket(userId),
		{ heldImportId, action: "overwrite", existingId },
		noopEmit
	)
}

/** The book's template-layer stat values, all owners. */
async function bookValues(lorebookId: number) {
	const { loadBookEntries } = await import("$lib/server/utils/lorebookEntries")
	const entryIds = new Set((await loadBookEntries(testDb, lorebookId)).map((e) => e.id))
	const bindingIds = new Set(
		(
			await testDb
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		).map((r) => r.id)
	)
	return (
		await testDb
			.select()
			.from(schema.attributeValues)
			.where(isNull(schema.attributeValues.sessionId))
	).filter(
		(v) =>
			(v.ownerKind === "lorebook" && v.ownerId === lorebookId) ||
			(v.ownerKind === "location" && entryIds.has(v.ownerId)) ||
			(v.ownerKind === "cast_member" && bindingIds.has(v.ownerId))
	)
}

describe("a file is trusted with its own book only (A26 review)", () => {
	test("a reference in this install's ids names no one else's entry", async () => {
		const victim = await seedBook()
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
		const [secret] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: victim.lorebook.id,
					position: 9,
					name: "Secret Plan of the Victim",
					content: "Nobody else may read this."
				} as any)
			)
			.returning()

		const attacker = await seedBook()
		const data = await exportBook(attacker.lorebook.id, attacker.user.id)
		delete data.extensions.serenepub.uuid
		const stats = data.extensions.serenepub.stats
		stats.values.find((v: any) => v.slotId === INVENTORY).value = {
			v: [{ entryId: secret!.id }, { entryId: secret!.id + 1, count: 2 }, "bones"]
		}
		stats.values.push({
			ownerKind: "lorebook",
			slotId: "test:slot/beacon@1",
			value: { v: { entryId: secret!.id } }
		})

		const created = await importFile(attacker.user.id, data)
		expect(created.status).toBe("created")
		const bookId = created.lorebook!.id

		const stored = await bookValues(bookId)
		expect(stored.flatMap((v) => entryIdsIn(v.value))).not.toContain(secret!.id)

		const { loadBookEntries } = await import("$lib/server/utils/lorebookEntries")
		const crypt = (await loadBookEntries(testDb, bookId)).find(
			(e) => e.name === "The Crypt"
		)!
		const { lorebookStateGet } = await import("./lorebookState")
		const reply = await lorebookStateGet.handler(
			fakeSocket(attacker.user.id),
			{
				lorebookId: bookId,
				owner: { kind: "location", id: crypt.id },
				branchId: null,
				moment: null
			} as any,
			noopEmit
		)
		expect(JSON.stringify(reply)).not.toContain("Secret Plan of the Victim")
	}, 60_000)

	test("a stat's value is measured, whatever configuration rides beside it", async () => {
		const b = await seedBook()
		const data = await exportBook(b.lorebook.id, b.user.id)
		delete data.extensions.serenepub.uuid
		data.extensions.serenepub.stats.values.push({
			ownerKind: "lorebook",
			slotId: WEATHER,
			config: {},
			value: { v: "x".repeat(100_000) }
		})
		await expect(importFile(b.user.id, data)).rejects.toThrow(
			/is 100,008 bytes; Serene Pub reads up to 65,536\./
		)
	}, 60_000)

	test("a crafted graph lands only what the app's own writers allow", async () => {
		const b = await seedBook()
		const data = await exportBook(b.lorebook.id, b.user.id)
		delete data.extensions.serenepub.uuid
		const serenepub = data.extensions.serenepub
		const byName = (name: string) =>
			data.entries.find((e: any) => (e.name ?? "") === name)
		const history = data.entries.find(
			(e: any) => e.extensions.serenepub.entryType === "history"
		)
		history.extensions.serenepub.entryLocalId = 900
		byName("Bells").extensions.serenepub.entryLocalId = 901
		const cryptId = byName("The Crypt").extensions.serenepub.entryLocalId
		const chapelId = byName("The Chapel").extensions.serenepub.entryLocalId

		// The two-way link's mirror, as a second row.
		const way = serenepub.narrativeGraph.relationships[0]
		serenepub.narrativeGraph.relationships.push({
			...way,
			from: way.to,
			to: way.from,
			relationshipType: way.reverseRelationshipType,
			reverseRelationshipType: null
		})
		// A place holding a place and a date; a place stat on world lore.
		serenepub.stats.values.find((v: any) => v.slotId === INVENTORY).value.v.push(
			{ entryLocalId: chapelId },
			{ entryLocalId: cryptId },
			{ entryLocalId: 900 }
		)
		serenepub.stats.values.push({
			ownerKind: "location",
			entryLocalId: 901,
			slotId: LAMPS,
			value: { v: 1 }
		})

		const created = await importFile(b.user.id, data)
		expect(created.status).toBe("created")
		const bookId = created.lorebook!.id
		const { loadBookEntries } = await import("$lib/server/utils/lorebookEntries")
		const entries = await loadBookEntries(testDb, bookId)
		const named = (name: string) => entries.find((e) => e.name === name)!

		const links = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, bookId))
		expect(links.map((l) => [l.fromEntryId, l.toEntryId, l.relationshipType])).toEqual([
			[named("The Crypt").id, named("The Chapel").id, "leads up to"]
		])

		const stored = await bookValues(bookId)
		expect(
			stored
				.filter((v) => v.ownerKind === "location" && v.slotId === INVENTORY)
				.map((v) => v.value)
		).toEqual([
			{
				v: [
					{ entryId: named("Iron Key").id },
					{ entryId: named("Torch").id, count: 2 },
					"bones"
				]
			}
		])
		expect(stored.filter((v) => v.ownerId === named("Bells").id)).toEqual([])
	}, 60_000)
})

describe("an older file and an overwrite say what they do (A26 review)", () => {
	/**
	 * The same book as an older file: `0.5-compat` writes format 1 (no marker,
	 * no stats, three wire names), and a file written before today also
	 * stated `version: 1`.
	 */
	async function formatOneFile(lorebookId: number, userId: number) {
		const { buildLorebookExportData } = await import(
			"$lib/server/utils/lorebookExportBuilder"
		)
		const { specBookWithGraph } = await buildLorebookExportData(
			lorebookId,
			userId,
			{ exportProfile: "0.5-compat" }
		)
		const data = JSON.parse(JSON.stringify(specBookWithGraph))
		expect(data.extensions.serenepub.formatVersion).toBeUndefined()
		expect(data.extensions.serenepub.stats).toBeUndefined()
		data.extensions.serenepub.version = 1
		return data
	}

	test("an older file of an unchanged book reads as unchanged", async () => {
		const n = ++seq
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `format-one-${n}`)
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: `Plain Book ${n}` },
			noopEmit
		)
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
		await testDb.insert(schema.lorebookEntries).values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: lorebook.id,
				position: 0,
				name: "Bells",
				keys: ["bell"],
				content: "They ring at dusk."
			} as any)
		)
		const again = await importFile(user.id, await formatOneFile(lorebook.id, user.id))
		expect(again.status).toBe("unchanged")
	}, 60_000)

	test("an older file counts what it cannot carry, and an overwrite from it settles", async () => {
		const b = await seedBook()
		const file = await formatOneFile(b.lorebook.id, b.user.id)

		const conflict = await importFile(b.user.id, file)
		expect(conflict.status).toBe("conflict")
		expect(conflict.conflict!.losses).toMatchObject({
			// crypt inventory, chapel lamps, crypt lamps' setup, the member's
			// HP and the book's weather — main's, one per stat.
			stats: 5,
			places: 2,
			items: 3
		})

		await overwrite(b.user.id, conflict.conflict!.heldImportId, b.lorebook.id)
		expect(await bookValues(b.lorebook.id)).toEqual([])
		const again = await importFile(b.user.id, file)
		expect(again.status).toBe("unchanged")
	}, 60_000)

	test("a current file with no stats replaces the book's stats, and then reads as the book", async () => {
		const n = ++seq
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `no-stats-${n}`)
		const { lorebooksCreateHandler } = await import("./lorebooks")
		const { lorebook } = await lorebooksCreateHandler.handler(
			fakeSocket(user.id),
			{ name: `Statless Book ${n}` },
			noopEmit
		)
		const data = await exportBook(lorebook.id, user.id)
		expect(data.extensions.serenepub.stats).toBeUndefined()
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "lorebook",
			ownerId: lorebook.id,
			slotId: WEATHER,
			value: { v: "fog" }
		})

		const conflict = await importFile(user.id, data)
		expect(conflict.status).toBe("conflict")
		// The file's format carries stats: these are the file's to replace.
		expect(conflict.conflict!.losses).toMatchObject({ stats: 0, places: 0, items: 0 })
		await overwrite(user.id, conflict.conflict!.heldImportId, lorebook.id)
		expect(await bookValues(lorebook.id)).toEqual([])
		const again = await importFile(user.id, data)
		expect(again.status).toBe("unchanged")
	}, 60_000)
})
