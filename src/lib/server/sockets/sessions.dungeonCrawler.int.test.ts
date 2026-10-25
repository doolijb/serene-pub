/**
 * 🚧 Dungeon Crawler's create lane (PLAN-dungeon-crawler-2026-10-14) — over the
 * REAL create, form and reply roads, against the SHIPPED documents the
 * bootstrap publishes and the scripts it seeds, with a fake adapter standing
 * in for the model.
 *
 * What is pinned:
 *
 *  1. **The tavern.** A new session holds one row: the Planner's greeting on
 *     the owner's lane (`parley`), its first question a form addressed to the
 *     owner; the annex holds the lanes map and the genre's blank keys; the
 *     table's rules are state on the world; no model was called.
 *  2. **The interview, end to end.** The owner answers the world's questions
 *     by pressing; a name names their player seat; the Planner offers classes
 *     (one call); a class lands on the seat; a backstory press makes the sheet
 *     (one call) — the class's starting kit, Vis Itineris's pieces, on the
 *     `player_seat` owner — and, with no world yet, genesis writes the world
 *     to the session's own lorebook (one call) and the Narrator opens
 *     the story on `main` (one streamed call).
 *  3. **A guest's lane.** A member event opens lane 2 for a playing guest,
 *     greeted with their own first question; the world's questions are
 *     refused to them.
 *  4. **The Planner talks.** A line in a lane heads the order on that lane
 *     (the round script, by seed key), and Continue there gives the Planner's
 *     reply on it.
 *  5. **The story turn.** A declared action → the hidden Planner's JSON (one
 *     call) → the Narrator's reply (one call), the roll line on the 🚧
 *     **table** channel anchored to it (PLAN-rulesets §30) → the
 *     sheet changed on the player seat, the journal line on the folio, the
 *     crib entry; then a retake undoes the sheet and the world's books and
 *     takes the turn again.
 *  6. **Context leaks** (owner screenshot 2026-10-15). The Narrator's and the
 *     Planner's echoed `Name:` label is stripped; the roll line is a table
 *     row (the `table` channel) no story read holds; a journal line
 *     near-identical to the previous one is not written.
 *  7. **Every call ends on a user turn** (2026-10-16). Each request the fake
 *     model takes is checked as it arrives (`wireEndProblem`): a chat
 *     completion model answers a request that ends on a system message or on
 *     its own line with nothing. A label-only seed and the post-history
 *     reminder core places after the newest line (depth 0, every genre) are
 *     looked past.
 */

import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-test-secret" }
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
/** Every whole-session push to the members (`sessions:refresh`), its thunk kept. */
const sessionPushes = vi.hoisted(() => [] as Array<{ sessionId: number; build: () => Promise<any> }>)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, data: unknown) => {
		if (event === "sessions:refresh" && typeof data === "function")
			sessionPushes.push({ sessionId, build: data as () => Promise<any> })
	}
}))

const CLASSES = { question: "Which calling?", options: [{ key: "ranger", label: "Ranger" }, { key: "thief", label: "Thief" }] }
const SHEET = {
	name: "", class: "", backstory: "Grew up in the marches.", shape: "", difficulty: "", goalMode: ""
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
const NEW_GOAL = { goal: "Ring the drowned bell.", leads: ["The bell tower leans."], notes: "The bell wakes the king." }
/** One delta as the Planner's grammar writes it: every member, empty for none (`DUNGEON_CRAWLER_DELTA_SCHEMA`). */
const delta = (d: Record<string, unknown>) => ({
	owner: "", op: "add", slot: "", repertoire: "", piece: "", value: "", check: "", against: 0, reason: "",
	...d
})
/**
 * The story turn's Planner: the first answer asks for a check (the ruleset
 * handler rolls it) and wounds Ann by 6 whatever it says; the retake's does
 * nothing. An empty `owner` is the acting seat (`withSeat`).
 */
const TURN_PLANS = [
	{
		deltas: [
			delta({ op: "use", check: "skill.athletics", against: 10, reason: "climb the wall" }),
			delta({ op: "spend", slot: "hp", value: "6", reason: "loose stone" })
		],
		world: {
			rooms: [{ id: "stair", name: "The Drowned Stair", description: "Steps into black water.", exits: ["The Hall"] }],
			npcs: [], leads: ["The stair goes down."], goalProgress: "closer", notes: ""
		},
		clock: { minutes: 30 },
		narratorBrief: "Ann climbs; loose stone bites her hands.",
		roundSummary: "Ann went up the wall.",
		secrets: []
	},
	{
		deltas: [],
		world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
		clock: { minutes: 10 },
		narratorBrief: "Ann looks over the wall.",
		roundSummary: "Ann looked over the wall.",
		secrets: []
	}
]
let turnPlans = 0
/** Point the plans' deltas at the acting seat. */
const withSeat = (ref: string, plans: any[] = TURN_PLANS) => {
	for (const plan of plans) for (const d of plan.deltas) d.owner = ref
}
/** Plans handed out ahead of `TURN_PLANS`, first first (the leaks test). */
const planQueue: any[] = []
/** What the Narrator says instead of `Narrator: ${NARRATION}`, when set. */
let narratorSays: string | null = null
/** What the Planner says in a lane instead of `PLANNER_SAYS`, when set. */
let plannerSays: string | null = null
const NARRATION = "Stone grinds under your fingers as you haul yourself up."
const PLANNER_SAYS = "Dice here are rolled in the open, and the stakes come first."
/** How many class offers to answer with nothing first (the walk's halted name press). */
let classOfferEmpty = 0
/** The story Planner answers with nothing while set. */
let plannerEmpty = false

/** Every call the fake model took: its prompt. */
const calls: string[] = []

/**
 * Why a request does not end on a user turn, or null when it does. Looked
 * past at the end: the post-history reminder — core's, placed after the
 * newest line on every genre (depth 0) — and a label-only seed (`Narrator:`).
 * A completion wire (no `messages`) has no turns to read.
 */
const wireEndProblem = (injected: any): string | null => {
	const turns = (injected?.messages ?? []) as Array<{ role: string; content: unknown }>
	if (!turns.length) return null
	const text = (t: { content: unknown }) => (typeof t.content === "string" ? t.content : JSON.stringify(t.content))
	let i = turns.length - 1
	while (
		i > 0 &&
		((turns[i]!.role === "system" && /^\s*Response reminder:/.test(text(turns[i]!))) ||
			(turns[i]!.role === "assistant" && /^[^:\n]+:\s*$/.test(text(turns[i]!).trim())))
	)
		i--
	if (turns[i]!.role === "user") return null
	return `ends on ${turns[i]!.role}: ${text(turns[0]!).slice(0, 120)} … ${text(turns[i]!).slice(0, 120)}`
}
/** Requests that did not end on a user turn, as they arrived; checked after every test. */
const wireEnds: string[] = []
afterEach(() => {
	const seen = wireEnds.splice(0)
	expect(seen, "every model call ends on a user turn").toEqual([])
})

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
		const problem = wireEndProblem(this.injected)
		if (problem) wireEnds.push(problem)
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes("keep the books out of sight") && plannerEmpty) return onContent("")
				if (prompt.includes("keep the books out of sight"))
					return onContent(
						JSON.stringify(planQueue.length ? planQueue.shift() : TURN_PLANS[Math.min(turnPlans++, TURN_PLANS.length - 1)])
					)
				// The model echoes the prompt's label (owner screenshot
				// 2026-10-15): the row must not keep it.
				if (prompt.includes("What happens this round, from the Planner"))
					return onContent(narratorSays ?? `Narrator: ${NARRATION}`)
				if (prompt.includes("Offer three to five classes"))
					return onContent(classOfferEmpty-- > 0 ? "" : JSON.stringify(CLASSES))
				if (prompt.includes("writing a player's character sheet")) return onContent(JSON.stringify(SHEET))
				if (prompt.includes("you build the world they walk into")) return onContent(JSON.stringify(WORLD))
				if (prompt.includes("keeping one player's character sheet"))
					return onContent(JSON.stringify({ standingOrder: "" }))
				if (prompt.includes("the story is about to begin")) return onContent(OPENING)
				if (prompt.includes("You are talking with one player")) return onContent(plannerSays ?? PLANNER_SAYS)
				if (prompt.includes("The party has reached its goal")) return onContent(JSON.stringify(NEW_GOAL))
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-"))
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

/**
 * A new Dungeon Crawler session, on the genre's recommended ruleset (Vis Itineris)
 * at its default rigour (`scripts`) — what the new-session form sends; `over`
 * picks another (a table that turns dice off: `prose`).
 */
async function createSession(name: string, over: { rigour?: string; primaryRuleset?: string } = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-dungeon-crawler-default"))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: preset!.id, primaryRuleset: "core:ruleset/vis-itineris@1", rigour: "scripts", ...over },
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res.session.id as number
}

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

async function composerStatesOf(sessionId: number) {
	const [row] = await db
		.select({ composerStates: schema.sessions.composerStates })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row!.composerStates
}

/**
 * The session's own lorebook (PLAN-rulesets §26): its entries, of one type
 * when named, oldest first, with the message each is anchored to.
 */
/** A location value as the place's title: a reference to the session's own notes, or words. */
async function placeNamed(sessionId: number, v: unknown): Promise<unknown> {
	const id = (v as { entryId?: unknown } | null)?.entryId
	if (typeof id !== "number") return v
	return (await ownLore(sessionId, "core:entry/location")).find((r) => r.id === id)?.title ?? v
}

async function ownLore(sessionId: number, typeId?: string) {
	const [book] = await db.select({ id: schema.lorebooks.id }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId,
			title: schema.lorebookEntries.title,
			content: schema.lorebookEntries.content,
			sourceMessageId: schema.lorebookEntries.sourceMessageId
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, book.id))
		.orderBy(asc(schema.lorebookEntries.id))
	return typeId ? rows.filter((r) => r.typeId === typeId) : rows
}

/** The ways out between the session's own places, as `from → to` names. */
async function ownWays(sessionId: number) {
	const places = await ownLore(sessionId, "core:entry/location")
	const name = new Map(places.map((p) => [p.id, p.title]))
	const [book] = await db.select({ id: schema.lorebooks.id }).from(schema.lorebooks).where(eq(schema.lorebooks.sessionId, sessionId))
	if (!book) return []
	const links = await db
		.select({ from: schema.narrativeRelationships.fromEntryId, to: schema.narrativeRelationships.toEntryId })
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, book.id))
	return links.map((l) => `${name.get(l.from!)} → ${name.get(l.to!)}`).sort()
}

/** The lane register as `user:<id>` → canonical channel (the retired annex map's shape). */
async function lanesOf(sessionId: number): Promise<Record<string, string>> {
	const { formatChannel } = await import("@serene-pub/sdk")
	const schema = await import("$lib/server/db/schema")
	const { eq } = await import("drizzle-orm")
	const rows = await db.select().from(schema.channelLanes).where(eq(schema.channelLanes.sessionId, sessionId))
	return Object.fromEntries(rows.map((r) => [`user:${r.userId}`, formatChannel({ slug: r.slug, lane: r.lane })]))
}

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

/** The hp slot's configuration in force for an owner — its full health is `.max`. */
async function maxOf(sessionId: number, owner: { kind: string; id: number }) {
	const { configFor } = await import("$lib/server/state/resolve")
	return configFor(db as any, { sessionId, owner: owner as any, slotId: "core:slot/hp@1" } as any)
}

async function value(sessionId: number, owner: { kind: string; id: number }, slotId: string) {
	const { valueOf } = await import("$lib/server/state/resolve")
	return valueOf(db as any, { sessionId, owner: owner as any, slotId } as any)
}

describe("the tavern (create)", () => {
	it("one row: the Planner's greeting on the owner's lane with the world question; the annex and the rules written; no model", async () => {
		calls.length = 0
		const sessionId = await createSession("tavern")
		const rows = await rowsOf(sessionId)
		expect(rows).toHaveLength(1)
		const [greeting] = rows
		expect(greeting!.channel).toBe("parley")
		expect((greeting!.metadata as any)?.speaker).toBe("envoy:planner")
		expect(greeting!.content).toContain("Pull up a stool")
		expect(greeting!.content).not.toContain("{{")
		const form = await openForm(sessionId, "parley")
		expect(form.blocks[0]).toMatchObject({ kind: "choices", addressee: `user:${ownerId}`, referent: "world-shape" })
		expect(form.blocks[0].actions.map((a: any) => a.choice)).toEqual(["dungeon", "open-world", "just-play"])
		const annex = await annexOf(sessionId)
		// Lanes by person on the server (2026-10-17): the register, not an annex map.
		expect(await lanesOf(sessionId)).toEqual({ [`user:${ownerId}`]: "parley" })
		expect(annex["dungeon-crawler-journal"]).toEqual({ goal: "", leads: [] })
		// The round key is gone (AUDIT C7): nothing writes it, so nothing reads it.
		expect(annex["dungeon-crawler-round"]).toBeUndefined()
		const world = { kind: "session", id: sessionId }
		expect(await value(sessionId, world, "core:slot/difficulty@1")).toBe("fair")
		expect(await value(sessionId, world, "core:slot/crawl-time@1")).toBe("1-01-01 08:00")
		// Whether dice count is the session's rigour, never a world field the create writes.
		const [statMode] = await db.select().from(schema.attributeValues).where(and(eq(schema.attributeValues.sessionId, sessionId), eq(schema.attributeValues.slotId, "core:slot/stat-mode@1")))
		expect(statMode).toBeUndefined()
		// 🚧 The owner's Story waits for their character (composer states, 2026-10-15).
		expect(await composerStatesOf(sessionId)).toEqual({
			main: { [`user:${ownerId}`]: { open: false, reason: "Make your character on the Planner tab first." } }
		})
		expect(calls).toHaveLength(0)
	})
})

describe("the interview, end to end", () => {
	it("world, name, class, backstory → the sheet on the seat, the world filed, the story opened", async () => {
		const sessionId = await createSession("interview")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)

		expect((await own({ choice: "dungeon" })).error).toBeUndefined()
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].shape).toBe("dungeon")
		expect((await own({ choice: "brutal" })).error).toBeUndefined()
		// How strict was set at creation (the session's rigour): the interview
		// goes from the difficulty to the goal, never "Story or dice?" (walk 6, 2026-10-17).
		const goalForm = await openForm(sessionId, "parley")
		expect(goalForm.blocks[0]).toMatchObject({ kind: "choices", referent: "goal-mode" })
		expect(JSON.stringify(goalForm)).not.toMatch(/Story or dice|numbers and dice/i)
		expect((await own({ choice: "secret" })).error).toBeUndefined()
		const world = { kind: "session", id: sessionId }
		expect(await value(sessionId, world, "core:slot/difficulty@1")).toBe("brutal")
		expect(await value(sessionId, world, "core:slot/goal-mode@1")).toBe("secret")

		// The name: a form; it names the owner's player seat, and the Planner offers classes.
		calls.length = 0
		const named = await own({ name: "Ann the Bold" })
		expect(named.error, named.error).toBeUndefined()
		const seat = await seatOf(sessionId, ownerId)
		expect(seat?.seatName).toBe("Ann the Bold")
		// The answered form shows only "Answered": the Planner says the name back.
		// …as a table line (2026-10-16): no model wrote it, so nothing reruns it.
		const echo = (await rowsOf(sessionId)).find((r) => r.channel === "parley" && r.content === "Name: Ann the Bold.")
		expect((echo?.metadata as any)?.tableLine).toBe(true)
		// The class offer's request is its last user turn — not a lone system message.
		const offer = promptOf(calls.find((c) => c.includes("Offer three to five classes"))!)
		expect(offer.turns.at(-1)).toMatchObject({ role: "user" })
		expect(offer.turns.at(-1)!.text).toMatch(/^The adventure is a dungeon\.[\s\S]*Offer three to five classes[\s\S]*Remember: one JSON object/)
		expect(offer.turns[0]!.text).not.toContain("Offer three to five classes")
		expect(calls.filter((c) => c.includes("Offer three to five classes"))).toHaveLength(1)
		const classes = await openForm(sessionId, "parley")
		expect(classes.blocks[0]).toMatchObject({ referent: "class", addressee: `user:${ownerId}` })

		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		const seatOwner = { kind: "player_seat", id: seat!.id }
		expect(await value(sessionId, seatOwner, "core:slot/character-class@1")).toBe("Ranger")

		// Surprise me: the sheet, then genesis and the opening — three calls.
		calls.length = 0
		const done = await own({ choice: "surprise" })
		expect(done.error, done.error).toBeUndefined()
		await settle()
		expect(calls).toHaveLength(3)
		// 🚧 The class's starting kit, pieces of the rules (rulesets W3-B): a
		// ranger's longbow and spear from Vis Itineris's compendium by id — no line of
		// words on abilities or inventory.
		const weapons = (await value(sessionId, seatOwner, "core:slot/crawl-weapons@1")) as any[]
		expect(weapons.map((p) => [p.kind, p.compendiumId, p.pieceId])).toEqual([
			["compendium", "core:ruleset/vis-itineris@1", "longbow"],
			["compendium", "core:ruleset/vis-itineris@1", "spear"]
		])
		expect(((await value(sessionId, seatOwner, "core:slot/crawl-features@1")) as any[])[0]).toMatchObject({ kind: "inline", name: "Wilderness wise" })
		expect(await value(sessionId, seatOwner, "core:slot/abilities@1")).toBeFalsy()
		expect(await value(sessionId, seatOwner, "core:slot/inventory@1")).toBeFalsy()
		// Full health is the seat's own hp max — the class's hit die plus its
		// Constitution modifier (a ranger: d10 + 2, 2026-10-17), configured
		// through set-stat-config before the stats — and the seat starts at it.
		// The kit's six ability scores are on the seat: a ranger's Dexterity 16.
		expect(await value(sessionId, seatOwner, "core:slot/itineris-dexterity@1")).toBe(16)
		expect(await value(sessionId, seatOwner, "core:slot/itineris-constitution@1")).toBe(14)
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(12)
		expect((await maxOf(sessionId, seatOwner)).max).toBe(12)
		// Genesis puts the party in the first place, filed at the opening's row
		// — the place itself, a location entry of the session's own notes
		// (PLAN-rulesets §26: the host reads the notes' places too).
		expect(await placeNamed(sessionId, await value(sessionId, seatOwner, "core:slot/location@1"))).toBe("The Sunken Gate")
		const annex = await annexOf(sessionId)
		// 🚧 The world is the session's own lorebook (PLAN-rulesets §26): the
		// places as location entries, linked both ways; the people as character
		// lore; no world document in the annex.
		const places = await ownLore(sessionId, "core:entry/location")
		expect(places.map((p) => [p.title, p.content])).toEqual([
			["The Sunken Gate", "Wet stone and a rusted portcullis."],
			["The Hall", "Pillars in black water."]
		])
		expect(await ownWays(sessionId)).toEqual(["The Hall → The Sunken Gate"])
		expect((await ownLore(sessionId, "core:entry/character-lore")).map((p) => p.title)).toEqual(["Moss"])
		// Every row is anchored to a message, so the timeline can take it back.
		expect(places.every((p) => typeof p.sourceMessageId === "number")).toBe(true)
		expect(annex["dungeon-crawler-world"]).toBeUndefined()
		expect(annex["dungeon-crawler-progress"]).toMatchObject({ built: true, goal: "Find the drowned king." })
		expect(annex["dungeon-crawler-progress"].heroes[`user:${ownerId}`]).toMatchObject({ name: "Ann the Bold", class: "Ranger" })
		expect(annex["dungeon-crawler-journal"]).toEqual({
			goal: "Kept secret by the Planner — ask in the Planner panel.",
			leads: ["A bell rings below."]
		})
		expect(annex["dungeon-crawler-planning-notes"]).toContain("Secret goal: Find the drowned king.")
		const story = (await rowsOf(sessionId)).filter((r) => r.channel === "main")
		expect(story).toHaveLength(1)
		expect(story[0]!.content).toBe(OPENING)
		expect((story[0]!.metadata as any)?.speaker).toBe("envoy:narrator")
		// The Planner's summary on the lane.
		// Solo (§14): the summary asks no standing order, so it opens no form;
		// what comes next is its own line AFTER it.
		// 🚧 …and once the world is built, a pointer to the Story (PLAN-dc-after-walk2 Q3-3).
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley")
		expect(lane.at(-3)!.content).toContain("Here is Ann the Bold, Ranger.")
		expect(lane.at(-3)!.content).not.toContain("Give me a moment")
		expect(lane.at(-2)!.content).toBe("Give me a moment to build the world.")
		expect((lane.at(-2)!.metadata as any)?.tableLine).toBe(true)
		expect((lane.at(-3)!.metadata as any)?.tableLine).toBeUndefined()
		expect(lane.at(-1)!.content).toBe("The story has started: open the Story tab and say what you do.")
		expect((lane.at(-1)!.metadata as any)?.tableLine).toBe(true)
		expect((await openForm(sessionId, "parley")).messageId).not.toBe(lane.at(-3)!.id)
		// 🚧 The applied sheet opened the owner's Story (composer states, 2026-10-15).
		expect(await composerStatesOf(sessionId)).toEqual({})
	})
})

describe("a guest's lane", () => {
	it("a member event opens lane 2 for a playing guest, greeted with their own question; the world's are refused", async () => {
		const sessionId = await createSession("guest")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.memberAdded,
			payload: { sessionId, ref: "envoy:planner", change: "added", cause: { kind: "settings", userId: ownerId } },
			wait: true
		})
		await settle()
		const annex = await annexOf(sessionId)
		expect(await lanesOf(sessionId)).toEqual({ [`user:${ownerId}`]: "parley", [`user:${guestId}`]: "parley:2" })
		// The Planner's greeting first, then the question (round 2 item 4).
		const laneRows = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2")
		// One row: the greeting, then the question as its form (round 2: the
		// guest's lane opened with the question alone).
		expect(laneRows).toHaveLength(1)
		expect((laneRows[0]!.metadata as any)?.speaker).toBe("envoy:planner")
		expect(laneRows[0]!.content).toContain("Welcome to the table.")
		const form = await openForm(sessionId, "parley:2")
		// One first question — make the character, or Just play — so answering it closes Just play.
		expect(form.blocks).toHaveLength(1)
		expect(form.blocks[0]).toMatchObject({ kind: "choices", referent: "just-play", addressee: `user:${guestId}` })
		expect((await press(guestId, sessionId, "parley:2", { choice: "make-character" })).error).toBeUndefined()
		expect((await openForm(sessionId, "parley:2")).blocks[0]).toMatchObject({ kind: "form", referent: "name" })
		// Their name names their own seat.
		sessionPushes.length = 0
		expect((await press(guestId, sessionId, "parley:2", { name: "Bo" })).error).toBeUndefined()
		expect((await seatOf(sessionId, guestId))?.seatName).toBe("Bo")
		// A text answer keeps its words on the mark: "Answered · Bo" (round 2).
		{
			const { blockTreesOf } = await import("$lib/server/messages/blocks")
			const marks: any[] = []
			for (const row of (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2"))
				for (const tree of await blockTreesOf(db as any, row.id))
					for (const b of tree as any[]) if (b.kind === "form" && b.referent === "name") marks.push(b.answered)
			expect(marks.at(-1)).toMatchObject({ value: "Bo" })
		}
		// Every member's page learns the new seat now (round 2): the whole
		// session is pushed, its persona list carrying the seat's name.
		const pushed = sessionPushes.filter((p) => p.sessionId === sessionId)
		expect(pushed.length).toBeGreaterThan(0)
		const payload = await pushed.at(-1)!.build()
		expect(
			payload.session.sessionPersonas.find((p: any) => p.userId === guestId && p.personaId == null)?.seatName
		).toBe("Bo")
		// A rename in Edit Session reaches every member the same way.
		const { sessionsUpdateHandler } = await import("./sessions")
		const seatId = (await seatOf(sessionId, guestId))!.id
		sessionPushes.length = 0
		const renamed: any = await sessionsUpdateHandler.handler(
			fakeSocket(ownerId),
			{ session: { id: sessionId }, playerSeatChanges: [{ playerSeatId: seatId, seatName: "Bo the Quick" }] } as any,
			emit
		)
		expect(renamed?.error, renamed?.error).toBeUndefined()
		const renamePush = sessionPushes.filter((p) => p.sessionId === sessionId).at(-1)
		expect(renamePush).toBeTruthy()
		expect(
			(await renamePush!.build()).session.sessionPersonas.find((p: any) => p.id === seatId)?.seatName
		).toBe("Bo the Quick")
		// The owner's lane is the owner's: the guest cannot answer its form.
		const refused = await press(guestId, sessionId, "parley", { choice: "dungeon" })
		expect(refused.error).toBeTruthy()
	})
})

describe("a guest added by the socket", () => {
	it("a guest's Just play whose sheet comes back nameless asks the name again — never 'the Stranger' (walk 2026-10-17)", async () => {
		const sessionId = await createSession("nameless")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.memberAdded,
			payload: { sessionId, ref: "envoy:planner", change: "added", cause: { kind: "settings", userId: ownerId } },
			wait: true
		})
		await settle()
		// The fake's sheet leaves `name` empty.
		expect(SHEET.name).toBe("")
		const res = await press(guestId, sessionId, "parley:2", { choice: "just-play" })
		expect(res.error, res.error).toBeUndefined()
		await settle()
		expect((await seatOf(sessionId, guestId))?.seatName ?? "").not.toBe("the Stranger")
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2")
		expect(lane.some((r) => /the Stranger/.test(r.content))).toBe(false)
		expect(lane.at(-1)!.content).toMatch(/name/i)
		expect((await openForm(sessionId, "parley:2")).blocks[0]).toMatchObject({ kind: "form", referent: "name", addressee: `user:${guestId}` })
		// Nothing was filed: no kit on a nameless sheet.
		const seat = await seatOf(sessionId, guestId)
		if (seat) expect(await value(sessionId, { kind: "player_seat", id: seat.id }, "core:slot/crawl-weapons@1")).toBeFalsy()
		// The answer names the seat, and the interview carries on.
		expect((await press(guestId, sessionId, "parley:2", { name: "Bo" })).error).toBeUndefined()
		expect((await seatOf(sessionId, guestId))?.seatName).toBe("Bo")
	})

	it("sessions:addGuest emits member-added (lane 2 opens); a named card-less seat sends on Story as player-seat:<id> and the turn is taken on it; removeGuest emits member-removed", async () => {
		const sessionId = await createSession("guest by socket")
		const { sessionsAddGuestHandler, sessionsRemoveGuestHandler, sessionMessagesSendPersonaMessageHandler } =
			await import("./sessions")
		const { sessionEvents } = await import("@serene-pub/sdk")
		const added: any = await sessionsAddGuestHandler.handler(fakeSocket(ownerId), { sessionId, guestUserId: guestId } as any, emit)
		expect(added?.success, added?.error).toBe(true)
		await settle()
		const ledger = async (event: string) =>
			(await db.select().from(schema.sessionChanges).where(eq(schema.sessionChanges.sessionId, sessionId))).filter(
				(r: any) => r.event === event
			)
		expect((await ledger(sessionEvents.memberAdded)).map((r: any) => r.payload?.ref)).toContain(`user:${guestId}`)
		expect(await lanesOf(sessionId)).toMatchObject({ [`user:${guestId}`]: "parley:2" })

		// The guest names their seat (no card) and declares on Story.
		expect((await press(guestId, sessionId, "parley:2", { choice: "make-character" })).error).toBeUndefined()
		expect((await press(guestId, sessionId, "parley:2", { name: "Bo" })).error).toBeUndefined()
		const seat = (await seatOf(sessionId, guestId))!
		expect(seat.personaId).toBeNull()
		// 🚧 A name is not a character: their Story is closed until the sheet,
		// and a send there is refused with what it waits on (2026-10-15).
		const early: any = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(guestId),
			{ sessionId, personaId: null, content: "Too soon.", channel: "main" } as any,
			emit
		)
		expect(early?.refused).toBe("You can't send here yet. Make your character on the Planner tab first. Your text was kept.")
		expect((await rowsOf(sessionId)).some((r) => r.content === "Too soon.")).toBe(false)
		// The sheet opens it (the interview, above); here, the seat's send is the subject.
		const { writeComposerState } = await import("$lib/server/sessions/composerStates")
		await writeComposerState(db as any, sessionId, { channel: "main", open: true, person: `user:${guestId}` })
		// …and stamps the hero made: 🚧 a named seat still being made is not in the round (the 100-turn walk, P0-5).
		await db.execute(
			(await import("drizzle-orm")).sql`update sessions set annex = jsonb_set(annex, ${`{core,dungeon-crawler-progress,heroes,user:${guestId},made}`}::text[], 'true'::jsonb) where id = ${sessionId}`
		)
		const sent: any = await sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(guestId),
			{ sessionId, personaId: null, content: "I leap across the chasm.", channel: "main" } as any,
			emit
		)
		await settle()
		expect(sent?.error, sent?.error).toBeUndefined()
		const line = (await rowsOf(sessionId)).find((r) => r.content === "I leap across the chasm.")!
		expect(line.personaId).toBeNull()
		expect((line.metadata as any)?.speaker).toBe(`player-seat:${seat.id}`)
		// Their declaration is the round's (the only seat): the story turn
		// is taken on it — the Narrator answers on Story.
		const after = (await rowsOf(sessionId)).filter((r) => r.id > line.id && r.channel === "main")
		expect(after.at(-1)?.metadata as any).toMatchObject({ speaker: "envoy:narrator" })

		const removed: any = await sessionsRemoveGuestHandler.handler(fakeSocket(ownerId), { sessionId, guestUserId: guestId } as any, emit)
		expect(removed?.success, removed?.error).toBe(true)
		await settle()
		expect((await ledger(sessionEvents.memberRemoved)).map((r: any) => r.payload?.ref)).toContain(`user:${guestId}`)
	})
})

describe("the Planner talks in a lane", () => {
	it("a line in the lane heads the order there; Continue gives the Planner's reply on it", async () => {
		const sessionId = await createSession("parley")
		const [line] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: ownerId, role: "user", content: "How do dice work here?", channel: "parley" } as any)
			.returning()
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents, readTurnOrder } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.messageDeleted,
			payload: { sessionId, cause: { kind: "edit", userId: ownerId } },
			wait: true
		})
		const [row] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		const order = readTurnOrder(coreAnnexIn(row!.annex)).order
		expect(order).toEqual([expect.objectContaining({ ref: null, channel: "parley" })])

		calls.length = 0
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(
			fakeSocket(ownerId),
			{ sessionId, channel: "parley" } as any,
			emit
		)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		const after = (await rowsOf(sessionId)).filter((r) => r.id > line!.id)
		expect(after).toHaveLength(1)
		expect(after[0]!.channel).toBe("parley")
		expect(after[0]!.content).toBe(PLANNER_SAYS)
		expect((after[0]!.metadata as any)?.speaker).toBe("envoy:planner")
		// One call: the line asks for no change, so no edits call.
		// Two calls per lane line since §13 (2026-10-18): the Planner's talk, then the edits call (asks, deltas).
		expect(calls).toHaveLength(2)
		expect(calls[0]).toContain("How do dice work here?")
	})
})

describe("the story turn", () => {
	it("declared action → Planner JSON → roll line → Narrator reply → sheet changed → journal line; retake undoes the sheet", async () => {
		const sessionId = await createSession("story turn")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		const seatOwner = { kind: "player_seat", id: seat.id }
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(12)
		withSeat(`player-seat:${seat.id}`)

		// The declaration: Ann's line on Story.
		const [declared] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId: ownerId,
				role: "user",
				content: "I climb the wall.",
				channel: "main",
				metadata: { speaker: `player-seat:${seat.id}` }
			} as any)
			.returning()

		calls.length = 0
		turnPlans = 0
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()

		// Two calls: the Planner (it read the declaration), then the Narrator.
		expect(calls).toHaveLength(2)
		expect(calls[0]).toContain("keep the books out of sight")
		expect(calls[0]).toContain("I climb the wall.")
		expect(calls[1]).toContain("Ann climbs; loose stone bites her hands.")
		const after = (await rowsOf(sessionId)).filter((r) => r.id > declared!.id)
		// 🚧 Story holds the Narrator alone (PLAN-rulesets §30): the roll line
		// is the table's, anchored to the Narrator's row, with no speaker.
		const story = [after.find((r) => r.channel === "table")!, ...after.filter((r) => r.channel === "main")]
		expect(after.filter((r) => r.channel === "main")).toHaveLength(1)
		// 🚧 The check the Planner asked for, rolled by the ruleset handler
		// (Vis Itineris), its number explained at the end; then the wound it proposed.
		expect(story[0]!.content).toMatch(/^⚄ Ann the Bold — use \(Athletics\): [^\n]+ — d20 \d+[^\n]* = \d+ vs 10\n⚄ Ann the Bold: Health −6$/)
		expect(story[1]!.content).toBe(NARRATION)
		expect((story[1]!.metadata as any)?.speaker).toBe("envoy:narrator")
		const roll = story[0]!
		expect((roll.metadata as any)?.anchorMessageId).toBe(story[1]!.id)
		expect((roll.metadata as any)?.speaker).toBeUndefined()
		expect((roll.metadata as any)?.tableLine).toBeUndefined()
		expect(roll.characterId).toBeNull()
		// The Narrator read no roll line; it read the outcomes as their own
		// block after the history (§30 amendment), never in the system prompt.
		expect(calls[1]).not.toContain("⚄")
		const told = promptOf(calls[1]!).turns
		const flat = told.map((t) => t.text).join("\n")
		expect(flat.indexOf("Outcomes this round:")).toBeGreaterThan(flat.indexOf("I climb the wall."))
		expect(told[0]!.text).not.toContain("The dice decided")
		expect(told.at(-1)!.text).toMatch(/Outcomes this round:\n[\s\S]*Ann the Bold — use \(Athletics\)/)
		// The Planner read the ruleset's blocks by name, and how this table plays.
		expect(calls[0]).toContain("The table rolls the dice, never you. Propose deltas, never totals")
		// The sheet, the clock, the journal line, the books.
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(6)
		expect(await value(sessionId, { kind: "session", id: sessionId }, "core:slot/crawl-time@1")).toBe("1-01-01 08:30")
		// The round's `did` line (its other kinds — found, met, changed — are their own rows since §16).
		const journal = after.filter((r) => r.channel === "travelogue" && (r.metadata as any)?.kind === "did")
		expect(journal).toHaveLength(1)
		expect(journal[0]!.content).toMatch(/^Ann went up the wall\./)
		// The journal line is anchored to the Narrator's row: a retake takes it.
		expect((journal[0]!.metadata as any)?.anchorMessageId).toBe(story[1]!.id)
		let annex = await annexOf(sessionId)
		// The new place, in the session's own lorebook, anchored to the turn's row, linked to the Hall.
		const stair = (await ownLore(sessionId, "core:entry/location")).find((p) => p.title === "The Drowned Stair")
		expect(stair?.sourceMessageId).toBe(story[1]!.id)
		expect(await ownWays(sessionId)).toContain("The Drowned Stair → The Hall")
		// No snapshot: only the telling a swipe re-tells.
		expect(annex["dungeon-crawler-progress"].lastTurn).toBeUndefined()
		expect(annex["dungeon-crawler-progress"].lastTelling.row).toBe(story[1]!.id)
		expect(annex["dungeon-crawler-world"]).toBeUndefined()
		expect(annex["dungeon-crawler-journal"].leads).toEqual(["The stair goes down."])

		// Retake: the turn's rows go, the sheet comes back, the books are undone, and the turn is taken again.
		calls.length = 0
		const { retakeTurn } = await import("$lib/server/sessions/retakeTurn")
		const retaken = await retakeTurn(db as any, { sessionId, userId: ownerId })
		await settle()
		expect(retaken.error, retaken.error).toBeUndefined()
		expect(calls).toHaveLength(2)
		// Back to full — the seat's own max — and the retaken turn's Planner read it so.
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(12)
		expect(calls[0]).toContain("health 12/12")
		expect(await value(sessionId, { kind: "session", id: sessionId }, "core:slot/crawl-time@1")).toBe("1-01-01 08:10")
		const again = (await rowsOf(sessionId)).filter((r) => r.id > declared!.id)
		expect(again.filter((r) => r.channel === "main").map((r) => r.content)).toEqual([NARRATION])
		// The first turn's table row went with its turn; any new one is the new Narrator row's.
		expect(again.some((r) => r.id === roll.id)).toBe(false)
		const narratorAgain = again.find((r) => r.channel === "main")!
		for (const t of again.filter((r) => r.channel === "table"))
			expect((t.metadata as any)?.anchorMessageId).toBe(narratorAgain.id)
		expect(again.filter((r) => r.channel === "travelogue" && (r.metadata as any)?.kind === "did").map((r) => r.content)).toEqual(["Ann looked over the wall."])
		annex = await annexOf(sessionId)
		// The retaken turn's place went with its row (the timeline's cascade, no snapshot).
		expect((await ownLore(sessionId, "core:entry/location")).map((p) => p.title)).toEqual(["The Sunken Gate", "The Hall"])
		expect(await ownWays(sessionId)).toEqual(["The Hall → The Sunken Gate"])
		// A revision moves the timeline back (§28/§29): the journal's leads
		// return to what they were before the retaken turn.
		expect(annex["dungeon-crawler-journal"].leads).toEqual(["A bell rings below."])

		// 🚧 A table row goes with its anchor on any delete (§30): the store's
		// one delete path takes the rows anchored to the deleted one.
		const [extra] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				role: "assistant",
				content: "⚄ a stray roll",
				channel: "table",
				metadata: { anchorMessageId: narratorAgain.id }
			} as any)
			.returning()
		const { deleteLegacy } = await import("$lib/server/messages/store")
		await deleteLegacy(db as any, narratorAgain.id)
		expect((await rowsOf(sessionId)).some((r) => r.id === extra!.id)).toBe(false)
	})

	it("the seat's full health is its own: 9/12 on the sheet and in the Planner's prompt", async () => {
		const sessionId = await createSession("full health")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		const seatOwner = { kind: "player_seat", id: seat.id }
		// Wounded to 9, as a person's edit would (the same writer a run's set-state takes).
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(db as any, { sessionId, updatedBy: "user" } as any, { owner: seatOwner, slotId: "core:slot/hp@1", value: 9 } as any)

		// The sheet: the Stats widget's read draws the bar to the seat's own max.
		const { stateGet } = await import("./state")
		const got: any = await stateGet.handler(fakeSocket(ownerId), { sessionId } as any, emit as any)
		const row = got.owners.find((o: any) => o.kind === "player_seat" && o.id === seat.id)
		expect(row.configs["core:slot/hp@1"]).toMatchObject({ min: 0, max: 12 })
		expect(got.state.cast.byId[`player_seat:${seat.id}`].hp).toBe(9)
		// `session-state@1` carries the same number, which every script reads.
		expect(got.state.configs[`player_seat:${seat.id}`]["core:slot/hp@1"].max).toBe(12)

		// The prompt: the story turn's Planner reads "health 9/12".
		withSeat(`player-seat:${seat.id}`)
		await db.insert(schema.sessionMessages).values({
			sessionId,
			userId: ownerId,
			role: "user",
			content: "I look around.",
			channel: "main",
			metadata: { speaker: `player-seat:${seat.id}` }
		} as any)
		calls.length = 0
		turnPlans = 1
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		expect(calls[0]).toContain("keep the books out of sight")
		expect(calls[0]).toContain("health 9/12")
	})
})

describe("the ruleset handler's two rigours (rulesets W3-B)", () => {
	/** A made character on a fresh session at `rigour`, and one declared line on Story. */
	async function readyAt(name: string, rigour: string) {
		const sessionId = await createSession(name, { rigour })
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		await db.insert(schema.sessionMessages).values({
			sessionId, userId: ownerId, role: "user", content: "I loose an arrow.", channel: "main",
			metadata: { speaker: `player-seat:${seat.id}` }
		} as any)
		return { sessionId, seat, seatOwner: { kind: "player_seat", id: seat.id }, ref: `player-seat:${seat.id}` }
	}
	const fire = async (sessionId: number) => {
		const { sessionsFireTurnHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
	}
	const brief = (deltas: unknown[]) => ({
		deltas,
		world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
		clock: { minutes: 5 },
		narratorBrief: "Ann shoots.",
		roundSummary: "Ann loosed an arrow.",
		secrets: []
	})

	it("scripts: a check the model asks for is rolled by the handler; a failed check applies nothing", async () => {
		const { sessionId, seatOwner, ref } = await readyAt("failed check", "scripts")
		// Nothing a d20 can reach: it fails, so the longbow's effects never land.
		planQueue.push(brief([delta({ owner: ref, op: "hit", piece: "longbow", check: "attack.ranged", against: 40, reason: "a far shot" })]))
		calls.length = 0
		await fire(sessionId)
		const hpBefore = 12
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(hpBefore)
		const table = (await rowsOf(sessionId)).filter((r) => r.channel === "table")
		expect(table).toHaveLength(1)
		expect(table[0]!.content).toMatch(/^⚄ Ann the Bold — hit Longbow \(Ranged attack\): [^\n]+ — d20 \d+[^\n]* = \d+ vs 40$/)
		expect(table[0]!.content).not.toMatch(/success|Hit\b/)
		// The kit's Dexterity 16 is the attack's +3 (walk 2026-10-17: it read 0).
		expect(table[0]!.content).toMatch(/\+ 3 \(Dexterity modifier\)/)
		// The Planner read the sheet the ruleset rendered: the kit's longbow.
		expect(calls[0]).toContain("Longbow")
		expect(calls[0]).toContain("The table rolls the dice, never you. Propose deltas, never totals")
	})

	it("prose: a table that turns dice off — the Planner proposes words, the handler records them, nothing is rolled", async () => {
		const { sessionId, seatOwner, ref } = await readyAt("prose table", "prose")
		planQueue.push(brief([
			delta({ owner: ref, op: "use", check: "skill.athletics", against: 12, reason: "climb" }),
			delta({ owner: ref, op: "set", slot: "hp", value: "9", reason: "scraped hands" })
		]))
		calls.length = 0
		await fire(sessionId)
		// Recorded as said: set at prose, no check rolled.
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(9)
		const table = (await rowsOf(sessionId)).filter((r) => r.channel === "table")
		// The handler keeps the number out of the words at prose; no roll line, no die.
		expect(table.map((r) => r.content)).toEqual(["Ann the Bold: Health is now changed"])
		expect(calls[0]).toContain("Nothing is rolled at this table")
		// Words only (walk 6, 2026-10-17): no word of dice to the Planner or the Narrator.
		expect(calls[0]).not.toMatch(/\bdice\b|door is rolled|hit, use or traverse|Decide no check/i)
		expect(calls[1]).toContain("This table keeps no numbers: tell every result in words.")
		expect(calls[1]).not.toMatch(/\bdice\b|roll line/i)
	})

	it("prose: a change by an amount still counts — spend 2 of 9 health is 7, told in words (walk 6, 2026-10-17)", async () => {
		const { sessionId, seatOwner, ref } = await readyAt("prose spend", "prose")
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(db as any, { sessionId, updatedBy: "user" } as any, { owner: seatOwner, slotId: "core:slot/hp@1", value: 9 } as any)
		planQueue.push(brief([delta({ owner: ref, op: "spend", slot: "hp", value: "2", reason: "a scraped knee" })]))
		calls.length = 0
		await fire(sessionId)
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(7)
		const table = (await rowsOf(sessionId)).filter((r) => r.channel === "table")
		expect(table.map((r) => r.content)).toEqual(["Ann the Bold: Health falls"])
	})
})

describe("context leaks (owner screenshot 2026-10-15)", () => {
	it("the Narrator's echoed label goes; the roll line is a table line the next Narrator never reads; a repeated journal line is not written; the Planner's label goes in a lane", async () => {
		const sessionId = await createSession("leaks")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		const ref = `player-seat:${seat.id}`
		const plan = (summary: string) => ({
			deltas: [delta({ owner: ref, op: "use", check: "skill.persuasion", against: 5, reason: "speak to the ghost" })],
			world: { rooms: [], npcs: [], leads: [], goalProgress: "none", notes: "" },
			clock: { minutes: 5 },
			narratorBrief: "The ghost answers Ann.",
			roundSummary: summary,
			secrets: []
		})
		// The owner's two journal lines, one round apart (names changed).
		const SEEN_GHOST =
			"Ann encountered the spectral form of Zyloth, who warned of an ancient evil resurging and tasked her with finding the scattered pieces of the Celestial Scepter."
		const { sessionsFireTurnHandler } = await import("./sessions")
		const turn = async (line: string, summary: string) => {
			await db.insert(schema.sessionMessages).values({
				sessionId,
				userId: ownerId,
				role: "user",
				content: line,
				channel: "main",
				metadata: { speaker: ref }
			} as any)
			planQueue.push(plan(summary))
			calls.length = 0
			const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
			await settle()
			expect(res?.error, res?.error).toBeUndefined()
			return [...calls]
		}
		try {
			narratorSays = `Narrator: Narrator: ${NARRATION}`
			const first = await turn("I greet the ghost.", SEEN_GHOST)
			const story = (await rowsOf(sessionId)).filter((r) => r.channel === "main")
			const roll = (await rowsOf(sessionId)).filter((r) => r.channel === "table").at(-1)!
			const told = story.at(-1)!
			// 1. The label — doubled, even — is the prompt's, never the Narrator's words.
			expect(told.content).toBe(NARRATION)
			// 2. The roll line is the table's (🚧 §30): on its own channel,
			// anchored to the Narrator's row, and not in what the Narrator read.
			expect(roll.content).toMatch(/^⚄ Ann the Bold — use \(Persuasion\)/)
			expect((roll.metadata as any)?.anchorMessageId).toBe(told.id)
			expect(first[1]).toContain("The ghost answers Ann.")
			expect(first[1]).not.toContain("⚄")

			narratorSays = null
			const second = await turn("I ask the ghost again.", "Ann spoke with the ghost of Zyloth, who warned of an ancient evil resurging and tasked her with finding the scattered pieces of the Celestial Scepter.")
			// Neither the Planner nor the Narrator reads the earlier roll line.
			expect(second[0]).toContain("keep the books out of sight")
			expect(second[0]).not.toContain("⚄")
			expect(second[1]).not.toContain("⚄")
			expect(second[1]).toContain("I greet the ghost.")
			// 3. The journal: the near-identical second line is not written (the crib reads the folio).
			const journal = (await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && (r.metadata as any)?.kind === "did").map((r) => r.content)
			expect(journal).toEqual([SEEN_GHOST])
			expect(second[0]).toContain(`The story so far, oldest first:\\n- ${SEEN_GHOST}`)
			// A new line is written.
			await turn("I leave the gatehouse.", "Ann left the gatehouse for the drowned hall.")
			expect((await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && (r.metadata as any)?.kind === "did").map((r) => r.content)).toEqual([
				SEEN_GHOST,
				"Ann left the gatehouse for the drowned hall."
			])

			// 4. The Planner's label in a lane goes too.
			plannerSays = `Planner: ${PLANNER_SAYS}`
			await db
				.insert(schema.sessionMessages)
				.values({ sessionId, userId: ownerId, role: "user", content: "How do rests work?", channel: "parley" } as any)
			const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
			const { sessionEvents } = await import("@serene-pub/sdk")
			await emitSessionEvent(db as any, {
				sessionId,
				userId: ownerId,
				event: sessionEvents.messageDeleted,
				payload: { sessionId, cause: { kind: "edit", userId: ownerId } },
				wait: true
			})
			const fired: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId, channel: "parley" } as any, emit)
			await settle()
			expect(fired?.error, fired?.error).toBeUndefined()
			expect((await rowsOf(sessionId)).filter((r) => r.channel === "parley").at(-1)!.content).toBe(PLANNER_SAYS)
		} finally {
			narratorSays = null
			plannerSays = null
			planQueue.length = 0
		}
	})
})

describe("verbs on the Planner's rows (2026-10-15)", () => {
	it("a Planner reply on lane 2: retry and swipe each give a new reply on the lane — one call, answering the guest's line", async () => {
		const sessionId = await createSession("parley-verbs")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.memberAdded,
			payload: { sessionId, ref: "envoy:planner", change: "added", cause: { kind: "settings", userId: ownerId } },
			wait: true
		})
		await settle()
		await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: guestId, role: "user", content: "Can I play a cat?", channel: "parley:2" } as any)
		await emitSessionEvent(db as any, {
			sessionId,
			userId: guestId,
			event: sessionEvents.messageDeleted,
			payload: { sessionId, cause: { kind: "edit", userId: guestId } },
			wait: true
		})
		const { sessionsFireTurnHandler, sessionMessagesRegenerateHandler, sessionMessagesSwipeRightHandler } = await import(
			"./sessions"
		)
		const fired: any = await sessionsFireTurnHandler.handler(fakeSocket(guestId), { sessionId, channel: "parley:2" } as any, emit)
		await settle()
		expect(fired?.error, fired?.error).toBeUndefined()
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2").at(-1)!
		expect((reply.metadata as any)?.speaker).toBe("envoy:planner")
		expect(reply.content).toBe(PLANNER_SAYS)

		// An envoy's row is the session owner's to act on (`canActOnMessage`).
		for (const verb of ["retry", "swipe"] as const) {
			calls.length = 0
			const res: any =
				verb === "retry"
					? await sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
					: await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
			await settle()
			expect(res?.error, `${verb}: ${res?.error}`).toBeUndefined()
			const row = (await rowsOf(sessionId)).find((r) => r.id === reply.id)!
			expect(row.channel).toBe("parley:2")
			expect(row.isGenerating).toBe(false)
			expect(row.error, `${verb}: ${row.error}`).toBeNull()
			expect(row.content).toBe(PLANNER_SAYS)
			expect(calls, verb).toHaveLength(2)
			expect(calls[0]).toContain("You are talking with one player")
			expect(calls[0]).toContain("Can I play a cat?")
		}
	})

	it("the greeting and an interview question are questions, not replies: retry and swipe are refused in a sentence, no model, the form still open", async () => {
		const sessionId = await createSession("question-verbs")
		const { sessionMessagesRegenerateHandler, sessionMessagesSwipeRightHandler } = await import("./sessions")
		const refusedBoth = async (messageId: number) => {
			calls.length = 0
			for (const verb of ["retry", "swipe"] as const) {
				const res: any =
					verb === "retry"
						? await sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: messageId } as any, emit)
						: await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: messageId } as any, emit)
				await settle()
				expect(res?.error, verb).toMatch(/is a question, not a reply/)
			}
			expect(calls).toHaveLength(0)
			const row = (await rowsOf(sessionId)).find((r) => r.id === messageId)!
			expect(row.isGenerating).toBe(false)
			expect(row.error).toBeNull()
			expect((await openForm(sessionId, "parley")).messageId).toBe(messageId)
		}
		// The greeting, its world question open.
		const greeting = (await rowsOf(sessionId)).find((r) => r.channel === "parley")!
		await refusedBoth(greeting.id)
		// An interview question: the next one, after the first answer.
		expect((await press(ownerId, sessionId, "parley", { choice: "dungeon" })).error).toBeUndefined()
		const question = await openForm(sessionId, "parley")
		expect(question.messageId).not.toBe(greeting.id)
		await refusedBoth(question.messageId)
	})
})

/** The prompt the fake model was handed, parsed: its turns, when the wire has them. */
const promptOf = (call: string) => {
	const injected = JSON.parse(call) as { prompt?: string; messages?: Array<{ role: string; content: unknown }> }
	const turns = (injected.messages ?? []).map((m) => ({
		role: m.role,
		text: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
	}))
	return { injected, turns }
}

describe("the Planner reads its own lane (owner screenshot 2026-10-15)", () => {
	it("'Hi!' on lane 2 is the prompt's last user turn; nothing from lane 1; the reply is stored; retry and swipe still carry it", async () => {
		const sessionId = await createSession("parley-lane")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.memberAdded,
			payload: { sessionId, ref: "envoy:planner", change: "added", cause: { kind: "settings", userId: ownerId } },
			wait: true
		})
		await settle()
		// The owner's private talk on lane 1 — never the guest's Planner's to read.
		await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: ownerId, role: "user", content: "OWNER-ONLY: the vault code is 7741.", channel: "parley" } as any)
		const [hi] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: guestId, role: "user", content: "Hi!", channel: "parley:2" } as any)
			.returning()
		// The turn order re-read (a row written straight to the table emits nothing).
		await emitSessionEvent(db as any, {
			sessionId,
			userId: guestId,
			event: sessionEvents.messageDeleted,
			payload: { sessionId, cause: { kind: "edit", userId: guestId } },
			wait: true
		})
		const { sessionsFireTurnHandler, sessionMessagesRegenerateHandler, sessionMessagesSwipeRightHandler } = await import(
			"./sessions"
		)
		const check = (label: string) => {
			expect(calls, label).toHaveLength(2)
			expect(calls[0], label).toContain("You are talking with one player")
			expect(calls[0], label).not.toContain("OWNER-ONLY")
			// The lane's greeting is the Planner's own line, named so — never the Narrator's.
			expect(calls[0], label).toContain("Planner: Welcome to the table.")
			expect(calls[0], label).not.toContain("Narrator: Welcome to the table.")
			const { injected, turns } = promptOf(calls[0]!)
			if (turns.length) {
				// A chat wire: the guest's line is the last user turn, and no
				// assistant turn with text follows it.
				const lastUser = turns.map((t) => t.role).lastIndexOf("user")
				expect(lastUser, `${label}: ${JSON.stringify(turns)}`).toBeGreaterThanOrEqual(0)
				expect(turns[lastUser]!.text, label).toContain("Hi!")
				expect(turns.slice(lastUser + 1).every((t) => t.role !== "user" && !t.text.replace(/^\s*Planner:\s*$/, "").trim()), label).toBe(true)
			} else {
				// A completion wire: "Hi!" is in the transcript after the instructions.
				const prompt = String(injected.prompt ?? "")
				expect(prompt.lastIndexOf("Hi!"), label).toBeGreaterThan(prompt.indexOf("You are talking with one player"))
			}
		}
		calls.length = 0
		const fired: any = await sessionsFireTurnHandler.handler(fakeSocket(guestId), { sessionId, channel: "parley:2" } as any, emit)
		await settle()
		expect(fired?.error, fired?.error).toBeUndefined()
		check("first reply")
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "parley:2").at(-1)!
		expect(reply.id).toBeGreaterThan(hi!.id)
		expect(reply.content).toBe(PLANNER_SAYS)
		expect(reply.error).toBeNull()

		for (const verb of ["retry", "swipe"] as const) {
			calls.length = 0
			const res: any =
				verb === "retry"
					? await sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
					: await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
			await settle()
			expect(res?.error, `${verb}: ${res?.error}`).toBeUndefined()
			check(verb)
			// The row being re-driven is not in its own prompt.
			expect(calls[0]).not.toContain(PLANNER_SAYS)
		}
	})
})

describe("secrets are told once (owner screenshot 2026-10-15)", () => {
	it("a turn's secret lands once in its player's lane; a swipe of the Narrator does not tell it again; a retake takes it back and tells it afresh", async () => {
		const sessionId = await createSession("secrets once")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		const SECRET = "The amulet is cursed."
		const plan = {
			...TURN_PLANS[1],
			deltas: [],
			secrets: [{ seat: `player-seat:${seat.id}`, text: SECRET }]
		}
		await db.insert(schema.sessionMessages).values({
			sessionId,
			userId: ownerId,
			role: "user",
			content: "I look at the amulet.",
			channel: "main",
			metadata: { speaker: `player-seat:${seat.id}` }
		} as any)
		const told = async () =>
			(await rowsOf(sessionId)).filter((r) => r.channel === "parley" && r.content === `For you alone: ${SECRET}`)

		planQueue.push(plan)
		const { sessionsFireTurnHandler, sessionMessagesSwipeRightHandler } = await import("./sessions")
		const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		const first = await told()
		expect(first).toHaveLength(1)

		// A swipe re-voices the Narrator on the stored plan: no second secret.
		const narrator = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		const swiped: any = await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: narrator.id } as any, emit)
		await settle()
		expect(swiped?.error, swiped?.error).toBeUndefined()
		expect(await told()).toHaveLength(1)

		// A retake: the turn's delivery is its yield and goes with it; the
		// retaken turn tells it once more — still one row.
		planQueue.push(plan)
		const { retakeTurn } = await import("$lib/server/sessions/retakeTurn")
		const retaken = await retakeTurn(db as any, { sessionId, userId: ownerId })
		await settle()
		expect(retaken.error, retaken.error).toBeUndefined()
		expect(retaken.rows!.map((r) => r.messageId)).toContain(first[0]!.id)
		const again = await told()
		expect(again).toHaveLength(1)
		expect(again[0]!.id).not.toBe(first[0]!.id)
		planQueue.length = 0
	})
})

describe("one journal line a turn, and a new goal (2026-10-16)", () => {
	/** An owner at a made table, and a story turn whose Planner answers `plan`. */
	const table = async (name: string) => {
		const sessionId = await createSession(name)
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		const ref = `player-seat:${seat.id}`
		const plan = (summary: string, goalProgress = "none") => ({
			deltas: [],
			world: { rooms: [], npcs: [], leads: [], goalProgress, notes: "" },
			clock: { minutes: 5 },
			narratorBrief: "The hall is quiet.",
			roundSummary: summary,
			secrets: []
		})
		const { sessionsFireTurnHandler } = await import("./sessions")
		const turn = async (line: string, summary: string, goalProgress?: string) => {
			await db.insert(schema.sessionMessages).values({
				sessionId,
				userId: ownerId,
				role: "user",
				content: line,
				channel: "main",
				metadata: { speaker: ref }
			} as any)
			planQueue.push(plan(summary, goalProgress))
			const res: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
			await settle()
			expect(res?.error, res?.error).toBeUndefined()
		}
		const journal = async () =>
			(await rowsOf(sessionId)).filter((r) => r.channel === "travelogue" && ((r.metadata as any)?.kind ?? "did") === "did").map((r) => r.content)
		return { sessionId, turn, journal }
	}

	it("two different summaries are two lines; the same summary again is none", async () => {
		const { turn, journal } = await table("journal lines")
		try {
			await turn("I search the hall.", "Ann searched the flooded hall.")
			expect(await journal()).toEqual(["Ann searched the flooded hall."])
			await turn("I climb the stair.", "Ann climbed the drowned stair.")
			expect(await journal()).toEqual(["Ann searched the flooded hall.", "Ann climbed the drowned stair."])
			await turn("I wait.", "Ann climbed the drowned stair.")
			expect(await journal()).toEqual(["Ann searched the flooded hall.", "Ann climbed the drowned stair."])
		} finally {
			planQueue.length = 0
		}
	})

	it("the goal reached, A new goal: one call, its request the last user turn; the goal filed", async () => {
		const { sessionId, turn } = await table("new goal")
		try {
			await turn("I free the king.", "Ann freed the drowned king.", "reached")
		} finally {
			planQueue.length = 0
		}
		const form = await openForm(sessionId, "parley")
		const { DUNGEON_CRAWLER_GOAL_ACTION, DUNGEON_CRAWLER_GOAL_CHOICES } = await import("@serene-pub/core-catalog")
		const { sessionsFireActionHandler } = await import("./sessions")
		calls.length = 0
		const res: any = await sessionsFireActionHandler.handler(
			fakeSocket(ownerId),
			{
				sessionId,
				action: DUNGEON_CRAWLER_GOAL_ACTION,
				messageId: form.messageId,
				blockId: form.blocks[0].id,
				payload: { choice: DUNGEON_CRAWLER_GOAL_CHOICES.newGoal }
			} as any,
			emit
		)
		await settle()
		expect(res?.error, res?.error).toBeUndefined()
		expect(calls).toHaveLength(1)
		const { turns } = promptOf(calls[0]!)
		expect(turns.at(-1)).toMatchObject({ role: "user" })
		expect(turns.at(-1)!.text).toMatch(/^The party reached their goal/)
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].goal).toBe(NEW_GOAL.goal)
	})
})

/**
 * 🚧 The strict-model walk (2026-10-16): fixes pinned on the real roads.
 *
 *  1. A swipe or retry on the opening scene — a row genesis wrote, no reply —
 *     is refused in a sentence: no model, the opening and its world stand.
 *     A swipe on a Planner-lane row stays on the lane (no Planner books call).
 *     A swipe whose run halts empty leaves its row failed (never "working")
 *     and the world as it was.
 *  2. The standing-order question stays answerable after the table line that
 *     follows it; the answer is a table line.
 *  3. A failed reply (an error, no words) never reaches the next prompt; the
 *     session card says the reply failed rather than "Waiting on the model".
 *  4. A halted press fired again does not write its table line twice.
 */
describe("the strict-model walk (2026-10-16)", () => {
	async function interviewed(name: string) {
		const sessionId = await createSession(name)
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		await settle()
		const seat = (await seatOf(sessionId, ownerId))!
		return { sessionId, seat, seatOwner: { kind: "player_seat", id: seat.id }, own }
	}
	const anchoredTo = async (messageId: number) =>
		(
			await db
				.select({ id: schema.attributeValues.id })
				.from(schema.attributeValues)
				.where(eq(schema.attributeValues.validFromMessageId, messageId))
		).length

	it("the opening is not a reply: swipe and retry are refused, no model, its world stands; a lane row's swipe stays on the lane", async () => {
		const { sessionId, seatOwner } = await interviewed("walk-opening")
		const opening = (await rowsOf(sessionId)).find((r) => r.channel === "main")!
		expect(opening.content).toBe(OPENING)
		expect(await placeNamed(sessionId, await value(sessionId, seatOwner, "core:slot/location@1"))).toBe("The Sunken Gate")
		const { sessionMessagesRegenerateHandler, sessionMessagesSwipeRightHandler } = await import("./sessions")
		calls.length = 0
		for (const verb of ["swipe", "retry"] as const) {
			const res: any =
				verb === "retry"
					? await sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: opening.id } as any, emit)
					: await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: opening.id } as any, emit)
			await settle()
			// Story offers no row retry at all (its turns are retaken whole); the swipe is the walk's road.
			expect(res?.error, verb).toMatch(verb === "swipe" ? /not a reply/ : /./)
		}
		expect(calls).toHaveLength(0)
		const after = (await rowsOf(sessionId)).find((r) => r.id === opening.id)!
		expect(after.content).toBe(OPENING)
		expect(after.isGenerating).toBe(false)
		expect((after.metadata as any)?.swipes).toBeUndefined()
		expect(await placeNamed(sessionId, await value(sessionId, seatOwner, "core:slot/location@1"))).toBe("The Sunken Gate")

		// The core write refuses it too: no empty alternative is recorded.
		const { runBuiltIn } = await import("$lib/server/pipelines/runtime/builtins")
		const recorded = await runBuiltIn(db as any, {
			kind: "swipe",
			sessionId,
			actor: ownerId,
			payload: { target: opening.id, text: "" },
			io: quietIo() as any
		})
		expect(recorded.ok).toBe(false)
		expect((await rowsOf(sessionId)).find((r) => r.id === opening.id)!.content).toBe(OPENING)

		// A Planner reply on the owner's lane: its swipe is the Planner's talk, never a story round.
		await db
			.insert(schema.sessionMessages)
			.values({ sessionId, userId: ownerId, role: "user", content: "Hi!", channel: "parley" } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(db as any, {
			sessionId,
			userId: ownerId,
			event: sessionEvents.messageDeleted,
			payload: { sessionId, cause: { kind: "edit", userId: ownerId } },
			wait: true
		})
		const { sessionsFireTurnHandler } = await import("./sessions")
		const fired: any = await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId, channel: "parley" } as any, emit)
		await settle()
		expect(fired?.error, fired?.error).toBeUndefined()
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").at(-1)!
		expect(reply.content).toBe(PLANNER_SAYS)
		calls.length = 0
		const swiped: any = await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
		await settle()
		expect(swiped?.error, swiped?.error).toBeUndefined()
		// Two calls per lane line since §13 (2026-10-18): the Planner's talk, then the edits call (asks, deltas).
		expect(calls).toHaveLength(2)
		expect(calls[0]).toContain("You are talking with one player")
		expect(calls[0]).not.toContain("keep the books out of sight")
		expect((await rowsOf(sessionId)).filter((r) => r.channel === "main")).toHaveLength(1)
	})

	it("a story reply's swipe that comes back empty: the row fails with its reason (never 'working'), the world as it was", async () => {
		const { sessionId, seat, seatOwner } = await interviewed("walk-swipe-halt")
		withSeat(`player-seat:${seat.id}`)
		await db.insert(schema.sessionMessages).values({
			sessionId, userId: ownerId, role: "user", content: "I climb the wall.", channel: "main",
			metadata: { speaker: `player-seat:${seat.id}` }
		} as any)
		turnPlans = 0
		const { sessionsFireTurnHandler, sessionMessagesSwipeRightHandler } = await import("./sessions")
		expect(((await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)) as any)?.error).toBeUndefined()
		await settle()
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(reply.content).toBe(NARRATION)
		// The reply moved Ann: a location anchored to the reply row itself — what a swipe takes back first.
		const [placed] = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "player_seat"),
					eq(schema.attributeValues.ownerId, seat.id),
					eq(schema.attributeValues.slotId, "core:slot/location@1")
				)
			)
		const { id: _id, ...moved } = placed!
		await db.insert(schema.attributeValues).values({ ...moved, value: { v: "The Drowned Stair" }, validFromMessageId: reply.id } as any)
		expect(await value(sessionId, seatOwner, "core:slot/location@1")).toBe("The Drowned Stair")
		const hp = await value(sessionId, seatOwner, "core:slot/hp@1")
		const location = await value(sessionId, seatOwner, "core:slot/location@1")
		const anchored = await anchoredTo(reply.id)

		narratorSays = ""
		try {
			await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
			await settle()
		} finally {
			narratorSays = null
		}
		const row = (await rowsOf(sessionId)).find((r) => r.id === reply.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.error).not.toBeNull()
		expect(await value(sessionId, seatOwner, "core:slot/hp@1")).toBe(hp)
		expect(await value(sessionId, seatOwner, "core:slot/location@1")).toBe(location)
		expect(location).toBe("The Drowned Stair")
		expect(await anchoredTo(reply.id)).toBe(anchored)
		expect(anchored).toBeGreaterThan(0)
	})

	it("a swipe whose Planner comes back empty is asked once more, then told by the Narrator alone — never 'working', never failed (🚧 the 100-turn walk, P1-5)", async () => {
		const { sessionId, seat } = await interviewed("walk-swipe-unreached")
		withSeat(`player-seat:${seat.id}`)
		await db.insert(schema.sessionMessages).values({
			sessionId, userId: ownerId, role: "user", content: "I climb the wall.", channel: "main",
			metadata: { speaker: `player-seat:${seat.id}` }
		} as any)
		turnPlans = 0
		const { sessionsFireTurnHandler, sessionMessagesSwipeRightHandler } = await import("./sessions")
		await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		const reply = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(reply.content).toBe(NARRATION)
		// The books no longer name this row as the last turn: its swipe plans afresh, as the walk's did.
		await db.execute(
			(await import("drizzle-orm")).sql`update sessions set annex = annex #- '{core,dungeon-crawler-progress,lastTelling}' where id = ${sessionId}`
		)
		plannerEmpty = true
		calls.length = 0
		try {
			await sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit)
			await settle()
		} finally {
			plannerEmpty = false
		}
		// Asked, and asked once more; then the Narrator goes on alone.
		expect(calls.filter((c) => c.includes("keep the books out of sight"))).toHaveLength(2)
		const row = (await rowsOf(sessionId)).find((r) => r.id === reply.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.error).toBeNull()
		expect(row.content).toContain(NARRATION)
	})

	it("solo: no standing-order question follows the summary — the lane ends on the summary and the wait line (§14)", async () => {
		// The two-seat question and its table-line answer are the W3 suite's
		// (`sessions.dungeonCrawlerW3.int.test.ts`); a solo table never asks it.
		const { sessionId } = await interviewed("walk-standing-order")
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley")
		expect(lane.at(-1)!.content).toBe("The story has started: open the Story tab and say what you do.")
		expect(lane.at(-2)!.content).toBe("Give me a moment to build the world.")
		expect(lane.at(-3)!.content).toMatch(/^Here is Ann, Ranger\./)
		expect(lane.some((r) => /do when you're away/i.test(r.content))).toBe(false)
		const { stalenessHead } = await import("$lib/server/messages/channels")
		// The wait line and the pointer are the table's (table lines): neither overtakes the summary as the lane's head.
		expect(await stalenessHead(db as any, sessionId, "parley", lane.at(-3)!.id)).toBe(lane.at(-3)!.id)
	})

	it("a failed reply never reaches the next prompt, and the card says it failed", async () => {
		const { sessionId, seat } = await interviewed("walk-failed-reply")
		withSeat(`player-seat:${seat.id}`)
		const line = (content: string) =>
			db.insert(schema.sessionMessages).values({
				sessionId, userId: ownerId, role: "user", content, channel: "main",
				metadata: { speaker: `player-seat:${seat.id}` }
			} as any)
		const { sessionsFireTurnHandler } = await import("./sessions")
		await line("I climb the wall.")
		turnPlans = 0
		narratorSays = ""
		try {
			await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
			await settle()
		} finally {
			narratorSays = null
		}
		const failed = (await rowsOf(sessionId)).filter((r) => r.channel === "main").at(-1)!
		expect(failed.role).not.toBe("user")
		expect(failed.content.trim()).toBe("")
		expect(failed.error).not.toBeNull()
		const { lastVisibleMessages } = await import("$lib/server/sessions/rowProjection")
		expect((await lastVisibleMessages(db as any, [sessionId])).get(sessionId)?.replyFailed).toBe(true)

		await line("I look around the gate.")
		calls.length = 0
		await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		await settle()
		const narrator = calls.find((c) => c.includes("What happens this round, from the Planner"))!
		expect(narrator).toBeDefined()
		const turns = promptOf(narrator).turns
		// No empty speaker turn anywhere before the seed line the model continues.
		for (const t of turns.slice(0, -1)) {
			if (t.role !== "assistant") continue
			expect(t.text.trim(), "an empty reply in the history").not.toMatch(/^([^:\n]+:)?\s*$/)
		}
		const planner = calls.find((c) => c.includes("keep the books out of sight"))!
		for (const t of promptOf(planner).turns.slice(0, -1))
			if (t.role === "assistant") expect(t.text.trim()).not.toMatch(/^([^:\n]+:)?\s*$/)
		expect((await lastVisibleMessages(db as any, [sessionId])).get(sessionId)?.replyFailed).toBeUndefined()
	})

	it("a halted name press fired again writes 'Name: Ann.' once", async () => {
		const sessionId = await createSession("walk-retry-echo")
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		const nameForm = await openForm(sessionId, "parley")
		classOfferEmpty = 1
		try {
			await own({ name: "Ann" })
		} finally {
			classOfferEmpty = Math.max(0, classOfferEmpty)
		}
		// The class offer came back empty: the run halted after the echo.
		expect((await openForm(sessionId, "parley")).messageId).toBe(nameForm.messageId)
		// Retry fires the same press again (`actionRetry.ts`).
		expect((await own({ name: "Ann" })).error).toBeUndefined()
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley")
		expect(lane.filter((r) => r.content === "Name: Ann.")).toHaveLength(1)
		expect((await openForm(sessionId, "parley")).blocks[0]).toMatchObject({ referent: "class" })
	})
})

describe("who edits a sheet by hand (owner ruling 2026-10-16)", () => {
	it("a player's own sheet waits on Honour mode; the owner always may, and so does a run; `editable` says the same", async () => {
		const sessionId = await createSession("honour sheets")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: guestId, isPlayer: true } as any)
		const { writeSeatName } = await import("$lib/server/sessions/seatName")
		const bo = (await writeSeatName(db as any, { sessionId, userId: guestId, isOwner: false, name: "Bo" }))!
		const { setValue, applyAutomatic, PLAYER_SHEET_REFUSAL } = await import("$lib/server/state/write")
		const { stateGet } = await import("./state")
		const HP = "core:slot/hp@1"
		const seat = { kind: "player_seat" as const, id: bo }
		const byHand = (userId: number, v: number) =>
			setValue(db as any, { sessionId, updatedBy: "user", userId }, { owner: seat, slotId: HP, value: v })
		const editable = async (userId: number) => {
			const got: any = await stateGet.handler(fakeSocket(userId), { sessionId } as any, emit as any)
			return got.owners.find((o: any) => o.kind === "player_seat" && o.id === bo)?.editable
		}

		// Honour mode is off to begin with: the player's own sheet is the Planner's.
		await expect(byHand(guestId, 7)).rejects.toThrow(PLAYER_SHEET_REFUSAL)
		expect(PLAYER_SHEET_REFUSAL).toBe(
			"Sheets are the Planner's to change — ask in the Planner panel, or turn on Honour mode."
		)
		expect(await editable(guestId)).toBe(false)
		// The owner edits it whatever the setting.
		await expect(byHand(ownerId, 8)).resolves.toBeTypeOf("number")
		expect(await value(sessionId, seat, HP)).toBe(8)
		expect(await editable(ownerId)).toBe(true)
		// A Planner-lane change goes through the run's writer (`bindings.state`:
		// no person on the context) and is never held back.
		await applyAutomatic(db as any, { sessionId, updatedBy: "run:honour-test" }, { owner: seat, slotId: HP, value: 6 } as any)
		expect(await value(sessionId, seat, HP)).toBe(6)

		// On: the player's hand is back on their own sheet.
		const [row] = await db
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		await db
			.update(schema.sessions)
			.set({ genreFields: { ...((row?.genreFields as object) ?? {}), honorMode: true } } as any)
			.where(eq(schema.sessions.id, sessionId))
		await expect(byHand(guestId, 5)).resolves.toBeTypeOf("number")
		expect(await value(sessionId, seat, HP)).toBe(5)
		expect(await editable(guestId)).toBe(true)
		await applyAutomatic(db as any, { sessionId, updatedBy: "run:honour-test" }, { owner: seat, slotId: HP, value: 4 } as any)
		expect(await value(sessionId, seat, HP)).toBe(4)
	}, 60_000)
})
