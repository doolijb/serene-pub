/**
 * 🚧 Firing a `seated-member:` entry (seat-cast S4, lane s4-seat-live): a seat
 * with no card is its own speaker — `runReply` is handed the member-form ref,
 * never a narrator turn; a seat with a card still passes its `characterId`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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

const replies: any[] = []
vi.mock("$lib/server/utils/runReply", () => ({
	runReply: async (args: any) => {
		replies.push(args)
		return { ok: true }
	}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-fire-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

describe("fireTurnEntry on a seated-member entry", () => {
	test("a card-less seat runs as itself; a carded seat still passes its characterId; a narrator entry stays narrator", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { fireTurnEntry } = await import("$lib/server/sessions/fireTurn")
		const u = await createTestUser(testDb, "fire-cardless")
		const [card] = await testDb
			.insert(schema.characters)
			.values({
				userId: u.id,
				name: "Verity",
				description: "A card."
			} as any)
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Book" } as any)
			.returning()
		const member = async (name: string, characterId: number | null) =>
			(
				await testDb
					.insert(schema.lorebookBindings)
					.values({
						lorebookId: book!.id,
						characterId,
						binding: `{{char:${name}}}`,
						name
					} as any)
					.returning()
			)[0]!
		const carded = await member("Verity", card!.id)
		const cardless = await member("Voice", null)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: false,
				lorebookId: book!.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: s!.id,
				characterId: card!.id,
				castMemberId: carded.id
			},
			{ sessionId: s!.id, characterId: null, castMemberId: cardless.id }
		] as any)
		const fire = (ref: string | null) =>
			fireTurnEntry(db(), {
				sessionId: s!.id,
				userId: u.id,
				entry: { ref, via: "pick" } as any,
				cause: { kind: "user", userId: u.id } as any
			})

		replies.length = 0
		expect((await fire(`seated-member:${cardless.id}`)).fired).toBe(true)
		expect(replies.at(-1).turn).toEqual({
			kind: "respond",
			speaker: `seated-member:${cardless.id}`
		})

		expect((await fire(`seated-member:${carded.id}`)).fired).toBe(true)
		expect(replies.at(-1).turn).toEqual({
			kind: "respond",
			characterId: card!.id
		})

		expect((await fire(null)).fired).toBe(true)
		expect(replies.at(-1).turn).toEqual({ kind: "respond" })
	})
})
