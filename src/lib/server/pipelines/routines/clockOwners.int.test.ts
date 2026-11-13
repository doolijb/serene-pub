/**
 * 🚧 One default owner moves the clock (owner, 2026-11-11: "In core genres we
 * should have one default owner that moves the clock" — goal 6, "no default
 * double move"; lane sense-clk2), proven on real turns with a scripted model
 * and routines switched on:
 *
 *  · Story · Living: a round ending moves the clock exactly once, 5 minutes,
 *    cause `tick` — the reckoning names 30 minutes and it is not applied (its
 *    *Move the clock* ships off);
 *  · every Lair preset (Words only, Rules, The rules decide; owner 2026-11-11,
 *    lane sense-st2b: "Round tick in every Lair preset"): one round moves the
 *    clock exactly once, by the round worth (5 minutes), cause `tick`, with the
 *    keeper Off and with it at Review — the keeper's model call never gates the
 *    move, and (its *Move the clock* off) it moves nothing itself;
 *  · the Lair with a round worth of 0: nothing moves, no line;
 *  · the Lair with the keeper's *Move the clock* on at Full: two moves by
 *    opt-in, the tick's 5 minutes (cause `tick`) and the keeper's named 30
 *    (cause `keeper`).
 *
 * The round worth is controlled by mocking its binding (the genre field is not
 * yet placed; `roundWorth.genres.int.test.ts` runs the real chain). The
 * Dungeon Crawler's case is not here: its turn moves the clock by the plan's
 * minutes, once — `sessions.dungeonCrawler.int.test.ts` plays a round with a
 * scripted Planner and asserts the clock stands at 08:30 after the plan's 30
 * minutes, and the SDK's `coreClockOwners.test.ts` covers the shape.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

/** The round worth the mocked binding publishes; each case sets it. */
const worth = vi.hoisted(() => ({
	minutes: 5,
	get step() {
		return { by: this.minutes, unit: "minutes" as const }
	}
}))
vi.mock("$lib/server/pipelines/runtime/roundWorth", async (orig) => ({
	...(await orig<
		typeof import("$lib/server/pipelines/runtime/roundWorth")
	>()),
	roundWorthBindings: () => ({
		"core:query/round-worth@1": reads<typeof C.roundWorth>(
			async () =>
				ok({
					main: { minutes: worth.minutes, step: worth.step },
					minutes: worth.minutes,
					step: worth.step
				}),
			{ ports: ["scope"] }
		)
	})
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "clock-owners-int-test-secret" }
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
	broadcastToSessionUsers: async () => {}
}))

/** The reckoning's and the keeper's scripted answer: the model names 30 minutes. */
const NAMED = JSON.stringify({
	changes: [],
	clock: [{ by: 30, unit: "minutes" }],
	place: []
})
const PLANNER = "you plan the party's next moment in it"
const QUIET_PLAN = JSON.stringify({
	beats: [],
	speakers: [],
	risks: [],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Gate Hall" }
})
/** Which calls the model was asked, in order. */
const asked = vi.hoisted(() => [] as string[])

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
		const kind = text.includes("You keep the record of a story")
			? "reckoning"
			: text.includes("You keep the record of a delve")
				? "keeper"
				: text.includes(PLANNER)
					? "planner"
					: "prose"
		asked.push(kind)
		const answer =
			kind === "reckoning" || kind === "keeper"
				? NAMED
				: kind === "planner"
					? QUIET_PLAN
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

const ROUND_TICK = "core:spec/round-tick"
const KEEPER = "core:spec/lair-keeper"
const RECKONING = "core:spec/story-reckoning"

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
		path.join(os.tmpdir(), "serene-pub-vitest-clock-owners-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	;(await import("./runs")).setRoutinesEnabled(true)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "clock-owners-owner")).id
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
		"clock-owners-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Clock owners test sampling",
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
}, 180_000)

afterAll(async () => {
	;(await import("./runs")).setRoutinesEnabled(false)
	;(await import("./tick")).stopSystemTick()
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

/** A session of `presetSeed` with one card, its own book, and a story clock at Year 412, month 3, day 5, 09:00. */
async function table(presetSeed: string, create: Record<string, unknown> = {}) {
	const name = `owners-${++n}`
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `The Mill ${name}` })
		.returning()
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, presetSeed))
	const [c] = await db
		.insert(schema.characters)
		.values({
			userId: ownerId,
			name: `Maren ${name}`,
			description: "A miller.",
			isPersona: false
		})
		.returning()
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: p!.id, ...create },
			characterIds: [c!.id],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db
		.update(schema.sessions)
		.set({
			lorebookId: book!.id,
			storyClockYear: 412,
			storyClockMonth: 3,
			storyClockDay: 5,
			storyClockHour: 9,
			storyClockMinute: 0
		})
		.where(eq(schema.sessions.id, sessionId))
	return sessionId
}

const story = () => table("core-story-living")
const wordsOnly = () =>
	table("core-lair-words-only", {
		primaryRuleset: "core:ruleset/vis-itineris@1"
	})
const lair = () =>
	table("core-lair-default", {
		primaryRuleset: "core:ruleset/vis-itineris@1"
	})
const rulesDecide = () =>
	table("core-lair-rules-and-dice", {
		primaryRuleset: "core:ruleset/vis-itineris@1"
	})

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

const runsOf = async (sessionId: number) =>
	db
		.select({
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			endedAt: schema.pipelineRuns.endedAt
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))

/** Play one round and wait until the routine that owns the clock has finished. */
async function playRound(sessionId: number, routine: string) {
	await send(sessionId)
	const end = Date.now() + 60_000
	for (;;) {
		await settle()
		const runs = (await runsOf(sessionId)).filter(
			(r) => r.specSlug === routine
		)
		if (runs.length && runs.every((r) => r.endedAt)) return
		if (Date.now() > end) throw new Error(`${routine} never finished`)
		await new Promise((r) => setTimeout(r, 25))
	}
}

/** Wait until every run of `routine` that exists has ended, and at least one does. */
async function untilEnded(sessionId: number, routine: string) {
	const end = Date.now() + 60_000
	for (;;) {
		await settle()
		const runs = (await runsOf(sessionId)).filter(
			(r) => r.specSlug === routine
		)
		if (runs.length && runs.every((r) => r.endedAt)) return
		if (Date.now() > end) throw new Error(`${routine} never finished`)
		await new Promise((r) => setTimeout(r, 25))
	}
}

const clockOf = async (sessionId: number) =>
	(
		await db
			.select({
				day: schema.sessions.storyClockDay,
				hour: schema.sessions.storyClockHour,
				minute: schema.sessions.storyClockMinute
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

const clockRows = async (sessionId: number) =>
	db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				eq(schema.stateProposals.kind, "clock")
			)
		)
		.orderBy(asc(schema.stateProposals.id))

describe("one default owner moves the clock", () => {
	it("Story · Living: a round ending moves the clock exactly once, 5 minutes, cause tick — the reckoning's 30 minutes is not applied", async () => {
		worth.minutes = 5
		const sessionId = await story()
		asked.length = 0
		await playRound(sessionId, RECKONING)
		// The reckoning ran and named 30 minutes; its *Move the clock* is off.
		expect(asked).toContain("reckoning")
		const rows = await clockRows(sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ status: "applied" })
		expect(rows[0]!.payload).toMatchObject({
			kind: "clock",
			by: 5,
			unit: "minutes",
			cause: "tick"
		})
		expect(await clockOf(sessionId)).toEqual({
			day: 5,
			hour: 9,
			minute: 5
		})
	})

	/** Set the keeper's registration on a session: its mode, and optionally its duty values. */
	async function setKeeper(
		sessionId: number,
		mode: "off" | "review" | "full",
		values?: Record<string, Record<string, unknown>>
	) {
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const { rowOfChange } = await import(
			"$lib/server/pipelines/registrations/rows"
		)
		const { upsertRow } = await import(
			"$lib/server/pipelines/registrations/write"
		)
		const keeper = (await effectiveRegistrations(
			db as never,
			sessionId
		))!.effective.find((r) => r.pipeline === KEEPER)!
		expect(keeper).toBeTruthy()
		await upsertRow(
			db as never,
			rowOfChange(
				{ key: keeper.key, mode, ...(values ? { values } : {}) },
				{ kind: "session", sessionId },
				"owner"
			)
		)
	}

	const presets: [string, () => Promise<number>][] = [
		["Words only", wordsOnly],
		["Rules", lair],
		["The rules decide", rulesDecide]
	]
	for (const [label, make] of presets)
		for (const keeper of ["off", "review"] as const) {
			it(`the Lair · ${label}, keeper ${keeper === "off" ? "Off" : "at Review"}: the round tick moves the clock exactly once, 5 minutes, cause tick`, async () => {
				worth.minutes = 5
				const sessionId = await make()
				await setKeeper(sessionId, keeper)
				asked.length = 0
				await playRound(sessionId, ROUND_TICK)
				if (keeper === "review") {
					await untilEnded(sessionId, KEEPER)
					expect(asked).toContain("keeper")
				} else {
					expect(asked).not.toContain("keeper")
					expect(
						(await runsOf(sessionId)).filter(
							(r) => r.specSlug === KEEPER
						)
					).toEqual([])
				}
				const rows = await clockRows(sessionId)
				expect(rows).toHaveLength(1)
				expect(rows[0]).toMatchObject({ status: "applied" })
				expect(rows[0]!.payload).toMatchObject({
					kind: "clock",
					by: 5,
					unit: "minutes",
					cause: "tick"
				})
				expect(await clockOf(sessionId)).toEqual({
					day: 5,
					hour: 9,
					minute: 5
				})
			})

			it(`the Lair · ${label}, keeper ${keeper === "off" ? "Off" : "at Review"}, with a round worth of 0: the round moves nothing and writes no line`, async () => {
				worth.minutes = 0
				try {
					const sessionId = await make()
					await setKeeper(sessionId, keeper)
					asked.length = 0
					await playRound(sessionId, ROUND_TICK)
					if (keeper === "review") await untilEnded(sessionId, KEEPER)
					expect(await clockRows(sessionId)).toEqual([])
					expect(await clockOf(sessionId)).toEqual({
						day: 5,
						hour: 9,
						minute: 0
					})
				} finally {
					worth.minutes = 5
				}
			})
		}

	it("the Lair with the keeper's Move the clock on at Full: two moves by opt-in — the tick's 5 minutes and the keeper's named 30", async () => {
		worth.minutes = 5
		const sessionId = await lair()
		await setKeeper(sessionId, "full", {
			duties: { params: { time: true } }
		})
		asked.length = 0
		await playRound(sessionId, ROUND_TICK)
		await untilEnded(sessionId, KEEPER)
		expect(asked).toContain("keeper")
		const rows = await clockRows(sessionId)
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.status === "applied")).toBe(true)
		expect(
			rows
				.map((r) => [(r.payload as any).cause, (r.payload as any).by])
				.sort()
		).toEqual([
			["keeper", 30],
			["tick", 5]
		])
		expect(await clockOf(sessionId)).toEqual({
			day: 5,
			hour: 9,
			minute: 35
		})
	})
})
