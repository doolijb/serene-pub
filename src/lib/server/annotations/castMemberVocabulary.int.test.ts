/**
 * A cast member with no live card is recognised as itself (`cast_member:<id>`).
 *
 * Owner ruling 2026-11-06, ★9 2026-11-08: the entity key alone carries it, no
 * column and no migration. A carded member stays its card, a member with no
 * name contributes nothing, and the vocabulary hash moves on link and unlink
 * by itself.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import {
	insertCastMember,
	writeCastVersion
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
		path.join(os.tmpdir(), "serene-pub-vitest-cast-member-vocabulary-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeBook() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `cast-member-vocabulary-${seq++}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: label })
		.returning()
	const card = async (name: string, isDeleted = false) =>
		(
			await testDb
				.insert(schema.characters)
				.values({ userId: user.id, name, description: "", isDeleted })
				.returning()
		)[0]!
	const member = async (
		n: number,
		name: string,
		characterId: number | null,
		aliases: string[] = []
	) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book!.id,
					binding: `{{char:${n}}}`,
					name,
					aliases,
					characterId
				})
				.returning()
		)[0]!
	const entry = async (name: string, content: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					worldLoreValues([{ lorebookId: book!.id, name, content }])
				)
				.returning()
		)[0]!
	return { user, book: book!, card, member, entry }
}

const load = async (lorebookId: number) => {
	const { loadVocabulary } = await import("./index")
	return await loadVocabulary(testDb as any, lorebookId)
}
const refOf = (v: Awaited<ReturnType<typeof load>>, name: string) =>
	v.gazetteer.byName.get(name)

describe("a card-less cast member in the vocabulary", () => {
	it("is cast_member:<id>, by its name and an alias", async () => {
		const { book, member } = await makeBook()
		const ferry = await member(1, "Ferryman", null, ["Old Tom"])
		const v = await load(book.id)
		expect(refOf(v, "ferryman")).toEqual({
			kind: "cast_member",
			id: ferry.id
		})
		expect(refOf(v, "old tom")).toEqual({
			kind: "cast_member",
			id: ferry.id
		})
		expect(v.castTags.get(1)).toEqual({ kind: "cast_member", id: ferry.id })
	}, 60_000)

	it("is cast_member:<id>, never the card, once its card is soft-deleted", async () => {
		const { book, card, member } = await makeBook()
		const gone = await card("Maren", true)
		const m = await member(1, "Maren", gone.id)
		const v = await load(book.id)
		expect(refOf(v, "maren")).toEqual({ kind: "cast_member", id: m.id })
		expect(
			[...v.gazetteer.byName.values()].some((r) => r.kind === "character")
		).toBe(false)
	}, 60_000)

	it("leaves a carded member as its card", async () => {
		const { book, card, member } = await makeBook()
		const vell = await card("Vellamy")
		await member(1, "Vellamy", vell.id)
		const v = await load(book.id)
		expect(refOf(v, "vellamy")).toEqual({ kind: "character", id: vell.id })
		expect(v.castTags.get(1)).toEqual({ kind: "character", id: vell.id })
	}, 60_000)

	it("contributes nothing when it has no name and no card", async () => {
		const { book, member } = await makeBook()
		await member(1, "", null)
		const v = await load(book.id)
		expect(v.gazetteer.byName.size).toBe(0)
		expect(v.castTags.size).toBe(0)
	}, 60_000)

	it("never takes a name a carded member holds", async () => {
		const { book, card, member } = await makeBook()
		// The card-less member comes first by id, so only precedence can decide.
		await member(1, "Guard", null)
		const guard = await card("Guard")
		await member(2, "Guard", guard.id)
		const v = await load(book.id)
		expect(refOf(v, "guard")).toEqual({ kind: "character", id: guard.id })
	}, 60_000)

	it("answers to a name a cast version gave it", async () => {
		const { user, book, member } = await makeBook()
		const { member: row } = await insertCastMember(testDb as any, {
			lorebookId: book.id,
			binding: "{{char:1}}",
			name: "Ferryman",
			characterId: null
		})
		await testDb.transaction((tx) =>
			writeCastVersion(tx as any, {
				member: row.id,
				changes: { name: "Charon" },
				writtenBy: `user:${user.id}`,
				at: {
					branchId: null,
					date: { year: 10, month: null, day: null },
					personalPosition: null
				}
			})
		)
		const v = await load(book.id)
		expect(refOf(v, "charon")).toEqual({ kind: "cast_member", id: row.id })
	}, 60_000)
})

describe("the vocabulary hash", () => {
	it("moves on link and on unlink", async () => {
		const { book, card, member } = await makeBook()
		const row = await member(1, "Ferryman", null)
		const live = await card("Ferryman")
		const unlinked = (await load(book.id)).hash
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: live.id })
			.where(eq(schema.lorebookBindings.id, row.id))
		const linked = (await load(book.id)).hash
		expect(linked).not.toBe(unlinked)
		await testDb
			.update(schema.lorebookBindings)
			.set({ characterId: null })
			.where(eq(schema.lorebookBindings.id, row.id))
		const again = (await load(book.id)).hash
		expect(again).not.toBe(linked)
		expect(again).toBe(unlinked)
	}, 60_000)
})

describe("an entry that names a card-less member", () => {
	it("reads back cast_member:<id> by name and by tag", async () => {
		const { book, member, entry } = await makeBook()
		const ferry = await member(1, "Ferryman", null)
		const byName = await entry("Quay", "The Ferryman waits at the quay.")
		const byTag = await entry("Dock", "{{char:1}} ties the boat.")
		const { annotateLorebook, readEntryAnnotations } = await import(
			"./index"
		)
		await annotateLorebook(testDb as any, book.id)
		const index = await readEntryAnnotations(
			testDb as any,
			[byName.id, byTag.id],
			await load(book.id)
		)
		expect(index.get(byName.id)).toContain(`cast_member:${ferry.id}`)
		expect(index.get(byTag.id)).toContain(`cast_member:${ferry.id}`)
	}, 60_000)
})
