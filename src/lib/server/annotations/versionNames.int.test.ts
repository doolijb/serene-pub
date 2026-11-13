/**
 * The book's vocabulary reads the cast members' names from their cast
 * versions (plan §32 §8): a name or alias a version holds of its own, on any
 * line at any date. A field a version follows is the card's, already in the
 * vocabulary; a card-less member answers as itself (`cast_member:<id>`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	insertCharacterVersions,
	insertCastMember,
	writeCastVersion,
	type CastVersionChanges
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
		path.join(os.tmpdir(), "serene-pub-vitest-version-names-")
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
	const label = `version-names-${seq++}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: label })
		.returning()
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: "North road", forkYear: 1 })
		.returning()
	let n = 0
	const member = async (name: string, withCard = true) => {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "" })
			.returning()
		const { member: row } = await insertCastMember(db(), {
			lorebookId: book!.id,
			binding: `{{char:${++n}}}`,
			name,
			characterId: withCard ? card!.id : null
		})
		return { card: card!, member: row }
	}
	const write = async (
		memberId: number,
		changes: CastVersionChanges,
		at: { branchId?: number | null; year: number; position?: number | null }
	) => {
		await testDb.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: memberId,
				changes,
				writtenBy: `user:${user.id}`,
				at: {
					branchId: at.branchId ?? null,
					date: { year: at.year, month: null, day: null },
					personalPosition: at.position ?? null
				}
			})
		)
	}
	return { book: book!, line: line!, member, write }
}

describe("amendedNamesOf and loadVocabulary read cast versions", () => {
	it("a member renamed on a line answers to both names, wherever they were written", async () => {
		const { loadVocabulary, amendedNamesOf } = await import(
			"$lib/server/annotations"
		)
		const { book, line, member, write } = await world()
		const vell = await member("Vell")
		await write(
			vell.member.id,
			{ name: "Vellira" },
			{ branchId: line.id, year: 4 }
		)
		await write(
			vell.member.id,
			{ aliases: ["  The Grey Hand ", "", "Vell the Pale"] },
			{ year: 9, position: 2 }
		)

		const names = await amendedNamesOf(db(), book.id)
		const own = names.cast.get(vell.member.id)!
		expect(own).toContain("Vellira")
		expect(own).toContain("The Grey Hand")
		expect(own).toContain("Vell the Pale")
		expect(own).not.toContain("")

		const { gazetteer } = await loadVocabulary(db(), book.id)
		const ref = { kind: "character", id: vell.card.id }
		expect(gazetteer.byName.get("vell")).toEqual(ref)
		expect(gazetteer.byName.get("vellira")).toEqual(ref)
		expect(gazetteer.byName.get("the grey hand")).toEqual(ref)
	})

	it("is ordered by write order, then id, and each name once", async () => {
		const { amendedNamesOf } = await import("$lib/server/annotations")
		const { book, member } = await world()
		const vell = await member("Vell")
		const base = {
			castMemberId: vell.member.id,
			lorebookId: book.id,
			nodeState: "active" as const,
			nodeVisibility: "normal" as const
		}
		// Ids ascend in the array; the write orders say the last one was
		// written first.
		await insertCharacterVersions(db(), [
			{ ...base, year: 3, name: "Second", writeOrder: 9_000_001 },
			{ ...base, year: 4, name: "First", writeOrder: 9_000_000 },
			{ ...base, year: 5, name: "Second", writeOrder: 9_000_002 }
		])
		const own = (await amendedNamesOf(db(), book.id)).cast.get(
			vell.member.id
		)!
		expect(own.filter((x) => x === "First" || x === "Second")).toEqual([
			"First",
			"Second"
		])
		expect(own.filter((x) => x === "Second")).toHaveLength(1)
	})

	it("a name a version follows is the card's, and adds nothing of its own", async () => {
		const { amendedNamesOf } = await import("$lib/server/annotations")
		const { book, member } = await world()
		const vell = await member("Vell")
		const [base] = await (async () => {
			const { eq } = await import("drizzle-orm")
			return testDb
				.select()
				.from(schema.characterVersions)
				.where(
					eq(schema.characterVersions.castMemberId, vell.member.id)
				)
		})()
		await insertCharacterVersions(db(), [
			{
				castMemberId: vell.member.id,
				lorebookId: book.id,
				parentVersionId: base!.parentVersionId,
				year: 6,
				follows: ["name", "aliases"],
				// A followed field holds no own value, and a stray one is not read.
				name: "Not read",
				aliases: ["Not read either"],
				nodeState: "active",
				nodeVisibility: "normal"
			}
		])
		const own =
			(await amendedNamesOf(db(), book.id)).cast.get(vell.member.id) ?? []
		expect(own).not.toContain("Not read")
		expect(own).not.toContain("Not read either")
	})

	it("a card-less member's names answer as the member", async () => {
		const { loadVocabulary } = await import("$lib/server/annotations")
		const { book, member, write } = await world()
		const brin = await member("Brin", false)
		await write(brin.member.id, { name: "Brin Redcloak" }, { year: 4 })
		const { gazetteer } = await loadVocabulary(db(), book.id)
		const asMember = { kind: "cast_member", id: brin.member.id }
		expect(gazetteer.byName.get("brin")).toEqual(asMember)
		expect(gazetteer.byName.get("brin redcloak")).toEqual(asMember)
	})

	it("another book's versions are not this book's names", async () => {
		const { amendedNamesOf } = await import("$lib/server/annotations")
		const a = await world()
		const b = await world()
		const vell = await a.member("Vell")
		await a.write(vell.member.id, { name: "Vellira" }, { year: 4 })
		expect((await amendedNamesOf(db(), b.book.id)).cast.size).toBe(0)
	})
})
