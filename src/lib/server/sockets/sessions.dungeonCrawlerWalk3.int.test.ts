/**
 * 🚧 Dungeon Crawler after walk #3 (PLAN-dc-after-walk3-2026-10-19) — over
 * the REAL create, form, send, Continue, retake and action roads, against the
 * SHIPPED documents, a fake model on a chat-wire connection:
 *
 *  - R0-1: a branch of a two-seat crawl keeps each person's layout whole —
 *    the arrangement AND the widget settings it is drawn with (the tab
 *    titles, the Planner panel on the viewer's own lane, the goal panel's
 *    key, the sheet's seats) — and a branch made by a retake plays its turn;
 *  - R0-2: an interview answer pressed while the world is being built keeps
 *    what it wrote (the standing order) and the books prompt lists it;
 *  - R2-1: a failed pick on a trapped way springs the trap's own effect on
 *    the seat that tried it, and the Narrator hears what it did (★2);
 */

import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-walk3-test-secret" }
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
/** What the room was told, in the order it was told it (R1-3: the turn order's pushes). */
const pushes = vi.hoisted(() => [] as Array<{ sessionId: number; event: string; payload: any }>)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, payload: any) => {
		pushes.push({ sessionId, event, payload })
	}
}))

const CLASSES = {
	question: "Which calling?",
	options: [
		{ key: "ranger", label: "Ranger" },
		{ key: "cleric", label: "Cleric" },
		{ key: "rogue", label: "Rogue" }
	]
}
const SHEET = { name: "", class: "", backstory: "Grew up in the marches.", shape: "", difficulty: "", goalMode: "" }
/** A way out as the Planner writes it: every member, empty for none. */
const exit = (over: Record<string, unknown>) => ({ to: "", way: "door", state: "open", lockDc: 0, trap: "", trapDc: 0, trapDamage: "", trapCondition: "", minutes: 0, ...over })
const WORLD = {
	goal: "Find the drowned king.",
	rooms: [
		{
			id: "gate",
			name: "The Sunken Gate",
			description: "Wet stone and a rusted portcullis.",
			exits: [
				exit({ to: "The Hall" }),
				// R2-1: a trap carries its own effect — the dice it deals and the condition it leaves.
				exit({ to: "The Vault", state: "locked", lockDc: 30, trap: "poison needle", trapDc: 12, trapDamage: "1d4", trapCondition: "poisoned" })
			]
		},
		{ id: "hall", name: "The Hall", description: "Pillars in black water.", exits: [exit({ to: "The Sunken Gate" })] },
		{ id: "vault", name: "The Vault", description: "A drowned treasury.", exits: [exit({ to: "The Sunken Gate" })] }
	],
	npcs: [{ name: "Moss", description: "A wary ferryman who speaks in riddles." }],
	leads: ["A bell rings below."],
	notes: "The king is not dead."
}
const OPENING = "Water laps at your boots as the portcullis groans."
const NARRATION = "The water stills."
const PLANNER_SAYS = "Noted. I'll see what the story makes of it."

/** One delta as the Planner's grammar writes it: every member, empty for none. */
const delta = (d: Record<string, unknown>) => ({
	owner: "", op: "add", slot: "", repertoire: "", piece: "", value: "", check: "", against: 0, reason: "", ...d
})
/** A story turn's Planner answer. */
const plan = (over: Record<string, unknown> = {}) => ({
	deltas: [],
	world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
	clock: { minutes: 5 },
	narratorBrief: "The hall is quiet.",
	roundSummary: "",
	secrets: [],
	...over
})
/** Story-turn answers handed out first first; a quiet round when empty. */
const planQueue: any[] = []
/** What the Planner's talk notes (the edits call), first first; nothing when empty. */
const editsQueue: any[] = []
/** Run while the story Planner is being asked — a person sending mid-turn. */
let duringPlanner: (() => Promise<void>) | null = null
/** Run while the world is being built — a person pressing mid-genesis. */
let duringGenesis: (() => Promise<void>) | null = null

/** Every call the fake model took: its prompt. */
const calls: string[] = []
/** Every call's compiled prompt, as the adapter was handed it. */
const compiled: any[] = []
/** The sheet the Planner writes (a Just play names its hero here). */
let sheetAnswer: Record<string, unknown> = SHEET
/** What the Narrator says (empty: a failed reply). */
let narratorSays = NARRATION
/** How many Planner books calls in a row come back empty. */
let plannerEmpty = 0

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
		compiled.push(p)
		return this
	}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		calls.push(prompt)
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes("keep the books out of sight")) {
					if (plannerEmpty > 0) {
						plannerEmpty--
						return onContent("")
					}
					if (duringPlanner) {
						const hook = duringPlanner
						duringPlanner = null
						await hook()
					}
					return onContent(JSON.stringify(planQueue.length ? planQueue.shift() : plan()))
				}
				if (prompt.includes("What happens this round, from the Planner")) return onContent(narratorSays)
				if (prompt.includes("Offer three to five classes")) return onContent(JSON.stringify(CLASSES))
				if (prompt.includes("writing a player's character sheet")) return onContent(JSON.stringify(sheetAnswer))
				if (prompt.includes("you build the world they walk into")) {
					if (duringGenesis) {
						const hook = duringGenesis
						duringGenesis = null
						await hook()
					}
					return onContent(JSON.stringify(WORLD))
				}
				if (prompt.includes("Now note what they asked for"))
					return onContent(JSON.stringify(editsQueue.length ? editsQueue.shift() : { standingOrder: "", asks: [], deltas: [], rooms: [] }))
				if (prompt.includes("the story is about to begin")) return onContent(OPENING)
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-walk3-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-w3-owner")).id
	guestId = (await createTestUser(db, "dc-w3-guest")).id

	const [textConn] = await db
		.insert(schema.connections)
		// An OpenAI-compatible endpoint: the chat wire, the walk's (P0-1).
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "dc-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Dungeon Crawler walk3 test sampling",
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

async function createSession(
	name: string,
	o: { ruleset?: string; rigour?: string; settings?: Record<string, string>; personaIds?: number[]; characterIds?: number[] } = {}
) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: preset!.id, primaryRuleset: o.ruleset ?? "core:ruleset/vis-itineris@1", rigour: o.rigour ?? "scripts" },
			characterIds: o.characterIds ?? [],
			personaIds: o.personaIds ?? [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	// 🚧 The table's ruleset settings, chosen before the interview (P2-4).
	if (o.settings) {
		const { setSessionRulesetSettings } = await import("$lib/server/rulesets/settings")
		await setSessionRulesetSettings(db as any, res.session.id, { values: o.settings })
	}
	return res.session.id as number
}

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

async function annexOf(sessionId: number) {
	const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	return ((row!.annex as any)?.core ?? {}) as Record<string, any>
}

async function composerStatesOf(sessionId: number) {
	const [row] = await db
		.select({ composerStates: schema.sessions.composerStates })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return (row!.composerStates ?? {}) as Record<string, any>
}

async function ownLore(sessionId: number, typeId: string) {
	const [book] = await db.select({ id: schema.lorebooks.id }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	const rows = await db
		.select({ id: schema.lorebookEntries.id, typeId: schema.lorebookEntries.typeId, title: schema.lorebookEntries.title, content: schema.lorebookEntries.content })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
		.orderBy(asc(schema.lorebookEntries.id))
	return rows.filter((r) => r.typeId === typeId)
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

/** Every form on a channel, newest first, with its row. */
async function formsOn(sessionId: number, channel: string) {
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	const out: Array<{ messageId: number; block: any }> = []
	for (const row of (await rowsOf(sessionId)).filter((r) => r.channel === channel).reverse())
		for (const tree of await blockTreesOf(db as any, row.id)) for (const b of tree as any[]) out.push({ messageId: row.id, block: b })
	return out
}

async function fire(userId: number, sessionId: number, action: string, messageId: number | undefined, blockId: string | undefined, payload: Record<string, unknown>) {
	const { sessionsFireActionHandler } = await import("./sessions")
	const res: any = await sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{ sessionId, action, ...(messageId ? { messageId } : {}), ...(blockId ? { blockId } : {}), payload } as any,
		emit
	)
	await settle()
	return res
}

async function press(userId: number, sessionId: number, channel: string, payload: Record<string, unknown>) {
	const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
	const form = await openForm(sessionId, channel)
	return fire(userId, sessionId, DUNGEON_CRAWLER_INTERVIEW_ACTION, form.messageId, form.blocks[0].id, payload)
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
async function respondRuns(sessionId: number) {
	await settle()
	const runs = await db
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
	return runs.filter((r) => r.specSlug === RESPOND).length
}

/** The owner's interview, end to end: the world built, Ann made. */
async function madeTable(
	name: string,
	o: { difficulty?: string; cls?: string; ruleset?: string; rigour?: string; settings?: Record<string, string>; characterIds?: number[] } = {}
) {
	const sessionId = await createSession(name, o)
	const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
	for (const choice of ["dungeon", o.difficulty ?? "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
	expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
	expect((await own({ choice: o.cls ?? "ranger" })).error).toBeUndefined()
	expect((await own({ choice: "surprise" })).error).toBeUndefined()
	await settle()
	const seat = (await seatOf(sessionId, ownerId))!
	return { sessionId, seat, ref: `player-seat:${seat.id}`, owner: { kind: "player_seat", id: seat.id } }
}

/** Ann's line on Story, then the turn fired, the Planner answering `answer`. */
async function turn(sessionId: number, ref: string, line: string, answer?: unknown) {
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId: ownerId,
		role: "user",
		content: line,
		channel: "main",
		metadata: { speaker: ref }
	} as any)
	if (answer) planQueue.push(answer)
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
	await settle()
	expect(res?.error, res?.error).toBeUndefined()
}

/** A line by a person through the real send (with `personaId`, as that card). */
async function send(userId: number, sessionId: number, content: string, channel = "main", personaId: number | null = null) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		{ sessionId, personaId, content, channel } as any,
		emit
	)
	await settle()
	return res
}

const tableRows = async (sessionId: number) => (await rowsOf(sessionId)).filter((r) => r.channel === "table").map((r) => r.content)


/** The compiled prompts since `from`, whose text holds `marker`. */
const promptsWith = (marker: string, from = 0) => compiled.slice(from).filter((p) => JSON.stringify(p).includes(marker))
const BOOKS = "keep the books out of sight"
const NARRATE = "What happens this round, from the Planner"
const lastTurnOf = (p: any) => (p?.messages as Array<{ role: string; content: string }> | undefined)?.at(-1)

async function addGuest(sessionId: number) {
	const { sessionsAddGuestHandler } = await import("./sessions")
	const added: any = await sessionsAddGuestHandler.handler(fakeSocket(ownerId), { sessionId, guestUserId: guestId } as any, emit)
	expect(added?.success, added?.error).toBe(true)
	await settle()
}

async function fireContinue(sessionId: number) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
	await settle()
	return res
}

/** Wait until `probe` answers truthy (every 10 ms), or fail after `ms`. */
async function until<T>(probe: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
	const end = Date.now() + ms
	for (;;) {
		const got = await probe()
		if (got) return got
		if (Date.now() > end) throw new Error("waited too long")
		await new Promise((r) => setTimeout(r, 10))
	}
}

/** A press through the real door, NOT settled: the run is still in flight when it returns its promise. */
async function pressRaw(userId: number, sessionId: number, messageId: number, blockId: string, payload: Record<string, unknown>) {
	const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
	const { sessionsFireActionHandler } = await import("./sessions")
	return sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{ sessionId, action: DUNGEON_CRAWLER_INTERVIEW_ACTION, messageId, blockId, payload } as any,
		emit
	) as Promise<any>
}

/** The form whose question matches `question` on `channel`, once its row is written. */
async function formAsking(sessionId: number, channel: string, question: RegExp) {
	return until(async () => (await formsOn(sessionId, channel)).find((f) => question.test(String(f.block.question ?? ""))) ?? null)
}

/** The guest, made through their own interview: Rook the ranger. */
async function madeGuest(sessionId: number, o: { added?: boolean } = {}) {
	if (!o.added) await addGuest(sessionId)
	const guest = (payload: Record<string, unknown>) => press(guestId, sessionId, "parley:2", payload)
	expect((await guest({ choice: "make-character" })).error).toBeUndefined()
	expect((await guest({ name: "Rook" })).error).toBeUndefined()
	expect((await guest({ choice: "ranger" })).error).toBeUndefined()
	expect((await guest({ choice: "surprise" })).error).toBeUndefined()
	await settle()
	const seat = (await seatOf(sessionId, guestId))!
	return { seat, ref: `player-seat:${seat.id}`, owner: { kind: "player_seat", id: seat.id } }
}

/** A person's whole session layout, as the page reads it on open (the copy on first open included). */
async function layoutOf(userId: number, sessionId: number) {
	const { sessionsPanelLayoutGetHandler } = await import("./sessions")
	return (await sessionsPanelLayoutGetHandler.handler(fakeSocket(userId), { sessionId } as any, emit)) as any
}

describe("R0-1: a branch keeps the crawl's layout for every person", () => {
	it("a retake in branch mode: owner and guest open the branch on the genre's tabs, titles, lanes, goal key and seats — and the turn is played", async () => {
		const { sessionId, ref } = await madeTable("walk3-branch")
		const rook = await madeGuest(sessionId)
		// The genre's shipped layout, as boot reconciles it.
		const [{ genreId }] = (await db.select({ genreId: schema.sessions.genreId }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))) as any
		await (await import("$lib/server/db/layoutPresets")).syncLayoutPresets([genreId])
		// Both open the session: each gets the genre's layout and its widget settings.
		const ownerBefore = await layoutOf(ownerId, sessionId)
		const guestBefore = await layoutOf(guestId, sessionId)
		expect(ownerBefore.widgetSettings?.["messages#parley"]?.channelLane).toBe("mine")
		expect(guestBefore.widgetSettings?.["annex#journal"]?.key).toBe("core.dungeon-crawler-journal")
		await turn(sessionId, ref, "I light the lantern.")
		await send(guestId, sessionId, "I follow the light.")
		await fireContinue(sessionId)
		// On revision: Branch, then Regenerate — the walk's A.T27.
		await db.update(schema.sessions).set({ onRevision: "branch" } as any).where(eq(schema.sessions.id, sessionId))
		const { sessionsRetakeTurnHandler } = await import("./sessions")
		const retake: any = await sessionsRetakeTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		expect(retake?.error, retake?.error).toBeUndefined()
		const branchId = retake.branchedTo as number
		expect(branchId).toBeGreaterThan(sessionId)
		// The retaken turn was played in the branch: a Narrator line, settled, no error on it.
		const narrated = (await rowsOf(branchId)).filter((r) => r.channel === "main" && r.role === "assistant").at(-1)!
		expect(narrated.isGenerating).toBe(false)
		expect(narrated.error ?? null, String(narrated.error)).toBeNull()
		expect(narrated.content).toBe(NARRATION)

		const { sessionsGetHandler } = await import("./sessions")
		const { laneClaimOf } = await import("$lib/client/sessionLayout/channelClaims")
		for (const [userId, before, lane] of [
			[ownerId, ownerBefore, "parley:1"],
			[guestId, guestBefore, "parley:2"]
		] as const) {
			const after = await layoutOf(userId, branchId)
			// The same arrangement — the genre's named tabs — and the same provenance.
			expect(after.layout?.panels).toEqual(before.layout?.panels)
			expect(after.startedFromLayoutPresetId).toBe(before.startedFromLayoutPresetId)
			// …drawn with the same settings: titles, the journal's channel, the goal's key, the sheet's seats.
			expect(after.widgetSettings).toEqual(before.widgetSettings)
			expect(after.widgetSettings?.messages?.title).toBe("Story")
			expect(after.widgetSettings?.["messages#journal"]?.channel).toBe("travelogue")
			expect(after.widgetSettings?.["annex#journal"]?.key).toBe("core.dungeon-crawler-journal")
			expect(after.widgetSettings?.stats?.owners).toBe("seats")
			// The Planner panel shows this person's own lane in the branch.
			const got: any = await sessionsGetHandler.handler(fakeSocket(userId), { id: branchId } as any, emit)
			expect(laneClaimOf(after.widgetSettings?.["messages#parley"], { viewerId: userId, annex: null, channels: got.session.channels })).toBe(lane)
		}
		expect(rook.seat.id).toBeTruthy()
	})
})

describe("R0-2: an answer pressed while the world is built keeps its write", () => {
	it("a persona host's standing order, pressed during genesis: saved on the seat, and the books list it", async () => {
		const [maren] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Maren Holt", description: "A soldier.", isPersona: true } as any)
			.returning()
		const sessionId = await createSession("walk3-answer-during-genesis", { personaIds: [maren!.id] })
		await addGuest(sessionId)
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared", "cleric"]) expect((await own({ choice })).error).toBeUndefined()
		// The standing order is pressed the moment its question is written — while the world is still being built.
		let pressed: Promise<any> | null = null
		duringGenesis = async () => {
			const form = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "standing-order")
			expect(form, "the standing order is asked before the world is built").toBeTruthy()
			pressed = pressRaw(ownerId, sessionId, form!.messageId, form!.block.id, { choice: "follow" })
			// The press is under way while the Planner is still building.
			await new Promise((r) => setTimeout(r, 300))
		}
		expect((await own({ choice: "persona" })).error).toBeUndefined()
		await settle()
		expect(pressed, "genesis ran").not.toBeNull()
		expect((await pressed!)?.error, (await pressed!)?.error).toBeUndefined()
		await settle()
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").map((r) => r.content)
		expect(lane.some((t) => /will follow the party/.test(t))).toBe(true)
		// Saved: the seat's standing order is Follow…
		const cast = { kind: "session_cast", id: maren!.id }
		expect(await value(sessionId, cast, "core:slot/standing-order@1")).toBe("follow")
		// …and the round's books say so for the seat that did not declare.
		const rook = await madeGuest(sessionId, { added: true })
		expect((await send(guestId, sessionId, "I scout ahead."))?.error).toBeUndefined()
		const from = compiled.length
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(guestId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		const books = String(lastTurnOf(promptsWith(BOOKS, from)[0])?.content)
		expect(books).toMatch(/Maren Holt \(character:\d+[^\n]*did not declare; standing order: follow\./)
		expect(rook.seat.id).toBeTruthy()
	})
})

describe("R1-3: no Continue bar after a solo round", () => {
	it("a solo line through the real send: the round plays, and the last turn order the room hears is empty", async () => {
		const { sessionId } = await madeTable("walk3-solo-continue")
		expect((await send(ownerId, sessionId, "I search the moorings."))?.error).toBeUndefined()
		await settle()
		const narrated = (await rowsOf(sessionId)).filter((r) => r.channel === "main" && r.role === "assistant").at(-1)!
		expect(narrated.content).toBe(NARRATION)
		const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect((coreAnnexIn(row!.annex) as any)?.turnOrder?.order ?? []).toEqual([])
		const heard = pushes.filter((p) => p.sessionId === sessionId && p.event === "sessions:turnOrder")
		expect(heard.length).toBeGreaterThan(0)
		expect(heard.at(-1)!.payload.turnOrder?.order ?? []).toEqual([])
	})
})

/** The change lines a session's ledger reads, as the page spells them (its slots' shapes and words). */
async function ledgerTexts(sessionId: number) {
	const { stateLedger, stateGet } = await import("./state")
	const res: any = await stateLedger.handler(fakeSocket(ownerId), { sessionId } as any, emit)
	const got: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit)
	const slots = new Map<string, any>((got.slots ?? []).map((sl: any) => [sl.slotId, sl]))
	const { ledgerLines } = await import("$lib/shared/state/ledgerLines")
	return ledgerLines(res.rows, res.baselines, (id) => slots.get(id), { words: res.words === true }).map((l) => l.text)
}

describe("R1-4: a new character's sheet reads as made, not as a fall", () => {
	it("Vis Itineris: 'Health 12 (full)', never 'Health 20 → 12'; Freeform: no health line, never 'Health falls'", async () => {
		const { sessionId } = await madeTable("walk3-creation-lines")
		const lines = await ledgerTexts(sessionId)
		expect(lines).toContain("Health 12 (full)")
		expect(lines.some((t) => /^Health 20 →/.test(t))).toBe(false)
		const story = await madeTable("walk3-creation-words", { ruleset: "core:ruleset/freeform@1", rigour: "prose" })
		const words = await ledgerTexts(story.sessionId)
		// 🚧 S4 (lane G3, 2026-10-23): Freeform keeps no classes, so no kit sets a full health of its own —
		// the sheet already reads full, and creation writes no health line at all (never a fall).
		expect(words.filter((t) => /^Health/.test(t))).toEqual([])
		expect(words).not.toContain("Health falls")
	})
})

describe("R2-1 / R2-2 / ★4: the world's ways out are held from the start, and a sprung trap costs something", () => {
	it("the crib names the trapped door before any re-listing; a re-listing changes nothing; a failed pick springs the needle's damage and poison on the picker, and the Narrator hears it", async () => {
		// A natural 20 opens even a DC 30 lock: a table whose first pick succeeds is set aside for another.
		for (let attempt = 0; attempt < 3; attempt++) {
			const { sessionId, ref, owner } = await madeTable(`walk3-trap-${attempt}`, { cls: "rogue" })
			// R2-2: held as pieces at genesis — the books crib names each way out exactly, the trap the Planner's alone.
			const vault = { id: "gate", name: "The Sunken Gate", description: "Wet stone.", exits: WORLD.rooms[0]!.exits }
			let from = compiled.length
			await turn(sessionId, ref, "I look at the doors.", plan({ world: { rooms: [vault], npcs: [], leads: [], goalProgress: "none", notes: "" } }))
			const crib = JSON.stringify(promptsWith(BOOKS, from)[0])
			expect(crib).toMatch(/Door to The Vault \(locked; trapped: poison needle\)/)
			expect(crib).toMatch(/Door to The Hall \(open\)/)
			// …and the Planner listing the place again as it stands is no change: nothing gained, nothing on the table.
			expect((await tableRows(sessionId)).join("\n")).not.toMatch(/Door to The (Vault|Hall)/)
			const hpBefore = Number(await value(sessionId, owner, "core:slot/hp@1"))
			from = compiled.length
			await turn(
				sessionId,
				ref,
				"I pick the lock on the Door to The Vault.",
				plan({ deltas: [delta({ owner: "The Sunken Gate", op: "traverse", piece: "Door to The Vault", check: "skill.sleight-of-hand", against: 30, reason: "picks" })] })
			)
			const line = (await tableRows(sessionId)).at(-1) ?? ""
			// ★4: the rogue is trained in Sleight of hand — the pick adds proficiency.
			expect(line).toMatch(/Ann the Bold — traverse Door to The Vault \(Sleight of hand[^)]*\): [^\n]*\(proficiency\)/i)
			if (!/: (Critical )?[Ff]ailure/.test(line)) continue
			// ★2: the needle springs — its dice off her health, poisoned — said on the table, told to the Narrator.
			expect(line).toMatch(/poison needle springs on Ann the Bold: Health −[1-4], Poisoned/i)
			const hpAfter = Number(await value(sessionId, owner, "core:slot/hp@1"))
			expect(hpAfter).toBeLessThan(hpBefore)
			const conditions = JSON.stringify(await value(sessionId, owner, "core:slot/crawl-conditions@1"))
			expect(conditions).toMatch(/poison/i)
			expect(JSON.stringify(promptsWith(NARRATE, from))).toMatch(/poison needle springs on Ann the Bold: Health −[1-4], Poisoned/i)
			return
		}
		throw new Error("three picks at DC 30 all succeeded")
	})
})

describe("R3-1: a solo line sent while a round settles is never held", () => {
	it("its recompute outvoted by a run's (written first, under a cause that never fires): the person's cause is still heard, and the round plays", async () => {
		const { sessionId } = await madeTable("walk3-held-line")
		// A run's recompute emitted after the line, written first: the round ready, under a run's cause — nothing fired.
		const { writeTurnOrder } = await import("$lib/server/sessions/turnOrder")
		const later = Date.now() + 60_000
		const written = await writeTurnOrder(db as any, sessionId, {
			v: 1,
			order: [{ ref: null, via: "voice" }],
			candidates: [],
			basedOnAt: later,
			computedAt: later,
			runId: null,
			event: "core:event/annex-changed@1",
			strategy: "core:task/turn-scripted@1"
		} as any)
		expect(written.written).toBe(true)
		const before = await respondRuns(sessionId)
		// The line's own recompute is now stale — and the round still plays on it.
		expect((await send(ownerId, sessionId, "I wade toward the pale shape."))?.error).toBeUndefined()
		await settle()
		expect(await respondRuns(sessionId)).toBe(before + 1)
		const narrated = (await rowsOf(sessionId)).filter((r) => r.channel === "main" && r.role === "assistant").at(-1)!
		expect(narrated.content).toBe(NARRATION)
	})
})
