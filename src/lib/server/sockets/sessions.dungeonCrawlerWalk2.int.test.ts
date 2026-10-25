/**
 * 🚧 Dungeon Crawler after walk #2 (PLAN-dc-after-walk2-2026-10-19) — over
 * the REAL create, form, send, Continue and action roads, against the
 * SHIPPED documents, a fake model on a chat-wire connection:
 *
 *  - Q0-1: an interview answer pressed a beat after its question lands is
 *    never lost (owner ruling ★1: it queues behind the settling run);
 *  - Q0-2: after a persona's character dies, the new character is a new
 *    seat under its own name; a line its player sends — even with the card
 *    still in the composer — is the new seat's, and starts the round alone
 *    (★2: the card stays with the fallen seat);
 *  - Q0-3: a guest's line and the guest's Continue ask the Planner — the
 *    "Planner is silent" brief follows only an empty or unreadable answer;
 *  - Q0-4: Give to… — a stack merges into the receiver's count, part of a
 *    stack may be given, a guest OFFERS and the receiver accepts or declines
 *    (or the giver withdraws), refusals in words, a companion is no one to
 *    offer to (★4);
 *  - Q1-2: a branch keeps each line's author (a retired seat's too), the
 *    Planner lanes and their register, the crawl's progress document, each
 *    person's layout (the tab they were on) and the lines' times (★5);
 *  - Q1-4: a Regenerate pressed while only a background run settles waits a
 *    beat for it, never "wait for the reply to finish" with nothing running;
 *  - Q1-5: the journal says a seat lies dying with its tally while death
 *    saves run, and that it came back only once it did;
 *  - Q1-6: spell points are ONE row — the pool under the seat's own most —
 *    and the crib says "of 4", never "of 99";
 *  - Q2-1/Q2-2: a lock is picked by the seat whose line names the door, at the
 *    door's own difficulty; the crib names each way out exactly;
 *  - Q2-3: the Story ruleset keeps no numbers — health in words, no level, no
 *    spell slots, no trap before it is found, a condition in words, the
 *    Planner asked in a shape with no difficulties;
 *  - Q2-4: the talk's crib says the rules' options;
 *  - Q1-1: the first page is each channel's newest 25 lines, `olderIn`
 *    names the channels with more, and a channel's own older page follows
 *    (★7);
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-walk2-test-secret" }
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

const CLASSES = {
	question: "Which calling?",
	options: [
		{ key: "ranger", label: "Ranger" },
		{ key: "cleric", label: "Cleric" }
	]
}
const SHEET = { name: "", class: "", backstory: "Grew up in the marches.", shape: "", difficulty: "", goalMode: "" }
const WORLD = {
	goal: "Find the drowned king.",
	rooms: [
		{ id: "gate", name: "The Sunken Gate", description: "Wet stone and a rusted portcullis.", exits: [{ to: "The Hall", way: "door", state: "open", lockDc: 0, trap: "", trapDc: 0, minutes: 0 }] },
		{ id: "hall", name: "The Hall", description: "Pillars in black water.", exits: [{ to: "The Sunken Gate", way: "door", state: "open", lockDc: 0, trap: "", trapDc: 0, minutes: 0 }] }
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
				if (prompt.includes("you build the world they walk into")) return onContent(JSON.stringify(WORLD))
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-walk2-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-w2-owner")).id
	guestId = (await createTestUser(db, "dc-w2-guest")).id

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
			name: "Dungeon Crawler walk2 test sampling",
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

describe("Q0-1: an answer pressed a beat after its question lands is never lost (★1)", () => {
	it("two seats: each answer pressed 300 ms after the question row is written lands, and the next question follows", async () => {
		const sessionId = await createSession("walk2-fast-answers")
		await addGuest(sessionId)
		const first = await openForm(sessionId, "parley")
		const quick = async (userId: number, channel: string, prior: Promise<any>, question: RegExp, payload: Record<string, unknown>, delay: number) => {
			const form = await formAsking(sessionId, channel, question)
			await new Promise((r) => setTimeout(r, delay))
			const res = await pressRaw(userId, sessionId, form.messageId, form.block.id, payload)
			expect((await prior)?.error, (await prior)?.error).toBeUndefined()
			return res
		}
		// The host: A dungeon, then Fair 300 ms after "How hard?" is written — and the goal question 0 ms after its row.
		const dungeon = pressRaw(ownerId, sessionId, first.messageId, first.blocks[0].id, { choice: "dungeon" })
		const fair = quick(ownerId, "parley", dungeon, /How hard/, { choice: "fair" }, 300)
		const goal = quick(ownerId, "parley", fair, /The goal\?/, { choice: "shared" }, 0)
		expect((await goal)?.error, (await goal)?.error).toBeUndefined()
		// The guest: Make my character, then the name 300 ms after its question is written, then the class.
		const guestFirst = await openForm(sessionId, "parley:2")
		const make = pressRaw(guestId, sessionId, guestFirst.messageId, guestFirst.blocks[0].id, { choice: "make-character" })
		const named = quick(guestId, "parley:2", make, /What is your character called/, { name: "Rook" }, 300)
		const classed = quick(guestId, "parley:2", named, /Which calling/, { choice: "ranger" }, 300)
		expect((await classed)?.error, (await classed)?.error).toBeUndefined()
		await settle()
		const host = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").map((r) => r.content)
		expect(host).toContain("Fair.")
		expect(host).toContain("Tell us the goal.")
		expect(host.some((t) => /Now, who are you\?/.test(t))).toBe(true)
		const guest = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2").map((r) => r.content)
		expect(guest).toContain("Name: Rook.")
		expect(guest).toContain("Ranger.")
		expect(guest.some((t) => /Where does Rook come from\?/.test(t))).toBe(true)
		// No to-do is left behind for a question already answered.
		const todos = await db.select().from(schema.notifications)
		const { formStandingOf } = await import("$lib/server/notifications/openForm")
		for (const n of todos.filter((t) => !t.clearedAt && t.regarding.startsWith(`session:${sessionId}/form:`))) {
			const [, mid, bid] = /^session:\d+\/form:(\d+)\/(.+)$/.exec(n.regarding)!
			expect(await formStandingOf(db as any, sessionId, Number(mid), bid!), n.regarding).toBe("open")
		}
	})
})

describe("Q0-1: an answer the interview could not judge is never marked answered (★1)", () => {
	it("the script failing halts the answer: the question stays open, its to-do stays, and the next press lands", async () => {
		const sessionId = await createSession("walk2-unjudged-answer")
		const { DUNGEON_CRAWLER_INTERVIEW_SCRIPT } = await import("@serene-pub/core-catalog")
		const [row] = await db
			.select()
			.from(schema.pipelineScripts)
			.where(eq(schema.pipelineScripts.seedKey, DUNGEON_CRAWLER_INTERVIEW_SCRIPT.seedKey))
		expect(row?.source).toBeTruthy()
		const form = await openForm(sessionId, "parley")
		await db.update(schema.pipelineScripts).set({ source: "throw new Error('the judge is out')" }).where(eq(schema.pipelineScripts.id, row!.id))
		let res: any
		try {
			res = await fire(ownerId, sessionId, (await import("@serene-pub/core-catalog")).DUNGEON_CRAWLER_INTERVIEW_ACTION, form.messageId, form.blocks[0].id, { choice: "dungeon" })
		} finally {
			await db.update(schema.pipelineScripts).set({ source: row!.source }).where(eq(schema.pipelineScripts.id, row!.id))
		}
		expect(res?.error).toMatch(/the judge is out/)
		const { formStandingOf } = await import("$lib/server/notifications/openForm")
		expect(await formStandingOf(db as any, sessionId, form.messageId, form.blocks[0].id)).toBe("open")
		const todo = `session:${sessionId}/form:${form.messageId}/${form.blocks[0].id}`
		expect((await db.select().from(schema.notifications)).some((t) => t.regarding === todo && !t.clearedAt)).toBe(true)
		expect((await rowsOf(sessionId)).filter((r) => r.channel === "parley").map((r) => r.content)).not.toContain("A dungeon.")
		// Pressed again, with the judge back: it lands, and the next question follows.
		expect((await press(ownerId, sessionId, "parley", { choice: "dungeon" })).error).toBeUndefined()
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").map((r) => r.content)
		expect(lane).toContain("A dungeon.")
		expect(lane.some((t) => /How hard should the world push back/.test(t))).toBe(true)
	})
})

describe("Q0-2: a new character after a persona's death is its own speaker (★2)", () => {
	it("the card stays with the fallen seat; a solo line from its player is the new seat's and starts the round at once", async () => {
		const [maren] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Maren Holt", description: "A soldier.", isPersona: true } as any)
			.returning()
		const sessionId = await createSession("walk2-persona-death", { personaIds: [maren!.id] })
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		// The persona names the seat: the world's three, then the class and backstory.
		for (const choice of ["dungeon", "brutal", "shared", "ranger", "surprise"]) expect((await own({ choice })).error).toBeUndefined()
		await settle()
		const ref = `character:${maren!.id}`
		const owner = { kind: "session_cast", id: maren!.id }
		let attempts = 0
		while ((await value(sessionId, owner, "core:slot/fate@1")) !== "dead" && attempts++ < 12)
			await turn(sessionId, ref, "I charge the ogre.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: "99", reason: "the ogre" })] }))
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("dead")
		const form = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "new-character")!
		const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
		expect((await fire(ownerId, sessionId, DUNGEON_CRAWLER_INTERVIEW_ACTION, form.messageId, form.block.id, { choice: "new-character" })).error).toBeUndefined()
		expect((await own({ name: "Ash Fenwick" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seats = await db.select().from(schema.sessionPersonas).where(eq(schema.sessionPersonas.sessionId, sessionId))
		const fallen = seats.find((s) => s.personaId === maren!.id)!
		const ash = seats.find((s) => s.seatName === "Ash Fenwick")!
		expect(fallen.removedAt).not.toBeNull()
		expect(ash.personaId).toBeNull()
		expect(ash.removedAt).toBeNull()
		// A line sent with the card still in the composer (an open page from before): the new seat's, and the round runs.
		const before = await respondRuns(sessionId)
		expect((await send(ownerId, sessionId, "Um, hi. I look at the cairn.", "main", maren!.id))?.error).toBeUndefined()
		const line = (await rowsOf(sessionId)).filter((r) => r.channel === "main" && r.role === "user").at(-1)!
		expect(line.content).toBe("Um, hi. I look at the cairn.")
		expect((line.metadata as any)?.speaker).toBe(`player-seat:${ash.id}`)
		expect(line.personaId ?? null).toBeNull()
		expect(await respondRuns(sessionId)).toBe(before + 1)
		// The next line, with no card, is the new seat's too — and starts the next round alone.
		const from = compiled.length
		expect((await send(ownerId, sessionId, "I walk on.", "main"))?.error).toBeUndefined()
		expect(await respondRuns(sessionId)).toBe(before + 2)
		const books = String(lastTurnOf(promptsWith(BOOKS, from)[0])?.content)
		expect(books).toContain(`- Ash Fenwick (player-seat:${ash.id}, Ranger`)
		expect(JSON.stringify(promptsWith(BOOKS, from)[0])).toContain("Ash Fenwick: I walk on.")
	})
})

/** The guest, made through their own interview: Rook the ranger. */
async function madeGuest(sessionId: number) {
	await addGuest(sessionId)
	const guest = (payload: Record<string, unknown>) => press(guestId, sessionId, "parley:2", payload)
	expect((await guest({ choice: "make-character" })).error).toBeUndefined()
	expect((await guest({ name: "Rook" })).error).toBeUndefined()
	expect((await guest({ choice: "ranger" })).error).toBeUndefined()
	expect((await guest({ choice: "surprise" })).error).toBeUndefined()
	await settle()
	const seat = (await seatOf(sessionId, guestId))!
	return { seat, ref: `player-seat:${seat.id}`, owner: { kind: "player_seat", id: seat.id } }
}

describe("Q0-3: every round asks the Planner", () => {
	it("a guest's line and the guest's Continue: the books are called, with the guest's line in the round", async () => {
		const { sessionId } = await madeTable("walk2-guest-continue")
		const rook = await madeGuest(sessionId)
		const before = await respondRuns(sessionId)
		expect((await send(guestId, sessionId, "I pick the iron door's lock with my thieves' tools."))?.error).toBeUndefined()
		// Two seats, one declared: the round waits.
		expect(await respondRuns(sessionId)).toBe(before)
		const from = compiled.length
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(guestId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		expect(await respondRuns(sessionId)).toBe(before + 1)
		const books = promptsWith(BOOKS, from)
		expect(books).toHaveLength(1)
		expect(String(lastTurnOf(books[0])?.content)).toContain(`- Rook (${rook.ref}`)
		expect(String(lastTurnOf(books[0])?.content)).toContain("declared \u201CI pick the iron door's lock with my thieves' tools.\u201D")
		expect(JSON.stringify(promptsWith(NARRATE, from))).not.toContain("The Planner is silent this round")
	})
})

const CONSUMABLES = "core:slot/crawl-consumables@1"
const potionsOf = async (sessionId: number, owner: { kind: string; id: number }) => {
	const held = ((await value(sessionId, owner, CONSUMABLES)) as any[] | null) ?? []
	const at = held.findIndex((p) => p?.pieceId === "potion-of-healing" || /potion of healing/i.test(String(p?.name ?? p)))
	return { at, count: at < 0 ? 0 : Number(held[at]?.count ?? 1) }
}
async function give(userId: number, sessionId: number, from: any, to: any, index: number, count?: number) {
	const { stateGivePiece } = await import("./state")
	let said: any = null
	const res: any = await stateGivePiece.handler(
		fakeSocket(userId),
		{ sessionId, from, to, slotId: CONSUMABLES, index, ...(count ? { count } : {}), request: "t" } as any,
		((_e: string, r: any) => (said = r)) as any
	)
	await settle()
	return res ?? said
}
async function decide(userId: number, proposalId: number, accept: boolean) {
	const { stateDecide } = await import("./state")
	const res: any = await stateDecide.handler(fakeSocket(userId), { proposalId, accept } as any, emit)
	await settle()
	return res
}
const openOffers = async (sessionId: number) =>
	(await db.select().from(schema.stateProposals).where(eq(schema.stateProposals.sessionId, sessionId))).filter(
		(r) => r.status === "pending" && (r.payload as any)?.offer
	)

describe("Q0-4: Give to… (★4)", () => {
	it("merges into the receiver's count, gives part of a stack; a guest offers and the receiver accepts, declines, or the giver withdraws", async () => {
		const [tamsin] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Brother Tamsin", description: "A travelling monk." } as any)
			.returning()
		const { sessionId, ref, owner: ann } = await madeTable("walk2-give", { characterIds: [tamsin!.id] })
		const rook = await madeGuest(sessionId)
		const potion = { repertoire: "consumables", piece: "potion-of-healing", reason: "the shelf" }
		await turn(
			sessionId,
			ref,
			"We loot the shelf.",
			plan({
				deltas: [
					delta({ owner: ref, op: "add", ...potion }),
					delta({ owner: ref, op: "add", ...potion }),
					delta({ owner: ref, op: "add", ...potion }),
					delta({ owner: rook.ref, op: "add", ...potion })
				]
			})
		)
		expect((await potionsOf(sessionId, ann)).count).toBe(3)
		expect((await potionsOf(sessionId, rook.owner)).count).toBe(1)

		// The session's owner gives two of three to Rook, who holds one: given at once, merged — never "in it twice".
		const direct = await give(ownerId, sessionId, ann, rook.owner, (await potionsOf(sessionId, ann)).at, 2)
		expect(direct?.error, direct?.error).toBeUndefined()
		expect(direct.given).toBe("direct")
		expect((await potionsOf(sessionId, ann)).count).toBe(1)
		expect((await potionsOf(sessionId, rook.owner)).count).toBe(3)
		expect(await tableRows(sessionId)).toContain("Ann the Bold gives Potion of healing ×2 to Rook.")

		// A guest gives from their own sheet only while Honour mode is on; to the host's seat it is an OFFER.
		await db.update(schema.sessions).set({ genreFields: { honorMode: true } } as any).where(eq(schema.sessions.id, sessionId))
		const offered = await give(guestId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at)
		expect(offered?.error, offered?.error).toBeUndefined()
		expect(offered.given).toBe("offered")
		expect((await potionsOf(sessionId, rook.owner)).count).toBe(3)
		expect((await tableRows(sessionId)).some((t) => t === "Rook offers Potion of healing to Ann the Bold.")).toBe(true)
		const [offer] = await openOffers(sessionId)
		expect(offer).toBeTruthy()
		// Accepted by the receiver: one moves, merged.
		expect((await decide(ownerId, offer!.id, true))?.status).toBe("accepted")
		expect((await potionsOf(sessionId, rook.owner)).count).toBe(2)
		expect((await potionsOf(sessionId, ann)).count).toBe(2)
		expect((await tableRows(sessionId)).some((t) => t === "Ann the Bold accepts Potion of healing from Rook.")).toBe(true)

		// Withdrawn by the giver, declined by the receiver: nothing moves, and the table says which.
		await give(guestId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at, 2)
		const [again] = await openOffers(sessionId)
		expect((await decide(guestId, again!.id, false))?.status).toBe("rejected")
		await give(guestId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at)
		const [third] = await openOffers(sessionId)
		expect((await decide(ownerId, third!.id, false))?.status).toBe("rejected")
		expect((await potionsOf(sessionId, rook.owner)).count).toBe(2)
		expect((await potionsOf(sessionId, ann)).count).toBe(2)
		const table = await tableRows(sessionId)
		expect(table).toContain("Rook takes back the offer of Potion of healing ×2.")
		expect(table).toContain("Ann the Bold turns down Potion of healing from Rook.")
		expect(await openOffers(sessionId)).toEqual([])

		// Refusals in words: more than is held; to a companion, who keeps no sheet to give to.
		const tooMany = await give(guestId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at, 5)
		expect(tooMany?.error).toBe("Rook has only 2 Potion of healing.")
		const toCompanion = await give(guestId, sessionId, rook.owner, { kind: "session_cast", id: tamsin!.id }, (await potionsOf(sessionId, rook.owner)).at)
		expect(toCompanion?.error).toBe("Brother Tamsin keeps no sheet you can give to: give it in the story instead.")
		// Nor may a guest give from another's sheet.
		const notTheirs = await give(guestId, sessionId, ann, rook.owner, (await potionsOf(sessionId, ann)).at)
		expect(notTheirs?.error).toMatch(/only Ann the Bold's player or the session's owner/)
		// An offer whose piece is gone by the time it is accepted closes, said so.
		await give(guestId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at, 2)
		const [late] = await openOffers(sessionId)
		await give(ownerId, sessionId, rook.owner, ann, (await potionsOf(sessionId, rook.owner)).at, 2)
		expect((await decide(ownerId, late!.id, true))?.status).toBe("rejected")
		expect((await tableRows(sessionId)).some((t) => t === "Rook no longer has Potion of healing ×2 to give.")).toBe(true)
		expect((await potionsOf(sessionId, ann)).count).toBe(4)
	})
})

describe("Q1-1: history pages per channel (★7)", () => {
	it("the first page holds 25 Story lines however busy the other channels are; the Story's older page follows on its own", async () => {
		const { sessionId } = await madeTable("walk2-pages")
		const add = (channel: string, content: string, extra: Record<string, unknown> = {}) =>
			db.insert(schema.sessionMessages).values({ sessionId, userId: ownerId, role: "user", content, channel, ...extra } as any)
		for (let i = 0; i < 40; i++) {
			await add("main", `story ${i}`)
			await add("table", `dice ${i}`)
			await add("parley", `talk ${i}`)
		}
		const { sessionsGetHandler } = await import("./sessions")
		const first: any = await sessionsGetHandler.handler(fakeSocket(ownerId), { id: sessionId } as any, emit)
		const rows = first.session.sessionMessages as any[]
		const story = rows.filter((r) => r.channel === "main")
		expect(story).toHaveLength(25)
		expect(story.map((r) => r.content)).toContain("story 39")
		expect(story.map((r) => r.content)).not.toContain("story 14")
		expect(first.pagination.olderIn).toEqual(expect.arrayContaining(["main", "table", "parley"]))
		expect(first.pagination.hasMore).toBe(true)
		// The Story's own older page: before its oldest line in the window, the Story's lines alone.
		const oldest = Math.min(...story.map((r) => r.id))
		const { sessionsMessagesPageHandler } = await import("./sessions")
		const older: any = await sessionsMessagesPageHandler.handler(
			fakeSocket(ownerId),
			{ sessionId, channel: "main:1", beforeId: oldest, limit: 25 } as any,
			emit
		)
		expect(older.rows.every((r: any) => r.channel === "main")).toBe(true)
		expect(older.rows.map((r: any) => r.content)).toContain("story 14")
	})
})

describe("Q1-2: a branch keeps speakers, lanes and progress (★5)", () => {
	it("authors, the lane register, the progress document, layouts and timestamps come along; a retired seat's lines keep its name", async () => {
		const [maren] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Maren Holt", description: "A soldier, fallen." } as any)
			.returning()
		const { sessionId, ref } = await madeTable("walk2-branch")
		const rook = await madeGuest(sessionId)
		await turn(sessionId, ref, "I light the lantern.")
		await send(guestId, sessionId, "I follow the light.")
		// A seat that retired (a new character after a death), and its line.
		const [fallen] = await db
			.insert(schema.sessionPersonas)
			.values({ sessionId, personaId: maren!.id, userId: ownerId, position: 9, removedAt: new Date() } as any)
			.returning()
		await db.insert(schema.sessionMessages).values({ sessionId, userId: ownerId, role: "user", personaId: maren!.id, content: "For the drowned king!", channel: "main" } as any)
		// The owner's layout of the session: the Story tab open.
		await db.insert(schema.sessionPanelLayouts).values({ sessionId, userId: ownerId, layout: { panels: { open: "messages" } } } as any)
		const source = await rowsOf(sessionId)
		const last = source.filter((r) => r.channel === "main").at(-1)!
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(db as any, { sessionId, fromMessageId: last.id, title: "walk2-branch · branch 2" })
		const copied = await rowsOf(branch.id)
		const seats = await db.select().from(schema.sessionPersonas).where(eq(schema.sessionPersonas.sessionId, branch.id))
		// Every player line names a seat of the branch — the guest's and the owner's — and keeps its time.
		for (const row of copied.filter((r) => r.role === "user" && r.channel === "main")) {
			const original = source.find((o) => o.id === (row.metadata as any)?.copyOf)!
			expect(new Date(row.createdAt as any).getTime()).toBe(new Date(original.createdAt as any).getTime())
			const speaker = (row.metadata as any)?.speaker
			if (row.personaId) expect(seats.some((s) => s.personaId === row.personaId)).toBe(true)
			else expect(seats.some((s) => `player-seat:${s.id}` === speaker && !s.removedAt)).toBe(true)
		}
		// The retired seat came across retired, so its line is still Maren's.
		const retired = seats.find((s) => s.personaId === maren!.id)!
		expect(retired.removedAt).not.toBeNull()
		expect(fallen.id).not.toBe(retired.id)
		const { messageSpeaker } = await import("$lib/client/utils/messageSpeaker")
		const marenLine = copied.find((r) => r.content === "For the drowned king!")!
		const view = { sessionPersonas: seats.map((s) => ({ ...s, persona: s.personaId === maren!.id ? (maren as any) : null })) }
		expect(messageSpeaker(view as any, marenLine as any)?.name).toBe("Maren Holt")
		// The lanes' register, so each person's Planner lane is theirs in the branch too.
		const lanes = await db.select().from(schema.channelLanes).where(eq(schema.channelLanes.sessionId, branch.id))
		expect(lanes.map((l) => [l.slug, l.lane, l.userId]).sort()).toEqual(
			expect.arrayContaining([["parley", 1, ownerId], ["parley", 2, guestId]])
		)
		const { sessionsGetHandler } = await import("./sessions")
		const asOwner: any = await sessionsGetHandler.handler(fakeSocket(ownerId), { id: branch.id } as any, emit)
		expect((asOwner.session.sessionMessages as any[]).some((r) => r.channel === "parley")).toBe(true)
		const asGuest: any = await sessionsGetHandler.handler(fakeSocket(guestId), { id: branch.id } as any, emit)
		expect((asGuest.session.sessionMessages as any[]).some((r) => r.channel === "parley:2")).toBe(true)
		// The crawl's progress: both heroes made, so nobody is interviewed again.
		const progress = (await annexOf(branch.id))["dungeon-crawler-progress"]
		expect(progress?.heroes?.[`user:${ownerId}`]?.name).toBe("Ann the Bold")
		expect(progress?.heroes?.[`user:${guestId}`]?.name).toBe("Rook")
		// The owner's layout, the tab they were on.
		const [layout] = await db
			.select()
			.from(schema.sessionPanelLayouts)
			.where(and(eq(schema.sessionPanelLayouts.sessionId, branch.id), eq(schema.sessionPanelLayouts.userId, ownerId)))
		expect(layout?.layout).toEqual({ panels: { open: "messages" } })
		expect(rook.seat.id).toBeTruthy()
	})
})

describe("Q1-4: no false busy on Regenerate", () => {
	it("a background run settling holds the press a beat; a reply still being written refuses it", async () => {
		const { sessionId, ref } = await madeTable("walk2-busy")
		await turn(sessionId, ref, "I wait by the water.")
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const { sessionsRetakeTurnHandler } = await import("./sessions")
		const retake = () => sessionsRetakeTurnHandler.handler(fakeSocket(ownerId), { sessionId, preview: true } as any, emit) as Promise<any>
		// A child of the turn still settling — no reply, no row being written.
		runRegistry.start({ runId: "walk2-background", userId: ownerId, sessionId, specId: "core:spec/x", kind: "action" })
		setTimeout(() => runRegistry.finish("walk2-background"), 400)
		const waited = await retake()
		expect(waited?.error, waited?.error).toBeUndefined()
		expect(waited.preview).toBe(true)
		// A reply really running: refused, as ever.
		runRegistry.start({ runId: "walk2-reply", userId: ownerId, sessionId, specId: "core:spec/x", kind: "reply" })
		try {
			const refused = await retake()
			expect(refused?.error).toBe("wait for the reply to finish")
		} finally {
			runRegistry.finish("walk2-reply")
		}
	})
})

describe("Q1-5: the journal tells death saves truly", () => {
	it("while the saves run the journal says they lie dying, with the tally — never that they came back", async () => {
		const { sessionId, ref, owner } = await madeTable("walk2-saves", { settings: { dying: "death-saves" } })
		const hp = String(await value(sessionId, owner, "core:slot/hp@1"))
		const journal = async () => (await rowsOf(sessionId)).filter((r) => r.channel === "travelogue").map((r) => r.content)
		await turn(sessionId, ref, "I fall into the pit.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: hp, reason: "the pit" })] }))
		let rounds = 0
		for (;;) {
			const door = (await tableRows(sessionId)).flatMap((r) => r.split("\n")).filter((l) => l.includes("death's door")).at(-1) ?? ""
			const lines = (await journal()).flatMap((l) => String(l).split("\n"))
			// The newest word on death's door (a time line may follow it).
			const said = lines.filter((l) => /lies dying|came back from death's door|fell\.$/.test(l)).at(-1)
			const fate = await value(sessionId, owner, "core:slot/fate@1")
			const tally = await value(sessionId, owner, "core:slot/crawl-death-saves@1")
			if (/still dying/.test(door)) {
				expect(said).toMatch(/^Ann the Bold lies dying \(\d+ pass(es)?, \d+ failures?\)\.$/)
				expect(lines.some((l) => /came back from death's door/.test(l))).toBe(false)
				// 🚧 The sheet says it (Q3-8, N15): Fate is Dying, the tally in words beside it.
				expect(fate).toBe("dying")
				expect(String(tally)).toMatch(/^\d+ pass(es)?, \d+ failures?$/)
				await turn(sessionId, ref, "I hold on.")
				expect(++rounds).toBeLessThan(6)
				continue
			}
			if (/stable|back up/.test(door)) expect(said).toBe("Ann the Bold came back from death's door.")
			if (/dead/.test(door)) expect(said).toBe("Ann the Bold fell.")
			expect(fate).not.toBe("dying")
			expect(tally ?? "").toBe("")
			break
		}
	})
})

describe("Q1-6: spell points, one row", () => {
	it("the seat's own most bounds the pool (4/4 for a cleric), no second row, and the talk's crib says so", async () => {
		const { sessionId } = await madeTable("walk2-points", { cls: "cleric", settings: { casting: "points" } })
		const { stateGet } = await import("./state")
		const got: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		const seat = got.owners.find((o: any) => o.kind === "player_seat")
		expect(seat.configs["core:slot/itineris-spell-points@1"].max).toBe(4)
		expect((seat.derived ?? []).map((d: any) => d.key)).not.toContain("spell-points-max")
		expect((seat.derived ?? []).map((d: any) => d.key)).toContain("armour-class")
		const from = compiled.length
		expect((await send(ownerId, sessionId, "How many spell points do I have?", "parley"))?.error).toBeUndefined()
		const talk = JSON.stringify(promptsWith("You are talking with one player", from)[0])
		expect(talk).toContain("spell points 4 of 4 left")
		expect(talk).not.toContain("of 99")
	})
})

describe("Q2-1 / Q2-2: locks use the picker; ways out by name", () => {
	it("the crib names each way out and how it stands; a traverse rolls for the seat whose line names the door, at the door's own difficulty", async () => {
		const { sessionId, ref } = await madeTable("walk2-lock")
		// The gate's ways, as a turn's rooms write them on a place the book holds.
		const room = {
			id: "gate",
			name: "The Sunken Gate",
			description: "Wet stone.",
			exits: [
				{ to: "The Hall", way: "door", state: "open", lockDc: 0, trap: "", trapDc: 0, minutes: 0 },
				{ to: "The Vault", way: "door", state: "locked", lockDc: 15, trap: "poison needle", trapDc: 12, minutes: 0 }
			]
		}
		await turn(sessionId, ref, "I look at the doors.", plan({ world: { rooms: [room], npcs: [], leads: [], goalProgress: "none", notes: "" } }))
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I pick the lock on the Door to The Vault.",
			plan({ deltas: [delta({ owner: "The Sunken Gate", op: "traverse", piece: "Door to The Vault", check: "skill.sleight-of-hand", against: 3, reason: "picks" })] })
		)
		const books = JSON.stringify(promptsWith(BOOKS, from)[0])
		expect(books).toMatch(/Ways out: [^"]*Door to The Vault \(locked; trapped: poison needle\)/)
		const line = (await tableRows(sessionId)).at(-1) ?? ""
		// Rolled with Ann's hands, against the door's 15 — never the place's, never the Planner's 3.
		expect(line).toMatch(/Ann the Bold — traverse Door to The Vault \(Sleight of hand[^)]*\): [^\n]*vs 15/)
		expect(line).not.toMatch(/Crossing a locked way takes a check/)
	})
})

describe("Q2-3: the Story ruleset keeps no numbers (★3)", () => {
	it("the sheet keeps no health, level or spell slots; the crib says no health at all; a condition is words; the Planner's shape has no difficulties", async () => {
		const { sessionId, ref, owner } = await madeTable("walk2-story", { cls: "cleric", ruleset: "core:ruleset/freeform@1", rigour: "prose" })
		const { stateGet } = await import("./state")
		const got: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		expect(got.wordsOnly).toBe(true)
		// 🚧 RF fix 8: Freeform keeps no health — attributes are the rules', never the genre's — so the sheet holds none.
		expect(got.slots.some((d: any) => d.slotId === "core:slot/hp@1")).toBe(false)
		expect(got.slots.some((d: any) => d.slotId === "core:slot/crawl-spell-slots@1")).toBe(false)
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I drink from the well and it sickens me.",
			plan({ deltas: [delta({ owner: ref, op: "add", repertoire: "conditions", piece: "Poisoned", reason: "foul water" })] })
		)
		const conditions = ((await value(sessionId, owner, "core:slot/crawl-conditions@1")) as any[]) ?? []
		// A table of words keeps it as words — 🚧 S4 (lane G3, 2026-10-23): Freeform keeps no conditions of its
		// own, so the name alone, never another ruleset's rule for it.
		const said = conditions.map((c) => (typeof c === "string" ? c : String(c?.name ?? "")))
		expect(said.some((c) => c.startsWith("Poisoned"))).toBe(true)
		expect(JSON.stringify(conditions)).not.toMatch(/attacks and checks/)
		const books = String(lastTurnOf(promptsWith(BOOKS, from)[0])?.content)
		// 🚧 RF fix 8: Freeform keeps neither health nor class, so the crib names the hero and where they
		// stand — no health words, no number, no class (they were the genre's, never these rules').
		expect(books).toMatch(/- Ann the Bold \(player-seat:\d+, at The Sunken Gate\)/)
		expect(books).not.toMatch(/unhurt|badly hurt|health \d+\/\d+|level \d|Cleric/)
		// The Planner was asked in the words branch: its node, never the counted one.
		const runs = await db.select({ receipt: schema.pipelineRuns.receipt }).from(schema.pipelineRuns).where(eq(schema.pipelineRuns.sessionId, sessionId))
		const receipts = runs.map((r) => JSON.stringify(r.receipt ?? {}))
		expect(receipts.some((r) => r.includes("channel.story.plan.words.planWrite"))).toBe(true)
		expect(receipts.some((r) => r.includes("channel.story.plan.fresh.planWrite"))).toBe(false)
	})
})

describe("Q2-4: the talk's crib says the rules' options", () => {
	it("death saves and spell points are named, so a rules question has an answer", async () => {
		const { sessionId } = await madeTable("walk2-rules", { settings: { dying: "death-saves", casting: "points" } })
		const from = compiled.length
		expect((await send(ownerId, sessionId, "What happens if I drop to zero?", "parley"))?.error).toBeUndefined()
		const talk = JSON.stringify(promptsWith("You are talking with one player", from)[0])
		expect(talk).toContain("at zero health: death saves")
		expect(talk).toContain("spells: spell points")
	})
})

describe("Q3-5: the faces strip's heroes and the people met", () => {
	it("state:get lists the people the story met (its own notes' people) and marks the hero a player seat", async () => {
		const { sessionId, ref } = await madeTable("walk2-faces")
		const { stateGet } = await import("./state")
		// 🚧 Met once the story names them (PLAN-dc-after-walk3 R3-3): the world's people are not met at its building.
		const before: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		expect((before.metPeople ?? []).map((p: any) => p.name)).not.toContain("Moss")
		narratorSays = "Moss poles his punt out of the mist."
		try {
			await turn(sessionId, ref, "I hail the ferryman.")
		} finally {
			narratorSays = NARRATION
		}
		const got: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		expect((got.metPeople ?? []).map((p: any) => p.name)).toContain("Moss")
		const hero = got.owners.find((o: any) => o.kind === "player_seat" || o.seat === true)
		expect(hero?.seat).toBe(true)
	})
})
