/**
 * 🚧 Dungeon Crawler: **fixing a turn** (owner rulings 2026-10-15, deletions
 * and retry) — over the REAL send, swipe, retake, regenerate and delete
 * roads, against the SHIPPED documents, a fake adapter for the model.
 *
 * What is pinned:
 *
 *  1. **Swipe is the Narrator's alone.** The stored plan and rolls stand: no
 *     Planner call, the same roll line, new prose.
 *  2. **Retake is a new turn.** A Planner call, a new roll line, the world
 *     (the session's own lorebook: every row anchored to the turn's reply
 *     goes with it — no snapshot) and the journal line, re-applied from the
 *     new plan,
 *     the sheet the new plan's. Twice in a row; after a swipe. The row
 *     regenerate is not offered on Story: taking a turn again IS the retake
 *     (re-plan, re-roll); only a swipe keeps the dice (\`lastTelling\`).
 *  3. **Honour mode.** Deleting the latest turn is the owner's, only while
 *     Honour mode is on: the reply goes with its roll line and its journal
 *     line, the sheet comes back, nothing fires, and the round is ready again
 *     — Continue takes it with a new plan. An older turn is never deleted.
 *     The retake is the owner's whatever Honour mode says; a guest's is
 *     refused.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "dungeon-crawler-fix-turn-test-secret" }
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

/** One delta as the Planner's grammar writes it: every member, empty for none. */
const delta = (d: Record<string, unknown>) => ({
	owner: "", op: "add", slot: "", repertoire: "", piece: "", value: "", check: "", against: 0, reason: "",
	...d
})
/**
 * Each story turn's Planner answers the next plan: its own check (against
 * 10 + n, so its table line says which turn rolled it — `vs 1n`), its own
 * wound (n health spent), its own room.
 */
let seatRef = ""
let plans = 0
/** More deltas for turn `n`'s plan — a test sets it and puts it back. */
let extraDeltas: (n: number) => Record<string, unknown>[] = () => []
/** Ways out the Planner writes on the turn's room (A12): the room the party stands in when it is `Room 1`'s turn-2 revisit. */
let extraExits: (n: number) => Record<string, unknown>[] = () => []
const planFor = (n: number) => ({
	deltas: [
		delta({ owner: seatRef, op: "use", check: "skill.athletics", against: 10 + n, reason: `try thing ${n}` }),
		delta({ owner: seatRef, op: "spend", slot: "hp", value: String(n), reason: `stake ${n}` }),
		...extraDeltas(n)
	],
	world: {
		// A turn that writes ways out writes them on Room 1 — the room Ann
		// stands in — which the turn script re-reads from the lorebook and
		// fits with exit pieces (A12); other turns find a new room.
		rooms: extraExits(n).length
			? [{ id: "room-1", name: "Room 1", description: "Stone.", exits: extraExits(n) }]
			: [{ id: `room-${n}`, name: `Room ${n}`, description: "Stone.", exits: [] }],
		npcs: [], leads: [`Lead ${n}`], goalProgress: "none", notes: ""
	},
	clock: { minutes: 10 },
	narratorBrief: `Brief ${n}.`,
	roundSummary: `Summary ${n}.`,
	secrets: []
})
let narrations = 0

/** Every call the fake model took: its prompt. */
const calls: string[] = []
const plannerCalls = () => calls.filter((c) => c.includes("keep the books out of sight")).length

class FakeAdapter {
	injected: any
	responseFormat: any
	aborted = false
	abort() {
		this.aborted = true
	}
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
		const prompt = JSON.stringify(this.injected ?? "")
		calls.push(prompt)
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes("keep the books out of sight")) return onContent(JSON.stringify(planFor(++plans)))
				if (prompt.includes("What happens this round, from the Planner")) return onContent(`Narration ${++narrations}.`)
				if (prompt.includes("You are talking with one player")) return onContent("Ask away.")
				onContent("The Narrator speaks.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let guestId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-fix-turn-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-owner")).id
	guestId = (await createTestUser(db, "dc-guest")).id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "dc-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Dungeon Crawler test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

async function createSession(name: string) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: preset!.id, primaryRuleset: "core:ruleset/vis-itineris@1", rigour: "scripts" },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	// 🚧 The fixtures seat characters directly, standing in for the sheet —
	// so Story opens here as the applied sheet opens it (composer states,
	// owner ruling 2026-10-15; the sheet's own open is pinned in
	// sessions.dungeonCrawler.int.test.ts).
	await db.update(schema.sessions).set({ composerStates: {} }).where(eq(schema.sessions.id, res.session.id))
	return res.session.id as number
}

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

const storyOf = async (sessionId: number) => (await rowsOf(sessionId)).filter((r) => r.channel === "main")
const journalOf = async (sessionId: number) =>
	(await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && ((r.metadata as any)?.kind ?? "did") === "did").map((r) => r.content)

/** The session's own lorebook's places (PLAN-rulesets §26), oldest first. */
async function placesOf(sessionId: number) {
	const [book] = await db.select({ id: schema.lorebooks.id }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	const rows = await db
		.select({ title: schema.lorebookEntries.title, typeId: schema.lorebookEntries.typeId })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
		.orderBy(asc(schema.lorebookEntries.id))
	return rows.filter((r) => r.typeId === "core:entry/location").map((r) => r.title)
}

async function annexOf(sessionId: number) {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return ((row!.annex as any)?.core ?? {}) as Record<string, any>
}

async function value(sessionId: number, owner: { kind: string; id: number }, slotId: string) {
	const { valueOf } = await import("$lib/server/state/resolve")
	return valueOf(db as any, { sessionId, owner: owner as any, slotId } as any)
}

const RESPOND = "core:spec/dungeon-crawler-respond"
async function respondRuns(sessionId: number) {
	await settle()
	const runs = await db
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
	return runs.filter((r) => r.specSlug === RESPOND).length
}

/** A table: the owner's seat, and with `guest` a playing guest's too. */
async function table(name: string, guest = false) {
	const sessionId = await createSession(name)
	const [ann] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId: ownerId, seatName: "Ann", position: 0 } as any)
		.returning()
	if (guest) {
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		await db.insert(schema.sessionPersonas).values({ sessionId, userId: guestId, seatName: "Bo", position: 1 } as any)
		// Lanes for both — the lane register (lanes by person on the server, 2026-10-17).
		await db.insert(schema.channelLanes).values([
			{ sessionId, slug: "parley", lane: 1, userId: ownerId },
			{ sessionId, slug: "parley", lane: 2, userId: guestId }
		] as any).onConflictDoNothing()
	}
	seatRef = `player-seat:${ann!.id}`
	// Ann starts at 10 health: the turns spend it.
	const { applyChange } = await import("$lib/server/state/write")
	await applyChange(db as any, { sessionId, updatedBy: "user" } as any, { owner: { kind: "player_seat", id: ann!.id }, slotId: "core:slot/hp@1", value: 10 } as any)
	return { sessionId, seat: { kind: "player_seat", id: ann!.id } }
}

async function say(userId: number, sessionId: number, content: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		{ sessionId, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res.sessionMessage
}

async function carryOn(userId: number, sessionId: number) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(fakeSocket(userId), { sessionId, channel: "main" } as any, emit)
	await settle()
	return res as { ok: boolean; error?: string }
}

async function swipe(userId: number, id: number) {
	const { sessionMessagesSwipeRightHandler } = await import("./sessions")
	const res: any = await sessionMessagesSwipeRightHandler.handler(fakeSocket(userId), { id } as any, emit)
	await settle()
	return res
}

async function retake(userId: number, sessionId: number) {
	const { sessionsRetakeTurnHandler } = await import("./sessions")
	const res: any = await sessionsRetakeTurnHandler.handler(fakeSocket(userId), { sessionId } as any, emit)
	await settle()
	return res as { ok: boolean; error?: string }
}

async function remove(userId: number, id: number) {
	const { sessionMessagesDeleteHandler } = await import("./sessions")
	const res: any = await sessionMessagesDeleteHandler.handler(fakeSocket(userId), { id } as any, emit)
	await settle()
	return res as { id: number; success?: string; error?: string }
}

async function honour(sessionId: number, on: boolean) {
	await db.update(schema.sessions).set({ genreFields: { honorMode: on } } as any).where(eq(schema.sessions.id, sessionId))
}

/**
 * The Story's newest turn: the Narrator's reply, and its roll line — 🚧 on
 * the table channel, anchored to the reply (PLAN-rulesets §30).
 */
async function lastTurn(sessionId: number) {
	const story = await storyOf(sessionId)
	const reply = story.at(-1)!
	const roll = (await rowsOf(sessionId)).find(
		(r) => r.channel === "table" && (r.metadata as any)?.anchorMessageId === reply.id
	)!
	expect(reply.role).not.toBe("user")
	expect(roll?.content.startsWith("⚄")).toBe(true)
	return { roll, reply }
}

describe("swipe and retake", () => {
	it("a swipe re-voices the Narrator on the stored plan and rolls; a retake plans and rolls anew — twice, and after a swipe", async () => {
		const { sessionId, seat } = await table("swipe and retake")
		plans = 0
		await say(ownerId, sessionId, "Ann climbs the wall.")
		expect(await respondRuns(sessionId)).toBe(1)
		const first = await lastTurn(sessionId)
		expect(first.roll.content).toContain("vs 11")
		expect(first.reply.content).toMatch(/^Narration \d+\.$/)
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(9)

		// Swipe: the Narrator alone — no Planner call, the same roll line, new prose.
		calls.length = 0
		const swiped = await swipe(ownerId, first.reply.id)
		expect(swiped?.error, swiped?.error).toBeUndefined()
		expect(plannerCalls()).toBe(0)
		expect(calls).toHaveLength(1)
		const afterSwipe = await lastTurn(sessionId)
		expect(afterSwipe.roll.id).toBe(first.roll.id)
		expect(afterSwipe.roll.content).toBe(first.roll.content)
		expect(afterSwipe.reply.id).toBe(first.reply.id)
		expect(afterSwipe.reply.content).not.toBe(first.reply.content)
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(9)
		expect(await journalOf(sessionId)).toEqual(["Summary 1."])
		// The dice stick through `lastTelling` (walk 2026-10-17, ruled): the swipe
		// re-told the turn the row already holds — never a re-plan, never a re-roll.
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].lastTelling.row).toBe(first.reply.id)
		expect((await rowsOf(sessionId)).filter((r) => r.channel === "table" && r.content.startsWith("⚄"))).toHaveLength(1)

		// The row regenerate is not offered on Story: a turn is taken again whole.
		const { sessionMessagesRegenerateHandler } = await import("./sessions")
		const regen: any = await sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: first.reply.id } as any, emit)
		expect(regen?.error).toBeTruthy()

		// Retake: a Planner call, a new roll line, the books undone and kept anew.
		calls.length = 0
		expect((await retake(ownerId, sessionId)).error).toBeUndefined()
		expect(plannerCalls()).toBe(1)
		const second = await lastTurn(sessionId)
		expect(second.roll.id).not.toBe(first.roll.id)
		expect(second.roll.content).toContain("vs 12")
		expect(second.reply.id).not.toBe(first.reply.id)
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(8)
		expect(await journalOf(sessionId)).toEqual(["Summary 2."])
		// The retaken turn's room went with its row; the new turn's stands, in the session's own lorebook.
		expect(await placesOf(sessionId)).toEqual(["Room 2"])
		let annex = await annexOf(sessionId)
		expect(annex["dungeon-crawler-journal"].leads).toEqual(["Lead 2"])
		expect(annex["dungeon-crawler-progress"].lastTelling.row).toBe(second.reply.id)
		expect(annex["dungeon-crawler-world"]).toBeUndefined()
		// The round's line stands: a retake never deletes what somebody said.
		expect((await storyOf(sessionId)).filter((r) => r.role === "user").map((r) => r.content)).toEqual(["Ann climbs the wall."])

		// Twice in a row.
		calls.length = 0
		expect((await retake(ownerId, sessionId)).error).toBeUndefined()
		expect(plannerCalls()).toBe(1)
		const third = await lastTurn(sessionId)
		expect(third.roll.content).toContain("vs 13")
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(7)
		expect(await journalOf(sessionId)).toEqual(["Summary 3."])
		expect(await placesOf(sessionId)).toEqual(["Room 3"])

		// A swipe, then a retake.
		calls.length = 0
		expect((await swipe(ownerId, third.reply.id))?.error).toBeUndefined()
		expect(plannerCalls()).toBe(0)
		expect((await retake(ownerId, sessionId)).error).toBeUndefined()
		expect(plannerCalls()).toBe(1)
		const fourth = await lastTurn(sessionId)
		expect(fourth.roll.content).toContain("vs 14")
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(6)
		expect(await journalOf(sessionId)).toEqual(["Summary 4."])
		expect(await placesOf(sessionId)).toEqual(["Room 4"])
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].lastTelling.row).toBe(fourth.reply.id)
	})
})

describe("a way out the world changes", () => {
	it("a locked door on the world lands on the place the party stands in — its exit piece locked, the outcomes saying so (walk 2026-10-17)", async () => {
		const { sessionId, seat } = await table("locked door")
		plans = 0
		await say(ownerId, sessionId, "Ann looks around.")
		// Ann stands in the room the first turn found.
		const [room] = await db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.innerJoin(schema.lorebooks, eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId))
			.where(and(eq(schema.lorebooks.sessionId, sessionId), eq(schema.lorebookEntries.title, "Room 1")))
		expect(room, "the first turn's room").toBeTruthy()
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(db as any, { sessionId, updatedBy: "user" } as any, { owner: seat, slotId: "core:slot/location@1", value: "Room 1" } as any)

		// The Planner locks a door: a way out of the room the party stands in
		// (one exit model, A12 — exits ride `world.rooms[].exits`, never a delta).
		extraExits = (n) =>
			n === 2 ? [{ to: "Iron door", way: "door", state: "locked", lockDc: 15, trap: "", trapDc: 0, minutes: 0 }] : []
		try {
			calls.length = 0
			await say(ownerId, sessionId, "Ann tries the far door.")
		} finally {
			extraExits = () => []
		}
		const exits = (await value(sessionId, { kind: "session_location", id: room!.id }, "core:slot/crawl-exits@1")) as any[]
		expect(exits, JSON.stringify(exits)).toHaveLength(1)
		expect(exits[0]).toMatchObject({ kind: "inline", name: "Door to Iron door", way: "door", state: "locked", lockDc: 15, towards: "Iron door" })
		// The Narrator's outcomes block says what the rules decided — the door among it.
		const told = calls.filter((c) => c.includes("What happens this round, from the Planner")).at(-1) ?? ""
		expect(told).toContain("Iron door")
		// …and how it stands: locked, at its lock's difficulty (walk 6, 2026-10-17).
		expect(told).toContain("Iron door, locked (DC 15)")

		// The door is unbarred: the same door, now open — one exit, never two.
		extraExits = (n) =>
			n === 3 ? [{ to: "Iron door", way: "door", state: "open", lockDc: 0, trap: "", trapDc: 0, minutes: 0 }] : []
		try {
			calls.length = 0
			await say(ownerId, sessionId, "Ann lifts the bar.")
		} finally {
			extraExits = () => []
		}
		// The Planner read the door as it stood before this round: locked, never a bare name.
		const planned = calls.find((c) => c.includes("keep the books out of sight")) ?? ""
		expect(planned).toContain("Iron door, locked (DC 15)")
		const after = (await value(sessionId, { kind: "session_location", id: room!.id }, "core:slot/crawl-exits@1")) as any[]
		expect(after).toHaveLength(1)
		expect(after[0]).toMatchObject({ name: "Door to Iron door", state: "open" })
	})
})

describe("honour mode", () => {
	it("the latest turn is the owner's to delete, only while it is on; an older turn never; the retake is the owner's either way", async () => {
		const { sessionId, seat } = await table("honour", true)
		// 🚧 Deletion needs a pipeline (RF fix 5): core's Dungeon Crawler
		// registers none, so this table registers one — the turn rule below
		// is what a genre that keeps its turns and deletes gets.
		const { registerTestDeletion } = await import("$lib/server/utils/testDb")
		await registerTestDeletion(db, sessionId)
		const { TURN_DELETE_REFUSALS } = await import("$lib/server/messages/verbs")
		plans = 0
		await say(ownerId, sessionId, "Ann tries the door.")
		const bo = await say(guestId, sessionId, "Bo watches the hall.")
		expect(await respondRuns(sessionId)).toBe(1)
		const one = await lastTurn(sessionId)
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(9)

		// A guest: their own line of the latest round, and the reply — refused.
		expect((await remove(guestId, bo.id)).error).toBe(TURN_DELETE_REFUSALS.notOwner)
		expect((await remove(guestId, one.reply.id)).error).toBeTruthy()
		// The owner, with Honour mode off (the default): refused.
		expect((await remove(ownerId, one.reply.id)).error).toBe(TURN_DELETE_REFUSALS.honourOff)
		// 🚧 …and offered no Delete at all (owner ruling ★9): the list's floor
		// covers the whole latest turn, its round's lines included.
		const { turnDeleteRefusedThrough } = await import("$lib/server/messages/verbs")
		const off = await turnDeleteRefusedThrough(db as any, sessionId, ownerId)
		expect(off?.channels).toContain("main")
		expect(off!.messageId).toBeGreaterThanOrEqual(one.reply.id)
		expect(off!.messageId).toBeGreaterThan(bo.id)
		expect((await storyOf(sessionId)).map((r) => r.id)).toContain(one.reply.id)
		// The retake is exempt: the owner's with Honour mode off; a guest's refused.
		expect((await retake(guestId, sessionId)).error).toBeTruthy()
		calls.length = 0
		expect((await retake(ownerId, sessionId)).error).toBeUndefined()
		expect(plannerCalls()).toBe(1)
		const retaken = await lastTurn(sessionId)
		expect(retaken.roll.content).toContain("vs 12")

		// A second round makes the first an older turn.
		const annLine = (await storyOf(sessionId)).find((r) => r.content === "Ann tries the door.")!
		await say(ownerId, sessionId, "Ann goes through.")
		await say(guestId, sessionId, "Bo follows.")
		expect(await respondRuns(sessionId)).toBe(3)
		const two = await lastTurn(sessionId)
		expect(two.roll.content).toContain("vs 13")
		// 10 − 2, then − 3.
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(5)

		await honour(sessionId, true)
		// 🚧 With it on, the owner's floor is the older turns only: the latest
		// keeps Delete, the one before it does not.
		const on = await turnDeleteRefusedThrough(db as any, sessionId, ownerId)
		expect(on!.messageId).toBeGreaterThanOrEqual(annLine.id)
		expect(on!.messageId).toBeLessThan(two.reply.id)
		expect((await turnDeleteRefusedThrough(db as any, sessionId, guestId))!.messageId).toBeGreaterThanOrEqual(two.reply.id)
		// An older turn, whoever asks: never.
		expect((await remove(ownerId, retaken.reply.id)).error).toBe(TURN_DELETE_REFUSALS.older)
		expect((await remove(ownerId, retaken.roll.id)).error).toBe(TURN_DELETE_REFUSALS.older)
		expect((await remove(ownerId, annLine.id)).error).toBe(TURN_DELETE_REFUSALS.older)
		// A guest still may not delete the latest.
		expect((await remove(guestId, two.reply.id)).error).toBeTruthy()

		// The owner deletes the latest turn: the reply, its roll line and its
		// journal line go; the sheet comes back; nothing fires.
		const runsBefore = await respondRuns(sessionId)
		const journalBefore = await journalOf(sessionId)
		expect(journalBefore).toEqual(["Summary 2.", "Summary 3."])
		const gone = await remove(ownerId, two.reply.id)
		expect(gone.error, gone.error).toBeUndefined()
		const story = await storyOf(sessionId)
		expect(story.map((r) => r.id)).not.toContain(two.reply.id)
		expect(story.map((r) => r.id)).not.toContain(two.roll.id)
		expect(story.slice(-2).map((r) => r.content)).toEqual(["Ann goes through.", "Bo follows."])
		expect(await journalOf(sessionId)).toEqual(["Summary 2."])
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(8)
		expect(await respondRuns(sessionId)).toBe(runsBefore)

		// The round is ready again: Continue takes it, with a new plan, from the world as turn one left it.
		calls.length = 0
		expect((await carryOn(ownerId, sessionId)).error).toBeUndefined()
		expect(plannerCalls()).toBe(1)
		expect(calls[0]).toContain("Ann goes through.")
		expect(calls[0]).toContain("Bo follows.")
		const three = await lastTurn(sessionId)
		expect(three.roll.content).toContain("vs 14")
		// 8, then − 4: the deleted turn's wound came back with its row.
		expect(await value(sessionId, seat, "core:slot/hp@1")).toBe(4)
		expect(await journalOf(sessionId)).toEqual(["Summary 2.", "Summary 4."])
		// The deleted turn's room went with its row (no snapshot: the timeline's cascade).
		expect(await placesOf(sessionId)).toEqual(["Room 2", "Room 4"])

		// A line of the latest round, deleted alone by its author the owner: the turn stands.
		const annGoes = (await storyOf(sessionId)).find((r) => r.content === "Ann goes through.")!
		expect((await remove(ownerId, annGoes.id)).error).toBeUndefined()
		expect((await storyOf(sessionId)).map((r) => r.id)).toContain(three.reply.id)

		// A Planner lane is no story: its rows are ordinary.
		const [lane] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: guestId, role: "user", content: "A question.", channel: "parley:2" } as any)
			.returning()
		expect((await remove(guestId, lane!.id)).error).toBeUndefined()
	})
})
