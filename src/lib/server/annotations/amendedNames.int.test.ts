/**
 * The book's vocabulary knows amended names (plan C1, owner ruling R1
 * "hybrid", 2026-09-30).
 *
 * A cast version that renames a member, or an entry amendment that retitles
 * an entry, gives them a name the stored row does not carry. The gazetteer
 * read only the stored names, so a renamed member's new name was nobody's:
 * mentions of it resolved to no one, and the cast suggestions offered it as a
 * NEW member (plan A23(a)'s leftover). One vocabulary per book, so the names
 * are a union across lines and dates, stored names first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import {
	insertCastMember,
	writeCastVersion,
	type CastVersionChanges
} from "$lib/server/characters/versions"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-amended-names-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `amended-names-${seq++}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: label })
		.returning()
	const member = async (n: number, name: string) => {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "" })
			.returning()
		const { member: row } = await insertCastMember(testDb as unknown as Db, {
			lorebookId: book!.id,
			binding: `{{char:${n}}}`,
			name,
			characterId: card!.id
		})
		return { card: card!, member: row }
	}
	/** A dated cast version of the member, written by the book's owner. */
	const rename = async (
		memberId: number,
		year: number,
		changes: CastVersionChanges
	) => {
		await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: memberId,
				changes,
				writtenBy: `user:${user.id}`,
				at: {
					branchId: null,
					date: { year, month: null, day: null },
					personalPosition: null
				}
			})
		)
	}
	const entry = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(worldLoreValues([{ lorebookId: book!.id, name, content: "" }]))
				.returning()
		)[0]!
	return { book: book!, member, entry, rename }
}

describe("the book's vocabulary reads amended names (C1)", () => {
	it(
		"a renamed member answers to the new name and the old; a retitled entry too",
		async () => {
			const { loadVocabulary } = await import("$lib/server/annotations")
			const { book, member, entry, rename } = await makeBook()
			const vell = await member(1, "Vell")
			const keep = await entry("Old Keep")
			await rename(vell.member.id, 10, {
				name: "Vellira",
				aliases: ["The Grey Hand"]
			})
			await testDb.insert(schema.entryAmendments).values({
				lorebookId: book.id,
				entryId: keep.id,
				year: 10,
				fields: { name: "Sunken Keep" }
			})

			const { gazetteer } = await loadVocabulary(testDb as any, book.id)
			const ref = (name: string) => gazetteer.byName.get(name)
			expect(ref("vell")).toEqual({ kind: "character", id: vell.card.id })
			expect(ref("vellira")).toEqual({ kind: "character", id: vell.card.id })
			expect(ref("the grey hand")).toEqual({
				kind: "character",
				id: vell.card.id
			})
			expect(ref("old keep")).toEqual({ kind: "entry", id: keep.id })
			expect(ref("sunken keep")).toEqual({ kind: "entry", id: keep.id })
		},
		60_000
	)

	it(
		"an amended name never takes a name another member already holds",
		async () => {
			const { loadVocabulary } = await import("$lib/server/annotations")
			const { book, member, rename } = await makeBook()
			const vell = await member(1, "Vell")
			const rook = await member(2, "Rook")
			// Vell is called Rook on some line: the stored Rook keeps it.
			await rename(vell.member.id, 5, { name: "Rook" })
			const { gazetteer } = await loadVocabulary(testDb as any, book.id)
			expect(gazetteer.byName.get("rook")).toEqual({
				kind: "character",
				id: rook.card.id
			})
		},
		60_000
	)

	it(
		"moves the vocabulary's hash, so stored annotations re-read",
		async () => {
			const { loadVocabulary } = await import("$lib/server/annotations")
			const { book, member, rename } = await makeBook()
			const vell = await member(1, "Vell")
			const before = (await loadVocabulary(testDb as any, book.id)).hash
			await rename(vell.member.id, 10, { name: "Vellira" })
			expect((await loadVocabulary(testDb as any, book.id)).hash).not.toBe(
				before
			)
		},
		60_000
	)

	it(
		"a cast suggestion cannot add a member under a name a cast version gave another",
		async () => {
			const { takenNames } = await import("$lib/server/bindingSuggestions")
			const { book, member, rename } = await makeBook()
			const vell = await member(1, "Vell")
			await rename(vell.member.id, 10, { name: "Vellira" })
			const taken = await takenNames(testDb as any, book.id)
			expect(taken.has("vell")).toBe(true)
			expect(taken.has("vellira")).toBe(true)
		},
		60_000
	)
})
