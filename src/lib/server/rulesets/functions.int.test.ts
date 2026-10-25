/**
 * 🚧 Rulesets as functions, through the handler (PLAN-rulesets-functions D3–
 * D6, 2026-10-23): a ruleset in sections whose function modules run in one
 * rules sandbox per moment — effects and derived handlers, a scope with a
 * body, visibility by attribute and by zone, `changedBy` at the write gate,
 * zones stored and moved, events collected and emitted after the receipt,
 * and an invokable function run as an action.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineRuleset, genre, rulesetAttributeSlotId, type FunctionDecl } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const RULESET = "test:ruleset/hearts-int@1"
const GENRE = "test:genre/hearts-int"
const WARMED = "test:event/warmed@1"
const PAIR = "test:function/hearts-pair@1"
const slot = (attr: string) => rulesetAttributeSlotId(RULESET, attr)

const fn = (id: string, props: Omit<FunctionDecl, "id">): { ref: string; key?: string; module: FunctionDecl; bindings?: Record<string, string>; options?: Record<string, unknown> } => ({
	ref: id,
	module: { id, ...props } as FunctionDecl
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-functions-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	defineRuleset(RULESET, {
		name: { en: "Hearts" },
		attributes: [
			{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, tags: ["warmth"], prose: "How fond they are of you." },
			{ id: "glow", name: { en: "Glow" }, kind: "number", prose: "How warm they look." },
			{ id: "secret", name: { en: "Secret" }, kind: "label", visibility: "gm", prose: "What they hide." },
			{ id: "nerve", name: { en: "Nerve" }, kind: "number", changedBy: ["holder"], prose: "Their nerve, theirs to change." },
			{ id: "whisper", name: { en: "Whisper" }, kind: "label", visibility: PAIR, prose: "Said only to the one beside them." }
		],
		entryTypes: [{ id: "card", name: { en: "Card" }, prose: "A playing card." }],
		zoneTypes: [
			{ id: "hand", name: { en: "Hand" }, owners: ["cast"], holds: ["card"], limit: 3, visibility: "holder", prose: "The cards someone holds." },
			{ id: "deck", name: { en: "Deck" }, owners: ["world"], holds: ["card"], ordered: true, visibility: "gm", prose: "The cards left to draw." }
		],
		outcomes: [{ id: "warmed", label: { en: "Warmed" } }],
		functions: [
			{
				...fn("test:function/hearts-warm@1", {
					name: { en: "Warm" },
					meaning: { en: "Each turn, a character warms a little." },
					kind: "changing",
					bindings: { what: { to: "attribute", tags: ["warmth"] } },
					adds: { events: [{ id: WARMED, name: { en: "Warmed" } }] },
					emits: [WARMED],
					form: { step: { type: "integer", label: { en: "Step" } } },
					prose: "{{what}} rises a little each turn.",
					phases: ["effects"],
					body: `export function effects(ctx) {
						if (!ctx.owner || ctx.owner.kind !== "cast") return
						return {
							deltas: [{ attribute: "affection", op: "add", value: ctx.options.step }],
							lines: [ctx.owner.name + " warms"],
							outcomes: ["warmed"],
							emits: [{ event: "${WARMED}", payload: { was: ctx.bindings.what.values.affection } }, "test:event/undeclared@1"]
						}
					}`
				}),
				options: { step: 2 }
			},
			{
				...fn("test:function/hearts-glow@1", {
					name: { en: "Glow" },
					meaning: { en: "Glow is twice affection." },
					kind: "value",
					bindings: { from: { to: "attribute" } },
					prose: "Glow is worked out from {{from}}.",
					phases: ["derived"],
					body: `export function derived(ctx) { return { values: { glow: (ctx.bindings.from.values.affection || 0) * 2 } } }`
				}),
				bindings: { from: "affection" }
			},
			fn(PAIR, {
				name: { en: "Beside" },
				meaning: { en: "Whoever sits beside them." },
				kind: "scope",
				prose: "Only the one beside them hears it.",
				phases: ["effects"],
				body: `export function members(ctx) { var keys = ctx.owners.filter(function (o) { return o.kind === "cast" }).map(function (o) { return o.key }).sort(); var i = keys.indexOf(ctx.subject); return i < 0 ? [] : [keys[(i + 1) % keys.length]] }`
			}),
			fn("test:function/hearts-confess@1", {
				name: { en: "Confess" },
				meaning: { en: "Say how you feel — and draw a card." },
				kind: "changing",
				invokable: { label: { en: "Confess" }, form: { bold: { type: "boolean", label: { en: "Boldly" } } } },
				prose: "A confession moves affection.",
				phases: ["effects"],
				body: `export function invoke(ctx) {
					return {
						deltas: [
							{ attribute: "affection", op: "add", value: ctx.answer && ctx.answer.bold ? 3 : 1 },
							{ op: "move", owner: "world", entry: "Ace", zone: "deck", to: "hand", toOwner: ctx.actor },
							{ attribute: "nerve", op: "add", value: 1 }
						],
						lines: ["confessed"]
					}
				}`
			}),
			fn("test:function/hearts-wave@1", {
				name: { en: "Wave" },
				meaning: { en: "A wave, judged in words." },
				kind: "changing",
				invokable: { label: { en: "Wave" } },
				prose: "A wave says hello."
			})
		]
	})
	genreKeeping(GENRE, { name: { en: "Hearts" }, family: "test", slots: [], events: {} })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `hearts-${suffix}`)
	const chars = await db
		.insert(schema.characters)
		.values([
			{ userId: user.id, name: `Ann ${suffix}`, description: "A baker." },
			{ userId: user.id, name: `Bo ${suffix}`, description: "A poet." }
		])
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Hearts ${suffix}`, genreId: GENRE, primaryRuleset: RULESET, rigour: "mechanics" })
		.returning()
	await db.insert(schema.sessionCharacters).values(chars.map((c) => ({ sessionId: session!.id, characterId: c.id })))
	const [message] = await db.insert(schema.messages).values({ sessionId: session!.id, role: "character" }).returning()
	return { user, ann: chars[0]!, bo: chars[1]!, session: session!, message: message! }
}

const put = (sessionId: number, characterId: number, slotId: string, v: unknown) =>
	db.insert(schema.attributeValues).values({ ownerKind: "session_cast", ownerId: characterId, slotId, value: { v }, sessionId, updatedBy: "user" })

const deck = (sessionId: number, messageId: number, names: string[]) =>
	db.insert(schema.zoneContents).values({
		sessionId,
		ownerKind: "session",
		ownerId: sessionId,
		rulesetId: RULESET,
		zoneType: "deck",
		entries: names.map((name, i) => ({ entryId: 100 + i, entryType: "card", name, fields: { suit: "cups" } })),
		validFromMessageId: messageId
	})

describe("a ruleset in sections, read before a reply", () => {
	test("the voice is derived; a gm-only value and a scope keep to their viewers; zones read by who sees them", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, slot("affection"), 4)
		await put(w.session.id, w.ann.id, slot("secret"), "loves Bo")
		await put(w.session.id, w.ann.id, slot("whisper"), "meet me at dawn")
		await deck(w.session.id, w.message.id, ["Ace", "Two"])
		await db.insert(schema.zoneContents).values({
			sessionId: w.session.id,
			ownerKind: "session_cast",
			ownerId: w.ann.id,
			rulesetId: RULESET,
			zoneType: "hand",
			entries: [
				{ entryId: 7, entryType: "card", name: "Queen", fields: {} },
				{ entryId: 8, entryType: "card", name: "King", fields: {}, exposed: true }
			],
			validFromMessageId: w.message.id
		})
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`, `character:${w.bo.id}`]
		const shared = await resolveRulesetTurn(db as any, { owners, mode: "resolve" })
		if ("halt" in shared) throw new Error(shared.halt)
		const voice = shared.ok.blocks.voice!.text
		expect(voice).toContain("Affection: How fond they are of you.")
		expect(voice).toContain("Affection rises a little each turn.")
		expect(voice).toContain("Glow is worked out from Affection.")
		// The derived handler worked glow out; the gm-only secret is nobody's in the shared view.
		const values = (shared.ok.facts.values as Record<string, Record<string, unknown>>)[`character:${w.ann.id}`]!
		expect(values.glow).toBe(8)
		expect(shared.ok.blocks.sheet!.text).not.toContain("loves Bo")
		expect(shared.ok.blocks.sheet!.text).not.toContain("meet me at dawn")
		// The hand is the holder's (the exposed King shows), the deck the game master's.
		const pieces = shared.ok.blocks.pieces!.text
		expect(pieces).toContain(`${w.ann.name}'s hand: King, 1 more unseen`)
		expect(pieces).toContain("The world's deck: 2 unseen")
		// Resolve never writes: the effects handler's delta is held, its events never queued.
		const fns = shared.ok.facts.functions as Record<string, any>
		expect(fns.heldDeltas).toHaveLength(2)
		expect(shared.ok.facts.emits).toBeUndefined()

		const gm = await resolveRulesetTurn(db as any, { owners, mode: "resolve", viewer: "gm" })
		if ("halt" in gm) throw new Error(gm.halt)
		expect(gm.ok.blocks.sheet!.text).toContain("loves Bo")
		expect(gm.ok.blocks.pieces!.text).toContain("The world's deck: Ace, Two")
		expect(gm.ok.blocks.pieces!.text).toContain(`${w.ann.name}'s hand: Queen, King`)
		// The scope with a body: Bo sits beside Ann, so Bo hears her whisper; Ann's own view does not.
		const bo = await resolveRulesetTurn(db as any, { owners, mode: "resolve", viewer: `character:${w.bo.id}` })
		if ("halt" in bo) throw new Error(bo.halt)
		const annKey = w.ann.id < w.bo.id
		expect(bo.ok.blocks.sheet!.text.includes("meet me at dawn")).toBe(annKey)
	})
})

describe("a ruleset in sections, applied", () => {
	test("the effects handler's deltas are written through the gate; its events wait for the receipt", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, slot("affection"), 4)
		await put(w.session.id, w.bo.id, slot("affection"), 9)
		const { resolveRulesetTurn } = await import("./resolve")
		const { sandboxStats } = await import("./sandbox")
		const opened = sandboxStats.opened
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, `character:${w.ann.id}`, `character:${w.bo.id}`], mode: "apply", deltas: [] },
			{ runId: `run-hearts-${w.session.id}` }
		)
		if ("halt" in res) throw new Error(res.halt)
		// One context for the whole moment, however many handlers it called.
		expect(sandboxStats.opened).toBe(opened + 1)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db as any, w.session.id)
		expect((state.cast.byId[String(w.ann.id)] as any).affection).toBe(6)
		// Bounded: Bo was at 9 of 10.
		expect((state.cast.byId[String(w.bo.id)] as any).affection).toBeLessThanOrEqual(10)
		const texts = (res.ok.outcomes as any[]).map((o) => o.text)
		expect(texts).toContain(`${w.ann.name} warms`)
		expect(texts).toContain(`${w.ann.name}: Warmed`)
		// An event the header does not declare is dropped and said; the declared one is queued.
		const fns = res.ok.facts.functions as Record<string, any>
		expect(fns.failed.some((f: any) => /does not say it emits/.test(f.why))).toBe(true)
		expect(res.ok.facts.emits).toEqual({ events: [WARMED, WARMED], queued: true })
		const { dispatchRulesetEmits } = await import("./emits")
		const heard: any[] = []
		const report = await dispatchRulesetEmits(
			db as any,
			{ runId: `run-hearts-${w.session.id}`, outcome: "ok", userId: w.user.id },
			async (_db, opts) => heard.push(opts)
		)
		expect(report.emitted).toEqual([WARMED, WARMED])
		expect(heard[0]).toMatchObject({ sessionId: w.session.id, event: WARMED, payload: { cause: { kind: "run" }, values: { was: 4 } }, lineage: { depth: 1 } })
		// Taken once: a second dispatch emits nothing.
		expect((await dispatchRulesetEmits(db as any, { runId: `run-hearts-${w.session.id}`, outcome: "ok", userId: w.user.id }, async () => {})).emitted).toEqual([])
	})

	test("the emits toggle off: reported, never queued; a run that halted emits nothing", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`]
		const off = await resolveRulesetTurn(db as any, { owners, mode: "apply", deltas: [], emits: false }, { runId: `run-off-${w.session.id}` })
		if ("halt" in off) throw new Error(off.halt)
		expect(off.ok.facts.emits).toEqual({ events: [WARMED], queued: false, off: true })
		const { dispatchRulesetEmits, queueRulesetEmits } = await import("./emits")
		expect((await dispatchRulesetEmits(db as any, { runId: `run-off-${w.session.id}`, outcome: "ok", userId: w.user.id }, async () => {})).emitted).toEqual([])
		queueRulesetEmits("run-halted", w.session.id, [{ event: WARMED, key: "warm" }])
		const halted = await dispatchRulesetEmits(db as any, { runId: "run-halted", outcome: "halt", userId: w.user.id }, async () => {})
		expect(halted.skipped[0]!.why).toMatch(/did not go to the end/)
		queueRulesetEmits("run-pipeline-off", w.session.id, [{ event: WARMED, key: "warm" }])
		const pipelineOff = await dispatchRulesetEmits(db as any, { runId: "run-pipeline-off", outcome: "ok", userId: w.user.id, pipelineEmits: false }, async () => {})
		expect(pipelineOff.skipped[0]!.why).toMatch(/emits are off/)
	})

	test("changedBy: a value only its holder changes is refused to the rules and filed for review", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, slot("nerve"), 2)
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, {
			owners: [`session:${w.session.id}`, `character:${w.ann.id}`],
			mode: "apply",
			deltas: [{ owner: `character:${w.ann.id}`, slot: slot("nerve"), op: "add", value: 1 }]
		})
		if ("halt" in res) throw new Error(res.halt)
		const refused = res.ok.rejected.find((r) => r.reason === "changed-by")!
		expect(refused.why).toMatch(/changed by who holds it, not by the rules/)
		expect(refused.proposalId).toBeGreaterThan(0)
	})
})

describe("an invokable function, run as an action (D6)", () => {
	test("the answer reaches its body; its deltas and its zone move land; the deck shrinks and the hand grows", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, slot("affection"), 1)
		await deck(w.session.id, w.message.id, ["Ace", "Two"])
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, {
			scope: { sessionId: w.session.id },
			owners: [`session:${w.session.id}`],
			mode: "apply",
			// The rules-action inlet's payload, as its pipeline wires it into `actions`.
			actions: { function: "hearts-confess", actor: `character:${w.ann.id}`, answer: { bold: true } }
		})
		if ("halt" in res) throw new Error(res.halt)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db as any, w.session.id)
		// 1 + 3 (bold) + 2 (the effects handler's warmth, same moment).
		expect((state.cast.byId[String(w.ann.id)] as any).affection).toBe(6)
		expect(res.ok.rejected.map((r) => r.reason)).toContain("changed-by")
		expect(res.ok.facts.zonesWritten).toEqual(
			expect.arrayContaining([
				{ owner: "world", zone: "deck" },
				{ owner: `character:${w.ann.id}`, zone: "hand" }
			])
		)
		const { zonesFor } = await import("./zones")
		const zones = await zonesFor(db, w.session.id, RULESET, [
			{ key: "world", owner: { kind: "session", id: w.session.id } },
			{ key: `character:${w.ann.id}`, owner: { kind: "session_cast", id: w.ann.id } }
		] as any)
		expect(zones.world!.deck!.map((e) => e.name)).toEqual(["Two"])
		expect(zones[`character:${w.ann.id}`]!.hand!.map((e) => [e.name, e.entryId])).toEqual([["Ace", 100]])
		expect((res.ok.outcomes as any[]).map((o) => o.text)).toContain("confessed")
		// The zone move is anchored to the turn's message: deleting it takes the move back.
		await db.delete(schema.messages).where(eq(schema.messages.id, w.message.id))
		const after = await zonesFor(db, w.session.id, RULESET, [{ key: "world", owner: { kind: "session", id: w.session.id } }] as any)
		expect(after.world).toBeUndefined()
	})

	test("a header-only invokable function is told in words; one that is not invokable halts with why", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`]
		const wave = await resolveRulesetTurn(db as any, { owners, mode: "apply", actions: { function: "hearts-wave", actor: `character:${w.ann.id}`, answer: "to Bo" } })
		if ("halt" in wave) throw new Error(wave.halt)
		expect((wave.ok.outcomes as any[]).map((o) => o.text)).toContain(`${w.ann.name} — Wave: to Bo`)
		const no = await resolveRulesetTurn(db as any, { owners, mode: "apply", actions: { function: "hearts-warm", actor: `character:${w.ann.id}` } })
		expect(no).toEqual({ halt: "'hearts-warm' is not a function a person may invoke" })
		const none = await resolveRulesetTurn(db as any, { owners, mode: "apply", invoke: { function: "nope" } })
		expect("halt" in none && none.halt).toMatch(/uses no function 'nope'/)
	})
})

describe("a deciding function with a body decides its checks (D3)", () => {
	const COIN = "test:ruleset/coin-int@1"
	const COIN_GENRE = "test:genre/coin-int"
	test("its `decide` handler sets the degree after the native read; `before` moves the target; nothing native is lost", async () => {
		defineRuleset(COIN, {
			name: { en: "Coin" },
			attributes: [{ id: "luck", name: { en: "Luck" }, kind: "number", prose: "How lucky they are." }],
			functions: [
				{
					ref: "test:function/coin-flip@1",
					key: "coin",
					module: {
						id: "test:function/coin-flip@1",
						name: { en: "Flip a coin" },
						meaning: { en: "A coin decides." },
						kind: "deciding",
						chance: true,
						prose: "A coin decides what could go either way.",
						phases: ["before", "after"],
						body: `export function before(ctx) { return { against: 99 } }
						export function decide(ctx) { return { degree: ctx.random() < 2 ? "success" : "failure", riders: ["the coin landed; the target was " + ctx.check.against] } }`
					} as FunctionDecl
				}
			]
		})
		genreKeeping(COIN_GENRE, { name: { en: "Coin" }, family: "test", slots: [], events: {} })
		const w = await world()
		await db.update(schema.sessions).set({ primaryRuleset: COIN, genreId: COIN_GENRE }).where(eq(schema.sessions.id, w.session.id))
		const { resolveRulesetTurn } = await import("./resolve")
		const { seededRandom } = await import("$lib/server/state/expressions")
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, `character:${w.ann.id}`], mode: "apply", deltas: [{ owner: `character:${w.ann.id}`, op: "hit", against: 3 }] },
			{ random: seededRandom("coin") }
		)
		if ("halt" in res) throw new Error(res.halt)
		const check = (res.ok.outcomes as any[]).find((o) => o.kind === "check")
		expect(check.check.band).toBe("success")
		// Its riders are told beside the check; its `before` had moved the target first.
		expect((res.ok.outcomes as any[]).map((o) => o.text).join("\n")).toContain("the coin landed; the target was 99")
		expect((res.ok.facts.functions as any).ran).toEqual(["coin"])
	})
})

describe("replies carry changes (D7), with a model that answers in JSON", () => {
	test("the schema from the session; the message streamed out of the partial JSON; the changes through the handler", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, slot("affection"), 1)
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`]
		const read = await resolveRulesetTurn(db as any, { owners, mode: "resolve", actions: { replyShape: true } })
		if ("halt" in read) throw new Error(read.halt)
		const schemaOut = read.ok.facts.replySchema as any
		expect(schemaOut.properties.changes.items.properties.owner.enum).toEqual(["The world", w.ann.name])
		expect(schemaOut.properties.changes.items.properties.entryType.enum).toEqual(["card", ""])
		// The grammar subset every backend compiles (G1 ★4): no null, no type unions — KoboldCPP's GBNF takes it.
		const { jsonSchemaToGbnf } = await import("$lib/server/connectionAdapters/jsonSchemaToGbnf")
		expect(jsonSchemaToGbnf(schemaOut)).toContain("root ::=")
		// A fake model, answering in the schema's shape, chunk by chunk.
		const answer = JSON.stringify({
			message: `${w.ann.name} tucks a card into her sleeve.`,
			changes: [
				{ owner: w.ann.name, changes: "attribute", attribute: "affection", entryType: "", op: "add", value: "2", name: "", reason: "a smile" },
				{ owner: w.ann.name, changes: "entry", attribute: "", entryType: "card", op: "add", value: "", name: "Jack", reason: "palmed" },
				{ owner: w.ann.name, changes: "attribute", attribute: "charm", entryType: "", op: "add", value: "1", name: "", reason: "?" }
			]
		})
		const { MessageStreamer, splitReply } = await import("./replies")
		const stream = new MessageStreamer()
		let live = ""
		for (let i = 0; i < answer.length; i += 11) live += stream.push(answer.slice(i, i + 11))
		expect(live).toBe(`${w.ann.name} tucks a card into her sleeve.`)
		const { changes } = splitReply(JSON.parse(stream.raw()))
		const applied = await resolveRulesetTurn(db as any, { owners, mode: "apply", deltas: changes, emits: false })
		if ("halt" in applied) throw new Error(applied.halt)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db as any, w.session.id)
		// 1 + 2 (the reply) + 2 (the warm function's effects, the same moment).
		expect((state.cast.byId[String(w.ann.id)] as any).affection).toBe(5)
		expect(applied.ok.rejected.find((r) => r.reason === "unknown-change")!.why).toBe(`${RULESET} has no attribute 'charm'`)
		const { zonesFor } = await import("./zones")
		const zones = await zonesFor(db, w.session.id, RULESET, [{ key: `character:${w.ann.id}`, owner: { kind: "session_cast", id: w.ann.id } }] as any)
		expect(zones[`character:${w.ann.id}`]!.carried!.map((e) => [e.name, e.entryType, e.entryId])).toEqual([["Jack", "card", null]])
	})
})
