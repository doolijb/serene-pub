/**
 * `0113_declared_ports_and_rank_groups.sql` deletes the rows it names.
 *
 * ## Why a DML migration needs a test at all
 *
 * Both statements are DELETEs matched on string literals — six `(type_id,
 * version)` pairs and three spec slugs with semvers behind a join. **A typo
 * matches nothing and fails silently**, in the one direction tests do not
 * normally reach: on a fresh database the stale rows are not there, so a
 * re-projection that matches nothing looks exactly like one that worked. Every
 * integration suite in this repo builds a fresh database, so all of them stay
 * green while every real upgrade keeps its stale rows — and then refuses the
 * registry outright, which `bootstrapPipelines` catches and turns into an early
 * return, silently stopping every pipeline on the install.
 *
 * So this builds the state a real upgrade is in — booted on the PREVIOUS build,
 * rows present and holding the previous content — and only then applies the
 * file, by reading the same SQL that ships. Modelled on
 * `relationshipsCapReprojection.int.test.ts`, which is the same shape for the
 * same class of defect one migration earlier.
 *
 * ## What is different here
 *
 * **The refusal is reproduced, not assumed.** 0110 and 0111 moved a declared
 * parameter, and their tests could show the fix by reading a stored number back.
 * Nothing here is stored: a port has no default, `reconcileConfigs` writes no row
 * for one, and the only thing that moves is the content hash. So the regression
 * this file guards is the conflict itself — `asPreviousBuild` puts the six rows
 * back to the hashes a 0111-era database holds, and the test asserts that boot
 * *refuses* before the migration and *succeeds* after it. A test that only
 * counted rows on a fresh database could not tell the two apart.
 *
 * Whether the newly declared ports are then READ is a different question and
 * different files: `runtime/budgetGroups.test.ts` starts at a ranker's groups and
 * ends at the allocation they produced, and the parity corpus
 * (`parity/harness.int.test.ts`) is what says the prompt bytes did not move.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { and, eq, inArray, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { typeContentHash } from "$lib/server/pipelines/boot/registrySync"
import { allTypes, allScriptTypes, snapshotRegistry } from "@serene-pub/sdk"
// Importing the contracts and the catalog is what registers them — the same
// fact-about-the-code route `bootstrapPipelines` takes. See the note in
// `registryHashes.test.ts`: these resolve to **dist**, so an edit in
// `serene-pub-sdk/*/src` changes nothing here until those packages are rebuilt.
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"

/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(
	"drizzle/0113_declared_ports_and_rank_groups.sql",
	"utf8"
)

const TAG = "0113_declared_ports_and_rank_groups"

/**
 * The six declarations that moved, and the hash each one had before.
 *
 * ⚠ The hashes are the literals `registryHashes.test.ts` recorded up to 0111 —
 * which is precisely what a database that booted that build is holding. Written
 * down rather than recomputed, for the reason that file gives about its own
 * table: a value derived from the same code it is checking cannot disagree with
 * it, and disagreeing is the whole job.
 */
const MOVED = [
	{ typeId: "core:task/assemble", version: 2, was: "17af4eb13b2c67" },
	{
		typeId: "core:task/build-template-context",
		version: 1,
		was: "2ea90523e3006"
	},
	{ typeId: "core:task/rank-hybrid", version: 1, was: "1f1459ae6e37ca" },
	{
		typeId: "core:provider/summarize-batch",
		version: 1,
		was: "1432666fe0b3dd"
	},
	{
		typeId: "core:provider/summarize-synth",
		version: 1,
		was: "eca4138224b4b"
	},
	{ typeId: "core:provider/name-entry", version: 1, was: "17558940ee8508" }
] as const

/**
 * What each of the six gained, by port and direction.
 *
 * Asserted on the projected ROW rather than on the descriptor: the row is what
 * the builder renders from and what `checkInstall` validates a plugin against
 * (F6), so a declaration corrected in the contracts package and never
 * re-projected would still describe this install as the old one.
 */
const GAINED = {
	"core:task/assemble@2": {
		in: ["decisions", "messages", "groups"],
		out: []
	},
	"core:task/build-template-context@1": {
		in: [
			"relationshipsPerspectives",
			"relationshipsKnown",
			"speakerName",
			"speakerCharacter"
		],
		out: []
	},
	"core:task/rank-hybrid@1": { in: [], out: ["groups"] },
	"core:provider/summarize-batch@1": { in: ["loreType"], out: [] },
	"core:provider/summarize-synth@1": { in: ["loreType"], out: [] },
	"core:provider/name-entry@1": { in: ["loreType"], out: [] }
} as const

/** Slug → the semver this migration names. Unchanged: the versions are frozen. */
const PINS = [
	{ slug: "core:spec/respond", semver: "1.20.0" },
	{ slug: "core:spec/narrate", semver: "1.11.0" },
	{ slug: "core:spec/narrate-character", semver: "1.0.0" }
] as const

const SLUGS = PINS.map((p) => p.slug)

/** The node whose stored config the `groups` wiring lands in, in all three. */
const PROMPT_NODE = "prompt"

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

/** What this build hashes each moved type to, from the descriptors themselves. */
const CODE_HASHES = (() => {
	const entries = snapshotRegistry([...allTypes(), ...allScriptTypes()], {
		release: "dev"
	})
	const out = new Map<string, string>()
	for (const e of entries)
		out.set(`${e.id}@${e.version}`, typeContentHash(e))
	return out
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

async function booted(): Promise<TestDb> {
	const db = await createTestDb()
	const report = await bootstrap(db)
	expect(report.conflict, report.conflict ?? "").toBeUndefined()
	return db
}

async function reboot(db: TestDb) {
	const report = await bootstrap(db)
	// A conflict here is the failure the whole file exists to prevent: it is
	// caught, reported, and `bootstrapPipelines` returns early, so pipelines
	// silently stop on every upgraded install.
	expect(report.conflict, report.conflict ?? "").toBeUndefined()
}

const registryRows = (db: TestDb) =>
	db
		.select({
			typeId: schema.pipelineTypeRegistry.typeId,
			version: schema.pipelineTypeRegistry.version,
			contentHash: schema.pipelineTypeRegistry.contentHash,
			ports: schema.pipelineTypeRegistry.ports
		})
		.from(schema.pipelineTypeRegistry)
		.where(
			inArray(
				schema.pipelineTypeRegistry.typeId,
				MOVED.map((m) => m.typeId)
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
 * The stored config of the assembling node in each of the three documents.
 *
 * Read off the published ROWS rather than off the compiled document, for the
 * reason 0111's test gives: the rows are what `loadPublished` hands the
 * executor, so a document corrected in the catalog and never republished would
 * still run without the edge.
 */
const promptConfigs = async (db: TestDb) => {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			semver: schema.pipelineSpecVersions.semver,
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
				eq(schema.pipelineNodes.nodeKey, PROMPT_NODE)
			)
		)
	return rows
		.map((r) => ({
			pin: `${r.slug}@${r.semver}`,
			config: r.config as Record<string, unknown>
		}))
		.sort((a, b) => a.pin.localeCompare(b.pin))
}

/**
 * Put a booted database back where an upgrading one is: the six rows present,
 * holding the content a 0111-era install projected.
 *
 * ⚠ Written rather than found, and it has to be. A fresh database migrates
 * first and boots second, so its rows are projected from the CURRENT
 * declarations and already carry the new ports — the state this migration exists
 * for cannot occur on a database this suite builds. The hash is what
 * `syncTypeRegistry` compares (`if (row.contentHash === hash)`), so restoring
 * the old value is what reproduces the refusal; the ports are stripped with it
 * so the row is the old row rather than a new one wearing an old label.
 */
const asPreviousBuild = async (db: TestDb) => {
	for (const m of MOVED) {
		const gained = GAINED[`${m.typeId}@${m.version}` as keyof typeof GAINED]
		const [row] = await db
			.select({
				id: schema.pipelineTypeRegistry.id,
				ports: schema.pipelineTypeRegistry.ports
			})
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, m.typeId),
					eq(schema.pipelineTypeRegistry.version, m.version)
				)
			)
		expect(
			row,
			`${m.typeId}@${m.version} has no projected row on a booted database`
		).toBeTruthy()
		const ports = JSON.parse(JSON.stringify(row!.ports ?? {})) as {
			in?: Record<string, unknown>
			out?: Record<string, unknown>
		}
		for (const p of gained.in) delete ports.in?.[p]
		for (const p of gained.out) delete ports.out?.[p]
		await db
			.update(schema.pipelineTypeRegistry)
			.set({ contentHash: m.was, ports: ports as any })
			.where(eq(schema.pipelineTypeRegistry.id, row!.id))
	}
}

/** And the document half: the `groups` edge a 0111-era install never had. */
const withoutGroupsEdge = async (db: TestDb) => {
	const rows = await db
		.select({
			id: schema.pipelineNodes.id,
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
				eq(schema.pipelineNodes.nodeKey, PROMPT_NODE)
			)
		)
	expect(
		rows.length,
		"the three assembling nodes are not there to strip an edge from"
	).toBe(3)
	for (const row of rows) {
		const config = { ...((row.config ?? {}) as Record<string, unknown>) }
		delete config.groups
		await db
			.update(schema.pipelineNodes)
			.set({ config: config as any })
			.where(eq(schema.pipelineNodes.id, row.id))
	}
}

describe("0113 is ordered so an upgrade actually runs it", () => {
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

	it("leaves a fresh database booting cleanly", async () => {
		// The floor under everything else: the migration runs on a database
		// where its two DELETEs match nothing, and that must be a no-op rather
		// than an error. `booted()` asserts no conflict, and the six rows are
		// there afterwards carrying this build's hashes.
		const db = await booted()
		const rows = await registryRows(db)
		expect(rows.length).toBe(MOVED.length)
		for (const row of rows) {
			const pin = `${row.typeId}@${row.version}`
			expect(row.contentHash, pin).toBe(CODE_HASHES.get(pin))
		}
	}, 60_000)
})

describe("0113 re-projects the six declarations that gained ports", () => {
	it("clears rows a 0111-era database refuses to boot against, and boot puts them back with the ports", async () => {
		const db = await booted()
		await asPreviousBuild(db)
		await withoutGroupsEdge(db)

		// ⚠ The regression, first and loudest. Without the migration this is
		// what every upgrading install gets: `syncTypeRegistry` raises,
		// `bootstrapPipelines` catches it and returns early, specs are never
		// seeded, and pipelines stop with a message only the diagnostics screen
		// shows.
		const refused = await bootstrap(db)
		expect(
			refused.conflict,
			"a database holding the previous build's type rows booted cleanly — " +
				"the fixture no longer reproduces the state this migration exists " +
				"for, so everything below it is vacuous"
		).toBeTruthy()
		expect(refused.conflict).toContain("already exists with different content")

		await applyMigration(db)
		expect(await registryRows(db)).toEqual([])

		await reboot(db)

		const rows = await registryRows(db)
		expect(rows.length).toBe(MOVED.length)
		for (const row of rows) {
			const pin = `${row.typeId}@${row.version}`
			// The new hash, from the row rather than from the descriptor.
			expect(
				row.contentHash,
				`${pin} was re-projected but still hashes to the old content`
			).toBe(CODE_HASHES.get(pin))
			// And the ports that moved it, by name and direction.
			const gained = GAINED[pin as keyof typeof GAINED]
			const ports = row.ports as {
				in?: Record<string, unknown>
				out?: Record<string, unknown>
			}
			for (const p of gained.in)
				expect(
					Object.keys(ports.in ?? {}),
					`${pin} projected no in-port ${p}`
				).toContain(p)
			for (const p of gained.out)
				expect(
					Object.keys(ports.out ?? {}),
					`${pin} projected no out-port ${p}`
				).toContain(p)
		}
	}, 60_000)

	it("leaves the types it does not name alone", async () => {
		// The control: a DELETE with a mis-scoped WHERE would take the registry
		// with it and the assertion above would still read as a success.
		//
		// The two sibling rankers by name, because they are the types the
		// `groups` half deliberately did NOT widen — `rank-by-recency` and the
		// `rank-recall` plugin example compute no per-band usage, so their
		// declarations did not move and their rows must not be touched.
		const db = await booted()
		const others = () =>
			db
				.select({ typeId: schema.pipelineTypeRegistry.typeId })
				.from(schema.pipelineTypeRegistry)
				.where(
					inArray(schema.pipelineTypeRegistry.typeId, [
						"core:task/rank-by-recency",
						"chariot.recall:rank-recall",
						"core:task/build-narrator-context",
						"core:provider/generate-text"
					])
				)
		expect((await others()).length).toBe(4)

		await applyMigration(db)
		expect((await others()).length).toBe(4)
	}, 60_000)

	it("takes `assemble` at version 2 and not at some other version", async () => {
		// ⚠ The predicate is a row constructor because one of the six is at
		// `@2` and five are at `@1`. A shared `AND "version" = 1` — which is
		// what 0111 used, one migration earlier — would delete five and
		// silently leave `assemble` behind, and the surviving row is the one
		// that refuses the boot.
		//
		// Written as its own case rather than folded above because the failure
		// it guards is a *partial* match, which a "rows are gone" assertion
		// over the whole set would catch only by accident of ordering.
		const db = await booted()
		const assemble = () =>
			db
				.select({ version: schema.pipelineTypeRegistry.version })
				.from(schema.pipelineTypeRegistry)
				.where(
					eq(
						schema.pipelineTypeRegistry.typeId,
						"core:task/assemble"
					)
				)
		expect((await assemble()).map((r) => r.version)).toEqual([2])

		await applyMigration(db)
		expect(await assemble()).toEqual([])
	}, 60_000)
})

describe("0113 republishes the three documents", () => {
	it("deletes the three pins and boot republishes them with the ranker's groups wired", async () => {
		const db = await booted()

		const pins = PINS.map((p) => `${p.slug}@${p.semver}`).sort()
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		await applyMigration(db)
		for (const pin of pins)
			expect(await publishedPins(db)).not.toContain(pin)

		await reboot(db)
		expect(await publishedPins(db)).toEqual(expect.arrayContaining(pins))

		// ⚠ The fix, in rows: each assembling node's stored config carries the
		// edge. `resolveInput` resolves only the keys already in that object, so
		// without this the ranker's per-band arithmetic reaches `allocate` on no
		// run at all, whatever the registry says both ports are.
		const prompts = await promptConfigs(db)
		expect(prompts.map((p) => p.pin)).toEqual(pins)
		for (const p of prompts)
			expect(p.config.groups, p.pin).toEqual({
				__ref: "data",
				node: "rank",
				port: "groups"
			})
	}, 60_000)

	it("leaves the other published specs alone", async () => {
		// The control: a DELETE that dropped its slug predicate would take every
		// published document with it, and boot would republish them all, so the
		// assertions above would still pass.
		//
		// `summarize-world` by name, because it is the spec the OTHER half of
		// this migration is about: `loreType` becoming a declared port is a
		// change to the DECLARATION, not to the document, so its version must
		// stay exactly where it is.
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

describe("0113 stores nothing, and that is deliberate", () => {
	it("writes no config value for any of the newly declared ports", async () => {
		// ⚠ The reason there is no third statement. 0110 and 0111 both ended
		// with a `pipeline_config_values` sweep, because both moved a declared
		// PARAMETER and `reconcileConfigs` back-fills an author default that
		// then outlives the declaration that wrote it.
		//
		// A port has no default and no control, so there is nothing to
		// back-fill and nothing to clear. Asserted rather than argued, because
		// the day one of these is quietly re-declared as a parameter is the day
		// the missing statement becomes a defect.
		//
		// ⚠ Scoped to the `params` slot, and the reason is a name collision
		// worth writing down: `relationshipsPerspectives` and
		// `relationshipsKnown` are ALSO two of `build-template-context`'s
		// `variables` renders, so a booted database legitimately holds a
		// `pipeline_config_values` row at each of those paths under
		// `slot = 'variables'` — a pointer to the template that lays the
		// variable out, which has nothing to do with the in-port that now
		// carries its value. One word, two addresses, and only the `params` one
		// would mean a port had grown a stored default behind a re-declaration.
		const db = await booted()
		const stored = await db
			.select({
				nodeKey: schema.pipelineConfigValues.nodeKey,
				slot: schema.pipelineConfigValues.slot,
				path: schema.pipelineConfigValues.path
			})
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.slot, "params"),
					inArray(schema.pipelineConfigValues.path, [
						"decisions",
						"messages",
						"groups",
						"relationshipsPerspectives",
						"relationshipsKnown",
						"speakerName",
						"speakerCharacter",
						"loreType"
					])
				)
			)
		expect(stored).toEqual([])
	}, 60_000)

	it("moves no type outside the six it names", async () => {
		// The widened display set (`DESCRIPTOR_DISPLAY_KEYS`, which adds
		// `label`) ships in the same change as this migration and contributes no
		// rows to it — no published type carries a `label` inside `slots`,
		// `entryShape` or `configSchema`, so no hash moves by it.
		//
		// ⚠ Asserted over the WHOLE registry rather than the six, because that
		// is the claim: a boot on a database holding every 0111-era row must
		// conflict on exactly these six and nothing else. If the display set
		// ever widens onto a word something uses, this is what says so — and it
		// says it here, where the answer is a migration, rather than at a user's
		// next restart.
		const db = await booted()
		const rows = await db
			.select({
				typeId: schema.pipelineTypeRegistry.typeId,
				version: schema.pipelineTypeRegistry.version,
				contentHash: schema.pipelineTypeRegistry.contentHash
			})
			.from(schema.pipelineTypeRegistry)
			.where(sql`${schema.pipelineTypeRegistry.ownerPluginId} IS NULL`)
		expect(rows.length).toBeGreaterThan(MOVED.length)
		const drifted = rows
			.filter((r) => {
				const pin = `${r.typeId}@${r.version}`
				const code = CODE_HASHES.get(pin)
				return code !== undefined && code !== r.contentHash
			})
			.map((r) => `${r.typeId}@${r.version}`)
		expect(
			drifted,
			"a projected row disagrees with what this build hashes it to, so " +
				"boot would refuse it on every upgrading install"
		).toEqual([])
	}, 60_000)
})
