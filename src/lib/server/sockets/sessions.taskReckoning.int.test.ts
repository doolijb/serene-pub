/**
 * 🚧 The **reckoning** after a Story reply (PLAN-genre-restructure §4, lane 2,
 * 2026-10-19), on real turns with a scripted model: *Keep the sheets* on
 * Review files every change — belongings included — as a proposal instead
 * of dropping it; a lorebook item's supply is checked (phase 3b: a unique
 * item is never handed out twice); and *Describe new places* files the
 * place a move reached, linked to the places the book knows. The session's
 * task modes are what the host's own handlers read.
 *
 * 🚧 Since PLAN-layering (lanes 3, 5a, 6, 2026-10-20) the reckoning is a
 * **routine** — `core:spec/story-reckoning`, after each round — run by the
 * routine queue once the reply has settled; the session's old task choices
 * are its duties and its mode (`applyLegacyTasks` writes them there).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "task-reckoning-test-secret" }
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

/** What the reckoning answers this turn; 🚧 what the reply answers (S2: JSON while it carries changes); every other call says a line. */
const script = vi.hoisted(() => ({ reckoning: "" as string, reply: "They walk on." as string }))
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
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the record of a story")
			? script.reckoning
			: asked.includes("You keep the books of a story")
				? "They walk on."
				: script.reply
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let bookId: number
let crownId: number
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-reckoning-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-reckoning-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reckon-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Task reckoning test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "The Old Keep" }).returning()
	bookId = book!.id
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	await db.insert(schema.lorebookEntries).values(
		entryInsert({ typeId: "core:entry/location", lorebookId: bookId, name: "The Gatehouse", content: "Where the road ends.", position: 1 } as any)
	)
	const [crown] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({ typeId: "core:entry/item", lorebookId: bookId, name: "The Iron Crown", content: "There is only one.", supply: "unique", position: 1 } as any)
		)
		.returning({ id: schema.lorebookEntries.id })
	crownId = crown!.id
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
}, 180_000)

afterAll(async () => {
	;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

async function aCharacter(name: string) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name, description: "A traveller.", isPersona: false }).returning()
	return c!.id
}

async function living(name: string, characterIds: number[], tasks: Record<string, "full" | "review" | "off"> = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId("core-story-living") }, characterIds, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ lorebookId: bookId }).where(eq(schema.sessions.id, sessionId))
	// The retired task choices, where they live now: the reckoning's duties and its mode.
	const { applyLegacyTasks } = await import("$lib/server/utils/testDb")
	await applyLegacyTasks(db, sessionId, { v: 1, tasks: Object.fromEntries(Object.entries(tasks).map(([k, mode]) => [k, { mode }])) })
	return sessionId
}

/**
 * The reckoning after each TURN in this session — an administrator's swap of
 * its cadence (R12, R36): the genre's after-each-round registration dropped,
 * the same pipeline registered after each turn. For a session of two cast
 * members, where the round ends only once both have spoken.
 */
async function reckonEveryTurn(sessionId: number) {
	const { afterEachTurn, register } = await import("@serene-pub/sdk")
	const { STORY_RECKONING_SPEC_ID } = await import("@serene-pub/core-catalog")
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const { rowOfDecl, rowOfDrop } = await import("$lib/server/pipelines/registrations/rows")
	const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
	const round = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_RECKONING_SPEC_ID)!
	const scope = { kind: "session" as const, sessionId }
	await upsertRow(db as never, rowOfDrop(round.key, scope, "admin"))
	await upsertRow(
		db as never,
		rowOfDecl(register(afterEachTurn(), STORY_RECKONING_SPEC_ID, { ...(round.values ? { values: round.values } : {}), ...(round.mode ? { mode: round.mode } : {}) }), scope, "admin")
	)
}

async function turn(sessionId: number, reckoning: unknown) {
	script.reckoning = JSON.stringify(reckoning)
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content: "We go on.", channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

/** 🚧 One change, in the reckoning's one grammar (S1, 2026-10-23: the reply schema's), every member present. */
const change = (d: Record<string, unknown>) => ({
	owner: "world",
	changes: "attribute",
	attribute: "",
	entryType: "",
	op: "add",
	value: "",
	name: "",
	reason: "the reply said so",
	...d
})
const entry = (d: Record<string, unknown>) => change({ changes: "entry", ...d })

describe("the reckoning (lane 2; a routine since lane 6)", () => {
	it("the host reads the reckoning routine's duties at its mode: the session's over the preset's", async () => {
		const sessionId = await living("reckon-modes", [await aCharacter("Ash")], { attributes: "review", "timed-expiry": "off" })
		const { sessionDutiesOf } = await import("$lib/server/pipelines/routines/sessionRoutines")
		const { reckoningDuties } = await import("@serene-pub/contracts")
		const modes = (await sessionDutiesOf(db as any, sessionId, reckoningDuties.id))!
		// One mode for the routine (R37): a duty on Review anywhere makes it Review.
		expect(modes).toMatchObject({ attributes: "review", "timed-expiry": "off", conditions: "review" })
		expect(modes).not.toHaveProperty("whispers")
		expect(modes).not.toHaveProperty("lore-retrieval")
		const { expiryOf } = await import("$lib/server/rulesets/resolve")
		expect(expiryOf(modes)).toEqual({ pieces: false, review: false, conditions: true })
	}, 180_000)

	it("Keep the sheets on Review: a value the reply changed waits as a proposal; nothing is applied", async () => {
		const ash = await aCharacter("Bram")
		const sessionId = await living("reckon-review", [ash], { attributes: "review", time: "off", "places-on-move": "off" })
		// 🚧 RF fix 8: attributes are the rules' — Wherewithal keeps a mood (borrowed); Freeform keeps none.
		await db.update(schema.sessions).set({ primaryRuleset: "core:ruleset/wherewithal@1" }).where(eq(schema.sessions.id, sessionId))
		await turn(sessionId, { changes: [change({ owner: `character:${ash}`, op: "set", attribute: "mood", value: "wary" })], clock: [], place: [] })
		const { pendingProposals } = await import("$lib/server/state/write")
		const pending = await pendingProposals(db as any, sessionId)
		expect(pending.length, "the change was proposed, not dropped").toBeGreaterThan(0)

		// An entry the rules keep (a thing gained) goes through the ruleset
		// handler in its `propose` mode — lane 1 dropped it. ⚠ A fresh Story
		// session tracks no list for Freeform's entry types, so the handler
		// refuses it there as `unknown-repertoire`; a session that tracks one
		// gets a proposal.
		await turn(sessionId, { changes: [entry({ owner: `character:${ash}`, op: "add", entryType: "things", name: "Rope" })], clock: [], place: [] })
		const runs = await db.select({ receipt: schema.pipelineRuns.receipt }).from(schema.pipelineRuns).where(eq(schema.pipelineRuns.sessionId, sessionId))
		const held = runs
			.flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
			.find((n) => (n.key ?? n.nodeKey) === "reckon.on.commit.ruledHeld.propose")
		expect(held, "the Review arm ran").toBeTruthy()
		expect(held.outputs?.facts?.mode ?? held.output?.facts?.mode).toBe("propose")
		const applied = runs
			.flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
			.find((n) => (n.key ?? n.nodeKey) === "reckon.on.commit.ruled.apply")
		expect(applied, "nothing on Review is applied").toBeUndefined()
	}, 180_000)

	it("a unique item is handed out once: the second grant is refused by its supply", async () => {
		const cara = await aCharacter("Cara")
		const dov = await aCharacter("Dov")
		const sessionId = await living("reckon-supply", [cara, dov], { time: "off", "places-on-move": "off", conditions: "off" })
		await reckonEveryTurn(sessionId)
		const grant = (who: number) => entry({ owner: `character:${who}`, op: "add", entryType: "things", name: "the iron crown" })
		await turn(sessionId, { changes: [grant(cara)], clock: [], place: [] })
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const once = (await itemSupplyFor(db as any, sessionId, [crownId]))[0]!
		expect(once.held).toBe(1)
		expect(once.remaining).toBe(0)

		await turn(sessionId, { changes: [grant(dov)], clock: [], place: [] })
		const twice = (await itemSupplyFor(db as any, sessionId, [crownId]))[0]!
		expect(twice.held, "the crown stayed one").toBe(1)
		expect(twice.holders.map((h) => h.ownerId)).toEqual([expect.any(Number)])
	}, 180_000)

	it("🚧 S2: while replies carry changes, the reckoning's sheets and conditions step aside — nothing is counted twice", async () => {
		const gwen = await aCharacter("Gwen")
		const sessionId = await living("reckon-reply-changes", [gwen], { time: "off", "places-on-move": "off" })
		// Rules with attributes of their own — Wherewithal's nerve — for the reply's grammar to name.
		await db
			.update(schema.sessions)
			.set({ primaryRuleset: "core:ruleset/wherewithal@1", rigour: "mechanics" })
			.where(eq(schema.sessions.id, sessionId))
		// *Replies carry changes*: the reply's own `changes` duty, on in this session.
		const { STORY_RESPOND_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const { rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
		const { upsertRow } = await import("$lib/server/pipelines/registrations/write")
		const replyReg = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_RESPOND_SPEC_ID)!
		await upsertRow(db as never, rowOfChange({ key: replyReg.key, values: { reading: { params: { changes: true } } } }, { kind: "session", sessionId }, "owner"))
		const { sessionReplyChangesMode, sessionDutiesOf } = await import("$lib/server/pipelines/routines/sessionRoutines")
		expect(await sessionReplyChangesMode(db as any, sessionId)).toBe("full")
		// The host's own doors read the duties as set: what runs out still runs out.
		const { reckoningDuties } = await import("@serene-pub/contracts")
		expect((await sessionDutiesOf(db as any, sessionId, reckoningDuties.id))!.conditions).toBe("full")

		const { stateFor } = await import("$lib/server/state/resolve")
		const nerveOf = async () => {
			const bag = ((await stateFor(db as any, sessionId)).cast.byId as Record<string, Record<string, unknown>>)[String(gwen)] ?? {}
			return bag["wherewithal-nerve"]
		}
		const before = await nerveOf()
		// The reply files the spend; the reckoning reads the same lines and notes it too.
		const spend = { owner: `character:${gwen}`, changes: "attribute", attribute: "wherewithal-nerve", op: "spend", reason: "she steadied herself" }
		script.reply = JSON.stringify({ message: "Gwen steadies herself.", changes: [{ ...spend, entryType: null, value: 1, name: null }] })
		try {
			await turn(sessionId, { changes: [change({ ...spend, value: "1" })], clock: [], place: [] })
		} finally {
			script.reply = "They walk on."
		}

		const runs = await db
			.select({ specSlug: schema.pipelineRuns.specSlug, receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
		const nodesOf = (slug: string) =>
			runs.filter((r) => r.specSlug === slug).flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
		const keyOf = (n: any) => n.key ?? n.nodeKey
		// The commit, after the reply junction (RF fix 3) — by its published address.
		const { replyApplyKey } = await import("$lib/server/utils/testDb")
		const applyKey = await replyApplyKey(db, STORY_RESPOND_SPEC_ID)
		// The reply applied its change, at its own mode.
		expect(nodesOf(STORY_RESPOND_SPEC_ID).some((n) => keyOf(n) === applyKey), "the reply's change was applied").toBe(true)
		// The reckoning's duties say why its two read Off — and nothing of its answer was filed.
		const reckoning = nodesOf("core:spec/story-reckoning")
		const duties = reckoning.find((n) => keyOf(n) === "duties")
		expect(duties, "the reckoning ran").toBeTruthy()
		const main = duties.output?.main ?? duties.outputs?.main ?? duties.output
		expect(main.modes).toMatchObject({ attributes: "off", conditions: "off" })
		expect(main.ceded).toEqual({ attributes: "off: replies carry changes", conditions: "off: replies carry changes" })
		expect(reckoning.some((n) => /^reckon\.on\.commit\.(ruled|ruledHeld|words)\./.test(keyOf(n))), "the reckoning filed nothing").toBe(false)
		// Spent once.
		// 🚧 RF fix 3: one tail after the junction — each reply run saved once, picked its face once.
		const { replyStepKeys } = await import("$lib/server/utils/testDb")
		const tail = await replyStepKeys(db, STORY_RESPOND_SPEC_ID)
		const replyRuns = runs.filter((r) => r.specSlug === STORY_RESPOND_SPEC_ID)
		expect(replyRuns.length).toBeGreaterThan(0)
		for (const r of replyRuns) {
			const ran = (((r.receipt as any)?.nodes ?? []) as any[]).map(keyOf)
			for (const k of [tail.save, tail.spritePick!, tail.spriteShow!, applyKey]) expect(ran.filter((x) => x === k), k).toHaveLength(1)
			expect(ran.filter((x) => /(^|\.)(save|spritePick|spriteShow)$/.test(x)).sort()).toEqual([tail.save, tail.spritePick!, tail.spriteShow!].sort())
		}
		const applyNode = nodesOf(STORY_RESPOND_SPEC_ID).find((n) => keyOf(n) === applyKey)
		expect((applyNode?.output ?? applyNode?.outputs)?.rejected ?? [], "the reply's change was not refused").toEqual([])
		const after = await nerveOf()
		if (typeof before === "number") expect(after).toBe(before - 1)
		else expect(typeof after).toBe("number")
	}, 180_000)

	it("Describe new places: the place a move reached is filed, linked to the place it was reached from", async () => {
		const sessionId = await living("reckon-place", [await aCharacter("Eda")], { attributes: "off", time: "off", conditions: "off" })
		await turn(sessionId, {
			changes: [],
			clock: [],
			place: [{ name: "The Undercroft", content: "Low vaults, dripping.", ways: ["The Gatehouse", "The Well"] }]
		})
		const rows = await db
			.select({ id: schema.lorebookEntries.id, content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(and(eq(schema.lorebookEntries.title, "The Undercroft"), sql`split_part(${schema.lorebookEntries.typeId}, '@', 1) = 'core:entry/location'`))
		expect(rows, "the place was filed").toHaveLength(1)
		expect(rows[0]!.content).toContain("Ways out: The Well.")
		const links = await db
			.select({ id: schema.narrativeRelationships.id })
			.from(schema.narrativeRelationships)
			.where(sql`${schema.narrativeRelationships.fromEntryId} = ${rows[0]!.id} or ${schema.narrativeRelationships.toEntryId} = ${rows[0]!.id}`)
		expect(links.length, "linked to the Gatehouse").toBeGreaterThan(0)

		// Off: a move files nothing.
		const quiet = await living("reckon-place-off", [await aCharacter("Fen")], { attributes: "full", "places-on-move": "off" })
		await turn(quiet, { changes: [], clock: [], place: [{ name: "The Loft", content: "Dusty.", ways: [] }] })
		const loft = await db.select({ id: schema.lorebookEntries.id }).from(schema.lorebookEntries).where(eq(schema.lorebookEntries.title, "The Loft"))
		expect(loft).toEqual([])
	}, 180_000)
})
