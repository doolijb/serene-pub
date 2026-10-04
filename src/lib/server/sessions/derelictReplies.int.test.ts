/**
 * A derelict reply: a message row still marked generating whose run died with
 * the process that ran it (a crash, a kill, a power cut). Nothing in the new
 * process is filling it, and the embedding queue never embeds a generating row
 * — so, unsettled, it says "generating" until someone presses Stop, blocks
 * every Regenerate, Continue and swipe in its session ("a response is already
 * generating"), and never reaches the index.
 *
 * Boot settles it (plan A9 leftover): the row keeps the text that arrived, is
 * told why it stopped, and is handed to the embedding queue, which embeds it
 * under the content-hash rule — once, and not at all when its vector already
 * holds that text or when no text arrived. A row the current process is
 * generating is never touched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertSessionMessageRow } from "$lib/server/pipelines/testing/fixtures"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/** Every text handed to the embedding model, in order. */
const embedded: string[] = []
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		embed: async (text: string) => {
			embedded.push(text)
			return [1, 0, 0]
		},
		getLoadedModelId: () => "test-model",
		isModelReady: () => true
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-derelict-replies-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** Run the queue's picker dry; the message texts it paid for. */
async function paidForMessages(): Promise<string[]> {
	const { pickNextItem } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	embedded.length = 0
	const texts: string[] = []
	for (let i = 0; i < 100; i++) {
		const item = await pickNextItem("test-model")
		if (!item) return texts
		const before = embedded.length
		await item.process()
		if (item.ref.source === "message") texts.push(...embedded.slice(before))
	}
	throw new Error("the queue never ran dry")
}

/** The row as the process before this one last wrote it. */
const writtenBeforeBoot = (id: number) =>
	testDb.execute(
		sql`update session_messages set updated_at = now() - interval '1 hour' where id = ${id}`
	)

/** This process's boot, a minute ago: everything written since is its own. */
const bootedAt = () => new Date(Date.now() - 60_000)

const rowOf = async (id: number) =>
	(await testDb.query.sessionMessages.findFirst({
		where: eq(schema.sessionMessages.id, id)
	}))!

let sessionId: number
let otherSessionId: number

beforeAll(async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "derelict-replies")
	const sessions = await testDb
		.insert(schema.sessions)
		.values([
			{ userId: user.id, isGroup: false, name: "Harbor" },
			{ userId: user.id, isGroup: false, name: "Crypt" }
		])
		.returning()
	sessionId = sessions[0]!.id
	otherSessionId = sessions[1]!.id
	await insertSessionMessageRow(testDb, sessionId, {
		content: "Open the door."
	})
	// Everything already in the book is embedded before each case counts.
	await paidForMessages()
})

describe("a reply left generating by the process before", () => {
	test("is settled with what arrived and why it stopped, and embedded once", async () => {
		const { settleDerelictReplies } = await import("./derelictReplies")
		const derelict = await insertSessionMessageRow(testDb, sessionId, {
			role: "assistant",
			content: "The door creaks and",
			isGenerating: true,
			generationStatus: { en: "Maren is typing" } as any,
			queueItemId: "gone-with-the-process"
		})
		await writtenBeforeBoot(derelict.id)
		// As it stood: never embedded, whatever the queue does.
		expect(await paidForMessages()).toEqual([])

		const settled = await settleDerelictReplies(testDb, bootedAt())

		expect(settled).toEqual([{ id: derelict.id, sessionId }])
		const row = await rowOf(derelict.id)
		expect(row.isGenerating).toBe(false)
		expect(row.content).toBe("The door creaks and")
		expect(row.generationStatus).toBeNull()
		expect(row.queueItemId).toBeNull()
		expect(row.error).toEqual({
			message: "The server restarted before this reply finished."
		})

		expect(await paidForMessages()).toEqual(["The door creaks and"])
		expect(await paidForMessages()).toEqual([])
		// Settling again finds nothing: it is settled once.
		expect(await settleDerelictReplies(testDb, bootedAt())).toEqual([])
	})

	test("costs no embed when its vector already holds the text it kept", async () => {
		const { settleDerelictReplies } = await import("./derelictReplies")
		const said = await insertSessionMessageRow(testDb, sessionId, {
			role: "assistant",
			content: "The lamp is lit."
		})
		expect(await paidForMessages()).toEqual(["The lamp is lit."])
		// Continue pressed, and the process died before a word arrived.
		await testDb
			.update(schema.sessionMessages)
			.set({ isGenerating: true })
			.where(eq(schema.sessionMessages.id, said.id))
		await writtenBeforeBoot(said.id)

		expect(await settleDerelictReplies(testDb, bootedAt())).toEqual([
			{ id: said.id, sessionId }
		])
		expect(await paidForMessages()).toEqual([])
	})

	test("costs no embed when it was cut off before its first word", async () => {
		const { settleDerelictReplies } = await import("./derelictReplies")
		// Still waiting in the queue when the process died: nothing arrived.
		const empty = await insertSessionMessageRow(testDb, sessionId, {
			role: "assistant",
			content: "",
			isGenerating: true
		})
		await writtenBeforeBoot(empty.id)

		expect(await settleDerelictReplies(testDb, bootedAt())).toEqual([
			{ id: empty.id, sessionId }
		])
		expect((await rowOf(empty.id)).error).toEqual({
			message: "The server restarted before this reply finished."
		})
		expect(await paidForMessages()).toEqual([])
	})

	test("a reply this process is generating is left alone", async () => {
		const { settleDerelictReplies } = await import("./derelictReplies")
		const live = await insertSessionMessageRow(testDb, sessionId, {
			role: "assistant",
			content: "Still",
			isGenerating: true
		})

		expect(await settleDerelictReplies(testDb, bootedAt())).toEqual([])
		const row = await rowOf(live.id)
		expect(row.isGenerating).toBe(true)
		expect(row.error).toBeNull()
		expect(await paidForMessages()).toEqual([])
		await testDb
			.delete(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, live.id))
	})
})

describe("boot", () => {
	test("hands every session it settled a reply in to the embedding queue, once each", async () => {
		const { reconcileDerelictReplies } = await import("./derelictReplies")
		for (const [session, content] of [
			[sessionId, "One"],
			[sessionId, "Two"],
			[otherSessionId, "Three"]
		] as const) {
			const row = await insertSessionMessageRow(testDb, session, {
				role: "assistant",
				content,
				isGenerating: true
			})
			await writtenBeforeBoot(row.id)
		}
		const enqueued: number[] = []

		await reconcileDerelictReplies({
			db: testDb,
			bootedAt: bootedAt(),
			enqueue: async (id) => {
				enqueued.push(id)
			}
		})

		expect(enqueued.sort()).toEqual([sessionId, otherSessionId].sort())
		expect((await paidForMessages()).sort()).toEqual([
			"One",
			"Three",
			"Two"
		])
	})
})
