/**
 * 🚧 The routine runtime end to end (PLAN-layering D7, R9, R11, R13, R17–R21,
 * R25, R39, A7; lane 6, 2026-10-20), on real Story turns with a scripted
 * model:
 *
 *  · one Living turn — the reply, then the turn and the round end, then the
 *    reckoning routine runs after it, as the owner, recorded as a routine;
 *  · the sweep every 5 turns (a member's line and a reply each a turn);
 *  · Run now — the owner only, a routine not Off, waiting like any other;
 *  · the system tick — nothing after a restart until someone plays, a
 *    System Cron on the 5-minute grid, a cap's pause until the next play;
 *  · a Timeline Cron on story-clock moves — due within the move, skipped past
 *    its jump ceiling with the inspector's line;
 *  · "While you were away" — what ran and what was skipped, and why.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "routines-int-test-secret" }
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

/** Which call asked what: the reckoning's, the sweep's, or a reply's. */
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
			: text.includes("You keep the books of a story")
				? "sweep"
				: "reply"
		asked.push(kind)
		const answer =
			kind === "reckoning"
				? JSON.stringify({ deltas: [], clock: [], place: [] })
				: kind === "sweep"
					? JSON.stringify({ summary: { name: "", content: "" }, lore: [], cast: [], worldState: [], relationships: [], scenes: [], goals: "" })
					: "They walk on."
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(answer)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let guestId: number
let bookId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-routines-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "routines-owner")).id
	guestId = (await createTestUser(db, "routines-guest")).id
	const [textConn] = await db.insert(schema.connections).values({ name: "Text", type: "openai", baseUrl: "http://text/v1" }).returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "routines-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Routines test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "The Mill" }).returning()
	bookId = book!.id
	;(await import("./runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("./runs")).setRoutinesEnabled(false)
	;(await import("./tick")).stopSystemTick()
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function living(name: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, "core-story-living"))
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name: `Maren ${name}`, description: "A miller.", isPersona: false }).returning()
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: p!.id }, characterIds: [c!.id], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ lorebookId: bookId }).where(eq(schema.sessions.id, sessionId))
	return sessionId
}

async function send(sessionId: number, content = "We walk to the mill.") {
	const { sessionMessagesSendPersonaMessageHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

async function runsOf(sessionId: number) {
	return db
		.select({
			id: schema.pipelineRuns.id,
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason,
			triggerFamily: schema.pipelineRuns.triggerFamily,
			registrationKey: schema.pipelineRuns.registrationKey,
			userId: schema.pipelineRuns.userId,
			startedAt: schema.pipelineRuns.startedAt,
			endedAt: schema.pipelineRuns.endedAt,
			receipt: schema.pipelineRuns.receipt
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
}

async function routineKey(sessionId: number, pipeline: string) {
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const r = (await effectiveRegistrations(db as never, sessionId))!.effective.find((x) => x.pipeline === pipeline)
	expect(r, `${pipeline} is registered`).toBeTruthy()
	return r!.key
}

/** Register a routine of the session's own (origin admin) — the R36 door's row. */
async function ownRoutine(sessionId: number, cadence: import("@serene-pub/sdk").CadenceRef, pipeline: string, opts: Record<string, unknown> = {}) {
	const { register } = await import("@serene-pub/sdk")
	const { rowOfDecl } = await import("$lib/server/pipelines/registrations/rows")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	const decl = register(cadence, pipeline, opts as never)
	await upsertRow(db as never, rowOfDecl(decl, { kind: "session", sessionId }, "admin"))
	return decl.key
}

describe("the routine runtime", () => {
	it("one Story · Living turn: the reply, then the round ends, then the reckoning runs after it — a routine, as the owner", async () => {
		const { STORY_RECKONING_SPEC_ID, STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
		const sessionId = await living("living-turn")
		asked.length = 0
		await send(sessionId)
		expect(asked).toEqual(["reply", "reckoning"])
		const runs = await runsOf(sessionId)
		const reply = runs.find((r) => r.specSlug === STORY_RESPOND_SPEC_ID)!
		const reckoning = runs.filter((r) => r.specSlug === STORY_RECKONING_SPEC_ID)
		expect(reckoning).toHaveLength(1)
		expect(reckoning[0]).toMatchObject({
			triggerFamily: "routine",
			registrationKey: await routineKey(sessionId, STORY_RECKONING_SPEC_ID),
			userId: ownerId
		})
		// LS2: the reply records its family too.
		expect(reply.triggerFamily).toBe("event")
		// R13: the routine started only once the reply had finished.
		expect(reckoning[0]!.startedAt.getTime()).toBeGreaterThanOrEqual(reply.endedAt!.getTime())
		// A14: "routine ‹name›, for ‹owner›".
		const meta = (reckoning[0]!.receipt as any).meta.routine
		expect(meta.said).toMatch(/^routine .+, for routines-owner$/)
		// R9: what the inlet carried — where it resides and what the moment carried, nothing more.
		const inlet = ((reckoning[0]!.receipt as any).nodes as any[]).find((n) => (n.nodeKey ?? n.key) === "input")
		const out = inlet?.outputs ?? inlet?.output
		expect(out?.routine).toMatchObject({ registrationKey: reckoning[0]!.registrationKey, mode: "full", cadence: { id: "core:cadence/after-each-round@1" } })
		expect(out?.cause).toMatchObject({ moment: "round-ended", event: "core:event/round-ended@1" })
		expect(out?.ruleset).toMatchObject({ rigour: expect.any(String) })
		// The moments are no ledger rows (they move no history).
		const ledger = await db.select({ event: schema.sessionChanges.event }).from(schema.sessionChanges).where(eq(schema.sessionChanges.sessionId, sessionId))
		expect(ledger.map((l) => l.event).filter((e) => /turn-ended|round-ended/.test(e))).toEqual([])
	}, 180_000)

	it("the sweep every 5 turns: a member's line and a reply are a turn each", async () => {
		const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
		const sessionId = await living("sweep-five")
		const sweeps = async () => (await runsOf(sessionId)).filter((r) => r.specSlug === STORY_SWEEP_SPEC_ID && r.triggerFamily === "routine")
		await send(sessionId) // turns 1, 2
		await send(sessionId) // turns 3, 4
		expect(await sweeps()).toEqual([])
		asked.length = 0
		await send(sessionId) // turn 5 (the line) — the sweep waits for the reply
		const ran = await sweeps()
		expect(ran.filter((r) => !r.haltReason)).toHaveLength(1)
		// In the order they came due (R14): the sweep at the member's line,
		// the reckoning when the reply ended the round — both after the reply.
		expect(asked).toEqual(["reply", "sweep", "reckoning"])
	}, 240_000)

	it("Run now: the owner only, a routine not Off — it queues like any other and says it was by hand (R39)", async () => {
		const { STORY_SWEEP_SPEC_ID, STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { runRoutineNow } = await import("./run")
		const sessionId = await living("run-now")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId } as any)
		const sweep = await routineKey(sessionId, STORY_SWEEP_SPEC_ID)
		expect(await runRoutineNow(db as never, { sessionId, userId: guestId, registrationKey: sweep })).toEqual({
			refused: "Only the session's owner runs a routine by hand."
		})
		expect(
			await runRoutineNow(db as never, { sessionId, userId: ownerId, registrationKey: await routineKey(sessionId, STORY_ILLUSTRATE_NEW_SCENE_SPEC_ID) })
		).toEqual({ refused: "That routine is Off in this session. Turn it on to run it." })
		expect(await runRoutineNow(db as never, { sessionId, userId: ownerId, registrationKey: "nothing→here" })).toEqual({
			refused: "That is not one of this session's routines."
		})
		asked.length = 0
		expect(await runRoutineNow(db as never, { sessionId, userId: ownerId, registrationKey: sweep })).toEqual({ queued: true })
		await settle()
		expect(asked).toEqual(["sweep"])
		const [row] = (await runsOf(sessionId)).filter((r) => r.specSlug === STORY_SWEEP_SPEC_ID)
		expect((row!.receipt as any).meta.routine).toMatchObject({ runNow: true })
		// An interaction: the runs-in-a-row count starts again.
		const [s] = await db.select({ at: schema.sessions.lastInteractionAt, runs: schema.sessions.routineRunsSinceInteraction }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect(s!.at).toBeTruthy()
		expect(s!.runs).toBe(0)
	}, 180_000)

	it("the system tick: nothing after a restart until someone plays; a System Cron on the grid; a cap's pause until the next play (R11, R15, R21)", async () => {
		const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { systemCron } = await import("@serene-pub/sdk")
		const { systemTick, TICK_MS } = await import("./tick")
		const interaction = await import("./interaction")
		const sessionId = await living("system-cron")
		const key = await ownRoutine(sessionId, systemCron({ every: 5, unit: "minutes" }), STORY_SWEEP_SPEC_ID)
		const sweeps = async () => (await runsOf(sessionId)).filter((r) => r.registrationKey === key)
		// "The app restarted": nobody has played since.
		interaction._resetInteractions()
		const t0 = 1_000 * TICK_MS
		expect(await systemTick(db as never, t0)).not.toContain(sessionId)
		expect(await systemTick(db as never, t0 + TICK_MS)).not.toContain(sessionId)
		expect(await sweeps()).toEqual([])
		const { sessionRoutines, routineLog, PAUSED_SINCE_RESTART } = await import("./log")
		expect((await sessionRoutines(db as never, sessionId, { isOwner: true })).find((r) => r.registrationKey === key)?.paused).toBe(PAUSED_SINCE_RESTART)

		// Someone plays: the cron counts from now, and fires once per interval.
		await interaction.noteInteraction(db as never, sessionId, "line")
		await db.update(schema.systemSettings).set({ cronMaxRunsInRow: 1 })
		try {
			expect(await systemTick(db as never, t0 + 2 * TICK_MS)).toContain(sessionId)
			await settle()
			expect(await sweeps()).toEqual([])
			await systemTick(db as never, t0 + 3 * TICK_MS)
			await settle()
			expect((await sweeps()).map((r) => r.outcome)).toEqual(["ok"])
			// One run in a row is the cap: the next one pauses, says why, once.
			await systemTick(db as never, t0 + 4 * TICK_MS)
			await settle()
			await systemTick(db as never, t0 + 5 * TICK_MS)
			await settle()
			const after = await sweeps()
			expect(after.map((r) => r.haltReason ?? r.outcome)).toEqual(["ok", "Paused after 1 run in a row"])
			expect((await sessionRoutines(db as never, sessionId, { isOwner: true })).find((r) => r.registrationKey === key)?.paused).toBe(
				"Paused after 1 run in a row"
			)
			const log = await routineLog(db as never, sessionId)
			expect(log.map((e) => e.kind)).toEqual(["paused", "ran"])
			// The next interaction lifts it.
			await interaction.noteInteraction(db as never, sessionId, "action")
			expect((await sessionRoutines(db as never, sessionId, { isOwner: true })).find((r) => r.registrationKey === key)?.paused).toBeUndefined()
		} finally {
			await db.update(schema.systemSettings).set({ cronMaxRunsInRow: 12 })
		}
	}, 180_000)

	it("a Timeline Cron on story-clock moves: due within the move, skipped past its ceiling with the inspector's line (R17, R19)", async () => {
		const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { timelineCron } = await import("@serene-pub/sdk")
		const sessionId = await living("timeline-cron")
		const key = await ownRoutine(
			sessionId,
			timelineCron({ every: 1, unit: "hours", maxJump: { every: 12, unit: "hours" } }),
			STORY_SWEEP_SPEC_ID
		)
		const { sessionsSetStoryClock } = await import("$lib/server/sockets/storyClock")
		const move = async (params: Record<string, unknown>) => {
			const res: any = await sessionsSetStoryClock.handler(fakeSocket(ownerId), { sessionId, ...params } as any, emit)
			expect(res?.error, res?.error).toBeUndefined()
			await settle()
		}
		const lines = async () => (await runsOf(sessionId)).filter((r) => r.registrationKey === key)
		await move({ to: { year: 412, month: 3, day: 1, hour: 8, minute: 0 } })
		await move({ by: 2, unit: "hours" })
		expect((await lines()).map((r) => r.outcome)).toEqual(["ok"])
		await move({ by: 3, unit: "days" })
		const all = await lines()
		expect(all).toHaveLength(2)
		expect(all[1]!.haltReason).toMatch(/^Skipped: the clock jumped more than 12 hours \(from .+ to .+\)$/)
		const { routineLog } = await import("./log")
		expect((await routineLog(db as never, sessionId))[0]).toMatchObject({ kind: "skipped", registrationKey: key })
	}, 180_000)

	it("Allow stacking off: a firing that finds the routine waiting is refused with an inspector line (R18)", async () => {
		const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { setRoutineCadenceOptions } = await import("$lib/server/utils/testDb")
		const sessionId = await living("stacking")
		const sweep = await routineKey(sessionId, STORY_SWEEP_SPEC_ID)
		await setRoutineCadenceOptions(db, sessionId, sweep, { n: 1 })
		asked.length = 0
		// The member's line comes due and waits for the reply; the reply's turn finds it waiting.
		await send(sessionId)
		expect(asked.filter((a) => a === "sweep")).toHaveLength(1)
		const rows = (await runsOf(sessionId)).filter((r) => r.registrationKey === sweep)
		expect(rows.map((r) => r.haltReason ?? r.outcome)).toEqual(["Skipped: already waiting", "ok"])
	}, 180_000)
})
