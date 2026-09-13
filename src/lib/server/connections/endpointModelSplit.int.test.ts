/**
 * 0114: every connection that named a model comes out of the split naming the
 * SAME model, through a row.
 *
 * The endpoint/model split is only safe if it is invisible. A person who had
 * three llama.cpp connections pointed at three ggufs must still have three
 * connections pointed at three ggufs after the upgrade — same identifier on the
 * wire, same completion template, same token counter, same capability set — and
 * the only way to know that is to run the real migration over real pre-upgrade
 * rows and compare the MERGED pair against the row it replaced.
 *
 * ⚠ It replays the migration's backfill against rows inserted afterwards, the
 * way `wireModeMigration.int.test.ts` does, and for the same reason: a test that
 * hand-inserted a `connection_models` row would prove the resolver reads one and
 * nothing at all about whether anybody's row ever gets one.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { asc, eq, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

const MIGRATION = "drizzle/0114_endpoint_model_split.sql"

/**
 * The sentinel the migration marks its data half with.
 *
 * The DDL above it has already run — `createTestDb` applies every migration on
 * creation — so replaying the whole file would fail on `CREATE TABLE`. Splitting
 * on a marker the migration itself carries is what lets this test run the real
 * backfill rather than a paraphrase of it kept in a test file.
 */
const BACKFILL_SENTINEL = "-- ===== 0114 BACKFILL ====="

let backfillSql: string

beforeAll(async () => {
	db = await createTestDb()
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	const whole = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
	const at = whole.indexOf(BACKFILL_SENTINEL)
	backfillSql = at === -1 ? "" : whole.slice(at)
}, 60_000)

/** Insert a pre-upgrade connection row, then run 0114's backfill over it. */
async function migrated(values: Partial<InsertConnection>) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${values.model ?? "none"} ${Math.random()}`,
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost",
			...values
		} as InsertConnection)
		.returning()
	if (backfillSql.trim()) await db.execute(sql.raw(backfillSql))
	const models = await db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, row.id))
		.orderBy(asc(schema.connectionModels.id))
	return { row, models }
}

describe("the backfill", () => {
	it("gives a connection that named a model exactly one default model row", async () => {
		const { row, models } = await migrated({ model: "llama3.1:8b" })
		expect(models).toHaveLength(1)
		expect(models[0].model).toBe("llama3.1:8b")
		// The display name defaults to the identifier, so a row nobody renamed
		// reads on screen the way it always did.
		expect(models[0].name).toBe("llama3.1:8b")
		expect(models[0].isDefault).toBe(true)
		expect(models[0].enabled).toBe(true)
		expect(models[0].connectionId).toBe(row.id)
	}, 60_000)

	it("copies NOTHING but the identifier, so the merge is byte-identical", async () => {
		// The whole safety argument in one assertion: every per-model setting
		// starts empty, so `endpoint ?? model` resolves to the endpoint's value
		// for every row the upgrade created. A backfill that copied
		// `prompt_format` down would look harmless and would pin the template at
		// upgrade time — changing the endpoint's would then stop reaching the
		// model, silently, forever.
		const { models } = await migrated({
			model: "gpt-4o",
			type: CONNECTION_TYPE.OPENAI,
			promptFormat: "vicuna",
			tokenCounter: "openai",
			capabilities: { resolved: { "text->text": 1 } }
		})
		expect(models).toHaveLength(1)
		expect(models[0].promptFormat).toBeNull()
		expect(models[0].tokenCounter).toBeNull()
		expect(models[0].contextWindow).toBeNull()
		expect(models[0].capabilities).toEqual({})
		expect(models[0].extraJson).toEqual({})
	}, 60_000)

	it("leaves a connection that never named a model with no model row", async () => {
		// NULL is not "the empty model": it is a row nobody finished setting up,
		// and inventing a model row for it would make an unusable endpoint look
		// configured in every picker.
		const { models } = await migrated({ model: null })
		expect(models).toEqual([])
	}, 60_000)

	it("does not create a row for an EMPTY model string either", async () => {
		// `''` reaches the column from a form field somebody cleared. The check
		// constraint on `connection_models` refuses it outright, so a backfill
		// that did not filter would abort the whole migration for everyone.
		const { models } = await migrated({ model: "" })
		expect(models).toEqual([])
	}, 60_000)

	it("is idempotent — replaying it adds nothing", async () => {
		// A migration is meant to run once, but this one is also the shape
		// `importFromProbe` re-uses, and a restored backup replayed over a
		// partly-upgraded database is a real support path. Re-running must not
		// produce a second default row, which the partial unique index would
		// refuse anyway — better to say so here than to find out at 3am.
		const { row } = await migrated({ model: "mistral:7b" })
		await db.execute(sql.raw(backfillSql))
		const models = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, row.id))
		expect(models).toHaveLength(1)
	}, 60_000)

	it("leaves connection_defaults registrations pointing at no model", async () => {
		// NULL means "the endpoint's default model", which is exactly what a
		// pre-split registration meant — the endpoint named one model and that
		// was the one. Backfilling the id would be the same fact stored twice,
		// and the second copy would go stale the first time somebody starred a
		// different model.
		const { row } = await migrated({ model: "llama3.1:70b" })
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "text",
			connectionId: row.id
		})
		if (backfillSql.trim()) await db.execute(sql.raw(backfillSql))
		const [reg] = await db
			.select()
			.from(schema.connectionDefaults)
			.where(eq(schema.connectionDefaults.connectionId, row.id))
		expect(reg.connectionModelId).toBeNull()
	}, 60_000)
})
