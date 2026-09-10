/**
 * 0107: a run's one message survives becoming a relation.
 *
 * `pipeline_runs.message_id` is dropped by this migration, and the ids it held
 * are the only record anyone has of which reply came from which run. A `CREATE
 * TABLE` followed by a `DROP COLUMN` with no `INSERT … SELECT` between them
 * would be a silent, unrecoverable data loss on every install that has ever
 * generated a reply — and it would look exactly like a working migration.
 *
 * ⚠ It runs the REAL migration file, statement for statement. A test that
 * hand-wrote the backfill would prove that a SELECT this file invented is
 * correct and nothing about what ships.
 *
 * ## Why the pre-migration shape is reconstructed
 *
 * `createTestDb` applies every migration on creation, so by the time a test can
 * insert anything, `message_id` is already gone and `pipeline_run_artifacts`
 * already exists — replaying 0107 over that would fail on the first statement.
 * So the two objects 0107 acts on are put back the way 0106 left them: the
 * column returns, the table goes, and the same SQL then runs against the same
 * shapes a real upgrade meets.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const MIGRATION = "drizzle/0107_pipeline_run_artifacts.sql"

let db: TestDb
let migrationSql: string

/** The run row's columns, minus the one this migration is about. */
const runValues = (runId: string) => ({
	runId,
	specSlug: "core:spec/respond",
	specVersion: "1.0.0",
	outcome: "ok",
	triggerSource: "event",
	seed: "s",
	startedAt: new Date(0),
	endedAt: new Date(1000),
	elapsedMs: 1000,
	tokensSpent: 12,
	receipt: { runId, outcome: "ok", nodes: [] }
})

beforeAll(async () => {
	db = await createTestDb()
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	migrationSql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")

	// ── Back to the shape 0106 left ────────────────────────────────────────
	await db.execute(sql`DROP TABLE "pipeline_run_artifacts"`)
	await db.execute(
		sql`ALTER TABLE "pipeline_runs" ADD COLUMN "message_id" integer`
	)
	await db.execute(
		sql.raw(
			`ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_message_id_session_messages_id_fk" ` +
				`FOREIGN KEY ("message_id") REFERENCES "public"."session_messages"("id") ` +
				`ON DELETE set null ON UPDATE no action`
		)
	)
	await db.execute(
		sql`CREATE INDEX "pipeline_runs_message_idx" ON "pipeline_runs" USING btree ("message_id")`
	)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "run-artifacts-migration" })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	const [message] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			role: "assistant",
			content: "The Ashguard ride at dawn."
		})
		.returning()

	// A pre-upgrade row that names its message, and one that names none —
	// which is what every debug preview looks like.
	await db.execute(sql`
		INSERT INTO "pipeline_runs"
			("run_id", "spec_slug", "spec_version", "session_id", "user_id", "message_id",
			 "outcome", "trigger_source", "seed", "is_preview", "started_at", "ended_at", "receipt")
		VALUES
			('linked-run', 'core:spec/respond', '1.0.0', ${session.id}, ${user.id}, ${message.id},
			 'ok', 'event', 's', false, now(), now(), '{}'),
			('preview-run', 'core:spec/respond', '1.0.0', ${session.id}, ${user.id}, NULL,
			 'ok', 'ui', 's', true, now(), now(), '{}')
	`)

	// Split the way drizzle's own migrator splits it: the extended protocol
	// refuses more than one command per statement, and 0107 has six.
	for (const statement of migrationSql.split("--> statement-breakpoint")) {
		if (!statement.trim()) continue
		await db.execute(sql.raw(statement))
	}
}, 60_000)

describe("0107 — the message a run produced survives the drop", () => {
	it("backfills every linked run as one message/created artifact", async () => {
		const rows = await db.execute(sql`
			SELECT a."seq", a."kind", a."entity_id", a."action", a."node_key", r."run_id"
			FROM "pipeline_run_artifacts" a
			JOIN "pipeline_runs" r ON r."id" = a."run_id"
			ORDER BY a."id"
		`)

		// ⚠ One row, from the run that had a message — not two, and not zero.
		// A migration that created the table and dropped the column without the
		// INSERT … SELECT between them would leave this empty on every install
		// that has generated a reply, and nothing would ever say so.
		expect(rows.rows).toHaveLength(1)
		expect(rows.rows[0]).toMatchObject({
			run_id: "linked-run",
			seq: 0,
			kind: "message",
			action: "created",
			// Nothing recorded which node wrote it, and the backfill does not
			// invent one — an id nobody can check is worse than the absence.
			node_key: null
		})

		// And it names the message it actually named before.
		const [message] = await db.select().from(schema.sessionMessages)
		expect(rows.rows[0]!.entity_id).toBe(message!.id)
	}, 60_000)

	it("gives a run that produced nothing no artifact at all", async () => {
		// The other half of the rule `is_preview` already stated about these
		// rows: a preview sent nothing, so there is nothing for it to own.
		const rows = await db.execute(sql`
			SELECT count(*)::int AS n
			FROM "pipeline_run_artifacts" a
			JOIN "pipeline_runs" r ON r."id" = a."run_id"
			WHERE r."run_id" = 'preview-run'
		`)
		expect(rows.rows[0]!.n).toBe(0)
	}, 60_000)

	it("removes the column and its index", async () => {
		const columns = await db.execute(sql`
			SELECT "column_name" FROM "information_schema"."columns"
			WHERE "table_name" = 'pipeline_runs' AND "column_name" = 'message_id'
		`)
		expect(columns.rows).toEqual([])

		const indexes = await db.execute(sql`
			SELECT "indexname" FROM "pg_indexes"
			WHERE "tablename" = 'pipeline_runs' AND "indexname" = 'pipeline_runs_message_idx'
		`)
		expect(indexes.rows).toEqual([])
	}, 60_000)

	it("cascades an artifact away with its run, and never with its subject", async () => {
		// The two halves of the FK ruling, asserted rather than described.
		// `run_id` cascades: an artifact of a run that no longer exists is not
		// evidence of anything. `entity_id` carries no FK at all, so deleting
		// the message leaves the record of what the run did standing — the same
		// rule `pipeline_runs.spec_version_id` follows.
		const [message] = await db.select().from(schema.sessionMessages)
		await db.execute(
			sql`DELETE FROM "session_messages" WHERE "id" = ${message!.id}`
		)
		const kept = await db.execute(
			sql`SELECT count(*)::int AS n FROM "pipeline_run_artifacts"`
		)
		expect(
			kept.rows[0]!.n,
			"deleting the message deleted the evidence that a run made it"
		).toBe(1)

		await db.execute(
			sql`DELETE FROM "pipeline_runs" WHERE "run_id" = 'linked-run'`
		)
		const gone = await db.execute(
			sql`SELECT count(*)::int AS n FROM "pipeline_run_artifacts"`
		)
		expect(gone.rows[0]!.n).toBe(0)
	}, 60_000)
})
