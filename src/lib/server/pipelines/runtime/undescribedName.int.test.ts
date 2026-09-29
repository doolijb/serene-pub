/**
 * `core:task/undescribed-name@1` over the rows the host really reads (lair
 * re-plan R7, 2026-09-28).
 *
 * `undescribedName.test.ts` pins every branch on hand-built rows. This file
 * proves the rows it was written against are the rows a run hands it: the
 * `lorebook_entries` listing (stored `keys` as the column holds them, a list;
 * any entry type; a location first) and the `session_messages` read (a hidden
 * row gone, a character's row carrying its `characterId`, an envoy's its
 * `speaker`, a side channel's its `channel`). Each read is made the way the
 * Lair's gather makes it, then handed to the binding.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "undescribed-name-secret" }
})

let db: TestDb
let sessionId: number
let delverId: number

const DESCRIBED =
	"Water to the knee fills the Sunken Vault, and green light drips from cracked stone above."

const node = (key: string, definitionId: string) => ({
	key,
	definitionId,
	definitionVersion: 1,
	kind: "query"
})

/** The Lair gather's three reads, then the check, as one turn would run them. */
async function check(name: string, params: Record<string, unknown> = {}) {
	const host = createHost(db as any, { sessionId })
	const read = (table: string, q: Record<string, unknown>, key: string, def: string) =>
		host.read!(table, q, node(key, def) as any) as Promise<any[]>
	const listing = (entryTypes: string[]) => ({
		sessionId,
		currentCharacterId: null,
		entryTypes,
		name: "",
		limit: 500,
		enabled: true,
		archived: false
	})
	const rooms = await read(
		"lorebook_entries",
		listing(["core:entry/location"]),
		"gather.rooms.read",
		"core:query/lorebook-entries"
	)
	const lorebook = await read(
		"lorebook_entries",
		listing([]),
		"gather.lorebook.read",
		"core:query/lorebook-entries"
	)
	const channels = (params.channels as string[] | undefined) ?? ["main"]
	const messages = await Promise.all(
		channels.map((channel) =>
			read(
				"session_messages",
				{ sessionId, limit: 100, channel },
				"gather.history.read",
				"core:query/session-history"
			)
		)
	)
	const out: any = await coreBindings()["core:task/undescribed-name@1"]!(
		{ name, locationEntries: rooms, entries: lorebook, messages, params } as any,
		{} as any
	)
	expect(out.kind).toBe("ok")
	return out.value
}

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-undescribed-name-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db as any, "undescribed-owner")

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "The lair under test" })
		.returning()
	await db.insert(schema.lorebookEntries).values([
		{
			lorebookId: book!.id,
			typeId: "core:entry/location",
			typeVersion: 1,
			position: 1,
			title: "The Old Well",
			keys: ["well shaft", "the dry well"],
			content: "A dry well shaft.\n\nExits: down → The Stair"
		},
		{
			lorebookId: book!.id,
			typeId: "core:entry/world-lore",
			typeVersion: 1,
			position: 1,
			title: "Brask's Journal",
			keys: ["the ossuary"],
			content: "Brask wrote of an ossuary below the stair."
		}
	])

	const [delver] = await db
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Brask", description: "A delver." })
		.returning()
	delverId = delver!.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, lorebookId: book!.id })
		.returning()
	sessionId = session!.id

	await db.insert(schema.sessionMessages).values([
		// The master describes the Sunken Vault, on main.
		{ sessionId, userId: owner.id, role: "user", content: DESCRIBED },
		// A hidden row describing the Flooded Crypt: the read drops it.
		{
			sessionId,
			userId: owner.id,
			role: "user",
			isHidden: true,
			content: DESCRIBED.replace("Sunken Vault", "Flooded Crypt")
		},
		// A delver describing the Bone Gallery at length: never a description.
		{
			sessionId,
			characterId: delverId,
			role: "assistant",
			content: DESCRIBED.replace("Sunken Vault", "Bone Gallery")
		},
		// The Castellan describing the Salt Stair, on the side channel.
		{
			sessionId,
			role: "assistant",
			channel: "sanctum",
			metadata: { speaker: "envoy:castellan" },
			content: DESCRIBED.replace("Sunken Vault", "Salt Stair")
		}
	] as any)
})

describe("undescribed-name over the host's reads", () => {
	it("a location entry answers by its title", async () => {
		const a = await check("the old well")
		expect(a).toMatchObject({ describedBy: "entry", undescribed: "" })
		expect(typeof a.entryId).toBe("number")
	})

	it("a location entry answers by a stored key", async () => {
		expect((await check("The Dry Well")).describedBy).toBe("entry")
	})

	it("any entry type answers, by a key", async () => {
		expect((await check("Ossuary")).describedBy).toBe("entry")
	})

	it("the master's paragraph on main describes the room", async () => {
		const a = await check("The Sunken Vault")
		expect(a).toMatchObject({ describedBy: "prose", passage: DESCRIBED, undescribed: "" })
	})

	it("a hidden row does not", async () => {
		expect((await check("The Flooded Crypt")).undescribed).toBe("The Flooded Crypt")
	})

	it("a delver's row does not", async () => {
		expect((await check("The Bone Gallery")).undescribed).toBe("The Bone Gallery")
	})

	it("the Castellan's sanctum row counts only when the sanctum is named", async () => {
		expect((await check("The Salt Stair")).undescribed).toBe("The Salt Stair")
		const a = await check("The Salt Stair", { channels: ["main", "sanctum"] })
		expect(a.describedBy).toBe("prose")
	})

	it("a room nothing describes is undescribed", async () => {
		expect(await check("The Drowned Hall")).toEqual({
			main: "The Drowned Hall",
			undescribed: "The Drowned Hall",
			describedBy: "",
			entryId: null,
			passage: ""
		})
	})
})
