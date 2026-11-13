/**
 * The vocabulary claims a member's names by its **base shown name**, not by
 * `lorebook_bindings.name` (owner 2026-11-08, ★cp-names-1): a dated Main
 * rename is written back to that column for sort and search, and moves
 * nobody's claim on a name (R1 "hybrid", 2026-09-30).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

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
		path.join(os.tmpdir(), "serene-pub-vitest-base-name-vocab-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `base-name-vocab-${seq++}`
	const user = await createTestUser(testDb, label)
	const card = async (name: string) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "" })
				.returning()
		)[0]!
	const book = async () =>
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ userId: user.id, name: `${label}-${seq++}` })
				.returning()
		)[0]!
	let tag = 1
	const member = async (bookId: number, c: { id: number; name: string }) =>
		(
			await insertCastMember(db(), {
				lorebookId: bookId,
				binding: `{{char:${tag++}}}`,
				name: c.name,
				characterId: c.id
			})
		).member
	const rename = (memberId: number, name: string) =>
		testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: memberId,
				changes: { name },
				writtenBy: `user:${user.id}`,
				at: {
					branchId: null,
					date: { year: 10, month: null, day: null },
					personalPosition: null
				}
			})
		)
	const storedName = async (memberId: number) =>
		(
			await testDb
				.select({ name: schema.lorebookBindings.name })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, memberId))
		)[0]!.name
	return { card, book, member, rename, storedName }
}

describe("the vocabulary claims names by base name", () => {
	it("a carded member renamed by a dated Main version keeps its card's name and answers to the new one", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const book = await w.book()
		const vell = await w.card("Vell")
		const m = await w.member(book.id, vell)
		await w.rename(m.id, "Vellira")
		expect(await w.storedName(m.id)).toBe("Vellira")

		const { gazetteer } = await loadVocabulary(testDb as any, book.id)
		const ref = { kind: "character", id: vell.id }
		expect(gazetteer.byName.get("vell")).toEqual(ref)
		expect(gazetteer.byName.get("vellira")).toEqual(ref)
	})

	it("a member renamed onto another member's name does not take it", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const book = await w.book()
		const vell = await w.card("Vell")
		const rook = await w.card("Rook")
		const vellMember = await w.member(book.id, vell)
		await w.member(book.id, rook)
		await w.rename(vellMember.id, "Rook")
		expect(await w.storedName(vellMember.id)).toBe("Rook")

		const { gazetteer } = await loadVocabulary(testDb as any, book.id)
		expect(gazetteer.byName.get("rook")).toEqual({
			kind: "character",
			id: rook.id
		})
		expect(gazetteer.byName.get("vell")).toEqual({
			kind: "character",
			id: vell.id
		})
	})

	it("a book with no amendments hashes the same whatever its stored names say", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const w = await world()
		const vell = await w.card("Vell")
		const rook = await w.card("Rook")
		// Stored name = base name: what the hash was before the change.
		const plain = await w.book()
		await w.member(plain.id, vell)
		await w.member(plain.id, rook)
		// The same cast, a stored name that has drifted from the base name.
		const drifted = await w.book()
		const dv = await w.member(drifted.id, vell)
		await w.member(drifted.id, rook)
		await testDb
			.update(schema.lorebookBindings)
			.set({ name: "Somebody Else" })
			.where(eq(schema.lorebookBindings.id, dv.id))

		const a = await loadVocabulary(testDb as any, plain.id)
		const b = await loadVocabulary(testDb as any, drifted.id)
		expect(b.hash).toBe(a.hash)
		expect(b.gazetteer.byName.get("somebody else")).toBeUndefined()
	})
})
