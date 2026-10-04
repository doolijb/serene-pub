/**
 * Place sight at the doors (plan A27, review round 2026-09-30).
 *
 * `placeSight.int.test.ts` holds the readers to one rule. This file holds the
 * rest of the app to it where the rule is the wrong one to apply, and the
 * doors to it where a first pass missed them:
 *
 *  · a lore link's ends (`core:outlet/link-lore-entries`) are entries the
 *    session sees, found by the name it shows, never by a stored one;
 *  · a name that answers two rooms alike is refused, never guessed;
 *  · what lies in a room that is switched Off still counts toward an item's
 *    supply, and the delete safeguard still records it — the room is out of
 *    the story, not out of the book;
 *  · the ledger names a room that is switched Off;
 *  · a refusal never quotes a title the asker may not know: another book's
 *    entry, a sibling line's, a character's private lore;
 *  · a session's stats never hold a character's private lore;
 *  · an entry of any kind that is switched Off is refused by id, as by name;
 *  · a room switched off by a dated change is refused in words that say so;
 *  · the place editor judges an entry as the line's dated changes leave it;
 *  · a world location that points at a room the session no longer sees reads
 *    as not set, and a model's words naming that room are refused.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSheet, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	CHARACTER_LORE_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"

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

const DOORS_SHEET = defineAttributeSheet("test:sheet/place-sight-doors@1", {
	label: { en: "Place sight doors" },
	slots: [
		{ id: LOCATION_SLOT, appliesTo: ["world"] },
		{ id: INVENTORY_SLOT, appliesTo: ["location", "world"] }
	]
})
const DOORS_GENRE = "test:genre/place-sight-doors"
genre(DOORS_GENRE, {
	name: { en: "Place sight doors" },
	family: "test",
	sheets: [DOORS_SHEET],
	events: {}
})

let userId: number
let bookId: number
let sessionId: number
/** A session whose story clock stands at Year 6. */
let clocked: number
const e: Record<string, number> = {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-place-sight-doors-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "place-sight-doors")
	const stranger = await createTestUser(testDb, "place-sight-doors-stranger")
	userId = user.id

	const [book, diary] = await testDb
		.insert(schema.lorebooks)
		.values([
			{ userId: user.id, name: "The Keep" },
			{ userId: stranger.id, name: "Diary" }
		])
		.returning()
	bookId = book!.id
	const [exile] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: bookId, name: "Exile" } as any)
		.returning()
	const [verity] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: bookId, name: "Verity", binding: "{{char:1}}" } as any)
		.returning()

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
	e.ossuary = await entry(bookId, "Ossuary", { enabled: false })
	e.vault = await entry(bookId, "Vault")
	e.guardroom = await entry(bookId, "Guardroom", { keys: ["watch"] })
	e.watchtower = await entry(bookId, "Watchtower", { keys: ["watch"] })
	e.tower = await entry(bookId, "Tower")
	e.camp = await entry(bookId, "Exile Camp", { branchId: exile!.id })
	e.crown = await entry(bookId, "Crown", { typeId: ITEM_TYPE_ID, fields: { supply: "unique" } })
	e.oldSword = await entry(bookId, "Old Sword", { typeId: ITEM_TYPE_ID })
	e.relic = await entry(bookId, "Relic", { typeId: ITEM_TYPE_ID, archived: true })
	e.offLamp = await entry(bookId, "Off Lamp", { typeId: ITEM_TYPE_ID, enabled: false })
	e.secret = await entry(bookId, "Verity poisoned the Duke", {
		typeId: CHARACTER_LORE_TYPE_ID,
		anchorBindingId: verity!.id
	} as any)
	e.butler = await entry(diary!.id, "Secret Affair With The Butler", { typeId: ITEM_TYPE_ID })

	await testDb.insert(schema.entryAmendments).values([
		{ lorebookId: bookId, entryId: e.vault, year: 1, fields: { archived: true } },
		{ lorebookId: bookId, entryId: e.guardroom, year: 1, fields: { name: "Watch Room" } },
		{ lorebookId: bookId, entryId: e.oldSword, year: 1, fields: { archived: true } },
		{ lorebookId: bookId, entryId: e.relic, year: 1, fields: { archived: false } },
		// Off for a while: off from Year 5, back at Year 8.
		{ lorebookId: bookId, entryId: e.tower, year: 5, fields: { enabled: false } },
		{ lorebookId: bookId, entryId: e.tower, year: 8, fields: { enabled: true } }
	])

	const [session, atSix] = await testDb
		.insert(schema.sessions)
		.values([
			{ userId: user.id, isGroup: false, name: "Delve", genreId: DOORS_GENRE, lorebookId: bookId },
			{
				userId: user.id,
				isGroup: false,
				name: "Clocked",
				genreId: DOORS_GENRE,
				lorebookId: bookId,
				storyClockYear: 6
			} as any
		])
		.returning()
	sessionId = session!.id
	clocked = atSix!.id

	// The party stood in the Crypt before it was switched off, and dropped a
	// torch there; the Crown lies in the Ossuary, in the book.
	await testDb.insert(schema.attributeValues).values([
		{ ownerKind: "location", ownerId: e.ossuary, slotId: INVENTORY_SLOT, value: { v: [{ entryId: e.crown }] } },
		{
			ownerKind: "session",
			ownerId: sessionId,
			sessionId,
			slotId: LOCATION_SLOT,
			value: { v: { entryId: e.crypt } }
		},
		{
			ownerKind: "session_location",
			ownerId: e.crypt,
			sessionId,
			slotId: INVENTORY_SLOT,
			value: { v: ["dropped torch"] }
		}
	] as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The refusal `run` throws, or "" when it does not. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
	try {
		await run()
		return ""
	} catch (err) {
		return String((err as Error)?.message ?? err)
	}
}

describe("a lore link's ends are entries the session sees", () => {
	const link = async (to: unknown) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(testDb as any, { sessionId })
		return await refusalOf(() =>
			host.commit!({ from: e.hall, to }, {
				key: "link",
				definitionId: "core:outlet/link-lore-entries"
			} as any)
		)
	}

	test("a room is linked by the name the session shows, by the rooms' name rule", async () => {
		expect(await link("Watch Room")).toBe("")
		expect(await link("the watch room")).toBe("")
	})

	test("a stored name the line's dated changes replaced names nothing", async () => {
		expect(await link("Guardroom")).toMatch(/no entry in this session's lorebook is called “Guardroom”/)
	})

	test("a room switched off or archived is refused, by id and by name", async () => {
		expect(await link(e.crypt)).toMatch(/'Crypt' is switched off in the lorebook/)
		expect(await link("Crypt")).toMatch(/'Crypt' is switched off in the lorebook/)
		expect(await link(e.vault)).toMatch(/'Vault' is archived/)
	})

	test("a name two rooms answer alike is refused, never guessed", async () => {
		const refused = await link("watch")
		expect(refused).toMatch(/more than one entry/)
		expect(refused).toMatch(/Watch Room/)
		expect(refused).toMatch(/Watchtower/)
	})
})

describe("a name two rooms answer alike is refused at the state doors", () => {
	test("a location a model names", async () => {
		const { loreRefNamed } = await import("$lib/server/state/write")
		const refused = await refusalOf(() => loreRefNamed(db(), sessionId, LOCATION_SLOT, "watch"))
		expect(refused).toMatch(/Watch Room/)
		expect(refused).toMatch(/Watchtower/)
		expect(await loreRefNamed(db(), sessionId, LOCATION_SLOT, "Watchtower")).toEqual({
			entryId: e.watchtower
		})
	})

	test("a change's owner a model names", async () => {
		const { ownerFor } = await import("$lib/server/pipelines/runtime/tools/stateTools")
		const ctx = { sessionId, read: async () => ({ sessionCharacters: [] }) } as any
		const refused = await refusalOf(() => ownerFor(ctx, "watch"))
		expect(refused).toMatch(/Watch Room/)
		expect(refused).toMatch(/Watchtower/)
	})
})

describe("an Off room is out of the story, not out of the book", () => {
	test("what lies in it still counts toward an item's supply", async () => {
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const [crown] = await itemSupplyFor(db(), sessionId, [e.crown])
		expect(crown).toMatchObject({ held: 1, remaining: 0 })
		expect(crown!.holders).toEqual([
			expect.objectContaining({ ownerKind: "session_location", ownerId: e.ossuary })
		])
	})

	test("the ledger names it", async () => {
		const { stateLedger } = await import("$lib/server/sockets/state")
		const socket = {
			user: { id: userId },
			io: {
				to: () => ({ emit: () => {} }),
				sockets: {
					adapter: { rooms: { get: () => undefined } },
					sockets: { get: () => undefined, values: () => [] }
				}
			}
		} as any
		const res: any = await stateLedger.handler(socket, { sessionId } as any, () => {})
		const torch = (res?.rows ?? []).find(
			(r: any) => r.slotId === INVENTORY_SLOT && JSON.stringify(r.value).includes("dropped torch")
		)
		expect(torch?.ownerLabel).toBe("Crypt")
	})
})

describe("a refusal never quotes a title the asker may not know", () => {
	test("the place editor refuses another book's entry by its id", async () => {
		const { setPlaceStat } = await import("$lib/server/state/placeStats")
		const refused = await refusalOf(() =>
			setPlaceStat(db(), {
				lorebookId: bookId,
				placeId: e.hall,
				slotId: INVENTORY_SLOT,
				value: [{ entryId: e.butler }] as any,
				branchId: null,
				moment: null,
				userId
			})
		)
		expect(refused).toMatch(new RegExp(`Lore entry ${e.butler} is not in this lorebook`))
		expect(refused).not.toMatch(/Butler/)
	})

	test("a session's door refuses a character's private lore without naming it", async () => {
		const { assertLoreRefsInSession } = await import("$lib/server/state/write")
		const onLocation = await refusalOf(() =>
			assertLoreRefsInSession(db(), sessionId, {
				op: "set",
				slotId: LOCATION_SLOT,
				value: { entryId: e.secret }
			} as any)
		)
		const inPack = await refusalOf(() =>
			assertLoreRefsInSession(db(), sessionId, {
				op: "set",
				slotId: INVENTORY_SLOT,
				value: [{ entryId: e.secret }]
			} as any)
		)
		for (const refused of [onLocation, inPack]) {
			expect(refused).toMatch(new RegExp(`lore entry ${e.secret} is private to a character`))
			expect(refused).not.toMatch(/Duke/)
		}
	})

	test("a session's door refuses a sibling line's entry without naming it", async () => {
		const { assertLoreRefsInSession } = await import("$lib/server/state/write")
		const refused = await refusalOf(() =>
			assertLoreRefsInSession(db(), sessionId, {
				op: "set",
				slotId: LOCATION_SLOT,
				value: { entryId: e.camp }
			} as any)
		)
		expect(refused).toMatch(new RegExp(`lore entry ${e.camp} was written on another line`))
		expect(refused).not.toMatch(/Camp/)
	})

	test("a character's private lore held already is never named in the session", async () => {
		const { nameLoreRefs } = await import("$lib/server/state/resolve")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const bag: Record<string, unknown> = { pack: [{ entryId: e.secret }, { entryId: e.crown }] }
		await nameLoreRefs(db(), [bag], await sessionReadingOf(db(), sessionId), "session")
		expect(bag.pack).toEqual([{ entryId: e.secret }, { entryId: e.crown, name: "Crown" }])
	})
})

describe("an entry of any kind the session does not see is refused by id, as by name", () => {
	const pointAt = async (session: number, slotId: string, value: unknown) => {
		const { assertLoreRefsInSession } = await import("$lib/server/state/write")
		return await refusalOf(() =>
			assertLoreRefsInSession(db(), session, { op: "set", slotId, value } as any)
		)
	}

	test("an item switched off is refused into a list", async () => {
		expect(await pointAt(sessionId, INVENTORY_SLOT, [{ entryId: e.offLamp }])).toMatch(
			/'Off Lamp' is switched off in the lorebook/
		)
	})

	test("a room off for a while is refused in words that say so", async () => {
		const refused = await pointAt(clocked, LOCATION_SLOT, { entryId: e.tower })
		expect(refused).toMatch(/'Tower' is off for a while/)
		expect(refused).not.toMatch(/Switch it on/)
		// Back at Year 8: the head reads it on.
		expect(await pointAt(sessionId, LOCATION_SLOT, { entryId: e.tower })).toBe("")
	})
})

describe("the place editor judges an entry as the line's dated changes leave it", () => {
	const put = async (entryId: number) => {
		const { setPlaceStat } = await import("$lib/server/state/placeStats")
		const refused = await refusalOf(() =>
			setPlaceStat(db(), {
				lorebookId: bookId,
				placeId: e.hall,
				slotId: INVENTORY_SLOT,
				value: [{ entryId }] as any,
				branchId: null,
				moment: null,
				userId
			})
		)
		await testDb
			.delete(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "location"),
					eq(schema.attributeValues.ownerId, e.hall)
				)
			)
		return refused
	}

	test("archived by a dated change: refused", async () => {
		expect(await put(e.oldSword)).toMatch(/'Old Sword' is archived/)
	})

	test("restored by a dated change: taken", async () => {
		expect(await put(e.relic)).toBe("")
	})
})

describe("a world location on a room the session no longer sees", () => {
	test("reads as not set, so the prompt says so and the planner's hint answers", async () => {
		const { stateFor } = await import("$lib/server/state/resolve")
		const { sceneAnchor, stateSummary } = await import("$lib/server/pipelines/prompt/adventureContext")
		const state = await stateFor(db(), sessionId)
		expect(state.world.location).toBeUndefined()
		expect(stateSummary(state as never)).toMatch(/location is not set/)
		expect(sceneAnchor(state as never, { worldHints: { location: "Hall" } } as never).location).toBe("Hall")
	})

	test("a model's words naming it are refused, never kept as words", async () => {
		const { loreRefNamed } = await import("$lib/server/state/write")
		expect(await refusalOf(() => loreRefNamed(db(), sessionId, LOCATION_SLOT, "the crypt"))).toMatch(
			/'Crypt' is switched off in the lorebook/
		)
		// Words no room answers stay words.
		expect(await loreRefNamed(db(), sessionId, LOCATION_SLOT, "a muddy field")).toBe("a muddy field")
	})
})

describe("the delete safeguard", () => {
	test("records a session's values on a room that is switched off", async () => {
		const { recordToTimeline } = await import("$lib/server/state/durable")
		const report = await recordToTimeline(db(), sessionId, { reason: "delete" })
		expect(report.owners).toContain(`location:${e.crypt}`)
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "location"),
					eq(schema.attributeValues.ownerId, e.crypt),
					eq(schema.attributeValues.sourceSessionId, sessionId)
				)
			)
		expect(rows.map((r) => (r.value as { v: unknown }).v)).toContainEqual(["dropped torch"])
	})
})
