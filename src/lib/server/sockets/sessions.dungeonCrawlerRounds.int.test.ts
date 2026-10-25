/**
 * 🚧 Dungeon Crawler's rounds (PLAN-dungeon-crawler-2026-10-14, features
 * 15–18, D4, D8) — over the REAL send, turn-order, Continue and action
 * roads, against the SHIPPED documents, a fake adapter for the model.
 *
 * What is pinned:
 *
 *  1. **Everyone declares, then one story turn.** Two named player seats:
 *     the first line on Story fires nothing; the second fires the reply
 *     once; the reply ends the round, so the next line waits again.
 *  2. **Continue resolves early** (D4): the owner's press, or a player's who
 *     has declared, fires the story turn; a player who has not is refused.
 *  3. **A secret** (feature 18): the story turn's Planner JSON names a
 *     seat; the line lands on that player's lane only.
 *  4. **Reveal** (D8): once — the notes readable by a guest, a notice on
 *     Story that does not end the round; a second press refused in the
 *     owner's lane.
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-rounds-test-secret" }
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

const CLASSES = { question: "Which calling?", options: [{ key: "ranger", label: "Ranger" }, { key: "thief", label: "Thief" }] }
const SHEET = {
	name: "", class: "", abilities: ["Track", "Shoot"], gear: ["Bow", "Rope"], hp: 15,
	backstory: "Grew up in the marches.", shape: "", difficulty: "", goalMode: ""
}
const WORLD = {
	goal: "Find the drowned king.",
	rooms: [
		{ id: "gate", name: "The Sunken Gate", description: "Wet stone and a rusted portcullis.", exits: ["The Hall"] },
		{ id: "hall", name: "The Hall", description: "Pillars in black water.", exits: ["The Sunken Gate"] }
	],
	npcs: [{ name: "Moss", description: "A wary ferryman who speaks in riddles." }],
	leads: ["A bell rings below."],
	notes: "The king is not dead."
}
const OPENING = "Water laps at your boots as the portcullis groans."
const PLANNER_SAYS = "Dice here are rolled in the open, and the stakes come first."

/** The story turn's hidden Planner: one secret, for the guest's seat (set per test). */
const PLANNER_BOOKS: Record<string, unknown> = {
	deltas: [], world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
	clock: { minutes: 5 }, secrets: [], narratorBrief: "They wait.", roundSummary: "The party waited."
}

/** Every call the fake model took: its prompt. */
const calls: string[] = []

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
				if (prompt.includes("Offer three to five classes")) return onContent(JSON.stringify(CLASSES))
				if (prompt.includes("writing a player's character sheet")) return onContent(JSON.stringify(SHEET))
				if (prompt.includes("you build the world they walk into")) return onContent(JSON.stringify(WORLD))
				if (prompt.includes("keeping one player's character sheet"))
					return onContent(JSON.stringify({ standingOrder: "", abilities: [], gear: [] }))
				if (prompt.includes("the story is about to begin")) return onContent(OPENING)
				if (prompt.includes("keep the books out of sight")) return onContent(JSON.stringify(PLANNER_BOOKS))
				if (prompt.includes("You are talking with one player")) return onContent(PLANNER_SAYS)
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-rounds-"))
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
			session: { name, presetId: preset!.id },
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

async function annexOf(sessionId: number) {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return ((row!.annex as any)?.core ?? {}) as Record<string, any>
}

/** The newest form on a channel: its row and its first block. */
async function openForm(sessionId: number, channel: string) {
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	const rows = (await rowsOf(sessionId)).filter((r) => r.channel === channel).reverse()
	for (const row of rows) {
		const trees = await blockTreesOf(db as any, row.id)
		if (trees.length) return { messageId: row.id, blocks: trees[0] as any[] }
	}
	throw new Error(`no form on ${channel}`)
}

async function press(userId: number, sessionId: number, channel: string, payload: Record<string, unknown>, which = 0) {
	const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
	const { sessionsFireActionHandler } = await import("./sessions")
	const form = await openForm(sessionId, channel)
	const res: any = await sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{
			sessionId,
			action: DUNGEON_CRAWLER_INTERVIEW_ACTION,
			messageId: form.messageId,
			blockId: form.blocks[which].id,
			payload
		} as any,
		emit
	)
	await settle()
	return res
}

async function seatOf(sessionId: number, userId: number) {
	const [seat] = await db
		.select()
		.from(schema.sessionPersonas)
		.where(and(eq(schema.sessionPersonas.sessionId, sessionId), eq(schema.sessionPersonas.userId, userId)))
	return seat
}

async function value(sessionId: number, owner: { kind: string; id: number }, slotId: string) {
	const { valueOf } = await import("$lib/server/state/resolve")
	return valueOf(db as any, { sessionId, owner: owner as any, slotId } as any)
}


const RESPOND = "core:spec/dungeon-crawler-respond"

/** The reply runs on the session — the story turn's, and the Planner's talk. */
async function respondRuns(sessionId: number) {
	await settle()
	const runs = await db
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
	return runs.filter((r) => r.specSlug === RESPOND).length
}

/** A table of two: the owner and a playing guest, each with a named player seat. */
async function tableOfTwo(name: string) {
	const sessionId = await createSession(name)
	await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
	const [ann] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId: ownerId, seatName: "Ann", position: 0 } as any)
		.returning()
	const [bo] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, userId: guestId, seatName: "Bo", position: 1 } as any)
		.returning()
	// Lanes for both — the lane register (lanes by person on the server, 2026-10-17).
	await db.insert(schema.channelLanes).values([
		{ sessionId, slug: "parley", lane: 1, userId: ownerId },
		{ sessionId, slug: "parley", lane: 2, userId: guestId }
	] as any).onConflictDoNothing()
	return { sessionId, ann: ann!, bo: bo! }
}

/** A line on Story by `userId`, through the real send. */
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

/** Continue on Story, by `userId`. */
async function carryOn(userId: number, sessionId: number) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(fakeSocket(userId), { sessionId, channel: "main" } as any, emit)
	await settle()
	return res as { ok: boolean; error?: string }
}

async function reveal(userId: number, sessionId: number) {
	const { sessionsFireActionHandler } = await import("./sessions")
	const { DUNGEON_CRAWLER_REVEAL_SPEC_ID } = await import("@serene-pub/core-catalog")
	const res: any = await sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{ sessionId, action: `${DUNGEON_CRAWLER_REVEAL_SPEC_ID}#reveal`, payload: {} } as any,
		emit
	)
	await settle()
	return res
}

describe("a round: everyone declares, then one story turn", () => {
	it("the first line waits; the second fires the reply once; the reply ends the round", async () => {
		const { sessionId } = await tableOfTwo("round")
		await say(ownerId, sessionId, "Ann tries the door.")
		expect(await respondRuns(sessionId)).toBe(0)
		await say(guestId, sessionId, "Bo watches the hall.")
		expect(await respondRuns(sessionId)).toBe(1)
		const story = (await rowsOf(sessionId)).filter((r) => r.channel === "main")
		expect(story.at(-1)!.role).not.toBe("user")
		// The next round starts empty: one line waits again.
		await say(ownerId, sessionId, "Ann goes through.")
		expect(await respondRuns(sessionId)).toBe(1)
	})

	it("solo: one seat, one line, the turn", async () => {
		const sessionId = await createSession("solo")
		await db.insert(schema.sessionPersonas).values({ sessionId, userId: ownerId, seatName: "Ann" } as any)
		await say(ownerId, sessionId, "Ann lights a torch.")
		expect(await respondRuns(sessionId)).toBe(1)
	})
})

describe("Continue resolves the round early (D4)", () => {
	it("the owner's press fires the story turn with only one seat declared; the absent seat acts on its standing order", async () => {
		const { sessionId, ann, bo } = await tableOfTwo("owner-continue")
		await say(ownerId, sessionId, "Ann tries the door.")
		expect(await respondRuns(sessionId)).toBe(0)
		const before = calls.length
		const res = await carryOn(ownerId, sessionId)
		expect(res.error, res.error).toBeUndefined()
		expect(await respondRuns(sessionId)).toBe(1)
		// The Planner's input: the declared seat's line, the absent seat's
		// standing order (the slot's default, hold) — by the one declared rule.
		const planner = calls.slice(before).filter((c) => c.includes("keep the books out of sight"))
		expect(planner).toHaveLength(1)
		expect(planner[0]).toMatch(new RegExp(`Ann \\(player-seat:${ann.id}[^)]*\\): declared “Ann tries the door\\.”`))
		expect(planner[0]).toMatch(new RegExp(`Bo \\(player-seat:${bo.id}[^)]*\\): did not declare; standing order: hold\\.`))
		// The Narrator's reply is a turn, not narration: it ends the round (B3).
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect((reply.metadata as any)?.speaker).toBe("envoy:narrator")
		expect(reply.isNarratorResponse).toBe(false)
	})

	it("a player who has not declared is refused; one who has may press", async () => {
		const { sessionId } = await tableOfTwo("guest-continue")
		await say(ownerId, sessionId, "Ann tries the door.")
		const refused = await carryOn(guestId, sessionId)
		expect(refused.ok).toBe(false)
		expect(refused.error).toBe("Nothing is prepared to take a turn.")
		expect(await respondRuns(sessionId)).toBe(0)

		const other = await tableOfTwo("declared-continue")
		await say(guestId, other.sessionId, "Bo watches the hall.")
		expect(await respondRuns(other.sessionId)).toBe(0)
		const res = await carryOn(guestId, other.sessionId)
		expect(res.error, res.error).toBeUndefined()
		expect(await respondRuns(other.sessionId)).toBe(1)
	})
})

describe("reveal the planning notes (D8)", () => {
	it("once: the notes readable by a guest, a notice that does not end the round; twice: refused in the owner's lane", async () => {
		const { sessionId } = await tableOfTwo("reveal")
		await db.execute(
			(await import("drizzle-orm")).sql`update sessions set annex = jsonb_set(annex, '{core,dungeon-crawler-planning-notes}', ${JSON.stringify("The king is not dead.")}::jsonb) where id = ${sessionId}`
		)
		// A secret goal: the journal says so, and the reveal puts the real goal there (round 2).
		const SECRET = "Kept secret by the Planner — ask in the Planner panel."
		await db.execute(
			(await import("drizzle-orm")).sql`update sessions set annex = jsonb_set(jsonb_set(annex, '{core,dungeon-crawler-journal}', ${JSON.stringify({ goal: SECRET, leads: ["A bell rings below."] })}::jsonb), '{core,dungeon-crawler-progress}', (coalesce(annex->'core'->'dungeon-crawler-progress', '{}'::jsonb) || ${JSON.stringify({ goal: "Find the drowned king.", goalMode: "secret" })}::jsonb)) where id = ${sessionId}`
		)
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		const before = await annexViewFor(db as any, sessionId, guestId)
		expect((before?.core?.["dungeon-crawler-journal"] as any)?.goal).toBe(SECRET)
		expect(before?.core?.["dungeon-crawler-planning-notes"]).toBeUndefined()
		expect(before?.core?.["dungeon-crawler-planning-notes-revealed"] ?? "").toBe("")

		// A declaration before the reveal survives it.
		await say(ownerId, sessionId, "Ann tries the door.")
		const first = await reveal(ownerId, sessionId)
		expect(first?.error, first?.error).toBeUndefined()
		const view = await annexViewFor(db as any, sessionId, guestId)
		expect(view?.core?.["dungeon-crawler-planning-notes-revealed"]).toBe("The king is not dead.")
		expect(view?.core?.["dungeon-crawler-planning-notes"]).toBeUndefined()
		expect(view?.core?.["dungeon-crawler-journal"]).toEqual({ goal: "Find the drowned king.", leads: ["A bell rings below."] })
		const notice = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(notice.content).toContain("Planning notes tab")
		expect((notice.metadata as any)?.speaker).toBe("envoy:planner")
		expect(notice.isNarratorResponse).toBe(true)
		// A side note the Planner says: under the Planner's name, not the narrator's.
		expect((notice.metadata as any)?.narratorName).toBe("Planner")
		expect(await respondRuns(sessionId)).toBe(0)
		await say(guestId, sessionId, "Bo reads the notes.")
		expect(await respondRuns(sessionId)).toBe(1)
		// The notice is narration; the Narrator's story reply is not.
		const narrated = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(narrated.id).toBeGreaterThan(notice.id)
		expect(narrated.isNarratorResponse).toBe(false)

		const rowsBefore = (await rowsOf(sessionId)).length
		const second = await reveal(ownerId, sessionId)
		expect(second?.error, second?.error).toBeUndefined()
		const added = (await rowsOf(sessionId)).slice(rowsBefore)
		expect(added).toHaveLength(1)
		expect(added[0]!.channel).toBe("parley")
		expect(added[0]!.content).toContain("already on the table")
		expect((await annexOf(sessionId))["dungeon-crawler-planning-notes-revealed"]).toBe("The king is not dead.")

		// A guest cannot reveal at all.
		const guest = await reveal(guestId, sessionId)
		expect(guest?.error).toBeTruthy()
	})
})

describe("Rest (round 2)", () => {
	it("one line on the journal folio with the clock it moved; the party's night is the owner's alone", async () => {
		const { sessionId } = await tableOfTwo("rest")
		const { sessionsFireActionHandler } = await import("./sessions")
		// 🚧 S3 (lane G3, 2026-10-23): Vis Itineris offers its own Rest — the rules action is the
		// one at the composer, and the crawl's night follows on the event it raises (After a rest).
		// Routines run here only when a test turns them on: After a rest is one.
		const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
		const fire = async (userId: number) => {
			setRoutinesEnabled(true)
			try {
				const res: any = await sessionsFireActionHandler.handler(
					fakeSocket(userId),
					{ sessionId, action: "core:spec/rules-action#rest", payload: {} } as any,
					emit
				)
				await settle()
				return res
			} finally {
				setRoutinesEnabled(false)
			}
		}
		// The story so far: the line the rest's table row belongs to.
		await db
			.insert(schema.sessionMessages)
			.values({ sessionId, role: "assistant", content: "The party makes camp.", channel: "main", metadata: { speaker: "envoy:narrator" } } as any)
		const rested = await fire(ownerId)
		expect(rested?.error, rested?.error).toBeUndefined()
		const journal = (await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && ((r.metadata as any)?.kind ?? "did") === "did")
		expect(journal.map((r) => r.content)).toEqual(["The party rests. Day 1, 08:00 → Day 1, 16:00."])
		// In no voice, anchored as the table's row is to Story's newest line, so deleting that line takes it too.
		expect((journal[0]!.metadata as any)?.speaker).toBeUndefined()
		expect((journal[0]!.metadata as any)?.anchorMessageId).toBe((await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!.id)
		// 🚧 The rest's reckoning is the table's (PLAN-rulesets §30): no
		// speaker, anchored to Story's newest line — never a line on Story.
		const rows = await rowsOf(sessionId)
		const story = rows.filter((r) => r.channel === "main")
		expect(story.some((r) => /rests for eight hours/.test(r.content))).toBe(false)
		const table = rows.filter((r) => r.channel === "table")
		expect(table.map((r) => r.content)).toEqual([expect.stringMatching(/^The party rests for eight hours\./)])
		expect((table[0]!.metadata as any)?.speaker).toBeUndefined()
		expect((table[0]!.metadata as any)?.anchorMessageId).toBe(story.at(-1)!.id)
		// 🚧 The rules' Rest is anyone's to take for themselves; the party's night is still the owner's.
		await fire(guestId)
		expect((await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && ((r.metadata as any)?.kind ?? "did") === "did")).toHaveLength(1)
		// The crawl's own Rest steps aside while the rules offer one: never two Rests.
		const { DUNGEON_CRAWLER_REST_SPEC_ID } = await import("@serene-pub/core-catalog")
		const own: any = await sessionsFireActionHandler.handler(fakeSocket(ownerId), { sessionId, action: `${DUNGEON_CRAWLER_REST_SPEC_ID}#rest`, payload: {} } as any, emit)
		expect(own?.error ?? own?.kind).toBeTruthy()
	})
})

describe("a secret for one player (feature 18)", () => {
	it("lands on that player's Planner lane, nowhere else", async () => {
		const { sessionId, bo } = await tableOfTwo("secret")
		PLANNER_BOOKS.secrets = [{ seat: `player-seat:${bo.id}`, text: "The ferryman winks at Bo." }]
		try {
			await say(ownerId, sessionId, "Ann tries the door.")
			await say(guestId, sessionId, "Bo watches the hall.")
			expect(await respondRuns(sessionId)).toBe(1)
		} finally {
			PLANNER_BOOKS.secrets = []
		}
		const told = (await rowsOf(sessionId)).filter((r) => r.content.includes("The ferryman winks at Bo."))
		expect(told).toHaveLength(1)
		expect(told[0]!.channel).toBe("parley:2")
		expect((told[0]!.metadata as any)?.speaker).toBe("envoy:planner")
	})
})
