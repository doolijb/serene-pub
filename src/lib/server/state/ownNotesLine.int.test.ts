/**
 * ★bk-fold-1 (owner 2026-11-08), the WRITE side: a session reading its own
 * notes alone on a line writes them on that line, so a write lands where the
 * session reads. A session on its notes' main, or beside an attached book,
 * writes exactly as before: main (branch null), dated only as it always was.
 * (sense-b4) Pins no write-through to a lorebook: every write here already lands in the own book, so the own-book rule for scenes that end by themselves changes nothing in this file.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

const T = 60_000
vi.setConfig({ testTimeout: T, hookTimeout: T })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-own-notes-line-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, T)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const SHUT = "test:slot/own-line-shut@1"
const GENRE = "test:genre/own-notes-line"
const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }
const READ_NODE = {
	key: "lore",
	definitionId: "core:query/lorebook-triggers@1",
	definitionVersion: 1,
	kind: "query"
}

function declareSlots() {
	_clearAttributeSlots()
	const shut = defineAttributeSlot(SHUT, {
		type: "boolean",
		descriptor: "Whether the shop is shut.",
		appliesTo: ["world"],
		scope: "world",
		default: false
	})
	genreKeeping(GENRE, {
		name: { en: "Own notes line" },
		family: "test",
		slots: [shut],
		events: {}
	})
}

let n = 0
let order = 0

interface Opts {
	clock?: { year: number } | null
	/** Beside an attached book (owned by the person), on a line of it. */
	attached?: boolean
	/** Stand on a line of the own book. */
	line?: boolean
}

/**
 * A session with its own book. Main holds history at Year 5 and Year 15 (the
 * second after the line's fork at Year 10); the line holds Year 12 and Year 18.
 */
async function setup(opts: Opts = {}) {
	declareSlots()
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `own-line-${suffix}`)
	let attachedId: number | null = null
	let attachedBranchId: number | null = null
	if (opts.attached) {
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `Shared ${suffix}` })
			.returning()
		attachedId = shared!.id
		const [b] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: attachedId,
				name: "Shared line",
				forkYear: 10
			})
			.returning()
		attachedBranchId = b!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			genreId: GENRE,
			lorebookId: attachedId,
			lorebookBranchId: attachedBranchId,
			storyClockYear:
				opts.clock === null ? null : (opts.clock?.year ?? 15)
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	const [lineRow] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: own.id, name: "Own line", forkYear: 10 })
		.returning()
	const line = lineRow!
	const mainFive = await history(own.id, "Main 5", 5)
	const mainFifteen = await history(own.id, "Main 15", 15)
	const lineTwelve = await history(own.id, "Line 12", 12, line.id)
	const lineEighteen = await history(own.id, "Line 18", 18, line.id)
	if (opts.line)
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: line.id })
			.where(eq(schema.sessions.id, session!.id))
	// A message to anchor the session's cast and durable writes to.
	const { insertLegacy } = await import("$lib/server/messages/store")
	await insertLegacy(db(), {
		sessionId: session!.id,
		role: "user",
		userId: user.id,
		content: "Hello."
	} as any)
	await insertLegacy(db(), {
		sessionId: session!.id,
		role: "assistant",
		userId: null,
		content: "Hi."
	} as any)
	return {
		user,
		session: session!,
		own,
		line,
		attachedId,
		mainFive,
		mainFifteen,
		lineTwelve,
		lineEighteen
	}
}
type Setup = Awaited<ReturnType<typeof setup>>

async function entry(
	bookId: number,
	title: string,
	extra: {
		typeId?: string
		fields?: Record<string, unknown>
		branchId?: number | null
	} = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: bookId,
			typeId: extra.typeId ?? HISTORY_TYPE_ID,
			typeVersion: 1,
			position: ++order,
			title,
			content: `${title}.`,
			fields: extra.fields ?? {},
			branchId: extra.branchId ?? null
		})
		.returning()
	return row!
}

const history = (
	bookId: number,
	title: string,
	year: number,
	branchId: number | null = null
) => entry(bookId, title, { fields: { year }, branchId })

/** A card-less cast member of `bookId` (its turn is the session's, so any open turn anchors its write). */
async function member(_s: Setup, bookId: number, name: string) {
	const { insertCastMember } = await import("$lib/server/characters/versions")
	return (
		await insertCastMember(db(), {
			lorebookId: bookId,
			binding: `{{char:${name}-${++n}}}`,
			characterId: null,
			name
		})
	).member
}

const writeVersion = async (s: Setup, memberId: number, name: string) => {
	const { writeCastVersion } = await import("$lib/server/characters/versions")
	return testDb.transaction((tx) =>
		writeCastVersion(tx as unknown as Db, {
			member: memberId,
			changes: { name },
			writtenBy: `run:${s.session.id}`,
			session: { id: s.session.id }
		})
	)
}

const readName = async (s: Setup, memberId: number) => {
	const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
	return (
		await membersAsRead(db(), [memberId], { sessionId: s.session.id })
	).get(memberId)?.name
}

const versionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, id))
	)[0]!

/** A session-layer world value, to be captured. */
async function sessionShut(s: Setup) {
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "session",
		ownerId: s.session.id,
		slotId: SHUT,
		value: { v: true },
		sessionId: s.session.id,
		updatedBy: "user"
	})
}

const durableRows = (bookId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, "lorebook"),
				eq(schema.attributeValues.ownerId, bookId)
			)
		)

const setMode = (userId: number, mode: "full" | "review" | "off" | null) =>
	testDb
		.insert(schema.userSettings)
		.values({ userId, loreWriteMode: mode })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { loreWriteMode: mode }
		})

const host = async (sessionId: number) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db() as any, { sessionId })
}

/** A place on the own book's main for the entry write's link to name. */
const aerie = (s: Setup) =>
	entry(s.own.id, "Aerie", { typeId: WORLD_LORE_TYPE_ID })

const writeLore = async (s: Setup, extra: Record<string, unknown> = {}) => {
	await aerie(s)
	const h = await host(s.session.id)
	return (await h.commit!(
		{ name: "Watchtower", content: "A tower.", links: ["Aerie"], ...extra },
		SAVE as any
	)) as {
		id: number
		route?: string
		linkIds: number[]
	}
}

const storedEntry = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const storedLink = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, id))
	)[0]!

describe("a session reading its own notes on a line writes them there", () => {
	test(
		"a cast version lands on the line, dated at the clock, and reads back",
		async () => {
			const s = await setup({ line: true })
			const maren = await member(s, s.own.id, "Maren")
			const { version } = await writeVersion(
				s,
				maren.id,
				"Maren on the line"
			)
			const row = await versionRow(version.id)
			expect(row.branchId).toBe(s.line.id)
			expect(row.year).toBe(15)
			expect(await readName(s, maren.id)).toBe("Maren on the line")
			const { castVersionsInForce } = await import(
				"$lib/server/cast/memberAsRead"
			)
			expect(
				(
					await castVersionsInForce(db(), [maren.id], {
						sessionId: s.session.id
					})
				).get(maren.id)?.version.id
			).toBe(version.id)
		},
		T
	)

	test(
		"with no clock a cast version is dated at the line's latest dated history",
		async () => {
			const s = await setup({ line: true, clock: null })
			const maren = await member(s, s.own.id, "Maren")
			const { version } = await writeVersion(
				s,
				maren.id,
				"Maren at the line's end"
			)
			const row = await versionRow(version.id)
			expect(row.branchId).toBe(s.line.id)
			expect(row.year).toBe(18)
			expect(await readName(s, maren.id)).toBe("Maren at the line's end")
		},
		T
	)

	test(
		"a durable capture lands on the line with the line's dating, and the session reads it back",
		async () => {
			const s = await setup({ line: true })
			await sessionShut(s)
			const { recordToTimeline } = await import(
				"$lib/server/state/durable"
			)
			const report = await recordToTimeline(db(), s.session.id, {
				reason: "mark"
			})
			expect(report).toMatchObject({
				recorded: true,
				route: "own-book",
				lorebookId: s.own.id
			})
			const rows = await durableRows(s.own.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]!.branchId).toBe(s.line.id)
			// Clock Year 15: the line's Year 12, never main's Year 15 (after the fork).
			expect(rows[0]!.historyEntryId).toBe(s.lineTwelve.id)
			// Only the durable row can answer now.
			await testDb
				.delete(schema.attributeValues)
				.where(eq(schema.attributeValues.sessionId, s.session.id))
			const { valueOf } = await import("$lib/server/state/resolve")
			expect(
				await valueOf(db(), {
					sessionId: s.session.id,
					owner: { kind: "session", id: s.session.id },
					slotId: SHUT
				})
			).toBe(true)
		},
		T
	)

	test(
		"a host lore write lands on the line with its history entry, and the session reads it back",
		async () => {
			const s = await setup({ line: true })
			const wrote = await writeLore(s)
			expect(wrote.route).toBe("own-book")
			expect((await storedEntry(wrote.id)).branchId).toBe(s.line.id)
			const link = await storedLink(wrote.linkIds[0]!)
			expect(link.branchId).toBe(s.line.id)
			expect(link.historyEntryId).toBe(s.lineTwelve.id)
			const { sessionEntriesAsRead } = await import(
				"$lib/server/lorebooks/ownBook"
			)
			const names = (
				await sessionEntriesAsRead(db(), s.session.id, "session", null)
			)
				.filter((e) => !e.unseen)
				.map((e) => e.name)
			expect(names).toContain("Watchtower")
		},
		T
	)
})

describe("a session on its notes' main writes exactly as before", () => {
	test(
		"a cast version is on main, dated only by the session clock",
		async () => {
			const s = await setup()
			const maren = await member(s, s.own.id, "Maren")
			const { version } = await writeVersion(s, maren.id, "Maren on main")
			const row = await versionRow(version.id)
			expect(row.branchId).toBeNull()
			expect(row.year).toBe(15)
			expect(await readName(s, maren.id)).toBe("Maren on main")
		},
		T
	)

	test(
		"with no clock a cast version on main is undated",
		async () => {
			const s = await setup({ clock: null })
			const maren = await member(s, s.own.id, "Maren")
			const { version } = await writeVersion(s, maren.id, "Maren on main")
			const row = await versionRow(version.id)
			expect(row.branchId).toBeNull()
			expect(row.year).toBeNull()
		},
		T
	)

	test(
		"a capture is on main and undated",
		async () => {
			const s = await setup()
			await sessionShut(s)
			const { recordToTimeline } = await import(
				"$lib/server/state/durable"
			)
			const report = await recordToTimeline(db(), s.session.id, {
				reason: "mark"
			})
			expect(report).toMatchObject({
				recorded: true,
				route: "own-book",
				historyEntryId: null
			})
			const rows = await durableRows(s.own.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]!.branchId).toBeNull()
			expect(rows[0]!.historyEntryId).toBeNull()
		},
		T
	)

	test(
		"a host lore write is on main and undated",
		async () => {
			const s = await setup()
			const wrote = await writeLore(s)
			expect((await storedEntry(wrote.id)).branchId).toBeNull()
			const link = await storedLink(wrote.linkIds[0]!)
			expect(link.branchId).toBeNull()
			expect(link.historyEntryId).toBeNull()
		},
		T
	)

	test(
		"a stale line reads main, and writes there",
		async () => {
			const s = await setup({ line: true })
			const [other] = await testDb
				.insert(schema.lorebooks)
				.values({ userId: s.user.id, name: "Other" })
				.returning()
			const [elsewhere] = await testDb
				.insert(schema.lorebookBranches)
				.values({
					lorebookId: other!.id,
					name: "Elsewhere",
					forkYear: 1
				})
				.returning()
			await testDb
				.update(schema.sessions)
				.set({ lorebookBranchId: elsewhere!.id })
				.where(eq(schema.sessions.id, s.session.id))
			const wrote = await writeLore(s)
			expect((await storedEntry(wrote.id)).branchId).toBeNull()
			expect(
				(await storedLink(wrote.linkIds[0]!)).historyEntryId
			).toBeNull()
		},
		T
	)
})

describe("a session with an attached book writing its notes is unchanged", () => {
	test(
		"a host lore write to the notes is on main and undated",
		async () => {
			const s = await setup({ attached: true })
			const wrote = await writeLore(s, { toNotes: true })
			expect(wrote.route).toBe("own-book")
			expect((await storedEntry(wrote.id)).branchId).toBeNull()
			const link = await storedLink(wrote.linkIds[0]!)
			expect(link.branchId).toBeNull()
			expect(link.historyEntryId).toBeNull()
		},
		T
	)

	test(
		"a capture into the notes (Review changes) is on main and undated",
		async () => {
			const s = await setup({ attached: true })
			await setMode(s.user.id, "review")
			await sessionShut(s)
			const { recordToTimeline } = await import(
				"$lib/server/state/durable"
			)
			const report = await recordToTimeline(db(), s.session.id, {
				reason: "mark"
			})
			expect(report).toMatchObject({
				recorded: true,
				route: "own-book",
				historyEntryId: null
			})
			const rows = await durableRows(s.own.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]!.branchId).toBeNull()
			expect(rows[0]!.historyEntryId).toBeNull()
		},
		T
	)

	test(
		"a cast version for the notes' overlay of an attached member is on main",
		async () => {
			const s = await setup({ attached: true })
			await setMode(s.user.id, "review")
			const maren = await member(s, s.attachedId!, "Maren")
			const { version } = await writeVersion(
				s,
				maren.id,
				"Maren in the notes"
			)
			const row = await versionRow(version.id)
			expect(row.lorebookId).toBe(s.own.id)
			expect(row.branchId).toBeNull()
		},
		T
	)
})

describe("pipeline reads of the own notes stand at the session's reading", () => {
	test(
		"lorebook_entries reads the notes on the line, at the clock",
		async () => {
			const s = await setup({ line: true })
			const h = await host(s.session.id)
			const rows = (await h.read!(
				"lorebook_entries",
				{ sessionId: s.session.id, currentCharacterId: null },
				READ_NODE as any
			)) as any[]
			const said = rows.map((r) => r.content)
			// Clock Year 15 on the line: main's Year 5 and the line's Year 12 only.
			expect(said).toContain("Main 5.")
			expect(said).toContain("Line 12.")
			expect(said).not.toContain("Line 18.")
			expect(said).not.toContain("Main 15.")
		},
		T
	)

	test(
		"on main the notes still read at their head",
		async () => {
			const s = await setup({ clock: null })
			const h = await host(s.session.id)
			const rows = (await h.read!(
				"lorebook_entries",
				{ sessionId: s.session.id, currentCharacterId: null },
				READ_NODE as any
			)) as any[]
			const said = rows.map((r) => r.content)
			expect(said).toContain("Main 5.")
			expect(said).toContain("Main 15.")
			expect(said).not.toContain("Line 12.")
		},
		T
	)

	test(
		"lorebook_state defaults to the session's line and its clock",
		async () => {
			const s = await setup({ line: true })
			// A value dated after the clock on the line, and one before it.
			for (const [entryRow, v] of [
				[s.lineTwelve, false],
				[s.lineEighteen, true]
			] as const)
				await testDb.insert(schema.attributeValues).values({
					ownerKind: "lorebook",
					ownerId: s.own.id,
					slotId: SHUT,
					value: { v },
					branchId: s.line.id,
					historyEntryId: entryRow.id,
					validFromMessageId: null
				})
			const h = await host(s.session.id)
			const out: any = await h.read!(
				"lorebook_state",
				{ sessionId: s.session.id, owner: "world" },
				{
					...READ_NODE,
					definitionId: "core:query/lorebook-state@1"
				} as any
			)
			expect(JSON.stringify(out)).toContain(SHUT)
			expect(JSON.stringify(out)).not.toContain('"v":true')
		},
		T
	)
})
