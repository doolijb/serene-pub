/**
 * `sessions:setStoryClock` on a book whose timeline is off: follow, set and
 * step are each refused with the clock sentence, and the stored clock stays.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { TIMELINE_OFF_SENTENCES } from "$lib/server/lorebooks/timeline"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-story-clock-timeline-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

describe("the story clock doors with the timeline off", () => {
	test("set and step are refused; follow is allowed and clears the stored clock; a malformed step answers with its own sentence", async () => {
		const { sessionsSetStoryClock } = await import("./storyClock")
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "clock-timeline-owner" })
			.returning()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({
				name: "No timeline",
				userId: owner!.id,
				timelineEnabled: false
			})
			.returning()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner!.id,
				isGroup: false,
				lorebookId: book!.id,
				storyClockYear: 5,
				storyClockMonth: 1,
				storyClockDay: 2
			} as any)
			.returning()
		const stored = async () => {
			const [r] = await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, session!.id))
			return [
				r!.storyClockYear,
				r!.storyClockMonth,
				r!.storyClockDay,
				r!.storyClockHour,
				r!.storyClockMinute
			]
		}
		const before = await stored()
		for (const params of [
			{ to: { year: 9, month: 1, day: 1 } },
			{ by: 1, unit: "days" }
		]) {
			const emitted: Array<[string, any]> = []
			await sessionsSetStoryClock.handler(
				fakeSocket(owner!.id),
				{ sessionId: session!.id, ...params } as any,
				(event: string, data: any) => emitted.push([event, data])
			)
			expect(emitted).toEqual([
				[
					"sessions:setStoryClock:error",
					expect.objectContaining({
						error: TIMELINE_OFF_SENTENCES.clock
					})
				]
			])
			expect(await stored()).toEqual(before)
		}
		const malformed: Array<[string, any]> = []
		await sessionsSetStoryClock.handler(
			fakeSocket(owner!.id),
			{ sessionId: session!.id, by: 1, unit: "fortnights" } as any,
			(event: string, data: any) => malformed.push([event, data])
		)
		expect(malformed[0]![0]).toBe("sessions:setStoryClock:error")
		expect(malformed[0]![1].error).toMatch(/^Step by one of/)
		// Following the line only clears a stored clock: allowed with the timeline off.
		const followed: Array<[string, any]> = []
		await sessionsSetStoryClock.handler(
			fakeSocket(owner!.id),
			{ sessionId: session!.id, follow: true } as any,
			(event: string, data: any) => followed.push([event, data])
		)
		expect(followed[0]![0]).toBe("sessions:setStoryClock")
		expect(await stored()).toEqual([null, null, null, null, null])
	})
})

describe("the clock reply says whether the book keeps a timeline", () => {
	const readOf = async (userId: number, sessionId: number) => {
		const { readSessionStoryClock } = await import("./storyClock")
		return readSessionStoryClock(sessionId, userId)
	}

	test("an attached lorebook: its switch, on and off", async () => {
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "clock-reply-attached" })
			.returning()
		for (const on of [true, false]) {
			const [book] = await testDb
				.insert(schema.lorebooks)
				.values({ name: `Attached ${on}`, userId: owner!.id, timelineEnabled: on })
				.returning()
			const [session] = await testDb
				.insert(schema.sessions)
				.values({ userId: owner!.id, isGroup: false, lorebookId: book!.id } as any)
				.returning()
			expect((await readOf(owner!.id, session!.id)).timeline).toBe(on)
		}
	})

	test("a session whose lorebook is its own notes: the notes' switch, on and off", async () => {
		const [owner] = await testDb
			.insert(schema.users)
			.values({ username: "clock-reply-notes" })
			.returning()
		for (const on of [true, false]) {
			const [session] = await testDb
				.insert(schema.sessions)
				.values({ userId: owner!.id, isGroup: false } as any)
				.returning()
			await testDb
				.insert(schema.lorebooks)
				.values({
					name: `Notes ${on}`,
					userId: owner!.id,
					sessionId: session!.id,
					kind: "book",
					timelineEnabled: on
				} as any)
			expect((await readOf(owner!.id, session!.id)).timeline).toBe(on)
		}
	})
})
