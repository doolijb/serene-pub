/**
 * `0095_prompt_format_reprojection.sql` deletes the rows it names.
 *
 * ## Why a migration needs a test at all
 *
 * Both halves of this one are DELETEs matched on string literals — a type id and
 * two `(slug, semver)` pairs. **A typo matches nothing and fails silently**, and
 * it fails silently in the one direction tests do not normally reach: on a fresh
 * database the rows do not exist yet, so a re-projection that matches nothing
 * looks exactly like a re-projection that worked. Every integration suite in
 * this repo builds a fresh database, so every one of them would stay green while
 * every real upgrade kept its stale rows and either refused the registry
 * (pipelines silently stop) or ran a document that no longer matches the code.
 *
 * So this file builds the state a real upgrade is in — booted, rows present —
 * and only then applies the file, by reading the same SQL that ships.
 *
 * ## And that boot puts them back, with the change in them
 *
 * The delete is only half of what makes the pairing work: `seedCoreSpecs`
 * matches on `(slug, semver)` and, on a match, updates only the display name, so
 * the point of removing the version row is that the NEXT boot republishes the
 * current document. The last case here is that one — it re-boots and reads the
 * republished `prompt` node's wiring back out of the rows.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0095_prompt_format_reprojection.sql",
	"utf8"
)

/**
 * The journal `when` this migration is registered under, and the greatest one
 * registered BEFORE it.
 *
 * Read out of the journal rather than typed twice: the number is the whole of
 * whether an upgrade runs this file, and a copy of it here that drifted from the
 * journal would assert against itself.
 */
const { JOURNAL_WHEN, PRECEDING_MAX } = (() => {
	const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"))
	const entries = journal.entries as Array<{
		tag: string
		idx: number
		when: number
	}>
	const entry = entries.find(
		(e) => e.tag === "0095_prompt_format_reprojection"
	)
	expect(entry, "0095 has no journal entry, so it runs nowhere").toBeTruthy()
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

const assembleRow = (db: TestDb) =>
	db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				eq(schema.pipelineTypeRegistry.typeId, "core:task/assemble"),
				eq(schema.pipelineTypeRegistry.version, 2)
			)
		)

const versionRow = (db: TestDb, slug: string, semver: string) =>
	db
		.select({ id: schema.pipelineSpecVersions.id })
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, slug),
				eq(schema.pipelineSpecVersions.semver, semver)
			)
		)

async function booted(): Promise<TestDb> {
	const db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	const report = await bootstrapPipelines(db)
	expect(report.conflict, report.conflict ?? "").toBeUndefined()
	return db
}

describe("0095 re-projects what it names", () => {
	it("is ordered after everything registered before it, so an upgrade runs it", async () => {
		/**
		 * ⚠ The half a fresh database normally cannot check.
		 *
		 * `PgDialect.migrate` reads the last applied migration ONCE and then
		 * applies only files whose journal `when` is greater. A file numbered at
		 * or below an already-applied index is therefore **silently skipped** on
		 * every upgraded install — and on an empty database the comparison
		 * short-circuits and every file applies regardless, so no ordinary
		 * integration test can see the difference.
		 *
		 * What IS checkable here is the property that decides it: this
		 * migration's `when` has to exceed every `when` registered ahead of it.
		 * Not "is the greatest in the journal" — that was the same fact while
		 * 0095 was the last file, and it stopped being true the moment 0096 was
		 * generated, which would have read as this migration breaking rather
		 * than as a newer one arriving.
		 *
		 * Drizzle stores the number as `created_at`, so the applied row naming
		 * this file's `when` is the same fact an upgrade would compare against.
		 * That half also catches the other half of the pairing — a `.sql` file
		 * with no journal entry runs nowhere at all, and every other test in
		 * this file would still pass because they read the SQL from disk.
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

		// ⚠ The regression, first. Without these four the DELETEs below could
		// match nothing and every assertion after them would still pass.
		expect((await assembleRow(db)).length).toBe(1)
		expect(
			(await versionRow(db, "core:spec/respond", "1.20.0")).length
		).toBe(1)
		expect(
			(await versionRow(db, "core:spec/narrate", "1.11.0")).length
		).toBe(1)

		await applyMigration(db)

		expect((await assembleRow(db)).length).toBe(0)
		expect(
			(await versionRow(db, "core:spec/respond", "1.20.0")).length
		).toBe(0)
		expect(
			(await versionRow(db, "core:spec/narrate", "1.11.0")).length
		).toBe(0)
	}, 60_000)

	it("takes the version's own rows with it and leaves other specs alone", async () => {
		const db = await booted()
		const [respond] = await versionRow(db, "core:spec/respond", "1.20.0")
		expect(respond).toBeTruthy()

		const nodesFor = (versionId: number) =>
			db
				.select({ key: schema.pipelineNodes.nodeKey })
				.from(schema.pipelineNodes)
				.where(eq(schema.pipelineNodes.specVersionId, versionId))

		expect((await nodesFor(respond.id)).length).toBeGreaterThan(0)

		// A spec the migration does not name, as the control: a DELETE with a
		// mis-scoped WHERE would take the whole table with it and every
		// assertion above would still read as a success.
		const [graph] = await versionRow(db, "core:spec/graph-build", "1.2.0")
		expect(graph).toBeTruthy()

		await applyMigration(db)

		// Cascaded, so no orphaned nodes are left pointing at a version that is
		// gone — which is what makes republishing a clean insert rather than a
		// collision.
		expect((await nodesFor(respond.id)).length).toBe(0)
		expect(
			(await versionRow(db, "core:spec/graph-build", "1.2.0")).length
		).toBe(1)
		expect((await nodesFor(graph.id)).length).toBeGreaterThan(0)
	}, 60_000)

	it("the next boot republishes the document with the wiring in it", async () => {
		// The half the delete exists for. `seedCoreSpecs` skips a version it
		// finds, so an in-place spec edit under the version freeze reaches an
		// install ONLY because the row was removed first.
		const db = await booted()
		await applyMigration(db)

		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		const report = await bootstrapPipelines(db)
		expect(report.conflict, report.conflict ?? "").toBeUndefined()
		expect(
			report.specs.find((s) => s.id === "core:spec/respond")?.action
		).toBe("published")

		// The registry row is back too — otherwise `syncTypeRegistry` would
		// have refused the changed hash and `bootstrapPipelines` would have
		// returned early with a conflict.
		expect((await assembleRow(db)).length).toBe(1)

		const [republished] = await versionRow(
			db,
			"core:spec/respond",
			"1.20.0"
		)
		expect(republished).toBeTruthy()
		const [prompt] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(
						schema.pipelineNodes.specVersionId,
						republished.id
					),
					eq(schema.pipelineNodes.nodeKey, "prompt")
				)
			)

		// Read out of the ROWS, which is what a run resolves against — not off
		// the compiled document in memory, which would be the code grading its
		// own homework.
		expect((prompt.config as any).connection).toMatchObject({
			__ref: "slot",
			slot: "connection",
			ofNode: "generate"
		})
		expect((prompt.resolvedRefs as any).connection).toBe("generate")
	}, 60_000)
})

describe("the shared slot adds nothing for anyone to configure", () => {
	it("offers one connection option, on the step that sends", async () => {
		/**
		 * A `connection` slot on Assemble would be a second connection picker
		 * beside the reply step's — two boxes for one value, where writing the
		 * new one would change nothing, because the executor resolves a shared
		 * slot against the TARGET node's stored value.
		 *
		 * It does not appear, and the reason is a rule the panel already had:
		 * `declarations()` skips a slot the document wired to another node's
		 * (13 §12 finding i). This pins that the rule covers connections too —
		 * an untouched pipeline gains no setting from this change.
		 */
		const db = await booted()
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const conns = (
			await declarations(db, spec.activeVersionId!)
		).filter((d: any) => d.control === "connection-ref")

		// The two embedding Providers declare their own — unshared, and
		// genuinely a person's to point somewhere. `prompt` is the one that
		// must not be here.
		expect(conns.map((d: any) => d.nodeKey).sort()).toEqual([
			"generate",
			"names.arm.embed",
			"semantic.arm.embed"
		])
		expect(conns.some((d: any) => d.nodeKey === "prompt")).toBe(false)

		// ⚠ And it is absent because it is SHARED, not because there is no slot.
		// Without this line the assertion above would pass just as happily
		// against a build where Assemble had no connection slot at all — which
		// is the state this whole change exists to leave behind.
		const [prompt] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(
						schema.pipelineNodes.specVersionId,
						spec.activeVersionId!
					),
					eq(schema.pipelineNodes.nodeKey, "prompt")
				)
			)
		expect((prompt.resolvedRefs as any)?.connection).toBe("generate")
	}, 60_000)
})
