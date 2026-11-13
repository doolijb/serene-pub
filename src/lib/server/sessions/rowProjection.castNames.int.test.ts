/**
 * A session card's "speaker: excerpt" names a cast member as their book does
 * (§0-D): a member's own name reads; a session whose book has none reads the
 * card — in the same call.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import {
	createTestDb,
	createTestUser,
	releaseDataDir
} from "$lib/server/utils/testDb"
import { lastVisibleMessages } from "./rowProjection"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-l2-row-projection-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
async function seed(ownName: string | null) {
	const user = await createTestUser(db, `row-names-${++n}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "Names", userId: user.id })
		.returning()
	const [card] = await db
		.insert(schema.characters)
		.values({
			userId: user.id,
			name: "Verity Hale",
			description: "d"
		} as any)
		.returning()
	// Through the versions module: the member's base is written with it.
	const { member } = await insertCastMember(db as unknown as Db, {
		lorebookId: book.id,
		binding: `{{char:${n}}}`,
		characterId: card.id
	})
	if (ownName)
		await db.transaction((tx) =>
			writeCastVersion(tx as unknown as Db, {
				member: member.id,
				changes: { name: ownName },
				writtenBy: `user:${user.id}`,
				at: { branchId: null, date: null, personalPosition: null }
			})
		)
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	await db
		.insert(schema.sessionCharacters)
		.values({ sessionId: session.id, characterId: card.id })
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		role: "assistant",
		content: "Hello there.",
		characterId: card.id
	} as any)
	return session.id
}

describe("session cards name a member as their book does", () => {
	test("an own name reads; a session without one reads the card", async () => {
		const named = await seed("Maren")
		const plain = await seed(null)
		const last = await lastVisibleMessages(db as any, [named, plain])
		expect(last.get(named)?.speakerName).toBe("Maren")
		expect(last.get(plain)?.speakerName).toBe("Verity Hale")
	})
})
