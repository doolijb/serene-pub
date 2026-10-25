/**
 * The 0110 data upgrade (R50, R55; lane F1): the configuration the pub
 * selected for a pipeline becomes that pipeline's instance values (never the
 * shipped one, never over values already set); a session's selection is not
 * carried; Story's `applyActionChanges` leaves sessions and presets. Scratch
 * tables with the columns the upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { followUpsUpgrade } from "./0110_layering_follow_ups"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE pipeline_specs (id integer PRIMARY KEY, slug text, instance_values json)`)
	await q(`CREATE TABLE pipeline_configs (id integer PRIMARY KEY, spec_id integer, seed_key text)`)
	await q(`CREATE TABLE pipeline_config_values (id serial PRIMARY KEY, config_id integer, node_key text, slot text, path text, value json)`)
	await q(`CREATE TABLE pipeline_config_selections (id serial PRIMARY KEY, scope_kind text, scope_id integer, spec_id integer, config_id integer)`)
	await q(`CREATE TABLE sessions (id integer PRIMARY KEY, genre_fields json)`)
	await q(`CREATE TABLE session_presets (id integer PRIMARY KEY, settings json)`)
	await q(`INSERT INTO pipeline_specs (id, slug, instance_values) VALUES
		(1, 'core:spec/portrait', null),
		(2, 'core:spec/likeness', null),
		(3, 'core:spec/summarize-world', '{"draft":{"params":{"x":1}}}'),
		(4, 'core:spec/summarize-scene', null)`)
	await q(`INSERT INTO pipeline_configs (id, spec_id, seed_key) VALUES
		(10, 1, null),
		(11, 2, 'pipeline-default:core:spec/likeness'),
		(12, 3, null),
		(13, 4, null)`)
	await q(`INSERT INTO pipeline_config_values (config_id, node_key, slot, path, value) VALUES
		(10, 'render', 'params', 'steps', '30'),
		(10, 'render', 'prompts', '', '7'),
		(11, 'render', 'params', 'steps', '20'),
		(12, 'draft', 'params', 'x', '2'),
		(13, 'draft', 'params', 'y', '3')`)
	await q(`INSERT INTO pipeline_config_selections (scope_kind, scope_id, spec_id, config_id) VALUES
		('pub', null, 1, 10),
		('pub', null, 2, 11),
		('pub', null, 3, 12),
		('session', 5, 4, 13)`)
	await q(`INSERT INTO sessions (id, genre_fields) VALUES
		(5, '{"applyActionChanges":false,"sideCast":true}'),
		(6, '{"sideCast":false}')`)
	await q(`INSERT INTO session_presets (id, settings) VALUES (1, '{"applyActionChanges":false}'), (2, null)`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

describe("0110 layering follow-ups", () => {
	it("the pub's configuration becomes the pipeline's instance values; the shipped one and a set value are left", async () => {
		const report = await db.transaction(async (tx: any) => followUpsUpgrade(tx, {} as any))
		expect(report.instanceValues).toBe(1)
		const got = await rows<{ id: number; instance_values: unknown }>(`SELECT id, instance_values FROM pipeline_specs ORDER BY id`)
		expect(got).toEqual([
			{ id: 1, instance_values: { render: { params: { steps: 30 }, prompts: 7 } } },
			// The shipped configuration is the declared defaults: nothing carried.
			{ id: 2, instance_values: null },
			// Already set: kept.
			{ id: 3, instance_values: { draft: { params: { x: 1 } } } },
			// Only a session selected it: not carried (R50 — no other layer).
			{ id: 4, instance_values: null }
		])
		expect(report.notCarried).toEqual([expect.stringContaining("session #5 configuration #13")])
	}, 60_000)

	it("removes Story's applyActionChanges from sessions and presets (R55)", async () => {
		const report = await db.transaction(async (tx: any) => followUpsUpgrade(tx, {} as any))
		expect(report.applyActionChangesRemoved).toBe(2)
		expect(await rows(`SELECT id, genre_fields FROM sessions ORDER BY id`)).toEqual([
			{ id: 5, genre_fields: { sideCast: true } },
			{ id: 6, genre_fields: { sideCast: false } }
		])
		expect(await rows(`SELECT id, settings FROM session_presets ORDER BY id`)).toEqual([
			{ id: 1, settings: {} },
			{ id: 2, settings: null }
		])
	}, 60_000)

	it("is idempotent", async () => {
		await db.transaction(async (tx: any) => followUpsUpgrade(tx, {} as any))
		const again = await db.transaction(async (tx: any) => followUpsUpgrade(tx, {} as any))
		expect(again.instanceValues).toBe(0)
		expect(again.applyActionChangesRemoved).toBe(0)
	}, 60_000)
})
