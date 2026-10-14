/**
 * `sessions:storyClock` and `sessions:setStoryClock` (PLAN-core-widgets W3):
 * the Chronicle's doors. Anyone in the session reads the clock; its owner
 * alone moves it — set, step, follow — through the book's calendar, and
 * nothing else of the session moves (its tags above all: the settings
 * save, sent with the clock alone, would have cleared them).
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
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-story-clock-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A socket whose replies are recorded; broadcasts go nowhere. */
function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

async function fixture(tag: string) {
	const [owner] = await testDb
		.insert(schema.users)
		.values({ username: `clock-owner-${tag}` })
		.returning()
	const [guest] = await testDb
		.insert(schema.users)
		.values({ username: `clock-guest-${tag}` })
		.returning()
	const [stranger] = await testDb
		.insert(schema.users)
		.values({ username: `clock-stranger-${tag}` })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${tag}`, userId: owner.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			lorebookId: book.id
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session.id, userId: guest.id } as any)
	const [label] = await testDb
		.insert(schema.tags)
		.values({ userId: owner.id, name: `kept-${tag}` })
		.returning()
	await testDb
		.insert(schema.sessionTags)
		.values({ sessionId: session.id, tagId: label.id } as any)
	return { owner, guest, stranger, book, session }
}

async function ask(
	handler: any,
	userId: number,
	params: Record<string, unknown>
) {
	const emits: Array<[string, any]> = []
	await handler.handler(
		fakeSocket(userId),
		params,
		(event: string, data: any) => emits.push([event, data])
	)
	return emits
}

describe("the Chronicle's story clock doors", () => {
	test("the owner sets, steps and clears the session's clock; the tags stay", async () => {
		const { sessionsStoryClock, sessionsSetStoryClock } = await import(
			"./storyClock"
		)
		const f = await fixture("a")
		const sessionId = f.session.id

		const first = await ask(sessionsStoryClock, f.owner.id, {
			sessionId,
			request: "r1"
		})
		expect(first).toEqual([
			[
				"sessions:storyClock",
				expect.objectContaining({
					sessionId,
					request: "r1",
					lorebookId: f.book.id,
					own: null,
					present: null,
					isOwner: true
				})
			]
		])

		const set = await ask(sessionsSetStoryClock, f.owner.id, {
			sessionId,
			request: "r2",
			to: { year: 3, month: 2 }
		})
		expect(set[0]![0]).toBe("sessions:setStoryClock")
		expect(set[0]![1]).toMatchObject({
			request: "r2",
			own: { year: 3, month: 2 },
			present: { year: 3, month: 2 }
		})

		// A day step on a clock with no day is refused in words; a month lands.
		const refused = await ask(sessionsSetStoryClock, f.owner.id, {
			sessionId,
			by: 1,
			unit: "days"
		})
		expect(refused[0]![0]).toBe("sessions:setStoryClock:error")
		expect(refused[0]![1].error).toMatch(/no day to count days from/)
		const stepped = await ask(sessionsSetStoryClock, f.owner.id, {
			sessionId,
			by: 1,
			unit: "months"
		})
		expect(stepped[0]![1]).toMatchObject({ own: { year: 3, month: 3 } })

		const followed = await ask(sessionsSetStoryClock, f.owner.id, {
			sessionId,
			follow: true
		})
		expect(followed[0]![1]).toMatchObject({ own: null })
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(row!.storyClockYear).toBeNull()

		const tags = await testDb
			.select()
			.from(schema.sessionTags)
			.where(eq(schema.sessionTags.sessionId, sessionId))
		expect(tags).toHaveLength(1)
	}, 60_000)

	test("a guest reads the clock and may not move it; a stranger may not read it", async () => {
		const { sessionsStoryClock, sessionsSetStoryClock } = await import(
			"./storyClock"
		)
		const f = await fixture("b")
		const sessionId = f.session.id

		const read = await ask(sessionsStoryClock, f.guest.id, { sessionId })
		expect(read[0]).toEqual([
			"sessions:storyClock",
			expect.objectContaining({ isOwner: false, lorebookId: f.book.id })
		])

		const moved = await ask(sessionsSetStoryClock, f.guest.id, {
			sessionId,
			request: "g",
			to: { year: 1 }
		})
		expect(moved).toEqual([
			[
				"sessions:setStoryClock:error",
				{
					sessionId,
					request: "g",
					error: "Only the session's owner moves its story clock."
				}
			]
		])

		const stranger = await ask(sessionsStoryClock, f.stranger.id, {
			sessionId
		})
		expect(stranger[0]![0]).toBe("sessions:storyClock:error")
	}, 60_000)

	test("anything but exactly one way to move it, or a clock of the wrong shape, is refused and writes nothing", async () => {
		const { sessionsSetStoryClock } = await import("./storyClock")
		const f = await fixture("c")
		const sessionId = f.session.id
		for (const params of [
			{},
			{ follow: true, by: 1, unit: "days" },
			{ to: { year: 1.5 } },
			{ by: 1, unit: "weeks" }
		]) {
			const out = await ask(sessionsSetStoryClock, f.owner.id, {
				sessionId,
				...params
			})
			expect(out[0]![0], JSON.stringify(params)).toBe(
				"sessions:setStoryClock:error"
			)
		}
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(row!.storyClockYear).toBeNull()
	}, 60_000)
})
