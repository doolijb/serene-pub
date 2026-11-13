/**
 * 🚧 `datedRowsOf` lists the cast members' dated cast versions (plan §32 §8):
 * the rows the calendar must be able to land. The frozen cast amendments are
 * lifted into versions, so they are not listed a second time.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import { datesThatDoNotLand } from "$lib/shared/lorebooks/storyDate"
import { datedRowsOf } from "./storyTime"

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
		path.join(os.tmpdir(), "serene-pub-vitest-datedRows-versions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const suffix = `${++n}`
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `dr-${suffix}` })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${suffix}` })
		.returning()
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: `North ${suffix}`, forkYear: 1 })
		.returning()
	const { card } = await insertCard(db(), {
		userId: user!.id,
		name: `Card ${suffix}`,
		description: "A card."
	})
	const { member, base } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: `{{char:${suffix}}}`,
		characterId: card.id,
		name: `Ada ${suffix}`
	})
	const mk = (extra: Record<string, unknown>) => ({
		castMemberId: member.id,
		lorebookId: book!.id,
		nodeState: "active" as const,
		nodeVisibility: "normal" as const,
		...extra
	})
	return {
		user: user!,
		book: book!,
		line: line!,
		member,
		base: base!,
		mk,
		suffix
	}
}

const castRows = (rows: { key: string }[]) =>
	rows.filter((r) => r.key.startsWith("castVersion:"))

describe("datedRowsOf — cast versions", () => {
	test("lists every dated cast version of the book's members, on any line, under the Changes list's words", async () => {
		const w = await world()
		const [onMain, onLine, dayless] = await insertCharacterVersions(db(), [
			w.mk({ year: 7, month: 2, day: 9, name: "Ada, later" }),
			w.mk({
				year: 8,
				branchId: w.line.id,
				personalPosition: 2,
				name: "Ada, north"
			}),
			w.mk({ year: 9, month: 4, writtenBy: "user:1" })
		])
		const rows = castRows(await datedRowsOf(db(), w.book.id))
		expect(rows).toEqual([
			{
				key: `castVersion:${onMain!.id}`,
				label: `Amendment to Ada ${w.suffix}`,
				year: 7,
				month: 2,
				day: 9
			},
			{
				key: `castVersion:${onLine!.id}`,
				label: `Amendment to Ada ${w.suffix}`,
				year: 8,
				month: null,
				day: null
			},
			{
				key: `castVersion:${dayless!.id}`,
				label: `Amendment to Ada ${w.suffix}`,
				year: 9,
				month: 4,
				day: null
			}
		])
	})

	test("the base, an undated story version and a card version are not dated rows; another book's are not listed", async () => {
		const w = await world()
		const other = await world()
		await insertCharacterVersions(db(), [
			w.mk({ sourceSessionId: 77, name: "Told in play" }),
			other.mk({ year: 3 })
		])
		// The base is in the table, and it is not listed.
		expect(w.base.year).toBeNull()
		expect(castRows(await datedRowsOf(db(), w.book.id))).toEqual([])
		expect(castRows(await datedRowsOf(db(), other.book.id))).toHaveLength(1)
	})

	test("a dated change written as a version is listed once, as a cast version", async () => {
		const w = await world()
		const [lifted] = await insertCharacterVersions(db(), [
			w.mk({ year: 11, name: "Old words", writtenBy: "lift" })
		])
		const rows = await datedRowsOf(db(), w.book.id)
		expect(
			rows.filter((r) => r.label.startsWith("Amendment to Ada"))
		).toHaveLength(1)
		expect(rows.map((r) => r.key)).toContain(`castVersion:${lifted!.id}`)
		expect(rows.some((r) => r.key.startsWith("castAmendment:"))).toBe(false)
	})

	test("a calendar that cannot place a version's date strands it", async () => {
		const w = await world()
		const [v] = await insertCharacterVersions(db(), [
			w.mk({ year: 5, month: 3, day: 1 })
		])
		const calendar = {
			months: [
				{ name: "Frost", days: 30 },
				{ name: "Thaw", days: 30 }
			]
		}
		const stranded = datesThatDoNotLand(
			await datedRowsOf(db(), w.book.id),
			calendar as any
		)
		expect(stranded.map((r) => r.key)).toEqual([`castVersion:${v!.id}`])
	})
})
