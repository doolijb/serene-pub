/**
 * 🚧 `spriteChoicesFor` for a card-less seat (plan §34.2, S4): asked by
 * `castMemberId`, it offers the member's own sprite sets only and finds the
 * speaker's recent lines by `session_messages.cast_member_id`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
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
		path.join(os.tmpdir(), "serene-pub-vitest-choicescardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

let seed = 12000
let n = 0

async function scene() {
	const { importSprites } = await import("$lib/server/sprites")
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `choices-cardless-${++n}` })
		.returning()
	// A card with art that must NOT be offered for the card-less member.
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user!.id, name: "Decoy", description: "" })
		.returning()
	await importSprites(
		db(),
		user!.id,
		card!.id,
		[{ label: "decoy", bytes: png(seed++) }],
		"upload"
	)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Cardless ${n}` })
		.returning()
	const { member } = await insertCastMember(testDb, {
		lorebookId: book!.id,
		binding: `{{char:cl${n}}}`,
		characterId: null,
		name: "Nobody",
		ownName: "Nobody"
	})
	await importSprites(
		db(),
		user!.id,
		{ castMemberId: member!.id },
		[
			{ label: "joy", bytes: png(seed++) },
			{ label: "neutral", bytes: png(seed++) }
		],
		"upload"
	)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, lorebookId: book!.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: null,
		castMemberId: member!.id,
		position: 0
	})
	const line = async (
		who: { castMemberId?: number; characterId?: number },
		label: string
	) =>
		(
			await testDb
				.insert(schema.sessionMessages)
				.values({
					sessionId: session!.id,
					role: "assistant",
					content: "…",
					...who,
					metadata: {
						sprite: { set: "default", label, source: "picker" }
					}
				} as never)
				.returning()
		)[0]!
	return { card: card!, member: member!, session: session!, line }
}

describe("spriteChoicesFor a card-less seat", () => {
	test("castMemberId offers the member's own sets only and finds recent lines by cast_member_id", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, member, card, line } = await scene()
		await line({ castMemberId: member.id }, "joy")
		// A line of the decoy card, not the member's: never one of its recent lines.
		await line({ characterId: card.id }, "decoy")
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			castMemberId: member.id
		})
		expect(c).toMatchObject({
			characterId: null,
			castMemberId: member.id,
			set: "default",
			decidedBy: "default"
		})
		expect(c.labels).toEqual(["joy", "neutral"])
		expect(c.recent).toEqual(["joy"])
		expect(c.last).toMatchObject({ label: "joy" })
	})

	test("both ids, or neither, offers nothing", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, member, card } = await scene()
		const both = await spriteChoicesFor(db(), {
			sessionId: session.id,
			castMemberId: member.id,
			characterId: card.id
		})
		expect(both.labels).toEqual([])
		const neither = await spriteChoicesFor(db(), { sessionId: session.id })
		expect(neither.labels).toEqual([])
	})
})
