/**
 * 🚧 The `summaries-to-routine` pass (`sessions/summariesToRoutine.ts`) and the
 * two sockets that meet it (`sessions:setSessionPreset`, `sessions:update`).
 *
 * Claims: Never becomes the routine at Off and On close at Review, the stored
 * Summaries value is cleared; a mode the owner already chose is kept; a row
 * that only changes a cadence still ends at the stored value's mode; a
 * session without the routine is untouched; other `metadata.scenes` keys
 * survive; a second run changes nothing and an owner's later Full is not
 * reset; switching a preset converts at once and pushes the scene cues; an old
 * client cannot store a Summaries value on a session with the routine.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 })

let testDb: TestDb
let dataDir: string
let ownerId: number
const pushed: Array<{ sessionId: number; event: string }> = []

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "summaries-to-routine-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string) => {
		pushed.push({ sessionId, event })
	}
}))

const SUMMARIES = "core:spec/scene-summaries"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-summaries-to-routine-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "summaries-to-routine-owner")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let seq = 0

async function make(opts: { seedKey?: string; genreId?: string; metadata?: unknown } = {}) {
	let presetId: number | undefined
	if (opts.seedKey) {
		const [p] = await testDb
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, opts.seedKey))
			.limit(1)
		presetId = p!.id
	}
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Summaries Book ${++seq}`, userId: ownerId })
		.returning()
	const [s] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: `Summaries ${seq}`,
			lorebookId: book!.id,
			genreId: opts.genreId ?? "core:genre/story",
			...(presetId ? { presetId } : {}),
			metadata: opts.metadata ?? {}
		} as any)
		.returning()
	return s!.id
}

const withNever = (extra: Record<string, unknown> = {}) => ({ scenes: { summary: "never", ...extra } })

async function routineOf(sessionId: number) {
	const { sessionRoutineOf } = await import("$lib/server/pipelines/routines/sessionRoutines")
	return sessionRoutineOf(db(), sessionId, SUMMARIES)
}
async function modeOf(sessionId: number) {
	const { sessionRoutineMode } = await import("$lib/server/pipelines/routines/sessionRoutines")
	return sessionRoutineMode(db(), sessionId, SUMMARIES)
}
async function metadataOf(sessionId: number) {
	const [s] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return s!.metadata as any
}
async function sessionRowOf(sessionId: number) {
	const [s] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return s!
}
async function rowsOf(sessionId: number) {
	const { registrationScopeWhere } = await import("$lib/server/pipelines/registrations/rows")
	return testDb
		.select()
		.from(schema.registrations)
		.where(registrationScopeWhere({ kind: "session", sessionId }))
		.orderBy(asc(schema.registrations.id))
}
async function setRow(sessionId: number, change: Record<string, unknown>) {
	const reg = (await routineOf(sessionId))!
	const { rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	await upsertRow(db(), rowOfChange({ key: reg.key, ...change }, { kind: "session", sessionId }, "owner"))
}
async function convert(sessionId: number) {
	const { convertSummariesSetting } = await import("./summariesToRoutine")
	return convertSummariesSetting(db(), sessionId)
}

describe("convertSummariesSetting", () => {
	it("Never becomes the routine Off, the stored value is cleared, and the routine takes nothing", async () => {
		const id = await make({ metadata: withNever() })
		expect(await routineOf(id)).not.toBeNull()
		expect(await convert(id)).toBe("off")
		expect(await modeOf(id)).toBe("off")
		const meta = await metadataOf(id)
		expect(meta.scenes).toBeUndefined()
		const { sceneSummaryDueOf } = await import("$lib/server/scenes/sceneSummaryDue")
		expect((await sceneSummaryDueOf(db(), id, { depth: 6 })).sceneId).toBeNull()
	})

	it("On close becomes Review", async () => {
		const id = await make({ metadata: { scenes: { summary: "onClose" } } })
		expect(await routineOf(id)).not.toBeNull()
		expect(await convert(id)).toBe("review")
		expect(await modeOf(id)).toBe("review")
		expect((await metadataOf(id)).scenes).toBeUndefined()
	})

	it("a mode the owner already chose on the row is kept; the stored value is cleared", async () => {
		const id = await make({ metadata: withNever() })
		await setRow(id, { mode: "full" })
		expect(await convert(id)).toBe("off")
		expect(await modeOf(id)).toBe("full")
		expect((await metadataOf(id)).scenes).toBeUndefined()
	})

	it("a row that only changes a cadence, holding Never, ends Off", async () => {
		const id = await make({ metadata: withNever() })
		await setRow(id, { when: null, order: 5 })
		const rows = await rowsOf(id)
		expect(rows.length).toBe(1)
		expect(rows[0]!.mode).toBeNull()
		expect(await convert(id)).toBe("off")
		expect(await modeOf(id)).toBe("off")
		expect((await rowsOf(id))[0]!.order).toBe(5)
	})

	it("Story Minimal and a session whose own row drops the routine are untouched", async () => {
		const minimal = await make({ seedKey: "core-story-minimal", metadata: withNever() })
		expect(await routineOf(minimal)).toBeNull()
		const dropper = await make({ metadata: withNever() })
		const reg = (await routineOf(dropper))!
		const { rowOfDrop } = await import("$lib/server/pipelines/registrations/rows")
		const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
		await upsertRow(db(), rowOfDrop(reg.key, { kind: "session", sessionId: dropper }, "owner"))
		expect(await routineOf(dropper)).toBeNull()
		for (const id of [minimal, dropper]) {
			const metaBefore = await metadataOf(id)
			const rowsBefore = await rowsOf(id)
			expect(await convert(id)).toBeNull()
			expect(await metadataOf(id)).toEqual(metaBefore)
			expect(await rowsOf(id)).toEqual(rowsBefore)
		}
	})

	it("other metadata.scenes keys survive; scenes goes only when summary was its only key", async () => {
		const id = await make({ metadata: { other: 1, ...withNever({ mode: "manual" }) } })
		expect(await routineOf(id)).not.toBeNull()
		await convert(id)
		expect(await metadataOf(id)).toEqual({ other: 1, scenes: { mode: "manual" } })
		const solo = await make({ metadata: { other: 1, ...withNever() } })
		await convert(solo)
		expect(await metadataOf(solo)).toEqual({ other: 1 })
	})

	it("a boot pass is not activity: updated_at stays", async () => {
		const id = await make({ metadata: withNever() })
		const before = (await sessionRowOf(id)).updatedAt
		await convert(id)
		expect((await sessionRowOf(id)).updatedAt).toEqual(before)
	})
})

describe("summariesToRoutine", () => {
	it("a second run changes nothing, and an owner's later Full is not reset", async () => {
		const a = await make({ metadata: withNever() })
		const b = await make({ metadata: { scenes: { summary: "onClose" } } })
		const none = await make({ seedKey: "core-story-minimal", metadata: withNever() })
		const { summariesToRoutine } = await import("./summariesToRoutine")
		const first = await summariesToRoutine(db())
		expect(first.failed).toBe(0)
		expect(first.converted).toBeGreaterThanOrEqual(2)
		expect(await modeOf(a)).toBe("off")
		expect(await modeOf(b)).toBe("review")
		expect((await metadataOf(none)).scenes).toEqual({ summary: "never" })
		const ids = [a, b, none]
		const snap = async () =>
			Promise.all(ids.map(async (id) => ({ meta: await metadataOf(id), rows: await rowsOf(id) })))
		const before = await snap()
		const second = await summariesToRoutine(db())
		expect(second.converted).toBe(0)
		expect(await snap()).toEqual(before)
		await setRow(a, { mode: "full" })
		await summariesToRoutine(db())
		expect(await modeOf(a)).toBe("full")
	})
})

const fakeSocket = () =>
	({
		user: { id: ownerId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }), in: () => ({ fetchSockets: async () => [] }) }
	}) as any

describe("sockets", () => {
	it("setSessionPreset: Minimal holding Never switched to Living is Off at once, cues are pushed, and the next pass changes nothing", async () => {
		const id = await make({ seedKey: "core-story-minimal", metadata: withNever() })
		expect(await routineOf(id)).toBeNull()
		const [living] = await testDb
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-story-living"))
		const { sessionsSetSessionPresetHandler } = await import("$lib/server/sockets/sessions")
		pushed.length = 0
		const res: any = await sessionsSetSessionPresetHandler.handler(
			fakeSocket(),
			{ sessionId: id, presetId: living!.id } as any,
			() => {}
		)
		expect(res?.error, res?.error).toBeUndefined()
		expect(await routineOf(id)).not.toBeNull()
		expect(await modeOf(id)).toBe("off")
		expect((await metadataOf(id)).scenes).toBeUndefined()
		expect(pushed).toContainEqual({ sessionId: id, event: "scenes:cues" })
		const before = { meta: await metadataOf(id), rows: await rowsOf(id) }
		const { summariesToRoutine } = await import("./summariesToRoutine")
		await summariesToRoutine(db())
		expect({ meta: await metadataOf(id), rows: await rowsOf(id) }).toEqual(before)
	})

	async function update(id: number, sceneSettings: unknown) {
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const [s] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, id))
		const res: any = await sessionsUpdateHandler.handler(
			fakeSocket(),
			{ session: { id, name: s!.name }, sceneSettings } as any,
			() => {}
		)
		expect(res?.error, res?.error).toBeUndefined()
	}

	it("sessions:update drops summary where the session has the routine, and keeps it where it has none", async () => {
		const withRoutine = await make()
		expect(await routineOf(withRoutine)).not.toBeNull()
		await update(withRoutine, { mode: "manual", summary: "never" })
		expect((await metadataOf(withRoutine)).scenes).toEqual({ mode: "manual" })

		const without = await make({ seedKey: "core-story-minimal" })
		expect(await routineOf(without)).toBeNull()
		await update(without, { mode: "manual", summary: "never" })
		expect((await metadataOf(without)).scenes).toEqual({ mode: "manual", summary: "never" })
	})

	it("sessions:update converts a stored Never that was never converted before it replaces the settings", async () => {
		// An import, or a routine added to the preset since: the session has the
		// routine and still holds Never. A save, and *Use the genre's settings*
		// (null), must turn it into the routine's Off, never wipe it.
		const saved = await make({ metadata: withNever() })
		expect(await modeOf(saved)).toBe("full")
		await update(saved, { mode: "manual" })
		expect(await modeOf(saved)).toBe("off")
		expect((await metadataOf(saved)).scenes).toEqual({ mode: "manual" })

		const cleared = await make({ metadata: withNever() })
		await update(cleared, null)
		expect(await modeOf(cleared)).toBe("off")
		expect((await metadataOf(cleared)).scenes).toBeUndefined()
	})
})
