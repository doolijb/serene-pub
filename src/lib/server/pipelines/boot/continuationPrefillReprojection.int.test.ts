/**
 * `0106_continuation_prefill_reprojection.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * All three statements are DELETEs matched on string literals — two type ids
 * with a version, and a spec slug and semver behind a join. **A typo matches
 * nothing and fails silently**, in the one direction tests do not normally
 * reach: on a fresh database the rows are not there yet, so a re-projection that
 * matches nothing looks exactly like one that worked. Every integration suite in
 * this repo builds a fresh database, so all of them stay green while every real
 * upgrade keeps its stale rows — and then either refuses the registry (which
 * silently stops pipelines) or keeps running a `respond` document with no edge
 * from the input's `continuationPrefill` to the seed line, which is the whole
 * fix.
 *
 * So this builds the state a real upgrade is in — booted, rows present — and
 * only then applies the file, by reading the same SQL that ships. Modelled on
 * `summarizeBatchBudgetReprojection.int.test.ts`, which is modelled on 0099's
 * and 0095's.
 *
 * ## What is different here
 *
 * The document half is asserted on an **edge**, not on a node's stored config.
 * A slot is a value on `pipeline_nodes.config`; a port is a row in
 * `pipeline_edges`, and a wire that did not survive republication is an edge
 * that is not there. That is the shape of the defect being fixed — nothing was
 * misconfigured, the connection simply did not exist.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0106_continuation_prefill_reprojection.sql",
	"utf8"
)

const TAG = "0106_continuation_prefill_reprojection"

const RESPOND_SLUG = "core:spec/respond"
const RESPOND_SEMVER = "1.20.0"
const LINES_TYPE = "core:task/process-messages"
const INPUT_TYPE = "core:input/user-message"

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
	expect(
		entry,
		`${TAG} has no journal entry, so it runs nowhere`
	).toBeTruthy()
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
			ports: schema.pipelineTypeRegistry.ports
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.typeId, typeId),
				eq(schema.pipelineTypeRegistry.version, 1)
			)
		)

const respondVersions = async (db: TestDb) => {
	const rows = await db
		.select({ semver: schema.pipelineSpecVersions.semver })
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SLUG))
	return rows.map((r) => r.semver).sort()
}

/**
 * The wire the fix consists of: `input.continuationPrefill → lines`.
 *
 * Read off the published rows rather than off the compiled document — the rows
 * are what `loadPublished` hands the executor, so a document corrected in the
 * catalog and never republished would still run without the edge.
 */
async function prefillEdges(db: TestDb) {
	const rows = await db
		.select({
			fromPort: schema.pipelineEdges.fromPort,
			toPort: schema.pipelineEdges.toPort,
			fromNodeId: schema.pipelineEdges.fromNodeId,
			toNodeId: schema.pipelineEdges.toNodeId
		})
		.from(schema.pipelineEdges)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(
				schema.pipelineSpecVersions.id,
				schema.pipelineEdges.specVersionId
			)
		)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, RESPOND_SLUG),
				eq(schema.pipelineSpecVersions.semver, RESPOND_SEMVER),
				eq(schema.pipelineEdges.toPort, "continuationPrefill")
			)
		)
	if (!rows.length) return []
	const nodes = await db
		.select({
			id: schema.pipelineNodes.id,
			nodeKey: schema.pipelineNodes.nodeKey,
			typeId: schema.pipelineNodes.typeId
		})
		.from(schema.pipelineNodes)
	const byId = new Map(nodes.map((n) => [n.id, n]))
	return rows.map((r) => ({
		from: byId.get(r.fromNodeId!)?.nodeKey,
		fromPort: r.fromPort,
		to: byId.get(r.toNodeId)?.nodeKey,
		toType: byId.get(r.toNodeId)?.typeId
	}))
}

describe("0106 is ordered so an upgrade actually runs it", () => {
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

	/**
	 * ⚠ **This stamp is one minute above `0105_llamacpp_service_type`'s, and
	 * that puts it ahead of the clock it was written on.**
	 *
	 * `db/migrationJournal.test.ts` forbids a future `when`, for a good reason:
	 * a stamp above wall time plants a floor that every honestly-generated
	 * migration after it falls under, until the clock catches up. It is already
	 * red for 0105, which was hand-stamped roughly twenty hours ahead.
	 *
	 * The two rules are in direct conflict here and only one of them can hold:
	 * a `when` at or below 0105's would be **silently skipped** on every
	 * database that applied 0105, which is a data defect no test can see, while
	 * a `when` above it is a red test with a two-number fix. So this takes the
	 * smallest margin that is unambiguously greater, adding a minute to a floor
	 * 0105 had already planted rather than a day.
	 *
	 * Whoever restamps 0105 to its real generation time must restamp this in the
	 * same edit, keeping it above.
	 */
})

describe("0106 re-projects the two type declarations", () => {
	it("deletes the rows a booted database has, and boot puts them back carrying the port", async () => {
		const db = await booted()

		// ⚠ The regression, first. Without these the DELETEs could match
		// nothing and every assertion after them would still pass.
		expect((await registryRow(db, LINES_TYPE)).length).toBe(1)
		expect((await registryRow(db, INPUT_TYPE)).length).toBe(1)

		await applyMigration(db)
		expect(await registryRow(db, LINES_TYPE)).toEqual([])
		expect(await registryRow(db, INPUT_TYPE)).toEqual([])

		await reboot(db)

		// Read off the PROJECTED rows rather than the descriptors: the row is
		// what the executor resolves ports against and what the panel renders,
		// so a declaration corrected in the contracts package and never
		// re-projected would still ship the old surface.
		const [lines] = await registryRow(db, LINES_TYPE)
		expect(
			(lines!.ports as any)?.in?.continuationPrefill,
			"the seed line still has no port to receive a prefill on"
		).toBeTruthy()

		const [input] = await registryRow(db, INPUT_TYPE)
		expect(
			(input!.ports as any)?.out?.continuationPrefill,
			"nothing can supply the prefill to the run"
		).toBeTruthy()
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
						"core:input/side-character-turn"
					)
				)
		expect((await others()).length).toBeGreaterThan(0)

		await applyMigration(db)
		expect((await others()).length).toBeGreaterThan(0)
	}, 60_000)
})

describe("0106 republishes the respond document", () => {
	it("deletes 1.20.0 and boot republishes it carrying the prefill edge", async () => {
		const db = await booted()

		expect(await respondVersions(db)).toContain(RESPOND_SEMVER)

		await applyMigration(db)
		expect(await respondVersions(db)).not.toContain(RESPOND_SEMVER)

		await reboot(db)
		expect(await respondVersions(db)).toContain(RESPOND_SEMVER)

		// ⚠ The wire, in rows. This is the fix: the input node's
		// `continuationPrefill` reaches the node that builds the seed line.
		expect(await prefillEdges(db)).toEqual([
			{
				from: "input",
				fromPort: "continuationPrefill",
				to: "lines",
				toType: LINES_TYPE
			}
		])
	}, 60_000)

	it("leaves the other published specs alone", async () => {
		// The control: a DELETE that dropped its slug predicate would take every
		// published document with it, and boot would republish them all, so the
		// assertion above would still pass.
		const db = await booted()
		const narrate = () =>
			db
				.select({ semver: schema.pipelineSpecVersions.semver })
				.from(schema.pipelineSpecVersions)
				.innerJoin(
					schema.pipelineSpecs,
					eq(
						schema.pipelineSpecs.id,
						schema.pipelineSpecVersions.specId
					)
				)
				.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		const before = await narrate()
		expect(before.length).toBeGreaterThan(0)

		await applyMigration(db)
		expect(await narrate()).toEqual(before)
	}, 60_000)
})
