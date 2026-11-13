/**
 * 🚧 `canActOnMessage` on a card-less character line (`seated-member:<id>`):
 * the owner, else the person who seated it; a card-less player line keeps
 * its player's path.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacyMany } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"
import { seatCast } from "$lib/server/sessions/seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {}),
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-perm-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `perm-${label}-${++n}`))!
}

async function table() {
	const owner = await user("owner")
	const g = await user("g")
	const x = await user("x")
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` })
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${++n}`,
			lorebookId: book!.id
		})
		.returning()
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId: s!.id, userId: g.id, isPlayer: true },
		{ sessionId: s!.id, userId: x.id, isPlayer: true }
	])
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), s!.id)
	const { member } = await insertCastMember(testDb, {
		lorebookId: own.id,
		binding: `{{char:perm-${++n}}}`,
		characterId: null,
		name: "Nobody",
		ownName: "Nobody"
	})
	const seated = await testDb.transaction(async (tx) =>
		seatCast(tx as unknown as Db, {
			sessionId: s!.id,
			castMemberId: member.id,
			seatedBy: g.id
		})
	)
	if (!seated.ok) throw new Error("not seated")
	// A card-less player seat of X, and a line it sent.
	const [pseat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: s!.id,
			personaId: null,
			userId: x.id,
			seatName: "Xena"
		})
		.returning()
	const [line, playerLine] = await insertLegacyMany(testDb, [
		{
			sessionId: s!.id,
			userId: owner.id,
			characterId: null,
			personaId: null,
			role: "assistant",
			content: "Said by the seat.",
			metadata: { speaker: `seated-member:${member.id}` }
		},
		{
			sessionId: s!.id,
			userId: x.id,
			characterId: null,
			personaId: null,
			role: "user",
			content: "Said by Xena.",
			metadata: { speaker: `player-seat:${pseat!.id}` }
		}
	])
	return { owner, g, x, line: line!, playerLine: playerLine! }
}

describe("canActOnMessage on a card-less character line", () => {
	test("the session owner may", async () => {
		const t = await table()
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.line.id, t.owner.id)).toBe(true)
	})
	test("the guest who seated it may", async () => {
		const t = await table()
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.line.id, t.g.id)).toBe(true)
	})
	test("another guest may not", async () => {
		const t = await table()
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.line.id, t.x.id)).toBe(false)
	})
	test("a card-less player line keeps its author's path", async () => {
		const t = await table()
		const { canActOnMessage } = await import(
			"$lib/server/messages/permissions"
		)
		expect(await canActOnMessage(db(), t.playerLine.id, t.x.id)).toBe(true)
		expect(await canActOnMessage(db(), t.playerLine.id, t.g.id)).toBe(false)
	})
})
