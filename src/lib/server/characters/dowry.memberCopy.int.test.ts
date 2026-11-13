/**
 * `copyCardStatsToMember` — a card's template stats onto a cast member that is
 * losing the card, fill-only: the member's own sheets and values win.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

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
		path.join(os.tmpdir(), "serene-pub-vitest-dowry-memberCopy-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const HP = "core:slot/hp@1"
const asDb = () => testDb as unknown as Db

async function cardRows(cardId: number) {
	const out: unknown[] = []
	for (const source of [
		schema.attributeConfigs,
		schema.attributeValues,
		schema.ownerSheets
	])
		out.push(
			await testDb
				.select()
				.from(source as any)
				.where(
					and(
						eq((source as any).ownerKind, "card"),
						eq((source as any).ownerId, cardId)
					)
				)
				.orderBy(asc((source as any).id))
		)
	return out
}

describe("copyCardStatsToMember", () => {
	test("fills what the member lacks, keeps what it has, and a second call adds nothing", async () => {
		const { declareSheet } = await import("$lib/server/state/declarations")
		const { copyCardStatsToMember } = await import(
			"$lib/server/characters/dowry"
		)
		const { insertCastMember } = await import(
			"$lib/server/characters/versions"
		)
		const [user] = await testDb
			.insert(schema.users)
			.values({ username: "copyu" })
			.returning()
		for (const id of ["a", "b", "m"])
			await declareSheet(testDb, user.id, `copyu:sheet/${id}@1`, {
				label: { en: id },
				slots: [{ id: HP }]
			} as any)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Mara", description: "" })
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: "Book" })
			.returning()
		const member = (
			await insertCastMember(testDb, {
				lorebookId: book.id,
				characterId: card.id,
				binding: "{{char:1}}",
				name: "Mara"
			})
		).member

		await testDb.insert(schema.ownerSheets).values([
			{
				ownerKind: "card",
				ownerId: card.id,
				sheetId: "copyu:sheet/a@1",
				position: 0
			},
			{
				ownerKind: "card",
				ownerId: card.id,
				sheetId: "copyu:sheet/b@1",
				position: 1
			},
			{
				ownerKind: "cast_member",
				ownerId: member.id,
				sheetId: "copyu:sheet/m@1",
				position: 0
			}
		])
		await testDb.insert(schema.attributeConfigs).values([
			{
				ownerKind: "card",
				ownerId: card.id,
				slotId: "x:slot/s2@1",
				config: { max: 9 },
				updatedBy: "user",
				note: "cap"
			},
			{
				ownerKind: "card",
				ownerId: card.id,
				slotId: "x:slot/s3@1",
				config: { max: 3 }
			}
		])
		await testDb.insert(schema.attributeValues).values([
			{
				ownerKind: "card",
				ownerId: card.id,
				slotId: "x:slot/s1@1",
				value: { v: 1 }
			},
			{
				ownerKind: "card",
				ownerId: card.id,
				slotId: "x:slot/s2@1",
				value: { v: 2 },
				updatedBy: "script:7",
				note: "n"
			},
			{
				ownerKind: "card",
				ownerId: card.id,
				slotId: "x:slot/s3@1",
				value: { v: 3 }
			},
			{
				ownerKind: "cast_member",
				ownerId: member.id,
				slotId: "x:slot/s1@1",
				value: { v: 100 }
			}
		])
		const before = await cardRows(card.id)

		const first = await copyCardStatsToMember(asDb(), card.id, member.id, {
			userId: user.id
		})
		expect(first).toEqual({ sheets: 2, configs: 2, values: 2 })

		const sheets = await testDb
			.select({ id: schema.ownerSheets.sheetId })
			.from(schema.ownerSheets)
			.where(
				and(
					eq(schema.ownerSheets.ownerKind, "cast_member"),
					eq(schema.ownerSheets.ownerId, member.id),
					isNull(schema.ownerSheets.sessionId)
				)
			)
			.orderBy(asc(schema.ownerSheets.position))
		expect(sheets.map((s) => s.id)).toEqual([
			"copyu:sheet/m@1",
			"copyu:sheet/a@1",
			"copyu:sheet/b@1"
		])

		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "cast_member"),
					eq(schema.attributeValues.ownerId, member.id)
				)
			)
			.orderBy(asc(schema.attributeValues.slotId))
		expect(values.map((v) => [v.slotId, v.value])).toEqual([
			["x:slot/s1@1", { v: 100 }],
			["x:slot/s2@1", { v: 2 }],
			["x:slot/s3@1", { v: 3 }]
		])
		const s2 = values[1]
		expect(s2.updatedBy).toBe("script:7")
		expect(s2.note).toBe("n")
		for (const v of values.slice(1)) {
			expect(v.sessionId).toBeNull()
			expect(v.branchId).toBeNull()
			expect(v.historyEntryId).toBeNull()
			expect(v.validFromMessageId).toBeNull()
			expect(v.sceneId).toBeNull()
		}
		const configs = await testDb
			.select()
			.from(schema.attributeConfigs)
			.where(
				and(
					eq(schema.attributeConfigs.ownerKind, "cast_member"),
					eq(schema.attributeConfigs.ownerId, member.id)
				)
			)
			.orderBy(asc(schema.attributeConfigs.slotId))
		expect(configs.map((c) => [c.slotId, c.config, c.note])).toEqual([
			["x:slot/s2@1", { max: 9 }, "cap"],
			["x:slot/s3@1", { max: 3 }, null]
		])
		expect(configs[0].sessionId).toBeNull()

		expect(await cardRows(card.id)).toEqual(before)

		const second = await copyCardStatsToMember(asDb(), card.id, member.id, {
			userId: user.id
		})
		expect(second).toEqual({ sheets: 0, configs: 0, values: 0 })
	})
})
