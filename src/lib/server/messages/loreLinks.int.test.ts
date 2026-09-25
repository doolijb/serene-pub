/**
 * `core:outlet/link-lore-entries@1`, and the links a create writes with its
 * row (L2/L3, contracts batch 2, 2026-09-17).
 *
 * The rows have existed all along — an entry-ended `narrative_relationships`
 * row, the same edge the lorebook's own graph draws — and no pipeline could
 * write one, so a genre whose world has *shape* put its exits in the prose and
 * parsed them back out. What is asked here is whether the outlet holds the
 * three rules that make writing them safe:
 *
 *  · **one book, both ends** — an edge whose ends live in two lorebooks
 *    belongs to neither, and the row carries one `lorebook_id`;
 *  · **a name is resolved, never invented** — case and space ignored, nothing
 *    created, and an ambiguous name refused rather than guessed at;
 *  · **the declared writes lever** (R-B) — a link is a change to the book, so
 *    a genre that keeps its lorebook as reference writes none, whatever spec
 *    is bound.
 *
 * And the one that makes it usable: `create-lore-entry@1` takes its `links`
 * and writes them in the same transaction — a room whose exits do not resolve
 * fails WITH the room.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string
let userId: number
/** The session's own book. */
let bookId: number
/** Another book of the same user — the cross-book end. */
let otherBookId: number
let plainSessionId: number
/** A genre whose lorebook is a reference: it writes nothing into it. */
let referenceSessionId: number
let hallId: number
let cellarId: number
let farRoomId: number

const REFERENCE_GENRE = "chariot.desk:inlet/reference@1"
const LINK = { key: "link", definitionId: "core:outlet/link-lore-entries" }
const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }

/** One entry, straight in — the fixtures' own route, minus the fixtures. */
const addEntry = async (lorebookId: number, name: string, position: number) => {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId,
				name,
				content: `About ${name}.`,
				position
			})
		)
		.returning({ id: schema.lorebookEntries.id })
	return row!.id
}

const links = async (lorebookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))

const host = async (sessionId: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, { sessionId })
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lore-links-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "lore-links-user")).id

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/reference",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Reference Desk" } },
		ports: {},
		sessionShape: {
			composer: "text",
			lorebook: "optional",
			writes: { lore: false, scenes: false }
		}
	} as any)

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The Lair", userId })
		.returning()
	bookId = book!.id
	const [other] = await db
		.insert(schema.lorebooks)
		.values({ name: "Somewhere Else", userId })
		.returning()
	otherBookId = other!.id

	const [plain] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: bookId })
		.returning()
	plainSessionId = plain!.id
	const [reference] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			genreId: REFERENCE_GENRE,
			lorebookId: bookId
		})
		.returning()
	referenceSessionId = reference!.id

	hallId = await addEntry(bookId, "The Hall", 1)
	cellarId = await addEntry(bookId, "The Cellar", 2)
	farRoomId = await addEntry(otherBookId, "Far Room", 1)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("core:outlet/link-lore-entries — a link between two entries", () => {
	it(
		"lands a row between two entries of the session's lorebook, `to` by name",
		async () => {
			const before = (await links(bookId)).length
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				// The name as a model would write it: different case, padded.
				{ from: hallId, to: "  the cellar ", label: "a stair down" },
				LINK as any
			)) as { id: number; fromEntryId: number; lorebookId: number }

			expect(res.lorebookId).toBe(bookId)
			expect(res.fromEntryId).toBe(hallId)
			const rows = await links(bookId)
			expect(rows.length).toBe(before + 1)
			const row = rows.find((r) => r.id === res.id)!
			expect(row.fromEntryId).toBe(hallId)
			expect(row.toEntryId).toBe(cellarId)
			// Both node columns null: the two CHECK constraints require exactly
			// one of node/entry per side.
			expect(row.fromNodeId).toBeNull()
			expect(row.toNodeId).toBeNull()
			// The default is a TRAVEL kind, which is the one set anything reads
			// semantically — it is what makes two entries a place you can walk
			// between.
			expect(row.relationshipType).toBe("leads to")
			expect(row.description).toBe("a stair down")
		},
		60_000
	)

	it(
		"takes both ends by id, and `from` as the write result an outlet publishes",
		async () => {
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{
					// `write-result@1`: every port declared as one resolves to the
					// whole result, so `$.save.entryId` IS this shape.
					from: { status: "committed", ids: { id: cellarId } },
					to: hallId,
					params: { linkType: "connects to" }
				},
				LINK as any
			)) as { id: number }
			const row = (await links(bookId)).find((r) => r.id === res.id)!
			expect(row.fromEntryId).toBe(cellarId)
			expect(row.toEntryId).toBe(hallId)
			expect(row.relationshipType).toBe("connects to")
			// Nothing said, so nothing written: the caption is not a name.
			expect(row.description).toBe("")
		},
		60_000
	)

	it(
		"refuses an end in another lorebook, and writes nothing",
		async () => {
			const before = (await links(bookId)).length
			const h = await host(plainSessionId)
			await expect(
				h.commit!({ from: hallId, to: farRoomId }, LINK as any)
			).rejects.toThrow(/not in this session's lorebook/)
			await expect(
				h.commit!({ from: farRoomId, to: hallId }, LINK as any)
			).rejects.toThrow(/not in this session's lorebook/)
			// By NAME too: a name is resolved inside the book, so the other
			// book's entry is not merely refused, it is not visible.
			await expect(
				h.commit!({ from: hallId, to: "Far Room" }, LINK as any)
			).rejects.toThrow(/no entry in this session's lorebook is called/)
			expect((await links(bookId)).length).toBe(before)
			expect(await links(otherBookId)).toEqual([])
		},
		60_000
	)

	it(
		"refuses an ambiguous name rather than picking one",
		async () => {
			// Two entries of one book may share a title; the position unique is
			// per (book, type), not per name.
			const twinA = await addEntry(bookId, "The Twin", 10)
			const twinB = await addEntry(bookId, "the twin", 11)
			expect(twinA).not.toBe(twinB)
			const before = (await links(bookId)).length
			const h = await host(plainSessionId)
			await expect(
				h.commit!({ from: hallId, to: "The Twin" }, LINK as any)
			).rejects.toThrow(/more than one entry/)
			expect((await links(bookId)).length).toBe(before)
		},
		60_000
	)

	it(
		"refuses when the genre keeps its lorebook as reference (writes.lore: false)",
		async () => {
			const before = (await links(bookId)).length
			const h = await host(referenceSessionId)
			await expect(
				h.commit!({ from: hallId, to: cellarId }, LINK as any)
			).rejects.toThrow(/keeps its lorebook as reference/)
			expect((await links(bookId)).length).toBe(before)
		},
		60_000
	)
})

describe("core:outlet/create-lore-entry — the kind, and the links, in one commit", () => {
	it(
		"writes the entry and its links in the same transaction (F7's way round)",
		async () => {
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{
					name: "The Landing",
					content: "A landing.",
					// Three spellings at once, because all three are what a spec
					// actually has: a name, an id, and a request of its own.
					links: [
						"The Hall",
						cellarId,
						{ to: "The Hall", linkType: "near", label: "over the rail" }
					]
				},
				SAVE as any
			)) as { id: number; linkIds: number[] }

			expect(res.linkIds).toHaveLength(3)
			const rows = (await links(bookId)).filter((r) =>
				res.linkIds.includes(r.id)
			)
			expect(rows.every((r) => r.fromEntryId === res.id)).toBe(true)
			expect(rows.map((r) => r.relationshipType).sort()).toEqual([
				"leads to",
				"leads to",
				"near"
			])
		},
		60_000
	)

	it(
		"fails the row with its links when one of them names no entry",
		async () => {
			const beforeLinks = (await links(bookId)).length
			const h = await host(plainSessionId)
			await expect(
				h.commit!(
					{
						name: "The Void",
						content: "…",
						links: ["The Hall", "A Room That Is Not There"]
					},
					SAVE as any
				)
			).rejects.toThrow(/no entry in this session's lorebook is called/)
			// Half a room is worse than none: the refusal is raised inside the
			// transaction, so neither the entry nor its first link survives.
			expect((await links(bookId)).length).toBe(beforeLinks)
			const [orphan] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.lorebookId, bookId),
						eq(schema.lorebookEntries.title, "The Void")
					)
				)
			expect(orphan).toBeUndefined()
		},
		60_000
	)

	it(
		"files the row under the entry type the pipeline declares",
		async () => {
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{
					name: "",
					content: "It happened.",
					params: { entryType: HISTORY_TYPE_ID }
				},
				SAVE as any
			)) as { id: number }
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, res.id))
			expect(row!.typeId).toBe(HISTORY_TYPE_ID)
			// History declares no `title` role, so the row has none — the
			// declaration decides the shape, not the outlet.
			expect(row!.title).toBeNull()
		},
		60_000
	)

	it(
		"refuses an entry type nothing declares, naming the ones that are",
		async () => {
			const h = await host(plainSessionId)
			await expect(
				h.commit!(
					{
						name: "Nowhere",
						content: "…",
						params: { entryType: "core:entry/spell" }
					},
					SAVE as any
				)
			).rejects.toThrow(/is not a declared entry type/)
			const [orphan] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.lorebookId, bookId),
						eq(schema.lorebookEntries.title, "Nowhere")
					)
				)
			expect(orphan).toBeUndefined()
		},
		60_000
	)

	it(
		"still writes world lore when the pipeline says nothing",
		async () => {
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{ name: "Plain", content: "As it always was." },
				SAVE as any
			)) as { id: number }
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, res.id))
			expect(row!.typeId).toBe(WORLD_LORE_TYPE_ID)
		},
		60_000
	)
})
