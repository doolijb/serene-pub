/**
 * The ruleset handler against a real database: Story resolved on a session
 * with notes (its own book) and ties between its cast; a rigorous
 * ruleset applied — a check rolled, a change written through the gate, a
 * refused set filed for review with its reason, an unknown slot refused.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, defineRuleset, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { declareTrial, GEAR, HP, STR, TRIAL } from "./trialRuleset.testkit"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const GENRE = "test:genre/rulesets"
const THINGS = "test:slot/rs-things@1"
/** PLAN §15: a genre whose own slots carry one a ruleset owns and a list of that ruleset's repertoire. */
const SHEETED = "test:genre/rulesets-sheeted"
const OWNED = "test:slot/rs-owned@1"
const KIT = "test:slot/rs-kit@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-rulesets-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { slots } = declareTrial()
	const things = defineAttributeSlot(THINGS, {
		type: "list",
		label: { en: "Things" },
		descriptor: "What they carry.",
		appliesTo: ["cast"],
		config: { repertoire: "core:ruleset/freeform@1#things" }
	})
	genreKeeping(GENRE, { name: { en: "Rulesets" }, family: "test", slots: [...slots, things], events: {} })
	const owned = defineAttributeSlot(OWNED, {
		type: "integer",
		label: { en: "Grit" },
		descriptor: "How much they can take.",
		appliesTo: ["cast"],
		rulesetOwned: TRIAL
	})
	const kit = defineAttributeSlot(KIT, {
		type: "list",
		label: { en: "Kit" },
		descriptor: "What they fight with.",
		appliesTo: ["cast"],
		config: { repertoire: `${TRIAL}#weapons` }
	})
	genreKeeping(SHEETED, { name: { en: "Sheeted" }, family: "test", slots: [owned, kit], events: {} })
	// 🚧 M2 (2026-10-22): a ruleset with every script phase, a die and a deck.
	const grit = defineAttributeSlot(GRIT, { type: "integer", label: { en: "Grit" }, descriptor: "Grit.", appliesTo: ["cast"], config: { min: 0, max: 10 }, default: 2 })
	defineRuleset(PHASED, {
		name: { en: "Phased" },
		voice: { prose: "Phased, in words.", mechanics: "Phased decides." },
		conventions: {
			methods: { d6: { kind: "die-target", sides: 6 }, cards: { kind: "card-draw", ranks: 13 } },
			defaultMethod: "d6",
			time: { unit: "round" }
		},
		stats: [{ id: GRIT }],
		selectors: { dare: { kind: "check", base: "ph-int-grit" }, peek: { kind: "check", base: "ph-int-grit", method: "cards" } },
		repertoires: [],
		scripts: (["effects", "derived", "pre-roll", "post-roll", "render"] as const).map((phase) => ({ phase, priority: 1, seedKey: `test:script/ph-int-${phase}` }))
	})
	genreKeeping(PHASED_GENRE, { name: { en: "Phased" }, family: "test", slots: [grit], events: {} })
}, 60_000)

const GRIT = "test:slot/ph-int-grit@1"
const PHASED = "test:ruleset/phased-int@1"
const PHASED_GENRE = "test:genre/phased-int"
/** One ES5 script per phase, each saying it ran — the QuickJS host runs them. */
const PHASE_SOURCES: Record<string, string> = {
	"test:script/ph-int-effects": `return { modifies: [{ target: "dare", value: 1, label: "Steeled" }], explain: "effects ran on " + value.events.join(",") };`,
	"test:script/ph-int-derived": `return { explain: "derived ran, grit " + value.values["ph-int-grit"] };`,
	"test:script/ph-int-pre-roll": `return { against: value.check.against + 1, explain: "pre-roll ran" };`,
	"test:script/ph-int-post-roll": `return { riders: ["post-roll ran: " + (value.check.degree ? value.check.degree.id : "none")] };`,
	"test:script/ph-int-render": `return { blocks: value.blocks.outcomes ? { outcomes: value.blocks.outcomes + "\\n- render ran" } : {}, explain: "render ran" };`
}

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world(over: Partial<typeof schema.sessions.$inferInsert> = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `rulesets-${suffix}`)
	const chars = await db
		.insert(schema.characters)
		.values([
			{ userId: user.id, name: `Ann ${suffix}`, description: "A knight." },
			{ userId: user.id, name: `Bram ${suffix}`, description: "A smith." }
		])
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Run ${suffix}`, genreId: GENRE, ...over })
		.returning()
	await db.insert(schema.sessionCharacters).values(chars.map((c) => ({ sessionId: session!.id, characterId: c.id })))
	await db.insert(schema.messages).values({ sessionId: session!.id, role: "character" })
	return { user, ann: chars[0]!, bram: chars[1]!, session: session! }
}

const put = (sessionId: number, characterId: number, slotId: string, v: unknown) =>
	db.insert(schema.attributeValues).values({
		ownerKind: "session_cast",
		ownerId: characterId,
		slotId,
		value: { v },
		sessionId,
		updatedBy: "user"
	})

describe("Story, on a session with notes", () => {
	test("resolve at prose: voice, sheet, the pieces named, ties from the notes", async () => {
		const w = await world()
		await put(w.session.id, w.ann.id, THINGS, [
			{ kind: "inline", name: "Rope", description: "Fifty feet of it." },
			{ kind: "inline", name: "Lantern", description: "Shuttered." }
		])
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const notes = await ownBookFor(db as any, w.session.id)
		const [a, b] = await db
			.insert(schema.lorebookBindings)
			.values([
				{ lorebookId: notes.id, characterId: w.ann.id, binding: "{{char:1}}", name: w.ann.name },
				{ lorebookId: notes.id, characterId: w.bram.id, binding: "{{char:2}}", name: w.bram.name }
			])
			.returning()
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: notes.id,
			fromNodeId: a!.id,
			toNodeId: b!.id,
			relationshipType: "owes a debt to",
			description: "Bram mended her sword for nothing."
		})
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, {
			owners: [`session:${w.session.id}`, `character:${w.ann.id}`, `character:${w.bram.id}`],
			mode: "resolve",
			actions: "Ann lights the lantern"
		})
		if ("halt" in res) throw new Error(res.halt)
		const { blocks, facts } = res.ok
		expect(facts).toMatchObject({ ruleset: "core:ruleset/freeform@1", rigour: "prose", mode: "resolve" })
		expect(blocks.voice!.text).toMatch(/^Freeform keeps no numbers/)
		expect(blocks.sheet!.text).toContain(`${w.ann.name} — things: Lantern, Rope`)
		expect(blocks.pieces!.text).toContain("Lantern — Shuttered.")
		expect(blocks.pieces!.text).not.toContain("Rope")
		expect(blocks.ties!.text).toBe(`${w.ann.name} → ${w.bram.name}: owes a debt to — Bram mended her sword for nothing.`)
		expect(res.ok.explain).toEqual([])
	})

	test("an uninstalled ruleset parks: nothing renders, the facts say why", async () => {
		const w = await world({ primaryRuleset: "acme:ruleset/gone@1" })
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, { owners: [`session:${w.session.id}`] })
		if ("halt" in res) throw new Error(res.halt)
		expect(res.ok.blocks).toEqual({})
		expect(String(res.ok.facts.parked)).toContain("not installed")
	})

	test("no session among the owners halts with the sentence", async () => {
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, { owners: ["character:1"] })
		expect("halt" in res && res.halt).toMatch(/name the session among this node's owners/)
	})
})

describe("the rigour port", () => {
	test("empty or absent means the session's stored rigour; a named one wins", async () => {
		// The Crawler wires `rigour` from its books script, which says nothing
		// today — an empty string or undefined must read the session's own.
		const w = await world({ primaryRuleset: TRIAL, rigour: "mechanics" })
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`]
		for (const rigour of [undefined, "", "  ", null, "no-such-rigour"]) {
			const res = await resolveRulesetTurn(db as any, { owners, rigour })
			if ("halt" in res) throw new Error(res.halt)
			expect(res.ok.facts.rigour).toBe("mechanics")
		}
		const named = await resolveRulesetTurn(db as any, { owners, rigour: "prose" })
		if ("halt" in named) throw new Error(named.halt)
		expect(named.ok.facts.rigour).toBe("prose")
	})
})

describe("a rigorous ruleset, applied", () => {
	test("rolls, writes through the gate, files a refused set for review, refuses an unknown slot", async () => {
		const w = await world({ primaryRuleset: TRIAL, rigour: "mechanics" })
		await put(w.session.id, w.ann.id, STR, 3)
		await put(w.session.id, w.ann.id, GEAR, [{ kind: "inline", name: "Longsword", description: "A long blade.", equipped: true }])
		const { seededRandom } = await import("$lib/server/state/expressions")
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`]
		const deltas = [
			{ owner: `character:${w.ann.id}`, op: "hit", piece: "Longsword", check: "attack", against: 12 },
			{ owner: `character:${w.ann.id}`, slot: "hp", op: "set", value: 14, reason: "healed" },
			{ owner: `character:${w.ann.id}`, slot: "luck", op: "add", value: 1 },
			{ owner: `character:${w.ann.id}`, slot: "hp", op: "add", value: -5, reason: "arrow" }
		]
		const res = await resolveRulesetTurn(db as any, { owners, mode: "apply", deltas }, { random: seededRandom("seed-1"), runId: "t1" })
		if ("halt" in res) throw new Error(res.halt)

		const check = (res.ok.outcomes as any[]).find((o) => o.kind === "check")
		expect(check.check.selector).toBe("attack")
		expect((res.ok.explain as any[]).find((e) => e.target === `character:${w.ann.id}.attack`).text).toMatch(
			/^d20 \d+ \+ 3 \(Strength\) \+ 1 \(Longsword\) \+ 2 \(Longsword\) = \d+ vs 12$/
		)
		expect(res.ok.rejected.map((r) => r.reason)).toEqual(["set-on-ruleset-value", "unknown-slot"])
		expect(res.ok.blocks.outcomes!.text).toContain("Health −5")

		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(db as any, w.session.id)
		expect((state.cast.byId[String(w.ann.id)] as any).hp).toBe(15)

		const filed = res.ok.rejected[0]!
		expect(filed.proposalId).toBeGreaterThan(0)
		expect(res.ok.rejected[1]!.proposalId).toBeUndefined()
		const [proposal] = await db.select().from(schema.stateProposals).where(eq(schema.stateProposals.id, filed.proposalId!))
		expect(proposal!.status).toBe("pending")
		expect(proposal!.payload).toMatchObject({ slotId: HP, value: 14, refused: { reason: "set-on-ruleset-value" } })

		// The same seed rolls the same die.
		const w2 = await world({ primaryRuleset: TRIAL, rigour: "mechanics" })
		await put(w2.session.id, w2.ann.id, STR, 3)
		await put(w2.session.id, w2.ann.id, GEAR, [{ kind: "inline", name: "Longsword", description: "A long blade.", equipped: true }])
		const res2 = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w2.session.id}`, `character:${w2.ann.id}`], mode: "apply", deltas: [{ ...deltas[0], owner: `character:${w2.ann.id}` }] },
			{ random: seededRandom("seed-1") }
		)
		if ("halt" in res2) throw new Error(res2.halt)
		expect((res2.ok.outcomes as any[])[0].check).toEqual(check.check)
	})
})

describe("🚧 every script phase, through the handler (M2, 2026-10-22)", () => {
	test("effects, derived, pre-roll, post-roll and render each run in their place; their words on the explain trail", async () => {
		const w = await world({ genreId: PHASED_GENRE, primaryRuleset: PHASED, rigour: "mechanics" })
		await put(w.session.id, w.ann.id, GRIT, 2)
		const { seededRandom } = await import("$lib/server/state/expressions")
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, `character:${w.ann.id}`]
		const res = await resolveRulesetTurn(
			db as any,
			{ owners, mode: "apply", deltas: [{ owner: `character:${w.ann.id}`, op: "use", check: "dare", against: 3 }] },
			{ random: seededRandom("phases"), runId: "ph1", scripts: { loadSource: async (key) => PHASE_SOURCES[key] ?? null } }
		)
		if ("halt" in res) throw new Error(res.halt)
		const check = (res.ok.outcomes as any[]).find((o) => o.kind === "check")
		// The effects' bonus counted, the pre-roll's target raised by one.
		expect(check.check).toMatchObject({ selector: "dare", against: 4, method: "die-target", methodKey: "d6" })
		expect(check.check.total).toBe(check.check.natural + 3)
		expect(check.block).toMatchObject({ kind: "dice", method: "die-target", stat: "Dare", against: 4, by: `character:${w.ann.id}` })
		const texts = (res.ok.explain as any[]).map((e) => e.text)
		expect(texts).toEqual(
			expect.arrayContaining([
				"test:script/ph-int-effects: effects ran on use",
				"test:script/ph-int-derived: derived ran, grit 2",
				"test:script/ph-int-pre-roll: pre-roll ran",
				"test:script/ph-int-render: render ran"
			])
		)
		expect((res.ok.outcomes as any[]).map((o) => o.text)).toContain(`post-roll ran: ${check.check.band}`)
		expect(res.ok.blocks.outcomes!.text).toMatch(/\n- render ran$/)
		expect(res.ok.facts.scriptsFailed).toBeUndefined()
		expect(res.ok.facts.scriptsNotRun).toBeUndefined()
	})

	test("a script that fails is on the receipt, and the turn goes on", async () => {
		const w = await world({ genreId: PHASED_GENRE, primaryRuleset: PHASED, rigour: "mechanics" })
		await put(w.session.id, w.ann.id, GRIT, 2)
		const { seededRandom } = await import("$lib/server/state/expressions")
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, `character:${w.ann.id}`], mode: "apply", deltas: [{ owner: `character:${w.ann.id}`, op: "use", check: "dare", against: 3 }] },
			{
				random: seededRandom("phases"),
				runId: "ph2",
				scripts: { loadSource: async (key) => (key.endsWith("pre-roll") ? `throw new Error("no omens")` : (PHASE_SOURCES[key] ?? null)) }
			}
		)
		if ("halt" in res) throw new Error(res.halt)
		expect(res.ok.facts.scriptsFailed).toEqual([{ phase: "pre-roll", seedKey: "test:script/ph-int-pre-roll", owner: `character:${w.ann.id}`, why: expect.stringContaining("no omens") }])
		expect((res.ok.outcomes as any[]).find((o) => o.kind === "check").check.against).toBe(3)
	})

	test("a card-draw method draws from the session's deck, which the session keeps between turns", async () => {
		const w = await world({ genreId: PHASED_GENRE, primaryRuleset: PHASED, rigour: "mechanics" })
		await put(w.session.id, w.ann.id, GRIT, 2)
		const { seededRandom } = await import("$lib/server/state/expressions")
		const { resolveRulesetTurn } = await import("./resolve")
		const peek = { owners: [`session:${w.session.id}`, `character:${w.ann.id}`], mode: "apply", deltas: [{ owner: `character:${w.ann.id}`, op: "use", check: "peek", against: 9 }] }
		const none = { scripts: { loadSource: async () => null } }
		const first = await resolveRulesetTurn(db as any, peek, { random: seededRandom("deck-1"), runId: "d1", ...none })
		if ("halt" in first) throw new Error(first.halt)
		const card = (first.ok.outcomes as any[]).find((o) => o.kind === "check")
		expect(card.block).toMatchObject({ method: "card-draw", against: 9 })
		expect(card.block.cards).toHaveLength(1)
		const meta = async () => ((await db.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id)))[0]!.annex as any)?.core?.rulesetDecks
		expect(await meta()).toEqual({ cards: { scene: null, shuffle: 0, drawn: 1 } })
		const second = await resolveRulesetTurn(db as any, peek, { random: seededRandom("deck-2"), runId: "d2", ...none })
		if ("halt" in second) throw new Error(second.halt)
		expect(await meta()).toEqual({ cards: { scene: null, shuffle: 0, drawn: 2 } })
		// The deck's order is the session's, never the run's: the second card is the deck's second.
		const { deckOrder } = await import("./methods")
		const order = deckOrder(`deck:${w.session.id}:cards:session:0`, 52)
		expect((second.ok.outcomes as any[]).find((o) => o.kind === "check").block.cards[0].rank).toBe((order[1]! % 13) + 1)
		// A resolve reads no deck and writes none.
		const read = await resolveRulesetTurn(db as any, { owners: peek.owners }, none)
		if ("halt" in read) throw new Error(read.halt)
		expect(await meta()).toEqual({ cards: { scene: null, shuffle: 0, drawn: 2 } })
	})
})

describe("a genre's sheet under a ruleset the session does not play (PLAN §15)", () => {
	test("Story: the owned slot is left out of the baseline; the repertoire list degrades to words", async () => {
		const w = await world({ genreId: SHEETED })
		const { vocabularyFor, stateFor } = await import("$lib/server/state/resolve")
		const tracked = (await vocabularyFor(db as any, w.session.id)).entries.map((e) => e.decl.id)
		expect(tracked).toContain(KIT)
		expect(tracked).not.toContain(OWNED)
		await put(w.session.id, w.ann.id, KIT, [{ kind: "inline", name: "Rope", description: "Fifty feet." }])
		const state = await stateFor(db as any, w.session.id)
		expect(state.configs?.[String(w.ann.id)]?.[KIT]?.repertoire).toBeUndefined()
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, { owners: [`session:${w.session.id}`, `character:${w.ann.id}`] })
		if ("halt" in res) throw new Error(res.halt)
		expect(res.ok.blocks.custom!.text).toContain("Kit: Rope")
	})

	test("the ruleset's own session reads both, the repertoire kept", async () => {
		const w = await world({ genreId: SHEETED, primaryRuleset: TRIAL, rigour: "mechanics" })
		const { vocabularyFor, stateFor } = await import("$lib/server/state/resolve")
		const tracked = (await vocabularyFor(db as any, w.session.id)).entries.map((e) => e.decl.id)
		expect(tracked).toEqual(expect.arrayContaining([OWNED, KIT]))
		const state = await stateFor(db as any, w.session.id)
		expect(state.configs?.[String(w.ann.id)]?.[KIT]?.repertoire).toBe(`${TRIAL}#weapons`)
	})
})

describe("a turn is a round (A6)", () => {
	test("only replies on the default channel count", async () => {
		const w = await world()
		const { roundOf } = await import("./rounds")
		const before = await roundOf(db as any, w.session.id)
		await db.insert(schema.messages).values([
			{ sessionId: w.session.id, role: "user" },
			{ sessionId: w.session.id, role: "assistant" },
			{ sessionId: w.session.id, role: "assistant", channel: "table" },
			{ sessionId: w.session.id, role: "assistant" }
		])
		expect((await roundOf(db as any, w.session.id)) - before).toBe(2)
	})
})
