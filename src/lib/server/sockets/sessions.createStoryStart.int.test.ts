/**
 * 🚧 Where a new session's story starts at create (`storyStartOf`): a dated
 * session with no clock named starts TODAY in its owner's time zone; the
 * line's present is followed and nothing is stored; `asks` (today does not
 * land on the book's calendar) refuses and makes nothing, unless the form
 * names the date. A date set by the genre's create pipeline wins.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "create-story-start-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {},
	emitToInterested: async () => 0
}))
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => {
		throw new Error("no model is called on create")
	}
}))

let ownerId: number
const quietIo = () => ({
	sockets: {
		adapter: { rooms: { get: () => undefined } },
		sockets: { get: () => undefined, values: () => [].values() }
	},
	to: () => ({ emit: () => {} })
})
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}

const LIVING = "core-story-living" // starts its notes undated unless a test states a timeline (2026-11-16)
const MINIMAL = "core-story-minimal" // starts them without
const CRAWLER = "core-dungeon-crawler-default" // its create moves the clock to 08:00 today

const TEN_MONTHS = { months: Array.from({ length: 10 }, (_, i) => ({ name: `M${i + 1}`, days: 30 })), yearLabel: "Year" }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-create-story-start-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "create-story-start-owner")).id
}, 180_000)

afterEach(() => {
	vi.useRealTimers()
})

afterAll(async () => {
	vi.useRealTimers()
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function presetId(seedKey: string) {
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return preset!.id
}

async function createRaw(seedKey: string, name: string, session: Record<string, unknown> = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: await presetId(seedKey), ...session },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return res
}

async function create(seedKey: string, name: string, session: Record<string, unknown> = {}) {
	const res = await createRaw(seedKey, name, session)
	expect(res?.error, `${name}: ${res?.error}`).toBeUndefined()
	return res.session.id as number
}

const clockOf = async (sessionId: number) => {
	const [r] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return {
		year: r!.storyClockYear,
		month: r!.storyClockMonth,
		day: r!.storyClockDay,
		hour: r!.storyClockHour,
		minute: r!.storyClockMinute
	}
}
const NONE = { year: null, month: null, day: null, hour: null, minute: null }

const book = async (name: string, values: Record<string, unknown> = {}) =>
	(
		await db
			.insert(schema.lorebooks)
			.values({ name, userId: ownerId, timelineEnabled: true, ...values } as any)
			.returning()
	)[0]!

const setZone = (timeZone: string | null) =>
	db.update(schema.users).set({ timeZone }).where(eq(schema.users.id, ownerId))

const sessionsNamed = async (name: string) =>
	(await db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.name, name))).length

/** Only `Date` is faked: timers and the event loop run as they do. */
const at = (iso: string) => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(new Date(iso))
}

describe("a new dated session with no lorebook", () => {
	it("starts today, in its owner's time zone", async () => {
		// States its timeline: Living's notes start undated by default (2026-11-16), and today's clock is set only when they keep one.
		const [row] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.id, await presetId(LIVING)))
		const before = row!.defaults as Record<string, unknown> | null
		await db
			.update(schema.sessionPresets)
			.set({ defaults: { ...(before ?? {}), timeline: true } } as any)
			.where(eq(schema.sessionPresets.id, row!.id))
		try {
			await startsToday()
		} finally {
			await db.update(schema.sessionPresets).set({ defaults: before } as any).where(eq(schema.sessionPresets.id, row!.id))
		}
	})

	const startsToday = async () => {
		await setZone("Pacific/Auckland")
		at("2026-11-15T23:30:00Z") // 12:30 on the 16th in Auckland
		const id = await create(LIVING, "today in Auckland")
		expect(await clockOf(id)).toEqual({ year: 2026, month: 11, day: 16, hour: null, minute: null })
		await setZone("America/Los_Angeles")
		const west = await create(LIVING, "today in Los Angeles")
		expect(await clockOf(west)).toEqual({ year: 2026, month: 11, day: 15, hour: null, minute: null })
		await setZone(null)
	}

	it("writes nothing with the timeline off", async () => {
		at("2026-11-15T23:30:00Z")
		expect(await clockOf(await create(MINIMAL, "off today"))).toEqual(NONE)
	})
})

describe("a new session on an existing lorebook", () => {
	it("follows a present and stores nothing", async () => {
		at("2026-11-15T23:30:00Z")
		const b = await book("Has a present", { storyClockYear: 12, storyClockMonth: 4 })
		expect(await clockOf(await create(LIVING, "follows", { lorebookId: b.id }))).toEqual(NONE)
	})

	it("starts at the latest dated row when there is no present (unchanged)", async () => {
		at("2026-11-15T23:30:00Z")
		const b = await book("Has a Beginning")
		const { WORLD_LORE_TYPE_ID } = await import("$lib/shared/entries/types")
		await db.insert(schema.lorebookEntries).values({
			lorebookId: b.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: 1,
			title: null,
			content: "…",
			fields: { year: 9, month: 2 }
		} as any)
		expect(await clockOf(await create(LIVING, "latest", { lorebookId: b.id }))).toMatchObject({ year: 9, month: 2 })
	})

	it("starts today on a free-form book with neither", async () => {
		await setZone("UTC")
		at("2026-11-15T08:05:00Z")
		const b = await book("Free-form")
		expect(await clockOf(await create(LIVING, "free-form today", { lorebookId: b.id }))).toEqual({
			year: 2026,
			month: 11,
			day: 15,
			hour: null,
			minute: null
		})
		await setZone(null)
	})

	it("refuses when today does not land on the calendar, and makes nothing", async () => {
		await setZone("UTC")
		at("2026-11-15T08:05:00Z")
		const b = await book("Ten Months", { storyCalendar: TEN_MONTHS })
		const res = await createRaw(LIVING, "asks refused", { lorebookId: b.id })
		expect(res.error).toBe("Today's date doesn't fit the calendar of Ten Months. Choose the date the story begins on.")
		expect(await sessionsNamed("asks refused")).toBe(0)
		await setZone(null)
	})

	it("accepts the date the form names", async () => {
		await setZone("UTC")
		at("2026-11-15T08:05:00Z")
		const b = await book("Ten Months again", { storyCalendar: TEN_MONTHS })
		const id = await create(LIVING, "asks answered", {
			lorebookId: b.id,
			storyClockYear: 5,
			storyClockMonth: 3,
			storyClockDay: 2
		})
		expect(await clockOf(id)).toMatchObject({ year: 5, month: 3, day: 2 })
		await setZone(null)
	})
})

describe("a date the genre's create pipeline sets", () => {
	it("wins over today's: the crawler's create moves a clock standing at 03:30 to 08:00", async () => {
		await setZone("UTC")
		at("2026-11-15T03:30:00Z")
		const id = await create(CRAWLER, "crawler wins")
		expect(await clockOf(id)).toMatchObject({ year: 2026, month: 11, day: 15, hour: 8, minute: 0 })
		await setZone(null)
	})

	it("starts a date with no time of day, so the 08:00 move lands whatever the real hour", async () => {
		await setZone("UTC")
		at("2026-11-15T14:20:00Z")
		const id = await create(CRAWLER, "crawler past")
		expect(await clockOf(id)).toMatchObject({ year: 2026, month: 11, day: 15, hour: 8, minute: 0 })
		await setZone(null)
	})
})
