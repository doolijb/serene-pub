/**
 * Session retrieval reads the book **where the session stands** — its line
 * and its story clock (owner ruling 3, 2026-09-28; findings #0, #135, #141,
 * #143, #144, #146, #151, #153).
 *
 * The book: main, fork A (at NOW, follows main), fork B (at Y5) and fork C (a
 * fork of B — ruling 5, it reads through B). Each line has an entry of its
 * own; a shared entry carries a main amendment at Y4 and one on A at Y6; a
 * history entry is dated Y10.
 *
 * Pinned, against the host's own `lorebook_entries` read (the one every lore
 * mechanism shares) and its writes:
 *
 *  - a line's own entry reaches that line and the lines forked from it, never
 *    main and never a sibling;
 *  - amendments are applied before any mechanism sees the row: at the head
 *    every dated amendment on the line; at a story clock only those dated by
 *    then; a dated history entry after the clock has not happened;
 *  - keys arrive as the stored list, so a regex quantifier `{1,2}` survives
 *    to the matcher;
 *  - a pipeline write from a session on a fork is that fork's (entry and link);
 *  - the link hop's edges are the session's line's, standing, not secret, and
 *    end at live entries of this book.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { entryInsert, WORLD_LORE_TYPE_ID, HISTORY_TYPE_ID } from "$lib/server/utils/lorebookEntries"
import { keywordQuery } from "$lib/server/pipelines/ranking/keywordQuery"
import { withDefaults } from "$lib/server/pipelines/ranking/weights"
import { onLineSql } from "$lib/server/state/lineSql"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let bookId: number
let otherBookId: number
const branch: Record<"A" | "B" | "C", number> = { A: 0, B: 0, C: 0 }
const session: Record<"main" | "A" | "B" | "C" | "clock", number> = {
	main: 0,
	A: 0,
	B: 0,
	C: 0,
	clock: 0
}
const entry: Record<string, number> = {}
let position = 1

const node = {
	key: "lore",
	definitionId: "core:query/lorebook-triggers@1",
	definitionVersion: 1,
	kind: "query"
}
const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }
const LINK = { key: "link", definitionId: "core:outlet/link-lore-entries" }

const host = async (sessionId: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, { sessionId })
}

/** The lore read every retrieval mechanism shares, narrator-shaped. */
const lore = async (sessionId: number, query: Record<string, unknown> = {}) => {
	const h = await host(sessionId)
	return (await h.read!(
		"lorebook_entries",
		{ sessionId, currentCharacterId: null, ...query },
		node as any
	)) as any[]
}
const names = (rows: any[]) => rows.map((r) => r.name).filter((n) => n !== null).sort()

const addEntry = async (
	name: string | null,
	extra: Record<string, unknown> = {},
	lorebookId = bookId
) => {
	const typeId = (extra.typeId as string) ?? WORLD_LORE_TYPE_ID
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			...entryInsert({
				typeId,
				lorebookId,
				name: name ?? undefined,
				content: `About ${name ?? "then"}.`,
				position: position++,
				...extra
			} as any)
		})
		.returning({ id: schema.lorebookEntries.id })
	return row!.id
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lore-reading-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const userId = (await createTestUser(db, "lore-reading-user")).id

	const [book] = await db.insert(schema.lorebooks).values({ name: "Ashfall", userId }).returning()
	bookId = book!.id
	const [other] = await db.insert(schema.lorebooks).values({ name: "Elsewhere", userId }).returning()
	otherBookId = other!.id

	const fork = async (name: string, values: Record<string, unknown>) =>
		(await db.insert(schema.lorebookBranches).values({ lorebookId: bookId, name, ...values } as any).returning())[0]!.id
	branch.A = await fork("A", {})
	branch.B = await fork("B", { forkYear: 5 })
	branch.C = await fork("C", { forkedFromBranchId: branch.B })

	const seat = async (values: Record<string, unknown>) =>
		(await db.insert(schema.sessions).values({ userId, isGroup: false, lorebookId: bookId, ...values } as any).returning())[0]!.id
	session.main = await seat({})
	session.A = await seat({ lorebookBranchId: branch.A })
	session.B = await seat({ lorebookBranchId: branch.B })
	session.C = await seat({ lorebookBranchId: branch.C })
	session.clock = await seat({ storyClockYear: 3 })

	entry.hearth = await addEntry("Hearth", { keys: ["hearth"] })
	entry.aerie = await addEntry("Aerie", { branchId: branch.A })
	entry.bastion = await addEntry("Bastion", { branchId: branch.B })
	entry.cairn = await addEntry("Cairn", { branchId: branch.C })
	entry.regex = await addEntry("Echo", { keys: ["(ab){1,2}c"], useRegex: true, matchMode: "regex" })
	entry.shelved = await addEntry("Shelf", { archived: true })
	entry.off = await addEntry("Dark Room", { enabled: false })
	entry.flood = await addEntry(null, { typeId: HISTORY_TYPE_ID, year: 10, content: "The flood came." })
	entry.far = await addEntry("Far Room", {}, otherBookId)

	await db.insert(schema.entryAmendments).values([
		{
			lorebookId: bookId,
			entryId: entry.hearth,
			branchId: null,
			year: 4,
			// As the editor saves it: the wire's comma string.
			fields: { content: "The hearth, rebuilt.", keys: "hearth, ember" }
		},
		{
			lorebookId: bookId,
			entryId: entry.hearth,
			branchId: branch.A,
			year: 6,
			fields: { content: "A's hearth." }
		}
	])
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("which rows a session's lore read sees (#135, #143, #153)", () => {
	it(
		"main sees shared rows only; a fork sees its own and its parents', never a sibling's",
		async () => {
			const shared = ["Dark Room", "Echo", "Hearth", "Shelf"]
			expect(names(await lore(session.main))).toEqual(shared)
			expect(names(await lore(session.A))).toEqual([...shared, "Aerie"].sort())
			expect(names(await lore(session.B))).toEqual([...shared, "Bastion"].sort())
			// C is a fork of B: B's own row reads through (ruling 5).
			expect(names(await lore(session.C))).toEqual([...shared, "Bastion", "Cairn"].sort())
		},
		60_000
	)

	it(
		"a session on a line that is deleted reads main — its line's rows go with it (#141)",
		async () => {
			const [gone] = await db
				.insert(schema.lorebookBranches)
				.values({ lorebookId: bookId, name: "Doomed" })
				.returning()
			const doomedEntry = await addEntry("Doomed Keep", { branchId: gone!.id })
			const [s] = await db
				.insert(schema.sessions)
				.values({ userId: (await db.select().from(schema.users).limit(1))[0]!.id, isGroup: false, lorebookId: bookId, lorebookBranchId: gone!.id } as any)
				.returning()
			expect(names(await lore(s!.id))).toContain("Doomed Keep")

			await db.delete(schema.lorebookBranches).where(eq(schema.lorebookBranches.id, gone!.id))
			const after = await lore(s!.id)
			expect(after.some((r) => r.id === doomedEntry)).toBe(false)
			expect(names(after)).toEqual(names(await lore(session.main)))
		},
		60_000
	)

	it(
		"keeps disabled and archived rows on the scan's read, and drops them on the listing's",
		async () => {
			const all = names(await lore(session.main))
			expect(all).toContain("Shelf")
			expect(all).toContain("Dark Room")
			const live = names(await lore(session.main, { enabled: true, archived: false }))
			expect(live).not.toContain("Shelf")
			expect(live).not.toContain("Dark Room")
		},
		60_000
	)
})

describe("what the rows say: amendments at the session's reading (#144, ruling 3)", () => {
	const hearthOf = (rows: any[]) => rows.find((r) => r.id === entry.hearth)

	it(
		"at the head of main every dated main amendment applies — content and keys",
		async () => {
			const hearth = hearthOf(await lore(session.main))
			expect(hearth.content).toBe("The hearth, rebuilt.")
			const found = keywordQuery({
				entries: await lore(session.main),
				messages: [{ id: 1, content: "Sparks: an ember in the grate." }],
				retrieval: withDefaults({}).retrieval,
				countTokens: (t: string) => t.length
			})
			expect(found.candidates.map((c) => c.id)).toContain(entry.hearth)
		},
		60_000
	)

	it(
		"a fork reads its own amendment over main's; a fork cut before main's does not see main's",
		async () => {
			expect(hearthOf(await lore(session.A)).content).toBe("A's hearth.")
			// B forked at Y5: main's Y4 amendment happened before the fork.
			expect(hearthOf(await lore(session.B)).content).toBe("The hearth, rebuilt.")
		},
		60_000
	)

	it(
		"at a story clock only what has happened by then: no Y4 amendment and no Y10 history at Y3",
		async () => {
			const rows = await lore(session.clock)
			expect(hearthOf(rows).content).toBe("About Hearth.")
			expect(rows.some((r) => r.id === entry.flood)).toBe(false)
			// …while the head of main has both.
			expect((await lore(session.main)).some((r) => r.id === entry.flood)).toBe(true)
		},
		60_000
	)
})

describe("keys arrive as the stored list (#146)", () => {
	it(
		"a regex with a {m,n} quantifier is one key, and it matches",
		async () => {
			const rows = await lore(session.main)
			const echo = rows.find((r) => r.id === entry.regex)
			expect(echo.keys).toEqual(["(ab){1,2}c"])
			const found = keywordQuery({
				entries: rows,
				messages: [{ id: 1, content: "It answered: ababc." }],
				retrieval: withDefaults({}).retrieval,
				countTokens: (t: string) => t.length
			})
			expect(found.candidates.map((c) => c.id)).toContain(entry.regex)
		},
		60_000
	)
})

describe("a pipeline's lore writes land on the session's line (#0, #141)", () => {
	it(
		"an entry and its link written from a fork are the fork's, and main does not read them",
		async () => {
			const h = await host(session.A)
			const res = (await h.commit!(
				{ name: "Watchtower", content: "A tower on A's ridge.", links: ["Aerie"] },
				SAVE as any
			)) as { id: number; linkIds: number[] }
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, res.id))
			expect(row!.branchId).toBe(branch.A)
			const [link] = await db
				.select()
				.from(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.id, res.linkIds[0]!))
			expect(link!.branchId).toBe(branch.A)

			const onMain = await db
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(onLineSql(schema.lorebookEntries.branchId, MAIN_LINE))
			expect(onMain.map((r) => r.id)).not.toContain(res.id)
			expect(names(await lore(session.main))).not.toContain("Watchtower")
			expect(names(await lore(session.A))).toContain("Watchtower")
		},
		60_000
	)

	it(
		"a link outlet cannot name an entry on a line the session is not reading",
		async () => {
			const h = await host(session.main)
			await expect(
				h.commit!({ from: "Hearth", to: entry.aerie }, LINK as any)
			).rejects.toThrow(/not in this session's lorebook/)
		},
		60_000
	)
})

describe("the link hop's edges (#151)", () => {
	it(
		"only standing, non-secret edges on the session's line with live same-book ends",
		async () => {
			const { readGraphEntryLinks } = await import("$lib/server/utils/graphEntryLinks")
			const edge = async (values: Record<string, unknown>) =>
				(
					await db
						.insert(schema.narrativeRelationships)
						.values({ lorebookId: bookId, relationshipType: "leads to", ...values } as any)
						.returning({ id: schema.narrativeRelationships.id })
				)[0]!.id
			const kept = await edge({ fromEntryId: entry.hearth, toEntryId: entry.regex })
			const onA = await edge({ fromEntryId: entry.hearth, toEntryId: entry.aerie, branchId: branch.A })
			// Named, so each is a way of its own: one way on one line at one
			// date is one row (places-graph B1's `entry_pair_uq`).
			const ended = await edge({
				fromEntryId: entry.hearth,
				toEntryId: entry.regex,
				title: "the old stair",
				status: "resolved"
			})
			const secret = await edge({
				fromEntryId: entry.hearth,
				toEntryId: entry.regex,
				title: "the hidden stair",
				visibility: "secret"
			})
			const toShelf = await edge({ fromEntryId: entry.hearth, toEntryId: entry.shelved })
			const toOff = await edge({ fromEntryId: entry.hearth, toEntryId: entry.off })
			const toOtherBook = await edge({ fromEntryId: entry.hearth, toEntryId: entry.far })

			const main = ((await readGraphEntryLinks(db as any, session.main)) ?? []).map((l) => l.id)
			expect(main).toContain(kept)
			for (const id of [onA, ended, secret, toShelf, toOff, toOtherBook]) expect(main).not.toContain(id)

			const a = ((await readGraphEntryLinks(db as any, session.A)) ?? []).map((l) => l.id)
			expect(a).toContain(onA)
			// The far end is named as the reading sees it.
			const named = (await readGraphEntryLinks(db as any, session.main))!.find((l) => l.id === kept)!
			expect(named.from.name).toBe("Hearth")
		},
		60_000
	)
})

describe("the cast graph's ties are the session's line's (#0, #143)", () => {
	it(
		"a tie drawn on a fork reaches that fork's prompt and never main's",
		async () => {
			const { buildGraphRelationshipRows } = await import("$lib/server/utils/graphContextFormatter")
			const userId = (await db.select().from(schema.users).limit(1))[0]!.id
			const [vell, orin] = await db
				.insert(schema.characters)
				.values([
					{ userId, name: "Vell", description: "…" },
					{ userId, name: "Orin", description: "…" }
				])
				.returning()
			const [vellNode, orinNode] = await db
				.insert(schema.lorebookBindings)
				.values([
					{ lorebookId: bookId, characterId: vell!.id, binding: "{{char:7}}", name: "Vell" },
					{ lorebookId: bookId, characterId: orin!.id, binding: "{{char:8}}", name: "Orin" }
				])
				.returning()
			const tie = async (relationshipType: string, branchId: number | null) =>
				(
					await db
						.insert(schema.narrativeRelationships)
						.values({
							lorebookId: bookId,
							fromNodeId: vellNode!.id,
							toNodeId: orinNode!.id,
							relationshipType,
							branchId
						} as any)
						.returning({ id: schema.narrativeRelationships.id })
				)[0]!.id
			const shared = await tie("ally", null)
			const forked = await tie("rival", branch.A)

			const rows = async (sessionId: number) =>
				((await buildGraphRelationshipRows({
					sessionId,
					lorebookId: bookId,
					speakerCharacterId: vell!.id,
					db: db as any
				})) ?? []).map((r) => r.id)
			expect(await rows(session.main)).toEqual([shared])
			expect((await rows(session.A)).sort()).toEqual([shared, forked].sort())
			expect(await rows(session.B)).toEqual([shared])
		},
		60_000
	)
})
