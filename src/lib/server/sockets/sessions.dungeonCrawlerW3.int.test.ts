/**
 * 🚧 Dungeon Crawler's cut-and-fix wave W3 (PLAN-sheet-widget-redesign §17,
 * AUDIT-rulesets-dc-sheet-2026-10-17 §F) — the paths nothing tested, over the
 * REAL create, form, send, Continue, retake and action roads, against the
 * SHIPPED documents, a fake adapter for the model:
 *
 *  1. **Death's door** (A7): a healthy seat never rolls, whatever the Planner
 *     answers; a seat the turn leaves at 0 health does. A death leaves a
 *     cairn, an owed arrival and *Make a new character*; retaking it brings
 *     the seat back, the round fires again, and the form goes with the
 *     retaken turn — the living kit stands (A8).
 *  2. **A new character** after a death stands where the fallen fell (A9),
 *     and the next Planner is told they arrive.
 *  3. **Rest** ticks a condition through the handler's `advance`, and a long
 *     rest gives back a spent spell slot (§7, §8, A4).
 *  4. **The goal** reached: Carry on, and End (an epilogue, no Planner).
 *  5. **Story before genesis** (A10): a guest's finished sheet leaves their
 *     Story shut until the world is built — their send is refused — and the
 *     owner's genesis opens it.
 *  6. **A line sent mid-turn** (A11): it lands after the Narrator's row, so it
 *     declares for the next round.
 *  7. **Solo** (§14): no standing-order question, and the Planner's talk
 *     cannot set one.
 *  8. **A Planner ask** (§13): an ask in the notes, a way out of the place the
 *     party stands in, each landing a table line on the lane.
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
	return { db, getCryptoSecretKey: () => "dungeon-crawler-w3-test-secret" }
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
				if (prompt.includes("keep the books out of sight")) {
					if (duringPlanner) {
						const hook = duringPlanner
						duringPlanner = null
						await hook()
					}
					return onContent(JSON.stringify(planQueue.length ? planQueue.shift() : plan()))
				}
				if (prompt.includes("What happens this round, from the Planner")) return onContent(NARRATION)
				if (prompt.includes("Offer three to five classes")) return onContent(JSON.stringify(CLASSES))
				if (prompt.includes("writing a player's character sheet")) return onContent(JSON.stringify(SHEET))
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dungeon-crawler-w3-"))
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
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "dc-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Dungeon Crawler W3 test sampling",
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
async function madeTable(name: string, o: { difficulty?: string; cls?: string } = {}) {
	const sessionId = await createSession(name)
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

describe("death's door (A7) and retaking a death (A8)", () => {
	it("a healthy seat never rolls; a seat left at 0 health does; a death retaken brings the seat back and leaves no stale form", async () => {
		const { sessionId, ref, owner } = await madeTable("deaths door", { difficulty: "brutal" })
		planQueue.length = 0
		// The Planner names a healthy Ann for death's door — a field the turn
		// no longer has: nobody rolls.
		await turn(sessionId, ref, "I wait.", { ...plan(), deathsDoor: [ref] })
		expect((await tableRows(sessionId)).join("\n")).not.toContain("death's door")
		expect(await value(sessionId, owner, "core:slot/fate@1")).not.toBe("dead")

		// A blow that leaves Ann at 0 health: she rolls. Brutal (DC 12): roll
		// again from 1 health until the dice kill her.
		let fate: unknown = "alive"
		let attempts = 0
		while (fate !== "dead" && attempts++ < 10) {
			// Every point of health she has (the handler spends no more than there is).
			const hp = String(await value(sessionId, owner, "core:slot/hp@1"))
			await turn(sessionId, ref, "I leap the chasm.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: hp, reason: "the fall" })] }))
			const door = (await tableRows(sessionId)).flatMap((r) => r.split("\n")).filter((l) => l.includes("death's door")).at(-1)
			expect(door).toMatch(/^☠ Ann the Bold at death's door: d20 \d+ vs DC 12 — (survives|dead)$/)
			fate = await value(sessionId, owner, "core:slot/fate@1")
			if (fate !== "dead") expect(await value(sessionId, owner, "core:slot/hp@1")).toBe(1)
		}
		expect(fate).toBe("dead")
		const annex = await annexOf(sessionId)
		const owed = annex["dungeon-crawler-progress"].arrivals as any[]
		expect(owed).toEqual([{ who: `user:${ownerId}`, fallen: "Ann the Bold", where: "The Sunken Gate", left: 2 }])
		expect((await ownLore(sessionId, "core:entry/history")).map((e) => e.content)).toEqual([
			expect.stringMatching(/^Here lies Ann the Bold, Ranger, level 1, who fell in The Sunken Gate\.$/)
		])
		const newCharacter = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "new-character")
		expect(newCharacter).toBeTruthy()
		// Solo and dead: nobody is left to declare, so no line fires a round.
		expect(annex["dungeon-crawler-progress"].fates).toEqual({ [ref]: "dead" })

		// Retake the death: the state comes back, and the retaken turn rewrites
		// who is out from the rows.
		const { retakeTurn } = await import("$lib/server/sessions/retakeTurn")
		planQueue.push(plan({ narratorBrief: "Ann lands on the far side." }))
		const retaken = await retakeTurn(db as any, { sessionId, userId: ownerId })
		await settle()
		expect(retaken.error, retaken.error).toBeUndefined()
		expect(await value(sessionId, owner, "core:slot/fate@1")).not.toBe("dead")
		expect((await annexOf(sessionId))["dungeon-crawler-progress"].fates ?? {}).toEqual({})

		// The death's line and its form were the retaken turn's yield: gone with
		// it, so no stale *Make a new character* is left to wipe a living kit.
		// (Were one left, the interview answers it only while the fate row
		// says dead — the A8 gate.)
		expect((await rowsOf(sessionId)).some((r) => r.id === newCharacter!.messageId)).toBe(false)
		expect((await formsOn(sessionId, "parley")).some((f) => f.block.referent === "new-character")).toBe(false)
		expect(((await value(sessionId, owner, "core:slot/crawl-weapons@1")) as any[]).map((p) => p.pieceId)).toEqual(["longbow", "spear"])

		// And the round fires again for her line.
		const runs = await respondRuns(sessionId)
		expect((await send(ownerId, sessionId, "I walk on.")).error).toBeUndefined()
		expect(await respondRuns(sessionId)).toBe(runs + 1)
	})
})

describe("a new character after a death (A9)", () => {
	it("stands where the fallen fell, and the next Planner is told they arrive", async () => {
		const { sessionId, ref, owner } = await madeTable("newcomer", { difficulty: "brutal" })
		planQueue.length = 0
		let attempts = 0
		while ((await value(sessionId, owner, "core:slot/fate@1")) !== "dead" && attempts++ < 10) {
			const hp = String(await value(sessionId, owner, "core:slot/hp@1"))
			await turn(sessionId, ref, "I leap.", plan({ deltas: [delta({ owner: ref, op: "spend", slot: "hp", value: hp })] }))
		}
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("dead")
		// Ann wandered to the Hall before she fell? No: she fell at the gate,
		// where genesis put her — and that is where the newcomer stands.
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		const form = (await formsOn(sessionId, "parley")).find((f) => f.block.referent === "new-character")!
		const { DUNGEON_CRAWLER_INTERVIEW_ACTION } = await import("@serene-pub/core-catalog")
		expect((await fire(ownerId, sessionId, DUNGEON_CRAWLER_INTERVIEW_ACTION, form.messageId, form.block.id, { choice: "new-character" })).error).toBeUndefined()
		expect((await openForm(sessionId, "parley")).blocks[0]).toMatchObject({ referent: "name" })
		expect((await own({ name: "Cass" })).error).toBeUndefined()
		expect((await own({ choice: "cleric" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		// 🚧 A NEW seat (owner ruling 2026-10-18, the 100-turn walk's P3-1): the
		// fallen's stays dead, retired from the table, its cairn standing.
		expect(await value(sessionId, owner, "core:slot/fate@1")).toBe("dead")
		const cassSeat = (await db.select().from(schema.sessionPersonas).where(eq(schema.sessionPersonas.sessionId, sessionId))).find((s) => s.seatName === "Cass")!
		expect(cassSeat.id).not.toBe(owner.id)
		const cass = { kind: "player_seat", id: cassSeat.id }
		expect(await value(sessionId, cass, "core:slot/fate@1")).toBe("alive")
		const where = await value(sessionId, cass, "core:slot/location@1")
		const places = await ownLore(sessionId, "core:entry/location")
		const name = typeof (where as any)?.entryId === "number" ? places.find((p) => p.id === (where as any).entryId)?.title : where
		expect(name).toBe("The Sunken Gate")
		// The summary: what they carry, know and can — never one list.
		const summary = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").find((r) => r.content.startsWith("Here is Cass"))!
		expect(summary.content).toMatch(/They carry: Mace, Chain shirt/)
		expect(summary.content).toMatch(/They know: Sacred flame/)
		expect(summary.content).toMatch(/They can: Turn the dead/)
		// The world stands: their Story is open, and the solo line says so.
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley")
		expect(lane.at(-1)!.content).toBe("The world is waiting. Say what you do on the Story when you're ready.")
		calls.length = 0
		await turn(sessionId, `player-seat:${cassSeat.id}`, "Cass looks around.")
		const planner = calls.find((c) => c.includes("keep the books out of sight"))!
		expect(planner).toMatch(/Arriving: Cass, a new character, must join the story within \d round\(s\), near The Sunken Gate\./)
	})
})

describe("conditions, spell slots and Rest (§7, §8, A4)", () => {
	it("a condition lands with a table line and wears off under Rest's advance; a spent slot comes back on a long rest", async () => {
		const { sessionId, ref, owner } = await madeTable("rest", { cls: "cleric" })
		planQueue.length = 0
		const slots = (await value(sessionId, owner, "core:slot/crawl-spell-slots@1")) as any[]
		expect(slots).toEqual([expect.objectContaining({ name: "Level 1", level: 1, max: 2, used: 0 })])
		await turn(
			sessionId,
			ref,
			"I drink from the well and cast a blessing.",
			plan({
				deltas: [
					delta({ owner: ref, op: "add", repertoire: "conditions", piece: "poisoned", reason: "foul water" }),
					delta({ owner: ref, op: "spend", repertoire: "spell-slots", piece: "1", reason: "a blessing" })
				]
			})
		)
		expect(await tableRows(sessionId)).toContainEqual(expect.stringContaining("Ann the Bold: Poisoned, 1 hour"))
		const held = (await value(sessionId, owner, "core:slot/crawl-conditions@1")) as any[]
		expect(held.length).toBe(1)
		expect(((await value(sessionId, owner, "core:slot/crawl-spell-slots@1")) as any[])[0]).toMatchObject({ used: 1 })

		// 🚧 S3 (lane G3, 2026-10-23): the rules' Rest (Vis Itineris offers one); the crawl's night follows on
		// its event — the routine After a rest (routines run here only when a test turns them on).
		const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
		setRoutinesEnabled(true)
		const rested = await fire(ownerId, sessionId, "core:spec/rules-action#rest", undefined, undefined, {}).finally(() => setRoutinesEnabled(false))
		expect(rested?.error, rested?.error).toBeUndefined()
		expect(((await value(sessionId, owner, "core:slot/crawl-conditions@1")) as any[] | null) ?? []).toEqual([])
		expect(((await value(sessionId, owner, "core:slot/crawl-spell-slots@1")) as any[])[0]).toMatchObject({ used: 0 })
	})
})

describe("the goal reached", () => {
	const reached = async (name: string) => {
		const t = await madeTable(name)
		planQueue.length = 0
		await turn(t.sessionId, t.ref, "I free the king.", plan({ world: { rooms: [], npcs: [], leads: [], goalProgress: "reached", notes: "" }, roundSummary: "Ann freed the king." }))
		const form = await openForm(t.sessionId, "parley")
		expect(form.blocks[0]).toMatchObject({ referent: "goal" })
		return { ...t, form }
	}

	it("Carry on: the world turns on with no goal to chase", async () => {
		const { sessionId, form } = await reached("carry on")
		const { DUNGEON_CRAWLER_GOAL_ACTION, DUNGEON_CRAWLER_GOAL_CHOICES } = await import("@serene-pub/core-catalog")
		const res = await fire(ownerId, sessionId, DUNGEON_CRAWLER_GOAL_ACTION, form.messageId, form.blocks[0].id, { choice: DUNGEON_CRAWLER_GOAL_CHOICES.carryOn })
		expect(res?.error, res?.error).toBeUndefined()
		expect((await annexOf(sessionId))["dungeon-crawler-progress"]).toMatchObject({ goalDone: true })
	})

	it("End: every later turn is the Narrator's epilogue, with no Planner", async () => {
		const { sessionId, ref, form } = await reached("the end")
		const { DUNGEON_CRAWLER_GOAL_ACTION, DUNGEON_CRAWLER_GOAL_CHOICES } = await import("@serene-pub/core-catalog")
		const res = await fire(ownerId, sessionId, DUNGEON_CRAWLER_GOAL_ACTION, form.messageId, form.blocks[0].id, { choice: DUNGEON_CRAWLER_GOAL_CHOICES.end })
		expect(res?.error, res?.error).toBeUndefined()
		expect((await annexOf(sessionId))["dungeon-crawler-progress"]).toMatchObject({ ended: true })
		calls.length = 0
		await turn(sessionId, ref, "We go home.")
		expect(calls.some((c) => c.includes("keep the books out of sight"))).toBe(false)
		expect(calls.find((c) => c.includes("What happens this round, from the Planner"))).toMatch(/short epilogue/)
	})
})

describe("Story waits for the world (A10)", () => {
	it("a guest's finished sheet keeps their Story shut until the owner's genesis opens it", async () => {
		const sessionId = await createSession("guest first")
		const { sessionsAddGuestHandler } = await import("./sessions")
		const added: any = await sessionsAddGuestHandler.handler(fakeSocket(ownerId), { sessionId, guestUserId: guestId } as any, emit)
		expect(added?.success, added?.error).toBe(true)
		await settle()
		// The guest makes Bo before the owner has answered a world question.
		expect((await press(guestId, sessionId, "parley:2", { choice: "make-character" })).error).toBeUndefined()
		expect((await press(guestId, sessionId, "parley:2", { name: "Bo" })).error).toBeUndefined()
		expect((await press(guestId, sessionId, "parley:2", { choice: "ranger" })).error).toBeUndefined()
		calls.length = 0
		expect((await press(guestId, sessionId, "parley:2", { choice: "surprise" })).error).toBeUndefined()
		// No world from a guest's sheet while the owner's questions are open.
		expect(calls.some((c) => c.includes("you build the world they walk into"))).toBe(false)
		expect((await rowsOf(sessionId)).filter((r) => r.channel === "parley:2").at(-1)!.content).toBe("We'll begin once the world is ready.")
		const early = await send(guestId, sessionId, "Bo looks for the door.")
		expect(early?.refused).toMatch(/the story starts once the world is built/)
		expect((await rowsOf(sessionId)).some((r) => r.content === "Bo looks for the door.")).toBe(false)

		// The owner settles the world and makes Ann: the world is built, and
		// Bo's Story opens with Ann's.
		const own = (payload: Record<string, unknown>) => press(ownerId, sessionId, "parley", payload)
		for (const choice of ["dungeon", "fair", "shared"]) expect((await own({ choice })).error).toBeUndefined()
		expect((await own({ name: "Ann the Bold" })).error).toBeUndefined()
		expect((await own({ choice: "ranger" })).error).toBeUndefined()
		expect((await own({ choice: "surprise" })).error).toBeUndefined()
		expect((await annexOf(sessionId))["dungeon-crawler-progress"]).toMatchObject({ built: true })
		const states = await composerStatesOf(sessionId)
		expect(JSON.stringify(states)).not.toMatch(/user:\d+/)
		const sent = await send(guestId, sessionId, "Bo looks for the door.")
		expect(sent?.refused, sent?.refused).toBeUndefined()
	})
})

describe("a line sent mid-turn (A11)", () => {
	it("lands after the Narrator's row, so it declares for the next round", async () => {
		const { sessionId, ref } = await madeTable("mid turn")
		planQueue.length = 0
		let midId = 0
		duringPlanner = async () => {
			const [row] = await db
				.insert(schema.sessionMessages)
				.values({ sessionId, userId: ownerId, role: "user", content: "And I keep watch.", channel: "main", metadata: { speaker: ref } } as any)
				.returning()
			midId = row!.id
		}
		await turn(sessionId, ref, "I search the hall.")
		expect(midId).toBeGreaterThan(0)
		const story = (await rowsOf(sessionId)).filter((r) => r.channel === "main")
		const narrator = story.filter((r) => (r.metadata as any)?.speaker === "envoy:narrator").at(-1)!
		expect(narrator.content).toBe(NARRATION)
		// The Narrator's row was open before the Planner was asked: the line
		// sent meanwhile comes after it, a declaration for the next round.
		expect(narrator.id).toBeLessThan(midId)
		const { sentSinceReply } = await import("$lib/server/pipelines/runtime/speakerRotation")
		expect(sentSinceReply(story as any).main).toContain(ref)
	})
})

describe("solo: no standing order (§14)", () => {
	it("the sheet asks none, and the Planner's talk cannot set one", async () => {
		const { sessionId, owner } = await madeTable("solo")
		const summary = (await rowsOf(sessionId)).filter((r) => r.channel === "parley").find((r) => r.content.startsWith("Here is Ann the Bold"))!
		const { blockTreesOf } = await import("$lib/server/messages/blocks")
		expect(await blockTreesOf(db as any, summary.id)).toEqual([])
		editsQueue.push({ standingOrder: "flee", asks: [], deltas: [], rooms: [] })
		expect((await send(ownerId, sessionId, "If I'm away, have Ann flee.", "parley")).error).toBeUndefined()
		const { sessionsFireTurnHandler } = await import("./sessions")
		await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId, channel: "parley" } as any, emit)
		await settle()
		expect(editsQueue).toHaveLength(0)
		expect(await value(sessionId, owner, "core:slot/standing-order@1")).not.toBe("flee")
	})
})

describe("a Planner ask (§13)", () => {
	it("lands as an ask in the notes and a way out of the party's place, each a table line on the lane", async () => {
		const { sessionId } = await madeTable("an alley")
		const gate = (await ownLore(sessionId, "core:entry/location")).find((p) => p.title === "The Sunken Gate")!
		editsQueue.push({
			standingOrder: "",
			asks: ["Introduce an alley behind the gate."],
			deltas: [],
			rooms: [
				{
					id: "gate",
					name: "The Sunken Gate",
					description: "",
					exits: [{ to: "The Alley", way: "passage", state: "hidden", lockDc: 0, trap: "", trapDc: 0, minutes: 2 }]
				}
			]
		})
		expect((await send(ownerId, sessionId, "Could there be an alley behind the gate?", "parley")).error).toBeUndefined()
		const { sessionsFireTurnHandler } = await import("./sessions")
		await sessionsFireTurnHandler.handler(fakeSocket(ownerId), { sessionId, channel: "parley" } as any, emit)
		await settle()
		expect(editsQueue).toHaveLength(0)
		// The edits call was told what this player may change: the host, anything.
		expect(calls.find((c) => c.includes("Now note what they asked for"))).toMatch(/the session's host: their asks may change any character, any place/)
		expect((await annexOf(sessionId))["dungeon-crawler-planning-notes"]).toMatch(/Asks:\n- \[Ann the Bold\] Introduce an alley behind the gate\./)
		// The place's row in this session (\`session_location\`).
		const exitRows = await db
			.select({ value: schema.attributeValues.value })
			.from(schema.attributeValues)
			.where(and(eq(schema.attributeValues.ownerKind, "session_location"), eq(schema.attributeValues.ownerId, gate.id), eq(schema.attributeValues.slotId, "core:slot/crawl-exits@1")))
			.orderBy(asc(schema.attributeValues.id))
		const exits = ((exitRows.at(-1)?.value as any)?.v ?? []) as any[]
		expect(exits).toContainEqual(expect.objectContaining({ name: "Passage to The Alley", state: "hidden", way: "passage" }))
		const lane = (await rowsOf(sessionId)).filter((r) => r.channel === "parley")
		const reply = lane.find((r) => r.content === PLANNER_SAYS)!
		const lines = lane.filter((r) => (r.metadata as any)?.anchorMessageId === reply.id)
		expect(lines.map((r) => r.content).join("\n")).toMatch(/Noted for the story: Introduce an alley behind the gate\./)
		expect(lines.length).toBeGreaterThanOrEqual(2)
	})
})
