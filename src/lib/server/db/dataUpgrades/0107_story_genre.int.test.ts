/**
 * The 0107 data upgrade: Chat and Adventure sessions become Story sessions,
 * their shipped presets become Story's Minimal and Living with their row ids
 * kept, the roleplay specs change slug (`chat-*` → `story-*`) and every JSON
 * that spelled a slug out follows. A scratch schema with just the tables the
 * upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { run } from "./0107_story_genre"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE sessions (id integer PRIMARY KEY, genre_id text NOT NULL, preset_id integer, primary_ruleset text)`)
	await q(`CREATE TABLE lorebooks (id integer PRIMARY KEY, primary_ruleset text)`)
	await q(`CREATE TABLE lorebook_entries (id integer PRIMARY KEY, type_id text NOT NULL)`)
	await q(`CREATE TABLE session_presets (id integer PRIMARY KEY, seed_key text UNIQUE, name text NOT NULL, genre_id text NOT NULL,
		bindings json, included_actions json, is_default boolean NOT NULL DEFAULT false)`)
	await q(`CREATE TABLE pipeline_specs (id integer PRIMARY KEY, slug text NOT NULL UNIQUE, source_plugin_id integer)`)
	await q(`CREATE TABLE pipeline_prompts (id integer PRIMARY KEY, seed_key text, owner_plugin_id integer)`)
	await q(`CREATE TABLE pipeline_runs (id integer PRIMARY KEY, spec_slug text NOT NULL)`)
	await q(`CREATE TABLE session_layout_presets (id integer PRIMARY KEY, genre_id text NOT NULL)`)
	await q(`CREATE TABLE user_layout_defaults (id integer PRIMARY KEY, user_id integer NOT NULL, genre_id text NOT NULL)`)
	await q(`CREATE TABLE session_genre_settings (genre_id text PRIMARY KEY, enabled boolean)`)

	await q(`INSERT INTO session_presets (id, seed_key, name, genre_id, bindings, included_actions, is_default) VALUES
		(1, 'core-chat-default', 'Chat', 'core:genre/chat', '{"core:event/message-respond@1":{"spec":"core:spec/chat-respond"}}', '["core:spec/chat-narrate#narrate"]', true),
		(2, 'core-adventure-default', 'Adventure', 'core:genre/adventure', '{"core:event/message-respond@1":{"spec":"core:spec/adventure-respond"}}', null, true),
		(3, 'core-guide-default', 'Guide', 'core:genre/guide', '{}', null, true),
		(4, null, 'My chat copy', 'core:genre/chat', '{"core:event/message-respond@1":{"spec":"core:spec/chat-respond"}}', null, false)`)
	await q(`INSERT INTO sessions (id, genre_id, preset_id, primary_ruleset) VALUES (10, 'core:genre/chat', 1, null), (11, 'core:genre/adventure', 2, 'core:ruleset/story@1'), (12, 'core:genre/guide', 3, null), (13, 'core:genre/chat', null, null)`)
	await q(`INSERT INTO lorebooks (id, primary_ruleset) VALUES (1, 'core:ruleset/story@1'), (2, 'core:ruleset/vis-itineris@1')`)
	await q(`INSERT INTO lorebook_entries (id, type_id) VALUES (1, 'core:entry/story.things@1'), (2, 'core:entry/location')`)
	await q(`INSERT INTO pipeline_specs (id, slug, source_plugin_id) VALUES (100, 'core:spec/chat-respond', null), (101, 'core:spec/chat-create', null),
		(102, 'core:spec/adventure-respond', null), (103, 'core:spec/chat-respond-fork', 7)`)
	await q(`INSERT INTO pipeline_prompts (id, seed_key, owner_plugin_id) VALUES (200, 'pipeline-prompt:core:respond:chat-main', null), (201, 'pipeline-prompt:core:respond:guide-main', null)`)
	await q(`INSERT INTO pipeline_runs (id, spec_slug) VALUES (300, 'core:spec/chat-respond'), (301, 'core:spec/guide-respond')`)
	await q(`INSERT INTO session_layout_presets (id, genre_id) VALUES (400, 'core:genre/chat'), (401, 'core:genre/adventure'), (402, 'core:genre/lair')`)
	await q(`INSERT INTO user_layout_defaults (id, user_id, genre_id) VALUES (500, 1, 'core:genre/chat'), (501, 1, 'core:genre/adventure'), (502, 2, 'core:genre/adventure')`)
	await q(`INSERT INTO session_genre_settings (genre_id, enabled) VALUES ('core:genre/chat', true), ('core:genre/adventure', false)`)
})

afterEach(async () => {
	await client.close()
})

describe("0107 story genre", () => {
	it("moves sessions, presets, specs, prompts and layouts to Story; keeps ids; leaves other genres alone", async () => {
		await db.transaction(async (tx: any) => run(tx, {} as any))

		const sessions = await rows<{ id: number; genre_id: string; preset_id: number | null; primary_ruleset: string | null }>(`SELECT * FROM sessions ORDER BY id`)
		expect(sessions[1]!.primary_ruleset).toBe("core:ruleset/freeform@1")
		const books = await rows<{ primary_ruleset: string }>(`SELECT primary_ruleset FROM lorebooks ORDER BY id`)
		expect(books.map((b) => b.primary_ruleset)).toEqual(["core:ruleset/freeform@1", "core:ruleset/vis-itineris@1"])
		const types = await rows<{ type_id: string }>(`SELECT type_id FROM lorebook_entries ORDER BY id`)
		expect(types.map((t) => t.type_id)).toEqual(["core:entry/freeform.things@1", "core:entry/location"])
		expect(sessions.map((s) => [s.id, s.genre_id, s.preset_id])).toEqual([
			[10, "core:genre/story", 1],
			[11, "core:genre/story", 2],
			[12, "core:genre/guide", 3],
			// No preset named: an old Chat session lands on Minimal (one call, as before).
			[13, "core:genre/story", 1]
		])

		const presets = await rows<any>(`SELECT id, seed_key, name, genre_id, bindings::text AS b, included_actions::text AS a, is_default FROM session_presets ORDER BY id`)
		expect(presets.map((p) => [p.id, p.seed_key, p.name, p.genre_id, p.is_default])).toEqual([
			[1, "core-story-minimal", "Minimal", "core:genre/story", false],
			[2, "core-story-living", "Living", "core:genre/story", true],
			[3, "core-guide-default", "Guide", "core:genre/guide", true],
			[4, null, "My chat copy", "core:genre/story", false]
		])
		expect(presets[0].b).toContain("core:spec/story-respond")
		expect(presets[0].a).toContain("core:spec/story-narrate#narrate")
		expect(presets[3].b).toContain("core:spec/story-respond")

		const specs = await rows<{ id: number; slug: string }>(`SELECT id, slug FROM pipeline_specs ORDER BY id`)
		expect(specs.map((s) => [s.id, s.slug])).toEqual([
			[100, "core:spec/story-respond"],
			[101, "core:spec/story-create"],
			[102, "core:spec/adventure-respond"],
			// A plugin's own spec is not core's to rename, whatever it is called.
			[103, "core:spec/chat-respond-fork"]
		])
		const prompts = await rows<{ id: number; seed_key: string }>(`SELECT id, seed_key FROM pipeline_prompts ORDER BY id`)
		expect(prompts.map((p) => p.seed_key)).toEqual(["pipeline-prompt:core:respond:story-main", "pipeline-prompt:core:respond:guide-main"])
		const runs = await rows<{ spec_slug: string }>(`SELECT spec_slug FROM pipeline_runs ORDER BY id`)
		expect(runs.map((r) => r.spec_slug)).toEqual(["core:spec/story-respond", "core:spec/guide-respond"])

		const layouts = await rows<{ id: number; genre_id: string }>(`SELECT id, genre_id FROM session_layout_presets ORDER BY id`)
		expect(layouts.map((l) => l.genre_id)).toEqual(["core:genre/story", "core:genre/story", "core:genre/lair"])
		const defaults = await rows<{ id: number; user_id: number; genre_id: string }>(`SELECT * FROM user_layout_defaults ORDER BY id`)
		// User 1 held both: Chat's wins, Adventure's goes; user 2 held Adventure's alone.
		expect(defaults.map((d) => [d.id, d.user_id, d.genre_id])).toEqual([
			[500, 1, "core:genre/story"],
			[502, 2, "core:genre/story"]
		])
		const settings = await rows<{ genre_id: string; enabled: boolean }>(`SELECT * FROM session_genre_settings ORDER BY genre_id`)
		expect(settings).toEqual([{ genre_id: "core:genre/story", enabled: true }])
	})

	it("is idempotent", async () => {
		await db.transaction(async (tx: any) => run(tx, {} as any))
		await db.transaction(async (tx: any) => run(tx, {} as any))
		const presets = await rows<{ seed_key: string }>(`SELECT seed_key FROM session_presets WHERE id IN (1,2) ORDER BY id`)
		expect(presets.map((p) => p.seed_key)).toEqual(["core-story-minimal", "core-story-living"])
	})
})
