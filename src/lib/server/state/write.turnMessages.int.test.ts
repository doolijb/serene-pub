/**
 * `turnMessages` rows carry their speaker's cast member (plan §27, S3): what a
 * `seated_member` owner's anchor is matched on (`openAnchorFor`), never `speakerId`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-turnmessages-member-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("turnMessages", () => {
	test("each row carries castMemberId; a row with none carries null; speakerId is unchanged", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { turnMessages } = await import("./write")
		const owner = await createTestUser(testDb, `turnmsg-${Date.now()}`)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Maren", description: "…" })
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: owner.id, name: "Book" } as any)
			.returning()
		const [member] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: book!.id,
				characterId: card!.id,
				binding: "{{char:1}}",
				name: "Maren"
			} as any)
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false, lorebookId: book!.id })
			.returning()
		const sessionId = session!.id
		for (const row of [
			{
				role: "user",
				characterId: null,
				personaId: null,
				castMemberId: null
			},
			{
				role: "assistant",
				characterId: card!.id,
				personaId: null,
				castMemberId: member!.id
			}
		]) {
			const [legacy] = await testDb
				.insert(schema.sessionMessages)
				.values({
					sessionId,
					userId: owner.id,
					role: row.role,
					content: "x",
					characterId: row.characterId,
					castMemberId: row.castMemberId
				} as any)
				.returning()
			await testDb
				.insert(schema.messages)
				.values({
					id: legacy!.id,
					sessionId,
					role: row.role,
					characterId: row.characterId,
					castMemberId: row.castMemberId
				} as any)
		}
		const rows = await turnMessages(testDb as unknown as Db, sessionId)
		expect(rows.map((r) => [r.speakerId, r.castMemberId])).toEqual([
			[null, null],
			[card!.id, member!.id]
		])
	})
})
