/**
 * The activity producer end to end: a finished activity raises one row for
 * its OWNER (never an admin watching), a failure replaces a ready row under
 * the same `regarding`, and taking the card away clears the row with the
 * reason the store was given — `acted` from a save, `dismissed`,
 * `superseded` by a newer run. Plus the href each job kind points at.
 *
 * Same seams as `store.int.test.ts`: `$lib/server/db` is replaced wholesale
 * and every store call is handed `testDb` (through `wireActivityNotifications`),
 * `pushToUser` is a spy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, pushSpy } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		pushSpy: vi.fn()
	}
})

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))

vi.mock("$lib/server/sockets/utils/userPush", () => ({
	pushToUser: pushSpy
}))

import { activityStore, type Activity } from "$lib/server/utils/activityStore"
import { registerActivityHandlers } from "$lib/server/sockets/activity"
import { fromHash } from "$lib/shared/lorebooks/loreRoute"
import {
	ACTIVITY_FAILED,
	ACTIVITY_READY,
	regardingFor
} from "$lib/shared/notifications/kinds"
import {
	activityHref,
	activityNotice,
	wireActivityNotifications
} from "./activity"

const T = schema.notifications
let testDb: TestDb

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	setDb(testDb)
	wireActivityNotifications(testDb as unknown as Db)
}, 60_000)

afterAll(async () => {
	activityStore.setNotifier(undefined)
	await (testDb as any)?.$client?.close?.()
})

async function newUser(): Promise<number> {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb)).id
}

function rowsOf(userId: number) {
	return testDb.select().from(T).where(eq(T.userId, userId)).orderBy(T.id)
}

/** The notifier is fire-and-forget; wait until the rows say what we expect. */
async function until<R>(
	read: () => Promise<R>,
	ok: (r: R) => boolean,
	ms = 3000
): Promise<R> {
	const end = Date.now() + ms
	let last = await read()
	while (!ok(last) && Date.now() < end) {
		await new Promise((r) => setTimeout(r, 10))
		last = await read()
	}
	return last
}

/** A connected client, as `registerActivityHandlers` sees one. */
function connect(userId: number, isAdmin: boolean) {
	const handlers = new Map<string, (arg?: any) => void>()
	const socket = {
		user: { id: userId, isAdmin },
		interest: new Set(["activity:update"]),
		emit: () => {},
		on: (event: string, fn: (arg?: any) => void) => {
			handlers.set(event, fn)
		}
	}
	registerActivityHandlers(socket)
	return {
		fire: (event: string, arg?: unknown) => handlers.get(event)!(arg),
		disconnect: () => handlers.get("disconnect")!()
	}
}

describe("activity → notification (PGlite integration)", () => {
	test("review raises ready for the owner only; error replaces it under one regarding; apply clears acted", async () => {
		const owner = await newUser()
		const admin = await newUser()
		const adminTab = connect(admin, true)
		const id = activityStore.start({
			userId: owner,
			lorebookId: 11,
			lorebookLabel: "The Fens",
			mode: "replace"
		})
		activityStore.update(id, { phase: "scenes" })
		expect(await rowsOf(owner)).toHaveLength(0)

		activityStore.update(id, { status: "review" })
		const ready = await until(
			() => rowsOf(owner),
			(r) => r.length === 1
		)
		expect(ready[0]).toMatchObject({
			kind: ACTIVITY_READY.id,
			level: "attention",
			regarding: regardingFor.activity(id),
			href: "/lorebooks#lore=11/all?lens=graph",
			vars: { job: "Graph build", subject: "The Fens" },
			clearedAt: null
		})
		expect(await rowsOf(admin)).toHaveLength(0)

		activityStore.update(id, { status: "error" })
		const failed = await until(
			() => rowsOf(owner),
			(r) => r[0]?.kind === ACTIVITY_FAILED.id
		)
		expect(failed).toHaveLength(1)
		expect(failed[0]).toMatchObject({
			id: ready[0].id,
			kind: ACTIVITY_FAILED.id,
			level: "error",
			regarding: regardingFor.activity(id)
		})

		// The apply path: the modal dismisses with `how: "acted"`.
		const ownerTab = connect(owner, false)
		ownerTab.fire("activity:dismiss", { id, how: "acted" })
		expect(activityStore.getById(id)).toBeUndefined()
		const cleared = await until(
			() => rowsOf(owner),
			(r) => r[0]?.clearedAt !== null
		)
		expect(cleared[0].clearedHow).toBe("acted")
		ownerTab.disconnect()
		adminTab.disconnect()
	})

	test("a plain dismiss, a cancel and an unknown how all clear as dismissed", async () => {
		const owner = await newUser()
		const tab = connect(owner, false)
		const ids: string[] = []
		for (const sceneId of [501, 502, 503]) {
			const id = activityStore.startScene({
				userId: owner,
				sceneId,
				sceneName: `Scene ${sceneId}`,
				lorebookId: 12,
				lorebookLabel: "Hollow Book"
			})
			activityStore.updateScene(id, { status: "review" })
			ids.push(id)
		}
		await until(
			() => rowsOf(owner),
			(r) => r.length === 3
		)
		tab.fire("activity:dismiss", { id: ids[0] })
		tab.fire("activity:cancel", { id: ids[1] })
		tab.fire("activity:dismiss", { id: ids[2], how: "superseded" })
		const rows = await until(
			() => rowsOf(owner),
			(r) => r.every((row) => row.clearedAt !== null)
		)
		expect(rows.map((r) => r.clearedHow)).toEqual([
			"dismissed",
			"dismissed",
			"dismissed"
		])
		tab.disconnect()
	})

	test("another user's dismiss is refused and clears nothing", async () => {
		const owner = await newUser()
		const other = await newUser()
		const tab = connect(other, false)
		const id = activityStore.startCompile({
			userId: owner,
			historyEntryId: 901,
			historyEntryDate: "Year 3",
			lorebookId: 13,
			lorebookLabel: "Chronicle"
		})
		activityStore.updateCompile(id, { status: "review" })
		await until(
			() => rowsOf(owner),
			(r) => r.length === 1
		)
		tab.fire("activity:dismiss", { id, how: "acted" })
		await new Promise((r) => setTimeout(r, 50))
		expect(activityStore.getById(id)).toBeDefined()
		expect((await rowsOf(owner))[0].clearedAt).toBeNull()
		activityStore.remove(id)
		tab.disconnect()
	})

	test("a newer run supersedes: graph start, scene restart, compile restart", async () => {
		const owner = await newUser()
		const graph = activityStore.start({
			userId: owner,
			lorebookId: 14,
			lorebookLabel: "Marsh",
			mode: "extend"
		})
		activityStore.update(graph, { status: "error" })
		const scene = activityStore.startScene({
			userId: owner,
			sceneId: 601,
			lorebookId: 14
		})
		activityStore.updateScene(scene, { status: "error" })
		const compile = activityStore.startCompile({
			userId: owner,
			historyEntryId: 602,
			historyEntryDate: "Year 9",
			lorebookId: 14,
			lorebookLabel: "Marsh"
		})
		activityStore.updateCompile(compile, { status: "review" })
		await until(
			() => rowsOf(owner),
			(r) => r.length === 3
		)

		const next = [
			activityStore.start({
				userId: owner,
				lorebookId: 14,
				lorebookLabel: "Marsh",
				mode: "replace"
			}),
			activityStore.startScene({ userId: owner, sceneId: 601, lorebookId: 14 }),
			activityStore.startCompile({
				userId: owner,
				historyEntryId: 602,
				historyEntryDate: "Year 9",
				lorebookId: 14,
				lorebookLabel: "Marsh"
			})
		]
		const rows = await until(
			() => rowsOf(owner),
			(r) => r.every((row) => row.clearedAt !== null)
		)
		expect(rows.map((r) => r.clearedHow)).toEqual([
			"superseded",
			"superseded",
			"superseded"
		])
		for (const id of next) activityStore.remove(id)
	})
})

describe("activityHref / activityNotice", () => {
	const base = { id: "a1", userId: 5, startedAt: "" }

	test("each job kind points at its durable subject", () => {
		const graph = activityHref({
			...base,
			kind: "graph_build",
			lorebookId: 3,
			lorebookLabel: "B",
			mode: "replace",
			status: "review",
			phase: "",
			sceneIndex: 0,
			totalScenes: 0,
			nodesFound: 0,
			relsFound: 0
		})
		expect(fromHash(graph.slice(graph.indexOf("#")))).toMatchObject({
			lorebookId: 3,
			scope: "all",
			lens: "graph"
		})
		expect(graph.startsWith("/lorebooks#lore=")).toBe(true)

		const sceneUnder = activityHref({
			...base,
			kind: "scene_summarize",
			sceneId: 8,
			lorebookId: 3,
			historyEntryId: 40,
			status: "review"
		})
		expect(sceneUnder).toBe("/lorebooks#lore=3/scenes/40?scene=8")
		const sceneLoose = activityHref({
			...base,
			kind: "scene_summarize",
			sceneId: 8,
			lorebookId: 3,
			status: "review"
		})
		expect(sceneLoose).toBe("/lorebooks#lore=3/history")

		expect(
			activityHref({
				...base,
				kind: "compile_history_entry",
				historyEntryId: 40,
				historyEntryDate: "Year 1",
				lorebookId: 3,
				lorebookLabel: "B",
				status: "error"
			})
		).toBe("/lorebooks#lore=3/history/40")

		expect(
			activityHref({
				...base,
				kind: "session_summarize",
				sessionId: 77,
				loreType: "world",
				lorebookId: 3,
				status: "review"
			})
		).toBe("/sessions/77")
	})

	test("a running activity raises nothing; vars name the job and subject", () => {
		const session: Activity = {
			...base,
			kind: "session_summarize",
			sessionId: 77,
			sessionLabel: "The Guard Room",
			loreType: "character",
			lorebookId: 3,
			status: "running"
		}
		expect(activityNotice(session)).toBeNull()
		expect(activityNotice({ ...session, status: "review" })).toMatchObject({
			userIds: [5],
			kind: ACTIVITY_READY.id,
			regarding: "activity:a1",
			vars: { job: "Character lore summary", subject: "The Guard Room" }
		})
		expect(
			activityNotice({
				...base,
				kind: "compile_history_entry",
				historyEntryId: 40,
				historyEntryDate: "Year 1",
				lorebookId: 3,
				lorebookLabel: "Chronicle",
				status: "error"
			})
		).toMatchObject({
			kind: ACTIVITY_FAILED.id,
			vars: { job: "History compile", subject: "Year 1 · Chronicle" }
		})
	})
})
