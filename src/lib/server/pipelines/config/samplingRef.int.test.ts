/**
 * An author preset points a `sampling` slot at a SEEDED ROW, by seed identity.
 *
 * ## The gap this closes
 *
 * A config value at a `sampling` address is an integer `sampling_configs.id`.
 * That number is assigned by an identity sequence and therefore differs per
 * install, so a shipped document cannot write one: `p.sampling('planWrite', {
 * ... })` had nothing it could put there that would mean the same thing on two
 * machines. Every step of every pipeline consequently shipped with its
 * Sampling slot unset, and an Adventure turn ran its planner and its state
 * keeper on whatever the session was narrating with: a reasoning-heavy,
 * long-response config paid for twice per turn, for two documents nobody reads.
 *
 * The answer is the one prompts, context templates and variable layouts already
 * use: a preset names the ROW rather than the id, and `refDefaults` resolves the
 * name at projection time. The spelling is `{ seedKey: 'sampling-background' }`,
 * which cannot be mistaken for an id or for a per-sampler override.
 *
 * ## What each test is for
 *
 * The fresh-boot case is a pin, and the narrator half is the load-bearing one:
 * a resolution that filled in every sampling slot would be indistinguishable
 * from one that read the preset, and would have quietly retuned the prose.
 *
 * The unknown-seedKey case is the failure mode a plugin document reaches first.
 * A boot that throws there takes every OTHER pipeline's configuration with it,
 * so the slot is left unset and the reason is said out loud instead.
 *
 * The upgrade case is the one a fresh database cannot see, and the one
 * `0122_adventure_config_reprojection` had to be written by hand for: a shipped
 * config row is written ONCE. Here it needs no migration, and this is the proof.
 * `reconcileConfigs` back-fills an address the config has never held from
 * `refs`, which now carries the resolved row.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const ADVENTURE = "core:spec/adventure-respond"
const BACKGROUND = "sampling-background"

/**
 * The seeded row this preset names, written before the pipelines boot.
 *
 * The order is the real one rather than a convenience: `defaults.sync()` runs
 * inside the database's own initialisation (db/index.ts) and the pipelines
 * bootstrap is a startup task that awaits it, so a sampling row always exists
 * before a config is projected. `sync()` binds to the app's own `db` module and
 * cannot be pointed at a fixture database, so the one row under test is written
 * here by seed key, which is the only thing the resolution reads.
 */
async function seedBackground(db: TestDb) {
	await db.insert(schema.samplingConfigs).values({
		seedKey: BACKGROUND,
		name: "Background",
		isImmutable: true,
		values: { temperature: 0.2, contextTokens: 8192 },
		enabled: ["temperature", "contextTokens"]
	})
}

async function booted(db: TestDb) {
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

/** The spec row and its shipped, immutable config. */
async function shipped(db: TestDb) {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, ADVENTURE))
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			eq(schema.pipelineConfigs.seedKey, `pipeline-default:${ADVENTURE}`)
		)
	return { spec, config }
}

/** What one node's Sampling slot resolves to in one config, or undefined. */
async function samplingOf(db: TestDb, configId: number, nodeKey: string) {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, nodeKey),
				eq(schema.pipelineConfigValues.slot, "sampling"),
				eq(schema.pipelineConfigValues.path, "")
			)
		)
	return row?.value
}

async function backgroundId(db: TestDb) {
	const [row] = await db
		.select()
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, BACKGROUND))
	return row.id
}

describe("a preset names a sampling config by seed identity", () => {
	let db: TestDb

	beforeAll(async () => {
		db = await createTestDb()
		await seedBackground(db)
		await booted(db)
	}, 60_000)

	it("ships the planner and the keeper on Background, and the narrator on nothing", async () => {
		const { config } = await shipped(db)
		const background = await backgroundId(db)

		expect(await samplingOf(db, config.id, "planWrite")).toBe(background)
		expect(await samplingOf(db, config.id, "keeperWrite")).toBe(background)
		// The two steps a person reads keep whatever the session is set to.
		// A resolution that filled in every sampling slot would pass the two
		// assertions above and still be wrong.
		expect(await samplingOf(db, config.id, "scene")).toBeUndefined()
	})

	it("back-fills a database seeded before the preset said so, without touching an administrator's pick", async () => {
		const { spec, config } = await shipped(db)
		const background = await backgroundId(db)

		// An administrator's own configuration, with a deliberate pick at one of
		// the two addresses. A copy is what "customizing is duplicating" means,
		// so it is a second row rather than an edit of the immutable one.
		const [mine] = await db
			.insert(schema.samplingConfigs)
			.values({
				name: "Mine",
				values: { temperature: 0.9 },
				enabled: ["temperature"]
			})
			.returning()
		const [tuned] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: "Tuned" })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: tuned.id,
			nodeKey: "planWrite",
			slot: "sampling",
			path: "",
			value: mine.id
		})

		// The state a real upgrade is in: the shipped config was written by a
		// build whose preset named no sampling row, so the address has never
		// held a value in it.
		for (const nodeKey of ["planWrite", "keeperWrite"])
			await db
				.delete(schema.pipelineConfigValues)
				.where(
					and(
						eq(schema.pipelineConfigValues.configId, config.id),
						eq(schema.pipelineConfigValues.nodeKey, nodeKey),
						eq(schema.pipelineConfigValues.slot, "sampling")
					)
				)

		await reconcileConfigs(db, spec.id, spec.activeVersionId!, spec.slug)

		expect(await samplingOf(db, config.id, "planWrite")).toBe(background)
		expect(await samplingOf(db, config.id, "keeperWrite")).toBe(background)
		// The asymmetry the layer chain exists for: the author moving a default
		// reaches everybody who has not opted out, and stops at everybody who
		// has.
		expect(await samplingOf(db, tuned.id, "planWrite")).toBe(mine.id)
		expect(await samplingOf(db, tuned.id, "keeperWrite")).toBe(background)
	})
})

describe("a seedKey nothing seeded", () => {
	it("leaves the slot unset and says so, rather than failing the boot", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			// No `seedBackground` here: this is the install that has never had
			// the row, which is where a plugin document naming its own would
			// land every time.
			const db = await createTestDb()
			await booted(db)
			const { config } = await shipped(db)

			expect(await samplingOf(db, config.id, "planWrite")).toBeUndefined()
			expect(
				warn.mock.calls.some((c) =>
					c.some(
						(arg) =>
							typeof arg === "string" && arg.includes(BACKGROUND)
					)
				),
				"an unresolved reference has to name the seed key it could not find"
			).toBe(true)
		} finally {
			warn.mockRestore()
		}
	}, 60_000)
})
