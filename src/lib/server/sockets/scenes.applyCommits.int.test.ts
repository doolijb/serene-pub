/**
 * pr-6 (B §B-7, R-b): an APPLIED scene summary commits — one `lore_sources`
 * row (`scene`), the settle line moved to the scene's newest line, and
 * `scene-summary-applied` announced once. A later plain edit of the same
 * summary records nothing more. Only `emitSessionEvent` is watched (the event
 * is off the ledger); everything else runs for real.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues, insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const emitted: Array<{ event: string; payload: any }> = []
vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => {
	const original = await importOriginal<typeof import("$lib/server/pipelines/runtime/sessionEvents")>()
	return {
		...original,
		emitSessionEvent: async (db: any, args: any) => {
			emitted.push({ event: args.event, payload: args.payload })
			return original.emitSessionEvent(db, args)
		}
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), dbReady: Promise.resolve() }
})

let testDb: TestDb
beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const quiet = () => {}

let seq = 0
async function makeScene() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scenes-apply-commits-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Apply Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }]))
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id } as any)
		.returning()
	const m1 = await insertSessionMessageRow(testDb, session.id, { content: "Meet me at the gate." })
	const m2 = await insertSessionMessageRow(testDb, session.id, { role: "assistant", content: "I waited." })
	const m3 = await insertSessionMessageRow(testDb, session.id, { content: "A later line." })
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: lorebook.id,
			sessionId: session.id,
			historyEntryId: history.id,
			name: "Scene 1",
			channel: "main",
			openedAtMessageId: m1.id,
			closedAtMessageId: m2.id,
			selectedMessageIds: [m1.id, m2.id]
		} as any)
		.returning()
	return { user, lorebook, session, scene, m1, m2, m3, history }
}

const update = async (userId: number, scene: { id: number }, summary: string, extra: Record<string, unknown> = {}) => {
	const { sceneUpdateHandler } = await import("./scenes")
	return sceneUpdateHandler.handler(
		fakeSocket(userId),
		{ scene: { id: scene.id, summary }, ...extra } as any,
		quiet
	)
}

const applied = () => emitted.filter((e) => e.event === "core:event/scene-summary-applied@1")

describe("scenes:update — an applied summary commits", () => {
	test("records one lore_sources row, moves the settle line to the scene's newest line, announces once; a plain edit records nothing more", async () => {
		const w = await makeScene()
		emitted.length = 0

		await update(w.user.id, w.scene, "They talked by the gate until dark.")

		const rows = await testDb.select().from(schema.loreSources).where(eq(schema.loreSources.sessionId, w.session.id))
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			subjectKind: "scene",
			subjectId: w.scene.id,
			lorebookId: w.lorebook.id,
			fromMessageId: w.m1.id,
			throughMessageId: w.m2.id
		})
		const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(session.settledMessageId).toBe(w.m2.id)
		expect(applied()).toHaveLength(1)
		expect(applied()[0]!.payload).toMatchObject({
			sceneId: w.scene.id,
			entryId: w.history.id,
			loreSources: { fromMessageId: w.m1.id, throughMessageId: w.m2.id },
			cause: { kind: "user", userId: w.user.id }
		})

		// A second, plain edit of the same summary: the summary was already done.
		await update(w.user.id, w.scene, "They talked by the gate until dark, and parted.")
		expect(await testDb.select().from(schema.loreSources).where(eq(schema.loreSources.sessionId, w.session.id))).toHaveLength(1)
		expect(applied()).toHaveLength(1)
	})

	test("a summary cleared records nothing", async () => {
		const w = await makeScene()
		emitted.length = 0
		await update(w.user.id, w.scene, "   ")
		expect(await testDb.select().from(schema.loreSources).where(eq(schema.loreSources.sessionId, w.session.id))).toHaveLength(0)
		expect(applied()).toHaveLength(0)
	})

	test("sceneLoreSourcesOf folds the recorded span with the through line's write time; a scene with none is absent", async () => {
		const { sceneLoreSourcesOf } = await import("$lib/server/scenes/liveScenes")
		const w = await makeScene()
		const bare = await makeScene()
		await update(w.user.id, w.scene, "They talked by the gate until dark.")
		const got = await sceneLoreSourcesOf(testDb as any, [w.scene.id, bare.scene.id])
		expect(got.size).toBe(1) // the bare scene is absent
		const src = got.get(w.scene.id)!
		expect(src).toMatchObject({ fromMessageId: w.m1.id, throughMessageId: w.m2.id })
		// The fixture's lines are legacy-only rows, with no mirror to time them.
		expect(src.throughAt).toBeNull()
		// A line written through the message store has its mirror row's time.
		const { insertLegacy } = await import("$lib/server/messages/store")
		const line = await insertLegacy(testDb as any, { sessionId: w.session.id, role: "user", content: "Timed." } as any)
		await testDb.insert(schema.loreSources).values({
			sessionId: w.session.id,
			lorebookId: w.lorebook.id,
			subjectKind: "scene",
			subjectId: bare.scene.id,
			fromMessageId: w.m1.id,
			throughMessageId: line.id
		})
		const timed = (await sceneLoreSourcesOf(testDb as any, [bare.scene.id])).get(bare.scene.id)!
		expect(timed.throughMessageId).toBe(line.id)
		expect(Number.isNaN(Date.parse(timed.throughAt!))).toBe(false)
		expect((await sceneLoreSourcesOf(testDb as any, [])).size).toBe(0)
	})
})
