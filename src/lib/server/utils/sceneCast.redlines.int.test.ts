/**
 * `writeSceneCast` with `redline`: a written role whose member set changed is
 * kept as one scene row; a reorder, an unwritten role and an unchanged write
 * record nothing; a supplied `before` costs no read; without `redline` no
 * statement is added; a scene keeps 50 rows.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scenecast-redlines-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function setup(label: string, bindingCount = 4) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, label)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [historyEntry] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: lorebook.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({ lorebookId: lorebook.id, historyEntryId: historyEntry.id })
		.returning()
	const ids: number[] = []
	for (let i = 0; i < bindingCount; i++) {
		const [b] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: `{{char:${i + 1}}}`,
				name: `Char ${i + 1}`
			})
			.returning()
		ids.push(b.id)
	}
	return { user, scene, ids }
}

const rowsOf = (sceneId: number) =>
	testDb
		.select()
		.from(schema.loreRedlines)
		.where(eq(schema.loreRedlines.sceneId, sceneId))
		.orderBy(schema.loreRedlines.id)

async function statements(fn: () => Promise<void>) {
	const client = (
		testDb as unknown as { $client: { query: (...a: unknown[]) => unknown } }
	).$client
	const original = client.query.bind(client)
	let n = 0
	client.query = (...args: unknown[]) => {
		n++
		return original(...args)
	}
	try {
		await fn()
	} finally {
		client.query = original
	}
	return n
}

describe("writeSceneCast — Edit history", () => {
	test("a changed participant set records one row, in stored order", async () => {
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const { user, scene, ids } = await setup("rl-changed")
		const [a, b, c] = ids
		await writeSceneCast(scene.id, { participantCharacters: [c, a] })
		await writeSceneCast(
			scene.id,
			{ participantCharacters: [b, a, a] },
			testDb,
			{ by: { userId: user.id }, cause: "scene-compiler" }
		)
		const rows = await rowsOf(scene.id)
		expect(rows).toHaveLength(1)
		expect(rows[0].cause).toBe("scene-compiler")
		expect(rows[0].userId).toBe(user.id)
		expect(rows[0].entryId).toBeNull()
		expect(rows[0].changes).toEqual({
			participantCharacters: {
				before: { v: [c, a] },
				after: { v: [b, a] }
			}
		})
	})

	test("the same members reordered record nothing", async () => {
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const { user, scene, ids } = await setup("rl-reorder")
		await writeSceneCast(scene.id, { participantCharacters: [ids[0], ids[1]] })
		await writeSceneCast(
			scene.id,
			{ participantCharacters: [ids[1], ids[0]] },
			testDb,
			{ by: { userId: user.id }, cause: "scene-compiler" }
		)
		expect(await rowsOf(scene.id)).toHaveLength(0)
	})

	test("only the changed role is a key; an unwritten role never is", async () => {
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const { user, scene, ids } = await setup("rl-roles")
		await writeSceneCast(scene.id, {
			participantCharacters: [ids[0]],
			mentionedCharacters: [ids[1]]
		})
		await writeSceneCast(
			scene.id,
			{ participantCharacters: [ids[0]], mentionedCharacters: [ids[2]] },
			testDb,
			{ by: { userId: user.id }, cause: "scene-compiler" }
		)
		await writeSceneCast(scene.id, { participantCharacters: [ids[3]] }, testDb, {
			by: { userId: user.id },
			cause: "scene-compiler"
		})
		const rows = await rowsOf(scene.id)
		expect(rows.map((r) => Object.keys(r.changes))).toEqual([
			["mentionedCharacters"],
			["participantCharacters"]
		])
	})

	test("statement counts: none, supplied before, read before", async () => {
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const { user, scene, ids } = await setup("rl-count")
		const by = { userId: user.id }
		await writeSceneCast(scene.id, { participantCharacters: [ids[0]] })
		const plain = await statements(() =>
			writeSceneCast(scene.id, { participantCharacters: [ids[1]] })
		)
		const supplied = await statements(() =>
			writeSceneCast(scene.id, { participantCharacters: [ids[2]] }, testDb, {
				by,
				cause: "scene-compiler",
				before: { participantCharacters: [ids[1]] }
			})
		)
		const read = await statements(() =>
			writeSceneCast(scene.id, { participantCharacters: [ids[3]] }, testDb, {
				by,
				cause: "scene-compiler"
			})
		)
		expect(plain).toBe(2)
		expect(supplied).toBe(4)
		expect(read).toBe(5)
		expect(await rowsOf(scene.id)).toHaveLength(2)
	})

	test("51 changes keep 50 rows", async () => {
		const { writeSceneCast } = await import("$lib/server/utils/sceneCast")
		const { scene, ids } = await setup("rl-limit", 2)
		for (let i = 0; i < 51; i++)
			await writeSceneCast(
				scene.id,
				{ participantCharacters: [ids[i % 2]] },
				testDb,
				{ by: { run: { sessionId: 1, messageId: null, runId: null, shownAs: null } }, cause: "scene-compiler", before: { participantCharacters: [ids[(i + 1) % 2]] } }
			)
		expect(await rowsOf(scene.id)).toHaveLength(50)
	})
})
