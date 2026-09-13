/**
 * `0111_reply_slots_and_relationship_cap.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * All three statements are DELETEs matched on string literals — two type ids
 * with a version, three spec slugs with semvers behind a join, and two config
 * addresses behind a two-table join. **A typo matches nothing and fails
 * silently**, in the one direction tests do not normally reach: on a fresh
 * database the rows are not there yet, so a re-projection that matches nothing
 * looks exactly like one that worked. Every integration suite in this repo
 * builds a fresh database, so all of them stay green while every real upgrade
 * keeps its stale rows — and then either refuses the registry (which silently
 * stops pipelines), keeps running three documents whose `generate` node names
 * neither its Connection nor its Sampling slot, or keeps a stored `12` that the
 * newly-wired relationship reads would apply as a ceiling nothing has ever
 * applied.
 *
 * So this builds the state a real upgrade is in — booted, rows present — and
 * only then applies the file, by reading the same SQL that ships. Modelled on
 * `sessionHistoryLimitReprojection.int.test.ts`, which is the same three
 * statements for the same class of defect one migration earlier.
 *
 * ## What is different here
 *
 * **The third statement's absence is permanent.** 0110 deleted a stored value
 * and boot wrote a corrected one back on the same startup, so its test could
 * assert the new number. Here the corrected declaration carries **no default at
 * all** — uncapped is not a number `min: 0` can hold, and `capRelationships`
 * reads a missing `maxEntries` as no ceiling — so `reconcileConfigs` has nothing
 * to back-fill and the right end state is *no row*. That makes "none left" the
 * assertion and a surviving row the one thing that would change behaviour, which
 * is why it is checked per address rather than by count.
 *
 * What the wiring being *read* looks like is a different question and two
 * different files: `runtime/relationshipsCap.int.test.ts` starts at a config row
 * and ends at how many relationships the query returned, and
 * `runtime/samplingSlotDispatch.int.test.ts` starts at a pick and ends at the
 * connection the adapter was constructed against.
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

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0111_reply_slots_and_relationship_cap.sql",
	"utf8"
)

const TAG = "0111_reply_slots_and_relationship_cap"

/** The two types whose declaration moved — both, because both lost a default. */
const RELATIONSHIP_TYPES = [
	"core:query/relationships-perspectives",
	"core:query/relationships-known"
] as const

/** Slug → the semver this migration names. */
const PINS = [
	{ slug: "core:spec/respond", semver: "1.20.0" },
	{ slug: "core:spec/narrate", semver: "1.11.0" },
	{ slug: "core:spec/narrate-character", semver: "1.0.0" }
] as const

const SLUGS = PINS.map((p) => p.slug)

/** The two config addresses the third statement sweeps, in `respond` alone. */
const RELATIONSHIP_NODES = [
	"gather.relationshipsPerspectives.read",
	"gather.relationshipsKnown.read"
] as const

/**
 * What the declaration said before, and what every booted database stored.
 *
 * There is no "after" number to pair it with, and that is the ruling: every run
 * this node type has ever made called `capRelationships` with `undefined` and
 * was uncapped, so under D-8 the declared default has to express *that* — which
 * `min: 0` cannot hold as a number, so the default is gone entirely.
 */
const PREVIOUS_DECLARED_CAP = 12

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
	expect(
		report.specs.length,
		"the boot did not get as far as seeding the specs"
	).toBeGreaterThan(0)
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
	expect(
		report.specs.length,
		"the boot did not get as far as seeding the specs"
	).toBeGreaterThan(0)
}

const registryRows = (db: TestDb, typeIds: readonly string[]) =>
	db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			slots: schema.pipelineTypeRegistry.slots
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			and(
				inArray(schema.pipelineTypeRegistry.typeId, [...typeIds]),
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
 * The stored config of the nodes both halves of the fix touch.
 *
 * Read off the published ROWS rather than off the compiled document: the rows
 * are what `loadPublished` hands the executor, so a document corrected in the
 * catalog and never republished would still run without the slots.
 */
const nodeConfigs = async (db: TestDb, nodeKeys: readonly string[]) => {
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
				inArray(schema.pipelineSpecs.slug, SLUGS),
				inArray(schema.pipelineNodes.nodeKey, [...nodeKeys])
			)
		)
	return rows
		.map((r) => ({
			pin: `${r.slug}@${r.semver}`,
			nodeKey: r.nodeKey,
			config: r.config as Record<string, unknown>
		}))
		.sort((a, b) => a.pin.localeCompare(b.pin))
}

/** Every stored value for the relationship ceiling, per config. */
const storedCaps = async (db: TestDb) => {
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
				inArray(schema.pipelineConfigValues.nodeKey, [
					...RELATIONSHIP_NODES
				]),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "maxEntries")
			)
		)
	return rows.sort(
		(a, b) => a.nodeKey.localeCompare(b.nodeKey) || a.configId - b.configId
	)
}

/**
 * Put a booted database back where an upgrading one is: rows present, holding
 * the number the OLD declaration back-filled.
 *
 * ⚠ Written rather than found. A fresh database boots against the CURRENT
 * declaration, which carries no default at all — so `reconcileConfigs` writes
 * nothing and there is no row to update. The state this migration exists for is
 * a database that booted the PREVIOUS build, and on a fresh one it has to be
 * constructed. `asPreviousBuild` in 0110's test could UPDATE because that
 * declaration still had a default; this one has to INSERT.
 */
const asPreviousBuild = async (db: TestDb) => {
	const configs = await db
		.select({ id: schema.pipelineConfigs.id })
		.from(schema.pipelineConfigs)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecs.id, schema.pipelineConfigs.specId)
		)
		.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
	expect(
		configs.length,
		"respond has no configurations, so there is nothing for the back-fill " +
			"to have written into"
	).toBeGreaterThan(0)
	await db.insert(schema.pipelineConfigValues).values(
		configs.flatMap((c) =>
			RELATIONSHIP_NODES.map((nodeKey) => ({
				configId: c.id,
				nodeKey,
				slot: "params",
				path: "maxEntries",
				value: PREVIOUS_DECLARED_CAP as any
			}))
		)
	)
}

describe("0111 is ordered so an upgrade actually runs it", () => {
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

describe("0111 re-projects the two relationship declarations", () => {
	it("deletes the rows a booted database has, and boot puts them back carrying no default", async () => {
		const db = await booted()

		// ⚠ The regression, first. Without this the DELETE could match nothing
		// and every assertion after it would still pass.
		expect((await registryRows(db, RELATIONSHIP_TYPES)).length).toBe(2)

		await applyMigration(db)
		expect(await registryRows(db, RELATIONSHIP_TYPES)).toEqual([])

		await reboot(db)

		// Read off the PROJECTED rows rather than the descriptors: the row is
		// what the panel renders and what `declarations()` derives an author
		// default from, so a declaration corrected in the contracts package and
		// never re-projected would still ship 12 to every upgraded install.
		const rows = await registryRows(db, RELATIONSHIP_TYPES)
		expect(rows.length).toBe(2)
		for (const row of rows) {
			const field = (row.slots as any)?.params?.schema?.maxEntries
			expect(
				field,
				`${row.typeId} projected no maxEntries parameter at all — the ` +
					`control is gone, not uncapped`
			).toBeTruthy()
			expect(
				field.default,
				`${row.typeId}'s projected declaration still carries a ceiling ` +
					`no run has ever applied`
			).toBeUndefined()
			// The other half of "uncapped, not off": the parameter is still
			// there, still an integer, still floored at 0 — what moved is only
			// the seeded number.
			expect(field.type).toBe("integer")
			expect(field.min).toBe(0)
		}
	}, 60_000)

	it("leaves the types it does not name alone", async () => {
		// The control: a DELETE with a mis-scoped WHERE would take the registry
		// with it and the assertion above would still read as a success.
		//
		// `generate-text` by name, because it is the type the OTHER half of this
		// migration is about: naming a slot is a change to the document, so its
		// declaration did not move and its row must not be touched.
		const db = await booted()
		const others = () =>
			db
				.select({ typeId: schema.pipelineTypeRegistry.typeId })
				.from(schema.pipelineTypeRegistry)
				.where(
					inArray(schema.pipelineTypeRegistry.typeId, [
						"core:provider/generate-text",
						"core:query/session-history"
					])
				)
		expect((await others()).length).toBe(2)

		await applyMigration(db)
		expect((await others()).length).toBe(2)
	}, 60_000)
})

describe("0111 republishes the three documents", () => {
	it("deletes the three pins and boot republishes them with the reply step's slots named", async () => {
		const db = await booted()

		const pins = PINS.map((p) => `${p.slug}@${p.semver}`).sort()
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		await applyMigration(db)
		for (const pin of pins)
			expect(await publishedPins(db)).not.toContain(pin)

		await reboot(db)
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		// ⚠ The fix, in rows: each `generate` node's stored config NAMES both
		// slots. `resolveInput` resolves only the keys already in that object,
		// so without these the panel's pick reaches `dispatch` on no run at all,
		// whatever the registry and the config say — while `contextBudget` and
		// `prompt`, which read the same two slots by reference, follow it.
		const generates = await nodeConfigs(db, ["generate"])
		expect(generates.map((g) => g.pin)).toEqual(pins)
		for (const g of generates) {
			expect(g.config.connection, `${g.pin}`).toEqual({
				__ref: "slot",
				slot: "connection"
			})
			expect(g.config.sampling, `${g.pin}`).toEqual({
				__ref: "slot",
				slot: "sampling"
			})
		}
	}, 60_000)

	it("republishes respond with both relationship reads naming their params slot", async () => {
		const db = await booted()

		await applyMigration(db)
		await reboot(db)

		expect(await nodeConfigs(db, RELATIONSHIP_NODES)).toEqual(
			RELATIONSHIP_NODES.map((nodeKey) => ({
				pin: "core:spec/respond@1.20.0",
				nodeKey,
				config: {
					scope: {
						__ref: "data",
						node: "input",
						port: "sessionScope"
					},
					params: { __ref: "slot", slot: "params" }
				}
			})).sort((a, b) => a.nodeKey.localeCompare(b.nodeKey))
		)
	}, 60_000)

	it("leaves the other published specs alone", async () => {
		// The control: a DELETE that dropped its slug predicate would take every
		// published document with it, and boot would republish them all, so the
		// assertions above would still pass.
		const db = await booted()
		const summarize = () =>
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
				.where(
					eq(schema.pipelineSpecs.slug, "core:spec/summarize-world")
				)
		const before = await summarize()
		expect(before.length).toBeGreaterThan(0)

		await applyMigration(db)
		expect(await summarize()).toEqual(before)
	}, 60_000)
})

describe("0111 clears the stored copy of the old declared ceiling", () => {
	it("takes the old default at both addresses, and boot writes none back", async () => {
		const db = await booted()

		// ⚠ The regression: `reconcileConfigs` back-fills a declared default and
		// never revisits an address that still exists, so without the statement
		// every booted database would hand the newly-live control the 12 it has
		// been storing — turning a wiring fix into a ceiling no run has ever
		// applied.
		await asPreviousBuild(db)
		const seeded = await storedCaps(db)
		expect(
			[...new Set(seeded.map((r) => r.nodeKey))].sort(),
			"the fixture did not put a stored ceiling at both addresses"
		).toEqual([...RELATIONSHIP_NODES].sort())

		await applyMigration(db)
		// ⚠ Asserted as "none left", not "the count went down". The statement
		// names both node keys in one `IN`, so a typo in either leaves exactly
		// that address behind, and an assertion that only counted would still
		// read as a success.
		expect(
			await storedCaps(db),
			"a stored copy of the old declared ceiling survived the migration"
		).toEqual([])

		await reboot(db)
		// ⚠ And it stays empty, which is where this parts company with 0110.
		// That migration's back-fill wrote the corrected number back on the next
		// boot; the corrected declaration here carries no default, so there is
		// nothing to write and "no row" IS the uncapped state the run has always
		// had.
		expect(
			await storedCaps(db),
			"boot re-seeded a ceiling — the declaration has a default again, " +
				"and every install is about to be capped by it"
		).toEqual([])
	}, 60_000)

	it("leaves a deliberately chosen ceiling alone", async () => {
		const db = await booted()

		await asPreviousBuild(db)
		// One config where somebody actually chose a ceiling. It must survive —
		// the statement is scoped to rows still holding exactly the previous
		// declared default, and this is what that scope is for.
		const chosen = (await storedCaps(db))[0]!
		await db
			.update(schema.pipelineConfigValues)
			.set({ value: 3 })
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, chosen.configId),
					eq(schema.pipelineConfigValues.nodeKey, chosen.nodeKey),
					eq(schema.pipelineConfigValues.slot, "params"),
					eq(schema.pipelineConfigValues.path, "maxEntries")
				)
			)

		await applyMigration(db)
		expect((await storedCaps(db)).map((r) => r.value)).toEqual([3])

		await reboot(db)
		expect(
			(await storedCaps(db)).find(
				(r) =>
					r.configId === chosen.configId &&
					r.nodeKey === chosen.nodeKey
			)?.value,
			"a deliberately chosen ceiling was overwritten"
		).toBe(3)
	}, 60_000)

	it("leaves other controls' stored values alone", async () => {
		// The control: a DELETE that forgot its `path` would take every parameter
		// these two nodes store with it, and one that forgot `node_key` would
		// take `maxEntries` off `entity-search`, `vector-search` and
		// `entity-link` — three live retrieval switches that share the name.
		//
		// ⚠ Both siblings are set to 12 on purpose. With their own values they
		// are protected by the `value` predicate whatever the other predicates
		// say, so widening one would change nothing a test can see. Given a
		// colliding value, each predicate is independently load-bearing.
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
							"maxEntries",
							"maxMessages"
						])
					)
				)

		// ⚠ **Seeded, where this used to `UPDATE` rows that were already
		// there.** A config stores only deviations since 2026-09-10, so a fresh
		// boot holds nothing at any of these addresses — the old form moved
		// zero rows and left `before` empty, which made the comparison below
		// vacuous in exactly the direction a mis-scoped DELETE would exploit.
		//
		// The addresses come off the declarations, minus the relationship nodes
		// themselves: what this test controls for is a sweep that took some
		// OTHER node's `maxEntries` with it.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		for (const slug of SLUGS) {
			const [spec] = await db
				.select({
					id: schema.pipelineSpecs.id,
					activeVersionId: schema.pipelineSpecs.activeVersionId
				})
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, slug))
			if (!spec?.activeVersionId) continue
			const decls = (await declarations(db, spec.activeVersionId)).filter(
				(d) =>
					d.slot === "params" &&
					(d.path === "maxEntries" || d.path === "maxMessages") &&
					!(RELATIONSHIP_NODES as readonly string[]).includes(
						d.nodeKey
					)
			)
			const configs = await db
				.select({ id: schema.pipelineConfigs.id })
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
			for (const config of configs)
				for (const d of decls)
					await setConfigValue(
						db,
						config.id,
						{ nodeKey: d.nodeKey, slot: d.slot, path: d.path },
						PREVIOUS_DECLARED_CAP
					)
		}

		const before = await siblings()
		// The relationship nodes hold no row of their own — the declaration has
		// no default and the loop above skips them — so everything here belongs
		// to some other node, which is what makes it a control.
		expect(
			before.length,
			"no sibling cap was seeded, so the third statement's predicates " +
				"are being asserted against an empty table"
		).toBeGreaterThan(0)
		expect(
			before.map((r) => r.nodeKey),
			"the relationship reads have a stored row on a fresh database, so " +
				"this is no longer a control over OTHER nodes"
		).not.toEqual(expect.arrayContaining([...RELATIONSHIP_NODES]))

		await applyMigration(db)
		expect(await siblings()).toEqual(before)
	}, 60_000)
})
