/**
 * `0118_relationship_search.sql` deletes the row it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * The one statement is a DELETE matched on string literals — a spec slug and a
 * semver behind a join. **A typo matches nothing and fails silently**, in the
 * one direction tests do not normally reach: on a fresh database the row is
 * projected from the current document anyway, so a re-projection that matches
 * nothing looks exactly like one that worked. Every integration suite in this
 * repo builds a fresh database, so all of them stay green while every real
 * upgrade keeps running the document it seeded — a reply pipeline that never
 * reads the narrative graph as candidates, on an install whose panel now
 * advertises that it does.
 *
 * So this builds the state a real upgrade is in — booted, the published
 * document holding the PREVIOUS shape — and only then applies the file, by
 * reading the same SQL that ships. Modelled on
 * `declaredPortsReprojection.int.test.ts` and
 * `relationshipsCapReprojection.int.test.ts`, which are the same shape for the
 * same class of defect.
 *
 * ## What is different here
 *
 * **There is no registry half, and its absence is the ruling.**
 * `core:query/relationship-search@1` is a new type id that has never been
 * published, so `syncTypeRegistry` inserts it and has nothing to conflict with;
 * the two existing relationship types are untouched, and
 * `boot/registryHashes.test.ts` records that as one new entry and zero moved
 * hashes. A `pipeline_type_registry` delete here would be a statement looking
 * for rows that cannot be stale — and would take a freshly projected row with
 * it. The last case below asserts the absence rather than arguing it.
 *
 * Whether it then RANKS what it reads is a different question and a different
 * file: `runtime/relationshipSearch.int.test.ts` starts at rows in the graph and
 * ends at the ranker's decisions.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync("drizzle/0118_relationship_search.sql", "utf8")

const TAG = "0118_relationship_search"

/** The one document this migration names. Respond alone — see the SQL. */
const SLUG = "core:spec/respond"
const SEMVER = "1.20.0"

/** Its node key in that document, and the node that concatenates it. */
const GRAPH_NODE = "gather.relationships.read"
const LINKED_NODE = "loreLinked"

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

const bootstrap = async (db: TestDb) => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	return await bootstrapPipelines(db)
}

/**
 * A fresh database, migrated and booted.
 *
 * The report is read for one thing only — that seeding was reached at all —
 * and every claim below is made against `pipeline_spec_versions`,
 * `pipeline_nodes` and `pipeline_type_registry` directly. The rows are the
 * fact; a report field is a proxy for them, and asserting on a proxy is what
 * leaves a test passing while the thing it names has moved.
 */
async function booted(): Promise<TestDb> {
	const db = await createTestDb()
	const report = await bootstrap(db)
	expect(
		report.specs.length,
		"the boot did not get as far as seeding the specs"
	).toBeGreaterThan(0)
	return db
}

const versionRow = async (db: TestDb) => {
	const [row] = await db
		.select({ id: schema.pipelineSpecVersions.id })
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineSpecVersions.specId)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, SLUG),
				eq(schema.pipelineSpecVersions.semver, SEMVER)
			)
		)
	return row
}

/**
 * The published nodes of `respond@1.20.0`, keyed the way a receipt is.
 *
 * Read off the ROWS rather than off the compiled document, for the reason
 * 0111's test gives: the rows are what `loadPublished` hands the executor, so a
 * document corrected in the catalog and never republished would still run
 * without the graph read.
 */
const publishedNodes = async (db: TestDb) => {
	const version = await versionRow(db)
	if (!version) return []
	return await db
		.select({
			id: schema.pipelineNodes.id,
			nodeKey: schema.pipelineNodes.nodeKey,
			typeId: schema.pipelineNodes.typeId,
			config: schema.pipelineNodes.config
		})
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, version.id))
}

const nodeKeys = async (db: TestDb) =>
	(await publishedNodes(db)).map((n) => n.nodeKey)

const linkedSources = async (db: TestDb) => {
	const node = (await publishedNodes(db)).find(
		(n) => n.nodeKey === LINKED_NODE
	)
	expect(node, `${LINKED_NODE} is not in the published document`).toBeTruthy()
	return ((node!.config as any)?.sources ?? []) as any[]
}

/**
 * Put a booted database back where an upgrading one is: the document published,
 * and published WITHOUT the graph read.
 *
 * ⚠ Written rather than found, and it has to be. A fresh database migrates
 * first and publishes second, so its rows come from the CURRENT document and
 * already carry it — the state this migration exists for cannot occur on a
 * database this suite builds. Both halves are stripped, because either alone
 * would be a shape nothing has ever published: the node row, and the
 * concatenation's third source that refers to it.
 */
const asPreviousBuild = async (db: TestDb) => {
	const nodes = await publishedNodes(db)
	const graph = nodes.find((n) => n.nodeKey === GRAPH_NODE)
	expect(
		graph,
		`${GRAPH_NODE} is not in the freshly published document, so this fixture ` +
			`cannot strip it — the spec edit did not land`
	).toBeTruthy()
	await db
		.delete(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.id, graph!.id))

	const linked = nodes.find((n) => n.nodeKey === LINKED_NODE)
	const config = { ...((linked!.config ?? {}) as Record<string, any>) }
	config.sources = (config.sources ?? []).filter(
		(s: any) => s?.node !== GRAPH_NODE
	)
	await db
		.update(schema.pipelineNodes)
		.set({ config: config as any })
		.where(eq(schema.pipelineNodes.id, linked!.id))
}

describe("0118 is ordered so an upgrade actually runs it", () => {
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

	it("leaves a fresh database booting cleanly, with the query published", async () => {
		// The floor under everything else: on a database where the DELETE
		// matches nothing, that is a no-op rather than an error, and the
		// document that publishes afterwards is the one with the graph read in
		// it.
		const db = await booted()
		expect(await nodeKeys(db)).toContain(GRAPH_NODE)
		expect(
			(await linkedSources(db)).some((s: any) => s?.node === GRAPH_NODE)
		).toBe(true)
	}, 60_000)
})

describe("0118 republishes the reply document", () => {
	it("is the only thing that carries the graph read to an install that already seeded", async () => {
		const db = await booted()
		await asPreviousBuild(db)

		// ⚠ The regression, first and loudest. Seeding matches on
		// (slug, semver) and updates only the display name on a match, so a
		// second boot changes nothing: this is what every upgrading install
		// gets without the migration — a panel advertising a ranked graph read
		// and a published pipeline that has never had one.
		await bootstrap(db)
		expect(
			await nodeKeys(db),
			"boot republished the document without the migration, so this file " +
				"is asserting nothing — seeding is no longer idempotent by version"
		).not.toContain(GRAPH_NODE)

		await applyMigration(db)
		expect(await versionRow(db)).toBeUndefined()

		await bootstrap(db)

		expect(await nodeKeys(db)).toContain(GRAPH_NODE)
		// ⚠ And the edge, not only the node. `resolveInput` resolves only the
		// keys already in a node's stored config, so a republished node the
		// concatenation does not name would run every turn and reach the ranker
		// on no run at all — which is the shape of the 1.8.0 history defect.
		const sources = await linkedSources(db)
		expect(sources).toHaveLength(3)
		expect(sources.at(-1)).toMatchObject({
			__ref: "data",
			node: GRAPH_NODE,
			port: "main"
		})
	}, 120_000)

	it("leaves the other published specs alone", async () => {
		// The control: a DELETE that dropped its slug predicate would take every
		// published document with it, and boot would republish them all, so the
		// assertion above would still pass.
		//
		// The two narrate documents by name, because they are the ones this
		// migration deliberately does NOT name: a narrator has no speaker, and a
		// graph read needs a speaker's perspective.
		const db = await booted()
		const others = () =>
			db
				.select({
					slug: schema.pipelineSpecs.slug,
					semver: schema.pipelineSpecVersions.semver
				})
				.from(schema.pipelineSpecVersions)
				.innerJoin(
					schema.pipelineSpecs,
					eq(
						schema.pipelineSpecs.id,
						schema.pipelineSpecVersions.specId
					)
				)
				.where(
					inArray(schema.pipelineSpecs.slug, [
						"core:spec/narrate",
						"core:spec/narrate-character",
						"core:spec/summarize-world"
					])
				)
		const before = await others()
		expect(before.length).toBeGreaterThan(0)

		await applyMigration(db)
		expect(await others()).toEqual(before)
	}, 60_000)
})

describe("0118 re-projects no type, and that is deliberate", () => {
	it("leaves every relationship type row where it is", async () => {
		// ⚠ The reason there is no registry statement. This type has never been
		// published, so there is nothing stale to clear; the two existing
		// relationship types did not move, so clearing them would delete a row
		// that agrees with the code. Asserted rather than argued, because the
		// day somebody widens one of those declarations is the day the missing
		// statement becomes a defect.
		const db = await booted()
		const rows = () =>
			db
				.select({
					typeId: schema.pipelineTypeRegistry.typeId,
					contentHash: schema.pipelineTypeRegistry.contentHash
				})
				.from(schema.pipelineTypeRegistry)
				.where(
					inArray(schema.pipelineTypeRegistry.typeId, [
						"core:query/relationship-search",
						"core:query/relationships-perspectives",
						"core:query/relationships-known",
						"core:task/rank-hybrid"
					])
				)
		const before = await rows()
		expect(before.length).toBe(4)

		await applyMigration(db)
		expect(await rows()).toEqual(before)
	}, 60_000)

	it("stores no ceiling for it, so an untouched install is uncapped", async () => {
		// It reuses `relationshipSlots`, whose `maxEntries` carries no
		// default — so `reconcileConfigs` back-fills nothing and there is no
		// stored number to sweep. The same D-8 fact 0111 had to write a third
		// statement to restore, arriving correct here because the declaration
		// was already right.
		const db = await booted()
		const stored = await db
			.select({ path: schema.pipelineConfigValues.path })
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.nodeKey, GRAPH_NODE),
					eq(schema.pipelineConfigValues.slot, "params")
				)
			)
		expect(stored).toEqual([])
	}, 60_000)
})
