/**
 * The session-side readers of lore read the book where the session stands
 * (findings #41 and the completeness pass): the lorebook's owners
 * (`lorebookLinks`), a session's places (`sessionLinks`), item supply, the
 * lore-reference doors of a state write, a name the model wrote for a place,
 * and a side character's "have we heard of them".
 *
 * The book: main, and two sibling forks A and B. Each fork has a place of its
 * own; a shared place is renamed by a main amendment at Y2; a shared item's
 * supply is cut to one at Y2; an archived place and item sit on main; a cast
 * member is renamed at Y2 and has her card swapped at Y2.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { readingOf } from "$lib/server/state/reading"
import { MAIN_HEAD } from "$lib/server/state/entriesOnReading"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const db = () => testDb as unknown as Db
const LOCATION_SLOT = "core:slot/location@1"

let userId: number
let bookId: number
let forkA: number
let forkB: number
let sessionMain: number
let sessionA: number
let sessionEarly: number
let verityId: number
let olderVerityId: number
let memberId: number
const e: Record<string, number> = {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entries-on-reading-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "entries-on-reading")).id

	const [book] = await testDb.insert(schema.lorebooks).values({ userId, name: "Harbour" }).returning()
	bookId = book!.id
	const branches = await testDb
		.insert(schema.lorebookBranches)
		.values([
			{ lorebookId: bookId, name: "A" },
			{ lorebookId: bookId, name: "B" }
		])
		.returning()
	forkA = branches[0]!.id
	forkB = branches[1]!.id

	const [verity, older] = await testDb
		.insert(schema.characters)
		.values([
			{ userId, name: "Verity", description: "…" },
			{ userId, name: "Verity, older", description: "…" }
		])
		.returning()
	verityId = verity!.id
	olderVerityId = older!.id
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: bookId, characterId: verityId, binding: "{{char:1}}", name: "Verity" })
		.returning()
	memberId = member!.id

	let position = 0
	const entry = async (
		title: string,
		typeId: string,
		extra: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({ lorebookId: bookId, typeId, typeVersion: 1, position: position++, title, content: "…", ...extra })
				.returning()
		)[0]!.id
	e.docks = await entry("The Docks", "core:entry/location")
	e.lighthouse = await entry("Lighthouse", "core:entry/location", { branchId: forkA })
	e.brewery = await entry("Brewery", "core:entry/location", { branchId: forkB })
	e.ruin = await entry("Old Ruin", "core:entry/location", { archived: true })
	e.key = await entry("Rusty key", "core:entry/item", { fields: { supply: "limited", supplyLimit: 3 } })
	e.charm = await entry("Sea charm", "core:entry/item", { branchId: forkB })
	e.shelved = await entry("Broken oar", "core:entry/item", { archived: true })

	await testDb.insert(schema.entryAmendments).values([
		{ lorebookId: bookId, entryId: e.docks, year: 2, fields: { name: "The Burned Docks" } },
		{ lorebookId: bookId, entryId: e.key, year: 2, fields: { supply: "unique" } }
	])
	await testDb.insert(schema.castAmendments).values({
		lorebookId: bookId,
		lorebookBindingId: memberId,
		year: 2,
		fields: { name: "Captain Verity", characterId: olderVerityId }
	})

	const seat = async (values: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.sessions)
				.values({ userId, isGroup: false, lorebookId: bookId, ...values } as any)
				.returning()
		)[0]!.id
	sessionMain = await seat({})
	sessionA = await seat({ lorebookBranchId: forkA })
	sessionEarly = await seat({ storyClockYear: 1 })
	for (const s of [sessionMain, sessionA, sessionEarly])
		await testDb.insert(schema.sessionCharacters).values({ sessionId: s, characterId: verityId })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the lorebook's owners, as a reading sees them (finding #41)", () => {
	test("places are the line's, titled as amended, archived ones gone", async () => {
		const { lorebookLinks } = await import("$lib/server/state/lorebookState")
		const main = await lorebookLinks(db(), bookId, MAIN_HEAD)
		expect(main.locations.map((l) => l.name)).toEqual(["The Burned Docks"])
		const onA = await lorebookLinks(db(), bookId, await readingOf(db(), bookId, { branch: forkA }))
		expect(onA.locations.map((l) => l.name)).toEqual(["The Burned Docks", "Lighthouse"])
		const early = await lorebookLinks(db(), bookId, await readingOf(db(), bookId, { moment: { year: 1, month: null, day: null } }))
		expect(early.locations.map((l) => l.name)).toEqual(["The Docks"])
	})

	test("a cast member is named as amended, and keeps her own card as the seat's key", async () => {
		const { lorebookLinks, normalizeOwner } = await import("$lib/server/state/lorebookState")
		const links = await lorebookLinks(db(), bookId, MAIN_HEAD)
		expect(links.cast).toEqual([{ castMemberId: memberId, characterId: verityId, name: "Captain Verity" }])
		expect(normalizeOwner({ kind: "session_cast", id: verityId }, links)).toEqual({
			kind: "cast_member",
			id: memberId
		})
	})

	test("a session's places are its own line's", async () => {
		const { sessionLinks } = await import("$lib/server/state/resolve")
		expect((await sessionLinks(db(), sessionMain)).locations.map((l) => l.name)).toEqual([
			"The Burned Docks"
		])
		expect((await sessionLinks(db(), sessionA)).locations.map((l) => l.name)).toEqual([
			"The Burned Docks",
			"Lighthouse"
		])
	})
})

describe("item supply reads the session's line", () => {
	test("another line's item and an archived one are not answered; an amended supply is", async () => {
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const main = await itemSupplyFor(db(), sessionMain)
		expect(main.map((i) => i.name)).toEqual(["Rusty key"])
		expect(main[0]).toMatchObject({ supply: "unique", limit: 1 })
		const early = await itemSupplyFor(db(), sessionEarly)
		expect(early[0]).toMatchObject({ supply: "limited", limit: 3 })
		expect(await itemSupplyFor(db(), sessionMain, [e.charm, e.shelved])).toEqual([])
	})
})

describe("the lore-reference doors of a state write", () => {
	test("refuse another line's entry and an archived one; take the line's own", async () => {
		const { assertLoreRefsInSession } = await import("$lib/server/state/write")
		await expect(
			assertLoreRefsInSession(db(), sessionMain, { op: "add", items: [{ entryId: e.charm }] } as any)
		).rejects.toThrow(/another line/)
		await expect(
			assertLoreRefsInSession(db(), sessionMain, { op: "add", items: [{ entryId: e.shelved }] } as any)
		).rejects.toThrow(/archived/)
		await expect(
			assertLoreRefsInSession(db(), sessionMain, { op: "add", items: [{ entryId: e.key }] } as any)
		).resolves.toBeUndefined()
	})

	test("a name the model wrote finds the place called that now, on this line", async () => {
		const { loreRefNamed } = await import("$lib/server/state/write")
		expect(await loreRefNamed(db(), sessionMain, LOCATION_SLOT, "the burned docks")).toEqual({
			entryId: e.docks
		})
		// Before Y2 it had its old name.
		expect(await loreRefNamed(db(), sessionEarly, LOCATION_SLOT, "The Docks")).toEqual({
			entryId: e.docks
		})
		// A sibling's place is no place here.
		expect(await loreRefNamed(db(), sessionMain, LOCATION_SLOT, "Brewery")).toBe("Brewery")
		expect(await loreRefNamed(db(), sessionA, LOCATION_SLOT, "Lighthouse")).toEqual({
			entryId: e.lighthouse
		})
	})

	test("a place owner must be on the session's line", async () => {
		const { assertSessionOwner } = await import("$lib/server/state/write")
		await expect(
			assertSessionOwner(db(), sessionMain, { kind: "session_location", id: e.lighthouse })
		).rejects.toThrow(/not a location/)
		await expect(
			assertSessionOwner(db(), sessionA, { kind: "session_location", id: e.lighthouse })
		).resolves.toBeUndefined()
	})
})

describe("a side character's name is known by the session's story", () => {
	test("a sibling fork's place is not a name this story has heard; the line's own is", async () => {
		const { resolveSideCharacter } = await import("$lib/server/pipelines/entities/sideCharacter")
		const known = async (sessionId: number, name: string) => {
			const r = await resolveSideCharacter(db(), sessionId, userId, { name } as any)
			if (!r.ok) throw new Error(r.error)
			return r.speaker.known
		}
		expect(await known(sessionMain, "Brewery")).toBe(false)
		expect(await known(sessionA, "Lighthouse")).toBe(true)
		// The cast rename at Y2 is heard at the head, not before it.
		expect(await known(sessionMain, "Captain Verity")).toBe(true)
		expect(await known(sessionEarly, "Captain Verity")).toBe(false)
		// A shelved place is not a name the world still answers to.
		expect(await known(sessionMain, "Old Ruin")).toBe(false)
	})
})
