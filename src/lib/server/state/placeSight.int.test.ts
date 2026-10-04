/**
 * One rule for what a session can see of a place (plan A27, 2026-09-30).
 *
 * A session sees a place that is on its line at its moment and — as the
 * line's amendments leave it by then — neither archived nor switched Off
 * (`seesPlace(…, "session")`). Every session reader of places answers by that
 * rule, so none of them can name a room the others do not have:
 *
 *  · the prompt's places (`stateFor(…).locations` → `stateSummary`);
 *  · the rooms listing (`core:query/lorebook-entries@1`: Answer the door's
 *    rooms, `{{knownLocations}}`) and its "From here:" links;
 *  · the relationship hop's link ends (`readGraphEntryLinks`);
 *  · the write doors: a place owner (`assertSessionOwner`), a place a value
 *    points at (`assertLoreRefsInSession`), a place a model names
 *    (`loreRefNamed`, the state tools' `ownerFor`);
 *  · a held reference's name (`nameLoreRefs`): the place as amended, and only
 *    an entry of the session's own book on its line.
 *
 * The fixture is one where the readers disagreed before the rule: a place
 * switched Off, one switched Off by an amendment (Off for a while), one
 * archived by an amendment, and one renamed by an amendment that the world's
 * location points at.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSheet, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const db = () => testDb as unknown as Db
const LOCATION_SLOT = "core:slot/location@1"
const INVENTORY_SLOT = "core:slot/inventory@1"

/** Location on the world (where the scene is), inventory on a place. */
const SIGHT_SHEET = defineAttributeSheet("test:sheet/place-sight@1", {
	label: { en: "Place sight" },
	slots: [
		{ id: LOCATION_SLOT, appliesTo: ["world"] },
		{ id: INVENTORY_SLOT, appliesTo: ["location"] }
	]
})
const SIGHT_GENRE = "test:genre/place-sight"
genre(SIGHT_GENRE, {
	name: { en: "Place sight" },
	family: "test",
	sheets: [SIGHT_SHEET],
	events: {}
})

let sessionId: number
let bookId: number
const e: Record<string, number> = {}

/** The places every session reader must agree on: Hall, and the Guardroom by its amended name. */
const SEEN = ["Hall", "Watch Room"]

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-place-sight-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "place-sight")
	const stranger = await createTestUser(testDb, "place-sight-stranger")

	const [book, elsewhere] = await testDb
		.insert(schema.lorebooks)
		.values([
			{ userId: user.id, name: "The Keep" },
			{ userId: stranger.id, name: "Elsewhere" }
		])
		.returning()
	bookId = book!.id

	let position = 0
	const entry = async (
		lorebookId: number,
		title: string,
		extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: position++,
					title,
					content: `About ${title}.`,
					...extra
				})
				.returning()
		)[0]!.id
	e.hall = await entry(bookId, "Hall")
	e.crypt = await entry(bookId, "Crypt", { enabled: false })
	e.cellar = await entry(bookId, "Cellar")
	e.vault = await entry(bookId, "Vault")
	e.guardroom = await entry(bookId, "Guardroom", { keys: ["watch"] })
	e.tower = await entry(elsewhere!.id, "Far Tower")

	// Off for a while, archived and renamed — each by the line's amendments.
	await testDb.insert(schema.entryAmendments).values([
		{ lorebookId: bookId, entryId: e.cellar, year: 1, fields: { enabled: false } },
		{ lorebookId: bookId, entryId: e.vault, year: 1, fields: { archived: true } },
		{ lorebookId: bookId, entryId: e.guardroom, year: 1, fields: { name: "Watch Room" } }
	])

	// A way from the Hall into every other room.
	for (const to of [e.crypt, e.cellar, e.vault, e.guardroom])
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: bookId,
			fromEntryId: e.hall,
			toEntryId: to,
			relationshipType: "leads to",
			reverseRelationshipType: "leads back to"
		} as any)

	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: "Delve", genreId: SIGHT_GENRE, lorebookId: bookId })
		.returning()
	sessionId = session!.id

	// The party stand in the Guardroom; the book put a torch in the Crypt
	// and one in the Cellar before either was switched off.
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "session",
			ownerId: sessionId,
			sessionId,
			slotId: LOCATION_SLOT,
			value: { v: { entryId: e.guardroom } }
		},
		{ ownerKind: "location", ownerId: e.crypt, slotId: INVENTORY_SLOT, value: { v: ["crypt torch"] } },
		{ ownerKind: "location", ownerId: e.cellar, slotId: INVENTORY_SLOT, value: { v: ["cellar torch"] } },
		{ ownerKind: "location", ownerId: e.vault, slotId: INVENTORY_SLOT, value: { v: ["vault torch"] } }
	] as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The rooms listing as the Lair asks for it: switched-on, not archived, places, with links. */
async function roomsListing(extra: Record<string, unknown> = {}): Promise<any[]> {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db() as any, { sessionId })
	return (await host.read!(
		"lorebook_entries",
		{
			sessionId,
			currentCharacterId: null,
			enabled: true,
			archived: false,
			entryTypes: [LOCATION_TYPE_ID],
			withLinks: true,
			...extra
		},
		{ key: "rooms", definitionId: "core:query/lorebook-entries@1", definitionVersion: 1, kind: "query" } as any
	)) as any[]
}

describe("every session reader sees the same places", () => {
	test("the prompt's places are the rooms listing's", async () => {
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db(), sessionId)
		const promptPlaces = Object.values(state.locations.byId).map((p: any) => p.name)
		const listed = (await roomsListing()).map((r) => r.name)
		expect(listed).toEqual(SEEN)
		expect(promptPlaces).toEqual(SEEN)
	})

	test("an Off, an Off-for-a-while and an archived room's stats never reach the prompt", async () => {
		const { stateFor } = await import("$lib/server/state/resolve")
		const { stateSummary, slotGuide } = await import("$lib/server/pipelines/prompt/adventureContext")
		const state = await stateFor(db(), sessionId)
		const summary = stateSummary(state as never)
		expect(summary).not.toMatch(/torch/)
		expect(summary).not.toMatch(/Crypt|Cellar|Vault/)
		expect(slotGuide(state as never)).toMatch(/on a place/)
	})

	test("where the party stand is named as the rooms listing names it", async () => {
		const { stateFor } = await import("$lib/server/state/resolve")
		const { sceneAnchor, locationVariables } = await import(
			"$lib/server/pipelines/prompt/adventureContext"
		)
		const state = await stateFor(db(), sessionId)
		expect(state.world.location).toEqual({ entryId: e.guardroom, name: "Watch Room" })
		expect(sceneAnchor(state as never, undefined).location).toBe("Watch Room")
		const vars = locationVariables(await roomsListing(), state as never)
		expect(vars.knownLocations).toBe(SEEN.join(", "))
		expect(vars.locationEntry).toBe(
			["Watch Room", "About Guardroom.", "From here:", "- Leads back to Hall."].join("\n")
		)
	})

	test("the Hall's ways out lead only to rooms the session sees", async () => {
		const [hall] = (await roomsListing()).filter((r) => r.id === e.hall)
		expect(hall.links.map((l: any) => l.to.name)).toEqual(["Watch Room"])
		const { readGraphEntryLinks } = await import("$lib/server/utils/graphEntryLinks")
		const ends = (await readGraphEntryLinks(db(), sessionId))!.map((l) => l.to.id)
		expect(ends).toEqual([e.guardroom])
	})

	test("a place owner the session does not see is refused; one it sees is taken", async () => {
		const { assertSessionOwner } = await import("$lib/server/state/write")
		for (const id of [e.crypt, e.cellar, e.vault])
			await expect(
				assertSessionOwner(db(), sessionId, { kind: "session_location", id })
			).rejects.toThrow(/not a location in this session's lorebook/)
		for (const id of [e.hall, e.guardroom])
			await expect(
				assertSessionOwner(db(), sessionId, { kind: "session_location", id })
			).resolves.toBeUndefined()
	})

	test("a value may point only at a place the session sees", async () => {
		const { assertLoreRefsInSession } = await import("$lib/server/state/write")
		const pointAt = (entryId: number) =>
			assertLoreRefsInSession(db(), sessionId, {
				op: "set",
				slotId: LOCATION_SLOT,
				value: { entryId }
			} as any)
		await expect(pointAt(e.crypt)).rejects.toThrow(/'Crypt' is switched off/)
		// Off by a dated change: said so, not "switch it on".
		await expect(pointAt(e.cellar)).rejects.toThrow(/'Cellar' is off for a while/)
		await expect(pointAt(e.vault)).rejects.toThrow(/'Vault' is archived/)
		await expect(pointAt(e.guardroom)).resolves.toBeUndefined()
	})

	test("a name a model writes finds a room by the rooms' own name rule, among the rooms it sees", async () => {
		const { loreRefNamed } = await import("$lib/server/state/write")
		const named = (words: string) => loreRefNamed(db(), sessionId, LOCATION_SLOT, words)
		expect(await named("Watch Room")).toEqual({ entryId: e.guardroom })
		// A leading "the", and a key: the Lair's rule (`describingRow`).
		expect(await named("the watch room")).toEqual({ entryId: e.guardroom })
		expect(await named("watch")).toEqual({ entryId: e.guardroom })
		// Rooms the session does not see are refused, never kept as words.
		await expect(named("Crypt")).rejects.toThrow(/'Crypt' is switched off/)
		await expect(named("Cellar")).rejects.toThrow(/'Cellar' is off for a while/)
		await expect(named("Vault")).rejects.toThrow(/'Vault' is archived/)
	})

	test("a place the state tools resolve by name is one the session sees", async () => {
		const { ownerFor } = await import("$lib/server/pipelines/runtime/tools/stateTools")
		const ctx = { sessionId, read: async () => ({ sessionCharacters: [] }) } as any
		expect(await ownerFor(ctx, "the Watch Room")).toEqual({
			kind: "session_location",
			id: e.guardroom
		})
		await expect(ownerFor(ctx, "Crypt")).rejects.toThrow(/'Crypt' is switched off/)
		await expect(ownerFor(ctx, "Nowhere")).rejects.toThrow(/no place by that name/)
	})

	test("a held reference is named only from the session's own book, as amended", async () => {
		const { nameLoreRefs } = await import("$lib/server/state/resolve")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const bag: Record<string, unknown> = {
			here: { entryId: e.guardroom },
			there: { entryId: e.tower }
		}
		await nameLoreRefs(db(), [bag], await sessionReadingOf(db(), sessionId), "session")
		expect(bag.here).toEqual({ entryId: e.guardroom, name: "Watch Room" })
		// Another person's book: never named in this session.
		expect(bag.there).toEqual({ entryId: e.tower })
	})
})

describe("the rooms listing's ceiling", () => {
	test("keeps the newest rooms when it bites, listed in entry order", async () => {
		expect((await roomsListing({ limit: 1 })).map((r) => r.name)).toEqual(["Watch Room"])
		expect((await roomsListing({ limit: 2 })).map((r) => r.name)).toEqual(SEEN)
	})
})
