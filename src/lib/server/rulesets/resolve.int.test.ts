/**
 * The ruleset handler against a real database: Story resolved on a session
 * with notes (the phantom lorebook) and ties between its cast; a rigorous
 * ruleset applied — a check rolled, a change written through the gate, a
 * refused set filed for review with its reason, an unknown slot refused.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, genre } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { declareTrial, GEAR, HP, STR, TRIAL } from "./trialRuleset.testkit"

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
	genre(GENRE, { name: { en: "Rulesets" }, family: "test", slots: [...slots, things], events: {} })
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
	genre(SHEETED, { name: { en: "Sheeted" }, family: "test", slots: [owned, kit], events: {} })
}, 60_000)

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
		const { phantomLorebookFor } = await import("$lib/server/lorebooks/phantom")
		const notes = await phantomLorebookFor(db as any, w.session.id)
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
