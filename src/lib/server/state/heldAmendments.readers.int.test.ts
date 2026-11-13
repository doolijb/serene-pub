/**
 * 🚧 A session's held amendment is read by that session only. Two sessions on
 * one lorebook, each with an own book; a held row inserted straight into
 * session A's own book changes one entry of the lorebook. For every reader
 * that reads the book "as the session stands" — retrieval (the host's lore
 * read and the vector candidates), the keyword match, the places, item
 * supply, the side character's "have we heard of them", the graph's links and
 * the entries workspace — A's read shows the change, B's does not, and the
 * lorebook's own read (no session) does not.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { seedEntryVectors } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const db = () => testDb as unknown as Db
const MODEL_ID = "held-test-model"

let userId: number
let bookId: number
let sessionA: number
let sessionB: number
let ownBookA: number
const e: Record<"docks" | "quay" | "key" | "salt" | "sage", number> = {
	docks: 0,
	quay: 0,
	key: 0,
	salt: 0,
	sage: 0
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-held-readers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	userId = (await createTestUser(testDb, "held-readers")).id
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: "Harbour" })
		.returning()
	bookId = book!.id

	let position = 0
	const entry = async (
		title: string,
		typeId: string,
		extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: bookId,
					typeId,
					typeVersion: 1,
					position: position++,
					title,
					content: "…",
					...extra
				})
				.returning()
		)[0]!.id
	e.docks = await entry("The Docks", "core:entry/location")
	e.quay = await entry("The Quay", "core:entry/location")
	e.key = await entry("Rusty key", "core:entry/item", {
		fields: { supply: "limited", supplyLimit: 3 }
	})
	e.salt = await entry("Old Salt", "core:entry/world-lore", {
		keys: ["salt"]
	})
	e.sage = await entry("Tide Table", "core:entry/world-lore", {
		content: "Tides."
	})
	await seedEntryVectors(testDb, [e.sage], [1, 0, 0], MODEL_ID)
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: bookId,
		fromEntryId: e.docks,
		toEntryId: e.quay,
		relationshipType: "leads to"
	})

	const session = async () => {
		const [row] = await testDb
			.insert(schema.sessions)
			.values({ userId, isGroup: false, lorebookId: bookId })
			.returning()
		const own = await insertOwnBook(db(), {
			sessionId: row!.id,
			userId,
			name: null,
			overlayOf: bookId,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		return { id: row!.id, own: own.id }
	}
	const a = await session()
	sessionA = a.id
	ownBookA = a.own
	sessionB = (await session()).id

	// Session A holds four changes of the lorebook's entries, undated.
	const held = (
		entryId: number,
		field: string,
		now: string,
		was: string
	) => ({
		lorebookId: ownBookA,
		entryId,
		year: null,
		fields: { [field]: now },
		base: { [field]: { v: was } },
		sourceMessageId: 5
	})
	await testDb
		.insert(schema.entryAmendments)
		.values([
			held(e.docks, "name", "The Held Docks", "The Docks"),
			held(e.key, "name", "Held Key", "Rusty key"),
			held(e.salt, "name", "Salt Held", "Old Salt"),
			held(e.sage, "content", "Held tides.", "Tides.")
		])
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const host = async (sessionId: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db() as any, { sessionId })
}

describe("held amendments are read by their session only", () => {
	test("retrieval: the host's lore read names the held change for A, not for B", async () => {
		const node = {
			key: "lore",
			definitionId: "core:query/lorebook-triggers@1",
			definitionVersion: 1,
			kind: "query"
		}
		const lore = async (sessionId: number) => {
			const h = await host(sessionId)
			const rows = (await h.read!(
				"lorebook_entries",
				{ sessionId, currentCharacterId: null },
				node as any
			)) as any[]
			return rows.filter((r) => r.id === e.salt).map((r) => r.name)
		}
		expect(await lore(sessionA)).toEqual(["Salt Held"])
		expect(await lore(sessionB)).toEqual(["Old Salt"])
	})

	test("retrieval: the vector candidates render the held content for A, not for B or the lorebook's own read", async () => {
		const { getSessionRagContext, fetchScopedCandidates } = await import(
			"$lib/server/embedding/ragContext"
		)
		const contentOf = async (
			context: Awaited<ReturnType<typeof getSessionRagContext>>
		) =>
			(
				await fetchScopedCandidates(context, {
					modelId: MODEL_ID,
					sources: ["worldLore"]
				})
			).candidates
				.filter((c) => c.source === "worldLore" && c.id === e.sage)
				.map((c) => (c as { content: string }).content)
		expect(await contentOf(await getSessionRagContext(sessionA))).toEqual([
			"Held tides."
		])
		expect(await contentOf(await getSessionRagContext(sessionB))).toEqual([
			"Tides."
		])
		// A context built by hand: no session reading, the lorebook as it stands.
		expect(
			await contentOf({
				sessionId: -1,
				characterIds: [],
				personaIds: [],
				lorebookId: bookId,
				allLorebookIds: [bookId]
			})
		).toEqual(["Tides."])
	})

	test("keyword match: findLoreMatch finds the held name for A only", async () => {
		const { findLoreMatch } = await import(
			"$lib/server/pipelines/runtime/loreMatch"
		)
		const { sessionReadingOf, readingOf } = await import(
			"$lib/server/state/reading"
		)
		const match = async (reading: unknown) =>
			findLoreMatch(
				db(),
				{
					lorebookId: bookId,
					typeId: "core:entry/world-lore",
					reading
				},
				{ name: "Salt Held" },
				"save"
			)
		expect(await match(await sessionReadingOf(db(), sessionA))).toBe(e.salt)
		expect(await match(await sessionReadingOf(db(), sessionB))).toBeNull()
		expect(await match(await readingOf(db(), bookId, {}))).toBeNull()
	})

	test("places: the session's places carry the held name for A only", async () => {
		const { readSessionPlaces } = await import(
			"$lib/server/sockets/sessionPlaces"
		)
		const names = async (sessionId: number) =>
			(await readSessionPlaces(sessionId, userId)).places
				.map((p) => p.name)
				.sort()
		expect(await names(sessionA)).toEqual(["The Held Docks", "The Quay"])
		expect(await names(sessionB)).toEqual(["The Docks", "The Quay"])
	})

	test("places: placesOnReading on the session's reading, and on the lorebook's own", async () => {
		const { placesOnReading, MAIN_HEAD } = await import(
			"$lib/server/state/entriesOnReading"
		)
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const names = async (reading: any) =>
			(await placesOnReading(db(), bookId, reading, "session"))
				.map((p) => p.name)
				.sort()
		expect(await names((await sessionReadingOf(db(), sessionA))!)).toEqual([
			"The Held Docks",
			"The Quay"
		])
		expect(await names((await sessionReadingOf(db(), sessionB))!)).toEqual([
			"The Docks",
			"The Quay"
		])
		expect(await names(MAIN_HEAD)).toEqual(["The Docks", "The Quay"])
	})

	test("supply: the item is named as held for A only", async () => {
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		expect(
			(await itemSupplyFor(db(), sessionA)).map((i) => i.name)
		).toEqual(["Held Key"])
		expect(
			(await itemSupplyFor(db(), sessionB)).map((i) => i.name)
		).toEqual(["Rusty key"])
	})

	test("side character: a name only the held change gives is a known name for A only", async () => {
		const { resolveSideCharacter } = await import(
			"$lib/server/pipelines/entities/sideCharacter"
		)
		const known = async (sessionId: number, name: string) => {
			const res: any = await resolveSideCharacter(
				db(),
				sessionId,
				userId,
				{ name }
			)
			return res.speaker.known
		}
		expect(await known(sessionA, "Salt Held")).toBe(true)
		expect(await known(sessionB, "Salt Held")).toBe(false)
		// The name it replaced is no longer one A's book answers to.
		expect(await known(sessionA, "Old Salt")).toBe(false)
		expect(await known(sessionB, "Old Salt")).toBe(true)
	})

	test("graph links: a way's end is named as held for A only", async () => {
		const { readGraphEntryLinks } = await import(
			"$lib/server/utils/graphEntryLinks"
		)
		const ends = async (sessionId: number) =>
			((await readGraphEntryLinks(db(), sessionId)) ?? [])
				.flatMap((l) => [l.from.name, l.to.name])
				.sort()
		expect(await ends(sessionA)).toEqual(["The Held Docks", "The Quay"])
		expect(await ends(sessionB)).toEqual(["The Docks", "The Quay"])
	})

	test("the entries workspace lists the held name for A only", async () => {
		const { entrySessionEntriesHandler } = await import(
			"$lib/server/sockets/entries"
		)
		const titles = async (sessionId: number) => {
			const res: any = await entrySessionEntriesHandler.handler(
				{ user: { id: userId, isAdmin: false } } as any,
				{ sessionId, limit: 50 } as any,
				() => {}
			)
			return res.rows
				.filter((r: any) => r.id === e.salt)
				.map((r: any) => r.title)
		}
		expect(await titles(sessionA)).toEqual(["Salt Held"])
		expect(await titles(sessionB)).toEqual(["Old Salt"])
	})
})
