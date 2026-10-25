/**
 * 🚧 **The Lair, rewritten — a walk** (PLAN-lair-build L4, 2026-10-21): over
 * the REAL create, send, Continue, press, review and routine roads, against
 * the SHIPPED documents, with a scripted fake model (the Dungeon Crawler
 * walks' pattern):
 *
 *  - create: the Castellan's greeting on the Sanctum, no model call;
 *  - a guest takes a seat (D5): the Castellan tells the GM in the Sanctum,
 *    and the Sanctum is the GM's alone (D6) — rows, channel list, send;
 *  - direction → the plan → one **roll form** to the GM (D3): the party's
 *    turns are held while it is open; its answer rolls by the ruleset and
 *    the Oracle posts the **dice**; the voices follow in the plan's order,
 *    a seated player's turn waits for them, and the GM's Continue skips a
 *    waiting player; the keeper routine keeps the books after the round;
 *  - a seated player's own line is their turn, never the GM's direction;
 *  - Show dice off: the dice row reads without numbers in every prompt;
 *  - the knock → the drafted room with its typed fields (D2), held at the
 *    review gate, which refuses a misfit; a typed room's Exits line becomes
 *    links on save (D10);
 *  - `update-lore-entry@1`'s commit (D2);
 *  - Regenerate the last turn takes the roll forms and the dice with it.
 */

import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
	return { db, getCryptoSecretKey: () => "lair-walk-test-secret" }
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
/** What the room was told — the pushes, per recipient as the lane scoping narrowed them. */
const pushes = vi.hoisted(() => [] as Array<{ sessionId: number; event: string; payload: any }>)
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async (_io: unknown, sessionId: number, event: string, payload: any) => {
		pushes.push({ sessionId, event, payload })
	}
}))

/* ── The fake model ──────────────────────────────────────────────────── */

const PLANNER = "you plan the party's next moment in it"
const VOICE = "taking your turn in a dungeon you chose to walk into"
const KEEPER = "You keep the record of a delve"
const SANCTUM = "in the Sanctum, your table outside the story"
const SCRATCHPAD = "and you keep a scratchpad"
const KNOCK_BUILD = "leads somewhere nobody has described yet"

/** The planner's answers, first first; a quiet plan when empty. */
const planQueue: any[] = []
const quietPlan = { beats: [], speakers: [], risks: [], unknownExit: "", knockQuestion: "", worldHints: { location: "The Gate Hall" } }
/** Every compiled prompt, in order. */
const compiled: string[] = []
/** 🚧 lair fix 2: each call's prompt beside the stops it was sent with. */
const calls: Array<{ prompt: string; stops: any }> = []

/**
 * 🚧 lair fix 2: a run whose executor throws AFTER its run-end hook — the
 * row settled, as a host failure on the way out leaves it — for the spec
 * named here, once. Everything else is the real executor.
 */
const throwAfter = vi.hoisted(() => ({ spec: null as string | null }))
vi.mock("@serene-pub/sdk", async (importOriginal) => {
	const real: any = await importOriginal()
	return {
		...real,
		run: async (doc: any, opts: any) => {
			const receipt = await real.run(doc, opts)
			if (throwAfter.spec && receipt?.specId === throwAfter.spec && !opts?.preview) {
				throwAfter.spec = null
				throw new Error("a host failure after the run-end hook")
			}
			return receipt
		}
	}
})

class FakeAdapter {
	injected: any
	responseFormat: any
	responseSchema: any
	abort() {}
	async preflight() {}
	stops: any
	withStops(stops: any) {
		this.stops = stops
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
		compiled.push(prompt)
		calls.push({ prompt, stops: this.stops })
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (prompt.includes(PLANNER)) return onContent(JSON.stringify(planQueue.length ? planQueue.shift() : quietPlan))
				if (prompt.includes(KEEPER)) return onContent(JSON.stringify({ deltas: [] }))
				if (prompt.includes(SCRATCHPAD)) return onContent(JSON.stringify({ scratchpad: "- The vault door is trapped." }))
				if (prompt.includes(KNOCK_BUILD))
					return onContent(
						JSON.stringify({
							content: "Black water between pillars.",
							exits: [
								{ way: "south", to: "The Gate Hall" },
								{ way: "east", to: "The Vault" }
							],
							fields: { category: "Undercroft" }
						})
					)
				if (prompt.includes(SANCTUM)) return onContent("Noted, Dungeon Master.")
				if (prompt.includes(VOICE)) {
					const who = /You are ([A-Z][a-z]+), taking your turn/.exec(prompt)?.[1] ?? "Someone"
					return onContent(`${who} steps forward.`)
				}
				onContent("The torches gutter.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

/* ── The table ───────────────────────────────────────────────────────── */

let ownerId: number
let guestId: number
let sessionId: number
let lorebookId: number
let brannoc: number
let verity: number
let rookSeat: number
const rooms: Record<string, number> = {}

function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

const rowsOf = async () =>
	db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sessionId)).orderBy(asc(schema.sessionMessages.id))

const meta = (row: { metadata: unknown }) => (row.metadata ?? {}) as Record<string, any>

async function blocksOf(messageId: number): Promise<any[]> {
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	return (await blockTreesOf(db as any, messageId)).flat() as any[]
}

async function turnOrder() {
	const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
	const { readTurnOrder } = await import("@serene-pub/sdk")
	return readTurnOrder(coreAnnexIn(row!.annex)).order
}

/** A person's line through the real send. */
async function send(userId: number, content: string, channel = "main") {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(userId),
		{ sessionId, personaId: null, content, channel } as any,
		emit
	)
	await settle()
	return res
}

async function fireContinue(userId = ownerId, extra: Record<string, unknown> = {}) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(fakeSocket(userId), { sessionId, ...extra } as any, emit)
	await settle()
	return res
}

async function fire(userId: number, action: string, messageId: number, blockId: string, payload: Record<string, unknown>, text?: string) {
	const { sessionsFireActionHandler } = await import("./sessions")
	const res: any = await sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{ sessionId, action, messageId, blockId, payload, ...(text !== undefined ? { text } : {}) } as any,
		emit
	)
	await settle()
	return res
}

async function runsOf(spec: string) {
	await settle()
	return (await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.sessionId, sessionId))).filter(
		(r) => r.specSlug === spec
	)
}

/** Wait until `probe` answers truthy (every 20 ms), or fail after `ms`. */
async function until<T>(probe: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
	const end = Date.now() + ms
	for (;;) {
		const got = await probe()
		if (got) return got
		if (Date.now() > end) throw new Error("waited too long")
		await new Promise((r) => setTimeout(r, 20))
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-walk-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	// The keeper and the scratchpad are routines: on for this walk.
	const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
	setRoutinesEnabled(true)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "lair-walk-gm")).id
	guestId = (await createTestUser(db, "lair-walk-guest")).id

	const [textConn] = await db.insert(schema.connections).values({ name: "Text", type: "openai", baseUrl: "http://text/v1" }).returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "lair-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Lair walk test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	// The dungeon: two rooms, the party in the first.
	// A book that plays Vis Itineris: a session takes its book's rules.
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: "The walk's dungeon", primaryRuleset: "core:ruleset/vis-itineris@1" } as any)
		.returning()
	lorebookId = book!.id
	for (const [i, [title, content]] of [
		["The Gate Hall", "Cold stone and a rusted portcullis.\n\nExits: north → The Vault"],
		["The Vault", "A sealed treasury.\n\nExits: south → The Gate Hall"]
	].entries()) {
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values({ lorebookId, typeId: "core:entry/location", typeVersion: 1, position: i + 1, title, content, fields: {} } as any)
			.returning()
		rooms[title!] = entry!.id
	}
	const [b] = await db.insert(schema.characters).values({ userId: ownerId, name: "Brannoc", description: "A delver." }).returning()
	const [v] = await db.insert(schema.characters).values({ userId: ownerId, name: "Verity", description: "A scout." }).returning()
	brannoc = b!.id
	verity = v!.id
}, 180_000)

afterAll(async () => {
	const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
	setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the Lair, rewritten: a walk", () => {
	test("create: the Rules preset, the Castellan's greeting on the Sanctum, no model call", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const [rules] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-lair-default"))
		const before = compiled.length
		const res: any = await sessionsCreateHandler.handler(
			fakeSocket(ownerId),
			{
				session: { name: "The walk", presetId: rules!.id, lorebookId, primaryRuleset: "core:ruleset/vis-itineris@1", rigour: "mechanics" },
				characterIds: [brannoc, verity],
				personaIds: [],
				characterPositions: {},
				tags: []
			} as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		sessionId = res.session.id
		await settle()
		const greeting = (await rowsOf()).find((r) => r.channel === "sanctum")
		expect(greeting?.content).toMatch(/steward of this dungeon/)
		expect(meta(greeting!).speaker).toBe("envoy:castellan")
		expect(compiled.length).toBe(before)
		// Where the party stand: the world's location.
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(db as unknown as Db, { sessionId, updatedBy: "user" } as never, {
			owner: { kind: "session", id: sessionId },
			slotId: "core:slot/location@1",
			value: "The Gate Hall"
		} as never)
	})

	test("a guest takes a seat: the GM is told in the Sanctum, and the Sanctum is the GM's alone", async () => {
		const { sessionsAddGuestHandler, sessionsUpdateHandler, sessionsViewHandler } = await import("./sessions")
		const added: any = await sessionsAddGuestHandler.handler(fakeSocket(ownerId), { sessionId, guestUserId: guestId } as any, emit)
		expect(added?.success, added?.error).toBe(true)
		const seated: any = await sessionsUpdateHandler.handler(fakeSocket(guestId), { session: { id: sessionId }, seatName: "Rook" } as any, emit)
		expect(seated?.error, seated?.error).toBeUndefined()
		await settle()
		const [seat] = await db
			.select()
			.from(schema.sessionPersonas)
			.where(and(eq(schema.sessionPersonas.sessionId, sessionId), eq(schema.sessionPersonas.userId, guestId)))
		rookSeat = seat!.id
		const told = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && /Rook has joined the table/.test(r.content ?? "")))
		expect(meta(told).speaker).toBe("envoy:castellan")

		// D6: the guest's view leaves the Sanctum out — the channel list, the rows, the send.
		const view: any = await sessionsViewHandler.handler(fakeSocket(guestId), { sessionId } as any, emit)
		expect(view.channels).toEqual(["main"])
		const gmView: any = await sessionsViewHandler.handler(fakeSocket(ownerId), { sessionId } as any, emit)
		expect(gmView.channels).toContain("sanctum")
		const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
		const guestLane = await laneViewFor(db as any, sessionId, guestId)
		const seen = await db
			.select({ channel: schema.sessionMessages.channel })
			.from(schema.sessionMessages)
			.where(and(eq(schema.sessionMessages.sessionId, sessionId), laneViewWhere(schema.sessionMessages.channel, guestLane)))
		expect(seen.some((r) => r.channel === "sanctum")).toBe(false)
		const { laneScopedRecipients } = await import("$lib/server/channels/lanePush")
		const recipients = await laneScopedRecipients(db as any, sessionId, "sessionMessage", { sessionMessage: told }, [ownerId, guestId])
		expect(recipients.map((r) => r.userId)).toEqual([ownerId])
		const refused = await send(guestId, "Hello, Castellan?", "sanctum")
		expect(JSON.stringify(refused)).toMatch(/owner's alone/)
	})

	test("the GM's talk in the Sanctum: the Castellan answers there, and the scratchpad routine keeps its notes — never on a row written whole", async () => {
		// The greeting and the welcome note are the Castellan's Sanctum rows,
		// written whole: they woke no scratchpad.
		expect(await runsOf("core:spec/lair-scratchpad")).toEqual([])
		const res = await send(ownerId, "Plan a trap in the vault.", "sanctum")
		expect(res?.error, res?.error).toBeUndefined()
		const answer = await until(async () =>
			(await rowsOf()).find((r) => r.channel === "sanctum" && r.content === "Noted, Dungeon Master." && !r.isGenerating)
		)
		expect(meta(answer).speaker).toBe("envoy:castellan")
		const kept = await until(async () => {
			const runs = await runsOf("core:spec/lair-scratchpad")
			return runs.length ? runs : null
		})
		expect(kept).toHaveLength(1)
		await settle()
		const [row] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect(JSON.stringify(row!.annex)).toContain("The vault door is trapped.")
	})

	let rollRowId = 0
	let diceRowId = 0
	test("direction → the plan → a roll form held for the GM; its answer rolls, the Oracle posts the dice, the voices follow", async () => {
		const { lairRulesRow, visItinerisRuleset, LAIR_ROLL_ANSWER_ACTION } = await import("@serene-pub/core-catalog")
		const check = lairRulesRow(visItinerisRuleset).checks.find((c) => c.key.includes("sleight"))!
		planQueue.push({
			beats: ["Brannoc kneels at the vault door.", "Rook keeps watch.", "Verity listens."],
			speakers: [
				{ name: "Brannoc", intent: "pick the lock" },
				{ name: "Rook", intent: "keep watch" },
				{ name: "Verity", intent: "listen at the door" }
			],
			risks: [{ who: "Brannoc", attempt: "pick the lock", check: check.key, difficulty: "Hard" }],
			unknownExit: "",
			knockQuestion: "",
			worldHints: { location: "The Gate Hall" }
		})
		const sent = await send(ownerId, "The party reach the vault door.")
		expect(sent?.error, sent?.error).toBeUndefined()
		const planRow = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && meta(r).turnPlan))
		const plan = meta(planRow).turnPlan
		expect(plan.turns).toEqual([`character:${brannoc}`, `player-seat:${rookSeat}`, `character:${verity}`])
		expect(plan.waits).toEqual([`player-seat:${rookSeat}`])
		expect(plan.rolls?.forms?.length).toBe(1)
		rollRowId = plan.rolls.messageId
		const rollRow = (await rowsOf()).find((r) => r.id === rollRowId)!
		expect(rollRow.channel).toBe("main")
		expect(meta(rollRow).speaker).toBe("envoy:oracle")
		const [form] = await blocksOf(rollRowId)
		expect(form).toMatchObject({ kind: "roll", addressee: "owner", stat: check.key, band: "hard", referent: "Brannoc", vantage: "pick the lock" })
		// Held: no delver speaks while the form is open.
		await settle()
		expect((await rowsOf()).some((r) => r.characterId === brannoc)).toBe(false)
		expect(await turnOrder()).toEqual([])

		// The GM calls it: the check offered, hard.
		const answered = await fire(ownerId, LAIR_ROLL_ANSWER_ACTION, rollRowId, form.id, { check: true, stat: check.key, band: "hard" })
		expect(answered?.error, answered?.error).toBeUndefined()
		const dice = await until(async () => (await rowsOf()).find((r) => meta(r).answersForm?.messageId === rollRowId))
		diceRowId = dice.id
		expect(meta(dice).speaker).toBe("envoy:oracle")
		const [diceBlock] = await blocksOf(dice.id)
		expect(diceBlock).toMatchObject({ kind: "dice", stat: check.label, against: 20, by: `character:${brannoc}` })
		expect(typeof diceBlock.rolled).toBe("number")
		expect(meta(dice).diceWords).toBe(`Brannoc — ${check.label}: ${String(diceBlock.outcome).replace(/[.!]+$/, "")}.`)
		const [stamped] = await blocksOf(rollRowId)
		expect(stamped.answered?.value).toBe(`${check.label} — Hard`)

		// Released: Brannoc takes his turn; Rook's seat waits for its person.
		const line = await until(async () => (await rowsOf()).find((r) => r.characterId === brannoc && !r.isGenerating))
		expect(line.content).toMatch(/Brannoc steps forward/)
		await settle()
		const order = await turnOrder()
		expect(order[0]).toMatchObject({ ref: `player-seat:${rookSeat}`, via: "plan" })
		expect((await rowsOf()).some((r) => r.characterId === verity)).toBe(false)

		// The GM's Continue moves past the waiting player: Verity speaks.
		const cont = await fireContinue()
		expect(cont?.error, cont?.error).toBeUndefined()
		await until(async () => (await rowsOf()).find((r) => r.characterId === verity && !r.isGenerating))
		const after = (await rowsOf()).find((r) => r.id === planRow.id)!
		expect(meta(after).turnPlan.skipped).toEqual([`player-seat:${rookSeat}`])
		await settle()
		expect((await turnOrder()).some((e) => e.ref === `player-seat:${rookSeat}`)).toBe(false)

		// The round is over: the keeper routine kept the books.
		const kept = await until(async () => (await runsOf("core:spec/lair-keeper")).length > 0)
		expect(kept).toBe(true)
		expect(compiled.some((p) => p.includes(KEEPER))).toBe(true)
	})

	test("a seated player's own line is their turn — never the GM's direction", async () => {
		planQueue.push({
			beats: ["Rook raises the torch.", "Brannoc follows."],
			speakers: [
				{ name: "Rook", intent: "light the way" },
				{ name: "Brannoc", intent: "follow" }
			],
			risks: [],
			unknownExit: "",
			knockQuestion: "",
			worldHints: { location: "The Gate Hall" }
		})
		const from = (await rowsOf()).length
		await send(ownerId, "A cold draught blows from the vault.")
		await until(async () => {
			const order = await turnOrder()
			return order[0]?.ref === `player-seat:${rookSeat}` ? order : null
		})
		const brannocLines = () => rowsOf().then((rows) => rows.slice(from).filter((r) => r.characterId === brannoc))
		expect(await brannocLines()).toEqual([])
		// Rook writes their own turn: the plan goes on with Brannoc.
		const res = await send(guestId, "I hold the torch high.")
		expect(res?.error, res?.error).toBeUndefined()
		await until(async () => (await brannocLines()).find((r) => !r.isGenerating))
		// The next plan's direction is the GM's line alone.
		planQueue.push(quietPlan)
		const at = compiled.length
		await send(ownerId, "The floor tilts.")
		const planner = await until(async () => compiled.slice(at).find((p) => p.includes(PLANNER)))
		expect(planner).toMatch(/Direction this turn: The floor tilts\./)
		expect(planner).not.toMatch(/Direction this turn:[^"]*I hold the torch high/)
	})

	test("Show dice off: the dice row reads as its result in words in every prompt", async () => {
		const [row] = await db.select({ genreFields: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		await db
			.update(schema.sessions)
			.set({ genreFields: { ...((row!.genreFields as object) ?? {}), showDice: false } })
			.where(eq(schema.sessions.id, sessionId))
		const dice = (await rowsOf()).find((r) => r.id === diceRowId)!
		const [block] = await blocksOf(diceRowId)
		const at = compiled.length
		// Pick who speaks: Verity, out of turn — her prompt reads the story.
		const res = await fireContinue(ownerId, { entry: { ref: `character:${verity}` } })
		expect(res?.error, res?.error).toBeUndefined()
		const voice = await until(async () => compiled.slice(at).find((p) => p.includes(VOICE)))
		expect(voice).toContain(meta(dice).diceWords.replace(/"/g, '\\"'))
		expect(voice).not.toContain(`${block.rolled} against ${block.against}`)
	})

	test("the knock: a drafted room with its typed fields, held at the review gate, which refuses a misfit", async () => {
		planQueue.push({
			beats: [],
			speakers: [],
			risks: [],
			unknownExit: "The Drowned Hall",
			knockQuestion: "A stair goes down to the Drowned Hall. What is there?",
			worldHints: { location: "The Gate Hall" }
		})
		await send(ownerId, "They find a stair going down.")
		const knock = await until(async () => {
			for (const r of [...(await rowsOf())].reverse()) {
				const blocks = await blocksOf(r.id)
				const b = blocks.find((x) => x.kind === "choices" && !x.answered)
				if (b) return { row: r, block: b }
			}
			return null
		})
		expect(meta(knock.row).speaker).toBe("envoy:oracle")
		expect(knock.block.addressee).toBe("owner")
		// Describe it… with nothing typed: the Castellan drafts it, behind the gate.
		const { sessionsFireActionHandler } = await import("./sessions")
		const pressed: any = sessionsFireActionHandler.handler(
			fakeSocket(ownerId),
			{
				sessionId,
				action: knock.block.actions[0].action,
				messageId: knock.row.id,
				blockId: knock.block.id,
				payload: { choice: knock.block.actions[0].choice }
			} as any,
			emit
		)
		const { pendingReviewsFor, resolveReview, ReviewFieldRefused } = await import("$lib/server/pipelines/runtime/reviewGate")
		const review = await until(async () => pendingReviewsFor(ownerId).find((r) => r.definitionId.startsWith("core:outlet/create-lore-entry")))
		expect(review.values.fields ?? review.values).toBeTruthy()
		// A misfit is refused while the run stays parked.
		expect(() => resolveReview(review.id, ownerId, "edit", { fields: JSON.stringify({ terrain: "mud" }) })).toThrow(ReviewFieldRefused)
		expect(pendingReviewsFor(ownerId).some((r) => r.id === review.id)).toBe(true)
		resolveReview(review.id, ownerId, "approve")
		await pressed
		// The run went on under its own handle once the review released it.
		const hall = await until(async () => {
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(and(eq(schema.lorebookEntries.lorebookId, lorebookId), eq(schema.lorebookEntries.title, "The Drowned Hall")))
			return row
		})
		await settle()
		expect(hall?.typeId).toBe("core:entry/location")
		expect((hall!.fields as any)?.category).toBe("Undercroft")
		expect(hall!.content).toMatch(/Exits: south → The Gate Hall, east → The Vault/)
		const links = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
		const touching = links.filter((l) => l.fromEntryId === hall!.id || l.toEntryId === hall!.id)
		// The draft's way to the Vault (in the entry's own commit), and the knock's way back to where the party stand.
		expect(touching.some((l) => l.fromEntryId === hall!.id && l.toEntryId === rooms["The Vault"] && l.relationshipType === "leads east to")).toBe(true)
		expect(touching.some((l) => l.toEntryId === rooms["The Gate Hall"] || l.fromEntryId === rooms["The Gate Hall"])).toBe(true)
	})

	test("a typed room's Exits line becomes links on save (D10)", async () => {
		planQueue.push({
			beats: [],
			speakers: [],
			risks: [],
			unknownExit: "The Shaft",
			knockQuestion: "A shaft opens in the floor. What is down there?",
			worldHints: { location: "The Gate Hall" }
		})
		await send(ownerId, "Brannoc finds a shaft.")
		const knock = await until(async () => {
			for (const r of [...(await rowsOf())].reverse()) {
				const b = (await blocksOf(r.id)).find((x) => x.kind === "choices" && !x.answered)
				if (b) return { row: r, block: b }
			}
			return null
		})
		const res = await fire(
			ownerId,
			knock.block.actions[0].action,
			knock.row.id,
			knock.block.id,
			{ choice: knock.block.actions[0].choice },
			"A narrow shaft of wet rock.\n\nExits: up → The Vault"
		)
		expect(res?.error, res?.error).toBeUndefined()
		const [shaft] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(and(eq(schema.lorebookEntries.lorebookId, lorebookId), eq(schema.lorebookEntries.title, "The Shaft")))
		expect(shaft?.content).toBe("A narrow shaft of wet rock.\n\nExits: up → The Vault")
		const [up] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(and(eq(schema.narrativeRelationships.fromEntryId, shaft!.id), eq(schema.narrativeRelationships.toEntryId, rooms["The Vault"]!)))
		expect(up?.relationshipType).toBe("leads up to")
		expect(up?.reverseRelationshipType ?? null).toBeNull()
	})

	test("update-lore-entry@1: a change lands; a misfit and a name nothing answers to are refused", async () => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const host = createHost(db as any, { sessionId, userId: ownerId })
		const node = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
		const out: any = await host.commit!({ entry: "The Vault", content: "A treasury, its seal broken.", fields: { category: "Vaults" } }, node)
		expect(out.entryId).toBe(rooms["The Vault"])
		const [vault] = await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, rooms["The Vault"]!))
		expect(vault!.content).toBe("A treasury, its seal broken.")
		expect((vault!.fields as any).category).toBe("Vaults")
		await expect(host.commit!({ entry: rooms["The Vault"], fields: { terrain: "stone" } }, node)).rejects.toThrow(/terrain/)
		await expect(host.commit!({ entry: "The Nowhere Room", content: "x" }, node)).rejects.toThrow(/nothing to change/)
		// `null` clears a field.
		await host.commit!({ entry: rooms["The Vault"], fields: { category: null } }, node)
		const [cleared] = await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, rooms["The Vault"]!))
		expect((cleared!.fields as any).category).toBeUndefined()
	})

	test("Regenerate the last turn takes the roll forms and the dice with it", async () => {
		const { turnUnitAt } = await import("$lib/server/sessions/rewind")
		const verdict = await turnUnitAt(db as any, sessionId, diceRowId, { includePersonLines: false })
		expect(verdict.ok).toBe(true)
		if (!verdict.ok) return
		expect(verdict.unit.run?.specSlug).toBe("core:spec/lair-reply")
		const ids = verdict.unit.rows.map((r) => r.messageId)
		expect(ids).toContain(rollRowId)
		expect(ids).toContain(diceRowId)
	})
})

describe("The rules decide (was Rules and dice), Decide checks at once: the plan's risks are decided at once", () => {
	test("the dice land before the plan row, no form is asked, and the voices go on", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const [dice] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-lair-rules-and-dice"))
		const res: any = await sessionsCreateHandler.handler(
			fakeSocket(ownerId),
			{
				session: { name: "The auto walk", presetId: dice!.id, lorebookId, primaryRuleset: "core:ruleset/vis-itineris@1" },
				characterIds: [brannoc],
				personaIds: [],
				characterPositions: {},
				tags: []
			} as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		sessionId = res.session.id
		await settle()
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect(row!.rigour).toBe("scripts")
		await db
			.update(schema.sessions)
			.set({ genreFields: { ...((row!.genreFields as object) ?? {}), autoRoll: true } })
			.where(eq(schema.sessions.id, sessionId))
		const { lairRulesRow, visItinerisRuleset } = await import("@serene-pub/core-catalog")
		const check = lairRulesRow(visItinerisRuleset).checks.find((c) => c.key.includes("athletics"))!
		planQueue.push({
			beats: ["Brannoc climbs the wall."],
			speakers: [{ name: "Brannoc", intent: "climb" }],
			risks: [{ who: "Brannoc", attempt: "climb the wall", check: check.key, difficulty: "Easy" }],
			unknownExit: "",
			knockQuestion: "",
			worldHints: { location: "The Gate Hall" }
		})
		await send(ownerId, "The wall is slick with damp.")
		const planRow = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && meta(r).turnPlan))
		expect(meta(planRow).turnPlan.rolls).toBeUndefined()
		const rows = await rowsOf()
		const diceRow = rows.find((r) => meta(r).speaker === "envoy:oracle")!
		expect(diceRow.id).toBeLessThan(planRow.id)
		expect(meta(diceRow).answersForm).toBeUndefined()
		const [block] = await blocksOf(diceRow.id)
		expect(block).toMatchObject({ kind: "dice", stat: check.label, against: 10, by: `character:${brannoc}` })
		// No form was put to the GM: the delver's turn follows at once.
		await until(async () => (await rowsOf()).find((r) => r.characterId === brannoc && !r.isGenerating))
	})
})

/**
 * 🚧 Rulesets M2 (2026-10-22): the roll forms and the answer path read
 * **method bands** — any check method that holds difficulty bands, not only
 * a die. A ruleset whose contests are a comparison against a target, under
 * Decide checks at once: the plan's risk is compared at once and the Oracle
 * posts the comparison's outcome block.
 */
describe("a ruleset with no dice: a comparison against the rules' bands (M2)", () => {
	test("the risk is compared against the band, and the Oracle posts a compare outcome block", async () => {
		const { defineAttributeSlot, defineRuleset, getRuleset } = await import("@serene-pub/sdk")
		const RESOLVE = "test:slot/lair-resolve@1"
		const CONTEST = "test:ruleset/lair-contest@1"
		if (!getRuleset(CONTEST)) {
			defineAttributeSlot(RESOLVE, { type: "integer", label: { en: "Resolve" }, descriptor: "How steady.", appliesTo: ["cast"], config: { min: 0, max: 10 }, default: 4 })
			defineRuleset(CONTEST, {
				name: { en: "Contest" },
				voice: { prose: "Contests, in words.", mechanics: "Contests are compared, never rolled." },
				conventions: {
					methods: {
						contest: {
							kind: "compare",
							modifierOf: "lair-resolve",
							bands: [
								{ id: "even", label: { en: "Even" }, target: 3, default: true },
								{ id: "steep", label: { en: "Steep" }, target: 6 }
							]
						}
					},
					time: { unit: "scene" }
				},
				stats: [{ id: RESOLVE }],
				selectors: { resist: { kind: "check", base: "lair-resolve" } },
				repertoires: []
			})
		}
		const { sessionsCreateHandler } = await import("./sessions")
		const [dice] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-lair-rules-and-dice"))
		const res: any = await sessionsCreateHandler.handler(
			fakeSocket(ownerId),
			{
				session: { name: "The contest walk", presetId: dice!.id, lorebookId, primaryRuleset: "core:ruleset/vis-itineris@1" },
				characterIds: [brannoc],
				personaIds: [],
				characterPositions: {},
				tags: []
			} as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		sessionId = res.session.id
		await settle()
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		await db
			.update(schema.sessions)
			.set({ primaryRuleset: CONTEST, genreFields: { ...((row!.genreFields as object) ?? {}), autoRoll: true } })
			.where(eq(schema.sessions.id, sessionId))
		const { sessionRulesetInput } = await import("$lib/server/pipelines/runtime/runTurn")
		const inlet = await sessionRulesetInput(db as any, sessionId)
		expect(inlet).toMatchObject({ id: CONTEST, dice: true, checks: [{ key: "resist", label: "Resist" }], band: "even", methods: ["compare"], chance: false })
		planQueue.push({
			beats: ["Brannoc stares down the gatekeeper."],
			speakers: [{ name: "Brannoc", intent: "stare" }],
			risks: [{ who: "Brannoc", attempt: "stare him down", check: "resist", difficulty: "Even" }],
			unknownExit: "",
			knockQuestion: "",
			worldHints: { location: "The Gate Hall" }
		})
		await send(ownerId, "The gatekeeper will not budge.")
		const oracle = await until(async () => (await rowsOf()).find((r) => meta(r).speaker === "envoy:oracle" && meta(r).diceWords))
		const [block] = await blocksOf(oracle.id)
		expect(block).toMatchObject({ kind: "dice", method: "compare", stat: "Resist", against: 3, by: `character:${brannoc}` })
		expect(typeof block.rolled).toBe("number")
		expect(block.faces).toBeUndefined()
		// The words with no number say how it was decided.
		expect(meta(oracle).diceWords).toBe(`Brannoc — Resist, by comparison: ${String(block.outcome).replace(/[.!]+$/, "")}.`)
	})
})

/**
 * 🚧 Lair fix 2 (2026-10-22), the owner's walk: a party of one. The planner
 * named nobody and nothing was written; a picked turn wrote as the Dungeon
 * Master; its run left no `pipeline_runs` row.
 */
describe("lair fix 2: a party of one", () => {
	let suzume: number
	test("a plan naming nobody: the one delver takes the turn, the GM's lines read as the Dungeon Master's and are stopped on", async () => {
		const { sessionsCreateHandler } = await import("./sessions")
		const [c] = await db.insert(schema.characters).values({ userId: ownerId, name: "Suzume Akagane", nickname: "Suzume", description: "A ronin." }).returning()
		suzume = c!.id
		const [rules] = await db
			.select({ id: schema.sessionPresets.id })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, "core-lair-default"))
		const res: any = await sessionsCreateHandler.handler(
			fakeSocket(ownerId),
			{
				session: { name: "Session with Suzume", presetId: rules!.id, lorebookId, primaryRuleset: "core:ruleset/vis-itineris@1" },
				characterIds: [suzume],
				personaIds: [],
				characterPositions: {},
				tags: []
			} as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		sessionId = res.session.id
		await settle()
		// The planner restates the GM's event and names nobody (the owner's data).
		planQueue.push({ ...quietPlan, beats: ["Suzume lands with a thud."], speakers: [] })
		const from = calls.length
		await send(ownerId, "The floor gives way and Suzume tumbles into a dark chamber.")
		const planRow = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && meta(r).turnPlan))
		expect(meta(planRow).turnPlan.plan.speakers).toEqual([{ name: "Suzume Akagane", intent: "" }])
		const line = await until(async () => (await rowsOf()).find((r) => r.characterId === suzume && !r.isGenerating))
		expect(line.content).toMatch(/Suzume steps forward/)
		// Her turn's transcript names the GM as the prompt does, and the GM's
		// label — and the Castellan's — are stops; her own is not.
		const voice = calls.slice(from).find((c) => c.prompt.includes(VOICE))!
		expect(voice.prompt).toContain("Dungeon Master: The floor gives way")
		expect(voice.prompt).not.toContain("user: The floor gives way")
		const sent = (voice.stops?.sent ?? []).map((x: any) => x.value)
		expect(sent).toEqual(expect.arrayContaining(["\nDungeon Master:", "\nCastellan:", "\nOracle:"]))
		expect(sent).not.toContain("\nSuzume Akagane:")
	})

	/**
	 * 🚧 RF fix 2 (2026-10-23): "the character responds as if they are the
	 * narrator, using 'you'". The owner's turn sent the voice's system prompt
	 * and the GM's one line — nothing after it said whose turn it was (the
	 * seed line is dropped on the chat wire, no cue follows a user turn in a
	 * party of one, the reminder waited for 3000 tokens) — and an RP model
	 * answered as the GM: "*You materialize in a dimly lit chamber…*".
	 */
	test("RF fix 2: the character call's prompt — her own system prompt, her person said outright, and after the GM's line, whose turn it is", async () => {
		const voice = calls.find((c) => c.prompt.includes(VOICE) && c.prompt.includes("Suzume"))!
		const { messages } = JSON.parse(voice.prompt) as { messages: Array<{ role: string; content: string }> }
		const [system, ...turns] = messages
		// The voice's own row, never the GM's framing: not the Castellan's, not the planner's.
		expect(system!.role).toBe("system")
		expect(system!.content).toContain("You are Suzume, taking your turn in a dungeon")
		expect(system!.content).toContain("what Suzume says, in quotes and in the first person, and what Suzume does while saying it, in the third person, by name")
		expect(system!.content).toContain('Never narrate in the second person — no "you see", "you feel", "you find yourself"')
		expect(system!.content).not.toMatch(/telling you what happens|the world around you|steward of a dungeon|narrate what happens next|plan the party's next moment/)
		// The GM's one line, and right after it the reminder — no 3000-token wait.
		expect(turns).toHaveLength(1)
		expect(turns[0]!.role).toBe("user")
		expect(turns[0]!.content).toMatch(/^Dungeon Master: The floor gives way and Suzume tumbles into a dark chamber\.\n\n\[System note\]\nResponse reminder:/)
		expect(turns[0]!.content).toContain("Remember: it is Suzume's turn, and only Suzume's, at The Gate Hall.")
		expect(turns[0]!.content).toContain('What Suzume says, in the first person, and what Suzume does, in the third: never narration to a "you"')
	})

	test("Pick who speaks: the picked turn leaves its pipeline_runs row", async () => {
		const res = await fireContinue(ownerId, { entry: { ref: `character:${suzume}` } })
		expect(res?.error, res?.error).toBeUndefined()
		expect(typeof res?.runId).toBe("string")
		await settle()
		const [run] = await db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, res.runId))
		expect(run?.specSlug).toBe("core:spec/lair-reply")
		expect(run?.outcome).toBe("ok")
	})

	test("a run that throws after its row settled still records its receipt", async () => {
		const before = (await runsOf("core:spec/lair-reply")).map((r) => r.id)
		throwAfter.spec = "core:spec/lair-reply"
		await fireContinue(ownerId, { entry: { ref: `character:${suzume}` } })
		await settle()
		expect(throwAfter.spec).toBeNull()
		const fresh = (await runsOf("core:spec/lair-reply")).filter((r) => !before.includes(r.id))
		expect(fresh).toHaveLength(1)
		const receipt = fresh[0]!.receipt as any
		expect(receipt.notes).toEqual(expect.arrayContaining([expect.stringContaining("the run ended by throwing")]))
		// The line it wrote is the run's artifact, and stands.
		const artifacts = await db.select().from(schema.pipelineRunArtifacts).where(eq(schema.pipelineRunArtifacts.runId, fresh[0]!.id))
		const messageId = artifacts.find((a) => a.kind === "message")?.entityId
		const row = (await rowsOf()).find((r) => r.id === messageId)
		expect(row?.characterId).toBe(suzume)
		expect(row?.isGenerating).toBe(false)
	})
})

/**
 * 🚧 S4 + ★F (2026-10-23): what the rules decide is read off the session's
 * ruleset at run time — its sections, its words — never a table baked from
 * core's rulesets, and *The rules decide* locks no ruleset: the session plays
 * its book's rules. Two walks beside Vis Itineris's: Wherewithal (a contest,
 * no dice) and a ruleset made on the pub from scratch with one comparison.
 */
async function bookOf(name: string, primaryRuleset: string): Promise<number> {
	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name, primaryRuleset } as any).returning()
	await db
		.insert(schema.lorebookEntries)
		.values({ lorebookId: book!.id, typeId: "core:entry/location", typeVersion: 1, position: 1, title: "The Gate Hall", content: "Cold stone." } as any)
	return book!.id
}

async function startOn(book: number, seedKey: string, name: string): Promise<void> {
	const { sessionsCreateHandler } = await import("./sessions")
	const [preset] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: preset!.id, lorebookId: book }, characterIds: [brannoc], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	sessionId = res.session.id
	await settle()
}

const WHEREWITHAL = "core:ruleset/wherewithal@1"

describe("🚧 S4/★F: a walk under Wherewithal — The rules decide plays the book's rules, a contest put to the GM", () => {
	test("the session keeps Wherewithal, its contest is the form's one check, and the Oracle posts the comparison", async () => {
		await startOn(await bookOf("The contest dungeon", WHEREWITHAL), "core-lair-rules-and-dice", "The Wherewithal walk")
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		// ★F: no ruleset is locked — the book's rules stand; How strict is the preset's.
		expect([row!.primaryRuleset, row!.rigour]).toEqual([WHEREWITHAL, "scripts"])
		const { sessionRulesetInput } = await import("$lib/server/pipelines/runtime/runTurn")
		const inlet = await sessionRulesetInput(db as any, sessionId)
		expect(inlet).toMatchObject({
			id: WHEREWITHAL,
			dice: true,
			checks: [{ key: "contest", label: "Mettle against mettle" }],
			band: "even",
			methods: ["none", "bid", "compare"],
			chance: false
		})
		expect(inlet.outcomes?.map((o) => o.label)).toEqual(["It comes apart", "It falls short", "It holds, at a cost", "It carries", "It carries clean"])
		planQueue.push({
			...quietPlan,
			beats: ["Brannoc squares up to the gatekeeper."],
			speakers: [{ name: "Brannoc", intent: "stare him down" }],
			// The planner names the check in its plain words and the difficulty by its label.
			risks: [{ who: "Brannoc", attempt: "stare him down", check: "Contest", difficulty: "Steep" }]
		})
		await send(ownerId, "The gatekeeper will not budge.")
		const planRow = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && meta(r).turnPlan))
		const rollRowId = meta(planRow).turnPlan.rolls.messageId
		const [form] = await blocksOf(rollRowId)
		expect(form).toMatchObject({ kind: "roll", addressee: "owner", stat: "contest", band: "steep", referent: "Brannoc" })
		expect(form.stats).toEqual([{ key: "contest", label: "Mettle against mettle" }])
		expect(form.bands.map((b: any) => b.id)).toEqual(["slight", "even", "steep", "towering"])
		const { LAIR_ROLL_ANSWER_ACTION } = await import("@serene-pub/core-catalog")
		const answered = await fire(ownerId, LAIR_ROLL_ANSWER_ACTION, rollRowId, form.id, { check: true, stat: "contest", band: "steep" })
		expect(answered?.error, answered?.error).toBeUndefined()
		const dice = await until(async () => (await rowsOf()).find((r) => meta(r).answersForm?.messageId === rollRowId))
		expect(meta(dice).speaker).toBe("envoy:oracle")
		const [block] = await blocksOf(dice.id)
		expect(block).toMatchObject({ kind: "dice", method: "compare", stat: "Mettle against mettle", against: 5, by: `character:${brannoc}` })
		expect(block.faces).toBeUndefined()
		// Its outcome is one of the ruleset's own words.
		expect(inlet.outcomes!.map((o) => o.label)).toContain(String(block.outcome).replace(/[.!]+$/, ""))
		const [stamped] = await blocksOf(rollRowId)
		expect(stamped.answered?.value).toBe("Mettle against mettle — Steep")
	})
})

describe("🚧 S4: a walk under a ruleset made on the pub from scratch, with one comparison — first class", () => {
	test("published from scratch, its comparison is the table's check in its own words, decided at once", async () => {
		const { createPubRuleset, publishPubRuleset, rulesetDetail, saveRulesetDraft } = await import("$lib/server/rulesets/pubRulesets")
		const { rulesetId } = await createPubRuleset(db as any, { ownerSlug: "lairwalk", name: "odds", label: "Odds", userId: ownerId })
		const draft = (await rulesetDetail(db as any, rulesetId))!.draft as unknown as Record<string, unknown>
		const saved = await saveRulesetDraft(db as any, rulesetId, {
			...draft,
			voice: { prose: "Odds, in words.", mechanics: "The odds are weighed for you." },
			attributes: [{ id: "nerve", name: { en: "Nerve" }, kind: "number", bounds: { min: 0, max: 6 }, start: 3, prose: "How steady someone is." }],
			functions: [
				{
					ref: "core:function/compare@1",
					key: "face-down",
					options: {
						label: { en: "Nerve against the odds" },
						modifierOf: "nerve",
						bands: [
							{ id: "even", label: { en: "Even odds" }, target: 3, default: true },
							{ id: "long", label: { en: "Long odds" }, target: 6 }
						]
					}
				}
			],
			outcomes: [
				{ id: "folds", label: { en: "Folds" }, five: "fail" },
				{ id: "holds", label: { en: "Holds" }, five: "success" }
			]
		})
		expect(saved.findings).toEqual([])
		await publishPubRuleset(db as any, rulesetId, { userId: ownerId })
		await startOn(await bookOf("The odds dungeon", rulesetId), "core-lair-rules-and-dice", "The odds walk")
		const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		expect([row!.primaryRuleset, row!.rigour]).toEqual([rulesetId, "scripts"])
		await db
			.update(schema.sessions)
			.set({ genreFields: { ...((row!.genreFields as object) ?? {}), autoRoll: true } })
			.where(eq(schema.sessions.id, sessionId))
		const { sessionRulesetInput } = await import("$lib/server/pipelines/runtime/runTurn")
		expect(await sessionRulesetInput(db as any, sessionId)).toMatchObject({
			id: rulesetId,
			dice: true,
			checks: [{ key: "face-down", label: "Nerve against the odds" }],
			bands: [
				{ id: "even", label: "Even odds", target: 3 },
				{ id: "long", label: "Long odds", target: 6 }
			],
			band: "even",
			methods: ["compare"],
			outcomes: [
				{ id: "folds", label: "Folds", five: "fail" },
				{ id: "holds", label: "Holds", five: "success" }
			]
		})
		planQueue.push({
			...quietPlan,
			beats: ["Brannoc stares into the dark."],
			speakers: [{ name: "Brannoc", intent: "hold his nerve" }],
			risks: [{ who: "Brannoc", attempt: "hold his nerve", check: "Nerve against the odds (face-down)", difficulty: "Long odds (6)" }]
		})
		await send(ownerId, "Something breathes in the dark.")
		const planRow = await until(async () => (await rowsOf()).find((r) => r.channel === "sanctum" && meta(r).turnPlan))
		// Decided at once: no form waits on the GM.
		expect(meta(planRow).turnPlan.rolls).toBeUndefined()
		const oracle = await until(async () => (await rowsOf()).find((r) => meta(r).speaker === "envoy:oracle" && meta(r).diceWords))
		expect(oracle.id).toBeLessThan(planRow.id)
		const [block] = await blocksOf(oracle.id)
		expect(block).toMatchObject({ kind: "dice", method: "compare", stat: "Nerve against the odds", against: 6, by: `character:${brannoc}` })
		expect(["Folds", "Holds"]).toContain(String(block.outcome).replace(/[.!]+$/, ""))
		expect(meta(oracle).diceWords).toBe(`Brannoc — Nerve against the odds, by comparison: ${String(block.outcome).replace(/[.!]+$/, "")}.`)
		await until(async () => (await rowsOf()).find((r) => r.characterId === brannoc && !r.isGenerating))
	})
})
