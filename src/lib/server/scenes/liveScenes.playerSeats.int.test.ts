/**
 * 🚧 A live scene's cast proposal names a player seat by its member (owner
 * ruling 2026-11-05, ★pT-1: "Everything in session is cast -> active card").
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"

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
		path.join(os.tmpdir(), "serene-pub-vitest-livescenesseats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

describe("readCastProposal — a player seat", () => {
	test("is named as its member reads, in the roster and as a sender", async () => {
		const { readCastProposal } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, "livescenes-seats")
		const [pia] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Pia", description: "The card." })
			.returning()
		const [b] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Book" } as any)
			.returning()
		const pm = (
			await insertCastMember(testDb, {
				lorebookId: b.id,
				characterId: pia.id,
				binding: "{{char:pia}}",
				name: "Pia",
				ownName: "Pia of the Book"
			} as any)
		).member
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				name: "Run",
				lorebookId: b.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			userId: u.id,
			personaId: pia.id,
			castMemberId: pm.id
		} as any)
		const first = await insertLegacy(db(), {
			sessionId: s.id,
			role: "user",
			content: "I step in.",
			personaId: pia.id
		})
		const proposal = await readCastProposal(db(), {
			sessionId: s.id,
			lorebookId: b.id,
			channel: "main",
			openedAtMessageId: first.id,
			closedAtMessageId: null
		} as any)
		// A seat with a live card is keyed by its card in both modes.
		expect(proposal!.participants.map((p) => [p.key, p.name])).toEqual([
			[`character:${pia.id}`, "Pia of the Book"]
		])
	})
})
