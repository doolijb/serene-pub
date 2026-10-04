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
				{ from: hallId, to: "  the cellar ", description: "a stair down" },
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
			// The default wording is `leads to`, one way: nothing said a way
			// back, so the row has none (places plan B2).
			expect(row.relationshipType).toBe("leads to")
			expect(row.reverseRelationshipType).toBeNull()
			expect(row.title).toBe("")
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
		"cuts a model's words to the relationship ceilings, as the graph build's apply does",
		async () => {
			const { RELATIONSHIP_TEXT_LIMITS } = await import(
				"$lib/shared/lorebooks/linkVocabulary"
			)
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{
					from: hallId,
					to: cellarId,
					name: "n".repeat(5000),
					description: "d".repeat(100_000),
					params: {
						linkType: "w".repeat(5000),
						reverseLinkType: "r".repeat(5000)
					}
				},
				LINK as any
			)) as { id: number }
			const row = (await links(bookId)).find((r) => r.id === res.id)!
			expect(row.relationshipType).toBe(
				"w".repeat(RELATIONSHIP_TEXT_LIMITS.wording)
			)
			expect(row.reverseRelationshipType).toBe(
				"r".repeat(RELATIONSHIP_TEXT_LIMITS.wording)
			)
			expect(row.title).toBe("n".repeat(RELATIONSHIP_TEXT_LIMITS.name))
			expect(row.description).toBe(
				"d".repeat(RELATIONSHIP_TEXT_LIMITS.description)
			)
			// The same call again finds the row it wrote, cut as it was.
			const again = (await h.commit!(
				{
					from: hallId,
					to: cellarId,
					name: "n".repeat(5000),
					params: {
						linkType: "w".repeat(5000),
						reverseLinkType: "r".repeat(5000)
					}
				},
				LINK as any
			)) as { id: number }
			expect(again.id).toBe(res.id)
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
		"names a pipeline as the row's writer, never a person",
		async () => {
			const h = await host(plainSessionId)
			const res = (await h.commit!(
				{ name: "The Loft", content: "A loft." },
				SAVE as any
			)) as { id: number }
			const [row] = await db
				.select({ provenance: schema.lorebookEntries.provenance })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, res.id))
			expect(row!.provenance).toBe("pipeline")
		},
		60_000
	)

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
						{ to: "The Hall", linkType: "near", description: "over the rail" }
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

/**
 * Places plan B2 (2026-09-29): the relationship's whole descriptor, and the
 * outlet made **idempotent**.
 *
 * A Lair re-run, a swipe, or a second turn that links what the first already
 * linked must not stack exits: one way is one row (`linksOnReadingThatWay`,
 * as the session reads), so the second call answers with the standing row's id. And because the run
 * did not make that row, it is neither recorded as the run's artifact (an
 * undo of the run must never delete a link somebody else drew) nor reported
 * as a write (`written: false`, so the executor emits no `lore-link-created`).
 */
describe("the descriptor, and the second call (places plan B2)", () => {
	let guardroomId: number
	let drownedId: number
	const hostWith = async (artifacts: any[]) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as any, { sessionId: plainSessionId, artifacts })
	}
	const door = {
		name: "the rusted iron door",
		description: "Hinges scream.",
		params: { linkType: "leads north to", reverseLinkType: "leads south to" }
	}

	beforeAll(async () => {
		guardroomId = await addEntry(bookId, "The Guardroom", 40)
		drownedId = await addEntry(bookId, "The Drowned Hall", 41)
	}, 60_000)

	it(
		"stores the name, the description and the way back",
		async () => {
			const artifacts: any[] = []
			const h = await hostWith(artifacts)
			const res = (await h.commit!(
				{ from: guardroomId, to: "The Drowned Hall", ...door },
				LINK as any
			)) as { id: number; written?: boolean }
			const row = (await links(bookId)).find((r) => r.id === res.id)!
			expect(row.title).toBe("the rusted iron door")
			expect(row.description).toBe("Hinges scream.")
			expect(row.relationshipType).toBe("leads north to")
			expect(row.reverseRelationshipType).toBe("leads south to")
			// A write the run made is the run's.
			expect(res.written).not.toBe(false)
			expect(artifacts).toEqual([
				{ kind: "lore_link", entityId: res.id, action: "created", nodeKey: "link" }
			])
		},
		60_000
	)

	it(
		"answers a second identical call with the same id, and writes nothing",
		async () => {
			const h1 = await hostWith([])
			const first = (await h1.commit!(
				{ from: guardroomId, to: drownedId, ...door },
				LINK as any
			)) as { id: number }
			const before = (await links(bookId)).length
			const artifacts: any[] = []
			const h2 = await hostWith(artifacts)
			const again = (await h2.commit!(
				{ from: guardroomId, to: "the drowned hall", ...door },
				LINK as any
			)) as { id: number; written?: boolean }
			expect(again.id).toBe(first.id)
			expect((await links(bookId)).length).toBe(before)
			// Not the run's row: no artifact, and no event.
			expect(again.written).toBe(false)
			expect(artifacts).toEqual([])
		},
		60_000
	)

	it(
		"answers the mirror — the same way drawn from the far end — with the standing row",
		async () => {
			const standing = (await links(bookId)).find(
				(r) =>
					r.fromEntryId === guardroomId &&
					r.toEntryId === drownedId &&
					r.title === "the rusted iron door"
			)!
			const before = (await links(bookId)).length
			const h = await hostWith([])
			const mirror = (await h.commit!(
				{
					from: drownedId,
					to: guardroomId,
					name: "The Rusted Iron Door",
					params: { linkType: "leads south to" }
				},
				LINK as any
			)) as { id: number; written?: boolean }
			expect(mirror.id).toBe(standing.id)
			expect(mirror.written).toBe(false)
			expect((await links(bookId)).length).toBe(before)
			// The standing row is never rewritten by a pipeline's repeat.
			const [after] = (await links(bookId)).filter((r) => r.id === standing.id)
			expect(after!.reverseRelationshipType).toBe("leads south to")
			expect(after!.description).toBe("Hinges scream.")
		},
		60_000
	)

	it(
		"draws a second, differently named door between the same rooms",
		async () => {
			const before = (await links(bookId)).length
			const h = await hostWith([])
			const res = (await h.commit!(
				{
					from: guardroomId,
					to: drownedId,
					name: "the grate",
					params: { linkType: "leads north to" }
				},
				LINK as any
			)) as { id: number; written?: boolean }
			expect(res.written).not.toBe(false)
			expect((await links(bookId)).length).toBe(before + 1)
		},
		60_000
	)

	it(
		"reads a blank way back as one way",
		async () => {
			const h = await hostWith([])
			const res = (await h.commit!(
				{
					from: drownedId,
					to: guardroomId,
					name: "the drain",
					params: { linkType: "drains into", reverseLinkType: "   " }
				},
				LINK as any
			)) as { id: number }
			const row = (await links(bookId)).find((r) => r.id === res.id)!
			expect(row.reverseRelationshipType).toBeNull()
		},
		60_000
	)

	it(
		"create-lore-entry writes a link's name and way back, and a repeat in one list is one row",
		async () => {
			const artifacts: any[] = []
			const h = await hostWith(artifacts)
			const res = (await h.commit!(
				{
					name: "The Antechamber",
					content: "Cold.",
					params: { entryType: "core:entry/location" },
					links: [
						{
							to: "The Guardroom",
							linkType: "leads to",
							reverseLinkType: "leads to",
							name: "the arch",
							description: "Low."
						},
						// Said twice by a model that repeated itself.
						{
							to: guardroomId,
							linkType: "LEADS TO",
							reverseLinkType: "leads to",
							name: "The Arch"
						}
					]
				},
				SAVE as any
			)) as { id: number; linkIds: number[] }
			expect(res.linkIds).toHaveLength(2)
			expect(res.linkIds[1]).toBe(res.linkIds[0])
			const rows = (await links(bookId)).filter((r) => r.fromEntryId === res.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				toEntryId: guardroomId,
				title: "the arch",
				description: "Low.",
				relationshipType: "leads to",
				reverseRelationshipType: "leads to"
			})
			// The entry and its ONE link, each recorded once.
			expect(
				artifacts.map((a) => `${a.kind}:${a.entityId}`).sort()
			).toEqual([`lore_entry:${res.id}`, `lore_link:${rows[0]!.id}`].sort())
		},
		60_000
	)
})

/**
 * Review round (places plan B2): the second call is judged **as the session
 * reads**, and only a row that says everything asked is the answer.
 *
 * A fork reads main's links drawn before it, and every session reads a link
 * dated at or before its moment, so a row keyed on one line and one date was
 * the wrong question: the outlet wrote the fork its own copy of main's door
 * and the session read it twice. And a row sharing ONE sentence with the
 * request (a one-way door where both ways was asked) was answered as the
 * link, so the way back never existed and the run said it stood.
 */
describe("the second call, as the session reads it (places plan B2, review round)", () => {
	let n = 100
	const room = (name: string) => addEntry(bookId, name, ++n)
	const hostFor = async (sessionId: number, artifacts: any[] = []) => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as any, { sessionId, artifacts })
	}
	const link = (sessionId: number, input: Record<string, unknown>, artifacts: any[] = []) =>
		hostFor(sessionId, artifacts).then(
			(h) =>
				h.commit!(input, LINK as any) as Promise<{
					id: number
					fromEntryId: number
					written?: boolean
				}>
		)
	const draw = async (values: Record<string, unknown>) => {
		const [row] = await db
			.insert(schema.narrativeRelationships)
			.values({ lorebookId: bookId, fromNodeId: null, toNodeId: null, ...values } as any)
			.returning({ id: schema.narrativeRelationships.id })
		return row!.id
	}
	const fork = async (name: string) => {
		const [branch] = await db
			.insert(schema.lorebookBranches)
			.values({ lorebookId: bookId, name })
			.returning()
		return branch!.id
	}
	const sessionOn = async (over: Record<string, unknown>) => {
		const [s] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, lorebookId: bookId, ...over } as any)
			.returning()
		return s!.id
	}
	const dated = async (year: number) => {
		const [row] = await db
			.insert(schema.lorebookEntries)
			.values({
				...entryInsert({
					typeId: HISTORY_TYPE_ID,
					lorebookId: bookId,
					content: `Year ${year}.`,
					position: ++n
				}),
				fields: { year }
			})
			.returning({ id: schema.lorebookEntries.id })
		return row!.id
	}
	const both = { params: { linkType: "leads north to", reverseLinkType: "leads south to" } }

	it(
		"answers a fork's call with main's door drawn before the fork, and writes the fork nothing",
		async () => {
			const a = await room("Fork Guardroom")
			const b = await room("Fork Hall")
			const mainDoor = await draw({
				fromEntryId: a,
				toEntryId: b,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to"
			})
			const f = await fork("The Flooded Line")
			const onFork = await sessionOn({ lorebookBranchId: f })
			const before = (await links(bookId)).length
			const artifacts: any[] = []
			const res = await link(onFork, { from: a, to: b, ...both }, artifacts)
			expect(res.id).toBe(mainDoor)
			expect(res.written).toBe(false)
			expect(artifacts).toEqual([])
			expect((await links(bookId)).length).toBe(before)
		},
		60_000
	)

	it(
		"does not read a sibling fork's door as this session's",
		async () => {
			const a = await room("Sibling Guardroom")
			const b = await room("Sibling Hall")
			const other = await fork("The Other Line")
			await draw({
				fromEntryId: a,
				toEntryId: b,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to",
				branchId: other
			})
			const mine = await fork("My Line")
			const res = await link(await sessionOn({ lorebookBranchId: mine }), {
				from: a,
				to: b,
				...both
			})
			expect(res.written).not.toBe(false)
			const [row] = (await links(bookId)).filter((r) => r.id === res.id)
			expect(row!.branchId).toBe(mine)
		},
		60_000
	)

	it(
		"answers with a door dated at or before the session's moment",
		async () => {
			const a = await room("Dated Guardroom")
			const b = await room("Dated Hall")
			const y3 = await dated(3)
			const door = await draw({
				fromEntryId: a,
				toEntryId: b,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to",
				historyEntryId: y3
			})
			const atY5 = await sessionOn({ storyClockYear: 5 })
			const before = (await links(bookId)).length
			const res = await link(atY5, { from: a, to: b, ...both })
			expect(res).toMatchObject({ id: door, written: false })
			expect((await links(bookId)).length).toBe(before)
		},
		60_000
	)

	it(
		"refuses when the door that stands goes one way and both ways was asked",
		async () => {
			const a = await room("One-way Guardroom")
			const b = await room("One-way Hall")
			await draw({ fromEntryId: a, toEntryId: b, relationshipType: "leads north to" })
			const before = (await links(bookId)).length
			await expect(
				link(plainSessionId, { from: a, to: b, ...both })
			).rejects.toThrow(/already linked that way.*only part/)
			expect((await links(bookId)).length).toBe(before)
		},
		60_000
	)

	it(
		"refuses when the only shared sentence is the way back, drawn from the far end",
		async () => {
			const a = await room("Backward Guardroom")
			const b = await room("Backward Hall")
			// "Hall leads south to Guardroom", one way: nothing says
			// "Guardroom leads north to Hall".
			await draw({ fromEntryId: b, toEntryId: a, relationshipType: "leads south to" })
			await expect(
				link(plainSessionId, { from: a, to: b, ...both })
			).rejects.toThrow(/already linked that way.*only part/)
		},
		60_000
	)

	it(
		"refuses a door that says it all but no longer stands, rather than answering with it",
		async () => {
			const a = await room("Sealed Guardroom")
			const b = await room("Sealed Hall")
			const c = await room("Hidden Hall")
			await draw({
				fromEntryId: a,
				toEntryId: b,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to",
				status: "resolved"
			})
			await draw({
				fromEntryId: a,
				toEntryId: c,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to",
				visibility: "secret"
			})
			await expect(
				link(plainSessionId, { from: a, to: b, ...both })
			).rejects.toThrow(/already linked that way.*is resolved/)
			await expect(
				link(plainSessionId, { from: a, to: c, ...both })
			).rejects.toThrow(/already linked that way.*secret/)
		},
		60_000
	)

	it(
		"answers a one-way call with a two-way door that says it, and a mirror with the row's own from",
		async () => {
			const a = await room("Mirror Guardroom")
			const b = await room("Mirror Hall")
			const door = await draw({
				fromEntryId: a,
				toEntryId: b,
				relationshipType: "leads north to",
				reverseRelationshipType: "leads south to"
			})
			const oneWay = await link(plainSessionId, {
				from: a,
				to: b,
				params: { linkType: "Leads North To" }
			})
			expect(oneWay).toMatchObject({ id: door, fromEntryId: a, written: false })
			const mirror = await link(plainSessionId, {
				from: b,
				to: a,
				params: { linkType: "leads south to", reverseLinkType: "leads north to" }
			})
			// The standing row starts at the Guardroom, whatever was asked.
			expect(mirror).toMatchObject({ id: door, fromEntryId: a, written: false })
		},
		60_000
	)
})
