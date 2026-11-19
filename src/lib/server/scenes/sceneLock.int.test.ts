/**
 * The scene lock (`scenes.scene_lock`, owner ruling EL1, 2026-11-17): while it
 * is true no run writes the scene's notes, summary, name or cast; a person's
 * own edit, a Summarize press and the scene's boundaries are not stopped.
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
import { genreKeeping } from "$lib/server/utils/testGenre"
import { RUN_LOCK_SENTENCES } from "$lib/shared/lorebooks/runLocks"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let seq = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import("$lib/server/utils/testDb")
	return testDbModule(await createTestDb())
})
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const PLAIN = "test:genre/scenelock-plain"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-scene-lock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { sessionEvents } = await import("@serene-pub/sdk")
	genreKeeping(PLAIN, {
		name: { en: "Plain" },
		family: "test",
		shape: { channels: ["main"], scenes: { castRefresh: true } },
		slots: [],
		events: {}
	})
	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: "test:spec/scenelock-plain-create", name: "scenelock" })
		.returning()
	const [row] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "test-scenelock",
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

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const label = `scenelock-${++seq}`
	const user = await createTestUser(testDb, label)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: label,
			lorebookId: book.id,
			genreId: PLAIN
		} as any)
		.returning()
	return { user, book, session }
}
type World = Awaited<ReturnType<typeof world>>

async function seat(w: World, name: string) {
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
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: w.session.id,
		characterId: card.id,
		castMemberId: member.id,
		seatedByUserId: w.user.id
	} as any)
	return { card, member }
}

async function say(w: World, who: { card: { id: number } } | null, content = "A line.") {
	const m = await insertLegacy(db(), {
		sessionId: w.session.id,
		role: "assistant",
		content,
		...(who ? { characterId: who.card.id } : {})
	} as any)
	return m.id
}

async function open(w: World, atMessageId: number) {
	const { openScene } = await import("./liveScenes")
	return (
		await openScene(db(), {
			sessionId: w.session.id,
			userId: w.user.id,
			channel: "main",
			atMessageId
		})
	).scene
}

const sceneRow = async (id: number) =>
	(await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, id)))[0]!
const lock = (id: number, sceneLock = true) =>
	testDb.update(schema.scenes).set({ sceneLock }).where(eq(schema.scenes.id, id))

async function participantsOf(sceneId: number): Promise<number[]> {
	const rows = await testDb
		.select({ bindingId: schema.sceneCharacters.bindingId })
		.from(schema.sceneCharacters)
		.where(
			and(
				eq(schema.sceneCharacters.sceneId, sceneId),
				eq(schema.sceneCharacters.role, "participant")
			)
		)
	return rows.map((r) => r.bindingId).sort((a, b) => a - b)
}

const fakeSocket = (userId: number) =>
	({ user: { id: userId }, io: { to: () => ({ emit() {} }) } }) as any

describe("the run's note", () => {
	test("a locked scene keeps its notes and the run is told; an unlocked one takes the note", async () => {
		const { appendSceneNote } = await import("./liveScenes")
		const w = await world()
		const scene = await open(w, await say(w, null))
		const input = { sessionId: w.session.id, runId: "r1", messageId: null }
		const first = await appendSceneNote(db(), { ...input, text: "One." })
		expect(first.lockedNote).toBeUndefined()
		expect(first.notes.map((n) => n.text)).toEqual(["One."])

		await lock(scene.id)
		const second = await appendSceneNote(db(), { ...input, text: "Two." })
		expect(second.sceneId).toBe(scene.id)
		expect(second.notes.map((n) => n.text)).toEqual(["One."])
		expect(second.lockedNote).toBe(
			RUN_LOCK_SENTENCES.scene((await sceneRow(scene.id)).name!)
		)
		expect((await sceneRow(scene.id)).notes!.map((n) => n.text)).toEqual(["One."])

		const named = await appendSceneNote(db(), { ...input, text: "Three.", sceneId: scene.id })
		expect(named.lockedNote).toBeDefined()
		expect((await sceneRow(scene.id)).notes).toHaveLength(1)

		await lock(scene.id, false)
		await appendSceneNote(db(), { ...input, text: "Four." })
		expect((await sceneRow(scene.id)).notes).toHaveLength(2)
	})
})

describe("the cast the code derives", () => {
	test("a line that would add someone leaves a locked open scene's cast as it was", async () => {
		const { refreshOpenSceneCast } = await import("./liveScenes")
		const w = await world()
		const tomas = await seat(w, "Tomas")
		const mira = await seat(w, "Mira")
		const scene = await open(w, await say(w, tomas))
		expect(await participantsOf(scene.id)).toEqual([tomas.member.id])
		await lock(scene.id)
		const before = (await sceneRow(scene.id)).castResolvedAt
		const miraLine = await say(w, mira, "Mira looks up.")
		expect(
			await refreshOpenSceneCast(db(), {
				sessionId: w.session.id,
				channel: "main",
				messageId: miraLine
			})
		).toBe(false)
		expect(await participantsOf(scene.id)).toEqual([tomas.member.id])
		expect((await sceneRow(scene.id)).castResolvedAt).toEqual(before)

		await lock(scene.id, false)
		expect(
			await refreshOpenSceneCast(db(), {
				sessionId: w.session.id,
				channel: "main",
				messageId: miraLine
			})
		).toBe(true)
		expect(await participantsOf(scene.id)).toEqual(
			[tomas.member.id, mira.member.id].sort((a, b) => a - b)
		)
	})

	test("closing a locked open scene closes it and leaves its cast", async () => {
		const { closeScene } = await import("./liveScenes")
		const w = await world()
		const tomas = await seat(w, "Tomas")
		const mira = await seat(w, "Mira")
		const scene = await open(w, await say(w, tomas))
		await lock(scene.id)
		const last = await say(w, mira, "Mira looks up.")
		const out = await closeScene(db(), {
			sceneId: scene.id,
			userId: w.user.id,
			atMessageId: last
		})
		expect(out.scene.closedAtMessageId).toBe(last)
		expect((await sceneRow(scene.id)).closedAtMessageId).toBe(last)
		expect(await participantsOf(scene.id)).toEqual([tomas.member.id])
	})
})

describe("the summaries that start by themselves", () => {
	test("startRoutineSceneSummary on a locked scene starts nothing and says why", async () => {
		const { startRoutineSceneSummary } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const scene = await open(w, await say(w, null))
		await lock(scene.id)
		const out = await startRoutineSceneSummary({
			sessionId: w.session.id,
			sceneId: scene.id,
			mode: "full"
		})
		expect(out).toEqual({
			started: false,
			note: RUN_LOCK_SENTENCES.scene((await sceneRow(scene.id)).name!)
		})
		expect((await sceneRow(scene.id)).summaryStatus).toBe("none")
	})

	test("the routine's save lands nothing on a scene locked while it ran, and returns the scene sentence", async () => {
		const { saveSceneSummary } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const scene = await open(w, await say(w, null))
		await testDb
			.update(schema.scenes)
			.set({ summaryStatus: "running", sceneLock: true })
			.where(eq(schema.scenes.id, scene.id))
		const out = await saveSceneSummary({
			by: "routine",
			userId: w.user.id,
			params: { scene: { id: scene.id, summary: "They talked." } },
			routine: { specId: "x", modelName: "A Name", sourceIds: [] }
		})
		expect(out.saved).toBe(false)
		expect(out.note).toBe(RUN_LOCK_SENTENCES.scene((await sceneRow(scene.id)).name!))
		const row = await sceneRow(scene.id)
		expect(row.summary).toBeNull()
		expect(row.summaryStatus).toBe("running")
	})

	test("the summaries on close leave a locked scene out", async () => {
		const { sceneIdsOpenToRuns } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const a = await open(w, await say(w, null))
		const { openScene } = await import("./liveScenes")
		const b = (
			await openScene(db(), {
				sessionId: w.session.id,
				userId: w.user.id,
				channel: "main",
				atMessageId: await say(w, null)
			})
		).scene
		await lock(a.id)
		expect(await sceneIdsOpenToRuns([a.id, b.id])).toEqual([b.id])
		expect(await sceneIdsOpenToRuns([])).toEqual([])
	})
})

describe("a person's own edit and the door", () => {
	test("a person's summary and cast save on a locked scene", async () => {
		const { sceneUpdateHandler } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const mira = await seat(w, "Mira")
		const scene = await open(w, await say(w, null))
		await lock(scene.id)
		const res = await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{
				scene: {
					id: scene.id,
					name: "Mine",
					summary: "By hand.",
					participantCharacters: [mira.member.id]
				}
			} as any,
			() => {}
		)
		expect(res.scene).toMatchObject({ name: "Mine", summary: "By hand.", sceneLock: true })
		expect(res.scene.participantCharacters).toEqual([mira.member.id])
		expect(await participantsOf(scene.id)).toEqual([mira.member.id])
	})

	test("an update carrying only sceneLock sets and clears it, even with lore writes Off, and changes nothing else", async () => {
		const { sceneUpdateHandler } = await import("$lib/server/sockets/scenes")
		const w = await world()
		const scene = await open(w, await say(w, null))
		await testDb
			.insert(schema.userSettings)
			.values({ userId: w.user.id, loreWriteMode: "off" })
		const before = await sceneRow(scene.id)
		const set = await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id: scene.id, sceneLock: true } } as any,
			() => {}
		)
		expect(set.scene.sceneLock).toBe(true)
		const locked = await sceneRow(scene.id)
		expect(locked.sceneLock).toBe(true)
		expect({ ...locked, sceneLock: false, updatedAt: before.updatedAt }).toEqual(before)
		const cleared = await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id: scene.id, sceneLock: false } } as any,
			() => {}
		)
		expect(cleared.scene.sceneLock).toBe(false)
		expect((await sceneRow(scene.id)).sceneLock).toBe(false)

		// A summary beside it is still a lore write: refused with lore writes Off.
		await expect(
			sceneUpdateHandler.handler(
				fakeSocket(w.user.id),
				{ scene: { id: scene.id, sceneLock: true, summary: "x" } } as any,
				() => {}
			)
		).rejects.toThrow()
	})

	test("someone else is refused as for any edit; the list row carries sceneLock", async () => {
		const { sceneUpdateHandler, sceneListHandler } = await import(
			"$lib/server/sockets/scenes"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await world()
		const other = await createTestUser(testDb, `scenelock-other-${++seq}`)
		const scene = await open(w, await say(w, null))
		await expect(
			sceneUpdateHandler.handler(
				fakeSocket(other.id),
				{ scene: { id: scene.id, sceneLock: true } } as any,
				() => {}
			)
		).rejects.toThrow("Scene not found or access denied.")
		expect((await sceneRow(scene.id)).sceneLock).toBe(false)

		await lock(scene.id)
		const list = await sceneListHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id },
			() => {}
		)
		const rows: any[] = (list as any).sceneList ?? (list as any)
		expect(rows.find((x) => x.id === scene.id)).toMatchObject({ sceneLock: true })
	})
})
