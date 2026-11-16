/**
 * `makeTimelessCopy` on a large book (about 3,000 entries, a few hundred
 * dated changes, 50 members with several versions, a few hundred links and
 * stats, one line): one transaction, timed.
 */

import { afterAll, beforeAll, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { eq, sql } from "drizzle-orm"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { makeTimelessCopy } from "./timelessCopy"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-timeless-large-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const chunked = async <T>(
	rows: T[],
	size: number,
	write: (part: T[]) => Promise<unknown>
) => {
	for (let i = 0; i < rows.length; i += size)
		await write(rows.slice(i, i + size))
}

test("a book of about 3,000 entries is copied in one transaction", async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "timeless-large")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Large" })
		.returning()
	const bookId = book.id
	const [line] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: bookId, name: "Line", forkYear: 1150 })
		.returning()

	const history = await testDb
		.insert(schema.lorebookEntries)
		.values(
			Array.from({ length: 20 }, (_, i) =>
				entryInsert({
					lorebookId: bookId,
					typeId: HISTORY_TYPE_ID,
					position: i + 1,
					content: `h${i}`,
					year: 1100 + i * 5
				} as any)
			)
		)
		.returning({ id: schema.lorebookEntries.id })
	const historyIds = history.map((h) => h.id)

	const total = 3000
	const entryIds: number[] = []
	await chunked(
		Array.from({ length: total }, (_, i) =>
			entryInsert({
				lorebookId: bookId,
				typeId: "core:entry/world-lore",
				position: i + 1,
				name: `Entry ${i}`,
				content: `Content ${i}`,
				anchorEntryId: undefined
			} as any)
		).map((v, i) => ({
			...v,
			branchId: i % 10 === 0 ? line.id : null,
			anchorEntryId:
				i % 7 === 0 ? historyIds[i % historyIds.length] : null
		})),
		250,
		async (part) => {
			const rows = await testDb
				.insert(schema.lorebookEntries)
				.values(part)
				.returning({ id: schema.lorebookEntries.id })
			entryIds.push(...rows.map((r) => r.id))
		}
	)

	const amendments = Array.from({ length: 400 }, (_, i) => ({
		lorebookId: bookId,
		entryId: entryIds[(i * 7) % total],
		year: 1100 + (i % 80),
		fields:
			i % 3 === 0
				? { content: `Amended ${i}` }
				: i % 3 === 1
					? { enabled: i % 2 === 0 }
					: { name: `Renamed ${i}` },
		branchId: i % 5 === 0 ? line.id : null
	}))
	await chunked(amendments, 100, (part) =>
		testDb.insert(schema.entryAmendments).values(part)
	)

	const memberIds: number[] = []
	for (let i = 0; i < 50; i++) {
		const [m] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: bookId,
				binding: `{{char:${i + 1}}}`,
				name: `Member ${i}`
			})
			.returning()
		memberIds.push(m.id)
	}
	const { insertCharacterVersions } = await import(
		"$lib/server/characters/versions"
	)
	const profile = { nodeState: "active", nodeVisibility: "normal" } as const
	await chunked(
		memberIds.flatMap((id, i) => [
			{
				castMemberId: id,
				lorebookId: bookId,
				name: `Member ${i}`,
				summary: "base",
				...profile
			},
			{
				castMemberId: id,
				lorebookId: bookId,
				name: `Member ${i}`,
				summary: "early",
				year: 1110,
				...profile
			},
			{
				castMemberId: id,
				lorebookId: bookId,
				name: `Member ${i}`,
				summary: "late",
				year: 1180,
				...profile
			},
			{
				castMemberId: id,
				lorebookId: bookId,
				name: `Member ${i}`,
				summary: "line",
				year: 1160,
				branchId: line.id,
				...profile
			}
		]),
		100,
		(part) => insertCharacterVersions(testDb as any, part as any)
	)

	const links = Array.from({ length: 300 }, (_, i) => ({
		lorebookId: bookId,
		fromNodeId: memberIds[i % 50],
		toNodeId: memberIds[(i + 1 + Math.floor(i / 50)) % 50],
		relationshipType: `tie ${Math.floor(i / 50)}`,
		description: `link ${i}`,
		historyEntryId: historyIds[i % historyIds.length]
	}))
	await chunked(links, 100, (part) =>
		testDb.insert(schema.narrativeRelationships).values(part)
	)
	const stats = Array.from({ length: 400 }, (_, i) => ({
		ownerKind: "cast_member",
		ownerId: memberIds[i % 50],
		slotId: `core:slot/s${i % 8}@1`,
		value: { v: i },
		historyEntryId: historyIds[i % historyIds.length]
	}))
	await chunked(stats, 100, (part) =>
		testDb.insert(schema.attributeValues).values(part)
	)

	const started = Date.now()
	const copy = await testDb.transaction((tx) =>
		makeTimelessCopy(tx as any, {
			sourceId: bookId,
			branchId: null,
			userId: user.id,
			name: "Large copy"
		})
	)
	const ms = Date.now() - started
	console.log("timeless copy:", ms, "ms")
	process.stderr.write(`timeless copy: ${ms} ms\n`)

	const [{ n }] = await testDb
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, copy.id))
	// Main reads every entry that is not on the line: 2,700 of 3,000.
	expect(n).toBe(2700)
	const [{ branches }] = await testDb
		.select({ branches: sql<number>`count(*)::int` })
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, copy.id))
	expect(branches).toBe(0)
}, 180_000)
