/**
 * Seat-cast S2: the sprite picker (`core:oracle/pick-sprite@1`) takes a
 * 🚧 `seated-member:<id>` speaker and asks the host for the card that
 * member's seat holds; a member nobody is seated as picks nothing, and a
 * `character:<id>` speaker is asked for as before.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { insertCastMember } from "$lib/server/characters/versions"
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
		path.join(os.tmpdir(), "serene-pub-vitest-picksprite-member-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0

function png(seed: number): Buffer {
	const img = new PNG({ width: 2, height: 2 })
	img.data.fill(0)
	img.data[0] = seed % 256
	img.data[1] = Math.floor(seed / 256) % 256
	img.data[3] = 255
	return PNG.sync.write(img)
}

// The picker's embedding is not under test: the host's choices are.
vi.mock("$lib/server/sprites/vectors", () => ({
	spriteVectors: async () => ({ lineVector: null, labelVectors: null })
}))

async function seated() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `picksprite-member-${++n}`)
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Maren", description: "" })
		.returning()
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Porto Alto" })
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: lorebook.id,
			characterId: card.id,
			binding: "{{char:1}}",
			name: card.name
		})
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: "Run",
			lorebookId: lorebook.id
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId: card.id,
		castMemberId: member.id
	})
	return { card, member, session }
}

async function pick(sessionId: number, speaker: string) {
	const { coreBindings } = await import(
		"$lib/server/pipelines/runtime/bindings"
	)
	const calls: Array<Record<string, unknown>> = []
	const ctx = {
		call: async (payload: unknown) => {
			calls.push(payload as Record<string, unknown>)
			return { choices: null }
		},
		log: () => {}
	}
	await (coreBindings() as any)["core:oracle/pick-sprite@1"](
		{ scope: { sessionId }, speaker, text: "She smiled.", params: {} },
		ctx
	)
	return calls
}

describe("pick-sprite and a seated-member speaker", () => {
	test("asks for the card the member's seat holds", async () => {
		const s = await seated()
		const calls = await pick(s.session.id, `seated-member:${s.member.id}`)
		expect(calls).toEqual([
			expect.objectContaining({
				sessionId: s.session.id,
				characterId: s.card.id
			})
		])
	})

	test("a member nobody is seated as picks nothing", async () => {
		const s = await seated()
		expect(
			await pick(s.session.id, `seated-member:${s.member.id + 1000}`)
		).toEqual([])
	})

	test("a card-less seat's member is asked for as castMemberId, never characterId", async () => {
		const s = await seated()
		const cardless = (
			await insertCastMember(testDb, {
				lorebookId: s.member.lorebookId,
				binding: "{{char:cl2}}",
				characterId: null,
				name: "Ash",
				ownName: "Ash"
			} as never)
		).member!
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.session.id,
			characterId: null,
			castMemberId: cardless.id,
			position: 1
		})
		const calls = await pick(s.session.id, `seated-member:${cardless.id}`)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toEqual(
			expect.objectContaining({ castMemberId: cardless.id })
		)
		expect("characterId" in calls[0]!).toBe(false)
	})

	test("the host offers the member's own sprite sets for a castMemberId call", async () => {
		const s = await seated()
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const { importSprites } = await import("$lib/server/sprites")
		const cardless = (
			await insertCastMember(testDb, {
				lorebookId: s.member.lorebookId,
				binding: "{{char:cl3}}",
				characterId: null,
				name: "Ash",
				ownName: "Ash"
			} as never)
		).member!
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.session.id,
			characterId: null,
			castMemberId: cardless.id,
			position: 1
		})
		await importSprites(
			testDb as never,
			s.session.userId,
			{ castMemberId: cardless.id },
			[{ label: "joy", bytes: png(31337) }],
			"upload"
		)
		const result = (await createHost(testDb as never, {
			sessionId: s.session.id
		}).call!(
			{ sessionId: s.session.id, castMemberId: cardless.id, text: "", set: null },
			{ key: "pick", definitionId: "core:oracle/pick-sprite" } as any,
			{} as any,
			{} as any
		)) as { choices: { labels: string[]; castMemberId: number | null } }
		expect(result.choices.castMemberId).toBe(cardless.id)
		expect(result.choices.labels).toEqual(["joy"])
	})

	test("a character speaker is asked for as before", async () => {
		const s = await seated()
		const calls = await pick(s.session.id, `character:${s.card.id}`)
		expect(calls).toEqual([
			expect.objectContaining({ characterId: s.card.id })
		])
	})
})
