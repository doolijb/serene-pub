/**
 * The 0.5.3 → 0.6 upgrade over rows too large to cross PGlite's wire in one
 * statement, and over several managed KoboldCPP connections.
 *
 * PGlite 0.2 traps (`RuntimeError: memory access out of bounds`) once one
 * query's result or bound parameters pass about 16 MB, and stays broken
 * (`context.ts`, `STATEMENT_BYTES`). A real 0.5.3 install reaches that with a
 * few hundred messages, because each keeps its generation's `debug_meta`;
 * the fixtures' messages are small, so a page of a thousand never did. Here
 * the tiny fixture's attic is grown to ~30 MB of messages before the restore
 * reads it: one read, or one insert, of them all would trap.
 *
 * 0.5.3 could also hold several `koboldcpp_managed` rows; the restore
 * combines them into one endpoint (`etl/connectionGroups.ts`), and the
 * reconciliation must count the combined rows rather than call them missing.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import { bootFixture, fixtureManifest, placeFixture, runUpgradeTasks } from "./testFixture"
import { ATTIC_SCHEMA, atticExists } from "./index"

const manifest = fixtureManifest("tiny")
const A = `"${ATTIC_SCHEMA}"`
/** Added messages, each carrying `DEBUG_BYTES` of `debug_meta`. */
const ADDED = 60
const DEBUG_BYTES = 500_000
/** Added managed KoboldCPP rows, each with its own model. */
const MANAGED = 3

let db: Db
let run: Awaited<ReturnType<typeof runUpgradeTasks>>

const rows = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
	rawRows<T>(await db.execute(q))
const count = async (from: string) =>
	Number((await rows<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${from}`)))[0].n)

beforeAll(async () => {
	placeFixture("tiny")
	db = await bootFixture()
	expect(await atticExists(db)).toBe(true)

	// Built server-side, so the setup itself never sends or reads the bulk.
	await db.execute(
		sql.raw(`INSERT INTO ${A}.chat_messages
			(id, chat_id, user_id, character_id, persona_id, role, content, created_at, updated_at,
			 is_edited, metadata, is_generating, is_hidden, debug_meta, is_narrator_response)
			SELECT (SELECT max(id) FROM ${A}.chat_messages) + g, m.chat_id, m.user_id, m.character_id,
				m.persona_id, m.role, m.content || ' ' || g, m.created_at, m.updated_at, m.is_edited,
				m.metadata, false, m.is_hidden,
				json_build_object('prompt', repeat(md5(g::text), ${DEBUG_BYTES / 32})),
				m.is_narrator_response
			FROM (SELECT * FROM ${A}.chat_messages ORDER BY id LIMIT 1) m,
				generate_series(1, ${ADDED}) g`)
	)
	await db.execute(
		sql.raw(`INSERT INTO ${A}.connections (id, name, type, base_url, model, extra_json, token_counter, prompt_format)
			SELECT (SELECT coalesce(max(id), 0) FROM ${A}.connections) + g, 'Managed ' || g,
				'koboldcpp_managed', 'http://127.0.0.1:5001', 'model-' || g || '.gguf', '{}', 'estimate', NULL
			FROM generate_series(1, ${MANAGED}) g`)
	)
	for (const table of ["chat_messages", "connections"])
		await db.execute(
			sql.raw(`UPDATE ${A}."__manifest" SET row_count = (SELECT count(*) FROM ${A}."${table}")
				WHERE table_name = '${table}'`)
		)
	const [{ mb }] = await rows<{ mb: number }>(
		sql.raw(`SELECT (sum(octet_length(t::text)) / 1048576)::int AS mb FROM ${A}.chat_messages t`)
	)
	expect(mb).toBeGreaterThan(20)

	run = await runUpgradeTasks(db)
}, 300_000)

describe("a 0.5.3 database past one statement's size", () => {
	test("the restore reconciles every table", () => {
		expect(run.restore?.alreadyRestored).toBe(false)
		expect(
			run.restore!.reconciliation.filter((l) => l.expected !== l.actual)
		).toEqual([])
	})

	test("every message arrives whole", async () => {
		expect(await count("session_messages")).toBe(manifest.counts.chat_messages + ADDED)
		const [{ n }] = await rows<{ n: number }>(
			sql.raw(`SELECT count(*)::int AS n FROM session_messages
				WHERE octet_length(debug_meta::text) > ${DEBUG_BYTES}`)
		)
		expect(n).toBe(ADDED)
	})

	test("the managed KoboldCPP rows are one endpoint that lists every model, and say so", async () => {
		const managed = await rows<{ id: number }>(
			sql`SELECT id FROM connections WHERE type = 'koboldcpp_managed'`
		)
		expect(managed).toHaveLength(1)
		const models = await rows<{ model: string }>(
			sql`SELECT model FROM connection_models WHERE connection_id = ${managed[0].id}`
		)
		for (let g = 1; g <= MANAGED; g++)
			expect(models.map((m) => m.model)).toContain(`model-${g}.gguf`)
		const notes = await rows<{ summary: string }>(
			sql`SELECT summary FROM admin_logbook WHERE object_type = 'data-upgrade' AND object_id = 'connection-merged'`
		)
		expect(notes).toHaveLength(1)
		expect(notes[0].summary).toMatch(
			new RegExp(`^${MANAGED} connections to the KoboldCPP this pub runs were combined into one connection, "KoboldCPP", with ${MANAGED} models`)
		)
	})
})
