/**
 * The 0118 data upgrade (PLAN-rulesets-authoring D6, lane M4, 2026-10-22):
 * a ruleset made on the pub before check methods — a copy of Vis Itineris as
 * the editor saved one before M1 (its die under `conventions.dice`, its
 * difficulties top-level, no tags, `harm` saying `dice`, the spell-point
 * choice read by its id) — onto methods, bands under the method, amounts,
 * guessed tags and a declared casting pool; the result passes the SDK's
 * checks, and a second run changes nothing. A scratch `rulesets` table with
 * the columns the upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rulesetDocumentFindings, rulesetWarnings, type RulesetDocument } from "@serene-pub/sdk"
import { rawRows } from "../rawRows"
import { rulesetsCheckMethodsUpgrade, upgradeRulesetDocument } from "./0118_rulesets_check_methods"
import { visItinerisDocumentBeforeSections } from "$lib/server/rulesets/beforeSections.testkit"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))

/** Vis Itineris as the editor stored a copy of it before M1. */
function preM1(): Record<string, any> {
	// Its document in the shape before the sections (the registry declares it in them since 2026-10-23).
	const d = JSON.parse(JSON.stringify(visItinerisDocumentBeforeSections())) as Record<string, any>
	const die = d.conventions.methods.die
	d.conventions.dice = { sides: die.sides }
	d.difficultyBands = die.bands
	delete d.conventions.methods
	delete d.conventions.defaultMethod
	for (const rep of d.repertoires) {
		delete rep.tags
		for (const m of rep.mechanics ?? [])
			if ((m.verb === "harm" || m.verb === "heal") && m.amount?.selector) {
				m.dice = m.amount.selector
				delete m.amount
			}
	}
	for (const c of d.settings.casting.choices) delete c.conventions
	return d
}

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE rulesets (id serial PRIMARY KEY, ruleset_id text NOT NULL, draft jsonb NOT NULL, published jsonb)`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const upgrade = () => db.transaction(async (tx: any) => rulesetsCheckMethodsUpgrade(tx))

describe("0118 rulesets onto check methods", () => {
	it("a pre-M1 copy of Vis Itineris: methods, bands under the die, amounts, tags, the spell-point pool — and it checks clean", async () => {
		const old = preM1()
		await db.execute(
			sql`INSERT INTO rulesets (ruleset_id, draft, published) VALUES (${"acme:ruleset/vis@1"}, ${JSON.stringify(old)}::jsonb, ${JSON.stringify(old)}::jsonb),
				(${"acme:ruleset/plain@1"}, ${JSON.stringify({ id: "acme:ruleset/plain@1", version: "1.0.0", conventions: { time: { unit: "scene" } }, repertoires: [{ id: "notes", tags: ["note"] }] })}::jsonb, null)`
		)
		const report = await upgrade()
		expect(report.rows).toBe(2)
		expect(report.changed.map((c: { rulesetId: string }) => c.rulesetId)).toEqual(["acme:ruleset/vis@1"])
		const [row] = await rows<{ draft: any; published: any }>(`SELECT draft, published FROM rulesets WHERE ruleset_id = 'acme:ruleset/vis@1'`)
		const d = row!.draft
		expect(d.conventions.dice).toBeUndefined()
		expect(d.difficultyBands).toBeUndefined()
		expect(d.conventions.methods).toEqual({ die: { kind: "die-target", sides: 20, bands: old.difficultyBands } })
		expect(d.conventions.defaultMethod).toBeUndefined()
		const weapons = d.repertoires.find((r: any) => r.id === "weapons")
		expect(weapons.tags).toEqual(["weapon"])
		expect(weapons.mechanics.find((m: any) => m.verb === "harm")).toMatchObject({ amount: { selector: "piece.damage" } })
		expect(weapons.mechanics.some((m: any) => m.dice !== undefined)).toBe(false)
		expect(d.repertoires.find((r: any) => r.id === "conditions").tags).toEqual(["condition"])
		const points = d.settings.casting.choices.find((c: any) => c.id === "points")
		expect(points.conventions).toEqual({
			casting: { pool: "itineris-spell-points", cost: "level", repertoire: "spells", refill: "long", max: "spell-points-max" }
		})
		expect(row!.published).toEqual(d)
		// The SDK reads it as written: no refusal, and no legacy warning left.
		expect(rulesetDocumentFindings(d as RulesetDocument)).toEqual([])
		expect(rulesetWarnings(d as never).filter((w) => /legacy-/.test(w))).toEqual([])
		// The other row said nothing old: untouched, and still no published version.
		const [plain] = await rows<{ draft: any; published: any }>(`SELECT draft, published FROM rulesets WHERE ruleset_id = 'acme:ruleset/plain@1'`)
		expect(plain!.published).toBeNull()
		expect(plain!.draft.repertoires).toEqual([{ id: "notes", tags: ["note"] }])
	}, 60_000)

	it("a second run finds nothing old", async () => {
		await db.execute(sql`INSERT INTO rulesets (ruleset_id, draft, published) VALUES (${"acme:ruleset/vis@1"}, ${JSON.stringify(preM1())}::jsonb, null)`)
		expect((await upgrade()).changed.length).toBe(1)
		expect((await upgrade()).changed).toEqual([])
	}, 60_000)

	it("bands beside methods go under the default method; a choice's old die becomes its methods", () => {
		const { doc, changes } = upgradeRulesetDocument({
			conventions: {
				methods: { risk: { kind: "bid", resource: "nerve", costs: [] }, roll: { kind: "die-target", sides: 6 } },
				defaultMethod: "roll",
				time: { unit: "scene" }
			},
			difficultyBands: [{ id: "hard", label: "Hard", target: 5, default: true }],
			settings: { die: { default: "d6", choices: [{ id: "d6" }, { id: "d8", conventions: { dice: { sides: 8 } } }] } },
			repertoires: []
		})
		expect(doc.difficultyBands).toBeUndefined()
		expect((doc.conventions as any).methods.roll.bands).toEqual([{ id: "hard", label: "Hard", target: 5, default: true }])
		expect((doc.settings as any).die.choices[1].conventions).toEqual({ methods: { die: { kind: "die-target", sides: 8 } } })
		expect(changes.length).toBe(2)
	})
})
