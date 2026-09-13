/**
 * `0102_summarize_batch_budget.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * All three statements are DELETEs matched on string literals — a type id, four
 * spec slugs behind a join, and a config address behind a two-table join.
 * **A typo matches nothing and fails silently**, in the one direction tests do
 * not normally reach: on a fresh database the rows are not there yet, so a
 * re-projection that matches nothing looks exactly like one that worked. Every
 * integration suite in this repo builds a fresh database, so all of them stay
 * green while every real upgrade keeps its stale rows — and then either refuses
 * the registry (which silently stops pipelines), keeps running a document that
 * never got the clamp, or keeps a stored batch size the declaration no longer
 * agrees with.
 *
 * So this builds the state a real upgrade is in — booted, rows present — and
 * only then applies the file, by reading the same SQL that ships. Modelled on
 * `signalWiringReprojection.int.test.ts` and `promptFormatReprojection.int.test.ts`.
 *
 * ## What is different here
 *
 * It is both shapes at once. 0099 re-projected type declarations only; 0095 and
 * 0100 republished spec documents only. This one has to do both, because the
 * clamp is a slot on the TYPE and a shared reference in the four DOCUMENTS, and
 * either half alone leaves the control unreachable. It also has a third
 * statement — the stored copy of the old author default, which `reconcileConfigs`
 * back-filled and will never revisit on its own.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import {
	createTestDb,
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_BATCH_TOKENS } from "$lib/server/utils/summarizer/batchBudget"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0102_summarize_batch_budget.sql",
	"utf8"
)

const TAG = "0102_summarize_batch_budget"

const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(
		readFileSync("drizzle/meta/_journal.json", "utf8")
	)
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find((e) => e.tag === TAG)
	expect(entry, `${TAG} has no journal entry, so it runs nowhere`).toBeTruthy()
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

const SUMMARIZE_SLUGS = [
	"core:spec/summarize-world",
	"core:spec/summarize-character",
	"core:spec/summarize-scene",
	"core:spec/summarize-history"
]

const BATCH_TYPE = "core:task/batch-messages"

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

const registryRow = (db: TestDb) =>
	db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.typeId, BATCH_TYPE),
				eq(schema.pipelineTypeRegistry.version, 1)
			)
		)

const summarizeVersions = async (db: TestDb) => {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			semver: schema.pipelineSpecVersions.semver
		})
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(inArray(schema.pipelineSpecs.slug, SUMMARIZE_SLUGS))
	return rows.map((r) => `${r.slug}@${r.semver}`).sort()
}

/** The `batches` node's stored config, across every published summarize doc. */
const batchNodes = (db: TestDb) =>
	db
		.select({
			slug: schema.pipelineSpecs.slug,
			config: schema.pipelineNodes.config
		})
		.from(schema.pipelineNodes)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(
				schema.pipelineSpecVersions.id,
				schema.pipelineNodes.specVersionId
			)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(
			and(
				inArray(schema.pipelineSpecs.slug, SUMMARIZE_SLUGS),
				eq(schema.pipelineNodes.nodeKey, "batches")
			)
		)

/** Every stored value for the batch-size control, per config. */
const storedBatchTokens = (db: TestDb) =>
	db
		.select({
			configId: schema.pipelineConfigValues.configId,
			value: schema.pipelineConfigValues.value
		})
		.from(schema.pipelineConfigValues)
		.innerJoin(
			schema.pipelineConfigs,
			eq(schema.pipelineConfigs.id, schema.pipelineConfigValues.configId)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)
		.where(
			and(
				inArray(schema.pipelineSpecs.slug, SUMMARIZE_SLUGS),
				eq(schema.pipelineConfigValues.nodeKey, "batches"),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "batchTokens")
			)
		)

/**
 * Seed one `batches` parameter into every summarize config, the way a database
 * that booted the previous build holds it.
 *
 * ⚠ **Written, where these tests used to `UPDATE` rows that were already
 * there.** A config materialized every declared value until the deviation
 * ruling (2026-09-10); it stores only what departs from the declaration now, so
 * a fresh boot holds nothing at these addresses and an `UPDATE` moved zero
 * rows — which left every fixture below asserting against an empty table.
 */
async function seedBatchParam(db: TestDb, path: string, value: unknown) {
	const configs = await db
		.select({ id: schema.pipelineConfigs.id })
		.from(schema.pipelineConfigs)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)
		.where(inArray(schema.pipelineSpecs.slug, SUMMARIZE_SLUGS))
	expect(
		configs.length,
		"no summarize configuration exists to seed a stored value into"
	).toBeGreaterThan(0)
	for (const config of configs)
		await setConfigValue(
			db,
			config.id,
			{ nodeKey: "batches", slot: "params", path },
			value
		)
}

async function reboot(db: TestDb) {
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
}

describe("0102 is ordered so an upgrade actually runs it", () => {
	it("stamps after everything registered before it", async () => {
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
})

describe("0102 re-projects the batching type", () => {
	it("deletes the row a booted database actually has, and boot puts it back with the sampling slot", async () => {
		const db = await booted()

		// ⚠ The regression, first. Without this the DELETE could match nothing
		// and every assertion after it would still pass.
		expect((await registryRow(db)).length).toBe(1)

		await applyMigration(db)
		expect(await registryRow(db)).toEqual([])

		await reboot(db)
		const [row] = await registryRow(db)
		expect(row).toBeTruthy()

		// Read off the PROJECTED row rather than the descriptor: the row is what
		// the panel renders and what a config back-fills from, so a declaration
		// corrected in the contracts package and never re-projected would still
		// ship the old surface.
		const slots = row!.slots as any
		expect(
			slots?.sampling?.kind,
			"the batching node still has no window to clamp to"
		).toBe("sampling")
		expect(slots?.params?.schema?.batchTokens?.default).toBe(
			DEFAULT_BATCH_TOKENS
		)
	}, 60_000)

	it("leaves the types it does not name alone", async () => {
		// The control: a DELETE with a mis-scoped WHERE would take the registry
		// with it and the assertion above would still read as a success.
		const db = await booted()
		const others = () =>
			db
				.select({ typeId: schema.pipelineTypeRegistry.typeId })
				.from(schema.pipelineTypeRegistry)
				.where(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:task/context-budget"
					)
				)
		expect((await others()).length).toBeGreaterThan(0)

		await applyMigration(db)
		expect((await others()).length).toBeGreaterThan(0)
	}, 60_000)
})

describe("0102 republishes the four summarize documents", () => {
	it("deletes 1.3.0 and boot republishes it carrying the shared sampling reference", async () => {
		const db = await booted()

		expect(await summarizeVersions(db)).toEqual(
			SUMMARIZE_SLUGS.map((s) => `${s}@1.3.0`).sort()
		)

		await applyMigration(db)
		expect(await summarizeVersions(db)).toEqual([])

		await reboot(db)
		expect(await summarizeVersions(db)).toEqual(
			SUMMARIZE_SLUGS.map((s) => `${s}@1.3.0`).sort()
		)

		const nodes = await batchNodes(db)
		expect(nodes.length).toBe(4)
		for (const node of nodes) {
			const wired = (node.config as any)?.sampling
			expect(
				wired,
				`${node.slug} still cuts batches against no window`
			).toMatchObject({
				__ref: "slot",
				slot: "sampling",
				ofNode: "drafting.item.draft"
			})
		}
	}, 60_000)

	it("adds no second Sampling control to the panel", async () => {
		// A slot wired with `ofNode` belongs to the node it points at, so the
		// batching Task must contribute no option of its own — one control for
		// the pair, which is what makes the two windows unable to disagree.
		const db = await booted()
		await applyMigration(db)
		await reboot(db)

		const { declarations } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const [version] = await db
			.select({ id: schema.pipelineSpecVersions.id })
			.from(schema.pipelineSpecVersions)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
			)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/summarize-scene"))

		const decls = await declarations(db, version!.id)
		expect(
			decls.filter(
				(d) => d.nodeKey === "batches" && d.slot === "sampling"
			)
		).toEqual([])

		// And the control that IS this node's renders in plain language, beside
		// siblings reading "Find without keywords" rather than "Top K".
		const size = decls.find(
			(d) =>
				d.nodeKey === "batches" &&
				d.slot === "params" &&
				d.path === "batchTokens"
		)
		expect(size?.label).toBe("How much chat each batch holds")
		expect(size?.authorDefault).toBe(DEFAULT_BATCH_TOKENS)
	}, 60_000)
})

describe("0102 clears the stored copy of the old author default", () => {
	it("back-fills the new default in its place, and leaves a chosen value alone", async () => {
		const db = await booted()

		// ⚠ **A fresh database stores nothing here now** (deviation ruling,
		// 2026-09-10): 2560 is the declared value, so a config that agrees with
		// it holds no row. The regression this file names is unchanged — a
		// stored copy of the OLD number outlives the declaration that wrote it
		// — but the copy has to be put there rather than found.
		expect(
			await storedBatchTokens(db),
			"a fresh boot materialized the declared batch size, which is the " +
				"copy this migration exists to remove"
		).toEqual([])

		// The state this migration exists for: a database that booted the
		// PREVIOUS build, which stored 2048 — written here by hand, the same
		// way 0099's test seeds the session overrides it sweeps.
		await seedBatchParam(db, "batchTokens", 2048)
		const seeded = await storedBatchTokens(db)
		expect(
			seeded.length,
			"the fixture seeded no stored batch size, so everything below is " +
				"vacuous"
		).toBeGreaterThan(0)

		// One config where somebody actually chose a size. It must survive.
		const chosen = seeded[0]!.configId
		await setConfigValue(
			db,
			chosen,
			{ nodeKey: "batches", slot: "params", path: "batchTokens" },
			4000
		)

		await applyMigration(db)
		const after = await storedBatchTokens(db)
		expect(
			after.map((r) => r.value),
			"the stored copies of the old default were not cleared"
		).toEqual([4000])

		await reboot(db)
		const rebuilt = await storedBatchTokens(db)
		expect(
			rebuilt.find((r) => r.configId === chosen)?.value,
			"a deliberately chosen batch size was overwritten"
		).toBe(4000)
		// And every OTHER config comes back holding nothing: the deviation
		// survives, its neighbours inherit. Before the ruling this read
		// `toBe(DEFAULT_BATCH_TOKENS)`, which was the same claim about a copy —
		// and the copy is what made correcting the number need this migration.
		expect(
			rebuilt.filter((r) => r.configId !== chosen),
			"a config that chose nothing came back holding a copy of the " +
				"declared batch size"
		).toEqual([])
		expect(DEFAULT_BATCH_TOKENS).toBe(2560)
	}, 60_000)

	it("leaves other controls' stored values alone", async () => {
		// The control: a DELETE that forgot its `path` would take every parameter
		// this node stores with it.
		//
		// ⚠ The sibling is set to 2048 on purpose. `minBatchMessages` ships as 1,
		// so with its own value it is protected by the `value` predicate whatever
		// the `path` predicate says — and dropping `path` then changes nothing a
		// test can see. Given a value that collides, the two predicates are
		// independent and each one is load-bearing.
		const db = await booted()
		const sibling = () =>
			db
				.select({ value: schema.pipelineConfigValues.value })
				.from(schema.pipelineConfigValues)
				.where(
					and(
						eq(schema.pipelineConfigValues.nodeKey, "batches"),
						eq(schema.pipelineConfigValues.slot, "params"),
						eq(
							schema.pipelineConfigValues.path,
							"minBatchMessages"
						)
					)
				)
		// Seeded rather than updated, for the reason `seedBatchParam` gives.
		await seedBatchParam(db, "minBatchMessages", 2048)
		const before = (await sibling()).length
		expect(
			before,
			"no sibling parameter was seeded, so the `path` predicate is " +
				"being asserted against an empty table"
		).toBeGreaterThan(0)

		await applyMigration(db)
		expect((await sibling()).length).toBe(before)
	}, 60_000)
})
