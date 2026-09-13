/**
 * `0099_signal_wiring_reprojection.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * Both halves of this file are DELETEs matched on string literals — six type
 * ids, and three `(type, path)` pairs behind a three-table join. **A typo
 * matches nothing and fails silently**, and it fails silently in the one
 * direction tests do not normally reach: on a fresh database the rows are not
 * there yet, so a re-projection that matches nothing looks exactly like one that
 * worked. Every integration suite in this repo builds a fresh database, so all
 * of them stay green while every real upgrade keeps its stale rows — and then
 * either refuses the registry, which silently stops pipelines, or carries a
 * session override addressed at a control that no longer exists.
 *
 * So this builds the state a real upgrade is in — booted, rows present — and
 * only then applies the file, by reading the same SQL that ships. Modelled on
 * `promptFormatReprojection.int.test.ts`, whose docblock argues the case at
 * length.
 *
 * ## What is different here, and why it needs its own file
 *
 * 0095 deleted spec VERSIONS because documents had been edited in place. Nothing
 * of the kind happened here: only type declarations moved, so the published
 * pipelines are still correct and deleting them would throw away author presets
 * for nothing. What this one has instead is the second statement — a sweep of
 * `pipeline_node_overrides`, which has no reconciler at all. `reconcileConfigs`
 * walks `pipeline_config_values` on every boot and writes a notice for each
 * address it culls; **nothing walks the session layer**, so a culled control
 * leaves a row there that no panel can reach and that would come back to life
 * the day somebody re-declared that name for another purpose.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0099_signal_wiring_reprojection.sql",
	"utf8"
)

/**
 * The journal `when` this migration is registered under, and the greatest one
 * registered before it. Read out of the journal rather than typed twice.
 */
const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"))
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find(
		(e) => e.tag === "0099_signal_wiring_reprojection"
	)
	expect(entry, "0099 has no journal entry, so it runs nowhere").toBeTruthy()
	const preceding = entries.filter((e) => e.idx < entry!.idx)
	return {
		JOURNAL_WHEN: entry!.when,
		PRECEDING_MAX: Math.max(...preceding.map((e) => e.when))
	}
})()

/** Apply it the way the migrator does — statement by statement. */
async function applyMigration(db: TestDb) {
	for (const statement of MIGRATION.split("--> statement-breakpoint"))
		if (statement.trim()) await db.execute(statement)
}

/** Every type whose declaration moved, and therefore whose row must go. */
const REPROJECTED = [
	"core:query/vector-search",
	"core:task/rank-hybrid",
	"core:query/world-lore",
	"core:query/character-lore",
	"core:query/history-entries",
	"core:query/lorebook-triggers"
]

const registryRows = (db: TestDb) =>
	db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				inArray(schema.pipelineTypeRegistry.typeId, REPROJECTED),
				eq(schema.pipelineTypeRegistry.version, 1)
			)
		)

async function booted(): Promise<TestDb> {
	const db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const report = await bootstrapPipelines(db)
	expect(
		report.specs.length,
		"the boot did not get as far as seeding the specs"
	).toBeGreaterThan(0)
	return db
}

const schemaOf = (rows: Array<{ typeId: string; slots: any }>, typeId: string) =>
	(rows.find((r) => r.typeId === typeId)?.slots as any)?.params?.schema ?? {}

describe("0099 re-projects the six declarations it names", () => {
	it("is ordered after everything registered before it, so an upgrade runs it", async () => {
		/**
		 * ⚠ The half a fresh database normally cannot check. `PgDialect.migrate`
		 * reads the last applied migration once and applies only files whose
		 * journal `when` is greater, so a file numbered at or below an applied
		 * index is **silently skipped** on every upgraded install — and on an
		 * empty database the comparison short-circuits and everything applies
		 * regardless.
		 */
		const db = await createTestDb()
		const applied: any = await db.execute(
			`SELECT created_at FROM drizzle.__drizzle_migrations
			 ORDER BY created_at ASC`
		)
		const rows = (applied.rows ?? applied) as Array<{ created_at: number }>
		expect(rows.map((r) => Number(r.created_at))).toContain(JOURNAL_WHEN)
		expect(PRECEDING_MAX).toBeLessThan(JOURNAL_WHEN)
	}, 60_000)

	it("deletes the rows a booted database actually has", async () => {
		const db = await booted()

		// ⚠ The regression, first. Without this the DELETE could match nothing
		// and every assertion after it would still pass.
		expect((await registryRows(db)).map((r) => r.typeId).sort()).toEqual(
			[...REPROJECTED].sort()
		)

		await applyMigration(db)
		expect(await registryRows(db)).toEqual([])
	}, 60_000)

	it("leaves the types it does not name alone", async () => {
		// The control: a DELETE with a mis-scoped WHERE would take the registry
		// with it and the assertion above would still read as a success.
		const db = await booted()
		const others = () =>
			db
				.select({ typeId: schema.pipelineTypeRegistry.typeId })
				.from(schema.pipelineTypeRegistry)
				.where(eq(schema.pipelineTypeRegistry.typeId, "core:task/assemble"))
		expect((await others()).length).toBeGreaterThan(0)

		await applyMigration(db)
		expect((await others()).length).toBeGreaterThan(0)
	}, 60_000)

	it("the next boot puts them back carrying the current declarations", async () => {
		const db = await booted()
		await applyMigration(db)

		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const report = await bootstrapPipelines(db)
		// A conflict here is the failure the whole file exists to prevent: it is
		// caught, reported, and `bootstrapPipelines` returns early, so pipelines
		// silently stop on every upgraded install.
		expect(
			report.specs.length,
			"the boot did not get as far as seeding the specs"
		).toBeGreaterThan(0)

		const rows = await registryRows(db)
		expect(rows.map((r) => r.typeId).sort()).toEqual([...REPROJECTED].sort())

		// And they carry the declarations this change made, read off the
		// projected rows rather than off the descriptor — the row is what the
		// panel renders and what a config back-fills from, so a declaration
		// corrected in the contracts package and never re-projected would still
		// ship the old surface.
		const vector = schemaOf(rows, "core:query/vector-search")
		expect(vector.topK?.default).toBe(40)
		expect(vector.similarityFalloff?.default).toBe(1)
		expect(vector.minScore, "the dead floor is still declared").toBeUndefined()

		for (const lore of [
			"core:query/world-lore",
			"core:query/character-lore",
			"core:query/history-entries",
			"core:query/lorebook-triggers"
		])
			expect(
				schemaOf(rows, lore).guaranteedMessages?.default,
				`${lore} still does not declare the window it reads`
			).toBe(10)

		const rank = schemaOf(rows, "core:task/rank-hybrid")
		expect(rank.signalDensity, "the wired weight went too").toBeTruthy()
		expect(rank.signalRecency).toBeUndefined()
		expect(rank.signalSceneAffinity).toBeUndefined()
	}, 60_000)
})

/**
 * The session layer, which nothing else sweeps.
 *
 * ⚠ These rows are the reason the second statement exists. `reconcileConfigs`
 * handles `pipeline_config_values` on every boot and leaves a notice naming what
 * it culled; `pipeline_node_overrides` has no equivalent, so a culled address
 * stays there — unreachable from any panel, and a live value again the moment
 * that name is re-declared for something else.
 */
describe("0099 sweeps the session overrides nothing else reaches", () => {
	/** The three dead addresses, and three that must survive beside them. */
	const seed = async (db: TestDb, specId: number, sessionId: number) => {
		const rows = [
			// Dead: culled from `core:query/vector-search@1`.
			{ nodeKey: "semantic.arm.search", path: "minScore", value: 0.35 },
			// Dead: culled from `core:task/rank-hybrid@1`.
			{ nodeKey: "rank", path: "signalRecency", value: { messages: 0.5 } },
			{
				nodeKey: "rank",
				path: "signalSceneAffinity",
				value: { messages: 0.5 }
			},
			// Alive: still declared on the same two nodes. A DELETE that keyed
			// on the node rather than on the path would take these.
			{ nodeKey: "semantic.arm.search", path: "maxEntries", value: 5 },
			{ nodeKey: "rank", path: "signalDensity", value: { worldLore: 0.3 } },
			// Alive: the same dead path on a node this pipeline does not have,
			// which is what a plugin's own `minScore` looks like from here. The
			// join finds no node, so nothing is assumed about it.
			{ nodeKey: "someplugin.search", path: "minScore", value: 0.5 }
		]
		await db.insert(schema.pipelineNodeOverrides).values(
			rows.map((r) => ({
				specId,
				scopeKind: "session",
				scopeId: sessionId,
				slot: "params",
				...r
			})) as any
		)
	}

	const addresses = async (db: TestDb) =>
		(
			await db
				.select({
					nodeKey: schema.pipelineNodeOverrides.nodeKey,
					path: schema.pipelineNodeOverrides.path
				})
				.from(schema.pipelineNodeOverrides)
		)
			.map((r) => `${r.nodeKey}.${r.path}`)
			.sort()

	it("takes the culled addresses and leaves every other one", async () => {
		const db = await booted()
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
			.limit(1)
		expect(spec, "the reply pipeline is not published").toBeTruthy()

		const [user] = await db
			.insert(schema.users)
			.values({ username: "override-sweep", isAdmin: false })
			.returning()
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		await seed(db, spec!.id, session.id)
		// ⚠ The regression again: six rows in, or the DELETE below is matching
		// against an empty table and cannot fail.
		expect((await addresses(db)).length).toBe(6)

		await applyMigration(db)

		expect(await addresses(db)).toEqual([
			"rank.signalDensity",
			"semantic.arm.search.maxEntries",
			"someplugin.search.minScore"
		])
	}, 60_000)
})
