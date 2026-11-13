/**
 * A declared preset's variable layouts at install and boot (PLAN
 * variable-layouts 2026-11-10, W6): `PresetDecl.variableLayouts` lands in
 * `session_presets.variable_layouts` the way `settings` and the cast floor do,
 * a malformed one is refused at install, a reference to a layout nobody has
 * installed is accepted, and a second boot changes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { eq } from "drizzle-orm"
import "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"

const FIXTURE = resolve(
	process.cwd(),
	"src/lib/server/plugins/fixtures/unified-plugin"
)
const PLUGIN = "demo.unified"
const SEED_KEY = `plugin:${PLUGIN}:tally`
const WORLD_LORE = "core:var/world-lore@1"

let db: TestDb
let dataDir: string
let pkgDir: string
let priorDataDir: string | undefined

const manifestFile = () => join(pkgDir, "dist/plugin/manifest.json")
const setPresetLayouts = async (
	variableLayouts: unknown | undefined,
	version: string
) => {
	const m = JSON.parse(await readFile(manifestFile(), "utf8"))
	m.version = version
	m.assets = {}
	for (const p of m.presets) {
		if (variableLayouts === undefined) delete p.variableLayouts
		else p.variableLayouts = variableLayouts
	}
	await writeFile(manifestFile(), JSON.stringify(m))
}
/** Installing leaves a package switched off; the boot's sync projects an enabled one's presets. */
const switchOn = () =>
	db
		.update(schema.plugins)
		.set({ enabled: true })
		.where(eq(schema.plugins.pluginId, PLUGIN))
/** The row as stored, minus the touch-time the existing sync stamps on every pass. */
const presetRow = async () => {
	const row = (
		await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, SEED_KEY))
	)[0] as any
	if (row) delete row.updatedAt
	return row
}

beforeAll(async () => {
	priorDataDir = process.env.SERENE_PUB_DATA_DIR
	process.env.SP_PLUGINS_ENABLED = "1"
	dataDir = await mkdtemp(join(tmpdir(), "sp-presetlayouts-data-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	pkgDir = await mkdtemp(join(tmpdir(), "sp-presetlayouts-src-"))
	await cp(FIXTURE, pkgDir, { recursive: true })
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 120_000)

afterAll(async () => {
	delete process.env.SP_PLUGINS_ENABLED
	if (priorDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = priorDataDir
	await rm(dataDir, { recursive: true, force: true })
	await rm(pkgDir, { recursive: true, force: true })
}, 60_000)

describe("a declared preset's variable layouts", () => {
	it("refuses a malformed one at install, writing nothing", async () => {
		const { installPluginPackage } = await import("./install")
		for (const bad of [
			{ [WORLD_LORE]: "Prose" },
			{ "not-a-variable": "acme/prose@1" },
			["acme/prose@1"]
		]) {
			await setPresetLayouts(bad, "1.0.0")
			await expect(installPluginPackage(db, pkgDir)).rejects.toThrow(
				/cannot install: .*variableLayouts/
			)
		}
		expect(await presetRow()).toBeUndefined()
	}, 60_000)

	it("lands in the column at install, a layout nobody installed accepted", async () => {
		const { installPluginPackage } = await import("./install")
		const { syncPluginPresets } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		await setPresetLayouts(
			{ [WORLD_LORE]: "acme.tally/not-installed@1" },
			"1.0.0"
		)
		await installPluginPackage(db, pkgDir)
		await switchOn()
		await syncPluginPresets(db)
		const row = await presetRow()
		expect(row.variableLayouts).toEqual({
			[WORLD_LORE]: "acme.tally/not-installed@1"
		})
		expect(row.isImmutable).toBe(true)
		// It is skipped at run time and the preset says so.
		const { danglingPresetLayouts } = await import(
			"$lib/server/pipelines/config/world"
		)
		expect(await danglingPresetLayouts(db, row.id)).toEqual([
			{ variableId: WORLD_LORE, reference: "acme.tally/not-installed@1" }
		])
	}, 60_000)

	it("a second boot changes nothing, and a re-projection keeps it in step with the declaration", async () => {
		const { syncPluginPresets } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		const { projectRegistrations } = await import(
			"$lib/server/pipelines/registrations/project"
		)
		const before = await presetRow()
		const again = await syncPluginPresets(db)
		expect(again.projected).toEqual([])
		expect(await presetRow()).toEqual(before)
		const first = await projectRegistrations(db)
		const second = await projectRegistrations(db)
		expect(second.presets.every((p) => !p.changed)).toBe(true)
		expect(first.presets.length).toBeGreaterThanOrEqual(0)
		expect(await presetRow()).toEqual(before)
		// Every core shipped preset states none.
		const core = await db.select().from(schema.sessionPresets)
		for (const r of core as any[])
			if (r.seedKey && r.ownerPluginId == null)
				expect(r.variableLayouts).toEqual({})

		// The declaration changes: the row follows it, and then holds still again.
		const { installPluginPackage } = await import("./install")
		await setPresetLayouts({ [WORLD_LORE]: "acme.tally/other@1" }, "1.1.0")
		await installPluginPackage(db, pkgDir)
		await switchOn()
		await syncPluginPresets(db)
		expect((await presetRow()).variableLayouts).toEqual({
			[WORLD_LORE]: "acme.tally/other@1"
		})
		const settled = await presetRow()
		await syncPluginPresets(db)
		expect(await presetRow()).toEqual(settled)
		// And one that states none empties it.
		await setPresetLayouts(undefined, "1.2.0")
		await installPluginPackage(db, pkgDir)
		await switchOn()
		await syncPluginPresets(db)
		expect((await presetRow()).variableLayouts).toEqual({})
	}, 60_000)
})
