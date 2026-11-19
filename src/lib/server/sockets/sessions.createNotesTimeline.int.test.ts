/**
 * 🚧 `sessions:create`'s `notesTimeline`: the start form's switch for whether the
 * session's own NEW notes keep a timeline. Only a session with own new notes reads it;
 * a required genre wins silently; with the notes undated a named clock is dropped.
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
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "create-notes-timeline-test-secret" }
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


const MINIMAL = "core-story-minimal"
const LIVING = "core-story-living"
const RULE_BASED = "core-story-rule-based"
const CRAWLER = "core-dungeon-crawler-default"
const STORY = [MINIMAL, LIVING, RULE_BASED]

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-create-notes-timeline-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "create-notes-timeline-owner")).id
	await db.update(schema.users).set({ timeZone: "UTC" }).where(eq(schema.users.id, ownerId))
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

let n = 0
async function create(seedKey: string, extra: Record<string, unknown> = {}, session: Record<string, unknown> = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name: `${seedKey} ${++n}`, presetId: await presetId(seedKey), ...session },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: [],
			...extra
		} as any,
		emit
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	expect(res?.error, `${seedKey}: ${res?.error}`).toBeUndefined()
	return res.session.id as number
}

const clockOf = async (sessionId: number) => {
	const [r] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return { year: r!.storyClockYear, month: r!.storyClockMonth, day: r!.storyClockDay, hour: r!.storyClockHour, minute: r!.storyClockMinute }
}
const NONE = { year: null, month: null, day: null, hour: null, minute: null }
const TODAY = { year: 2026, month: 11, day: 16, hour: null, minute: null }

const notesSwitch = async (sessionId: number) => {
	const [b] = await db
		.select({ on: schema.lorebooks.timelineEnabled })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	return b!.on
}

const book = async (name: string, values: Record<string, unknown> = {}) =>
	(await db.insert(schema.lorebooks).values({ name, userId: ownerId, timelineEnabled: true, ...values } as any).returning())[0]!

/** Only `Date` is faked: timers and the event loop run as they do. */
const at = (iso: string) => {
	vi.useFakeTimers({ toFake: ["Date"] })
	vi.setSystemTime(new Date(iso))
}
const NOW = "2026-11-16T09:00:00Z"

describe("a Story preset's own new notes", () => {
	it.each(STORY)("%s: true keeps a timeline and starts today", async (key) => {
		at(NOW)
		const id = await create(key, { notesTimeline: true })
		expect(await notesSwitch(id)).toBe(true)
		expect(await clockOf(id)).toEqual(TODAY)
	})
	it.each(STORY)("%s: false keeps none and writes no clock", async (key) => {
		at(NOW)
		const id = await create(key, { notesTimeline: false })
		expect(await notesSwitch(id)).toBe(false)
		expect(await clockOf(id)).toEqual(NONE)
	})
	it.each(STORY)("%s: absent is the default, off", async (key) => {
		at(NOW)
		const id = await create(key)
		expect(await notesSwitch(id)).toBe(false)
		expect(await clockOf(id)).toEqual(NONE)
	})
})

describe("a preset that pins the timeline on", () => {
	const pinned = async (run: () => Promise<void>) => {
		const [row] = await db.select().from(schema.sessionPresets).where(eq(schema.sessionPresets.id, await presetId(LIVING)))
		const before = row!.defaults as Record<string, unknown> | null
		await db.update(schema.sessionPresets).set({ defaults: { ...(before ?? {}), timeline: true } } as any).where(eq(schema.sessionPresets.id, row!.id))
		try {
			await run()
		} finally {
			await db.update(schema.sessionPresets).set({ defaults: before } as any).where(eq(schema.sessionPresets.id, row!.id))
		}
	}
	it("absent is on; false is off", async () => {
		at(NOW)
		await pinned(async () => {
			const absent = await create(LIVING)
			expect(await notesSwitch(absent)).toBe(true)
			expect(await clockOf(absent)).toEqual(TODAY)
			const off = await create(LIVING, { notesTimeline: false })
			expect(await notesSwitch(off)).toBe(false)
			expect(await clockOf(off)).toEqual(NONE)
		})
	})
})

describe("a genre that requires a timeline", () => {
	it("is on whatever is sent, with no error", async () => {
		at(NOW)
		const id = await create(CRAWLER, { notesTimeline: false })
		expect(await notesSwitch(id)).toBe(true)
		expect(await clockOf(id)).toMatchObject({ year: 2026, month: 11, day: 16 })
	})
})

describe("a session that does not get its own new notes", () => {
	it("a chosen lorebook: false changes nothing against absent", async () => {
		at(NOW)
		const b = await book("Chosen", { storyClockYear: 12, storyClockMonth: 4 })
		const absent = await create(LIVING, {}, { lorebookId: b.id })
		const off = await create(LIVING, { notesTimeline: false }, { lorebookId: b.id })
		const [after] = await db.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, b.id))
		expect(after!.timelineEnabled).toBe(true)
		expect(await notesSwitch(off)).toBe(await notesSwitch(absent))
		expect(await clockOf(off)).toEqual(await clockOf(absent))
	})

	it("a chosen lorebook keeps a named clock as today even with false", async () => {
		at(NOW)
		const b = await book("Chosen clock")
		const clock = { storyClockYear: 2030, storyClockMonth: 5, storyClockDay: 17 }
		const absent = await create(LIVING, {}, { lorebookId: b.id, ...clock })
		const off = await create(LIVING, { notesTimeline: false }, { lorebookId: b.id, ...clock })
		expect(await clockOf(off)).toEqual(await clockOf(absent))
		expect(await clockOf(off)).toMatchObject({ year: 2030, month: 5, day: 17 })
	})

	it("a starter kit: the kit's switch is kept whatever is sent", async () => {
		at(NOW)
		for (const kitOn of [true, false]) {
			const kit = await book(`Kit ${kitOn}`, { kind: "starter_kit", timelineEnabled: kitOn })
			const absent = await create(LIVING, { starterKit: { lorebookId: kit.id } })
			for (const sent of [true, false]) {
				const id = await create(LIVING, { starterKit: { lorebookId: kit.id }, notesTimeline: sent })
				expect(await notesSwitch(id)).toBe(await notesSwitch(absent))
				expect(await clockOf(id)).toEqual(await clockOf(absent))
			}
		}
	})
})

describe("a date the person picks", () => {
	const PICKED = { storyClockYear: 2030, storyClockMonth: 5, storyClockDay: 17 }
	it("is honoured with the timeline on", async () => {
		at(NOW)
		const id = await create(MINIMAL, { notesTimeline: true }, PICKED)
		expect(await clockOf(id)).toEqual({ year: 2030, month: 5, day: 17, hour: null, minute: null })
	})
	it("is never written with the timeline off (false, or absent on a default-off preset)", async () => {
		at(NOW)
		const off = await create(MINIMAL, { notesTimeline: false }, PICKED)
		expect(await notesSwitch(off)).toBe(false)
		expect(await clockOf(off)).toEqual(NONE)
		const absent = await create(LIVING, {}, PICKED)
		expect(await notesSwitch(absent)).toBe(false)
		expect(await clockOf(absent)).toEqual(NONE)
	})
})

describe("a second boot", () => {
	it("changes nothing: the one-shot pass is skipped by its marker", async () => {
		at(NOW)
		const on = await create(MINIMAL, { notesTimeline: true })
		const off = await create(MINIMAL, { notesTimeline: false })
		const { settleTimelineSwitches } = await import("$lib/server/lorebooks/timelinePass")
		const { runWithBootMarker, writeBootMarker } = await import("$lib/server/startup/bootMarkers")
		// The upgrade's boot ran the pass once, before these sessions were made.
		await writeBootMarker(db as any, "timeline-switch")
		for (let i = 0; i < 2; i++) {
			await runWithBootMarker(db as any, {
				name: "timeline-switch",
				doneMarker: "timeline-switch",
				run: async () => void (await settleTimelineSwitches(db as any))
			})
			expect(await notesSwitch(on)).toBe(true)
			expect(await notesSwitch(off)).toBe(false)
			expect(await clockOf(on)).toEqual(TODAY)
			expect(await clockOf(off)).toEqual(NONE)
		}
	})
})
