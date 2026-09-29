/**
 * The download-settled and update-available producers against real
 * migrations: who is told, what the row carries, and the update rule of
 * "once per tag, cleared when current".
 *
 * `$lib/server/db` is replaced wholesale (store.int.test.ts's pattern) and
 * every producer call is handed `testDb` explicitly.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq, inArray } from "drizzle-orm"
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

import {
	DOWNLOAD_ERROR_MAX,
	downloadHref,
	notifyDownloadSettled,
	shortDownloadError
} from "./downloads"
import { UPDATE_HREF, syncUpdateNotifications } from "./updateAvailable"
import { dismissNotifications, openNotifications } from "./store"
import {
	DOWNLOAD_DONE,
	DOWNLOAD_FAILED,
	UPDATE_AVAILABLE,
	regardingFor
} from "$lib/shared/notifications/kinds"

const T = schema.notifications
let testDb: TestDb
let db: Db

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
})

async function newUser(isAdmin = false): Promise<number> {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const id = (await createTestUser(testDb)).id
	if (isAdmin)
		await testDb
			.update(schema.users)
			.set({ isAdmin: true })
			.where(eq(schema.users.id, id))
	return id
}

function rowsOf(userIds: number[], regarding: string) {
	return testDb
		.select()
		.from(T)
		.where(and(inArray(T.userId, userIds), eq(T.regarding, regarding)))
		.orderBy(T.id)
}

describe("download-settled", () => {
	test("tells the initiator only; a successful retry turns the failed row into a done one", async () => {
		const starter = await newUser(true)
		const other = await newUser(true)
		const regarding = regardingFor.download("koboldcpp", "model-Q4.gguf")

		await notifyDownloadSettled(
			{
				userId: starter,
				source: "koboldcpp",
				key: "model-Q4.gguf",
				model: "Model",
				href: downloadHref(7),
				error: new Error(
					"HTTP 500 from https://user:secret@example.com/x"
				)
			},
			db
		)
		let rows = await rowsOf([starter, other], regarding)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			userId: starter,
			kind: DOWNLOAD_FAILED.id,
			level: "error",
			href: "/admin/connections/7"
		})
		expect(rows[0].vars).toEqual({
			model: "Model",
			error: "HTTP 500 from https://…@example.com/x"
		})

		await notifyDownloadSettled(
			{
				userId: starter,
				source: "koboldcpp",
				key: "model-Q4.gguf",
				model: "Model",
				href: downloadHref(7)
			},
			db
		)
		rows = await rowsOf([starter, other], regarding)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			kind: DOWNLOAD_DONE.id,
			level: "info",
			clearedAt: null
		})
		expect(rows[0].vars).toEqual({ model: "Model" })
	})

	test("an unknown initiator raises nothing", async () => {
		const regarding = regardingFor.download("onnx", "embeddings:nobody")
		await notifyDownloadSettled(
			{
				userId: null,
				source: "onnx",
				key: "embeddings:nobody",
				model: "Nobody",
				href: downloadHref(null)
			},
			db
		)
		expect(await openNotifications(regarding, db)).toEqual([])
	})

	test("the href falls back to the Connections index; errors are one short line", () => {
		expect(downloadHref(null)).toBe("/admin/connections")
		expect(downloadHref(12)).toBe("/admin/connections/12")
		const long = shortDownloadError(new Error(`a\n  b ${"x".repeat(400)}`))
		expect(long.length).toBe(DOWNLOAD_ERROR_MAX)
		expect(long.startsWith("a b x")).toBe(true)
		expect(shortDownloadError("")).toBe("Unknown error")
	})
})

describe("update-available", () => {
	const regarding = regardingFor.update()

	test("raises once per tag for every admin, never a non-admin", async () => {
		const a = await newUser(true)
		const b = await newUser(true)
		const plain = await newUser(false)

		await syncUpdateNotifications("v0.7.0", db)
		let rows = await rowsOf([a, b, plain], regarding)
		expect(rows.map((r) => r.userId).sort()).toEqual([a, b].sort())
		expect(rows[0]).toMatchObject({
			kind: UPDATE_AVAILABLE.id,
			level: "attention",
			href: UPDATE_HREF
		})
		expect(rows[0].vars).toEqual({ tag: "v0.7.0" })

		// A dismissal holds: the same tag again (tomorrow's check, or after a
		// restart) raises nothing — not for A, not a bump for B.
		const aRow = rows.find((r) => r.userId === a)!
		const bRow = rows.find((r) => r.userId === b)!
		await dismissNotifications(a, [aRow.id], db)
		await syncUpdateNotifications("v0.7.0", db)
		rows = await rowsOf([a, b, plain], regarding)
		expect(rows).toHaveLength(2)
		expect(rows.find((r) => r.userId === a)!.clearedHow).toBe("dismissed")
		expect(rows.find((r) => r.userId === b)!.lastRaisedAt).toEqual(
			bRow.lastRaisedAt
		)
	})

	test("a newer tag supersedes the open row; a current install clears it", async () => {
		const a = await newUser(true)

		await syncUpdateNotifications("v0.8.0", db)
		let rows = await rowsOf([a], regarding)
		expect(rows.at(-1)!.vars).toEqual({ tag: "v0.8.0" })

		await syncUpdateNotifications("v0.9.0", db)
		rows = await rowsOf([a], regarding)
		const open = rows.filter((r) => r.clearedAt === null)
		expect(open).toHaveLength(1)
		expect(open[0].vars).toEqual({ tag: "v0.9.0" })
		expect(
			rows.find((r) => (r.vars as any).tag === "v0.8.0")!.clearedHow
		).toBe("superseded")

		await syncUpdateNotifications(null, db)
		expect(await openNotifications(regarding, db)).toEqual([])
		rows = await rowsOf([a], regarding)
		expect(
			rows.find((r) => (r.vars as any).tag === "v0.9.0")!.clearedHow
		).toBe("superseded")
	})
})
