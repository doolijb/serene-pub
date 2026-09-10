/**
 * `0110_session_history_limit.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * All three statements are DELETEs matched on string literals — a type id with
 * a version, three spec slugs with semvers behind a join, and a config address
 * behind a two-table join. **A typo matches nothing and fails silently**, in
 * the one direction tests do not normally reach: on a fresh database the rows
 * are not there yet, so a re-projection that matches nothing looks exactly like
 * one that worked. Every integration suite in this repo builds a fresh
 * database, so all of them stay green while every real upgrade keeps its stale
 * rows — and then either refuses the registry (which silently stops pipelines),
 * keeps running three documents whose `history` node never names its `params`
 * slot, or keeps a stored `40` the declaration no longer agrees with.
 *
 * So this builds the state a real upgrade is in — booted, rows present — and
 * only then applies the file, by reading the same SQL that ships. Modelled on
 * `summarizeBatchBudgetReprojection.int.test.ts` and
 * `continuationPrefillReprojection.int.test.ts`.
 *
 * ## What is different here
 *
 * The document half is asserted on a node's **stored config naming a slot**,
 * which is the thinnest of the three shapes these files have had to check. A
 * slot the config does not name is never resolved by the executor, so the
 * absence of one key in one JSON object is the whole of the defect — the panel
 * still rendered the control, `reconcileConfigs` still stored a value for it,
 * and the run still ignored it.
 *
 * What that stored value being *read* looks like is a different question and a
 * different file: `runtime/sessionHistoryLimit.int.test.ts` starts at a config
 * row and ends at the number of messages the query returns.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync("drizzle/0110_session_history_limit.sql", "utf8")

const TAG = "0110_session_history_limit"

const HISTORY_TYPE = "core:query/session-history"

/** Slug → the semver this migration names, and the spec's history node key. */
const PINS = [
	{
		slug: "core:spec/respond",
		semver: "1.20.0",
		nodeKey: "gather.history.read"
	},
	{ slug: "core:spec/narrate", semver: "1.11.0", nodeKey: "history" },
	{
		slug: "core:spec/narrate-character",
		semver: "1.0.0",
		nodeKey: "history"
	}
] as const

const SLUGS = PINS.map((p) => p.slug)

/**
 * The declared default, and the number every run has actually used.
 *
 * They are the same number on purpose — that identity IS the ruling. `limit`
 * was declared 40 and read at a hardcoded 100, so correcting the declaration to
 * 100 is what lets the control be wired without moving anybody's window.
 */
const DECLARED_LIMIT = 100
/** What the declaration said before, and what every booted database stored. */
const PREVIOUS_DECLARED_LIMIT = 40

const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"))
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

async function booted(): Promise<TestDb> {
	const db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const report = await bootstrapPipelines(db)
	expect(report.conflict, report.conflict ?? "").toBeUndefined()
	return db
}

async function reboot(db: TestDb) {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const report = await bootstrapPipelines(db)
	// A conflict here is the failure the whole file exists to prevent: it is
	// caught, reported, and `bootstrapPipelines` returns early, so pipelines
	// silently stop on every upgraded install.
	expect(report.conflict, report.conflict ?? "").toBeUndefined()
}

const registryRow = (db: TestDb, typeId: string) =>
	db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.typeId, typeId),
				eq(schema.pipelineTypeRegistry.version, 1)
			)
		)

const publishedPins = async (db: TestDb) => {
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
		.where(inArray(schema.pipelineSpecs.slug, SLUGS))
	return rows.map((r) => `${r.slug}@${r.semver}`).sort()
}

/**
 * The `history` node's stored config, across the three published documents.
 *
 * Read off the published ROWS rather than off the compiled document: the rows
 * are what `loadPublished` hands the executor, so a document corrected in the
 * catalog and never republished would still run without the slot.
 */
const historyNodes = async (db: TestDb) => {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			semver: schema.pipelineSpecVersions.semver,
			nodeKey: schema.pipelineNodes.nodeKey,
			config: schema.pipelineNodes.config
		})
		.from(schema.pipelineNodes)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineNodes.specVersionId)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(
			and(
				inArray(schema.pipelineSpecs.slug, SLUGS),
				eq(schema.pipelineNodes.typeId, HISTORY_TYPE)
			)
		)
	return rows
		.map((r) => ({
			pin: `${r.slug}@${r.semver}`,
			nodeKey: r.nodeKey,
			params: (r.config as any)?.params ?? null
		}))
		.sort((a, b) => a.pin.localeCompare(b.pin))
}

/** Every stored value for the transcript-window control, per config. */
const storedLimits = async (db: TestDb) => {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			configId: schema.pipelineConfigValues.configId,
			nodeKey: schema.pipelineConfigValues.nodeKey,
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
				inArray(schema.pipelineSpecs.slug, SLUGS),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "limit")
			)
		)
	return rows.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Put every stored window back where an upgrading database has it: 40. */
const asPreviousBuild = (db: TestDb) =>
	db
		.update(schema.pipelineConfigValues)
		.set({ value: PREVIOUS_DECLARED_LIMIT })
		.where(
			and(
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "limit")
			)
		)

describe("0110 is ordered so an upgrade actually runs it", () => {
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

describe("0110 re-projects the session-history declaration", () => {
	it("deletes the row a booted database has, and boot puts it back carrying the corrected default", async () => {
		const db = await booted()

		// ⚠ The regression, first. Without this the DELETE could match nothing
		// and every assertion after it would still pass.
		expect((await registryRow(db, HISTORY_TYPE)).length).toBe(1)

		await applyMigration(db)
		expect(await registryRow(db, HISTORY_TYPE)).toEqual([])

		await reboot(db)

		// Read off the PROJECTED row rather than the descriptor: the row is what
		// the panel renders and what `declarations()` derives an author default
		// from, so a declaration corrected in the contracts package and never
		// re-projected would still ship 40 to every upgraded install.
		const [row] = await registryRow(db, HISTORY_TYPE)
		expect(
			(row!.slots as any)?.params?.schema?.limit?.default,
			"the projected declaration still carries a default no run has ever used"
		).toBe(DECLARED_LIMIT)
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
						"core:query/world-lore"
					)
				)
		expect((await others()).length).toBeGreaterThan(0)

		await applyMigration(db)
		expect((await others()).length).toBeGreaterThan(0)
	}, 60_000)
})

describe("0110 republishes the three documents", () => {
	it("deletes the three pins and boot republishes them with the params slot named", async () => {
		const db = await booted()

		const pins = PINS.map((p) => `${p.slug}@${p.semver}`).sort()
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		await applyMigration(db)
		for (const pin of pins) expect(await publishedPins(db)).not.toContain(pin)

		await reboot(db)
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		// ⚠ The fix, in rows: each `history` node's stored config NAMES its
		// `params` slot. `resolveInput` resolves only the keys already in that
		// object, so without this the panel's number reaches the binding on no
		// run at all, whatever the registry and the config say.
		expect(await historyNodes(db)).toEqual(
			PINS.map((p) => ({
				pin: `${p.slug}@${p.semver}`,
				nodeKey: p.nodeKey,
				params: { __ref: "slot", slot: "params" }
			})).sort((a, b) => a.pin.localeCompare(b.pin))
		)
	}, 60_000)

	it("leaves the other published specs alone", async () => {
		// The control: a DELETE that dropped its slug predicate would take every
		// published document with it, and boot would republish them all, so the
		// assertion above would still pass.
		const db = await booted()
		const summarize = () =>
			db
				.select({ semver: schema.pipelineSpecVersions.semver })
				.from(schema.pipelineSpecVersions)
				.innerJoin(
					schema.pipelineSpecs,
					eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
				)
				.where(eq(schema.pipelineSpecs.slug, "core:spec/summarize-world"))
		const before = await summarize()
		expect(before.length).toBeGreaterThan(0)

		await applyMigration(db)
		expect(await summarize()).toEqual(before)
	}, 60_000)
})

describe("0110 clears the stored copy of the old declared default", () => {
	it("takes the old default at every one of the three addresses", async () => {
		const db = await booted()

		const seeded = await storedLimits(db)
		// ⚠ The regression: `reconcileConfigs` back-fills a declared default and
		// never revisits an address that still exists, so without the statement
		// every booted database would hand the newly-live control the 40 it has
		// been storing — turning a typing fix into a 100 → 40 retrieval change.
		expect(seeded.map((r) => r.slug)).toEqual([...SLUGS].sort())

		// A fresh database boots against the CURRENT declaration, so it stores
		// 100. The state this migration exists for is a database that booted the
		// PREVIOUS build, which stored 40 — written here by hand, the same way
		// 0102's test writes the batch size it sweeps.
		await asPreviousBuild(db)

		await applyMigration(db)
		// ⚠ Asserted as "none left", not "the count went down". The statement
		// names each spec beside its own node key — `gather.history.read` for
		// the reply pipeline, `history` for the two narrators — so a typo in any
		// one of the three pairs leaves exactly one row behind, and an assertion
		// that only counted would still read as a success.
		expect(
			await storedLimits(db),
			"a stored copy of the old declared default survived the migration"
		).toEqual([])

		await reboot(db)
		const rebuilt = await storedLimits(db)
		expect(rebuilt.map((r) => r.slug)).toEqual([...SLUGS].sort())
		for (const row of rebuilt) expect(row.value).toBe(DECLARED_LIMIT)
	}, 60_000)

	it("leaves a deliberately chosen window alone", async () => {
		const db = await booted()

		await asPreviousBuild(db)
		// One config where somebody actually chose a window. It must survive —
		// the statement is scoped to rows still holding exactly the previous
		// declared default, and this is what that scope is for.
		const chosen = (await storedLimits(db))[0]!
		await db
			.update(schema.pipelineConfigValues)
			.set({ value: 25 })
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, chosen.configId),
					eq(schema.pipelineConfigValues.nodeKey, chosen.nodeKey),
					eq(schema.pipelineConfigValues.slot, "params"),
					eq(schema.pipelineConfigValues.path, "limit")
				)
			)

		await applyMigration(db)
		expect((await storedLimits(db)).map((r) => r.value)).toEqual([25])

		await reboot(db)
		const rebuilt = await storedLimits(db)
		expect(
			rebuilt.find((r) => r.configId === chosen.configId)?.value,
			"a deliberately chosen window was overwritten"
		).toBe(25)
		for (const row of rebuilt.filter((r) => r.configId !== chosen.configId))
			expect(row.value).toBe(DECLARED_LIMIT)
	}, 60_000)

	it("leaves other controls' stored values alone", async () => {
		// The control: a DELETE that forgot its `path` would take every parameter
		// this node stores with it.
		//
		// ⚠ The sibling is set to 40 on purpose. `channel` ships as 'main', so
		// with its own value it is protected by the `value` predicate whatever
		// the `path` predicate says — and dropping `path` would then change
		// nothing a test can see. Given a colliding value, the two predicates are
		// independent and each one is load-bearing.
		//
		// The `node_key` predicate gets the same treatment one node over. Note
		// that `limit` is the only parameter of that name in the whole contracts
		// package, so a `node_key` predicate widened to nothing at all would be
		// observationally identical today — this asserts the property rather
		// than a coincidence that happens to hold.
		const db = await booted()

		const siblings = () =>
			db
				.select({
					nodeKey: schema.pipelineConfigValues.nodeKey,
					path: schema.pipelineConfigValues.path,
					value: schema.pipelineConfigValues.value
				})
				.from(schema.pipelineConfigValues)
				.where(
					and(
						eq(schema.pipelineConfigValues.slot, "params"),
						inArray(schema.pipelineConfigValues.path, [
							"channel",
							"scanDepth"
						])
					)
				)

		await db
			.update(schema.pipelineConfigValues)
			.set({ value: PREVIOUS_DECLARED_LIMIT })
			.where(
				and(
					eq(schema.pipelineConfigValues.slot, "params"),
					inArray(schema.pipelineConfigValues.path, [
						"channel",
						"scanDepth"
					])
				)
			)

		const before = await siblings()
		expect(before.length).toBeGreaterThan(0)

		await applyMigration(db)
		expect(await siblings()).toEqual(before)
	}, 60_000)
})
