/**
 * The 0119 data upgrade (PLAN-rulesets-functions D2, D5, lane A1,
 * 2026-10-23): a copy of Vis Itineris made on the pub, persisted in the seven
 * sections — read exactly as before — and a session's list-slot pieces of
 * its repertoires copied into the owner's carried zone as held entries
 * (a lore piece's entry id kept); a second run changes nothing. Scratch
 * tables with the columns the upgrade touches, so the SQL is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { declaresSections, rulesetSections } from "@serene-pub/sdk"
import { visItinerisRuleset } from "@serene-pub/core-catalog"
import { rawRows } from "../rawRows"
import { rulesetDocumentInSections, rulesetsFunctionsUpgrade } from "./0119_rulesets_functions"
import { visItinerisDocumentBeforeSections } from "$lib/server/rulesets/beforeSections.testkit"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
const VIS = "acme:ruleset/vis@1"

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE rulesets (id serial PRIMARY KEY, ruleset_id text NOT NULL, draft jsonb NOT NULL, published jsonb)`)
	await q(`CREATE TABLE sessions (id serial PRIMARY KEY, primary_ruleset text)`)
	await q(`CREATE TABLE attribute_declarations (id text PRIMARY KEY, props jsonb)`)
	await q(`CREATE TABLE lorebook_entries (id serial PRIMARY KEY, title text)`)
	await q(
		`CREATE TABLE attribute_values (id serial PRIMARY KEY, owner_kind text NOT NULL, owner_id integer NOT NULL, slot_id text NOT NULL, value jsonb NOT NULL, session_id integer, valid_from_message_id integer, branch_id integer)`
	)
	await q(
		`CREATE TABLE zone_contents (id serial PRIMARY KEY, session_id integer NOT NULL, owner_kind text NOT NULL, owner_id integer NOT NULL, ruleset_id text NOT NULL, zone_type text NOT NULL, entries jsonb NOT NULL, valid_from_message_id integer, updated_by text NOT NULL DEFAULT 'rules', note text, created_at timestamp NOT NULL DEFAULT now())`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const upgrade = () => db.transaction(async (tx: any) => rulesetsFunctionsUpgrade(tx))

/** Vis Itineris as the editor stores a copy of it: under its own id, versioned. */
function copy(): Record<string, any> {
	// Its document in the shape before the sections (the registry declares it in them since 2026-10-23).
	const d = JSON.parse(JSON.stringify(visItinerisDocumentBeforeSections())) as Record<string, any>
	return { ...d, id: VIS, version: "1.2.0" }
}

describe("0119 rulesets into the seven sections", () => {
	it("a pub copy of Vis Itineris: sections persisted, id and version kept, read exactly as before; a second run changes nothing", async () => {
		const old = copy()
		await db.execute(sql`INSERT INTO rulesets (ruleset_id, draft, published) VALUES (${VIS}, ${JSON.stringify(old)}::jsonb, ${JSON.stringify(old)}::jsonb)`)
		await db.execute(sql`INSERT INTO rulesets (ruleset_id, draft, published) VALUES (${"acme:ruleset/scratch@1"}, ${JSON.stringify({ id: "acme:ruleset/scratch@1", version: "1.0.0", name: { en: "Scratch" } })}::jsonb, null)`)
		const report = await upgrade()
		expect(report.rows).toBe(2)
		expect(report.inSections).toEqual([VIS])
		const [row] = await rows<{ draft: any; published: any }>(`SELECT draft, published FROM rulesets WHERE ruleset_id = '${VIS}'`)
		for (const d of [row!.draft, row!.published]) {
			expect(declaresSections(d)).toBe(true)
			for (const k of ["stats", "repertoires", "selectors", "scripts", "conventions", "compendium", "settings", "presets"]) expect(d[k]).toBeUndefined()
			expect(d.id).toBe(VIS)
			expect(d.version).toBe("1.2.0")
			expect(d.name).toEqual(old.name)
			expect(d.voice).toEqual(old.voice)
			// The same reading: the sections of the new document are those the old one read as —
			// functions compared by key (jsonb keeps no object key order, so a selectors map read back
			// lists its uses in another order; the default way is listed first either way).
			const plain = (x: unknown) => JSON.parse(JSON.stringify(x))
			const byKey = (fs: any[] = []) => [...fs].sort((a, b) => (String(a.key ?? a.ref) < String(b.key ?? b.ref) ? -1 : 1))
			const now = plain(rulesetSections(d))
			const was = plain(rulesetSections(old))
			expect(byKey(now.functions)).toEqual(byKey(was.functions))
			expect(now.functions[0]).toEqual(was.functions[0])
			expect({ ...now, functions: undefined }).toEqual({ ...was, functions: undefined })
		}
		const again = await upgrade()
		expect(again.inSections).toEqual([])
		const [after] = await rows<{ draft: any }>(`SELECT draft FROM rulesets WHERE ruleset_id = '${VIS}'`)
		expect(after!.draft).toEqual(row!.draft)
	})

	it("a document already in sections is left as it is", () => {
		const doc = { id: "acme:ruleset/hearts@1", version: "1.0.0", name: { en: "Hearts" }, attributes: [{ id: "affection", kind: "number", prose: "x" }] }
		expect(rulesetDocumentInSections(doc)).toEqual({ doc, changed: false, repertoires: [] })
	})
})

describe("0119 list-slot pieces into carried zones", () => {
	it("each owner's newest list of the ruleset's repertoires, as held entries; an owner with a carried zone is skipped; idempotent", async () => {
		await db.execute(sql`INSERT INTO rulesets (ruleset_id, draft, published) VALUES (${VIS}, ${JSON.stringify(copy())}::jsonb, null)`)
		await q(`INSERT INTO sessions (id, primary_ruleset) VALUES (1, '${VIS}'), (2, 'core:ruleset/freeform@1'), (3, '${VIS}')`)
		await q(`INSERT INTO lorebook_entries (id, title) VALUES (3, 'Lucky coin')`)
		await db.execute(
			sql`INSERT INTO attribute_declarations (id, props) VALUES (${"acme:slot/vis-weapons@1"}, ${JSON.stringify({ type: "list", config: { repertoire: `${VIS}#weapons` } })}::jsonb),
				(${"acme:slot/vis-other@1"}, ${JSON.stringify({ type: "list", config: { repertoire: "core:ruleset/vis-itineris@1#weapons" } })}::jsonb)`
		)
		const put = (session: number, owner: number, slot: string, v: unknown, message: number | null) =>
			db.execute(sql`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value, session_id, valid_from_message_id) VALUES ('session_cast', ${owner}, ${slot}, ${JSON.stringify({ v })}::jsonb, ${session}, ${message})`)
		await put(1, 5, "acme:slot/vis-weapons@1", [{ kind: "inline", name: "Stick", description: "Old." }], 10)
		await put(1, 5, "acme:slot/vis-weapons@1", [
			{ kind: "inline", name: "Longsword", description: "A blade.", equipped: true },
			{ kind: "lore", entryId: 3, count: 2 },
			{ kind: "compendium", compendiumId: VIS, pieceId: "dagger", version: "1", overrides: { equipped: false } },
			"a loose word"
		], 12)
		// Another ruleset's session, another ruleset's slot: untouched.
		await put(2, 6, "acme:slot/vis-weapons@1", [{ kind: "inline", name: "Mop", description: "Wet." }], null)
		await put(1, 5, "acme:slot/vis-other@1", [{ kind: "inline", name: "Hammer", description: "Heavy." }], null)
		// An owner who already carries a zone of the ruleset keeps it.
		await put(3, 7, "acme:slot/vis-weapons@1", [{ kind: "inline", name: "Rapier", description: "Thin." }], null)
		await q(`INSERT INTO zone_contents (session_id, owner_kind, owner_id, ruleset_id, zone_type, entries) VALUES (3, 'session_cast', 7, '${VIS}', 'carried', '[]'::jsonb)`)

		const report = await upgrade()
		expect(report.carried).toEqual([{ sessionId: 1, ownerKind: "session_cast", ownerId: 5, rulesetId: VIS, entries: 3 }])
		const zones = await rows<{ session_id: number; owner_id: number; zone_type: string; entries: any[]; valid_from_message_id: number | null; updated_by: string }>(
			`SELECT session_id, owner_id, zone_type, entries, valid_from_message_id, updated_by FROM zone_contents ORDER BY id`
		)
		expect(zones).toHaveLength(2)
		const z = zones[1]!
		expect(z).toMatchObject({ session_id: 1, owner_id: 5, zone_type: "carried", valid_from_message_id: 12, updated_by: "upgrade:0119" })
		const dagger = visItinerisRuleset.compendium?.rows?.weapons?.find((r: { id: string }) => r.id === "dagger") as { name?: string } | undefined
		expect(z.entries).toEqual([
			{ entryId: null, entryType: "weapons", name: "Longsword", fields: { description: "A blade.", equipped: true } },
			{ entryId: 3, entryType: "weapons", name: "Lucky coin", fields: {}, count: 2 },
			{ entryId: null, entryType: "weapons", name: dagger?.name ?? "dagger", fields: { equipped: false, libraryRow: "dagger" } }
		])
		// The list rows stay where they were.
		expect((await rows(`SELECT id FROM attribute_values`)).length).toBe(5)
		const again = await upgrade()
		expect(again.carried).toEqual([])
		expect((await rows(`SELECT id FROM zone_contents`)).length).toBe(2)
	})
})
