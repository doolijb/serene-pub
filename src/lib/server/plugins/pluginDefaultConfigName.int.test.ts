/**
 * A plugin spec's shipped default must not collide with the config its package
 * ships (boot defect, 2026-09-27).
 *
 * Twenty Questions labels both its default author preset and its shipped config
 * "Twenty Questions". `ensureDefaultConfig` named the `pipeline-default:<slug>`
 * row after the preset, so on the boot after install the insert hit
 * `pipeline_configs_spec_name_idx (spec_id, name)` for `respond` and
 * `judge-guess`; `reconcilePublishedConfigs` caught and logged it, and the two
 * specs were never reconciled.
 *
 * Pinned over the REAL built package (`npm run package` in the plugin first).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, like } from "drizzle-orm"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

const TQ_DIR = path.resolve(
	__dirname,
	"../../../../../serene-pub-plugin-twenty-questions"
)
const PLUGIN = "showcase.twenty-questions"
const RESPOND = `${PLUGIN}:spec/respond`
const JUDGE = `${PLUGIN}:spec/judge-guess`

let db: TestDb
let dataDir: string

async function configsOf(slug: string) {
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	expect(spec, `${slug} is installed`).toBeTruthy()
	return db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, spec!.id))
}

async function coreSnapshot() {
	const rows = await db
		.select({
			id: schema.pipelineConfigs.id,
			seedKey: schema.pipelineConfigs.seedKey,
			name: schema.pipelineConfigs.name
		})
		.from(schema.pipelineConfigs)
		.where(like(schema.pipelineConfigs.seedKey, "pipeline-default:core:%"))
	return [...rows].sort((a, b) => a.id - b.id)
}

async function reconcileWarnings() {
	const warn = vi.spyOn(console, "warn")
	try {
		const { reconcilePublishedConfigs } = await import(
			"$lib/server/pipelines/boot/seed"
		)
		await reconcilePublishedConfigs(db)
		return warn.mock.calls.filter((c) =>
			String(c[0]).includes("could not reconcile configs")
		)
	} finally {
		warn.mockRestore()
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-plugin-default-name-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	process.env.SP_PLUGINS_ENABLED = "1"
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { installPluginPackage } = await import("./install")
	const report = await installPluginPackage(db, TQ_DIR)
	expect(report.specs).toEqual(expect.arrayContaining([RESPOND, JUDGE]))
}, 180_000)

afterAll(async () => {
	delete process.env.SP_PLUGINS_ENABLED
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the shipped default beside a package's own config", () => {
	let coreBefore: Awaited<ReturnType<typeof coreSnapshot>>

	it("boot reconciles both Twenty Questions specs with no collision", async () => {
		coreBefore = await coreSnapshot()
		expect(await reconcileWarnings()).toEqual([])

		for (const slug of [RESPOND, JUDGE]) {
			const rows = (await configsOf(slug)) as any[]
			const shipped = rows.find(
				(r) => r.seedKey === `pipeline-default:${slug}`
			)
			const pkg = rows.find((r) =>
				String(r.seedKey ?? "").startsWith(`plugin:${PLUGIN}:`)
			)
			expect(shipped, `${slug} has its pipeline-default row`).toBeTruthy()
			expect(pkg, `${slug} keeps the package's config`).toBeTruthy()
			expect(pkg.name).toBe("Twenty Questions")
			expect(shipped.name).not.toBe(pkg.name)
			expect(shipped.isImmutable).toBe(true)
		}
	}, 120_000)

	it("leaves core's shipped defaults exactly as they were", async () => {
		expect(await coreSnapshot()).toEqual(coreBefore)
	})

	it("is idempotent: a second boot adds, renames and removes nothing", async () => {
		const before = [
			...((await configsOf(RESPOND)) as any[]),
			...((await configsOf(JUDGE)) as any[])
		].map((r) => [r.id, r.seedKey, r.name])
		expect(await reconcileWarnings()).toEqual([])
		const after = [
			...((await configsOf(RESPOND)) as any[]),
			...((await configsOf(JUDGE)) as any[])
		].map((r) => [r.id, r.seedKey, r.name])
		expect(after).toEqual(before)
	}, 120_000)

	it("never renames a person's config that took the name the default would pick", async () => {
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, JUDGE))
		// Drop the shipped default so the next boot seeds it again, with a
		// person's own configs already holding every name it might reach for
		// first.
		await db
			.delete(schema.pipelineConfigs)
			.where(
				eq(schema.pipelineConfigs.seedKey, `pipeline-default:${JUDGE}`)
			)
		const taken = (await configsOf(JUDGE)).map((r: any) => r.name as string)
		const { defaultConfigNameCandidates } = await import(
			"$lib/server/pipelines/config/named"
		)
		const names = defaultConfigNameCandidates("Twenty Questions")
		const firstTwo = [names.next().value, names.next().value]
		const mine: number[] = []
		for (const name of firstTwo)
			if (!taken.includes(name))
				mine.push(
					(
						await db
							.insert(schema.pipelineConfigs)
							.values({
								specId: spec!.id,
								name,
								isImmutable: false,
								isDefault: false
							})
							.returning({ id: schema.pipelineConfigs.id })
					)[0]!.id
				)
		const before = (await configsOf(JUDGE)).filter((r: any) =>
			mine.includes(r.id)
		)

		expect(await reconcileWarnings()).toEqual([])

		const rows = (await configsOf(JUDGE)) as any[]
		for (const b of before) {
			const now = rows.find((r) => r.id === b.id)
			expect(now?.name).toBe(b.name)
			expect(now?.seedKey ?? null).toBeNull()
		}
		const shipped = rows.find(
			(r) => r.seedKey === `pipeline-default:${JUDGE}`
		)
		expect(shipped).toBeTruthy()
		expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length)
	}, 120_000)
})
