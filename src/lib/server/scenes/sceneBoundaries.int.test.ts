/**
 * 🚧 The scenes routine's host side (2026-11-12): `sceneBoundariesOf` — the
 * read-only walk behind `core:query/scene-boundaries@1` — and the outlet's
 * boundary-trigger path (`proposeJudgedSceneCue` with a `trigger`), with the
 * reduced per-line hook (`watchSceneBoundaries`) beside them.
 *
 * Rounds: a session here has no seats in its turn order and every line is a
 * person's, so each line closes its own round (`tallyTurn`: the round ends
 * when every active speaker — the seats and the people who spoke — has had a
 * turn). With N lines the round in progress is N + 1 and line k is in round
 * k, so at `depth` 2 the newest line that is old enough is line N - 1.
 *
 * "The session has the scenes routine": the real core genres, published by
 * `bootstrapPipelines` — Story (and the Lair) register it; Story's Minimal
 * preset does not.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string
let ownerId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scene-boundaries-test-secret" }
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
	broadcastToSessionUsers: async () => {}
}))

const LAIR = "core:genre/lair"
const LOCATION = "core:slot/location@1"
let minimalPresetId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scene-boundaries-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(testDb, "scene-boundaries-owner")).id
	const [minimal] = await testDb
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	minimalPresetId = minimal!.id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
/** A book and a session on Year 5 Mo 1 Day 2 (Story unless `genreId`; Suggested unless `mode`). */
async function makeWorld(
	opts: {
		mode?: "suggested" | "automatic"
		genreId?: string
		presetId?: number
		branchOf?: number
	} = {}
) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Scene Boundaries Book ${++seq}`, userId: ownerId })
		.returning()
	await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{ lorebookId: lorebook.id, year: 5, month: 1, day: 2 }
			])
		)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: lorebook.id,
			...(opts.genreId ? { genreId: opts.genreId } : {}),
			...(opts.presetId ? { presetId: opts.presetId } : {}),
			...(opts.branchOf ? { branchOfSessionId: opts.branchOf } : {}),
			storyClockYear: 5,
			storyClockMonth: 1,
			storyClockDay: 2,
			metadata: opts.mode ? { scenes: { mode: opts.mode } } : {}
		} as any)
		.returning()
	return { session }
}

async function say(
	sessionId: number,
	content: string,
	extra: Record<string, unknown> = {}
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(
		testDb as any,
		{ sessionId, role: "user", content, ...extra } as any
	)
}

async function setDay(sessionId: number, day: number) {
	await testDb
		.update(schema.sessions)
		.set({ storyClockDay: day })
		.where(eq(schema.sessions.id, sessionId))
}

async function setWorld(sessionId: number, slotId: string, v: unknown) {
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "session",
		ownerId: sessionId,
		slotId,
		value: { v },
		sessionId,
		updatedBy: "run:test"
	} as any)
}

/** n plain lines on the current day. */
async function plain(sessionId: number, n: number) {
	const ids: number[] = []
	for (let i = 0; i < n; i++)
		ids.push((await say(sessionId, `Line ${i + 1}.`)).id)
	return ids
}

/** The walk (`every` wide by default, so a young session's whole past is in the window), with the first-scene `opening` boundary left out (these tests are about the others). */
async function found(
	sessionId: number,
	opts: { depth?: number; every?: number } = {}
) {
	const { sceneBoundariesOf } = await import("./boundaryWatcher")
	const r = await sceneBoundariesOf(testDb as any, sessionId, {
		depth: opts.depth ?? 2,
		every: opts.every ?? 10
	})
	return {
		...r,
		boundaries: r.boundaries.filter((b) => b.trigger !== "opening")
	}
}

/** What the routine does with one boundary: the outlet, once. */
async function place(
	sessionId: number,
	b: { at: number; trigger: string; reason: string }
) {
	const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
	return proposeJudgedSceneCue(testDb as any, {
		sessionId,
		channel: "main",
		atMessageId: b.at,
		reason: b.reason,
		trigger: b.trigger
	})
}

const cuesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sceneCues)
		.where(eq(schema.sceneCues.sessionId, sessionId))
		.orderBy(asc(schema.sceneCues.id))
const scenesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
		.orderBy(asc(schema.scenes.id))

describe("the walk — what it reads", () => {
	test("1. a day change is returned only once its line is depth rounds old", async () => {
		const w = await makeWorld()
		await say(w.session.id, "Night.")
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Morning.")
		expect((await found(w.session.id)).boundaries).toEqual([])
		// One round on, the day-3 line is 2 rounds old.
		await say(w.session.id, "Later.")
		expect((await found(w.session.id)).boundaries).toEqual([
			{ at: m2.id, trigger: "dayCrossed", reason: "the day changed" }
		])
	}, 60_000)

	test("2. two day changes come back in line order; Automatic opens two scenes from them", async () => {
		const w = await makeWorld({ mode: "automatic" })
		await say(w.session.id, "One.")
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Two.")
		await setDay(w.session.id, 4)
		const m3 = await say(w.session.id, "Three.")
		await plain(w.session.id, 2)
		const { boundaries } = await found(w.session.id)
		expect(boundaries.map((b) => [b.at, b.trigger])).toEqual([
			[m2.id, "dayCrossed"],
			[m3.id, "dayCrossed"]
		])
		for (const b of boundaries)
			expect(await place(w.session.id, b)).toMatchObject({
				outcome: "placed"
			})
		expect(
			(await scenesOf(w.session.id)).map((s) => s.openedAtMessageId)
		).toEqual([m2.id, m3.id])
		// What was placed is not found again.
		expect((await found(w.session.id)).boundaries).toEqual([])
	}, 60_000)

	test("3. a place that moves out and back inside the window is nothing; A to B to C is two", async () => {
		const { openScene } = await import("./liveScenes")
		const back = await makeWorld({ genreId: LAIR })
		await setWorld(back.session.id, LOCATION, "the Entrance")
		const a1 = await say(back.session.id, "We step in.")
		await openScene(testDb as any, {
			sessionId: back.session.id,
			userId: ownerId,
			atMessageId: a1.id
		})
		await setWorld(back.session.id, LOCATION, "the Crypt")
		await say(back.session.id, "Bones.")
		await setWorld(back.session.id, LOCATION, "the Entrance")
		await say(back.session.id, "Back out.")
		await plain(back.session.id, 2)
		expect((await found(back.session.id)).boundaries).toEqual([])

		const onward = await makeWorld({ genreId: LAIR })
		await setWorld(onward.session.id, LOCATION, "the Entrance")
		const b1 = await say(onward.session.id, "We step in.")
		await openScene(testDb as any, {
			sessionId: onward.session.id,
			userId: ownerId,
			atMessageId: b1.id
		})
		await setWorld(onward.session.id, LOCATION, "the Crypt")
		const b2 = await say(onward.session.id, "Bones.")
		await setWorld(onward.session.id, LOCATION, "the Vault")
		const b3 = await say(onward.session.id, "Gold.")
		await plain(onward.session.id, 2)
		expect(
			(await found(onward.session.id)).boundaries.map((b) => [
				b.at,
				b.trigger
			])
		).toEqual([
			[b2.id, "placeChanged"],
			[b3.id, "placeChanged"]
		])
	}, 60_000)

	test("4. a line deleted or taken Back before it is old enough is not returned; Forward brings it back", async () => {
		const { rewindTurn, forwardTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const w = await makeWorld()
		await say(w.session.id, "One.")
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Two.")
		await say(w.session.id, "Three.")
		await say(w.session.id, "Four.")
		expect((await found(w.session.id)).boundaries).toHaveLength(1)
		for (let i = 0; i < 3; i++) {
			const r = await rewindTurn(testDb as any, {
				sessionId: w.session.id,
				userId: ownerId
			})
			expect(r.ok).toBe(true)
		}
		expect((await found(w.session.id)).boundaries).toEqual([])
		for (let i = 0; i < 3; i++) {
			const r = await forwardTurn(testDb as any, {
				sessionId: w.session.id,
				userId: ownerId
			})
			expect(r.ok).toBe(true)
		}
		expect((await found(w.session.id)).boundaries.map((b) => b.at)).toEqual(
			[m2.id]
		)

		// Deleted before it is old enough: the line is gone, and so is its day change.
		const d = await makeWorld()
		await say(d.session.id, "One.")
		await setDay(d.session.id, 3)
		const gone = await say(d.session.id, "Two.")
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(testDb as any, gone.id)
		await setDay(d.session.id, 2)
		await plain(d.session.id, 3)
		expect((await found(d.session.id)).boundaries).toEqual([])
	}, 60_000)
})

describe("a time action's marker", () => {
	test("5. the marker is bound to the next line and stays pending; the walk finds it and placing it reuses the row", async () => {
		const { noteTimeAction, watchSceneBoundaries, offeredSceneCues } =
			await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "automatic" })
		await say(w.session.id, "One.")
		await noteTimeAction(testDb as any, {
			sessionId: w.session.id,
			cause: "person"
		})
		expect(await cuesOf(w.session.id)).toMatchObject([
			{
				channel: "main",
				trigger: "timeAction",
				state: "pending",
				atMessageId: null
			}
		])
		const m2 = await say(w.session.id, "Two.")
		expect(
			await watchSceneBoundaries(testDb as any, {
				sessionId: w.session.id,
				messageId: m2.id
			})
		).toBeNull()
		expect(await cuesOf(w.session.id)).toMatchObject([
			{ trigger: "timeAction", state: "pending", atMessageId: m2.id }
		])
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
		// A regenerate lands the same line again: nothing changes.
		await watchSceneBoundaries(testDb as any, {
			sessionId: w.session.id,
			messageId: m2.id
		})
		expect(await cuesOf(w.session.id)).toHaveLength(1)

		await plain(w.session.id, 2)
		const { boundaries } = await found(w.session.id)
		expect(boundaries.map((b) => [b.at, b.trigger])).toEqual([
			[m2.id, "timeAction"]
		])
		expect(await place(w.session.id, boundaries[0]!)).toMatchObject({
			outcome: "placed"
		})
		const cues = await cuesOf(w.session.id)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({
			trigger: "timeAction",
			state: "placed",
			atMessageId: m2.id,
			reason: null
		})
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
	}, 60_000)
})

describe("End scene here, through the hook", () => {
	test("6. Automatic: the next scene opens at the next landed line; Suggested: the chip", async () => {
		const { followEndedScene, watchSceneBoundaries, offeredSceneCues } =
			await import("./boundaryWatcher")
		const { openScene } = await import("./liveScenes")
		const auto = await makeWorld({ mode: "automatic" })
		const a1 = await say(auto.session.id, "One.")
		await openScene(testDb as any, {
			sessionId: auto.session.id,
			userId: ownerId,
			atMessageId: a1.id
		})
		const a2 = await say(auto.session.id, "Two.")
		await followEndedScene(testDb as any, {
			sessionId: auto.session.id,
			channel: "main",
			endedAt: a2.id,
			userId: ownerId
		})
		const a3 = await say(auto.session.id, "Three.")
		const placed = await watchSceneBoundaries(testDb as any, {
			sessionId: auto.session.id,
			messageId: a3.id
		})
		expect(placed).toMatchObject({
			outcome: "placed",
			triggers: ["endedHere"],
			messageId: a3.id
		})
		expect(
			(await scenesOf(auto.session.id)).map((s) => s.openedAtMessageId)
		).toEqual([a1.id, a3.id])

		const sug = await makeWorld({ mode: "suggested" })
		const s1 = await say(sug.session.id, "One.")
		await openScene(testDb as any, {
			sessionId: sug.session.id,
			userId: ownerId,
			atMessageId: s1.id
		})
		const s2 = await say(sug.session.id, "Two.")
		await followEndedScene(testDb as any, {
			sessionId: sug.session.id,
			channel: "main",
			endedAt: s2.id,
			userId: ownerId
		})
		const s3 = await say(sug.session.id, "Three.")
		expect(
			await watchSceneBoundaries(testDb as any, {
				sessionId: sug.session.id,
				messageId: s3.id
			})
		).toMatchObject({
			outcome: "suggested",
			triggers: ["endedHere"]
		})
		expect(
			await offeredSceneCues(testDb as any, sug.session.id)
		).toMatchObject([{ messageId: s3.id, triggers: ["endedHere"] }])
		expect(await scenesOf(sug.session.id)).toHaveLength(1)
	}, 60_000)
})

describe("Suggested — a run stops at its first offer", () => {
	test("7. the second boundary is skipped while the first waits; after the person answers, the next run offers it", async () => {
		const { offeredSceneCues, decideSceneCue } = await import(
			"./boundaryWatcher"
		)
		const w = await makeWorld({ mode: "suggested" })
		await say(w.session.id, "One.")
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Two.")
		await setDay(w.session.id, 4)
		const m3 = await say(w.session.id, "Three.")
		await plain(w.session.id, 2)
		const { boundaries } = await found(w.session.id)
		expect(boundaries.map((b) => b.at)).toEqual([m2.id, m3.id])
		const first = await place(w.session.id, boundaries[0]!)
		expect(first).toMatchObject({ outcome: "suggested" })
		expect(await place(w.session.id, boundaries[1]!)).toEqual({
			outcome: "skipped",
			note: "a scene cue is already waiting on this channel"
		})
		expect(await scenesOf(w.session.id)).toHaveLength(0)
		expect(
			await offeredSceneCues(testDb as any, w.session.id)
		).toMatchObject([{ messageId: m2.id }])

		await decideSceneCue(testDb as any, {
			cueId: first.cueId!,
			userId: ownerId,
			accept: false
		})
		const next = await found(w.session.id)
		expect(next.boundaries.map((b) => b.at)).toEqual([m3.id])
		expect(await place(w.session.id, next.boundaries[0]!)).toMatchObject({
			outcome: "suggested"
		})
		expect(
			await offeredSceneCues(testDb as any, w.session.id)
		).toMatchObject([{ messageId: m3.id, reason: "the day changed" }])
	}, 60_000)
})

describe("a cue nobody can answer does not hold the routine up", () => {
	test("7b. an open cue at or before the channel's latest boundary is passed over", async () => {
		const { openScene } = await import("./liveScenes")
		const w = await makeWorld({ mode: "automatic" })
		const m1 = await say(w.session.id, "One.")
		const m2 = await say(w.session.id, "Two.")
		// An old, unanswered chip at line 1; then a person started a scene at line 2.
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: m1.id,
			trigger: "dayCrossed",
			state: "open"
		} as any)
		await openScene(testDb as any, {
			sessionId: w.session.id,
			channel: "main",
			userId: ownerId,
			atMessageId: m2.id
		} as any)
		await setDay(w.session.id, 5)
		const m3 = await say(w.session.id, "Three.")
		await plain(w.session.id, 2)
		const placed = await place(w.session.id, {
			at: m3.id,
			trigger: "dayCrossed",
			reason: ""
		})
		expect(placed).toMatchObject({ outcome: "placed" })
	}, 60_000)

	test("7c. a time action's marker bound to its line does not switch the judged check off", async () => {
		const { judgedSceneCheckOf } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "automatic" })
		const ids = await plain(w.session.id, 8)
		const before = await judgedSceneCheckOf(testDb as any, w.session.id, {})
		// A bound marker, as the per-line hook leaves it for the routine.
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[0]!,
			trigger: "timeAction",
			state: "pending"
		} as any)
		const after = await judgedSceneCheckOf(testDb as any, w.session.id, {})
		expect((after as { why?: string }).why ?? "").not.toContain("already waiting")
		// An unbound one still waits, as it always did.
		await testDb
			.delete(schema.sceneCues)
			.where(eq(schema.sceneCues.sessionId, w.session.id))
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: null,
			trigger: "endedHere",
			state: "pending"
		} as any)
		const waiting = await judgedSceneCheckOf(testDb as any, w.session.id, {})
		expect(waiting).toMatchObject({ due: false })
		expect((waiting as { why?: string }).why).toContain("already waiting")
		void before
	}, 60_000)

	test("7d. one run returns a bounded handful, and the next run carries on", async () => {
		const w = await makeWorld({ mode: "automatic" })
		await say(w.session.id, "Start.")
		const crossed: number[] = []
		for (let d = 2; d <= 16; d++) {
			await setDay(w.session.id, d)
			crossed.push((await say(w.session.id, `Day ${d}.`)).id)
		}
		await plain(w.session.id, 2)
		const first = await found(w.session.id, { every: 50 })
		expect(first.boundaries.length).toBeLessThanOrEqual(12)
		expect(first.boundaries.length).toBeGreaterThan(0)
		for (const b of first.boundaries) await place(w.session.id, b)
		const next = await found(w.session.id, { every: 50 })
		const all = [...first.boundaries, ...next.boundaries].map((b) => b.at)
		expect(
			all,
			JSON.stringify({
				first: first.boundaries.map((b) => b.at),
				next: next.boundaries.map((b) => b.at),
				crossed
			})
			// The first dated line crosses nothing: the story had no day before it.
		).toEqual(crossed.slice(1))
	}, 120_000)
})

describe("a session with no scenes routine", () => {
	test("8. nothing is placed, offered or marked, and the first line opens no scene", async () => {
		const {
			watchSceneBoundaries,
			noteTimeAction,
			scenesRoutineOn,
			offeredSceneCues
		} = await import("./boundaryWatcher")
		const story = await makeWorld()
		expect(await scenesRoutineOn(testDb as any, story.session.id)).toBe(
			true
		)
		const w = await makeWorld({
			mode: "automatic",
			presetId: minimalPresetId
		})
		expect(await scenesRoutineOn(testDb as any, w.session.id)).toBe(false)
		const m1 = await say(w.session.id, "One.")
		expect(
			await watchSceneBoundaries(testDb as any, {
				sessionId: w.session.id,
				messageId: m1.id
			})
		).toBeNull()
		await setDay(w.session.id, 3)
		const m2 = await say(w.session.id, "Two.")
		expect(
			await watchSceneBoundaries(testDb as any, {
				sessionId: w.session.id,
				messageId: m2.id
			})
		).toBeNull()
		await noteTimeAction(testDb as any, {
			sessionId: w.session.id,
			cause: "person"
		})
		expect(await cuesOf(w.session.id)).toEqual([])
		expect(await scenesOf(w.session.id)).toEqual([])
		expect(await offeredSceneCues(testDb as any, w.session.id)).toEqual([])
	}, 60_000)
})

describe("where the walk starts", () => {
	test("9. an old session with no scene, cue or branch reads only the last window; a decided cue bounds it", async () => {
		const old = await makeWorld()
		await say(old.session.id, "One.")
		await setDay(old.session.id, 3)
		await say(old.session.id, "Two.")
		await setDay(old.session.id, 4)
		await say(old.session.id, "Three.")
		await plain(old.session.id, 5)
		// Days changed at lines 2 and 3, far behind the last 2 rounds' window.
		expect((await found(old.session.id, { every: 2 })).boundaries).toEqual(
			[]
		)

		const w = await makeWorld()
		await say(w.session.id, "One.")
		await setDay(w.session.id, 3)
		await say(w.session.id, "Two.")
		await setDay(w.session.id, 4)
		const m3 = await say(w.session.id, "Three.")
		await plain(w.session.id, 2)
		// Window: 5 lines, end is line 4, `every` 2 starts at round 3 — line 3's day change is in it.
		expect(
			(await found(w.session.id, { every: 2 })).boundaries.map(
				(b) => b.at
			)
		).toEqual([m3.id])
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: m3.id,
			trigger: "dayCrossed",
			state: "dismissed",
			decidedAt: new Date()
		})
		expect((await found(w.session.id, { every: 2 })).boundaries).toEqual([])
	}, 60_000)

	test("10. a branch never reads its copied lines", async () => {
		const [source] = await testDb
			.insert(schema.sessions)
			.values({ userId: ownerId, isGroup: false } as any)
			.returning()
		const branch = await makeWorld({ branchOf: source!.id })
		const copied = (n: number) => ({ metadata: { copyOf: 1000 + n } })
		await say(branch.session.id, "One.", copied(1))
		await setDay(branch.session.id, 3)
		await say(branch.session.id, "Two.", copied(2))
		await say(branch.session.id, "Three.", copied(3))
		await plain(branch.session.id, 3)
		// A window wide enough to take in line 2: as a branch it still starts after line 3.
		expect(
			(await found(branch.session.id, { every: 6 })).boundaries
		).toEqual([])
		await testDb
			.update(schema.sessions)
			.set({ branchOfSessionId: null })
			.where(eq(schema.sessions.id, branch.session.id))
		expect(
			(await found(branch.session.id, { every: 6 })).boundaries.map(
				(b) => b.trigger
			)
		).toEqual(["dayCrossed"])
	}, 60_000)
})

describe("the outlet", () => {
	test("11. without a trigger it is the judged path still: it refuses while any cue waits", async () => {
		const { proposeJudgedSceneCue } = await import("./boundaryWatcher")
		const w = await makeWorld({ mode: "suggested" })
		const ids = await plain(w.session.id, 7)
		await testDb.insert(schema.sceneCues).values({
			sessionId: w.session.id,
			channel: "main",
			atMessageId: ids[1]!,
			trigger: "dayCrossed",
			state: "open"
		})
		expect(
			await proposeJudgedSceneCue(testDb as any, {
				sessionId: w.session.id,
				channel: "main",
				atMessageId: ids[3]!,
				reason: "the party left the inn"
			})
		).toEqual({
			outcome: "skipped",
			note: "a scene cue is already waiting on this lane"
		})
	}, 60_000)

	test("a trigger the session does not have is refused, and a boundary already placed here is the same boundary", async () => {
		const w = await makeWorld({ mode: "automatic" })
		const ids = await plain(w.session.id, 3)
		expect(
			await place(w.session.id, {
				at: ids[1]!,
				trigger: "teleported",
				reason: "x"
			})
		).toEqual({
			outcome: "refused",
			note: "teleported is not a boundary trigger of this session"
		})
		expect(
			await place(w.session.id, {
				at: ids[1]!,
				trigger: "dayCrossed",
				reason: "x"
			})
		).toMatchObject({ outcome: "placed" })
		expect(
			await place(w.session.id, {
				at: ids[1]!,
				trigger: "narration",
				reason: "x"
			})
		).toMatchObject({
			outcome: "placed",
			note: "the scene at this line was already placed"
		})
		expect(
			(await cuesOf(w.session.id)).map((c) => [c.trigger, c.state])
		).toEqual([
			["dayCrossed", "placed"],
			["narration", "placed"]
		])
		expect(
			await place(w.session.id, {
				at: ids[0]!,
				trigger: "dayCrossed",
				reason: "x"
			})
		).toMatchObject({ outcome: "refused" })
	}, 60_000)
})
