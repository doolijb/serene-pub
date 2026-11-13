/**
 * 🚧 `keepHistoryForForks` and cast versions (plan §32 §8): a cast version on
 * a fork, dated by a history entry of the line being deleted, is a row the
 * fork points at — so the entry stays. The first such fork gets the entry
 * itself, which is the version's link, kept.
 *
 * Re-pointing a SECOND fork's versions onto that fork's copy is a write the
 * versions module has no function for; the last test pins what happens
 * until it has one.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import {
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { keepHistoryForForks } from "./forkHistory"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-forkHistory-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

/** A line that is deleted, a history entry on it, and two lines forked from it. */
async function world() {
	const suffix = `${++n}`
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `fh-${suffix}` })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${suffix}` })
		.returning()
	const line = async (
		name: string,
		from: number | null,
		forkYear: number | null
	) => {
		const [row] = await testDb
			.insert(schema.lorebookBranches)
			.values({
				lorebookId: book!.id,
				name: `${name} ${suffix}`,
				forkedFromBranchId: from,
				forkYear
			})
			.returning()
		return row!
	}
	const gone = await line("gone", null, 5)
	const first = await line("first", gone.id, 7)
	const second = await line("second", gone.id, null)
	const [dating] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId: book!.id,
					content: "The founding.",
					year: 3,
					branchId: gone.id
				}
			])
		)
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: null,
		name: `Ada ${suffix}`,
		description: "Her own."
	})
	const version = (branchId: number, name: string) => ({
		castMemberId: member.id,
		lorebookId: book!.id,
		branchId,
		year: 3,
		historyEntryId: dating!.id,
		name,
		nodeState: "active" as const,
		nodeVisibility: "normal" as const,
		writtenBy: `user:${user!.id}`
	})
	const lines = [gone, first, second].map((l) => ({
		id: l.id,
		forkedFromBranchId: l.forkedFromBranchId,
		forkYear: l.forkYear,
		forkMonth: l.forkMonth,
		forkDay: l.forkDay
	}))
	return { book: book!, gone, first, second, dating: dating!, version, lines }
}

const versionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.id, id))
	)[0]!

async function deleteLine(
	w: Awaited<ReturnType<typeof world>>
): Promise<Awaited<ReturnType<typeof keepHistoryForForks>>> {
	return testDb.transaction(async (tx) => {
		const kept = await keepHistoryForForks(
			tx as unknown as Db,
			w.book.id,
			w.gone.id,
			w.lines
		)
		await tx
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, w.gone.id))
		return kept
	})
}

describe("keepHistoryForForks with cast versions", () => {
	test("a version on a fork dated by an entry of the deleted line keeps the entry: the fork gets it", async () => {
		const w = await world()
		const [v] = await insertCharacterVersions(db(), [
			w.version(w.first.id, "Ada of the first line")
		])

		const kept = await deleteLine(w)

		expect(kept.moved.get(w.dating.id)).toBe(w.first.id)
		expect(kept.copied).toEqual([])
		const [entry] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.dating.id))
		expect(entry?.branchId).toBe(w.first.id)
		expect((await versionRow(v!.id)).historyEntryId).toBe(w.dating.id)
	})

	test("an entry only a version of the second fork points at goes to the second fork", async () => {
		const w = await world()
		const [v] = await insertCharacterVersions(db(), [
			w.version(w.second.id, "Ada of the second line")
		])

		const kept = await deleteLine(w)

		expect(kept.moved.get(w.dating.id)).toBe(w.second.id)
		expect((await versionRow(v!.id)).historyEntryId).toBe(w.dating.id)
	})

	test("an entry no fork's version points at goes with its line", async () => {
		const w = await world()
		const [v] = await insertCharacterVersions(db(), [
			{ ...w.version(w.first.id, "Undated here"), historyEntryId: null }
		])

		const kept = await deleteLine(w)

		expect(kept.moved.size).toBe(0)
		const entries = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, w.dating.id))
		expect(entries).toHaveLength(0)
		expect((await versionRow(v!.id)).historyEntryId).toBeNull()
	})

	test("two forks' versions on one entry: the entry is kept for both, the second fork gets a copy", async () => {
		const w = await world()
		const [onFirst, onSecond] = await insertCharacterVersions(db(), [
			w.version(w.first.id, "Ada, first"),
			w.version(w.second.id, "Ada, second")
		])

		const kept = await deleteLine(w)

		expect(kept.moved.get(w.dating.id)).toBe(w.first.id)
		expect(kept.copied).toHaveLength(1)
		expect(kept.copied[0]).toMatchObject({
			from: w.dating.id,
			branchId: w.second.id
		})
		expect((await versionRow(onFirst!.id)).historyEntryId).toBe(w.dating.id)
		// The second fork's cast version is re-pointed onto the copy.
		expect((await versionRow(onSecond!.id)).historyEntryId).toBe(
			kept.copied[0].id
		)
	})
})
