/**
 * The 0123 data upgrade (RF fix 3, 2026-10-23): Story's reply keeps only its
 * model calls inside the `reply` junction, and ONE tail after it — so what
 * 0120 sent to `reply.prose.save|spritePick|spriteShow`, and the commit's
 * `reply.changes.commit.applied.apply`, moves back to the top-level keys. A
 * row already at the new address wins; the `changes` branch's own copies are
 * never folded in (two settings are never made one); another pipeline's rows
 * stay; a second run changes nothing. Scratch tables with the columns the
 * upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { REPLY_PROSE_KEYS, STORY_RESPOND, replyProseUpgrade } from "./0120_rulesets_reply_changes"
import { REPLY_TAIL_KEYS, replyTailUpgrade } from "./0123_story_reply_tail"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))

/** The tail's keys as 0123 found them, and where it puts them — read off the frozen table. */
const NEW = Object.fromEntries(Object.entries(REPLY_TAIL_KEYS).map(([from, to]) => [to, from])) as Record<string, string>
const SAVE = "save"
const PICK = "spritePick"
const SHOW = "spriteShow"
const APPLY = "commit.applied.apply"

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE pipeline_specs (id serial PRIMARY KEY, slug text NOT NULL UNIQUE)`)
	await q(`CREATE TABLE pipeline_configs (id serial PRIMARY KEY, spec_id integer NOT NULL)`)
	await q(`CREATE TABLE pipeline_node_overrides (id serial PRIMARY KEY, spec_id integer NOT NULL, scope_kind text NOT NULL, scope_id integer NOT NULL DEFAULT 0,
		node_key text NOT NULL, slot text NOT NULL, path text NOT NULL DEFAULT '', value json)`)
	await q(`CREATE UNIQUE INDEX pipeline_node_overrides_addr_idx ON pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path)`)
	await q(`CREATE TABLE pipeline_node_rebinds (id serial PRIMARY KEY, spec_id integer NOT NULL, scope_kind text NOT NULL, scope_id integer NOT NULL DEFAULT 0,
		node_key text NOT NULL, definition_id text NOT NULL)`)
	await q(`CREATE UNIQUE INDEX pipeline_node_rebinds_addr_idx ON pipeline_node_rebinds (spec_id, scope_kind, scope_id, node_key)`)
	await q(`CREATE TABLE pipeline_config_values (id serial PRIMARY KEY, config_id integer NOT NULL, node_key text NOT NULL, slot text NOT NULL, path text NOT NULL DEFAULT '', value json)`)
	await q(`CREATE UNIQUE INDEX pipeline_config_values_addr_idx ON pipeline_config_values (config_id, node_key, slot, path)`)
	await q(`CREATE TABLE pipeline_config_notices (id serial PRIMARY KEY, config_id integer NOT NULL, kind text NOT NULL, node_key text NOT NULL, slot text NOT NULL, path text NOT NULL DEFAULT '')`)
	await q(`CREATE TABLE registrations (id serial PRIMARY KEY, spec_slug text, "values" jsonb)`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const upgrade = () => db.transaction(async (tx: any) => replyTailUpgrade(tx))

describe("0123 Story's reply tail, once, after the junction", () => {
	it("is 0120's table reversed less the call, and the commit — four old keys onto four new, never two onto one", () => {
		expect(Object.keys(REPLY_TAIL_KEYS)).not.toContain(REPLY_PROSE_KEYS.generate)
		for (const before of [SAVE, PICK, SHOW]) expect(REPLY_TAIL_KEYS[REPLY_PROSE_KEYS[before]!]).toBe(before)
		expect(NEW[APPLY]).toMatch(/^reply\.changes\.commit\./)
		const targets = Object.values(REPLY_TAIL_KEYS)
		expect(new Set(targets).size).toBe(targets.length)
		expect(Object.isFrozen(REPLY_TAIL_KEYS)).toBe(true)
	})

	it("moves the tail's rows to the top-level keys; the new address wins; the changes branch's copies and other pipelines stay; a second run changes nothing", async () => {
		await q(`INSERT INTO pipeline_specs (id, slug) VALUES (1, '${STORY_RESPOND}'), (2, 'acme:spec/my-reply')`)
		await q(`INSERT INTO pipeline_configs (id, spec_id) VALUES (10, 1), (20, 2)`)
		await q(`INSERT INTO pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path, value) VALUES
			(1, 'session', 7, '${REPLY_PROSE_KEYS.generate}', 'sampling', '', '"warm"'),
			(1, 'session', 7, '${NEW[PICK]}', 'params', 'enabled', 'false'),
			(1, 'session', 7, 'reply.changes.spritePick', 'params', 'enabled', 'true'),
			(1, 'session', 8, '${NEW[SAVE]}', 'params', 'x', '1'),
			(1, 'session', 8, '${SAVE}', 'params', 'x', '2'),
			(1, 'session', 9, '${NEW[APPLY]}', 'params', 'emits', 'false'),
			(2, 'session', 7, '${NEW[PICK]}', 'params', 'enabled', 'false')`)
		await q(`INSERT INTO pipeline_node_rebinds (spec_id, scope_kind, scope_id, node_key, definition_id) VALUES
			(1, 'pub', 0, '${NEW[PICK]}', 'acme:oracle/x@1'), (2, 'pub', 0, '${NEW[PICK]}', 'acme:oracle/y@1')`)
		await q(`INSERT INTO pipeline_config_values (config_id, node_key, slot, path, value) VALUES
			(10, '${NEW[SHOW]}', 'params', 'k', '1'), (10, 'reply.changes.spriteShow', 'params', 'k', '2'), (20, '${NEW[SHOW]}', 'params', 'k', '3')`)
		await q(`INSERT INTO pipeline_config_notices (config_id, kind, node_key, slot) VALUES (10, 'stale', '${NEW[SAVE]}', 'params')`)
		await q(`INSERT INTO registrations (spec_slug, "values") VALUES
			('${STORY_RESPOND}', '{"${NEW[PICK]}":{"floor":0.3},"reading":{"changes":true}}'),
			('${STORY_RESPOND}', '{"${NEW[SAVE]}":{"a":1},"${SAVE}":{"a":2}}'),
			('acme:spec/my-reply', '{"${NEW[PICK]}":{"floor":0.9}}')`)

		const report = await upgrade()
		expect(report).toMatchObject({ overrides: 2, rebinds: 1, configValues: 1, notices: 1, registrations: 2 })
		expect(report.dropped).toBe(2)

		const ov = await rows<{ spec_id: number; scope_id: number; node_key: string; value: unknown }>(
			`SELECT spec_id, scope_id, node_key, value FROM pipeline_node_overrides ORDER BY spec_id, scope_id, node_key`
		)
		expect(ov.map((r) => [r.spec_id, r.scope_id, r.node_key])).toEqual([
			// The prose call stays in its branch; the changes branch's own copy is left, never folded in.
			[1, 7, "reply.changes.spritePick"],
			[1, 7, REPLY_PROSE_KEYS.generate],
			[1, 7, PICK],
			[1, 8, SAVE],
			[1, 9, APPLY],
			[2, 7, NEW[PICK]]
		])
		expect(ov.find((r) => r.scope_id === 7 && r.node_key === PICK)!.value).toBe(false)
		// The row already at the new address stands.
		expect(ov.find((r) => r.scope_id === 8)!.value).toBe(2)
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_node_rebinds ORDER BY spec_id`)).map((r) => r.node_key)).toEqual([PICK, NEW[PICK]])
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_config_values ORDER BY id`)).map((r) => r.node_key)).toEqual([
			SHOW,
			"reply.changes.spriteShow",
			NEW[SHOW]
		])
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_config_notices`))[0]!.node_key).toBe(SAVE)
		const regs = await rows<{ values: Record<string, unknown> }>(`SELECT "values" FROM registrations ORDER BY id`)
		expect(regs[0]!.values).toEqual({ [PICK]: { floor: 0.3 }, reading: { changes: true } })
		expect(regs[1]!.values).toEqual({ [SAVE]: { a: 2 } })
		expect(regs[2]!.values).toEqual({ [NEW[PICK]]: { floor: 0.9 } })

		const again = await upgrade()
		expect(again).toEqual({ overrides: 0, rebinds: 0, configValues: 0, notices: 0, registrations: 0, dropped: 0 })
	}, 60_000)

	it("a setting made before D7 rides 0120 and 0123 back to where it was; the call stays in its branch", async () => {
		await q(`INSERT INTO pipeline_specs (id, slug) VALUES (1, '${STORY_RESPOND}')`)
		await q(`INSERT INTO pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path, value) VALUES
			(1, 'session', 7, 'generate', 'sampling', '', '"warm"'),
			(1, 'session', 7, '${PICK}', 'params', 'enabled', 'false'),
			(1, 'session', 7, '${SHOW}', 'params', 'show', 'true')`)
		await db.transaction(async (tx: any) => replyProseUpgrade(tx))
		await upgrade()
		const ov = await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_node_overrides ORDER BY node_key`)
		expect(ov.map((r) => r.node_key)).toEqual([REPLY_PROSE_KEYS.generate, PICK, SHOW])
	}, 60_000)

	it("an install without Story's reply published finds nothing to move", async () => {
		await q(`INSERT INTO registrations (spec_slug, "values") VALUES ('acme:spec/my-reply', '{"${NEW[SAVE]}":{}}')`)
		expect(await upgrade()).toEqual({ overrides: 0, rebinds: 0, configValues: 0, notices: 0, registrations: 0, dropped: 0 })
	}, 60_000)
})
