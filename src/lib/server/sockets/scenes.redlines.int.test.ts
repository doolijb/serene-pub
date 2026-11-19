/**
 * A scene's Edit history through the real handlers: the list as its asker
 * reads it (names, the form's labels, who), who may read and restore it,
 * Restore through the scene's own save, and the book's count and clear.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { primerRowEditRefusal } from "$lib/shared/lorebooks/primerRow"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import { recordRedline } from "$lib/server/lorebooks/redlines"
import { readSceneCast } from "$lib/server/utils/sceneCast"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0
const R = schema.loreRedlines
const db = () => testDb as unknown as Db

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scene-redlines-socket-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit() {} }) } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	return {
		sent,
		emit: ((event: string, data: any) =>
			void sent.push({ event, data })) as any
	}
}

/** An owner, a book with three members, a scene (optionally of a session), and a stranger. */
async function world(opts: { fromSession?: boolean; writesOff?: boolean } = {}) {
	const tag = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `srs-${tag}`)
	const stranger = await createTestUser(testDb, `srs-stranger-${tag}`)
	const reader = await createTestUser(testDb, `srs-reader-${tag}`)
	if (opts.writesOff)
		await testDb
			.insert(schema.userSettings)
			.values({ userId: user.id, loreWriteMode: "off" })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${tag}` })
		.returning()
	await testDb
		.insert(schema.lorebookShares)
		.values({ lorebookId: book!.id, userId: reader.id })
	const member = async (name: string, binding: string) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({ lorebookId: book!.id, name, binding })
				.returning()
		)[0]!
	const ada = await member("Ada", `{{char:ada-${tag}}}`)
	const bram = await member("Bram", `{{char:bram-${tag}}}`)
	const cleo = await member("", `{{char:cleo-${tag}}}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: book!.id,
			name: `Evening ${tag}`
		})
		.returning()
	const [message] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			userId: user.id,
			role: "user",
			content: "Hello."
		} as any)
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book!.id }]))
		.returning()
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: book!.id,
			historyEntryId: history!.id,
			name: "Scene",
			...(opts.fromSession
				? { sessionId: session!.id, selectedMessageIds: [message!.id] }
				: {})
		})
		.returning()
	return { user, stranger, reader, book: book!, ada, bram, cleo, session: session!, scene: scene! }
}
type World = Awaited<ReturnType<typeof world>>

const rowsOf = (sceneId: number) =>
	testDb.select().from(R).where(eq(R.sceneId, sceneId)).orderBy(R.id)

const saveCast = async (
	w: World,
	cast: { participantCharacters?: number[]; mentionedCharacters?: number[] }
) => {
	const { sceneUpdateHandler } = await import("./scenes")
	return sceneUpdateHandler.handler(
		socketOf(w.user.id),
		{ scene: { id: w.scene.id, ...cast } } as any,
		recorder().emit
	)
}

const list = async (userId: number, sceneId: number) => {
	const { sceneRedlinesHandler } = await import("./redlines")
	const r = recorder()
	const result = sceneRedlinesHandler.handler(socketOf(userId), { sceneId }, r.emit)
	return { r, result }
}

const restore = async (userId: number, redlineId: number) => {
	const { sceneRestoreRedlineHandler } = await import("./redlines")
	const r = recorder()
	const result = sceneRestoreRedlineHandler.handler(
		socketOf(userId),
		{ redlineId },
		r.emit
	)
	return { r, result }
}

describe("a scene's Edit history list", () => {
	test("names, the form's labels, who, newest first, and a gone member", async () => {
		const w = await world()
		await saveCast(w, { participantCharacters: [w.ada.id] })
		await saveCast(w, {
			participantCharacters: [w.ada.id, w.cleo.id],
			mentionedCharacters: [w.bram.id]
		})
		await recordRedline(db(), {
			sceneId: w.scene.id,
			before: { participantCharacters: [w.ada.id, w.cleo.id] },
			after: { participantCharacters: [w.cleo.id] },
			keys: ["participantCharacters"],
			cause: "scene-compiler",
			by: { sessionId: w.session.id }
		})
		await testDb.delete(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, w.bram.id))

		const { r, result } = await list(w.user.id, w.scene.id)
		const res = await result
		expect(res).toMatchObject({
			sceneId: w.scene.id,
			lorebookId: w.book.id,
			canRestore: true
		})
		expect(res.redlines).toHaveLength(3)
		const [newest, middle, oldest] = res.redlines
		expect(newest!.who).toBe(`By itself, from ${w.session.name}`)
		expect(newest!.cause).toBe("scene-compiler")
		expect(newest!.changes).toEqual([
			expect.objectContaining({
				key: "participantCharacters",
				label: "Present",
				before: ["Ada", expect.stringContaining("cleo")],
				after: [expect.stringContaining("cleo")]
			})
		])
		expect(middle!.who).toBe("You")
		const mentioned = middle!.changes.find((c) => c.key === "mentionedCharacters")!
		expect(mentioned.label).toBe("Mentioned")
		expect(mentioned.after).toEqual(["a cast member no longer in this lorebook"])
		expect(oldest!.changes[0]).toMatchObject({
			label: "Present",
			before: [],
			after: ["Ada"]
		})
		expect(r.sent.map((s) => s.event)).toEqual(["scenes:redlines"])
		expect(r.sent[0]!.data.lorebookId).toBe(w.book.id)
	})

	test("a shared reader and a stranger are refused, reading and restoring", async () => {
		const w = await world()
		await saveCast(w, { participantCharacters: [w.ada.id] })
		const [row] = await rowsOf(w.scene.id)
		for (const who of [w.reader, w.stranger]) {
			const { result } = await list(who.id, w.scene.id)
			await expect(result).rejects.toThrow("Scene not found or access denied.")
			const attempt = await restore(who.id, row!.id)
			await expect(attempt.result).rejects.toThrow(
				"Scene not found or access denied."
			)
		}
		expect((await readSceneCast(w.scene.id)).participantCharacters).toEqual([
			w.ada.id
		])
	})
})

describe("Restore", () => {
	test("brings the earlier participants back, keeps the mentioned list, drops a deleted member, records one restore row", async () => {
		const w = await world()
		await saveCast(w, {
			participantCharacters: [w.ada.id, w.cleo.id],
			mentionedCharacters: [w.bram.id]
		})
		await saveCast(w, {
			participantCharacters: [w.bram.id],
			mentionedCharacters: [w.bram.id]
		})
		const rows = await rowsOf(w.scene.id)
		const change = rows.find(
			(x) =>
				(x.changes as Record<string, { after?: { v?: unknown[] } }>).participantCharacters?.after?.v?.[0] === w.bram.id
		)!
		expect(change.changes.mentionedCharacters).toBeUndefined()
		await testDb.delete(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, w.cleo.id))
		const before = (await rowsOf(w.scene.id)).length

		const { r, result } = await restore(w.user.id, change.id)
		const res = await result
		expect(res).toEqual({
			redlineId: change.id,
			sceneId: w.scene.id,
			lorebookId: w.book.id
		})
		const cast = await readSceneCast(w.scene.id)
		expect(cast.participantCharacters).toEqual([w.ada.id])
		expect(cast.mentionedCharacters).toEqual([w.bram.id])
		const after = await rowsOf(w.scene.id)
		const added = after.slice(before).filter((x) => x.cause === "restore")
		expect(added).toHaveLength(1)
		expect(added[0]!.userId).toBe(w.user.id)
		expect(r.sent.map((s) => s.event)).toEqual(
			expect.arrayContaining([
				"scenes:update",
				"scenes:restoreRedline",
				"scenes:redlines"
			])
		)
		expect(r.sent.find((s) => s.event === "scenes:update")!.data.scene.id).toBe(
			w.scene.id
		)
		expect(
			r.sent.find((s) => s.event === "scenes:restoreRedline")!.data.lorebookId
		).toBe(w.book.id)
	})

	test("on a lore-writes-Off session's scene it is refused with that sentence", async () => {
		const w = await world({ fromSession: true, writesOff: true })
		await recordRedline(db(), {
			sceneId: w.scene.id,
			before: { participantCharacters: [] },
			after: { participantCharacters: [w.ada.id] },
			keys: ["participantCharacters"],
			cause: "save",
			by: { userId: w.user.id }
		})
		const [row] = await rowsOf(w.scene.id)
		const { r, result } = await restore(w.user.id, row!.id)
		await expect(result).rejects.toThrow()
		expect(
			r.sent.find((s) => s.event === "scenes:restoreRedline:error")!.data.error
		).toBe(LORE_WRITES_OFF)
	})

	test("a person's Restore on a locked scene succeeds and records a restore row", async () => {
		const w = await world()
		await saveCast(w, { participantCharacters: [w.ada.id] })
		await saveCast(w, { participantCharacters: [w.bram.id] })
		const rows = await rowsOf(w.scene.id)
		const first = rows[1]!
		await testDb
			.update(schema.scenes)
			.set({ sceneLock: true })
			.where(eq(schema.scenes.id, w.scene.id))
		const { result } = await restore(w.user.id, first.id)
		await result
		expect((await readSceneCast(w.scene.id)).participantCharacters).toEqual([
			w.ada.id
		])
		const added = (await rowsOf(w.scene.id)).slice(rows.length)
		expect(added.filter((x) => x.cause === "restore")).toHaveLength(1)
	})

	test("a session's notes lorebook: its owner reads and restores, a guest of the session is refused both", async () => {
		const w = await world({ fromSession: true })
		await testDb
			.update(schema.lorebooks)
			.set({ sessionId: w.session.id })
			.where(eq(schema.lorebooks.id, w.book.id))
		await recordRedline(db(), {
			sceneId: w.scene.id,
			before: { participantCharacters: [] },
			after: { participantCharacters: [w.ada.id] },
			keys: ["participantCharacters"],
			cause: "save",
			by: { userId: w.user.id }
		})
		const [row] = await rowsOf(w.scene.id)
		const res = await (await list(w.user.id, w.scene.id)).result
		expect(res.redlines).toHaveLength(1)
		expect(res.canRestore).toBe(true)
		for (const guest of [w.reader, w.stranger]) {
			await expect((await list(guest.id, w.scene.id)).result).rejects.toThrow(
				"Scene not found or access denied."
			)
			await expect((await restore(guest.id, row!.id)).result).rejects.toThrow(
				"Scene not found or access denied."
			)
		}
		await (await restore(w.user.id, row!.id)).result
		expect((await readSceneCast(w.scene.id)).participantCharacters).toEqual([])
	})

	test("on a provided lorebook canRestore is false and Restore is refused with the read-only sentence", async () => {
		const w = await world()
		await recordRedline(db(), {
			sceneId: w.scene.id,
			before: { participantCharacters: [] },
			after: { participantCharacters: [w.ada.id] },
			keys: ["participantCharacters"],
			cause: "save",
			by: { userId: w.user.id }
		})
		const [row] = await rowsOf(w.scene.id)
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					provided: {
						plugin: "core",
						slug: "core:primer/x@1",
						version: "1",
						sha256: "x",
						uuid: w.book.uuid,
						entries: {}
					}
				}
			} as any)
			.where(eq(schema.lorebooks.id, w.book.id))
		const res = await (await list(w.user.id, w.scene.id)).result
		expect(res.canRestore).toBe(false)
		const { result } = await restore(w.user.id, row!.id)
		await expect(result).rejects.toThrow(primerRowEditRefusal(null))
	})

	test("a row that belongs to no scene is not kept", async () => {
		const w = await world()
		const { result } = await restore(w.user.id, 999999)
		await expect(result).rejects.toThrow("That edit is no longer kept.")
	})
})

describe("the book's count and clear", () => {
	test("entries:redlineCount and entries:clearRedlines with a lorebookId take scene rows", async () => {
		const w = await world()
		await saveCast(w, { participantCharacters: [w.ada.id] })
		await saveCast(w, { participantCharacters: [w.ada.id, w.bram.id] })
		const { entryRedlineCountHandler, entryClearRedlinesHandler } = await import(
			"./redlines"
		)
		const counted: any = await entryRedlineCountHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id },
			recorder().emit
		)
		expect(counted.count).toBe(2)
		const cleared: any = await entryClearRedlinesHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id },
			recorder().emit
		)
		expect(cleared.cleared).toBe(2)
		expect(await rowsOf(w.scene.id)).toEqual([])
	})

	test("the registry's purge and count take scene rows (what Share as a lorebook clears)", async () => {
		const w = await world()
		await saveCast(w, { participantCharacters: [w.ada.id] })
		const { LOREBOOK_TABLES } = await import("$lib/server/lorebooks/tableRegistry")
		const spec = LOREBOOK_TABLES.find((s) => s.table === schema.loreRedlines)!
		expect(await spec.count!(db(), w.book.id)).toBe(1)
		await spec.purge!(db(), w.book.id)
		expect(await rowsOf(w.scene.id)).toEqual([])
	})
})
