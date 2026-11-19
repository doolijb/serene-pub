/**
 * The compiler's writes of a scene's cast keep Edit history rows: one row
 * (cause `scene-compiler`, made by the session itself) when a refresh, a
 * close, a move or a merge changes a role's member set; none when the set is
 * the same members in another order, none for a scene the writer just made,
 * and none for a locked scene.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { insertCastMember } from "$lib/server/characters/versions"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return testDbModule(await createTestDb())
})

const PLAIN = "test:genre/castredlines-plain"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-castredlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { sessionEvents } = await import("@serene-pub/sdk")
	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: "test:spec/castredlines-plain-create", name: "castredlines" })
		.returning()
	const [row] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-castredlines",
			inputGenre: PLAIN,
			inputEvent: sessionEvents.sessionCreated,
			genre: {
				name: { en: "Plain" },
				family: "test",
				shape: { channels: ["main"], scenes: { castRefresh: true } }
			}
		} as any)
		.returning()
	await testDb
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: row.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

type Seat = { card: { id: number }; member: { id: number } }
type World = Awaited<ReturnType<typeof world>>

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `castredlines-${++seq}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book.id, year: 5, month: 1, day: 2 }]))
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: label,
			lorebookId: book.id,
			genreId: PLAIN,
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			storyClockHour: 9,
			storyClockMinute: 30
		} as any)
		.returning()
	return { user, book, session }
}

async function seatCharacter(w: World, name: string): Promise<Seat> {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: w.user.id, name, description: `${name}.` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: w.book.id,
		characterId: card.id,
		binding: `{{char:${name.toLowerCase()}}}`,
		name
	} as any)
	await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: w.session.id,
			characterId: card.id,
			castMemberId: member.id,
			seatedByUserId: w.user.id
		} as any)
	return { card, member }
}

async function say(w: World, who: Seat | null, content: string) {
	const m = await insertLegacy(db(), {
		sessionId: w.session.id,
		role: "assistant",
		content,
		...(who ? { characterId: who.card.id } : {})
	} as any)
	return m.id
}

async function open(w: World, atMessageId: number, closeAt?: number) {
	const { openScene } = await import("$lib/server/scenes/liveScenes")
	return (
		await openScene(db(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId,
			...(closeAt != null ? { closeAt } : {})
		})
	).scene
}

async function participantsOf(sceneId: number): Promise<number[]> {
	const rows = await testDb
		.select({
			bindingId: schema.sceneCharacters.bindingId,
			ordinal: schema.sceneCharacters.ordinal
		})
		.from(schema.sceneCharacters)
		.where(
			and(
				eq(schema.sceneCharacters.sceneId, sceneId),
				eq(schema.sceneCharacters.role, "participant")
			)
		)
	return rows.sort((a, b) => a.ordinal - b.ordinal).map((r) => r.bindingId)
}

const redlinesOf = (sceneId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.sceneId, sceneId))

async function refresh(w: World, messageId: number) {
	const { refreshOpenSceneCast } = await import("$lib/server/scenes/liveScenes")
	return refreshOpenSceneCast(db(), {
		sessionId: w.session.id,
		channel: "main",
		messageId
	})
}

const lock = (id: number) =>
	testDb.update(schema.scenes).set({ sceneLock: true }).where(eq(schema.scenes.id, id))

const tagged = (name: string) => `${name} said, "Quiet now."`

describe("a new scene records nothing", () => {
	test("a live open and a range filed with an end", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const a = await say(w, mira, "Mira looks up.")
		const b = await say(w, bram, "Bram arrives.")
		const filed = await open(w, a, b)
		expect(await participantsOf(filed.id)).toHaveLength(2)
		expect(await redlinesOf(filed.id)).toEqual([])
		const c = await say(w, mira, "Mira stands.")
		const live = await open(w, c)
		expect(await participantsOf(live.id)).toEqual([mira.member.id])
		expect(await redlinesOf(live.id)).toEqual([])
	})
})

describe("a refresh", () => {
	test("a new speaker records one row; a listed speaker records nothing", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const scene = await open(w, await say(w, mira, "Mira looks up."))
		expect(await refresh(w, await say(w, mira, "Mira again."))).toBe(false)
		expect(await redlinesOf(scene.id)).toEqual([])
		expect(await refresh(w, await say(w, bram, "Bram arrives."))).toBe(true)
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "scene-compiler",
			userId: null,
			sessionId: w.session.id
		})
		expect(rows[0].changes).toEqual({
			participantCharacters: {
				before: { v: [mira.member.id] },
				after: { v: [mira.member.id, bram.member.id] }
			}
		})
		expect(await refresh(w, await say(w, bram, "Bram sits."))).toBe(false)
		expect(await redlinesOf(scene.id)).toHaveLength(1)
	})

	test("a narrator line tagging a new member records one row", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const scene = await open(w, await say(w, mira, "Mira looks up."))
		expect(await refresh(w, await say(w, null, tagged("Bram")))).toBe(true)
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].cause).toBe("scene-compiler")
		expect(rows[0].changes).toEqual({
			participantCharacters: {
				before: { v: [mira.member.id] },
				after: { v: [mira.member.id, bram.member.id] }
			}
		})
	})

	test("a locked scene's refresh records nothing", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const scene = await open(w, await say(w, mira, "Mira looks up."))
		await lock(scene.id)
		expect(await refresh(w, await say(w, bram, "Bram arrives."))).toBe(false)
		expect(await redlinesOf(scene.id)).toEqual([])
	})
})

describe("a close, a move and a merge", () => {
	test("a close whose recompute changes the set records one row", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, mira, "Mira stands.")
		await say(w, bram, "Bram arrives.")
		const scene = await open(w, first)
		expect(await redlinesOf(scene.id)).toEqual([])
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: second
		})
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "scene-compiler",
			userId: null,
			sessionId: w.session.id
		})
		expect(rows[0].changes.participantCharacters.after).toEqual({
			v: [mira.member.id]
		})
	})

	test("a close whose recompute yields the same members in another order records nothing", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, bram, "Bram arrives.")
		const scene = await open(w, first)
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		await writeSceneCast(
			scene.id,
			{ participantCharacters: [bram.member.id, mira.member.id] },
			db()
		)
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: second
		})
		expect((await participantsOf(scene.id)).sort((a, b) => a - b)).toEqual(
			[mira.member.id, bram.member.id].sort((a, b) => a - b)
		)
		expect(await redlinesOf(scene.id)).toEqual([])
	})

	test("a move that changes the set records one row", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, mira, "Mira stands.")
		const third = await say(w, bram, "Bram arrives.")
		const scene = await open(w, first, third)
		const { moveSceneBoundary } = await import("$lib/server/scenes/liveScenes")
		await moveSceneBoundary(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			closedAt: second
		})
		const rows = await redlinesOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].cause).toBe("scene-compiler")
		expect(rows[0].changes.participantCharacters.after).toEqual({
			v: [mira.member.id]
		})
	})

	test("a merge that changes the set records one row on the joined scene", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const a1 = await say(w, mira, "Mira looks up.")
		const a2 = await say(w, mira, "Mira stands.")
		const b1 = await say(w, bram, "Bram arrives.")
		const b2 = await say(w, bram, "Bram sits.")
		const earlier = await open(w, a1, a2)
		const later = await open(w, b1, b2)
		const { mergeScene } = await import("$lib/server/scenes/liveScenes")
		await mergeScene(db(), { sceneId: later.id, userId: w.user.id })
		const rows = await redlinesOf(earlier.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].cause).toBe("scene-compiler")
		expect(rows[0].changes.participantCharacters.before).toEqual({
			v: [mira.member.id]
		})
		expect(await redlinesOf(later.id)).toEqual([])
	})

	test("a locked scene's close records nothing", async () => {
		const w = await world()
		const mira = await seatCharacter(w, "Mira")
		const bram = await seatCharacter(w, "Bram")
		const first = await say(w, mira, "Mira looks up.")
		const second = await say(w, mira, "Mira stands.")
		await say(w, bram, "Bram arrives.")
		const scene = await open(w, first)
		await lock(scene.id)
		const { closeScene } = await import("$lib/server/scenes/liveScenes")
		await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: second
		})
		expect(await participantsOf(scene.id)).toHaveLength(2)
		expect(await redlinesOf(scene.id)).toEqual([])
	})
})
