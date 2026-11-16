/**
 * 🚧 **The edit history of a card version and a cast version** (owner,
 * 2026-11-13/14): the funnels in `versions.ts` record when given an author,
 * never otherwise; a new version starts empty; a retire-and-copy edit hands the
 * rows to the copy; Back takes a version's rows with it and Forward brings the
 * version back with none.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { _clearAttributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { profileOf } from "$lib/shared/characters/profile"
import { genreKeeping } from "$lib/server/utils/testGenre"
import {
	clearRedlines,
	countRedlines,
	REDLINES_KEPT,
	type RedlineAuthor
} from "$lib/server/lorebooks/redlines"
import {
	insertCard,
	insertCastMember,
	newCardVersion,
	restoreVersions,
	retireOrTakeVersions,
	updateCardVersion,
	updateCastVersion,
	writeCastVersion,
	type CastVersionChanges,
	type VersionRedline
} from "./versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-versions-redlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const GENRE = "test:genre/versions-redlines"
const R = schema.loreRedlines
let n = 0
const db = () => testDb as unknown as Db
const tx = <T>(fn: (h: Db) => Promise<T>) =>
	testDb.transaction((h) => fn(h as unknown as Db))

const person = (userId: number): VersionRedline => ({
	by: { userId },
	cause: "save"
})

async function world() {
	_clearAttributeSlots()
	genreKeeping(GENRE, {
		name: { en: "Versions redlines" },
		family: "test",
		slots: [],
		events: {}
	})
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `vr-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` })
		.returning()
	const { card, version: cardVersion } = await insertCard(db(), {
		userId: user.id,
		name: `Card ${suffix}`,
		description: "The card's description."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	return { user, book: book!, card, cardVersion, member, base: base! }
}
type World = Awaited<ReturnType<typeof world>>

async function newSession(
	userId: number,
	extra: Partial<typeof schema.sessions.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			genreId: GENRE,
			...extra
		})
		.returning()
	return row!
}

async function message(sessionId: number): Promise<number> {
	const [row] = await testDb
		.insert(schema.messages)
		.values({ sessionId, role: "assistant", content: "…" } as any)
		.returning({ id: schema.messages.id })
	return row!.id
}

const rowsOf = (characterVersionId: number) =>
	testDb
		.select()
		.from(R)
		.where(eq(R.characterVersionId, characterVersionId))
		.orderBy(R.id)

const storyWrite = (
	w: World,
	sessionId: number,
	changes: CastVersionChanges,
	redline?: VersionRedline
) =>
	tx((h) =>
		writeCastVersion(h, {
			member: w.member.id,
			changes,
			writtenBy: `run:${sessionId}`,
			session: { id: sessionId },
			redline
		})
	)

const authorWrite = (
	w: World,
	changes: CastVersionChanges,
	redline?: VersionRedline,
	date: { year: number } | null = null
) =>
	tx((h) =>
		writeCastVersion(h, {
			member: w.member.id,
			changes,
			writtenBy: "user:1",
			at: { branchId: null, date, personalPosition: null },
			redline
		})
	)

describe("a card version", () => {
	test("a save with an author records one row: before and after per key, the cause and the person", async () => {
		const w = await world()
		await tx((h) =>
			updateCardVersion(
				h,
				w.cardVersion.id,
				{ description: "Rewritten.", name: "Ada" },
				{ redline: person(w.user.id) }
			)
		)
		const rows = await rowsOf(w.cardVersion.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			entryId: null,
			amendmentId: null,
			cause: "save",
			userId: w.user.id
		})
		expect(rows[0]!.changes.description).toEqual({
			before: { v: "The card's description." },
			after: { v: "Rewritten." }
		})
		expect(Object.keys(rows[0]!.changes).sort()).toEqual([
			"description",
			"name"
		])
	})

	test("a save that changes nothing, or has no author, records nothing", async () => {
		const w = await world()
		await tx((h) =>
			updateCardVersion(
				h,
				w.cardVersion.id,
				{ description: "The card's description." },
				{ redline: person(w.user.id) }
			)
		)
		await tx((h) =>
			updateCardVersion(h, w.cardVersion.id, {
				description: "No author."
			})
		)
		expect(await rowsOf(w.cardVersion.id)).toHaveLength(0)
	})

	test("a new version starts with no rows", async () => {
		const w = await world()
		await tx((h) =>
			updateCardVersion(
				h,
				w.cardVersion.id,
				{ description: "Edited." },
				{ redline: person(w.user.id) }
			)
		)
		const next = await tx((h) =>
			newCardVersion(h, w.card.id, {
				...profileOf(w.cardVersion),
				description: "Next"
			})
		)
		expect(await rowsOf(next.id)).toHaveLength(0)
		expect(await rowsOf(w.cardVersion.id)).toHaveLength(1)
	})

	test("a face change is recorded as that key; strokes, extensions, sprite set and label are not", async () => {
		const w = await world()
		const [file] = await testDb
			.insert(schema.files)
			.values({
				userId: w.user.id,
				kind: "image",
				hash: `vr-${++n}`
			} as any)
			.returning()
		await tx((h) =>
			updateCardVersion(
				h,
				w.cardVersion.id,
				{ faceMediaId: file!.id },
				{ redline: person(w.user.id) }
			)
		)
		const [face] = await rowsOf(w.cardVersion.id)
		expect(face!.changes).toEqual({
			faceMediaId: { before: { v: null }, after: { v: file!.id } }
		})

		const other = await world()
		await tx((h) =>
			updateCardVersion(
				h,
				other.cardVersion.id,
				{
					strokes: [],
					extensions: { a: 1 },
					spriteSet: "calm"
				},
				{ label: "Renamed", redline: person(other.user.id) }
			)
		)
		expect(await rowsOf(other.cardVersion.id)).toHaveLength(0)
	})
})

describe("a cast version", () => {
	test("an author write in place records; a follow is `{ follow: true }`; a new dated version records nothing", async () => {
		const w = await world()
		expect(w.base.follows).toContain("description")
		const set = await authorWrite(
			w,
			{ description: "Her own." },
			person(w.user.id)
		)
		expect(set.coalesced).toBe(true)
		const [own] = await rowsOf(w.base.id)
		expect(own!.changes.description).toEqual({
			before: { v: { follow: true } },
			after: { v: "Her own." }
		})

		await authorWrite(
			w,
			{ description: { follow: true } },
			person(w.user.id)
		)
		const rows = await rowsOf(w.base.id)
		expect(rows).toHaveLength(2)
		expect(rows[1]!.changes.description).toEqual({
			before: { v: "Her own." },
			after: { v: { follow: true } }
		})

		const dated = await authorWrite(
			w,
			{ personality: "Wry." },
			person(w.user.id),
			{ year: 5 }
		)
		expect(dated.coalesced).toBe(false)
		expect(await rowsOf(dated.version.id)).toHaveLength(0)
		expect(await rowsOf(w.base.id)).toHaveLength(2)
	})

	test("updateCastVersion in place records; a place-only edit and a call with no author do not", async () => {
		const w = await world()
		const dated = await authorWrite(w, { personality: "Wry." }, undefined, {
			year: 5
		})
		const id = dated.version.id
		await tx((h) =>
			updateCastVersion(h, id, { changes: { summary: "Short." } })
		)
		expect(await rowsOf(id)).toHaveLength(0)
		await tx((h) =>
			updateCastVersion(
				h,
				id,
				{ changes: { summary: "Shorter." } },
				{ redline: person(w.user.id) }
			)
		)
		await tx((h) =>
			updateCastVersion(
				h,
				id,
				{
					place: {
						branchId: null,
						date: { year: 6 },
						personalPosition: null
					}
				},
				{ redline: person(w.user.id) }
			)
		)
		const rows = await rowsOf(id)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.changes.summary).toEqual({
			before: { v: "Short." },
			after: { v: "Shorter." }
		})
	})

	test("a routine's coalesced story write records `routine` with its run; the first write records nothing", async () => {
		const w = await world()
		const session = await newSession(w.user.id, {
			lorebookId: w.book.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		const messageId = await message(session.id)
		const by: RedlineAuthor = {
			run: {
				sessionId: session.id,
				messageId,
				runId: "run-1",
				shownAs: "Lorekeeper"
			}
		}
		const redline: VersionRedline = { by, cause: "routine" }
		const first = await storyWrite(
			w,
			session.id,
			{ summary: "One." },
			redline
		)
		expect(first.coalesced).toBe(false)
		expect(await rowsOf(first.version.id)).toHaveLength(0)
		const second = await storyWrite(
			w,
			session.id,
			{ summary: "Two." },
			redline
		)
		expect(second.coalesced).toBe(true)
		const [row] = await rowsOf(second.version.id)
		expect(row).toMatchObject({
			cause: "routine",
			userId: null,
			sessionId: session.id,
			messageId,
			runId: "run-1",
			shownAs: "Lorekeeper"
		})
		expect(row!.changes.summary).toEqual({
			before: { v: "One." },
			after: { v: "Two." }
		})
	})

	test("an edit that retires a version a branch reads moves the rows to the copy and records there", async () => {
		const w = await world()
		const session = await newSession(w.user.id, {
			lorebookId: w.book.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		const turn = await message(session.id)
		const first = await storyWrite(w, session.id, {
			summary: "Before the fork."
		})
		await tx((h) =>
			updateCastVersion(
				h,
				first.version.id,
				{ changes: { personality: "Early." } },
				{ redline: person(w.user.id) }
			)
		)
		expect(await rowsOf(first.version.id)).toHaveLength(1)

		const branch = await newSession(w.user.id, {
			lorebookId: w.book.id,
			branchAncestry: [
				{ sessionId: session.id, mark: first.version.writeOrder }
			],
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		await testDb.insert(schema.sessionMessages).values({
			sessionId: branch.id,
			role: "assistant",
			content: "copied",
			originSessionId: session.id,
			originMessageId: turn
		} as any)

		const copy = await tx((h) =>
			updateCastVersion(
				h,
				first.version.id,
				{ changes: { scenario: "Later." } },
				{ redline: person(w.user.id) }
			)
		)
		expect(copy.id).not.toBe(first.version.id)
		expect(await rowsOf(first.version.id)).toHaveLength(0)
		const rows = await rowsOf(copy.id)
		expect(rows).toHaveLength(2)
		expect(Object.keys(rows[0]!.changes)).toEqual(["personality"])
		expect(Object.keys(rows[1]!.changes)).toEqual(["scenario"])
	})

	test("Back deletes the version and its rows; Forward brings it back with none", async () => {
		const w = await world()
		const session = await newSession(w.user.id, {
			lorebookId: w.book.id,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 1
		})
		await message(session.id)
		const written = await storyWrite(w, session.id, { summary: "One." })
		await tx((h) =>
			updateCastVersion(
				h,
				written.version.id,
				{ changes: { summary: "Two." } },
				{ redline: person(w.user.id) }
			)
		)
		expect(await rowsOf(written.version.id)).toHaveLength(1)
		const [live] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, written.version.id))
		const out = await tx((h) => retireOrTakeVersions(h, [live!]))
		expect(out.taken).toHaveLength(1)
		expect(await rowsOf(written.version.id)).toHaveLength(0)
		await tx((h) => restoreVersions(h, out.taken))
		const [back] = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, written.version.id))
		expect(back).toBeTruthy()
		expect(await rowsOf(written.version.id)).toHaveLength(0)
	})
})

describe("the limit and the scopes", () => {
	test("a version keeps 50 and the newest person's row, per version", async () => {
		const w = await world()
		const other = await world()
		const edit = (id: number, text: string, redline: VersionRedline) =>
			tx((h) =>
				updateCardVersion(h, id, { description: text }, { redline })
			)
		await edit(other.cardVersion.id, "Other.", person(other.user.id))
		await edit(w.cardVersion.id, "Person.", person(w.user.id))
		for (let i = 0; i < REDLINES_KEPT + 5; i++)
			await edit(w.cardVersion.id, `Run ${i}`, {
				by: { sessionId: 1 },
				cause: "apply"
			})
		const rows = await rowsOf(w.cardVersion.id)
		expect(rows).toHaveLength(REDLINES_KEPT + 1)
		expect(rows[0]!.userId).toBe(w.user.id)
		expect(await rowsOf(other.cardVersion.id)).toHaveLength(1)
	})

	test("clear and count follow the scope: a version's, and a book's entries and cast versions together, never a card version's", async () => {
		const w = await world()
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: "core:entry/world-lore",
				typeVersion: 1,
				position: 1
			} as any)
			.returning()
		await authorWrite(w, { description: "Own." }, person(w.user.id))
		await tx((h) =>
			updateCardVersion(
				h,
				w.cardVersion.id,
				{ description: "Card edit." },
				{ redline: person(w.user.id) }
			)
		)
		await testDb
			.insert(R)
			.values({ entryId: entry!.id, changes: {}, cause: "save" })
		const inBook = 2
		expect(await countRedlines(db(), { lorebookId: w.book.id })).toBe(
			inBook
		)
		expect(
			await countRedlines(db(), { characterVersionId: w.base.id })
		).toBe(1)
		expect(
			await clearRedlines(db(), { characterVersionId: w.base.id })
		).toBe(1)
		expect(await clearRedlines(db(), { lorebookId: w.book.id })).toBe(
			inBook - 1
		)
		expect(await rowsOf(w.cardVersion.id)).toHaveLength(1)
	})
})
