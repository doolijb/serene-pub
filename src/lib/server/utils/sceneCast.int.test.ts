/**
 * Scene cast as FK rows rather than untyped JSON arrays.
 *
 * The arrays this replaces had no FK, no type constraint and no index, and
 * each gap produced a real bug: a deleted binding left a dangling id that
 * every consumer had to warn-and-skip; the column could hold ids OR pre-merge
 * name strings, so "is this cast resolved?" was answered by sniffing shapes at
 * runtime; and "which scenes feature X" meant loading every scene and
 * filtering in JS. These tests pin what the constraints now guarantee.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-scenecast-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function setup(label: string, bindingCount = 3) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, label)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: label, userId: user.id })
		.returning()
	const [historyEntry] = await testDb
		.insert(schema.historyEntries)
		.values({ lorebookId: lorebook.id })
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({ lorebookId: lorebook.id, historyEntryId: historyEntry.id })
		.returning()
	const bindings = []
	for (let i = 0; i < bindingCount; i++) {
		const [b] = await testDb
			.insert(schema.lorebookBindings)
			.values({
				lorebookId: lorebook.id,
				binding: `{{char:${i + 1}}}`,
				name: `Char ${i + 1}`
			})
			.returning()
		bindings.push(b)
	}
	return { user, lorebook, historyEntry, scene, bindings }
}

describe("sceneCast — round-trip and ordering", () => {
	test("writes and reads back both roles, preserving order", async () => {
		const { readSceneCast, writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-roundtrip")
		const [a, b, c] = bindings

		// Deliberately not ascending by id — order is the caller's, not the
		// database's, because export bytes are compared on re-import.
		await writeSceneCast(scene.id, {
			participantCharacters: [c.id, a.id],
			mentionedCharacters: [b.id]
		})

		const cast = await readSceneCast(scene.id)
		expect(cast.participantCharacters).toEqual([c.id, a.id])
		expect(cast.mentionedCharacters).toEqual([b.id])
	})

	test("a binding may hold BOTH roles — this is why the unique index includes role", async () => {
		const { readSceneCast, writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-both-roles")
		const [a] = bindings

		await writeSceneCast(scene.id, {
			participantCharacters: [a.id],
			mentionedCharacters: [a.id]
		})

		const cast = await readSceneCast(scene.id)
		expect(cast.participantCharacters).toEqual([a.id])
		expect(cast.mentionedCharacters).toEqual([a.id])
	})

	test("writing replaces wholesale rather than appending", async () => {
		const { readSceneCast, writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-replace")
		const [a, b] = bindings

		await writeSceneCast(scene.id, { participantCharacters: [a.id, b.id] })
		await writeSceneCast(scene.id, { participantCharacters: [b.id] })

		const cast = await readSceneCast(scene.id)
		expect(cast.participantCharacters).toEqual([b.id])
	})

	test("a repeated id collapses to one row", async () => {
		const { readSceneCast, writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-dupe")
		const [a] = bindings

		await writeSceneCast(scene.id, {
			participantCharacters: [a.id, a.id, a.id]
		})

		expect((await readSceneCast(scene.id)).participantCharacters).toEqual([
			a.id
		])
	})
})

describe("sceneCast — referential integrity (what the FK buys)", () => {
	test("deleting a binding removes its appearances and leaves others intact", async () => {
		const { readSceneCast, writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-cascade-binding")
		const [a, b] = bindings

		await writeSceneCast(scene.id, {
			participantCharacters: [a.id, b.id],
			mentionedCharacters: [a.id]
		})
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, a.id))

		// Previously this left a dangling id in a JSON array forever, which is
		// why graphBuilder had a silent warn-and-skip path and deleteNode had
		// to hand-clean every scene in the lorebook.
		const cast = await readSceneCast(scene.id)
		expect(cast.participantCharacters).toEqual([b.id])
		expect(cast.mentionedCharacters).toEqual([])
	})

	test("deleting a scene removes its cast rows", async () => {
		const { writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-cascade-scene")

		await writeSceneCast(scene.id, {
			participantCharacters: [bindings[0].id]
		})
		await testDb.delete(schema.scenes).where(eq(schema.scenes.id, scene.id))

		const rows = await testDb
			.select()
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		expect(rows).toHaveLength(0)
	})

	test("a binding id that does not exist is rejected, not silently stored", async () => {
		const { writeSceneCast } = await import("./sceneCast")
		const { scene, bindings } = await setup("cast-fk-reject")

		await expect(
			writeSceneCast(scene.id, {
				participantCharacters: [bindings[0].id + 999_999]
			})
		).rejects.toThrow()
	})
})

describe("sceneCast — repoint (absorb/merge)", () => {
	test("moves the absorbed binding's appearances onto the survivor", async () => {
		const { readSceneCast, repointSceneCast, writeSceneCast } =
			await import("./sceneCast")
		const { lorebook, scene, bindings } = await setup("cast-repoint")
		const [absorbed, survivor, other] = bindings

		await writeSceneCast(scene.id, {
			participantCharacters: [absorbed.id, other.id],
			mentionedCharacters: [absorbed.id]
		})
		await repointSceneCast(lorebook.id, absorbed.id, survivor.id)

		const cast = await readSceneCast(scene.id)
		expect(cast.participantCharacters.sort()).toEqual(
			[survivor.id, other.id].sort()
		)
		expect(cast.mentionedCharacters).toEqual([survivor.id])
	})

	test("when the survivor already occupies the slot, the duplicate is dropped rather than inserted", async () => {
		const { readSceneCast, repointSceneCast, writeSceneCast } =
			await import("./sceneCast")
		const { lorebook, scene, bindings } = await setup("cast-repoint-dupe")
		const [absorbed, survivor] = bindings

		await writeSceneCast(scene.id, {
			participantCharacters: [absorbed.id, survivor.id]
		})
		await repointSceneCast(lorebook.id, absorbed.id, survivor.id)

		// The old code deduped with `new Set(...)` after remapping in JS; the
		// unique index enforces it now, so repoint must delete rather than
		// collide.
		expect((await readSceneCast(scene.id)).participantCharacters).toEqual([
			survivor.id
		])
	})

	test("does not touch scenes in another lorebook", async () => {
		const { readSceneCast, repointSceneCast, writeSceneCast } =
			await import("./sceneCast")
		const one = await setup("cast-repoint-scope-a")
		const two = await setup("cast-repoint-scope-b")

		await writeSceneCast(two.scene.id, {
			participantCharacters: [two.bindings[0].id]
		})
		await repointSceneCast(
			one.lorebook.id,
			two.bindings[0].id,
			one.bindings[1].id
		)

		expect((await readSceneCast(two.scene.id)).participantCharacters).toEqual(
			[two.bindings[0].id]
		)
	})
})

describe("sceneCast — batch read", () => {
	test("reads many scenes in one query and omits scenes with no cast", async () => {
		const { readSceneCasts, castFor, writeSceneCast } = await import(
			"./sceneCast"
		)
		const { lorebook, historyEntry, scene, bindings } =
			await setup("cast-batch")
		const [other] = await testDb
			.insert(schema.scenes)
			.values({
				lorebookId: lorebook.id,
				historyEntryId: historyEntry.id
			})
			.returning()

		await writeSceneCast(scene.id, {
			participantCharacters: [bindings[0].id]
		})

		const casts = await readSceneCasts([scene.id, other.id])
		expect(castFor(casts, scene.id).participantCharacters).toEqual([
			bindings[0].id
		])
		// A scene with no rows reads as an empty cast, not undefined.
		expect(castFor(casts, other.id)).toEqual({
			participantCharacters: [],
			mentionedCharacters: []
		})
	})
})
