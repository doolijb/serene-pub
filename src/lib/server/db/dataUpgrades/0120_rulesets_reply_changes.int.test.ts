/**
 * The 0120 data upgrade (PLAN-rulesets-functions D7, merge M1, 2026-10-23):
 * Story's reply moved `generate`, `save`, `spritePick` and `spriteShow` into
 * its `reply.prose` branch; what is stored by node key for that pipeline —
 * overrides, rebinds, config values and notices, a registration's values —
 * moves with them, a row already at the new address wins, another
 * pipeline's rows stay, and a second run changes nothing. Scratch tables
 * with the columns the upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { REPLY_PROSE_KEYS, STORY_RESPOND, replyProseUpgrade } from "./0120_rulesets_reply_changes"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))

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

const upgrade = () => db.transaction(async (tx: any) => replyProseUpgrade(tx))

describe("0120 Story's reply onto reply.prose", () => {
	it("moves every node-keyed row of the reply; the new address wins; other pipelines stay; a second run changes nothing", async () => {
		await q(`INSERT INTO pipeline_specs (id, slug) VALUES (1, '${STORY_RESPOND}'), (2, 'acme:spec/my-reply')`)
		await q(`INSERT INTO pipeline_configs (id, spec_id) VALUES (10, 1), (20, 2)`)
		await q(`INSERT INTO pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path, value) VALUES
			(1, 'session', 7, 'generate', 'sampling', '', '"warm"'),
			(1, 'session', 7, 'spriteShow', 'params', 'show', 'true'),
			(1, 'session', 8, 'save', 'params', 'x', '1'),
			(1, 'session', 8, 'reply.prose.save', 'params', 'x', '2'),
			(1, 'session', 7, 'context', 'params', '', '3'),
			(2, 'session', 7, 'generate', 'sampling', '', '"mine"')`)
		await q(`INSERT INTO pipeline_node_rebinds (spec_id, scope_kind, scope_id, node_key, definition_id) VALUES
			(1, 'pub', 0, 'generate', 'acme:oracle/x@1'), (2, 'pub', 0, 'generate', 'acme:oracle/y@1')`)
		await q(`INSERT INTO pipeline_config_values (config_id, node_key, slot, path, value) VALUES
			(10, 'generate', 'prompts', '', '"p"'), (10, 'spritePick', 'params', 'k', '1'), (20, 'generate', 'prompts', '', '"q"')`)
		await q(`INSERT INTO pipeline_config_notices (config_id, kind, node_key, slot) VALUES (10, 'stale', 'save', 'params')`)
		await q(`INSERT INTO registrations (spec_slug, "values") VALUES
			('${STORY_RESPOND}', '{"generate":{"sampling":"warm"},"reading":{"lore":true}}'),
			('${STORY_RESPOND}', '{"save":{"a":1},"reply.prose.save":{"a":2}}'),
			('acme:spec/my-reply', '{"generate":{"sampling":"mine"}}')`)

		const report = await upgrade()
		expect(report).toMatchObject({ overrides: 2, rebinds: 1, configValues: 2, notices: 1, registrations: 2 })
		expect(report.dropped).toBe(2)

		const ov = await rows<{ spec_id: number; scope_id: number; node_key: string; value: unknown }>(
			`SELECT spec_id, scope_id, node_key, value FROM pipeline_node_overrides ORDER BY spec_id, scope_id, node_key`
		)
		expect(ov.map((r) => [r.spec_id, r.scope_id, r.node_key])).toEqual([
			[1, 7, "context"],
			[1, 7, REPLY_PROSE_KEYS.generate],
			[1, 7, REPLY_PROSE_KEYS.spriteShow],
			[1, 8, REPLY_PROSE_KEYS.save],
			[2, 7, "generate"]
		])
		// The row already at the new address stands.
		expect(ov.find((r) => r.scope_id === 8)!.value).toBe(2)
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_node_rebinds ORDER BY spec_id`)).map((r) => r.node_key)).toEqual([
			REPLY_PROSE_KEYS.generate,
			"generate"
		])
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_config_values ORDER BY id`)).map((r) => r.node_key)).toEqual([
			REPLY_PROSE_KEYS.generate,
			REPLY_PROSE_KEYS.spritePick,
			"generate"
		])
		expect((await rows<{ node_key: string }>(`SELECT node_key FROM pipeline_config_notices`))[0]!.node_key).toBe(REPLY_PROSE_KEYS.save)
		const regs = await rows<{ values: Record<string, unknown> }>(`SELECT "values" FROM registrations ORDER BY id`)
		expect(regs[0]!.values).toEqual({ [REPLY_PROSE_KEYS.generate]: { sampling: "warm" }, reading: { lore: true } })
		expect(regs[1]!.values).toEqual({ [REPLY_PROSE_KEYS.save]: { a: 2 } })
		expect(regs[2]!.values).toEqual({ generate: { sampling: "mine" } })

		const again = await upgrade()
		expect(again).toEqual({ overrides: 0, rebinds: 0, configValues: 0, notices: 0, registrations: 0, dropped: 0 })
	}, 60_000)

	it("an install without Story's reply published finds nothing to move", async () => {
		await q(`INSERT INTO registrations (spec_slug, "values") VALUES ('acme:spec/my-reply', '{"generate":{}}')`)
		expect(await upgrade()).toEqual({ overrides: 0, rebinds: 0, configValues: 0, notices: 0, registrations: 0, dropped: 0 })
	}, 60_000)
})
