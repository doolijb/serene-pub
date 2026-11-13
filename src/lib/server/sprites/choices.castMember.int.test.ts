/**
 * 🚧 `sprite-choices@1` names the speaker's cast member (plan §27, S3, ★S3-4:
 * "Cast member id, cascade to a card based on active card on the timeline and
 * cast member configuration"). `castMemberId` is the SEAT's member;
 * `characterId` stays the card the art comes from.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { PNG } from "pngjs"
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
		path.join(os.tmpdir(), "serene-pub-vitest-choicesmember-")
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

let seed = 9000
let n = 0

async function scene(opts: { memberless?: boolean; art?: boolean } = {}) {
	const { importSprites } = await import("$lib/server/sprites")
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `choices-member-${++n}` })
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user!.id, name: "Verity", description: "" })
		.returning()
	if (opts.art !== false)
		await importSprites(
			db(),
			user!.id,
			card!.id,
			[
				{ label: "joy", bytes: png(seed++) },
				{ label: "neutral", bytes: png(seed++) }
			],
			"upload"
		)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Ashfall ${n}` })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book!.id,
			characterId: card!.id,
			binding: `{{char:${n}}}`,
			name: "Verity"
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, lorebookId: book!.id })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: opts.memberless ? null : member!.id,
		position: 0
	})
	return { card: card!, member: member!, session: session! }
}

describe("spriteChoicesFor names the seat's cast member", () => {
	test("castMemberId is the seat's member; characterId stays the card the art comes from", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card, member } = await scene()
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({
			characterId: card.id,
			castMemberId: member.id,
			set: "default"
		})
	})

	test("a seat with no member stored: castMemberId is null", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card } = await scene({ memberless: true })
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c.castMemberId).toBeNull()
		expect(c.characterId).toBe(card.id)
	})

	test("a card with no art still names the member", async () => {
		const { spriteChoicesFor } = await import("$lib/server/sprites/choices")
		const { session, card, member } = await scene({ art: false })
		const c = await spriteChoicesFor(db(), {
			sessionId: session.id,
			characterId: card.id
		})
		expect(c).toMatchObject({ labels: [], castMemberId: member.id })
	})
})
