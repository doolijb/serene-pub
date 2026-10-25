/**
 * 🚧 Ties on the lorebook graph, through the host (PLAN-rulesets-functions
 * "Ties on the graph", rulings T1–T5, lane T2, 2026-10-23).
 *
 * A tie's number lives on each person's held side; the graph row keeps the
 * words, written whenever a field that reads onto the lorebook lands, and
 * carrying the run that wrote it. A tie drawn on the lorebook makes its held
 * sides; a function adding a side makes its row; a deleted row retires its
 * sides, never the reverse. How the row changed is read from receipts. Each
 * side is seen by its zone's rule; the model is told the words, and a number
 * only when its field says so. A check reads a tie field as the other
 * person's side. The game master's Set… waits for review.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_FUNCTION_IDS, defineRuleset, genre, rulesetAttributeSlotId, type FunctionDecl, type RulesetEntryTypeDecl } from "@serene-pub/sdk"
import { romanceTemplate } from "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const RULESET = "test:ruleset/ties-int@1"
const LOUD = "test:ruleset/ties-loud-int@1"
/** 🚧 Lane T3: a copy of the romance archetype, and a ruleset whose held things and cast read onto the book (★5). */
const ROMANCE = "test:ruleset/ties-romance-int@1"
const NOTES = "test:ruleset/ties-notes-int@1"
const GENRE = "test:genre/ties-int"

const fn = (id: string, props: Omit<FunctionDecl, "id">) => ({ ref: id, module: { id, ...props } as FunctionDecl })

const BOND: RulesetEntryTypeDecl = {
	id: "bond",
	name: { en: "Bond" },
	relational: true,
	farEnd: "person",
	tags: ["relationship"],
	prose: "What two people are to each other.",
	fields: {
		affection: { type: "integer", min: 0, max: 10, default: 3, label: { en: "Affection" } },
		standing: { type: "enum", of: ["cold", "wary", "warm", "close"], default: "wary", label: { en: "Standing" } }
	},
	readsOnto: { standing: "relationship-type" }
}

const bondsZone = { id: "bonds", name: { en: "Bonds" }, owners: ["cast" as const], holds: ["bond"], visibility: "holder" as const, prose: "Each person's own side of their ties." }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ties-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	defineRuleset(RULESET, {
		name: { en: "Hollow Ties" },
		attributes: [
			{ id: "fate", name: { en: "Fate" }, kind: "label", of: ["active", "deceased", "missing"], carriedBy: ["cast"], readsOnto: "cast-state", prose: "Whether someone still walks the story." }
		],
		entryTypes: [BOND],
		zoneTypes: [bondsZone],
		functions: [
			{ ref: CORE_FUNCTION_IDS.compare, key: "confess", options: { modifierOf: "bond.affection" } },
			fn("test:function/ties-keepsake@1", {
				name: { en: "Give a keepsake" },
				meaning: { en: "A keepsake warms the giver's side." },
				kind: "changing",
				invokable: { label: { en: "Give a keepsake" } },
				prose: "A keepsake warms a bond.",
				phases: ["effects"],
				body: `export function invoke(ctx) {
					var tie = { entryType: "bond", towards: ctx.aimedAt }
					return { deltas: [
						{ op: "set", owner: ctx.actor, entry: tie, field: "affection", by: 1 },
						{ op: "set", owner: ctx.actor, entry: tie, field: "standing", value: (ctx.answer && ctx.answer.standing) || "warm" }
					] }
				}`
			}),
			fn("test:function/ties-befriend@1", {
				name: { en: "Befriend" },
				meaning: { en: "Two people take up a bond." },
				kind: "pieces",
				invokable: { label: { en: "Befriend" } },
				prose: "People make bonds.",
				phases: ["effects"],
				body: `export function invoke(ctx) {
					return { deltas: [{ op: "add", owner: ctx.actor, zone: "bonds", entry: { name: ctx.answer.name, entryType: "bond", fields: { towards: ctx.aimedAt } } }] }
				}`
			}),
			fn("test:function/ties-vanish@1", {
				name: { en: "Vanish" },
				meaning: { en: "Someone goes missing." },
				kind: "changing",
				invokable: { label: { en: "Vanish" } },
				prose: "People go missing.",
				phases: ["effects"],
				body: `export function invoke(ctx) { return { deltas: [{ attribute: "fate", op: "set", value: "missing", owner: ctx.aimedAt }] } }`
			}),
			fn("test:function/ties-forget@1", {
				name: { en: "Forget" },
				meaning: { en: "A side is let go." },
				kind: "pieces",
				invokable: { label: { en: "Forget" } },
				prose: "People let bonds go.",
				phases: ["effects"],
				body: `export function invoke(ctx) {
					return { deltas: [{ op: "remove", owner: ctx.actor, entry: { entryType: "bond", towards: ctx.aimedAt } }] }
				}`
			})
		]
	})
	defineRuleset(LOUD, {
		name: { en: "Loud Ties" },
		entryTypes: [{ ...BOND, modelShare: { affection: { number: true }, standing: { words: false } } }],
		zoneTypes: [{ ...bondsZone, visibility: "everyone" }]
	})
	genreKeeping(GENRE, { name: { en: "Ties" }, family: "test", slots: [], events: {} })
	// 🚧 Lane T3: the romance archetype as a copy of it runs — standing worked out from affection, a confession moving it.
	const { template: _template, ...romance } = romanceTemplate.ruleset as unknown as Record<string, unknown>
	defineRuleset(ROMANCE, romance as never)
	// 🚧 ★5: a held thing's field and a cast member's state that read onto the book.
	defineRuleset(NOTES, {
		name: { en: "Kept Notes" },
		attributes: [
			{ id: "plight", name: { en: "Plight" }, kind: "label", of: ["active", "deceased", "missing"], carriedBy: ["cast"], readsOnto: "cast-state", prose: "Whether someone is still about." }
		],
		entryTypes: [
			{ id: "keepsake", name: { en: "Keepsake" }, holders: ["cast"], prose: "Something kept.", fields: { worn: { type: "enum", of: ["new", "worn"], default: "new", label: { en: "Worn" } } }, readsOnto: { worn: "entry-field" } }
		],
		zoneTypes: [{ id: "pocket", name: { en: "Pocket" }, owners: ["cast"], holds: ["keepsake"], visibility: "holder", prose: "What someone keeps close." }],
		functions: [
			fn("test:function/notes-wear@1", {
				name: { en: "Wear it out" },
				meaning: { en: "A keepsake wears." },
				kind: "changing",
				invokable: { label: { en: "Wear it out" } },
				prose: "Keepsakes wear.",
				phases: ["effects"],
				body: `export function invoke(ctx) { return { deltas: [{ op: "set", owner: ctx.actor, zone: "pocket", entry: ctx.answer.name, field: "worn", value: "worn" }] } }`
			}),
			fn("test:function/notes-vanish@1", {
				name: { en: "Vanish" },
				meaning: { en: "Someone goes missing." },
				kind: "changing",
				invokable: { label: { en: "Vanish" } },
				prose: "People go missing.",
				phases: ["effects"],
				body: `export function invoke(ctx) { return { deltas: [{ attribute: "plight", op: "set", value: "missing", owner: ctx.aimedAt }] } }`
			})
		]
	})
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0
async function world(ruleset = RULESET) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `ties-${suffix}`)
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `Hollow Hearts ${suffix}` }).returning()
	const chars = await db
		.insert(schema.characters)
		.values(["Wren", "Mara", "Dov"].map((name) => ({ userId: user.id, name: `${name} ${suffix}`, description: `${name}.` })))
		.returning()
	const bindings = await db
		.insert(schema.lorebookBindings)
		.values(chars.map((c, i) => ({ lorebookId: book!.id, characterId: c.id, binding: `{{char:${i + 1}}}`, name: c.name })))
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Pier ${suffix}`, genreId: GENRE, primaryRuleset: ruleset, rigour: "mechanics", lorebookId: book!.id })
		.returning()
	await db.insert(schema.sessionCharacters).values(chars.map((c) => ({ sessionId: session!.id, characterId: c.id })))
	const [message] = await db.insert(schema.messages).values({ sessionId: session!.id, role: "character" }).returning()
	const [wren, mara, dov] = chars as [typeof chars[0], typeof chars[0], typeof chars[0]]
	const key = (c: { id: number }) => `character:${c.id}`
	return { user, book: book!, session: session!, message: message!, wren, mara, dov, bindings, key, bindingOf: (c: { id: number }) => bindings.find((b) => b.characterId === c.id)! }
}

type World = Awaited<ReturnType<typeof world>>

async function zonesOf(w: World, ruleset = RULESET) {
	const { zonesFor } = await import("./zones")
	return zonesFor(db, w.session.id, ruleset, [w.wren, w.mara, w.dov].map((c) => ({ key: w.key(c), owner: { kind: "session_cast", id: c.id } })) as any)
}
const bondsOf = async (w: World, who: { id: number }) => (await zonesOf(w))[w.key(who)]?.bonds ?? []

async function draw(w: World, from: { id: number }, to: { id: number }, words: { type?: string; title?: string } = {}) {
	const [row] = await db
		.insert(schema.narrativeRelationships)
		.values({ lorebookId: w.book.id, fromNodeId: w.bindingOf(from).id, toNodeId: w.bindingOf(to).id, relationshipType: words.type ?? "neutral", title: words.title ?? "" })
		.returning()
	const { drawTieSides } = await import("./ties")
	return { row: row!, made: await drawTieSides(db, row!) }
}

const rowOf = async (id: number) => (await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, id)))[0]

async function act(w: World, fnKey: string, actor: { id: number }, aimedAt: { id: number }, answer: unknown = null, runId = `run-${fnKey}-${w.session.id}`) {
	const { resolveRulesetTurn } = await import("./resolve")
	const res = await resolveRulesetTurn(
		db as any,
		{ owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara), w.key(w.dov)], mode: "apply", actions: { function: fnKey, actor: w.key(actor), aimedAt: w.key(aimedAt), answer } },
		{ runId, turnMessageId: w.message.id }
	)
	if ("halt" in res) throw new Error(res.halt)
	return res.ok
}

describe("both ways, one owner (T4)", () => {
	test("a tie drawn on the lorebook makes a held side for each person, in their own zone, once", async () => {
		const w = await world()
		const { row, made } = await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		expect(made.map((m) => [m.owner, m.towards])).toEqual([
			[w.key(w.wren), w.key(w.mara)],
			[w.key(w.mara), w.key(w.wren)]
		])
		const [wrenSide] = await bondsOf(w, w.wren)
		expect(wrenSide).toMatchObject({ entryType: "bond", name: w.mara.name, sideOwner: w.key(w.wren), fields: { towards: w.key(w.mara), edge: String(row.id), affection: 3, standing: "warm" } })
		const [maraSide] = await bondsOf(w, w.mara)
		// Mara's own perspective row does not stand yet: her side has no edge, and the default standing.
		expect(maraSide).toMatchObject({ name: w.wren.name, sideOwner: w.key(w.mara), fields: { towards: w.key(w.wren), standing: "wary" } })
		expect(maraSide!.fields.edge).toBeUndefined()
		// Drawn again (another row the same way), nothing is stamped twice.
		const { drawTieSides } = await import("./ties")
		expect(await drawTieSides(db, row)).toEqual([])
		// Mara's own perspective drawn next: her held side takes it as its row; nothing else of it moves.
		const back = await draw(w, w.mara, w.wren, { type: "close" })
		const [maraNow] = await bondsOf(w, w.mara)
		expect(maraNow!.fields).toMatchObject({ edge: String(back.row.id), standing: "wary", towards: w.key(w.wren) })
		expect(await bondsOf(w, w.wren)).toHaveLength(1)
	})

	test("a function adding a side makes its row; the other person's side is stamped and gets its own row", async () => {
		const w = await world()
		const out = await act(w, "ties-befriend", w.wren, w.dov, { name: "Dov" })
		const landings = out.facts.landings as any[]
		expect(landings).toHaveLength(2)
		expect(landings.every((l) => l.kind === "tie" && l.made === true && typeof l.relationshipId === "number")).toBe(true)
		const [wrenSide] = await bondsOf(w, w.wren)
		const [dovSide] = await bondsOf(w, w.dov)
		const wrenRow = await rowOf(Number(wrenSide!.fields.edge))
		const dovRow = await rowOf(Number(dovSide!.fields.edge))
		// Each side reads onto its own perspective row, typed by its standing, carrying the run.
		expect(wrenRow).toMatchObject({ fromNodeId: w.bindingOf(w.wren).id, toNodeId: w.bindingOf(w.dov).id, relationshipType: "wary", rulesRunId: `run-ties-befriend-${w.session.id}`, lorebookId: w.book.id })
		expect(dovRow).toMatchObject({ fromNodeId: w.bindingOf(w.dov).id, toNodeId: w.bindingOf(w.wren).id, relationshipType: "wary" })
	})

	test("a deleted row retires its held sides; a side let go leaves the row standing", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm" })
		const { retireTieSides } = await import("./ties")
		// Letting Mara's side go never touches the lorebook.
		await act(w, "ties-forget", w.mara, w.wren)
		expect(await bondsOf(w, w.mara)).toEqual([])
		expect(await rowOf(row.id)).toBeDefined()
		// Taking the row off the lorebook retires Wren's side, which read onto it.
		await db.delete(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.id, row.id))
		const retired = await retireTieSides(db, row)
		expect(retired).toEqual([{ sessionId: w.session.id, owner: w.key(w.wren), zone: "bonds", retired: 1 }])
		expect(await bondsOf(w, w.wren)).toEqual([])
	})
})

describe("one writer, one history (T2, T3)", () => {
	test("a side's field that reads onto the lorebook lands on its row in place, with the run; the outcome says the graph follows", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		const out = await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-keepsake-1")
		const [wrenSide] = await bondsOf(w, w.wren)
		expect(wrenSide!.fields).toMatchObject({ affection: 4, standing: "close", edge: String(row.id) })
		const after = await rowOf(row.id)
		expect(after).toMatchObject({ relationshipType: "close", title: "crush", rulesRunId: "run-keepsake-1" })
		// No second dated row: the words moved in place.
		const rows = await db.select().from(schema.narrativeRelationships).where(eq(schema.narrativeRelationships.lorebookId, w.book.id))
		expect(rows).toHaveLength(1)
		const landings = out.facts.landings as any[]
		expect(landings).toEqual([
			expect.objectContaining({
				kind: "tie",
				relationshipId: row.id,
				owner: w.key(w.wren),
				towards: w.key(w.mara),
				columns: [{ target: "relationship-type", field: "standing", from: "warm", to: "close" }],
				moved: { affection: { from: 3, to: 4 }, standing: { from: "warm", to: "close" } }
			})
		])
		const follows = (out.outcomes as any[]).filter((o) => o.follows === "bond")
		expect(follows.map((o) => o.text)).toEqual([`Lorebook: ${w.wren.name}'s side of the tie with ${w.mara.name} now reads close`])

		// T3: how it changed is read from the receipt of the run that wrote it.
		const t = Date.now()
		await db.insert(schema.pipelineRuns).values({
			runId: "run-keepsake-1",
			specSlug: "core:spec/rules-action",
			specVersion: "1.0.0",
			sessionId: w.session.id,
			outcome: "ok",
			triggerSource: "action",
			seed: "s",
			startedAt: new Date(t),
			endedAt: new Date(t + 5),
			receipt: { runId: "run-keepsake-1", nodes: [{ nodeKey: "resolve", output: { facts: { landings } } }] }
		})
		const { tieHistory, sidesOfRow } = await import("./ties")
		const history = await tieHistory(db, row.id)
		expect(history).toEqual([
			expect.objectContaining({ runId: "run-keepsake-1", owner: w.key(w.wren), columns: [{ target: "relationship-type", from: "warm", to: "close" }], moved: { affection: { from: 3, to: 4 }, standing: { from: "warm", to: "close" } } })
		])
		// The lens reads the sides from the session that wrote it: Wren's own, then Mara's towards her — one tie, both sides.
		const sides = await sidesOfRow(db, row.id)
		expect(sides).toEqual([
			expect.objectContaining({ owner: w.key(w.wren), ownerName: w.wren.name, onto: [{ field: "standing", target: "relationship-type", label: "Standing", value: "close" }], numbers: [{ field: "affection", label: "Affection", value: 4, min: 0, max: 10 }] }),
			expect.objectContaining({ owner: w.key(w.mara), ownerName: w.mara.name, towards: w.key(w.wren), onto: [{ field: "standing", target: "relationship-type", label: "Standing", value: "wary" }] })
		])
	})

	test("a book the session may not write keeps its row; the session's notes overlay it, and the session reads the overlay", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		await db.update(schema.lorebooks).set({ loreWriteMode: "review" }).where(eq(schema.lorebooks.id, w.book.id))
		const out = await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-overlay-1")
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "warm", rulesRunId: null })
		const landing = (out.facts.landings as any[])[0]
		expect(landing).toMatchObject({ kind: "tie", overlaid: true })
		const overlay = await rowOf(landing.relationshipId)
		expect(overlay).toMatchObject({ relationshipType: "close", title: "crush", rulesRunId: "run-overlay-1", fromNodeId: w.bindingOf(w.wren).id, toNodeId: w.bindingOf(w.mara).id })
		expect(overlay!.lorebookId).not.toBe(w.book.id)
		expect((await bondsOf(w, w.wren))[0]!.fields.edge).toBe(String(landing.relationshipId))
		const { tiesBetween, rulesetSessionOf } = await import("./read")
		const session = (await rulesetSessionOf(db as any, w.session.id))!
		const ties = await tiesBetween(db as any, session, [w.wren, w.mara].map((c) => ({ key: w.key(c), owner: { kind: "session_cast", id: c.id } })) as any)
		expect(ties.filter((t) => t.from === w.key(w.wren) && t.to === w.key(w.mara)).map((t) => t.type)).toEqual(["close"])
	})

	test("an attribute that reads onto the lorebook sets the cast member's state", async () => {
		const w = await world()
		// The rules set it (the model may not set a ruleset's value): a function's own set.
		const out = await act(w, "ties-vanish", w.wren, w.mara)
		const [b] = await db.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, w.bindingOf(w.mara).id))
		expect(b!.nodeState).toBe("missing")
		expect((out.facts.landings as any[])[0]).toMatchObject({ kind: "attribute", attribute: "fate", bindingId: w.bindingOf(w.mara).id, columns: [{ target: "cast-state", to: "missing" }] })
		expect(rulesetAttributeSlotId(RULESET, "fate")).toBe("test.ties-int:slot/fate@1")
	})
})

describe("who sees a side, and what the model is told (T1, T5)", () => {
	test("each side is its holder's; the game master sees both; an exposed side shows its words, never its number unless it says", async () => {
		const w = await world()
		await draw(w, w.wren, w.mara, { type: "warm" })
		await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" })
		const { resolveRulesetTurn } = await import("./resolve")
		const owners = [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)]
		const read = async (viewer: string) => {
			const r = await resolveRulesetTurn(db as any, { owners, mode: "resolve", viewer })
			if ("halt" in r) throw new Error(r.halt)
			return r.ok.blocks.pieces?.text ?? ""
		}
		const asWren = await read(w.key(w.wren))
		expect(asWren).toContain(`${w.wren.name}'s bonds: ${w.mara.name} (close)`)
		expect(asWren).toContain(`${w.mara.name}'s bonds: 1 unseen`)
		// The number is never shared unless its field says so.
		expect(asWren).not.toMatch(/affection/i)
		const asGm = await read("gm")
		expect(asGm).toContain(`${w.wren.name}'s bonds: ${w.mara.name} (close)`)
		expect(asGm).toContain(`${w.mara.name}'s bonds: ${w.wren.name} (wary)`)
		// Mara shows her side: Wren now reads its words.
		const { planZoneOps, zonesFor, writeZones } = await import("./zones")
		const maraOwner = { key: w.key(w.mara), owner: { kind: "session_cast", id: w.mara.id }, name: w.mara.name, stats: [], repertoires: [], custom: [], bag: {} }
		const { getRuleset } = await import("@serene-pub/sdk")
		const zones = await zonesFor(db, w.session.id, RULESET, [maraOwner] as any)
		const plan = planZoneOps({ ruleset: getRuleset(RULESET)!, owners: [maraOwner], zones } as any, [{ op: "reveal", owner: w.key(w.mara), entry: { towards: w.key(w.wren) }, key: "show" }])
		expect(plan.refused).toEqual([])
		await writeZones(db, { sessionId: w.session.id, rulesetId: RULESET, messageId: w.message.id, updatedBy: "user" }, plan.writes)
		expect(await read(w.key(w.wren))).toContain(`${w.mara.name}'s bonds: ${w.wren.name} (wary)`)
	})

	test("a field that shares its number is told it; one that withholds its words keeps the row's word out of the arm", async () => {
		const w = await world(LOUD)
		const [row] = await db
			.insert(schema.narrativeRelationships)
			.values({ lorebookId: w.book.id, fromNodeId: w.bindingOf(w.wren).id, toNodeId: w.bindingOf(w.mara).id, relationshipType: "close", rulesRunId: "run-loud" })
			.returning()
		await db.insert(schema.zoneContents).values({
			sessionId: w.session.id,
			ownerKind: "session_cast",
			ownerId: w.wren.id,
			rulesetId: LOUD,
			zoneType: "bonds",
			entries: [{ entryId: null, entryType: "bond", name: w.mara.name, sideOwner: w.key(w.wren), fields: { towards: w.key(w.mara), edge: String(row!.id), affection: 8, standing: "close" } }],
			validFromMessageId: w.message.id
		})
		const { resolveRulesetTurn } = await import("./resolve")
		const r = await resolveRulesetTurn(db as any, { owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)], mode: "resolve", viewer: w.key(w.wren) })
		if ("halt" in r) throw new Error(r.halt)
		expect(r.ok.blocks.pieces!.text).toContain(`${w.wren.name}'s bonds: ${w.mara.name} (affection 8)`)
		const { tieShareForRows } = await import("./ties")
		expect([...(await tieShareForRows(db, w.session.id, [row!.id])).entries()]).toEqual([[row!.id, { withholdType: "bond", numbers: { affection: 8 } }]])
		// The retrieval arm: the speaker's tie reads as the bond, with its number, never the withheld word.
		const { buildGraphContextData } = await import("$lib/server/utils/graphContextFormatter")
		const graph = await buildGraphContextData({ db: db as any, sessionId: w.session.id, lorebookId: w.book.id, speakerCharacterId: w.wren.id })
		expect(graph?.yourRelationships?.[w.mara.name]).toEqual([expect.objectContaining({ type: "bond", numbers: { affection: 8 } })])
		// The default ruleset shares the words and no number: nothing to change in the arm.
		const quiet = await world()
		await draw(quiet, quiet.wren, quiet.mara, { type: "warm" })
		const [side] = await bondsOf(quiet, quiet.wren)
		expect([...(await tieShareForRows(db, quiet.session.id, [Number(side!.fields.edge)])).entries()]).toEqual([[Number(side!.fields.edge), {}]])
	})
})

describe("a check reads the tie (T1)", () => {
	test("bond.affection is the side of the one aimed at, towards the one checking", async () => {
		const w = await world()
		await db.insert(schema.zoneContents).values({
			sessionId: w.session.id,
			ownerKind: "session_cast",
			ownerId: w.mara.id,
			rulesetId: RULESET,
			zoneType: "bonds",
			entries: [{ entryId: null, entryType: "bond", name: w.wren.name, sideOwner: w.key(w.mara), fields: { towards: w.key(w.wren), affection: 8, standing: "close" } }],
			validFromMessageId: w.message.id
		})
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, {
			owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)],
			mode: "apply",
			deltas: [{ owner: w.key(w.wren), op: "use", check: "confess", aimedAt: w.key(w.mara), against: 7 }]
		})
		if ("halt" in res) throw new Error(res.halt)
		const check = (res.ok.outcomes as any[]).find((o) => o.kind === "check")
		expect(check?.check?.total).toBe(8)
		const explain = (res.ok.explain as any[]).map((e) => e.text).join("\n")
		expect(explain).toContain(`${w.mara.name}'s affection`)
	})
})

describe("in play: the outcome says the graph follows (screen 4)", () => {
	test("a confession decided and a side warmed in one moment: the outcome block tells the row that followed", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm" })
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(
			db as any,
			{
				owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)],
				mode: "apply",
				deltas: [{ owner: w.key(w.wren), op: "use", check: "confess", aimedAt: w.key(w.mara), against: 2 }],
				invoke: { function: "ties-keepsake", actor: w.key(w.wren), aimedAt: w.key(w.mara), answer: { standing: "close" } }
			},
			{ runId: "run-play-1", turnMessageId: w.message.id }
		)
		if ("halt" in res) throw new Error(res.halt)
		const block = (res.ok.outcomes as any[]).find((o) => o.block)?.block
		expect(block?.follows).toEqual([`Lorebook: ${w.wren.name}'s side of the tie with ${w.mara.name} now reads close`])
		const { checkMessageBlocks } = await import("@serene-pub/sdk")
		expect(checkMessageBlocks([block])).toEqual([])
		expect((await rowOf(row.id))!.relationshipType).toBe("close")
	})
})

describe("the game master's Set… waits for review (screen 3)", () => {
	test("filed as a held change; accepted, the side's number lands", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm" })
		await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-set-1")
		const { fileHeldFieldChange } = await import("./ties")
		await expect(fileHeldFieldChange(db, { relationshipId: row.id, owner: w.key(w.wren), field: "affection", value: 9, userId: w.user.id + 999 })).rejects.toThrow(/game master/)
		const filed = await fileHeldFieldChange(db, { relationshipId: row.id, owner: w.key(w.wren), field: "affection", value: 9, userId: w.user.id })
		expect(filed.sessionId).toBe(w.session.id)
		// Nothing lands until it is kept.
		expect((await bondsOf(w, w.wren))[0]!.fields.affection).toBe(4)
		const { listedProposals, decideProposal } = await import("$lib/server/state/write")
		const listed = await listedProposals(db as any, w.session.id)
		const { describeProposal } = await import("$lib/shared/state/ledgerLines")
		expect(describeProposal(listed.find((p) => p.id === filed.proposalId) as any, {})).toBe(`${w.wren.name} → ${w.mara.name}: Affection → 9`)
		const decided = await decideProposal(db as any, filed.proposalId, true, w.user.id)
		expect(decided.status).toBe("accepted")
		expect((await bondsOf(w, w.wren))[0]!.fields.affection).toBe(9)
		const [p] = await db.select().from(schema.stateProposals).where(and(eq(schema.stateProposals.id, filed.proposalId)))
		expect(p!.status).toBe("accepted")
	})
})

describe("on the sheet (screen 2)", () => {
	test("each side as the viewer may see it: words always, numbers for the holder, the game master, or a side shown", async () => {
		const w = await world()
		await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" })
		const { tiesOnWire, setTieSideShown } = await import("./ties")
		const owners = [
			{ kind: "session_cast", id: w.wren.id, label: w.wren.name, mine: true },
			{ kind: "session_cast", id: w.mara.id, label: w.mara.name }
		]
		const asWren = await tiesOnWire(db, w.session.id, owners, { sessionOwner: false })
		const wrenTie = asWren.get(`session_cast:${w.wren.id}`)![0]!
		expect(wrenTie).toMatchObject({
			entryType: "bond",
			label: "Bond",
			towards: w.key(w.mara),
			towardsLabel: w.mara.name,
			name: "crush",
			words: [{ field: "standing", label: "Standing", value: "close", onto: true }],
			numbers: [{ field: "affection", label: "Affection", value: 4, min: 0, max: 10 }],
			shown: false,
			mayShow: true,
			other: { words: [{ field: "standing", value: "wary", onto: true }], shown: false }
		})
		expect(wrenTie.other!.numbers).toBeUndefined()
		const maraTie = asWren.get(`session_cast:${w.mara.id}`)![0]!
		expect(maraTie.numbers).toBeUndefined()
		expect(maraTie.mayShow).toBe(false)
		expect(maraTie.words.map((x) => x.value)).toEqual(["wary"])
		// The game master sees both sides' numbers.
		const asGm = await tiesOnWire(db, w.session.id, owners.map((o) => ({ ...o, mine: false })), { sessionOwner: true })
		expect(asGm.get(`session_cast:${w.wren.id}`)![0]!.other!.numbers).toEqual([{ field: "affection", label: "Affection", value: 3, min: 0, max: 10 }])
		// Mara shows her side: Wren reads her number now.
		await setTieSideShown(db, { sessionId: w.session.id, owner: { kind: "session_cast", id: w.mara.id }, entryType: "bond", towards: w.key(w.wren), shown: true, updatedBy: "user:1" })
		const after = await tiesOnWire(db, w.session.id, owners, { sessionOwner: false })
		expect(after.get(`session_cast:${w.wren.id}`)![0]!.other).toMatchObject({ shown: true, numbers: [{ field: "affection", value: 3 }] })
		expect(after.get(`session_cast:${w.mara.id}`)![0]!).toMatchObject({ shown: true, numbers: [{ field: "affection", value: 3 }] })
	})
})

describe("through the lorebook's own doors (narrativeGraph sockets)", () => {
	const socketOf = (userId: number) => ({ user: { id: userId } }) as any
	const heard = () => {
		const out: { event: string; data: any }[] = []
		return { out, emit: (event: string, data: any) => void out.push({ event, data }) }
	}
	test("drawing makes the sides; a fed word is not retyped by hand; the lens reads the sides; Set… files; deleting retires", async () => {
		const w = await world()
		const ng = await import("$lib/server/sockets/narrativeGraph")
		const h = heard()
		const created = await ng.narrativeGraphCreateRelationshipHandler.handler(
			socketOf(w.user.id),
			{ lorebookId: w.book.id, from: { kind: "cast", bindingId: w.bindingOf(w.wren).id }, to: { kind: "cast", bindingId: w.bindingOf(w.mara).id }, relationshipType: "warm", name: "crush", status: "active" } as any,
			h.emit
		)
		const id = created.relationship.id
		expect((await bondsOf(w, w.wren))[0]!.fields.edge).toBe(String(id))
		expect(await bondsOf(w, w.mara)).toHaveLength(1)
		await act(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-door-1")
		// The fed word is the rules': retyping it by hand is refused, other words are not.
		await expect(ng.narrativeGraphUpdateRelationshipHandler.handler(socketOf(w.user.id), { relationship: { id, relationshipType: "smitten" } } as any, h.emit)).rejects.toThrow(/comes from the rules/)
		expect(h.out.find((x) => x.event === "narrativeGraph:updateRelationship:error")?.data.error).toMatch(/comes from the rules/)
		expect((await rowOf(id))!.relationshipType).toBe("close")
		await ng.narrativeGraphUpdateRelationshipHandler.handler(socketOf(w.user.id), { relationship: { id, description: "Met on the pier." } } as any, h.emit)
		expect((await rowOf(id))!.description).toBe("Met on the pier.")
		// The lens: the sides and their numbers.
		const sides = await ng.narrativeGraphTieSidesHandler.handler(socketOf(w.user.id), { relationshipId: id }, h.emit)
		expect(sides.sides.map((s) => [s.owner, s.numbers[0]!.value])).toEqual([
			[w.key(w.wren), 4],
			[w.key(w.mara), 3]
		])
		// Another person's book reads as no link at all.
		const other = await (await import("$lib/server/utils/testDb")).createTestUser(db, `ties-other-${w.session.id}`)
		await expect(ng.narrativeGraphTieSidesHandler.handler(socketOf(other.id), { relationshipId: id }, h.emit)).rejects.toThrow()
		expect(h.out.find((x) => x.event === "narrativeGraph:tieSides:error")?.data.error).toMatch(/not in this lorebook/)
		const set = await ng.narrativeGraphSetTieSideHandler.handler(socketOf(w.user.id), { relationshipId: id, owner: w.key(w.wren), field: "affection", value: 6 }, h.emit)
		expect(set).toMatchObject({ success: "Filed as a change for review.", sessionId: w.session.id })
		// Deleting the row retires the sides that read onto it.
		await ng.narrativeGraphDeleteRelationshipHandler.handler(socketOf(w.user.id), { id }, h.emit)
		expect(await bondsOf(w, w.wren)).toEqual([])
		expect(await bondsOf(w, w.mara)).toHaveLength(1)
	})
})

// ── Lane T3 (2026-10-23): ties follow-ups ──────────────────────────────────

/** Two sides of a bond, held as the rules hold them, each onto its own row. */
async function sides(w: World, ruleset: string, wren: { affection: number; standing: string }, mara: { affection: number; standing: string }) {
	const wrenRow = (await draw(w, w.wren, w.mara, { type: wren.standing })).row
	const maraRow = (await draw(w, w.mara, w.wren, { type: mara.standing })).row
	const side = (who: { id: number }, other: { id: number; name: string }, row: { id: number }, f: { affection: number; standing: string }) => ({
		sessionId: w.session.id,
		ownerKind: "session_cast",
		ownerId: who.id,
		rulesetId: ruleset,
		zoneType: "bonds",
		entries: [{ entryId: null, entryType: "bond", name: other.name, sideOwner: w.key(who), fields: { towards: w.key(other), edge: String(row.id), ...f } }],
		validFromMessageId: w.message.id
	})
	await db.insert(schema.zoneContents).values([side(w.wren, w.mara, wrenRow, wren), side(w.mara, w.wren, maraRow, mara)])
	return { wrenRow, maraRow }
}

describe("🚧 ★2 + romance: standing worked out from affection, a confession moving the other side", () => {
	const ROMANCE_ZONES = async (w: World, who: { id: number }) => ((await zonesOf(w, ROMANCE))[w.key(who)]?.bonds ?? [])[0]
	test("a confession that lands moves the side the one aimed at holds; its standing follows by rungs, and so does her row", async () => {
		const w = await world(ROMANCE)
		const { wrenRow, maraRow } = await sides(w, ROMANCE, { affection: 7, standing: "warm" }, { affection: 5, standing: "wary" })
		const { resolveRulesetTurn } = await import("./resolve")
		// Mara's affection for Wren (5) against 2: a margin of 3, *Confessed* — her side moves +2.
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)], mode: "apply", deltas: [{ owner: w.key(w.wren), op: "use", check: "confess", aimedAt: w.key(w.mara), against: 2 }] },
			{ runId: "run-confess-1", turnMessageId: w.message.id }
		)
		if ("halt" in res) throw new Error(res.halt)
		const check = (res.ok.outcomes as any[]).find((o) => o.kind === "check")
		expect(check?.check).toMatchObject({ total: 5, band: "confessed" })
		expect((await ROMANCE_ZONES(w, w.mara))!.fields).toMatchObject({ affection: 7, standing: "warm", towards: w.key(w.wren) })
		// Wren's side is untouched: the confession moves how the other feels.
		expect((await ROMANCE_ZONES(w, w.wren))!.fields).toMatchObject({ affection: 7, standing: "warm" })
		expect((await rowOf(maraRow.id))!).toMatchObject({ relationshipType: "warm", rulesRunId: "run-confess-1" })
		expect((await rowOf(wrenRow.id))!.relationshipType).toBe("warm")
		const texts = (res.ok.outcomes as any[]).map((o) => o.text)
		expect(texts).toContain(`Lorebook: ${w.mara.name}'s side of the tie with ${w.wren.name} now reads warm`)
		expect(check?.block?.follows).toEqual([`Lorebook: ${w.mara.name}'s side of the tie with ${w.wren.name} now reads warm`])
	})

	test("a confession that falls flat cools her side; a standing out of step with its affection is worked out again", async () => {
		const w = await world(ROMANCE)
		const { maraRow } = await sides(w, ROMANCE, { affection: 2, standing: "close" }, { affection: 6, standing: "warm" })
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)], mode: "apply", deltas: [{ owner: w.key(w.wren), op: "use", check: "confess", aimedAt: w.key(w.mara), against: 9 }] },
			{ runId: "run-confess-2", turnMessageId: w.message.id }
		)
		if ("halt" in res) throw new Error(res.halt)
		expect((res.ok.outcomes as any[]).find((o) => o.kind === "check")?.check?.band).toBe("cooled")
		// 6 − 1 = 5: wary, onto her row.
		expect((await ROMANCE_ZONES(w, w.mara))!.fields).toMatchObject({ affection: 5, standing: "wary" })
		expect((await rowOf(maraRow.id))!.relationshipType).toBe("wary")
		// Wren's standing said close at an affection of 2: worked out again, cold.
		expect((await ROMANCE_ZONES(w, w.wren))!.fields).toMatchObject({ affection: 2, standing: "cold" })
	})

	test("a reading works nothing out and writes nothing; the model reads affection as its rung on a bond", async () => {
		const w = await world(ROMANCE)
		await sides(w, ROMANCE, { affection: 2, standing: "close" }, { affection: 6, standing: "warm" })
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(db as any, { owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara)], mode: "resolve", viewer: "gm" })
		if ("halt" in res) throw new Error(res.halt)
		expect((await ROMANCE_ZONES(w, w.wren))!.fields.standing).toBe("close")
		const { functionProse } = await import("./functionRun")
		const { getRuleset } = await import("@serene-pub/sdk")
		expect(functionProse(getRuleset(ROMANCE)! as never)).toEqual(
			expect.arrayContaining([
				"Affection on a bond is read as the rung it has reached; speak of the rung, never the number.",
				"Affection on a bond moves with how a check comes out: further for an outcome that lands, back for one that falls flat."
			])
		)
	})
})

describe("🚧 ★7: a function adding a side stamps the other side, wherever its holder is", () => {
	test("the far end the moment does not read is resolved by its key: their side stamped, its own row made", async () => {
		const w = await world()
		const { resolveRulesetTurn } = await import("./resolve")
		// Dov is not among the moment's owners.
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, w.key(w.wren)], mode: "apply", actions: { function: "ties-befriend", actor: w.key(w.wren), aimedAt: w.key(w.dov), answer: { name: w.dov.name } } },
			{ runId: "run-far-1", turnMessageId: w.message.id }
		)
		if ("halt" in res) throw new Error(res.halt)
		const [dovSide] = await bondsOf(w, w.dov)
		expect(dovSide).toMatchObject({ entryType: "bond", name: w.wren.name, sideOwner: w.key(w.dov), fields: { towards: w.key(w.wren), affection: 3, standing: "wary" } })
		const dovRow = await rowOf(Number(dovSide!.fields.edge))
		expect(dovRow).toMatchObject({ fromNodeId: w.bindingOf(w.dov).id, toNodeId: w.bindingOf(w.wren).id, relationshipType: "wary", rulesRunId: "run-far-1" })
		expect((res.ok.facts.landings as any[]).map((l) => [l.owner, l.made])).toEqual([
			[w.key(w.wren), true],
			[w.key(w.dov), true]
		])
	})
})

describe("🚧 ★5: a book the session may not write — the notes' rule-fed overlay, read in the book's place", () => {
	test("a held thing's field and a cast member's state land in the notes; the book keeps its own; the session reads the overlay", async () => {
		const w = await world(NOTES)
		await db.update(schema.lorebooks).set({ loreWriteMode: "review" }).where(eq(schema.lorebooks.id, w.book.id))
		const [ribbon] = await db
			.insert(schema.lorebookEntries)
			.values({ lorebookId: w.book.id, typeId: "core:entry/world-lore", typeVersion: 1, title: "A ribbon", content: "Blue.", position: 1, fields: { worn: "new" } } as any)
			.returning()
		await db.insert(schema.zoneContents).values({
			sessionId: w.session.id,
			ownerKind: "session_cast",
			ownerId: w.wren.id,
			rulesetId: NOTES,
			zoneType: "pocket",
			entries: [{ entryId: ribbon!.id, entryType: "keepsake", name: "A ribbon", fields: { worn: "new" } }],
			validFromMessageId: w.message.id
		})
		const worn = await act(w, "notes-wear", w.wren, w.mara, { name: "A ribbon" }, "run-notes-1")
		expect((worn.facts.landings as any[])[0]).toMatchObject({ kind: "held", entryId: ribbon!.id, overlaid: true, columns: [{ target: "entry-field", field: "worn", from: "new", to: "worn" }] })
		const [still] = await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, ribbon!.id))
		expect((still!.fields as any).worn).toBe("new")

		const gone = await act(w, "notes-vanish", w.wren, w.mara, null, "run-notes-2")
		expect((gone.facts.landings as any[])[0]).toMatchObject({ kind: "attribute", attribute: "plight", bindingId: w.bindingOf(w.mara).id, overlaid: true, columns: [{ target: "cast-state", to: "missing" }] })
		const [b] = await db.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, w.bindingOf(w.mara).id))
		expect(b!.nodeState).toBe("active")

		const { ruleFedOverlayOf } = await import("./ties")
		expect(await ruleFedOverlayOf(db, w.session.id)).toEqual({ entryFields: { [String(ribbon!.id)]: { worn: "worn" } }, castStates: { [String(w.bindingOf(w.mara).id)]: "missing" } })
		// The session's graph reads Mara as missing; the book itself does not say so.
		await draw(w, w.wren, w.mara, { type: "friend" })
		const { buildGraphContextData } = await import("$lib/server/utils/graphContextFormatter")
		const graph = await buildGraphContextData({ db: db as any, sessionId: w.session.id, lorebookId: w.book.id, speakerCharacterId: w.wren.id })
		expect(graph?.yourRelationships?.[w.mara.name]).toEqual([expect.objectContaining({ theirState: "missing" })])
		// At Full, the same moment writes the book itself.
		await db.update(schema.lorebooks).set({ loreWriteMode: "full" }).where(eq(schema.lorebooks.id, w.book.id))
		const full = await act(w, "notes-vanish", w.wren, w.dov, null, "run-notes-3")
		expect((full.facts.landings as any[])[0]).not.toHaveProperty("overlaid")
		const [d] = await db.select().from(schema.lorebookBindings).where(eq(schema.lorebookBindings.id, w.bindingOf(w.dov).id))
		expect(d!.nodeState).toBe("missing")
	})
})

/**
 * 🚧 **What a moment changed goes with its message** (RF fix 4, 2026-10-23):
 * the zone snapshot, the tie's words on its row and the run that wrote them,
 * a row the notes copied, the notes' rule-fed overlay — taken back by a
 * swipe's retraction, and put back by a failed replacement's restore.
 */
describe("🚧 RF fix 4: a moment's lorebook writes go back with its message", () => {
	/** A second message for the moment, so the drawn sides (anchored at the first) stand. */
	async function actOn(w: World, fnKey: string, actor: { id: number }, aimedAt: { id: number }, answer: unknown, runId: string) {
		const [turn] = await db.insert(schema.messages).values({ sessionId: w.session.id, role: "character" }).returning()
		const { resolveRulesetTurn } = await import("./resolve")
		const res = await resolveRulesetTurn(
			db as any,
			{ owners: [`session:${w.session.id}`, w.key(w.wren), w.key(w.mara), w.key(w.dov)], mode: "apply", actions: { function: fnKey, actor: w.key(actor), aimedAt: w.key(aimedAt), answer } },
			{ runId, turnMessageId: turn!.id }
		)
		if ("halt" in res) throw new Error(res.halt)
		return { out: res.ok, turn: turn! }
	}
	const retract = async (messageId: number) => (await import("$lib/server/state/write")).retractStateAnchoredTo(db as any, messageId)
	const restore = async (taken: any) => (await import("$lib/server/state/write")).restoreRetractedState(db as any, taken)

	test("the tie's words and its zone go back together, and come back on restore; words someone retyped since stay", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		const { turn } = await actOn(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-fix4-1")
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "close", rulesRunId: "run-fix4-1" })

		// The run's receipt, as a reply's would be: its line is history while its moment stands.
		const t = Date.now()
		await db.insert(schema.pipelineRuns).values({
			runId: "run-fix4-1",
			specSlug: "core:spec/rules-action",
			specVersion: "1.0.0",
			sessionId: w.session.id,
			outcome: "ok",
			triggerSource: "action",
			seed: "s",
			startedAt: new Date(t),
			endedAt: new Date(t + 5),
			receipt: { runId: "run-fix4-1", nodes: [{ nodeKey: "resolve", output: { facts: { landings: [{ kind: "tie", relationshipId: row.id, owner: w.key(w.wren), columns: [] }] } } }] }
		})
		const { tieHistory } = await import("./ties")
		expect((await tieHistory(db, row.id)).map((l) => l.runId)).toEqual(["run-fix4-1"])

		const taken = await retract(turn.id)
		expect(taken.changed).toBe(true)
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "warm", rulesRunId: null })
		expect((await bondsOf(w, w.wren))[0]!.fields).toMatchObject({ affection: 3, standing: "warm", edge: String(row.id) })
		expect(await tieHistory(db, row.id)).toEqual([])
		await restore(taken.taken)
		expect((await tieHistory(db, row.id)).map((l) => l.runId)).toEqual(["run-fix4-1"])
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "close", rulesRunId: "run-fix4-1" })
		expect((await bondsOf(w, w.wren))[0]!.fields).toMatchObject({ affection: 4, standing: "close" })

		// Someone retypes the row after a second moment: the words stay, the run's mark goes.
		const second = await actOn(w, "ties-keepsake", w.wren, w.mara, { standing: "cold" }, "run-fix4-2")
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "cold", rulesRunId: "run-fix4-2" })
		await db.update(schema.narrativeRelationships).set({ relationshipType: "smitten" }).where(eq(schema.narrativeRelationships.id, row.id))
		await retract(second.turn.id)
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "smitten", rulesRunId: "run-fix4-1" })
		const kept = await db
			.select()
			.from(schema.loreImprints)
			.where(and(eq(schema.loreImprints.subjectKind, "relationship"), eq(schema.loreImprints.subjectId, row.id), eq(schema.loreImprints.status, "kept")))
		expect(kept.map((k) => k.field)).toEqual(["relationshipType"])
	})

	test("the notes' copy of a row the session may not write is removed with its message", async () => {
		const w = await world()
		const { row } = await draw(w, w.wren, w.mara, { type: "warm", title: "crush" })
		await db.update(schema.lorebooks).set({ loreWriteMode: "review" }).where(eq(schema.lorebooks.id, w.book.id))
		const { out, turn } = await actOn(w, "ties-keepsake", w.wren, w.mara, { standing: "close" }, "run-fix4-3")
		const copy = (out.facts.landings as any[])[0].relationshipId as number
		expect((await rowOf(copy))!.lorebookId).not.toBe(w.book.id)
		await retract(turn.id)
		expect(await rowOf(copy)).toBeUndefined()
		expect(await rowOf(row.id)).toMatchObject({ relationshipType: "warm", rulesRunId: null })
	})

	test("the notes' rule-fed overlay goes back with its message, and comes back on restore", async () => {
		const w = await world(NOTES)
		await db.update(schema.lorebooks).set({ loreWriteMode: "review" }).where(eq(schema.lorebooks.id, w.book.id))
		const [ribbon] = await db
			.insert(schema.lorebookEntries)
			.values({ lorebookId: w.book.id, typeId: "core:entry/world-lore", typeVersion: 1, title: "A ribbon", content: "Blue.", position: 1, fields: { worn: "new" } } as any)
			.returning()
		await db.insert(schema.zoneContents).values({
			sessionId: w.session.id,
			ownerKind: "session_cast",
			ownerId: w.wren.id,
			rulesetId: NOTES,
			zoneType: "pocket",
			entries: [{ entryId: ribbon!.id, entryType: "keepsake", name: "A ribbon", fields: { worn: "new" } }],
			validFromMessageId: w.message.id
		})
		const worn = await actOn(w, "notes-wear", w.wren, w.mara, { name: "A ribbon" }, "run-fix4-4")
		const gone = await actOn(w, "notes-vanish", w.wren, w.mara, null, "run-fix4-5")
		const { ruleFedOverlayOf } = await import("./ties")
		const both = { entryFields: { [String(ribbon!.id)]: { worn: "worn" } }, castStates: { [String(w.bindingOf(w.mara).id)]: "missing" } }
		expect(await ruleFedOverlayOf(db, w.session.id)).toEqual(both)

		const taken = await retract(gone.turn.id)
		expect(await ruleFedOverlayOf(db, w.session.id)).toEqual({ entryFields: both.entryFields, castStates: {} })
		await restore(taken.taken)
		expect(await ruleFedOverlayOf(db, w.session.id)).toEqual(both)
		await retract(gone.turn.id)
		await retract(worn.turn.id)
		expect(await ruleFedOverlayOf(db, w.session.id)).toBeNull()
		// The book kept its own all along.
		const [still] = await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, ribbon!.id))
		expect((still!.fields as any).worn).toBe("new")
	})
})
