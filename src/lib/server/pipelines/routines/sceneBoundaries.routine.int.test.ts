/**
 * 🚧 The scenes routine, end to end (2026-11-12): `core:spec/scene-boundaries`
 * is a code-only maintenance routine on `core:cadence/every-n-rounds@1`
 * (`n: 2`), registered by the genre defaults of Story, the Lair and the
 * Dungeon Crawler, dropped by Story's Minimal preset, absent from Chat and the
 * Guide. Each run reads only the lines at least two rounds old (the walk is
 * proven in `scenes/sceneBoundaries.int.test.ts`); here the whole path runs
 * on real Story turns with a scripted model and routines switched on:
 *
 *  · it runs at the end of rounds 2 and 4, not after 1 and 3;
 *  · a day that changes on a line is placed at that line once the line is two
 *    rounds old and a run comes due, in a session of two and of three seats
 *    (Automatic: a scene opens there, its cue is `placed`, trigger
 *    `dayCrossed`); nothing is placed for it before that run;
 *  · Story's Minimal preset, and Chat, place no scene and no cue;
 *  · a session already in play picks the routine up at boot, and a second
 *    boot changes nothing.
 *
 * A round is counted by the round tick's runs (Story registers it: one run
 * per round that ended).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scene-routine-int-test-secret" }
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

class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const text = JSON.stringify(this.injected ?? {})
		// The reckoning and the sweep answer with nothing to change.
		const answer = text.includes("You keep the record of a story")
			? JSON.stringify({ deltas: [], clock: [], place: [] })
			: text.includes("You keep the books of a story")
				? JSON.stringify({
						summary: { name: "", content: "" },
						lore: [],
						cast: [],
						worldState: [],
						relationships: [],
						scenes: [],
						goals: ""
					})
				: "They walk on."
		return {
			compiledPrompt: this.injected ?? {
				prompt: "p",
				messages: undefined,
				meta: {}
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) =>
				onContent(answer)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const SCENES = "core:spec/scene-boundaries"
const ROUND_TICK = "core:spec/round-tick"
const STORY = "core:genre/story"

let ownerId: number
let n = 0
const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scene-routine-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "scene-routine-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"scene-routine-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Scene routine test sampling",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 300,
				temperature: 0.2
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
	;(await import("./runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("./runs")).setRoutinesEnabled(false)
	;(await import("./tick")).stopSystemTick()
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

/**
 * A session on a fresh book with `characters` seated characters and its own
 * clock at Year 412, month 3, day 5, 09:00. Story · Living unless `seedKey`
 * names another preset; Automatic scenes unless `mode`.
 */
async function make(
	opts: {
		characters?: number
		seedKey?: string
		mode?: "suggested" | "automatic"
	} = {}
) {
	const name = `scn-${++n}`
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `The Mill ${name}` })
		.returning()
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(
			eq(
				schema.sessionPresets.seedKey,
				opts.seedKey ?? "core-story-living"
			)
		)
	expect(p, opts.seedKey ?? "core-story-living").toBeTruthy()
	const characterIds: number[] = []
	for (let i = 0; i < (opts.characters ?? 1); i++) {
		const [c] = await db
			.insert(schema.characters)
			.values({
				userId: ownerId,
				name: `Maren ${name} ${i + 1}`,
				description: "A miller.",
				isPersona: false
			})
			.returning()
		characterIds.push(c!.id)
	}
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: p!.id },
			characterIds,
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({
			lorebookId: book!.id,
			storyClockYear: 412,
			storyClockMonth: 3,
			storyClockDay: 5,
			storyClockHour: 9,
			storyClockMinute: 0,
			metadata: {
				...((row?.metadata as object) ?? {}),
				scenes: {
					...((row?.metadata as any)?.scenes ?? {}),
					mode: opts.mode ?? "automatic"
				}
			}
		})
		.where(eq(schema.sessions.id, sessionId))
	return { sessionId, lorebookId: book!.id }
}

async function send(sessionId: number, content = "We walk to the mill.") {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const setDay = (sessionId: number, day: number) =>
	db
		.update(schema.sessions)
		.set({ storyClockDay: day })
		.where(eq(schema.sessions.id, sessionId))

const runsOf = (sessionId: number, specSlug: string) =>
	db
		.select({
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason,
			triggerFamily: schema.pipelineRuns.triggerFamily
		})
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.specSlug, specSlug)
			)
		)
		.orderBy(asc(schema.pipelineRuns.id))

/** Rounds that have ended (the round tick runs once for each). */
const roundsEnded = async (sessionId: number) =>
	(await runsOf(sessionId, ROUND_TICK)).length
/** Runs of the scenes routine. */
const sceneRuns = async (sessionId: number) =>
	(await runsOf(sessionId, SCENES)).filter(
		(r) => r.triggerFamily === "routine"
	)

/** Play until `rounds` rounds have ended (one line from the person each time round, until the round closes). */
async function playTo(sessionId: number, rounds: number) {
	for (let guard = 0; (await roundsEnded(sessionId)) < rounds; guard++) {
		expect(guard, "rounds did not close").toBeLessThan(20)
		await send(sessionId)
	}
	expect(await roundsEnded(sessionId)).toBe(rounds)
}

const cuesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sceneCues)
		.where(eq(schema.sceneCues.sessionId, sessionId))
		.orderBy(asc(schema.sceneCues.id))
const scenesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
		.orderBy(asc(schema.scenes.id))
const dayCues = async (sessionId: number) =>
	(await cuesOf(sessionId)).filter((c) => c.trigger === "dayCrossed")

/** The first line written after the day moved, found by its stamp. */
async function firstLineOfDay(sessionId: number, day: number) {
	const rows = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.storyClockDay, day)
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
		.limit(1)
	return rows[0]!.id
}

/** Round 1 on day 5, then the day moves and round 2 is the first on day 6. */
async function dayChangesInRoundTwo(sessionId: number) {
	await playTo(sessionId, 1)
	await setDay(sessionId, 6)
	await playTo(sessionId, 2)
	return firstLineOfDay(sessionId, 6)
}

describe("the scenes routine, end to end", () => {
	it("runs at the end of rounds 2 and 4, not after rounds 1 and 3", async () => {
		const { sessionId } = await make()
		const seen: number[] = []
		for (let r = 1; r <= 4; r++) {
			await playTo(sessionId, r)
			seen.push((await sceneRuns(sessionId)).length)
		}
		expect(seen).toEqual([0, 1, 1, 2])
		for (const run of await sceneRuns(sessionId))
			expect(run.outcome).toBe("ok")
	})

	it("one to one: the day that changed in round 2 is placed at its line after round 4, not before", async () => {
		const { sessionId } = await make({ characters: 1 })
		const lineId = await dayChangesInRoundTwo(sessionId)
		// The run at the end of round 2 reads rounds 1 only: nothing for the day yet.
		expect(await sceneRuns(sessionId)).toHaveLength(1)
		expect(await dayCues(sessionId)).toEqual([])
		await playTo(sessionId, 3)
		// The line is two rounds old, but no run is due after round 3.
		expect(await dayCues(sessionId)).toEqual([])
		await playTo(sessionId, 4)
		expect(await sceneRuns(sessionId)).toHaveLength(2)
		const cues = await dayCues(sessionId)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({
			atMessageId: lineId,
			state: "placed",
			trigger: "dayCrossed"
		})
		const scenes = await scenesOf(sessionId)
		expect(scenes.map((s) => s.openedAtMessageId)).toContain(lineId)
	})

	it("a group of three seats: a round is three lines and the boundary is placed at the same kind of line", async () => {
		const { sessionId } = await make({ characters: 2 })
		const lineId = await dayChangesInRoundTwo(sessionId)
		const lines = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
		// A person and two characters: three lines in each of the two rounds.
		expect(lines).toHaveLength(6)
		expect(await dayCues(sessionId)).toEqual([])
		await playTo(sessionId, 3)
		expect(await dayCues(sessionId)).toEqual([])
		await playTo(sessionId, 4)
		const cues = await dayCues(sessionId)
		expect(cues).toHaveLength(1)
		expect(cues[0]).toMatchObject({
			atMessageId: lineId,
			state: "placed",
			trigger: "dayCrossed"
		})
		expect(
			(await scenesOf(sessionId)).map((s) => s.openedAtMessageId)
		).toContain(lineId)
	})

	it("Story Minimal registers no scenes routine: no scene, no cue, and the first line opens none", async () => {
		const { sessionId } = await make({ seedKey: "core-story-minimal" })
		await dayChangesInRoundTwo(sessionId)
		await playTo(sessionId, 5)
		expect(await sceneRuns(sessionId)).toEqual([])
		expect(await scenesOf(sessionId)).toEqual([])
		expect(await cuesOf(sessionId)).toEqual([])
	})

	it("a session already in play picks the routine up at boot; a second boot changes nothing", async () => {
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const has = async (sessionId: number) =>
			(await effectiveRegistrations(
				db as never,
				sessionId
			))!.effective.some((r) => r.pipeline === SCENES)
		const { sessionId } = await make()
		expect(await has(sessionId)).toBe(true)
		// As before the routine existed: no genre row for it.
		await db
			.delete(schema.registrations)
			.where(
				and(
					eq(schema.registrations.specSlug, SCENES),
					eq(schema.registrations.scopeKind, "genre"),
					eq(schema.registrations.scopeRef, STORY)
				)
			)
		expect(await has(sessionId)).toBe(false)
		await bootstrapPipelines(db)
		expect(await has(sessionId)).toBe(true)
		const snapshot = async () =>
			await db
				.select({
					id: schema.registrations.id,
					key: schema.registrations.key,
					scopeKind: schema.registrations.scopeKind,
					scopeRef: schema.registrations.scopeRef,
					values: schema.registrations.values,
					updatedAt: schema.registrations.updatedAt
				})
				.from(schema.registrations)
				.orderBy(asc(schema.registrations.id))
		const before = await snapshot()
		expect(
			before.some((r) => r.key === "every-n-rounds→scene-boundaries")
		).toBe(true)
		await bootstrapPipelines(db)
		expect(await snapshot()).toEqual(before)
	})
})
