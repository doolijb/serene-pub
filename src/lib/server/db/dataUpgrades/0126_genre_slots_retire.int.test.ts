/**
 * The 0126 data upgrade (RF fix 8, 2026-10-23): attributes are the rules'.
 * A value a session holds on a retired genre slot is left alone where the
 * session's rules keep that very slot (Vis Itineris's health), moved onto the
 * rules' attribute of the same tag or id where the value fits it, and
 * otherwise written into the session's notes as one line under *Carried over
 * from before* — its rows, carries and configurations dropped. The host's
 * place is never touched; a lorebook's timeline is never touched; a second
 * run changes nothing. Scratch tables with the columns the upgrade touches,
 * so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { CARRIED_OVER_TITLE, RETIRED_GENRE_SLOTS, retireGenreSlots } from "./0126_genre_slots_retire"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => retireGenreSlots(tx))

const FREEFORM = "core:ruleset/freeform@1"
const VIS = "core:ruleset/vis-itineris@1"
const GRIT = "acme:ruleset/grit@1"

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE sessions (id serial PRIMARY KEY, user_id integer NOT NULL, name text, lorebook_id integer, primary_ruleset text, ruleset_version text, genre_id text NOT NULL DEFAULT 'core:genre/story')`)
	await q(`CREATE TABLE characters (id serial PRIMARY KEY, name text)`)
	await q(`CREATE TABLE session_personas (id serial PRIMARY KEY, seat_name text, removed_name text)`)
	await q(`CREATE TABLE attribute_values (id serial PRIMARY KEY, owner_kind text NOT NULL, owner_id integer NOT NULL, slot_id text NOT NULL, value jsonb NOT NULL, session_id integer)`)
	await q(`CREATE TABLE attribute_carries (id serial PRIMARY KEY, session_id integer NOT NULL, owner_kind text NOT NULL, owner_id integer NOT NULL, slot_id text NOT NULL, carries boolean NOT NULL)`)
	await q(`CREATE TABLE attribute_configs (id serial PRIMARY KEY, owner_kind text NOT NULL, owner_id integer NOT NULL, slot_id text NOT NULL, config jsonb, session_id integer)`)
	await q(`CREATE TABLE lorebooks (id serial PRIMARY KEY, name text NOT NULL, user_id integer NOT NULL, session_id integer UNIQUE, overlay_of integer, primary_ruleset text NOT NULL DEFAULT '${FREEFORM}', ruleset_version text)`)
	await q(`CREATE TABLE lorebook_entries (id serial PRIMARY KEY, lorebook_id integer NOT NULL, type_id text NOT NULL, type_version integer NOT NULL, title text, content text NOT NULL DEFAULT '', position integer NOT NULL)`)
	await q(`CREATE TABLE rulesets (id serial PRIMARY KEY, ruleset_id text NOT NULL UNIQUE, published jsonb)`)
	// A published ruleset of the author's: a health-tagged number of its own, and a mood of two words.
	await q(`INSERT INTO rulesets (ruleset_id, published) VALUES ('${GRIT}', '${JSON.stringify({
		name: { en: "Grit" },
		attributes: [
			{ id: "vigour", name: { en: "Vigour" }, kind: "number", tags: ["health"], prose: "How much fight is left." },
			{ id: "mood", name: { en: "Mood" }, kind: "label", of: ["calm", "giddy"], prose: "How they feel." }
		]
	})}')`)
	await q(`INSERT INTO characters (id, name) VALUES (1, 'Verity'), (2, 'Brask')`)
	await q(`INSERT INTO session_personas (id, seat_name) VALUES (5, 'Mara')`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const value = (sessionId: number, kind: string, owner: number, slot: string, v: unknown) =>
	q(`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value, session_id) VALUES ('${kind}', ${owner}, '${slot}', '${JSON.stringify({ v })}', ${sessionId})`)

describe("0126 genre slots retire: attributes are the rules'", () => {
	it("freezes the retired slots it carries — never the host's place, never a ruleset's own", () => {
		expect(Object.isFrozen(RETIRED_GENRE_SLOTS)).toBe(true)
		expect(Object.keys(RETIRED_GENRE_SLOTS)).toContain("core:slot/hp@1")
		expect(Object.keys(RETIRED_GENRE_SLOTS)).not.toContain("core:slot/location@1")
		expect(Object.keys(RETIRED_GENRE_SLOTS).some((s) => /itineris|crawl-|whisper|direction|fate|standing-order/.test(s))).toBe(false)
	})

	it("rules that keep none: each newest value a line in the session's notes, the rows, carries and configurations gone; the place and the book untouched; a second run changes nothing", async () => {
		await q(`INSERT INTO sessions (id, user_id, name, lorebook_id, primary_ruleset) VALUES (1, 9, 'The pier', 40, '${FREEFORM}')`)
		await value(1, "session_cast", 1, "core:slot/hp@1", 20)
		await value(1, "session_cast", 1, "core:slot/hp@1", 14)
		await value(1, "session_cast", 1, "core:slot/mood@1", "giddy")
		await value(1, "session_cast", 1, "core:slot/inventory@1", [{ entryId: 3, name: "Rope", count: 2 }, "lamp"])
		await value(1, "session", 1, "core:slot/weather@1", "storm")
		await value(1, "player_seat", 5, "core:slot/trust@1", null)
		await value(1, "session", 1, "core:slot/location@1", "The pier")
		// A lorebook's timeline is that book's: never the session's to move.
		await q(`INSERT INTO attribute_values (owner_kind, owner_id, slot_id, value, session_id) VALUES ('lorebook', 40, 'core:slot/weather@1', '{"v":"clear"}', NULL)`)
		await q(`INSERT INTO attribute_carries (session_id, owner_kind, owner_id, slot_id, carries) VALUES (1, 'session_cast', 1, 'core:slot/mood@1', false)`)
		await q(`INSERT INTO attribute_configs (owner_kind, owner_id, slot_id, config, session_id) VALUES ('session_cast', 1, 'core:slot/hp@1', '{"max":30}', 1)`)
		const r = await upgrade()
		expect(r).toEqual({ sessions: 1, moved: 0, noted: 3, dropped: 5 })
		// The place and ⏳ what someone carries are the host's in a Story session.
		expect((await rows<{ slot_id: string }>(`SELECT slot_id FROM attribute_values WHERE session_id = 1 ORDER BY id`)).map((x) => x.slot_id)).toEqual([
			"core:slot/inventory@1",
			"core:slot/location@1"
		])
		expect(await rows(`SELECT * FROM attribute_values WHERE session_id IS NULL`)).toHaveLength(1)
		expect(await rows(`SELECT * FROM attribute_carries`)).toEqual([])
		expect(await rows(`SELECT * FROM attribute_configs`)).toEqual([])
		const [notes] = await rows<{ id: number; name: string; user_id: number; overlay_of: number }>(`SELECT id, name, user_id, overlay_of FROM lorebooks WHERE session_id = 1`)
		expect(notes).toMatchObject({ name: "The pier", user_id: 9, overlay_of: 40 })
		const entries = await rows<{ title: string; content: string; type_id: string }>(`SELECT title, content, type_id FROM lorebook_entries WHERE lorebook_id = ${notes!.id}`)
		expect(entries).toEqual([
			{
				title: CARRIED_OVER_TITLE,
				type_id: "core:entry/world-lore",
				// The world first, then each holder, each slot in order.
				content: ["The world: Weather storm", "Verity: Health 14", "Verity: Mood giddy"].join("\n")
			}
		])
		// Again: nothing on a retired slot is left to carry.
		expect(await upgrade()).toEqual({ sessions: 0, moved: 0, noted: 0, dropped: 0 })
		expect(await rows(`SELECT * FROM lorebook_entries`)).toHaveLength(1)
	}, 60_000)

	it("rules that keep the very slot leave it; rules with an attribute of the same tag take it, where the value fits", async () => {
		await q(`INSERT INTO sessions (id, user_id, name, primary_ruleset) VALUES (2, 9, 'The crawl', '${VIS}'), (3, 9, 'The grit', '${GRIT}')`)
		await value(2, "session_cast", 1, "core:slot/hp@1", 9)
		await value(2, "session_cast", 1, "core:slot/level@1", 3)
		await value(2, "session_cast", 1, "core:slot/stamina@1", 4)
		await value(3, "session_cast", 2, "core:slot/hp@1", 12)
		await value(3, "session_cast", 2, "core:slot/hp@1", 11)
		await value(3, "session_cast", 2, "core:slot/mood@1", "giddy")
		await value(3, "session_cast", 1, "core:slot/mood@1", "wary")
		const r = await upgrade()
		expect(r).toEqual({ sessions: 2, moved: 3, noted: 2, dropped: 2 })
		// Vis Itineris borrows health and level: its own now.
		expect((await rows<{ slot_id: string }>(`SELECT slot_id FROM attribute_values WHERE session_id = 2 ORDER BY id`)).map((x) => x.slot_id)).toEqual(["core:slot/hp@1", "core:slot/level@1"])
		// Grit: health onto its vigour, history and all; a mood it has the word for, onto its mood; one it has not, noted.
		expect((await rows<{ slot_id: string; owner_id: number }>(`SELECT slot_id, owner_id FROM attribute_values WHERE session_id = 3 ORDER BY id`)).map((x) => `${x.owner_id} ${x.slot_id}`)).toEqual([
			"2 acme.grit:slot/vigour@1",
			"2 acme.grit:slot/vigour@1",
			"2 acme.grit:slot/mood@1"
		])
		const notes = await rows<{ session_id: number; content: string }>(`SELECT l.session_id, e.content FROM lorebook_entries e JOIN lorebooks l ON l.id = e.lorebook_id ORDER BY l.session_id`)
		expect(notes).toEqual([
			{ session_id: 2, content: "Verity: Stamina 4" },
			{ session_id: 3, content: "Verity: Mood wary" }
		])
	}, 60_000)

	it("⏳ the crawl's retired inventory is noted; a Lair session's is the host's and stays", async () => {
		await q(`INSERT INTO sessions (id, user_id, name, primary_ruleset, genre_id) VALUES (6, 9, 'The delve', '${FREEFORM}', 'core:genre/dungeon-crawler'), (7, 9, 'The lair', '${FREEFORM}', 'core:genre/lair')`)
		await value(6, "session_cast", 1, "core:slot/inventory@1", [{ entryId: 3, name: "Rope", count: 2 }, "lamp"])
		await value(7, "session_cast", 2, "core:slot/inventory@1", ["torch"])
		expect(await upgrade()).toEqual({ sessions: 1, moved: 0, noted: 1, dropped: 1 })
		expect((await rows<{ session_id: number }>(`SELECT session_id FROM attribute_values ORDER BY id`)).map((x) => x.session_id)).toEqual([7])
		const notes = await rows<{ session_id: number; content: string }>(`SELECT l.session_id, e.content FROM lorebook_entries e JOIN lorebooks l ON l.id = e.lorebook_id`)
		expect(notes).toEqual([{ session_id: 6, content: "Verity: Inventory Rope ×2, lamp" }])
	}, 60_000)

	it("a session's own notes are kept and added to, each line once", async () => {
		await q(`INSERT INTO sessions (id, user_id, name, primary_ruleset) VALUES (4, 9, 'Notes', '${FREEFORM}')`)
		await q(`INSERT INTO lorebooks (id, name, user_id, session_id) VALUES (70, 'Notes', 9, 4)`)
		await q(`INSERT INTO lorebook_entries (lorebook_id, type_id, type_version, title, content, position) VALUES (70, 'core:entry/world-lore', 1, 'The harbour', 'Grey.', 0),
			(70, 'core:entry/world-lore', 1, '${CARRIED_OVER_TITLE}', 'Mara: Trust 2', 1)`)
		await value(4, "player_seat", 5, "core:slot/trust@1", 2)
		await value(4, "player_seat", 5, "core:slot/currency@1", 30)
		await upgrade()
		expect(await rows(`SELECT id FROM lorebooks`)).toHaveLength(1)
		const [carried] = await rows<{ content: string }>(`SELECT content FROM lorebook_entries WHERE title = '${CARRIED_OVER_TITLE}'`)
		expect(carried!.content).toBe("Mara: Trust 2\nMara: Currency 30")
	}, 60_000)
})
