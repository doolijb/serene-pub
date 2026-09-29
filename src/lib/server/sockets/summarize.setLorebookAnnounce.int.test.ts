/**
 * `sessions:setLorebook` moves the book, the line and the clock — and must say
 * so the way `sessions:update` does: `state:changed` (every tab re-reads its
 * state) and a `session-updated` under the person's `settings` cause. It
 * announced neither, so other tabs kept reading the old book until a reload.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

const announced = vi.hoisted(() => ({
	broadcasts: [] as Array<{ sessionId: number; event: string; data: any }>,
	sessionEvents: [] as Array<{ event: string; payload: any }>
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

vi.mock("./utils/broadcastHelpers", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		broadcastToSessionUsers: async (
			_io: unknown,
			sessionId: number,
			event: string,
			data: any
		) => {
			announced.broadcasts.push({ sessionId, event, data })
		}
	}
})

vi.mock("$lib/server/pipelines/runtime/sessionEvents", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		emitSessionEvent: async (_db: unknown, opts: any) => {
			announced.sessionEvents.push({
				event: opts.event,
				payload: opts.payload
			})
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-setlorebook-announce-int-test-")
	)
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: {} }) as any

describe("sessionLineChanges", () => {
	const base = {
		lorebookId: 1,
		lorebookBranchId: null,
		storyClockYear: null,
		storyClockMonth: null,
		storyClockDay: null,
		storyClockHour: null,
		storyClockMinute: null
	}
	test("names what moved, clock as one", async () => {
		const { sessionLineChanges } = await import("./summarize")
		expect(sessionLineChanges(base, base)).toEqual([])
		expect(
			sessionLineChanges(base, {
				...base,
				lorebookId: 2,
				lorebookBranchId: 5,
				storyClockYear: 4
			})
		).toEqual(["lorebookId", "lorebookBranchId", "storyClock"])
	})
})

describe("sessions:setLorebook — announcing the move", () => {
	test("attaching a book broadcasts state:changed and a settings session-updated", async () => {
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "setlorebook-announce-owner" })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ isGroup: false, userId: owner.id })
			.returning()
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Announced Book", userId: owner.id })
			.returning()

		await sessionsSetLorebookHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, lorebookId: lorebook.id } as any,
			() => {}
		)

		expect(announced.broadcasts).toContainEqual({
			sessionId: session.id,
			event: "state:changed",
			data: { sessionId: session.id }
		})
		const updated = announced.sessionEvents.at(-1)
		expect(updated?.payload).toMatchObject({
			sessionId: session.id,
			cause: { kind: "settings", userId: owner.id }
		})
		expect(updated?.payload.changed).toContain("lorebookId")
	}, 60_000)

	test("setting the book it already reads announces nothing", async () => {
		const { sessionsSetLorebookHandler } = await import("./summarize")
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "setlorebook-announce-same" })
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ isGroup: false, userId: owner.id })
			.returning()
		announced.broadcasts.length = 0
		announced.sessionEvents.length = 0

		await sessionsSetLorebookHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id, lorebookId: null } as any,
			() => {}
		)

		expect(announced.broadcasts).toHaveLength(0)
		expect(announced.sessionEvents).toHaveLength(0)
	}, 60_000)
})
