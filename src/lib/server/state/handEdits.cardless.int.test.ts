/**
 * 🚧 Card-less seats in the hand-edit decider (`state/handEdits.ts`, plan §34.2, S4): a
 * `seated_member` owner whose seat holds no card is whose its seat's seater is.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-hand-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

describe("a card-less seat's hand edits", () => {
	test("a seated_member owner with no card is whose its seater is", async () => {
		const was = memberFormSwitch.on
		memberFormSwitch.on = true
		try {
			const { createTestUser } = await import("$lib/server/utils/testDb")
			const suffix = `${++n}`
			const owner = (await createTestUser(testDb, `hc-owner-${suffix}`))!
			const seater = (await createTestUser(
				testDb,
				`hc-seater-${suffix}`
			))!
			const other = (await createTestUser(testDb, `hc-other-${suffix}`))!
			const [book] = await testDb
				.insert(schema.lorebooks)
				.values({ userId: owner.id, name: `HC ${suffix}` })
				.returning()
			const { member } = await insertCastMember(testDb, {
				lorebookId: book!.id,
				binding: `{{char:hc${suffix}}}`,
				characterId: null,
				name: "Nobody",
				ownName: "Nobody"
			})
			const [session] = await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					isGroup: true,
					name: `HC ${suffix}`,
					genreId: "core:genre/dungeon-crawler",
					lorebookId: book!.id
				} as any)
				.returning()
			const sessionId = session!.id
			await testDb.insert(schema.sessionGuests).values([
				{ sessionId, userId: seater.id, isPlayer: true },
				{ sessionId, userId: other.id, isPlayer: true }
			] as any)
			// A card-less seat (no card, no envoy) seated by `seater`.
			await testDb.insert(schema.sessionCharacters).values({
				sessionId,
				characterId: null,
				envoySlug: null,
				castMemberId: member!.id,
				seatedByUserId: seater.id
			} as any)
			const { handEditJudge } = await import(
				"$lib/server/state/handEdits"
			)
			const seatedOwner = {
				kind: "seated_member",
				id: member!.id
			} as const
			const mine = await handEditJudge(
				testDb as any,
				sessionId,
				seater.id
			)
			await mine.know(seatedOwner)
			expect(mine.role).toBe("player")
			expect(mine.whose(seatedOwner)).toBe("own")
			const theirs = await handEditJudge(
				testDb as any,
				sessionId,
				other.id
			)
			await theirs.know(seatedOwner)
			expect(theirs.whose(seatedOwner)).toBe("other")
		} finally {
			memberFormSwitch.on = was
		}
	})
})
