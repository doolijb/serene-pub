/**
 * `0098_retire_session_sampling_column`: a session's own sampling pick lives
 * on the one session layer — the session-scope pipeline panel row on the
 * `sampling` slot of every pipeline whose `generate` step writes text — and
 * the migration carries `sessions.sampling_config_id` into that row before it
 * drops the column.
 *
 * The database is put in the state a 0.6 install holds before the migration —
 * pipelines bootstrapped, the column back with its foreign key, a value in it —
 * and the migration's own statements are run against it, read from the file
 * the app ships, then the later data upgrade that moves Story's reply onto
 * its `reply` junction (0120), as the chain runs them. Then the run's two
 * readers are asked what the session samples with: the executor's world and
 * `resolveTaskConfig`.
 *
 * ⚠ The migration is frozen and names `generate`, the address of its day.
 * Story's reply has called its model at `reply.prose.generate` since
 * 2026-10-23 (D7), so the bootstrapped catalogue gives 0098 no Story step to
 * see: the carried session is a **Guide** session, whose reply is still
 * `generate`; the held session is a Story one, whose pick 0120 carries.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { resolveConfigSources, SLOT_VALUE } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	STORY_NARRATE_SPEC_ID,
	STORY_RESPOND_SPEC_ID
} from "$lib/server/pipelines/specs"
import { GUIDE_GENRE_ID, GUIDE_RESPOND_SPEC_ID } from "@serene-pub/core-catalog"

const MIGRATION = "0098_retire_session_sampling_column"

let db: TestDb
let dataDir: string
let userId: number
/** The session whose column names a config, and nothing else. */
let carriedId: number
/** The session that already holds a panel pick on the reply. */
let heldId: number
/** The session whose column is empty. */
let emptyId: number
let columnPickId: number
let panelPickId: number
let pubDefaultId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-sampling-migration-secret" }
})

const client = () => (db as any).$client

const specIdOf = async (slug: string) =>
	(
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
	)[0]!.id

const picksOf = async (sessionId: number) =>
	db
		.select({
			slug: schema.pipelineSpecs.slug,
			nodeKey: schema.pipelineNodeOverrides.nodeKey,
			path: schema.pipelineNodeOverrides.path,
			value: schema.pipelineNodeOverrides.value,
			updatedBy: schema.pipelineNodeOverrides.updatedBy
		})
		.from(schema.pipelineNodeOverrides)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineNodeOverrides.specId)
		)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId),
				eq(schema.pipelineNodeOverrides.slot, "sampling")
			)
		)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-sampling-migration-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const make = async (name: string) =>
		(
			await db
				.insert(schema.samplingConfigs)
				.values({ name, values: {} })
				.returning()
		)[0]!.id
	// Three different configs, so each assertion can only pass by the layer it
	// names.
	pubDefaultId = await make("The instance default")
	columnPickId = await make("The session column's pick")
	panelPickId = await make("The panel's pick")

	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "The instance's endpoint",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [model] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: connection!.id, model: "m", name: "m" })
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection!.id,
		connectionModelId: model!.id,
		samplingConfigId: pubDefaultId
	})

	const [user] = await db
		.insert(schema.users)
		.values({ username: "session-sampling-migration-user", isAdmin: false })
		.returning()
	userId = user!.id
	const session = async (genreId?: string) =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, ...(genreId ? { genreId } : {}) } as any)
				.returning()
		)[0]!.id
	carriedId = await session(GUIDE_GENRE_ID)
	heldId = await session()
	emptyId = await session()

	// The install before the migration: the column, its foreign key, its values.
	await client().exec(`
		ALTER TABLE "sessions" ADD COLUMN "sampling_config_id" integer;
		ALTER TABLE "sessions" ADD CONSTRAINT "sessions_sampling_config_id_sampling_configs_id_fk"
			FOREIGN KEY ("sampling_config_id") REFERENCES "public"."sampling_configs"("id") ON DELETE set null;
		UPDATE "sessions" SET "sampling_config_id" = ${columnPickId} WHERE "id" IN (${carriedId}, ${heldId});
	`)
	// A pick the panel already holds at the reply's address.
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: await specIdOf(STORY_RESPOND_SPEC_ID),
		scopeKind: "session",
		scopeId: heldId,
		nodeKey: "generate",
		slot: "sampling",
		path: SLOT_VALUE,
		value: panelPickId
	})

	const file = await fs.readFile(
		path.resolve(process.cwd(), "drizzle", `${MIGRATION}.sql`),
		"utf8"
	)
	for (const statement of file.split("--> statement-breakpoint"))
		if (statement.trim()) await client().exec(statement)
	// … and the chain on to today: Story's reply rows move to its prose branch (0120).
	const { replyProseUpgrade } = await import("$lib/server/db/dataUpgrades/0120_rulesets_reply_changes")
	await db.transaction(async (tx) => {
		await replyProseUpgrade(tx as never)
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe(`${MIGRATION}: the session column becomes the session's panel row`, () => {
	it("a session's value lands on every text generate step's sampling slot, as the panel stores it", async () => {
		const picks = await picksOf(carriedId)
		const slugs = picks.map((p) => p.slug)
		expect(slugs).toEqual(
			expect.arrayContaining([GUIDE_RESPOND_SPEC_ID, STORY_NARRATE_SPEC_ID])
		)
		for (const p of picks) {
			expect(p.nodeKey).toBe("generate")
			expect(p.path).toBe("")
			// A JSON number, the panel's own representation of a sampling-ref.
			expect(p.value).toBe(columnPickId)
			expect(p.updatedBy).toBe(userId)
		}

		// Only on pipelines that have a `generate` step at all.
		const withGenerate = new Set(
			(
				await db
					.select({ slug: schema.pipelineSpecs.slug })
					.from(schema.pipelineSpecs)
					.innerJoin(
						schema.pipelineNodes,
						and(
							eq(
								schema.pipelineNodes.specVersionId,
								schema.pipelineSpecs.activeVersionId
							),
							eq(schema.pipelineNodes.nodeKey, "generate")
						)
					)
			).map((r) => r.slug)
		)
		for (const slug of slugs) expect(withGenerate.has(slug)).toBe(true)
	}, 60_000)

	it("a pick the panel already holds stays; the session's other pipelines still get the value", async () => {
		const picks = await picksOf(heldId)
		const reply = picks.filter((p) => p.slug === STORY_RESPOND_SPEC_ID)
		expect(reply.map((p) => p.value)).toEqual([panelPickId])
		// … at the reply's address today, where 0120 carried it.
		const { oracleNodeKeyOf } = await import("$lib/server/pipelines/config/world")
		expect(reply.map((p) => p.nodeKey)).toEqual([await oracleNodeKeyOf(db as any, { slug: STORY_RESPOND_SPEC_ID })])
		const narrate = picks.find((p) => p.slug === STORY_NARRATE_SPEC_ID)
		expect(narrate?.value).toBe(columnPickId)
	}, 60_000)

	it("an empty column writes nothing, and the column is gone", async () => {
		expect(await picksOf(emptyId)).toEqual([])
		const { rows } = await client().query(
			`SELECT count(*)::int AS n FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'sessions'
			 AND column_name = 'sampling_config_id'`
		)
		expect(rows[0].n).toBe(0)
	}, 60_000)

	it("the executor samples with the carried pick, at session scope", async () => {
		const { buildWorld, oracleNodeKeyOf } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(db, {
			sessionId: carriedId,
			specId: GUIDE_RESPOND_SPEC_ID
		})
		const key = (await oracleNodeKeyOf(db as any, { slug: GUIDE_RESPOND_SPEC_ID }))!
		const sourced: any = resolveConfigSources(world as any, [key])
		const at = sourced?.[key]?.sampling?.[SLOT_VALUE]
		expect(Number(at?.value)).toBe(columnPickId)
		expect(at?.scopeKind).toBe("session")
	}, 60_000)

	it("resolveTaskConfig reads the same row as its session tier, over the instance default", async () => {
		const { resolveTaskConfig } = await import(
			"$lib/server/utils/resolveTaskConfig"
		)
		const carried = await resolveTaskConfig({
			taskType: "session",
			sessionId: carriedId
		})
		expect(carried.problem).toBeUndefined()
		expect(carried.sampling?.id).toBe(columnPickId)

		const held = await resolveTaskConfig({
			taskType: "session",
			sessionId: heldId
		})
		expect(held.sampling?.id).toBe(panelPickId)

		const empty = await resolveTaskConfig({
			taskType: "session",
			sessionId: emptyId
		})
		expect(empty.sampling?.id).toBe(pubDefaultId)
	}, 60_000)
})
