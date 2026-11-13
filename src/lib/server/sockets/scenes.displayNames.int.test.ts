/**
 * 🚧 ★4b — a default scene name is numbered at render: `Scene N` is the
 * scene's position on its lane, the stored name never renumbered; a custom
 * name is shown as stored; a rename reads against the shown name; an unfiled
 * scene (no history entry) is listed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
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
		path.join(os.tmpdir(), "serene-pub-scenes-displaynames-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let seq = 0

async function makeWorld() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `display-names-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Names Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }])
		)
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	return { user, lorebook, history, session }
}

type World = Awaited<ReturnType<typeof makeWorld>>

/** A scene row opened at a fresh line (closed after it unless `open`), with a stored name. */
async function openedScene(
	w: World,
	name: string | null,
	extra: Partial<typeof schema.scenes.$inferInsert> & { open?: boolean } = {}
) {
	const { open, ...columns } = extra
	const msg = await insertSessionMessageRow(testDb, w.session.id, {
		content: `line for ${name}`
	})
	const end = open
		? null
		: await insertSessionMessageRow(testDb, w.session.id, { content: "end" })
	const [scene] = await testDb
		.insert(schema.scenes)
		.values({
			lorebookId: w.lorebook.id,
			sessionId: w.session.id,
			historyEntryId: w.history.id,
			openedAtMessageId: msg.id,
			closedAtMessageId: end?.id ?? null,
			name,
			nameIsDefault: name != null && /^Scene \d+/.test(name),
			...columns
		})
		.returning()
	return scene
}

async function listed(w: World) {
	const { sceneListHandler, sceneListByLorebookHandler } = await import("./scenes")
	const bySession = await sceneListHandler.handler(
		fakeSocket(w.user.id),
		{ sessionId: w.session.id },
		noopEmit
	)
	const byBook = await sceneListByLorebookHandler.handler(
		fakeSocket(w.user.id),
		{ lorebookId: w.lorebook.id },
		noopEmit
	)
	const names = (rows: Array<{ id: number; name: string | null }>) =>
		Object.fromEntries(rows.map((r) => [r.id, r.name]))
	return {
		session: names(bySession.sceneList),
		book: names(byBook.sceneList),
		bySession
	}
}

const stored = async (id: number) =>
	(await testDb.query.scenes.findFirst({ where: eq(schema.scenes.id, id) }))!

describe("default scene names, numbered at render", () => {
	test("a deleted scene renumbers the ones after it; stored names stay", async () => {
		const { sceneDeleteHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1 · the Crypt")
		const b = await openedScene(w, "Scene 2 · the Vault · Day 2")
		const c = await openedScene(w, "Scene 3 · the Docks · Day 4")

		let l = await listed(w)
		expect(l.session[a.id]).toBe("Scene 1 · the Crypt")
		expect(l.session[b.id]).toBe("Scene 2 · the Vault · Day 2")
		expect(l.session[c.id]).toBe("Scene 3 · the Docks · Day 4")

		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: b.id }, noopEmit)
		l = await listed(w)
		expect(l.session[a.id]).toBe("Scene 1 · the Crypt")
		expect(l.session[c.id]).toBe("Scene 2 · the Docks · Day 4")
		expect(l.book[c.id]).toBe("Scene 2 · the Docks · Day 4")
		expect((await stored(c.id)).name).toBe("Scene 3 · the Docks · Day 4")
	})

	test("a custom name stays; another channel numbers on its own lane", async () => {
		const { sceneDeleteHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const custom = await openedScene(w, "The Heist", { nameIsDefault: false })
		const c = await openedScene(w, "Scene 3")
		const other = await openedScene(w, "Scene 2", { channel: "whisper" })

		let l = await listed(w)
		expect(l.session[custom.id]).toBe("The Heist")
		// The custom scene still takes a place on the lane.
		expect(l.session[c.id]).toBe("Scene 3")
		expect(l.session[other.id]).toBe("Scene 1")

		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)
		l = await listed(w)
		expect(l.session[custom.id]).toBe("The Heist")
		expect(l.session[c.id]).toBe("Scene 2")
	})

	test("an unfiled scene is listed with historyEntry null", async () => {
		const w = await makeWorld()
		const s = await openedScene(w, "Scene 1", { historyEntryId: null })
		const l = await listed(w)
		expect(l.session[s.id]).toBe("Scene 1")
		const row = l.bySession.sceneList.find((r: any) => r.id === s.id) as any
		expect(row.historyEntry).toBeNull()
		expect(l.book[s.id]).toBe("Scene 1")
	})
})

describe("scenes:update — the rename rule", () => {
	const update = async (w: World, id: number, name: string | null) => {
		const { sceneUpdateHandler } = await import("./scenes")
		await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id, name } as any },
			noopEmit
		)
		return stored(id)
	}

	test("the shown name sent back stays automatic and keeps renumbering", async () => {
		const { sceneDeleteHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2 · the Vault")
		const c = await openedScene(w, "Scene 3 · the Docks")
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)
		// Shown as "Scene 2 · the Docks"; the review sends that back.
		const row = await update(w, c.id, "Scene 2 · the Docks")
		expect(row.nameIsDefault).toBe(true)
		expect(row.name).toBe("Scene 3 · the Docks")
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: b.id }, noopEmit)
		expect((await listed(w)).session[c.id]).toBe("Scene 1 · the Docks")
	})

	test("the STORED name sent back (a review opened before a renumber) stays automatic", async () => {
		const { sceneDeleteHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2 · the Vault")
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)
		// Shown as "Scene 1 · the Vault"; the stale review sends the stored name.
		const row = await update(w, b.id, "Scene 2 · the Vault")
		expect(row.nameIsDefault).toBe(true)
		expect(row.name).toBe("Scene 2 · the Vault")
		expect((await listed(w)).session[b.id]).toBe("Scene 1 · the Vault")
	})

	test("blank or null makes the automatic name again; a new name is custom", async () => {
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2")

		let row = await update(w, b.id, "The Chase")
		expect(row.name).toBe("The Chase")
		expect(row.nameIsDefault).toBe(false)
		expect((await listed(w)).session[b.id]).toBe("The Chase")

		for (const blank of ["", "  ", null]) {
			await update(w, b.id, "The Chase")
			row = await update(w, b.id, blank)
			expect(row.nameIsDefault).toBe(true)
			expect(row.name).toBe("Scene 2")
		}

		// No session: nothing to number on.
		const loose = await openedScene(w, "Scene 7", { sessionId: null })
		row = await update(w, loose.id, "")
		expect(row.name).toBeNull()
		expect(row.nameIsDefault).toBe(false)
		expect(a.id).toBeLessThan(b.id)
	})

	test("a blank name saved with a moved selection is numbered from the new start", async () => {
		const { sceneUpdateHandler } = await import("./scenes")
		const { sceneNameFor } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		const m: number[] = []
		for (let i = 0; i < 6; i++)
			m.push(
				(
					await insertSessionMessageRow(testDb, w.session.id, {
						content: `line ${i}`
					})
				).id
			)
		const captured = (name: string, ids: number[]) => ({
			name,
			openedAtMessageId: null,
			closedAtMessageId: null,
			selectedMessageIds: ids
		})
		// B starts at the earlier lines, so B is Scene 1 and A is Scene 2.
		const b = await openedScene(w, "Scene 1", captured("Scene 1", [m[2], m[3]]))
		const a = await openedScene(w, "Scene 2", captured("Scene 2", [m[4], m[5]]))
		expect((await listed(w)).session[a.id]).toBe("Scene 2")

		// A's selection moves to start before B's, and the name is cleared.
		await sceneUpdateHandler.handler(
			fakeSocket(w.user.id),
			{ scene: { id: a.id, name: "", selectedMessageIds: [m[0], m[1]] } as any },
			noopEmit
		)
		const row = await stored(a.id)
		expect(row.nameIsDefault).toBe(true)
		expect(row.selectedMessageIds).toEqual([m[0], m[1]])
		expect(row.name).toBe(
			await sceneNameFor(testDb, w.session.id, "main", w.lorebook.id, null, m[0])
		)
		expect(row.name).toBe("Scene 1")
		expect(b.id).toBeLessThan(a.id)
	}, 60_000)
})

describe("other readers of the name", () => {
	test("scenes:openScenes and sceneHeaderOf show the display name", async () => {
		const { sceneDeleteHandler, sceneOpenScenesHandler } = await import("./scenes")
		const { sceneHeaderOf } = await import("$lib/server/scenes/liveScenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2 · Day 4", { open: true })
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)

		const res = await sceneOpenScenesHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id } as any,
			noopEmit
		)
		expect(res.scenes.find((s) => s.id === b.id)?.name).toBe("Scene 1 · Day 4")

		const header = await sceneHeaderOf(testDb as any, await stored(b.id))
		expect(header.name).toBe("Scene 1 · Day 4")
	})
})

describe("the open / close replies name the scene as the lists do", () => {
	test("scenes:close replies with the display name, not the stored one", async () => {
		const { sceneDeleteHandler, sceneCloseHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2 · the Vault", { open: true })
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)

		const res: any = await sceneCloseHandler.handler(
			fakeSocket(w.user.id),
			{ sceneId: b.id },
			noopEmit
		)
		expect((await stored(b.id)).name).toBe("Scene 2 · the Vault")
		expect(res.scene.name).toBe("Scene 1 · the Vault")
		expect(res.scene.name).toBe((await listed(w)).book[b.id])
	}, 60_000)

	test("scenes:open: the scene and its closedScene carry display names", async () => {
		const { sceneDeleteHandler, sceneOpenHandler } = await import("./scenes")
		const w = await makeWorld()
		const a = await openedScene(w, "Scene 1")
		const b = await openedScene(w, "Scene 2 · the Vault", { open: true })
		await sceneDeleteHandler.handler(fakeSocket(w.user.id), { id: a.id }, noopEmit)
		const line = await insertSessionMessageRow(testDb, w.session.id, {
			content: "a later line"
		})

		const res: any = await sceneOpenHandler.handler(
			fakeSocket(w.user.id),
			{ sessionId: w.session.id, atMessageId: line.id },
			noopEmit
		)
		const l = await listed(w)
		expect(res.scene.name).toBe(l.book[res.scene.id])
		expect(res.scene.name).toMatch(/^Scene 2/)
		expect(res.closedScene.id).toBe(b.id)
		expect(res.closedScene.name).toBe("Scene 1 · the Vault")
		expect(res.closedScene.name).toBe(l.book[b.id])
	}, 60_000)
})

describe("numbering many scenes at once", () => {
	test("200 scenes on a lane: every shown name matches the by-lane count rule, ties share a number", async () => {
		const { sceneDisplayNames } = await import("$lib/server/scenes/liveScenes")
		const { sceneStartOf } = await import("$lib/server/scenes/historyEntryOfDate")
		const w = await makeWorld()
		const lines = await testDb
			.insert(schema.sessionMessages)
			.values(
				Array.from({ length: 260 }, (_, i) => ({
					sessionId: w.session.id,
					role: "user" as const,
					content: `line ${i}`
				}))
			)
			.returning()
		const lineIds = lines.map((l) => l.id)

		// Deterministic scramble, so row ids do not follow the start order.
		const order = Array.from({ length: 200 }, (_, i) => i)
		let state = 12345
		for (let i = order.length - 1; i > 0; i--) {
			state = (state * 1103515245 + 12345) % 2147483648
			const j = state % (i + 1)
			;[order[i], order[j]] = [order[j], order[i]]
		}
		const base = {
			lorebookId: w.lorebook.id,
			sessionId: w.session.id,
			historyEntryId: w.history.id
		}
		const main = order.map((i) => {
			// Scenes 40 and 41 open at the same line (a tie); scene 90 is a
			// selection scene whose smallest selected line is scene 91's opening.
			const at = lineIds[i === 41 ? 40 : i]
			const selection = i === 90
			const custom = i % 17 === 0
			const place = i % 5 === 0 ? ` · Place ${i}` : ""
			return {
				...base,
				openedAtMessageId: selection ? null : at,
				closedAtMessageId: selection ? null : lineIds[i] + 1000,
				selectedMessageIds: selection ? [lineIds[91], lineIds[199]] : [],
				name: custom ? `Custom ${i}` : `Scene ${(i % 9) + 1}${place}`,
				nameIsDefault: !custom
			}
		})
		const whisper = [3, 3, 7, 1, 20].map((i, n) => ({
			...base,
			channel: "whisper",
			openedAtMessageId: lineIds[200 + i],
			closedAtMessageId: lineIds[200 + i] + 1000,
			name: `Scene ${n + 1} · whisper`,
			nameIsDefault: true
		}))
		const rows = await testDb
			.insert(schema.scenes)
			.values([...main, ...whisper])
			.returning()
		expect(rows).toHaveLength(205)

		// The old rule, literally: 1 + the other rows on the same session and
		// channel that start strictly earlier.
		const expected = new Map<number, string | null>()
		for (const s of rows) {
			expected.set(s.id, s.name ?? null)
			if (!(s.nameIsDefault && s.sessionId != null && s.name != null)) continue
			if (!/^Scene \d+(?= · |$)/.test(s.name)) continue
			const at = sceneStartOf(s)
			if (at == null) continue
			const position =
				1 +
				rows.filter((o) => {
					if (o.id === s.id || o.sessionId !== s.sessionId || o.channel !== s.channel)
						return false
					const start = sceneStartOf(o)
					return start !== null && start < at
				}).length
			expected.set(s.id, s.name.replace(/^Scene \d+/, `Scene ${position}`))
		}

		const shown = await sceneDisplayNames(testDb as any, rows)
		expect(shown).toEqual(expected)

		// The tie really is a tie: two scenes, one number.
		const tied = rows.filter((r) => r.openedAtMessageId === lineIds[40])
		expect(tied).toHaveLength(2)
		const numbers = tied.map((r) => (shown.get(r.id) ?? "").match(/^Scene (\d+)/)?.[1])
		expect(numbers[0]).toBeDefined()
		expect(numbers[0]).toBe(numbers[1])
		// A custom name stays as stored.
		const custom = rows.find((r) => r.name === "Custom 17")!
		expect(shown.get(custom.id)).toBe("Custom 17")
	}, 60_000)
})
