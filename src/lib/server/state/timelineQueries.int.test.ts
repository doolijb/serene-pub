/**
 * The Timeline switch costs nothing extra while it is on (`lorebooks/timeline.ts`):
 * `sessionReadingOf`, `sessionStoryNowOf` and `writeDatingAt` read it inside
 * the queries they already make. Notes over a lorebook answer with that
 * lorebook's switch, a malformed clock step still fails on a switched-off book,
 * and a message's story stamp follows the switch.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const timelineOfBookCalls = vi.hoisted(() => ({ n: 0 }))

vi.mock("$lib/server/lorebooks/timeline", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/lorebooks/timeline")>()
	return {
		...actual,
		timelineOfBook: (...args: Parameters<typeof actual.timelineOfBook>) => {
			timelineOfBookCalls.n++
			return actual.timelineOfBook(...args)
		}
	}
})

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timeline-queries-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function world(opts: { timelineEnabled?: boolean } = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `timeline-queries-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			userId: user.id,
			name: `World ${suffix}`,
			storyClockYear: 9,
			timelineEnabled: opts.timelineEnabled ?? true
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			storyClockYear: 8,
			storyClockMonth: 2,
			storyClockDay: 3
		})
		.returning()
	return { user, book: book!, session: session! }
}

/** Run `fn` against a handle that counts every `select` and `execute` made on it. */
async function counting<T>(fn: (counted: Db) => Promise<T>): Promise<{ result: T; queries: number }> {
	let queries = 0
	const counted = new Proxy(db as unknown as Db, {
		get(target, prop, receiver) {
			const v = Reflect.get(target, prop, receiver)
			if ((prop === "select" || prop === "execute") && typeof v === "function")
				return (...args: unknown[]) => {
					queries++
					return (v as (...a: unknown[]) => unknown).apply(target, args)
				}
			return v
		}
	})
	const result = await fn(counted)
	return { result, queries }
}

describe("no extra query while the switch is on", () => {
	it("sessionReadingOf, sessionStoryNowOf and writeDatingAt never ask timelineOfBook", async () => {
		const { sessionReadingOf, writeDatingAt } = await import("$lib/server/state/reading")
		const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
		const w = await world()
		timelineOfBookCalls.n = 0

		const reading = await counting((d) => sessionReadingOf(d, w.session.id))
		expect(reading.result!.moment).toEqual({ year: 8, month: 2, day: 3 })
		expect(reading.result!.timelineOff).toBe(false)

		const now = await counting((d) => sessionStoryNowOf(d, w.session.id))
		expect(now.result).not.toBeNull()

		const dating = await counting((d) => writeDatingAt(d, reading.result!))

		expect(timelineOfBookCalls.n).toBe(0)
		// Each helper's queries are only the ones it needs: the reading is 1 session select
		// plus the line's present; the dating is its history read alone.
		expect({ reading: reading.queries, now: now.queries, dating: dating.queries }).toEqual({ reading: 1, now: 4, dating: 1 })
	})
})

describe("notes answer with their lorebook's switch", () => {
	it("timelineOfBook on notes over a lorebook reads that lorebook's value", async () => {
		const { timelineOfBook } = await vi.importActual<typeof import("$lib/server/lorebooks/timeline")>(
			"$lib/server/lorebooks/timeline"
		)
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const w = await world()
		const notes = await ownBookFor(db as unknown as Db, w.session.id)
		expect(notes.overlayOf).toBe(w.book.id)
		// The notes' own flag is left stale on purpose: the lorebook's switch decides.
		await db.update(schema.lorebooks).set({ timelineEnabled: false }).where(eq(schema.lorebooks.id, w.book.id))
		await db.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, notes.id))
		expect(await timelineOfBook(db as unknown as Db, notes.id)).toBe(false)
		await db.update(schema.lorebooks).set({ timelineEnabled: true }).where(eq(schema.lorebooks.id, w.book.id))
		await db.update(schema.lorebooks).set({ timelineEnabled: false }).where(eq(schema.lorebooks.id, notes.id))
		expect(await timelineOfBook(db as unknown as Db, notes.id)).toBe(true)
	})

	it("ownBookFor copies the new lorebook's switch when it re-points the notes", async () => {
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const w = await world()
		const notes = await ownBookFor(db as unknown as Db, w.session.id)
		expect(notes.timelineEnabled).toBe(true)
		const off = await world({ timelineEnabled: false })
		await db.update(schema.sessions).set({ lorebookId: off.book.id }).where(eq(schema.sessions.id, w.session.id))
		const moved = await ownBookFor(db as unknown as Db, w.session.id)
		expect(moved.id).toBe(notes.id)
		expect(moved.overlayOf).toBe(off.book.id)
		expect(moved.timelineEnabled).toBe(false)
	})
})

describe("a malformed clock step on a switched-off lorebook", () => {
	it("still fails in the outlet instead of answering with the timeline sentence", async () => {
		const w = await world({ timelineEnabled: false })
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id,
			runId: "run-malformed-step"
		})
		await expect(
			host.commit!(
				{ by: 0, unit: "days" },
				{ key: "advance", definitionId: "core:outlet/advance-story-clock", definitionVersion: 1 } as any
			)
		).rejects.toThrow()
	})
})

describe("a message's story stamp follows the switch", () => {
	it("is absent with the timeline off and present with it on", async () => {
		const { insertLegacy } = await import("$lib/server/messages/store")
		const off = await world({ timelineEnabled: false })
		const on = await world()
		const unstamped = await insertLegacy(db as unknown as Db, {
			sessionId: off.session.id,
			role: "assistant",
			content: "…"
		} as any)
		expect(unstamped.storyClockYear).toBeNull()
		const stamped = await insertLegacy(db as unknown as Db, {
			sessionId: on.session.id,
			role: "assistant",
			content: "…"
		} as any)
		expect(stamped.storyClockYear).toBe(8)
	})
})
