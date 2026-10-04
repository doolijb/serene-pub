/**
 * The Lair's turn — the Castellan's run — over the REAL reply road (lair
 * pass B15/B16, owner D1a/D2a, 2026-09-27; R8, owner F2/F4/F6 2026-09-28).
 *
 *  - **R8 — a turn is the Castellan's.** The planner, then the play: the
 *    Castellan's **beats row in the Sanctum** (a markdown list, whole) —
 *    the **plan row**, carrying the turns it plans. **No speakerless row on
 *    `main`**: nothing narrates a turn. The Castellan's keeper keeps the
 *    world's books, filed at the beats row.
 *  - **Character turns** (owner ruling 2026-09-30: "they are character
 *    turns, not first delver, later delver"): each delver the plan names
 *    then takes a turn of their own — a run each, fired by auto-advance off
 *    the turn order, in the planner's order — streaming their line into
 *    their own row and keeping their own books, filed at that line. Their
 *    rows belong to the planning turn (`metadata.planRowId`): the turn is
 *    open whole, and retaken whole.
 *  - **R8 — Narrate is the Castellan fired.** From `main` or from the
 *    Sanctum composer: one streamed Castellan row on `main`, and nothing
 *    else — no planner, no voices, no Sanctum row.
 *  - **R8 — the knock** is one Castellan question on `main`, and nothing
 *    else.
 *  - **R8 × R2 — retake** of a turn takes exactly the beats row and the
 *    character turns' rows; of a narration, narrates again.
 *  - **B15** — Pick who speaks is that delver's character turn alone.
 *  - **R12** — a stored `turnStyle: 'narrator'` is inert.
 *
 * The faked model answers every JSON request (planner, keeper) with one
 * document — two speakers, Brannoc's hp set to 8 and the purse to 5 — and
 * every prose request by whose prompt it is: the `lair-voice` prompt opens
 * "You are <name>,", the Castellan's narration "You are the Castellan".
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, ne } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-cast-rows-test-secret" }
})

const PLAN = {
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [
		{ name: "Brannoc", intent: "check the door" },
		{ name: "Vell", intent: "hold the light" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "" },
	// The keeper answers the same document: Brannoc's hp (his), the purse
	// (the world's).
	values: [
		{ owner: "Brannoc", slot: "hp", value: "8" },
		{ owner: "world", slot: "gold", value: "5" }
	],
	inventory: []
}
const KNOCK = {
	...PLAN,
	speakers: [],
	unknownExit: "The Drowned Hall",
	knockQuestion: "The stair goes down to the Drowned Hall. Is there one?"
}
/** What the planner (and keeper) answer this test with. */
let document: Record<string, unknown> = PLAN
/** Every prompt a JSON step (the planner, the keeper) was sent. */
const jsonPrompts: string[] = []
/** Every prose call, by whose voice it was written in. */
const proseCalls: string[] = []
const NARRATION = "The water rises. The torch goes out."

/** Whose prompt this is: the lair-voice prompt opens "You are <name>,". */
const voiceOf = (prompt: string) =>
	/You are (Brannoc|Vell),/.exec(prompt)?.[1] ??
	(prompt.includes("You are the Castellan, steward") ? "castellan" : null)

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	responseFormat: any
	responseSchema: any
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		const json =
			this.responseFormat === "json" ||
			prompt.includes(JSON.stringify(JSON_INSTRUCTION).slice(1, 40))
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) {
					jsonPrompts.push(prompt)
					onContent(JSON.stringify(document))
					return
				}
				const who = voiceOf(prompt)
				proseCalls.push(who ?? "unknown")
				const text = who && who !== "castellan" ? `${who} speaks.` : NARRATION
				// Two chunks past the persist throttle, so a streaming step
				// shows a frame with text in it.
				onContent(text.slice(0, 6))
				await new Promise((r) => setTimeout(r, 130))
				onContent(text.slice(6))
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const HANG_MS = 30_000
async function within<T>(label: string, road: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} did not finish within ${HANG_MS} ms`)),
			HANG_MS
		)
	})
	try {
		return await Promise.race([road, hung])
	} finally {
		clearTimeout(timer)
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lair-cast-rows-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

/** A Lair session: two delvers seated, and the master's line waiting. */
async function session(genreFields: Record<string, unknown>) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `cast-rows-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The lair ${tag}` })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id,
			genreFields
		})
		.returning()
	const ids: Record<string, number> = {}
	for (const [position, name] of ["Brannoc", "Vell"].entries()) {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name, description: "A delver." })
			.returning()
		ids[name] = c!.id
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: row!.id,
			characterId: c!.id,
			isActive: true,
			position
		})
	}
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		userId: owner.id
	})
	return { owner, session: row!, brannoc: ids.Brannoc!, vell: ids.Vell! }
}

/** One socket for the owner, every emit recorded. */
function recordingIo(userId: number, sessionId: number) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const socketId = `socket-${userId}`
	const sockets = new Map([
		[
			socketId,
			{
				id: socketId,
				user: { id: userId, isAdmin: false },
				interest: new Set([
					`sessionMessage#${sessionId}`,
					`sessions:runStatus#${sessionId}`,
					`sessions:actions#${sessionId}`,
					`state:changed#${sessionId}`
				])
			}
		]
	])
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						room === `user_${userId}` ? new Set([socketId]) : undefined
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: (room: string) => ({
			emit: (event: string, payload: any) =>
				emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

/**
 * Fire a turn. No entry is Continue — the owner's carry-on, the Castellan's
 * full turn (B9); `{ ref: null }` is the Narrate press (R8); a delver's
 * reference is Pick who speaks. `channel` is the pressing composer's.
 */
async function reply(
	w: Awaited<ReturnType<typeof session>>,
	label: string,
	entry?: Record<string, unknown>,
	channel?: string
) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const { io, emitted } = recordingIo(w.owner.id, w.session.id)
	const ownEmit = (event: string, payload: any) =>
		emitted.push({ room: "caller", event, payload })
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			{
				sessionId: w.session.id,
				...(entry ? { entry } : {}),
				...(channel ? { channel } : {})
			} as any,
			ownEmit
		)
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return { res, emitted }
}

/** Every `sessionMessage` frame a still-generating row was announced with, in order. */
const generatingFrames = (emitted: Array<{ event: string; payload: any }>) =>
	emitted
		.filter(
			(e) =>
				e.event === "sessionMessage" &&
				e.payload?.sessionMessage?.isGenerating === true &&
				e.payload?.sessionMessage?.role !== "user"
		)
		.map((e) => ({
			id: e.payload.sessionMessage.id as number,
			content: String(e.payload.sessionMessage.content ?? "")
		}))

/** The ids of every non-user row announced, in the order they were first seen. */
const announcedOrder = (emitted: Array<{ event: string; payload: any }>) => {
	const seen: number[] = []
	for (const e of emitted)
		if (e.event === "sessionMessage" && e.payload?.sessionMessage?.role !== "user") {
			const id = e.payload.sessionMessage.id as number
			if (!seen.includes(id)) seen.push(id)
		}
	return seen
}

/** The newest reply run's inlet, off its stored receipt: what the turn was fired with. */
async function inletOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({ receipt: schema.pipelineRuns.receipt, specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
	const run = runs.filter((r) => r.specSlug === "core:spec/lair-respond").at(-1)!
	return ((run.receipt as any).nodes as any[]).find((n) => n.kind === "inlet")!.output
}

async function runsOf(sessionId: number) {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
}

/** Every row the turn wrote, oldest first — the master's own line left out. */
async function turnRows(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				ne(schema.sessionMessages.role, "user")
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
}

/** The reply runs — the turn order's own recomputes left out. */
const respondRuns = async (sessionId: number) =>
	(await runsOf(sessionId))
		.filter((r) => r.specSlug !== "core:spec/lair-turn-order")
		.map((r) => `${r.specSlug}:${r.outcome}`)

const reset = () => {
	jsonPrompts.length = 0
	proseCalls.length = 0
	document = PLAN
}
const keeperCalls = () =>
	jsonPrompts.filter((p) => p.includes("You keep the record of a delve")).length
const plannerCalls = () =>
	jsonPrompts.filter((p) => p.includes("You plan the PARTY only")).length

const byChannel = <T extends { channel: string }>(rows: T[], channel: string) =>
	rows.filter((r) => r.channel === channel)

/** Every reply run's inlet `via`, oldest first. */
async function viasOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({ receipt: schema.pipelineRuns.receipt, specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
	return runs
		.filter((r) => r.specSlug === "core:spec/lair-respond")
		.map((r) => ((r.receipt as any).nodes as any[]).find((n) => n.kind === "inlet")!.output.via)
}

describe("R8 · a turn is the Castellan's run, and the party's lines are character turns", () => {
	test("the Sanctum's beats row first, then each delver's own character turn, streamed, in order — no speakerless row on main", async () => {
		reset()
		const w = await session({ trustNarrator: true })
		const { res, emitted } = await reply(w, "the Castellan's turn road")
		expect((res as any)?.error).toBeUndefined()
		// The Castellan's turn, then one character turn per named delver —
		// fired by auto-advance off the turn order, never pressed.
		expect(await respondRuns(w.session.id)).toEqual([
			"core:spec/lair-respond:ok",
			"core:spec/lair-respond:ok",
			"core:spec/lair-respond:ok"
		])
		expect((await viasOf(w.session.id)).slice(1)).toEqual(["plan", "plan"])

		const rows = await turnRows(w.session.id)
		// The Sanctum: the Castellan's beats row, whole, as a markdown list.
		const sanctum = byChannel(rows, "sanctum")
		expect(sanctum.map((r) => [(r.metadata as any)?.speaker, r.content])).toEqual([
			["envoy:castellan", "- The torch gutters.\n- Something scrapes behind the door."]
		])
		// The story: the party's own rows, lead first, and nobody else's.
		const main = byChannel(rows, "main")
		expect(main.map((r) => [r.characterId, r.content])).toEqual([
			[w.brannoc, "Brannoc speaks."],
			[w.vell, "Vell speaks."]
		])
		for (const r of main) expect(r.characterId).not.toBeNull()
		for (const r of rows) expect(r.isGenerating).toBe(false)
		// Beats first: the master reads the plan while the party speak.
		const [beats] = sanctum
		const [first, second] = main
		expect(beats!.id).toBeLessThan(first!.id)
		expect(first!.id).toBeLessThan(second!.id)
		expect((first!.metadata as any)?.speaker).toBe(`character:${w.brannoc}`)
		expect((second!.metadata as any)?.speaker).toBe(`character:${w.vell}`)
		// Each line belongs to the turn that planned it.
		expect(main.map((r) => (r.metadata as any)?.planRowId)).toEqual([beats!.id, beats!.id])
		expect((beats!.metadata as any)?.turnPlan?.turns).toEqual([
			`character:${w.brannoc}`,
			`character:${w.vell}`
		])
		// The prose calls are the party's alone — nothing narrated the turn.
		expect(proseCalls).toEqual(["Brannoc", "Vell"])
		expect(plannerCalls()).toBe(1)

		// Every character turn streamed its own line: every frame of a row
		// still being written is a delver's, and text reached each of them.
		const frames = generatingFrames(emitted)
		expect(new Set(frames.map((f) => f.id))).toEqual(new Set([first!.id, second!.id]))
		for (const row of [first!, second!])
			expect(frames.some((f) => f.id === row.id && f.content.length > 0)).toBe(true)
		// …and the beats row was announced before any delver's row was.
		const order = announcedOrder(emitted)
		expect(order.indexOf(beats!.id)).toBeGreaterThanOrEqual(0)
		expect(order.indexOf(beats!.id)).toBeLessThan(order.indexOf(first!.id))
		// A turn is not a narration: fired as the carry-on, never `narrate`.
		expect((await viasOf(w.session.id))[0]).not.toBe("narrate")
	})

	test("the Castellan's keeper keeps the world's books at the beats row; each character turn keeps its own delver's, at their line", async () => {
		reset()
		const w = await session({ trustNarrator: true })
		await reply(w, "the keeper road")
		// The Castellan's keeper, then one per character turn.
		const keepers = jsonPrompts.filter((p) => p.includes("You keep the record of a delve"))
		expect(keepers).toHaveLength(3)
		expect(keepers[0]).toContain("The torch gutters.")
		expect(keepers[1]).toContain("Brannoc speaks.")
		expect(keepers[2]).toContain("Vell speaks.")

		const rows = await turnRows(w.session.id)
		const beats = byChannel(rows, "sanctum")[0]!
		const brannocRow = rows.find((r) => r.characterId === w.brannoc)!
		const schema = await import("$lib/server/db/schema")
		const written = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.session.id))
		const gold = written.find((v) => v.slotId === "core:slot/gold@1")!
		const hp = written.find((v) => v.slotId === "core:slot/hp@1")!
		expect(gold.ownerKind).toBe("session")
		expect(gold.validFromMessageId).toBe(beats.id)
		expect(hp.validFromMessageId).toBe(brannocRow.id)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as any, w.session.id)
		expect(Object.values(state.cast).map((c: any) => c?.hp)).toContain(8)
	})

	test("trust off: the world's proposal is held at the beats row, and accepting it lands there — the turn is open whole", async () => {
		reset()
		const w = await session({})
		await reply(w, "the proposal road")
		const rows = await turnRows(w.session.id)
		const beats = byChannel(rows, "sanctum")[0]!
		const brannocRow = rows.find((r) => r.characterId === w.brannoc)!
		const schema = await import("$lib/server/db/schema")
		const proposals = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		const gold = proposals.find((p) => (p.payload as any)?.slotId === "core:slot/gold@1")!
		const hp = proposals.find((p) => (p.payload as any)?.slotId === "core:slot/hp@1")!
		expect(gold.messageId).toBe(beats.id)
		expect(hp.messageId).toBe(brannocRow.id)
		// Vell spoke after the beats row, in a character turn the beats row
		// planned: the same turn, so the world's anchor is still open (the
		// SDK turn lock's newest-turn rule, over `metadata.planRowId`).
		const { decideProposal } = await import("$lib/server/state/write")
		const decided = await decideProposal(testDb as any, gold.id, true)
		expect(decided.status).toBe("accepted")
		const [applied] = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, decided.appliedId!))
		expect(applied!.validFromMessageId).toBe(beats.id)
	})

	test("the knock: one Castellan question on main, and no beats, no voices, no keeper", async () => {
		reset()
		document = KNOCK
		const w = await session({ trustNarrator: true })
		const { res, emitted } = await reply(w, "the knock road")
		expect((res as any)?.error).toBeUndefined()
		const rows = await turnRows(w.session.id)
		expect(rows.map((r) => [r.channel, (r.metadata as any)?.speaker, r.content])).toEqual([
			["main", "envoy:castellan", KNOCK.knockQuestion]
		])
		expect(proseCalls).toEqual([])
		expect(keeperCalls()).toBe(0)
		// Nothing streamed into the question.
		expect(generatingFrames(emitted).every((f) => f.content === "")).toBe(true)
	})
})

describe("R8 · Narrate is the Castellan fired, and lands on main", () => {
	for (const pressedOn of ["main", "sanctum"] as const) {
		test(`from ${pressedOn}: one streamed Castellan row on main — no planner, no voices, no Sanctum row`, async () => {
			reset()
			const w = await session({ trustNarrator: true })
			const { res, emitted } = await reply(
				w,
				`the narrate-from-${pressedOn} road`,
				{ ref: null, via: "pick" },
				pressedOn === "main" ? undefined : pressedOn
			)
			expect((res as any)?.error).toBeUndefined()
			const rows = await turnRows(w.session.id)
			expect(
				rows.map((r) => [r.channel, r.characterId, (r.metadata as any)?.speaker, r.content])
			).toEqual([["main", null, "envoy:castellan", NARRATION]])
			expect(proseCalls).toEqual(["castellan"])
			expect(plannerCalls()).toBe(0)
			// The narration streamed into its own row, and nothing else did.
			const frames = generatingFrames(emitted)
			expect(new Set(frames.map((f) => f.id))).toEqual(new Set([rows[0]!.id]))
			expect(frames.some((f) => f.content.length > 0)).toBe(true)
			// The run knows it was a Narrate, and where it was pressed (R13
			// reads that); it still wrote on main.
			const inlet = await inletOf(w.session.id)
			expect(inlet.via).toBe("narrate")
			expect(inlet.channel).toBe(pressedOn)
			// R5: the own voice — the row is the Castellan's by name.
			const { lastTurnOf } = await import("$lib/server/sessions/turnYield")
			const last = await lastTurnOf(testDb as any, w.session.id)
			expect(last.ok && last.yield.rows.map((r) => r.name)).toEqual(["Castellan"])
			expect(last.ok && last.yield.entry).toEqual({ ref: null, via: "narrate" })
			// The keeper kept the books on the narration: the world's change
			// is filed at it (its only row, and the newest).
			const schema = await import("$lib/server/db/schema")
			const gold = (
				await testDb
					.select()
					.from(schema.attributeValues)
					.where(eq(schema.attributeValues.sessionId, w.session.id))
			).find((v) => v.slotId === "core:slot/gold@1")
			expect(gold?.validFromMessageId).toBe(rows[0]!.id)
		})
	}
})

async function retakeNow(w: Awaited<ReturnType<typeof session>>, label: string) {
	const { sessionsRetakeTurnHandler } = await import("./sessions")
	const { io } = recordingIo(w.owner.id, w.session.id)
	const res: any = await within(
		label,
		sessionsRetakeTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			{ sessionId: w.session.id } as any,
			() => {}
		)
	)
	await runsOf(w.session.id)
	return res
}

describe("R8 × R2 · retake of the Castellan's turn", () => {
	test("the yield is exactly the beats row and the character turns' rows; the beats row's own Regenerate is routed to the turn", async () => {
		reset()
		const w = await session({ trustNarrator: true })
		await reply(w, "the turn to retake")
		const rows = await turnRows(w.session.id)
		const { lastTurnOf } = await import("$lib/server/sessions/turnYield")
		const last = await lastTurnOf(testDb as any, w.session.id)
		expect(last.ok).toBe(true)
		if (!last.ok) return
		expect(last.yield.rows.map((r) => r.messageId)).toEqual(rows.map((r) => r.id))
		expect(last.yield.rows.map((r) => [r.channel, r.name])).toEqual([
			["sanctum", "Castellan"],
			["main", "Brannoc"],
			["main", "Vell"]
		])
		// The beats row regenerated alone would be re-driven as Sanctum talk:
		// refused, pointing to the story's Regenerate — though its own channel
		// offers no retake.
		const beats = byChannel(rows, "sanctum")[0]!
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		expect(
			await verbRefusal(testDb as any, w.session.id, "retry", {
				messageId: beats.id,
				userId: w.owner.id
			})
		).toBe(
			"This message is one part of a turn that wrote several. Use Regenerate in the story's composer to take the whole turn again."
		)

		// Retake: all three go, and the same turn is taken again.
		reset()
		const res = await retakeNow(w, "the retake")
		expect(res.error).toBeUndefined()
		const fresh = await turnRows(w.session.id)
		expect(fresh.filter((r) => rows.some((o) => o.id === r.id))).toEqual([])
		expect(fresh.map((r) => [r.channel, r.characterId])).toEqual([
			["sanctum", null],
			["main", w.brannoc],
			["main", w.vell]
		])
		expect(proseCalls).toEqual(["Brannoc", "Vell"])
	})

	test("a narration retakes as a narration", async () => {
		reset()
		const w = await session({ trustNarrator: true })
		await reply(w, "the narration to retake", { ref: null, via: "pick" })
		const [old] = await turnRows(w.session.id)
		reset()
		const res = await retakeNow(w, "the narration retake")
		expect(res.error).toBeUndefined()
		const fresh = await turnRows(w.session.id)
		expect(fresh.map((r) => [r.channel, (r.metadata as any)?.speaker, r.content])).toEqual([
			["main", "envoy:castellan", NARRATION]
		])
		expect(fresh[0]!.id).not.toBe(old!.id)
		expect(proseCalls).toEqual(["castellan"])
		expect(plannerCalls()).toBe(0)
	})

	test("a narration's own row Regenerate narrates again, into the same row", async () => {
		reset()
		const w = await session({ trustNarrator: true })
		await reply(w, "the narration to regenerate", { ref: null, via: "pick" })
		const [row] = await turnRows(w.session.id)
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		expect(
			await verbRefusal(testDb as any, w.session.id, "retry", {
				messageId: row!.id,
				userId: w.owner.id
			})
		).toBeNull()
		reset()
		const { runReply } = await import("$lib/server/utils/runReply")
		const { io } = recordingIo(w.owner.id, w.session.id)
		const { updateLegacyWhere } = await import("$lib/server/messages/store")
		const schema = await import("$lib/server/db/schema")
		// What the regenerate verb's handler does before it runs: the row waits.
		await updateLegacyWhere(testDb as any, eq(schema.sessionMessages.id, row!.id), {
			isGenerating: true
		})
		const out = await within(
			"the row regenerate",
			runReply({
				socket: { io },
				emitToUser: () => {},
				sessionId: w.session.id,
				userId: w.owner.id,
				turn: { kind: "regenerate", messageId: row!.id }
			})
		)
		await runsOf(w.session.id)
		expect(out.ok).toBe(true)
		const fresh = await turnRows(w.session.id)
		expect(fresh.map((r) => [r.id, r.channel, r.isGenerating])).toEqual([
			[row!.id, "main", false]
		])
		expect(proseCalls).toEqual(["castellan"])
		expect(plannerCalls()).toBe(0)
		expect((await inletOf(w.session.id)).via).toBe("narrate")
	})
})

describe("R12 · the retired turn style", () => {
	test("a stored turnStyle 'narrator' is inert — the turn is the Castellan's, and settings do not show it", async () => {
		reset()
		const w = await session({ turnStyle: "narrator" })
		await reply(w, "the stale-style road")
		const rows = await turnRows(w.session.id)
		expect(rows.map((r) => [r.channel, r.characterId])).toEqual([
			["sanctum", null],
			["main", w.brannoc],
			["main", w.vell]
		])
		expect(proseCalls).toEqual(["Brannoc", "Vell"])
		// The JSON keeps the key; no read passes it on.
		const { resolveSessionSettings } = await import("$lib/server/sessions/settings")
		const settings = await resolveSessionSettings(testDb as any, w.session.id)
		expect(settings!.fields).not.toHaveProperty("turnStyle")
		const { genreFieldsFor } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(await genreFieldsFor(testDb as any, w.session.id)).not.toHaveProperty(
			"turnStyle"
		)
	})
})

describe("B15 · Pick who speaks", () => {
	test("Pick Brannoc: his character turn — exactly one row, his, and no planner and no Castellan", async () => {
		reset()
		const w = await session({})
		const { res } = await reply(w, "the pick road", {
			ref: `character:${w.brannoc}`,
			via: "pick"
		})
		expect((res as any)?.error).toBeUndefined()
		expect(await respondRuns(w.session.id)).toEqual(["core:spec/lair-respond:ok"])
		const rows = await turnRows(w.session.id)
		expect(rows.map((r) => [r.characterId, r.content])).toEqual([
			[w.brannoc, "Brannoc speaks."]
		])
		expect(rows[0]!.isNarratorResponse).toBe(false)
		// A pick is a turn of its own, never part of a plan's.
		expect((rows[0]!.metadata as any)?.planRowId).toBeUndefined()
		// No planner and no Castellan keeper — one prose call, Brannoc's own
		// voice, and his own books.
		expect(plannerCalls()).toBe(0)
		expect(keeperCalls()).toBe(1)
		expect(proseCalls).toEqual(["Brannoc"])
	})
})
