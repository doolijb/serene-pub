/**
 * 🚧 `appendSceneNote` (`core:outlet/note-scene@1`, ★S4): a note lands on the
 * open scene (or a named one), never writes history or messages, and refuses
 * in words.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let ownerId: number
const db = () => testDb as unknown as Db
const REFERENCE_GENRE = "chariot.desk:inlet/reference@1"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-scene-notes-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/reference",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Reference Desk" } },
		ports: {},
		sessionShape: {
			composer: "text",
			lorebook: "optional",
			writes: { lore: false, scenes: false }
		}
	} as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "scene-notes-owner")).id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeWorld(genreId?: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Scene Notes Book ${++seq}`, userId: ownerId })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook!.id,
			...(genreId ? { genreId } : {}),
			metadata: {}
		})
		.returning()
	return { session: session!, lorebook: lorebook! }
}

async function say(sessionId: number, channel = "main") {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(testDb as any, { sessionId, role: "user", content: "A line.", channel } as any)
}

async function open(sessionId: number, atMessageId: number, channel = "main") {
	const { openScene } = await import("./liveScenes")
	return openScene(db(), { sessionId, userId: ownerId, atMessageId, channel })
}

const sceneRow = async (id: number) =>
	(await testDb.select().from(schema.scenes).where(eq(schema.scenes.id, id)))[0]!

async function note(input: Record<string, unknown> & { sessionId: number }) {
	const { appendSceneNote } = await import("./liveScenes")
	return appendSceneNote(db(), { text: "A note.", runId: null, messageId: null, ...input })
}

async function refusal(p: Promise<unknown>, sentence: string) {
	const { SceneBoundaryRefusal } = await import("./liveScenes")
	const err = await p.then(
		() => null,
		(e: unknown) => e
	)
	expect(err).toBeInstanceOf(SceneBoundaryRefusal)
	expect((err as Error).message).toBe(sentence)
}

const counts = async (sessionId: number, bookId: number) => ({
	messages: (
		await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
	).length,
	entries: (
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
	).length
})

describe("appendSceneNote", () => {
	it("appends to the open scene on main, in order, and adds no message or entry", async () => {
		const w = await makeWorld()
		const m = await say(w.session.id)
		const scene = (await open(w.session.id, m.id)).scene
		const before = await counts(w.session.id, w.lorebook.id)
		const first = await note({ sessionId: w.session.id, text: "  The king died.  ", runId: "r1", messageId: m.id })
		const second = await note({ sessionId: w.session.id, text: "A treaty.", runId: "r2", messageId: null })
		expect(first.sceneId).toBe(scene.id)
		expect(second.sceneId).toBe(scene.id)
		const notes = (await sceneRow(scene.id)).notes!
		expect(notes.map((n) => n.text)).toEqual(["The king died.", "A treaty."])
		expect(notes[0]).toMatchObject({ runId: "r1", messageId: m.id })
		expect(notes[1]).toMatchObject({ runId: "r2", messageId: null })
		for (const n of notes) expect(new Date(n.at).toISOString()).toBe(n.at)
		expect(second.notes).toHaveLength(2)
		expect(await counts(w.session.id, w.lorebook.id)).toEqual(before)
	})

	it("lands on another channel's open scene, not main's", async () => {
		const w = await makeWorld()
		const a = await say(w.session.id)
		const b = await say(w.session.id, "side")
		const mainScene = (await open(w.session.id, a.id)).scene
		const sideScene = (await open(w.session.id, b.id, "side")).scene
		const out = await note({ sessionId: w.session.id, channel: "side" })
		expect(out.sceneId).toBe(sideScene.id)
		expect((await sceneRow(mainScene.id)).notes).toBeNull()
		expect((await sceneRow(sideScene.id)).notes).toHaveLength(1)
	})

	it("a named closed scene and a named compiled scene take the note", async () => {
		const w = await makeWorld()
		const a = await say(w.session.id)
		const b = await say(w.session.id)
		const first = (await open(w.session.id, a.id)).scene
		await open(w.session.id, b.id) // closes the first
		expect((await sceneRow(first.id)).closedAtMessageId).not.toBeNull()
		await note({ sessionId: w.session.id, sceneId: first.id })
		expect((await sceneRow(first.id)).notes).toHaveLength(1)

		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.lorebook.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: 1,
				content: "",
				fields: {}
			} as any)
			.returning()
		await testDb.update(schema.scenes).set({ historyEntryId: entry!.id }).where(eq(schema.scenes.id, first.id))
		await note({ sessionId: w.session.id, sceneId: String(first.id), text: "Again." })
		const row = await sceneRow(first.id)
		expect(row.notes).toHaveLength(2)
		expect(row.historyEntryId).toBe(entry!.id)
	})

	it("refuses in words", async () => {
		const w = await makeWorld()
		await refusal(note({ sessionId: w.session.id, text: "   " }), "a note needs text.")
		await refusal(
			note({ sessionId: w.session.id }),
			"no scene is open to note; open one first (propose-scene-cue@1)."
		)
		await refusal(note({ sessionId: w.session.id, sceneId: 999999 }), "there is no scene 999999.")

		const other = await makeWorld()
		const m = await say(other.session.id)
		const theirs = (await open(other.session.id, m.id)).scene
		await refusal(
			note({ sessionId: w.session.id, sceneId: theirs.id }),
			"that scene belongs to another session."
		)

		const ref = await makeWorld(REFERENCE_GENRE)
		await refusal(note({ sessionId: ref.session.id }), "this genre keeps no scenes.")
	})
})

describe("takeSceneNotesAt", () => {
	async function world() {
		const w = await makeWorld()
		const a = await say(w.session.id)
		const b = await say(w.session.id)
		const scene = (await open(w.session.id, a.id)).scene
		await note({ sessionId: w.session.id, text: "Mine 1", runId: "r1", messageId: b.id })
		await note({ sessionId: w.session.id, text: "Theirs", runId: "r0", messageId: a.id })
		await note({ sessionId: w.session.id, text: "Mine 2", runId: "r1", messageId: b.id })
		return { w, a, b, scene }
	}
	const texts = async (id: number) => ((await sceneRow(id)).notes ?? []).map((n) => n.text)

	it("takes only that message's notes; another message's stays", async () => {
		const { b, scene } = await world()
		const { takeSceneNotesAt } = await import("./liveScenes")
		const taken = await takeSceneNotesAt(db(), b.id)
		expect(taken).toHaveLength(1)
		expect(taken[0]!.sceneId).toBe(scene.id)
		expect(taken[0]!.notes.map((n) => n.text)).toEqual(["Mine 1", "Mine 2"])
		expect(await texts(scene.id)).toEqual(["Theirs"])
	})

	it("Back takes them, Forward restores in order without doubling", async () => {
		const { w, b, scene } = await world()
		const { retractStateAnchoredTo, restoreRetractedState } = await import("$lib/server/state/write")
		const out = await retractStateAnchoredTo(db(), b.id, "leaves")
		expect(out.changed).toBe(true)
		expect(await texts(scene.id)).toEqual(["Theirs"])
		await restoreRetractedState(db(), out.taken)
		expect(await texts(scene.id)).toEqual(["Theirs", "Mine 1", "Mine 2"])
		await restoreRetractedState(db(), out.taken)
		expect((await texts(scene.id)).filter((t) => t === "Mine 1")).toHaveLength(1)
		expect(w.session.id).toBeGreaterThan(0)
	})

	it("a replacement (no scenes: take) takes them too", async () => {
		const { b, scene } = await world()
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		await retractStateAnchoredTo(db(), b.id, "replaced")
		expect(await texts(scene.id)).toEqual(["Theirs"])
	})

	it("a delete removes them", async () => {
		const { b, scene } = await world()
		const { deleteLegacyWhere } = await import("$lib/server/messages/store")
		await deleteLegacyWhere(db(), eq(schema.sessionMessages.id, b.id))
		expect(await texts(scene.id)).toEqual(["Theirs"])
	})
})
