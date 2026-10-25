/**
 * `core:query/lorebook-entries@1` reads the session's books (PLAN-rulesets
 * §26): its attached lorebook, then its own notes (the own book) — the union,
 * the notes' rows marked `sessionOnly: true`. A session with no lorebook but
 * notes lists its notes; the rooms listing and "From here:" are built on it.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { ownBookFor } from "$lib/server/lorebooks/ownBook"
import { fromHereLines } from "$lib/server/pipelines/prompt/adventureContext"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "ownBook-entries-secret" }
})

let db: TestDb
let userId: number
let bare: number
let attached: number
const id: Record<string, number> = {}

const node = {
	key: "rooms",
	definitionId: "core:query/lorebook-entries@1",
	definitionVersion: 1,
	kind: "query"
}

const rooms = (sessionId: number, query: Record<string, unknown> = {}) =>
	createHost(db as any, { sessionId }).read!(
		"lorebook_entries",
		{
			sessionId,
			currentCharacterId: null,
			enabled: true,
			archived: false,
			entryTypes: [LOCATION_TYPE_ID],
			...query
		},
		node as any
	) as Promise<any[]>

let position = 0
const place = async (lorebookId: number, name: string) => {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: LOCATION_TYPE_ID,
				lorebookId,
				name,
				content: `About ${name}.`,
				position: position++
			} as any) as any
		)
		.returning({ id: schema.lorebookEntries.id })
	id[name] = row!.id
	return row!.id
}

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-ownBook-entries-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "ownBook-entries", isAdmin: false })
		.returning()
	userId = user!.id

	// No lorebook: only notes.
	const [s1] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "Bare" })
		.returning()
	bare = s1!.id
	const notes1 = await ownBookFor(db as any, bare)
	await place(notes1.id, "The Lonely Shed")

	// A lorebook, and notes over it.
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The Keep", userId })
		.returning()
	await place(book!.id, "The Guardroom")
	const [s2] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "Kept", lorebookId: book!.id })
		.returning()
	attached = s2!.id
	const notes2 = await ownBookFor(db as any, attached)
	await place(notes2.id, "The Hidden Cellar")
	await place(notes2.id, "The Root Tunnel")
	await db.insert(schema.narrativeRelationships).values({
		lorebookId: notes2.id,
		fromNodeId: null,
		toNodeId: null,
		fromEntryId: id["The Hidden Cellar"],
		toEntryId: id["The Root Tunnel"],
		relationshipType: "opens onto",
		reverseRelationshipType: "opens onto"
	} as any)
	// A way from the book's room down to the notes' room, kept in the notes.
	await db.insert(schema.narrativeRelationships).values({
		lorebookId: notes2.id,
		fromNodeId: null,
		toNodeId: null,
		fromEntryId: id["The Guardroom"],
		toEntryId: id["The Hidden Cellar"],
		relationshipType: "leads down to",
		reverseRelationshipType: "leads up to"
	} as any)
}, 60_000)

describe("lorebook-entries@1 reads the session's notes", () => {
	it("lists a notes place when the session has no lorebook", async () => {
		const rows = await rooms(bare)
		expect(rows.map((r) => [r.name, r.sessionOnly])).toEqual([
			["The Lonely Shed", true]
		])
	}, 60_000)

	it("lists the book's places and the notes', only the notes' marked", async () => {
		const rows = await rooms(attached)
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
		expect(Object.keys(byName).sort()).toEqual([
			"The Guardroom",
			"The Hidden Cellar",
			"The Root Tunnel"
		])
		expect(byName["The Guardroom"]).not.toHaveProperty("sessionOnly")
		expect(byName["The Hidden Cellar"].sessionOnly).toBe(true)
	}, 60_000)

	it("says a way between two notes places under From here:", async () => {
		const rows = await rooms(attached, { withLinks: true })
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
		expect(fromHereLines(byName["The Hidden Cellar"]).join("\n")).toContain(
			"The Root Tunnel"
		)
	}, 60_000)

	/**
	 * ⚠ Expected to fail until `readGraphEntryLinks` (utils/graphEntryLinks.ts,
	 * `bookEntryLinks`) names an end in the attached book for a link the notes
	 * keep: it reads each book's ends in that book only, so the way is dropped
	 * before this read sees it. Flip to `it` when that lands.
	 */
	it("says a way between a book place and a notes place under From here:", async () => {
		const rows = await rooms(attached, { withLinks: true })
		const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
		expect(fromHereLines(byName["The Guardroom"]).join("\n")).toContain(
			"The Hidden Cellar"
		)
		expect(fromHereLines(byName["The Hidden Cellar"]).join("\n")).toContain(
			"The Guardroom"
		)
	}, 60_000)
})
