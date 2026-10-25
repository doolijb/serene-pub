/**
 * 🚧 Dungeon Crawler after the 100-turn walk (PLAN-dc-after-walk100-2026-10-18,
 * lane A) — over the REAL create, form, send, Continue and action roads,
 * against the SHIPPED documents, a fake model on a **chat-wire** connection
 * (an OpenAI-compatible endpoint, the walk's):
 *
 *  - P0-1: every DC call ends on a user turn — the Narrator's outcomes and
 *    reminder, and a round nobody spoke in;
 *  - P0-2: a guest's lane is theirs (`channels[].mine`), and a guest with no
 *    seat yet is never named as the host;
 *  - P0-4: the guest's greeting says where the world stands; the host's sheet
 *    is filed on the host's own lane, never under the guest's greeting;
 *  - P0-5: a named seat still being made is neither waited for nor in it;
 *  - P1-1/P1-2/P1-8: an overkill blow reaches death's door; a refused change
 *    and a spell at no slot are table lines in words the Narrator hears;
 *  - P1-3/P3-5: the Planner's talk carries the sheet, the reference and the
 *    answers the player pressed, as their lines;
 *  - P1-5: an empty plan is asked again, then the Narrator goes on alone;
 *  - P1-6/P1-7: a failed reply takes back what it changed; a stopped empty
 *    reply reaches no prompt;
 *  - P3-1: a new character after a death is a new seat, the fallen's lines
 *    keep its name;
 *  - P3-3: the goal reached is told on every lane; End closes it at once.
 *
 * Lane B (P2, owner rulings ★4, ★7, ★10):
 *
 *  - P2-1: the handler executes what a piece does — a potion drunk heals and
 *    is gone, a weapon's hit rolls its damage on the target named;
 *  - P2-3: armour class in the Planner's sheet and the talk's sheet line;
 *  - P2-4: a spell-points table fills the pool, spends a spell's level and
 *    refills on Rest; Death saves roll at zero health instead of one roll;
 *  - P2-6: under the Story ruleset the kit is kept in words, a bought potion
 *    and a poison land, and the books prompt names no Vis Itineris word.
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-walk100-test-secret" }
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-walk100-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-w100-owner")).id
	guestId = (await createTestUser(db, "dc-w100-guest")).id

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
			name: "Dungeon Crawler walk100 test sampling",
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

async function createSession(name: string, o: { ruleset?: string; rigour?: string; settings?: Record<string, string> } = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: preset!.id, primaryRuleset: o.ruleset ?? "core:ruleset/vis-itineris@1", rigour: o.rigour ?? "scripts" },
			characterIds: [],
			personaIds: [],
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
	o: { difficulty?: string; cls?: string; ruleset?: string; rigour?: string; settings?: Record<string, string> } = {}
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

/** A line by a person through the real send. */
async function send(userId: number, sessionId: number, content: string, channel = "main") {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		{ sessionId, personaId: null, content, channel } as any,
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

describe("P0-1: every Dungeon Crawler call ends on a user turn (chat wire)", () => {
	it("the Narrator's outcomes and reminder are the last user turn; a round nobody spoke in says so, last", async () => {
		const { sessionId, ref } = await madeTable("walk100-user-turn")
		const from = compiled.length
		await turn(sessionId, ref, "I look around.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: "1", reason: "a scrape" })] }))
		const books = promptsWith(BOOKS, from)
		const narrate = promptsWith(NARRATE, from)
		expect(books).toHaveLength(1)
		expect(narrate).toHaveLength(1)
		expect(lastTurnOf(books[0])?.role).toBe("user")
		expect(lastTurnOf(books[0])?.content).toMatch(/This round:\n- Ann the Bold/)
		expect(lastTurnOf(narrate[0])?.role).toBe("user")
		expect(lastTurnOf(narrate[0])?.content).toMatch(/Outcomes this round:[^]*Remember: tell what the brief/)
		// Continue: nobody spoke — the round's own turn says what to resolve.
		const again = compiled.length
		expect((await fireContinue(sessionId))?.error).toBeUndefined()
		const quiet = promptsWith(BOOKS, again)
		expect(quiet).toHaveLength(1)
		expect(lastTurnOf(quiet[0])?.role).toBe("user")
		expect(lastTurnOf(quiet[0])?.content).toMatch(/Nobody new declared this round: resolve it from each character's standing order\./)
		for (const p of compiled.slice(from)) expect(lastTurnOf(p)?.role, JSON.stringify(p).slice(0, 200)).toBe("user")
	})
})

describe("P0-2 / P0-4: a guest's lane, and what reaches it", () => {
	it("greeted with where the world stands; the host's sheet is filed on the host's lane; the guest's lane is theirs and their lines theirs", async () => {
		const sessionId = await createSession("walk100-guest")
		await addGuest(sessionId)
		const guestLane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2")
		expect(guestLane[0]?.content).toMatch(/The session's owner chooses the world/)
		// The host's Just play: their sheet's changes are filed at their own summary — never at the guest's greeting.
		sheetAnswer = { ...SHEET, name: "Juniper", shape: "dungeon", difficulty: "fair", goalMode: "shared" }
		try {
			expect((await press(ownerId, sessionId, "parley", { choice: "just-play" })).error).toBeUndefined()
			await settle()
		} finally {
			sheetAnswer = SHEET
		}
		const seat = (await seatOf(sessionId, ownerId))!
		const filedAt = await db
			.select({ messageId: schema.attributeValues.validFromMessageId })
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.ownerKind, "player_seat"), eq(schema.attributeValues.ownerId, seat.id)))
		const rowIds = new Set(filedAt.map((r) => r.messageId))
		const channelOf = new Map((await rowsOf(sessionId)).map((r) => [r.id, r.channel]))
		expect(rowIds.size).toBeGreaterThan(0)
		for (const id of rowIds) expect(channelOf.get(id as number), `row ${id}`).toBe("parley")
		// 🚧 Just play with no class from the model: the table picks one, and the kit comes with it (P3-7).
		expect(await value(sessionId, { kind: "player_seat", id: seat.id }, "core:slot/character-class@1")).toBeTruthy()
		const weapons = await value(sessionId, { kind: "player_seat", id: seat.id }, "core:slot/crawl-weapons@1")
		expect(Array.isArray(weapons) && weapons.length).toBeTruthy()
		// The guest's view of the session names their own lane.
		const { sessionsGetHandler } = await import("./sessions")
		const view: any = await sessionsGetHandler.handler(fakeSocket(guestId), { id: sessionId } as any, emit)
		expect(view.session.channels.find((c: any) => c.slug === "parley")).toMatchObject({ lanes: "personal", mine: "parley:2" })
		// The guest, with no seat yet, talks to the Planner: their line is theirs, never the host's character's.
		const from = compiled.length
		expect((await send(guestId, sessionId, "Hi! How do I join in?", "parley"))?.error).toBeUndefined()
		const talk = promptsWith("You are talking with one player", from)
		expect(talk.length).toBeGreaterThan(0)
		const said = (talk[0].messages as any[]).find((m) => String(m.content).includes("How do I join in"))
		expect(said.role).toBe("user")
		const hostName = (await seatOf(sessionId, ownerId))!.seatName
		expect(String(said.content).startsWith(`${hostName}:`)).toBe(false)
	})
})

describe("P0-5: a named seat still being made", () => {
	it("is neither waited for nor in the round", async () => {
		const { sessionId, ref } = await madeTable("walk100-unmade")
		await addGuest(sessionId)
		expect((await press(guestId, sessionId, "parley:2", { choice: "make-character" })).error).toBeUndefined()
		expect((await press(guestId, sessionId, "parley:2", { name: "Rook" })).error).toBeUndefined()
		const before = await respondRuns(sessionId)
		const from = compiled.length
		// Ann's line alone fires the round — through the real send, the turn order deciding.
		await send(ownerId, sessionId, "I scout ahead.")
		expect(await respondRuns(sessionId)).toBe(before + 1)
		const books = promptsWith(BOOKS, from)[0]
		const brief = String(lastTurnOf(books)?.content)
		expect(brief).toMatch(/Still making their character, not in the story yet: Rook\./)
		const rook = (await seatOf(sessionId, guestId))!
		expect(brief).not.toMatch(new RegExp(`player-seat:${rook.id}`))
		expect(JSON.stringify(compiled.slice(from))).toContain(ref)
	})
})

describe("P1-1 / P1-2 / P1-8: what the turn could not do is said, in words, to the table and the Narrator", () => {
	it("an overkill blow reaches death's door; a weapon not carried and a spell at no slot are table lines, and the Narrator hears they did not happen", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-refusals", { cls: "cleric" })
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I swing my longsword and cast twice.",
			plan({
				deltas: [
					delta({ owner: "Ann the Bold", op: "hit", piece: "greataxe", check: "attack.melee", against: 12, reason: "swings" }),
					delta({ owner: ref, op: "spend", repertoire: "spell-slots", piece: "1", reason: "Bless" }),
					delta({ owner: ref, op: "spend", repertoire: "spell-slots", piece: "1", reason: "Cure wounds" }),
					delta({ owner: ref, op: "spend", repertoire: "spell-slots", piece: "1", reason: "Guiding bolt" }),
					delta({ owner: ref, op: "spend", slot: "hp", value: "99", reason: "the ogre" }),
				],
			}),
		)
		const table = (await tableRows(sessionId)).join("\n")
		expect(table).toMatch(/Not changed: Ann the Bold doesn't carry a greataxe\./)
		expect(table).toMatch(/Not changed: Ann the Bold has no first-level slot left: the spell fails \(Guiding bolt\)\./)
		// The overkill is brought to what was left: death's door rolled.
		expect(table).toMatch(/☠ Ann the Bold at death's door/)
		expect(table).not.toMatch(/unknown-|not-enough/)
		const narrate = promptsWith(NARRATE, from)[0]
		expect(String(lastTurnOf(narrate)?.content)).toMatch(/These did NOT happen[^]*no first-level slot left: the spell fails \(Guiding bolt\)/)
		expect(await value(sessionId, owner, "core:slot/hp@1")).toBeLessThanOrEqual(1)
	})
})

describe("P1-3 / P3-5: the Planner's talk", () => {
	it("knows the sheet and the reference, and reads the answers the player pressed as their lines", async () => {
		const { sessionId, ref } = await madeTable("walk100-talk")
		const from = compiled.length
		expect((await send(ownerId, sessionId, "How much health do I have left?", "parley"))?.error).toBeUndefined()
		const talk = promptsWith("You are talking with one player", from)[0]
		const text = JSON.stringify(talk)
		expect(text).toMatch(new RegExp(`Their character's sheet: Ann the Bold \\(${ref}, Ranger, level 1, health \\d+/\\d+`))
		expect(text).toMatch(/This table: plays Vis Itineris/)
		const lines = talk.messages as Array<{ role: string; content: string }>
		const answers = lines.filter((m) => m.role === "user").map((m) => m.content)
		expect(answers.some((a) => /A dungeon\./.test(a))).toBe(true)
		expect(answers.some((a) => /Name: Ann the Bold\./.test(a))).toBe(true)
		const edits = promptsWith("Now note what they asked for", from)[0]
		expect(JSON.stringify(edits)).toContain(`Their own character's reference — a change's owner — is ${ref}`)
	})
})

describe("P1-5: an empty plan", () => {
	it("is asked once more, then the Narrator goes on alone — the turn is told, never failed", async () => {
		const { sessionId, ref } = await madeTable("walk100-empty-plan")
		plannerEmpty = 2
		const from = compiled.length
		await turn(sessionId, ref, "I wait.")
		plannerEmpty = 0
		expect(promptsWith(BOOKS, from)).toHaveLength(2)
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(reply.error).toBeNull()
		expect(reply.content).toBe(NARRATION)
		expect(String(lastTurnOf(promptsWith(NARRATE, from)[0])?.content ?? "")).not.toBe("")
		expect(JSON.stringify(promptsWith(NARRATE, from)[0])).toContain("The Planner is silent this round")
	})
})

describe("P1-6 / P1-7: a failed reply and a stopped one", () => {
	it("a failed reply takes back the clock it moved; an empty stopped reply reaches no prompt", async () => {
		const { sessionId, ref } = await madeTable("walk100-failed")
		const clock = await value(sessionId, { kind: "session", id: sessionId } as any, "core:slot/crawl-time@1")
		narratorSays = ""
		try {
			await db.insert(schema.sessionMessages).values({ sessionId, userId: ownerId, role: "user", content: "I climb.", channel: "main", metadata: { speaker: ref } } as any)
			planQueue.push(plan({ clock: { minutes: 30 } }))
			const { sessionsFireTurnHandler } = await import("./sessions")
			await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
			await settle()
		} finally {
			narratorSays = NARRATION
		}
		const failed = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(failed.error).not.toBeNull()
		expect(await value(sessionId, { kind: "session", id: sessionId } as any, "core:slot/crawl-time@1")).toBe(clock)
		// A reply stopped before a word: on the Story, but in no prompt.
		await db.insert(schema.sessionMessages).values({
			sessionId, role: "assistant", content: "", channel: "main", isNarratorResponse: true, generationOutcome: "stopped", metadata: { speaker: "envoy:narrator" }
		} as any)
		const from = compiled.length
		await turn(sessionId, ref, "I try again.")
		const narrate = promptsWith(NARRATE, from)[0]
		expect((narrate.messages as any[]).some((m) => m.role === "assistant" && /^\s*Narrator:\s*$/.test(String(m.content)))).toBe(false)
	})
})

describe("P3-1: a new character after a death", () => {
	it("is a NEW seat; the fallen's seat retires and its lines keep its name", async () => {
		const { sessionId, ref, seat, owner } = await madeTable("walk100-new-seat", { difficulty: "brutal" })
		// Brutal (DC 12): the overkill is brought to what is left, and the door is rolled until it kills.
		let attempts = 0
		while ((await value(sessionId, owner, "core:slot/fate@1")) !== "dead" && attempts++ < 12)
			await turn(sessionId, ref, "I charge the ogre.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: "99", reason: "the ogre" })] }))
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("dead")
		const form = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "new-character")!
		const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
		expect((await fire(ownerId, sessionId, DUNGEON_CRAWLER_INTERVIEW_ACTION, form.messageId, form.block.id, { choice: "new-character" })).error).toBeUndefined()
		const res = await press(ownerId, sessionId, "parley", { name: "Tobin" })
		expect(res.error).toBeUndefined()
		const seats = await db.select().from(schema.sessionPersonas).where(eq(schema.sessionPersonas.sessionId, sessionId))
		const old = seats.find((s) => s.id === seat.id)!
		const fresh = seats.find((s) => s.seatName === "Tobin")!
		expect(old.removedAt).not.toBeNull()
		expect(old.seatName).toBe("Ann the Bold")
		expect(fresh.id).not.toBe(seat.id)
		expect(fresh.removedAt).toBeNull()
		// The fallen's line keeps the fallen's name in the next prompt.
		expect((await press(ownerId, sessionId, "parley", { choice: "ranger" })).error).toBeUndefined()
		expect((await press(ownerId, sessionId, "parley", { choice: "surprise" })).error).toBeUndefined()
		const from = compiled.length
		await turn(sessionId, `player-seat:${fresh.id}`, "I arrive at the cairn.")
		const narrate = JSON.stringify(promptsWith(NARRATE, from)[0])
		expect(narrate).toContain("Ann the Bold: I charge the ogre.")
		expect(narrate).toContain("Tobin: I arrive at the cairn.")
	})
})

describe("P3-3: the goal reached", () => {
	it("is shown and told on every lane; End has the Narrator close it at once", async () => {
		const { sessionId, ref } = await madeTable("walk100-goal")
		await addGuest(sessionId)
		await turn(sessionId, ref, "I lift the crown.", plan({ world: { rooms: [], npcs: [], leads: [], goalProgress: "reached", notes: "" } }))
		const guestLane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2").map((r) => r.content)
		expect(guestLane.some((t) => /^The goal is reached: Find the drowned king\./.test(t))).toBe(true)
		const { DUNGEON_CRAWLER_GOAL_ACTION } = await import("@serene-pub/core-catalog")
		const form = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "goal")!
		const storyBefore = (await rowsOf(sessionId)).filter((r) => r.channel === "main").length
		const from = compiled.length
		const ended = await fire(ownerId, sessionId, DUNGEON_CRAWLER_GOAL_ACTION, form.messageId, form.block.id, { choice: "end" })
		expect(ended.error).toBeUndefined()
		const story = (await rowsOf(sessionId)).filter((r) => r.channel === "main")
		expect(story.length).toBe(storyBefore + 1)
		expect(story.at(-1)!.content).toBe(NARRATION)
		const epilogue = promptsWith(NARRATE, from)[0]
		expect(String(lastTurnOf(epilogue)?.content)).toMatch(/Remember/)
		expect(JSON.stringify(epilogue)).toMatch(/The adventure is over, its goal reached: Find the drowned king\. Give the party a short epilogue/)
	})
})

// ── Lane B: rules (P2) ──────────────────────────────────────────────────────

const SPELL_POINTS = "core:slot/itineris-spell-points@1"
const namesIn = (v: unknown) => ((v as any[] | null) ?? []).map((p) => (typeof p === "string" ? p.split(" — ")[0] : p?.name ?? p?.pieceId))

describe("P2-1 / P2-3: the table executes what a piece does, and the sheet says the armour class", () => {
	it("a potion drunk heals and is gone; a weapon's hit rolls its damage on the foe named; armour class is on both sheets", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-effects")
		await turn(
			sessionId,
			ref,
			"I fall, and I find a potion.",
			plan({
				deltas: [
					delta({ owner: ref, op: "spend", slot: "hp", value: "6", reason: "a fall" }),
					delta({ owner: ref, op: "add", repertoire: "consumables", piece: "potion-of-healing", reason: "found" })
				]
			})
		)
		const hurt = Number(await value(sessionId, owner, "core:slot/hp@1"))
		expect(namesIn(await value(sessionId, owner, "core:slot/crawl-consumables@1"))).toContain("potion-of-healing")
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I drink it and throw my spear at the rat.",
			plan({
				deltas: [
					delta({ owner: ref, op: "use", repertoire: "consumables", piece: "Potion of healing", reason: "drinks" }),
					delta({ owner: ref, op: "hit", repertoire: "weapons", piece: "spear", check: "attack.ranged", against: 0, aimedAt: "the rat", reason: "throws" })
				]
			})
		)
		const table = (await tableRows(sessionId)).join("\n")
		expect(table).toMatch(/Ann the Bold's Potion of healing heals \d+: Health \+\d+/)
		expect(table).toMatch(/Ann the Bold no longer has Potion of healing/)
		expect(table).toMatch(/Ann the Bold's Spear deals \d+ piercing damage to the rat — 1d6 \(\d\)/)
		expect(Number(await value(sessionId, owner, "core:slot/hp@1"))).toBeGreaterThan(hurt)
		expect(namesIn(await value(sessionId, owner, "core:slot/crawl-consumables@1"))).not.toContain("potion-of-healing")
		// The Planner was told the table executes it, and read the armour class (studded leather 12 + Dexterity 3).
		const books = JSON.stringify(promptsWith(BOOKS, from)[0])
		expect(books).toContain("Weapons, draughts and spells do what they say when used")
		expect(books).toContain("Armour class: 15")
		const talkFrom = compiled.length
		expect((await send(ownerId, sessionId, "What is my armour class?", "parley"))?.error).toBeUndefined()
		expect(JSON.stringify(promptsWith("You are talking with one player", talkFrom)[0])).toMatch(/armour class 15/)
	})
})

describe("P2-4: Vis Itineris's options the crawl now honours (owner ruling ★7)", () => {
	it("Casting: spell points — the sheet fills the pool, a cast spends its level, a slot spend is refused in words, Rest refills it", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-points", { cls: "cleric", settings: { casting: "points" } })
		expect(await value(sessionId, owner, SPELL_POINTS)).toBe(4)
		expect(((await value(sessionId, owner, "core:slot/crawl-spell-slots@1")) as any[] | null) ?? []).toEqual([])
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I heal myself, then try again.",
			plan({
				deltas: [
					delta({ owner: ref, op: "spend", repertoire: "spells", piece: "cure-wounds", reason: "Cure wounds" }),
					delta({ owner: ref, op: "spend", repertoire: "spell-slots", piece: "1", reason: "Bless" })
				]
			})
		)
		expect(await value(sessionId, owner, SPELL_POINTS)).toBe(3)
		const table = (await tableRows(sessionId)).join("\n")
		expect(table).toMatch(/Ann the Bold casts Cure wounds: Spell points −1 \(3 left\)/)
		expect(table).toMatch(/Not changed: this table plays spell points, not slots/)
		const books = JSON.stringify(promptsWith(BOOKS, from)[0])
		expect(books).toContain("it costs its level in spell points")
		expect(books).not.toContain("spell-slots")
		// 🚧 One row, bounded by the seat's own most (PLAN-dc-after-walk2 Q1-6): never a second "at most" row.
		expect(books).toContain("Spell points: 4")
		expect(books).not.toContain("Spell points at most")
		// 🚧 S3 (lane G3, 2026-10-23): the rules' Rest (Vis Itineris offers one); the crawl's night follows on
		// its event — the routine After a rest (routines run here only when a test turns them on).
		const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
		setRoutinesEnabled(true)
		const rested = await fire(ownerId, sessionId, "core:spec/rules-action#rest", undefined, undefined, {}).finally(() => setRoutinesEnabled(false))
		expect(rested?.error, rested?.error).toBeUndefined()
		expect(await value(sessionId, owner, SPELL_POINTS)).toBe(4)
	})

	it("At zero health: Death saves — a bare d20 a round, tallied, until stable, dead or back up", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-saves", { settings: { dying: "death-saves" } })
		const hp = String(await value(sessionId, owner, "core:slot/hp@1"))
		await turn(sessionId, ref, "I fall into the pit.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: hp, reason: "the pit" })] }))
		let rounds = 0
		let last = ""
		for (;;) {
			last = (await tableRows(sessionId)).flatMap((r) => r.split("\n")).filter((l) => l.includes("death's door")).at(-1) ?? ""
			expect(last).toMatch(/^☠ Ann the Bold at death's door: death save d20 \d+ vs 10 — (still dying|stable|dead|back up on 1 health)/)
			if (!/still dying/.test(last)) break
			// Still dying: the tally is kept, and the next round rolls again.
			const tally = (await annexOf(sessionId))["dungeon-crawler-progress"].deathSaves?.[ref]
			expect(tally).toMatchObject({ passed: expect.any(Number), failed: expect.any(Number) })
			expect(last).toContain(`(${tally.passed} pass`)
			const from = compiled.length
			await turn(sessionId, ref, "I hold on.")
			expect(JSON.stringify(promptsWith(BOOKS, from)[0])).toContain("dying at death's door")
			expect(++rounds).toBeLessThan(6)
		}
		const fate = await value(sessionId, owner, "core:slot/fate@1")
		if (/stable/.test(last)) expect(fate).toBe("taken-out")
		else if (/dead/.test(last)) expect(fate).toBe("dead")
		else expect(await value(sessionId, owner, "core:slot/hp@1")).toBe(1)
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].deathSaves).toBeUndefined()
	})
})

describe("P2-6: the Story ruleset keeps a sheet with things in words (owner ruling ★10)", () => {
	it("the kit lands as names and words; a bought potion and a poison land; the books prompt names no Vis Itineris word", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-story", { cls: "cleric", ruleset: "core:ruleset/freeform@1", rigour: "prose" })
		// 🚧 S4 (lane G3, 2026-10-23): the kits are the session's rules' class rows — Freeform keeps none,
		// so a character starts with what the interview gave, and nothing of Vis Itineris's lands.
		expect(((await value(sessionId, owner, "core:slot/crawl-weapons@1")) as any[] | null) ?? []).toEqual([])
		expect(((await value(sessionId, owner, "core:slot/crawl-features@1")) as any[] | null) ?? []).toEqual([])
		expect(((await value(sessionId, owner, "core:slot/crawl-spell-slots@1")) as any[] | null) ?? []).toEqual([])
		const from = compiled.length
		await turn(
			sessionId,
			ref,
			"I buy a potion, and the well water sickens me.",
			plan({
				deltas: [
					delta({ owner: ref, op: "add", repertoire: "consumables", piece: "Potion of healing", reason: "bought" }),
					delta({ owner: ref, op: "add", repertoire: "conditions", piece: "Poisoned", reason: "foul water" })
				]
			})
		)
		expect(namesIn(await value(sessionId, owner, "core:slot/crawl-consumables@1"))).toContain("Potion of healing")
		expect(namesIn(await value(sessionId, owner, "core:slot/crawl-conditions@1"))).toContain("Poisoned")
		expect((await tableRows(sessionId)).join("\n")).not.toMatch(/Not changed/)
		const books = JSON.stringify(promptsWith(BOOKS, from)[0])
		expect(books).not.toMatch(/spell-slots|spell slot|attack\.melee|Vis Itineris|Prone, Restrained/)
		expect(books).toContain("add it as a condition in a word or two")
		// 🚧 RF fix 8: Freeform keeps no health — attributes are the rules', never the genre's — so a
		// fall is told in words: no number moves, nobody reaches death's door, the hero stands.
		const tracks = async (slotId: string) => !!(await (await import("$lib/server/state/resolve")).vocabularyFor(db as any, sessionId)).entryFor(slotId)
		expect(await tracks("core:slot/hp@1")).toBe(false)
		await turn(sessionId, ref, "I fall into the pit.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: "20", reason: "the pit" })] }))
		const door = (await tableRows(sessionId)).flatMap((r) => r.split("\n")).filter((l) => l.includes("death's door"))
		expect(door).toEqual([])
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("alive")
	})
})

describe("🚧 S4 (lane G3, 2026-10-23): a crawl under Wherewithal plays by Wherewithal", () => {
	it("no kit, its own checks, no die at death's door, and the crawl's own Rest — the night told without a length", async () => {
		const { sessionId, ref, owner } = await madeTable("walk100-wherewithal", { cls: "ranger", ruleset: "core:ruleset/wherewithal@1", rigour: "scripts" })
		// No class rows in Wherewithal: no starting kit.
		expect(((await value(sessionId, owner, "core:slot/crawl-weapons@1")) as any[] | null) ?? []).toEqual([])
		// The Planner is told the table decides by its rules — no dice (Wherewithal decides by no chance).
		const from = compiled.length
		await turn(sessionId, ref, "I dare the rope bridge.", plan())
		const books = JSON.stringify(promptsWith(BOOKS, from)[0])
		expect(books).toContain("The table decides every check by its rules, never you.")
		expect(books).not.toMatch(/d20|rolls the dice|Vis Itineris|attack\.melee/)
		// 🚧 RF fix 8: Wherewithal keeps no health (its pools are nerve, favour and provisions) — a fall
		// is told in words: no number moves and nobody reaches death's door.
		expect(!!(await (await import("$lib/server/state/resolve")).vocabularyFor(db as any, sessionId)).entryFor("core:slot/hp@1")).toBe(false)
		await turn(sessionId, ref, "The bridge gives way.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: "20", reason: "the fall" })] }))
		const door = (await tableRows(sessionId)).flatMap((r) => r.split("\n")).filter((l) => l.includes("death's door"))
		expect(door).toEqual([])
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("alive")
		// Wherewithal offers no Rest of its own: the crawl's is the one, and the owner's.
		const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
		const venues: any = await listSessionActions(db as any, sessionId, { userId: ownerId })
		const ids = [...venues.composer.primary, ...venues.composer.overflow].map((a: any) => `${a.specSlug}#${a.key}`)
		expect(ids).toContain("core:spec/dungeon-crawler-rest#rest")
		expect(ids.filter((i: string) => i.startsWith("core:spec/rules-action#"))).toEqual([])
		const clock = await value(sessionId, { kind: "session", id: sessionId } as any, "core:slot/crawl-time@1")
		const rested = await fire(ownerId, sessionId, "core:spec/dungeon-crawler-rest#rest", undefined, undefined, {})
		expect(rested?.error, rested?.error).toBeUndefined()
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("alive")
		// Its rests take no set time: the night is told without one, and the clock stays. 🚧 RF fix 8:
		// with no health in Wherewithal's keeping, nobody is said to recover — the rest is told alone.
		expect((await tableRows(sessionId)).at(-1)).toMatch(/^The party rests\.$/)
		expect(await value(sessionId, { kind: "session", id: sessionId } as any, "core:slot/crawl-time@1")).toEqual(clock)
	}, 600_000)
})
