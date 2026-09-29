/**
 * A plugin's VARIABLES reach the host (typed templates, P7 live-walk defect,
 * 2026-09-27).
 *
 * `definePluginVariable` runs only in the plugin's own process, so before the
 * manifest carried a `variables` section the app registered none: the Twenty
 * Questions bands `secretEntry` / `briefing` had no variable here, law T1
 * refused `respond` and `judge-guess` at install ("it uses secretEntry, which
 * nothing supplies here") and neither spec existed on an instance.
 *
 * Pinned over the REAL built package (`serene-pub-plugin-twenty-questions`,
 * `npm run package` first): the install publishes both specs with no T1
 * refusal, `secretEntry` is in the respond Assemble step's typed scope, the
 * variables are withdrawn on uninstall, and the boot path registers them
 * again from the stored manifest.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { getVariable } from "@serene-pub/sdk"
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
const SECRET_VAR = `${PLUGIN}:var/secret-entry@1`
const BRIEFING_VAR = `${PLUGIN}:var/briefing@1`

let db: TestDb
let dataDir: string
let report: Awaited<
	ReturnType<typeof import("./install").installPluginPackage>
>

async function registryByPin(): Promise<Map<string, any>> {
	const rows = await db.select().from(schema.pipelineDefinitionRegistry)
	return new Map<string, any>(
		(rows as any[]).map((r) => [`${r.definitionId}@${r.version}`, r])
	)
}

async function scopeAt(slug: string, nodeKey: string) {
	const [spec] = await db
		.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	expect(spec?.activeVersionId, `${slug} is published`).toBeTruthy()
	const { loadDocument } = await import("$lib/server/pipelines/boot/store")
	const doc = await loadDocument(db, spec!.activeVersionId!)
	const { templateScopeFor } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	return templateScopeFor(async () => doc, nodeKey, "template", await registryByPin())
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-plugin-variables-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	process.env.SP_PLUGINS_ENABLED = "1"
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { installPluginPackage } = await import("./install")
	report = await installPluginPackage(db, TQ_DIR)
}, 180_000)

afterAll(async () => {
	delete process.env.SP_PLUGINS_ENABLED
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("a plugin's variables, installed from the real Twenty Questions package", () => {
	it("publishes respond and judge-guess with no template-fit refusal", () => {
		const t1 = report.refused.filter((r) => /supplies here|not registered/.test(r))
		expect(t1).toEqual([])
		expect(report.specs).toEqual(expect.arrayContaining([RESPOND, JUDGE]))
	})

	it("registers the package's variables in this process", () => {
		expect(getVariable(SECRET_VAR)?.scope).toHaveProperty("secretEntry")
		expect(getVariable(BRIEFING_VAR)?.scope).toHaveProperty("briefing")
	})

	it("gives each OBJECT variable an automatic JSON layout at install (owner ruling 2026-09-27)", async () => {
		const rows = (await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.templateId, `${PLUGIN}:template/secret-entry-json@1`))) as any[]
		expect(rows.length).toBe(1)
		expect(rows[0].variableId).toBe(SECRET_VAR)
		expect(rows[0].name).toBe("JSON")
		expect(rows[0].source).toBe("{{{json secretEntry}}}")
		expect(rows[0].isImmutable).toBe(true)
		expect(rows[0].withdrawnAt).toBeNull()
		const briefing = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.variableId, BRIEFING_VAR))
		expect(briefing.map((r: any) => r.templateId)).toEqual([
			`${PLUGIN}:template/briefing-json@1`
		])
	})

	it("offers that layout in the respond pipeline's picker", async () => {
		const [prior] = await db
			.select({ enabled: schema.plugins.enabled })
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, PLUGIN))
		await db
			.update(schema.plugins)
			.set({ enabled: true })
			.where(eq(schema.plugins.pluginId, PLUGIN))
		try {
			const [spec] = await db
				.select({ id: schema.pipelineSpecs.id })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, RESPOND))
			const { choiceSets } = await import(
				"$lib/server/pipelines/config/panel/choices"
			)
			const sets = await choiceSets(db, spec!.id)
			expect(
				(sets.variableTemplatesBy.get(SECRET_VAR) ?? []).map((c) => c.label)
			).toEqual(["JSON"])
		} finally {
			await db
				.update(schema.plugins)
				.set({ enabled: !!prior?.enabled })
				.where(eq(schema.plugins.pluginId, PLUGIN))
		}
	})

	it("puts secretEntry (and briefing) in the respond Assemble step's typed scope", async () => {
		const scope = await scopeAt(RESPOND, "speakPrompt")
		expect(scope).toHaveProperty("secretEntry")
		expect(scope).toHaveProperty("briefing")
		expect((scope as any).secretEntry.description).toBeTruthy()
		const judge = await scopeAt(RESPOND, "judgePrompt")
		expect(judge).toHaveProperty("secretEntry")
	})

	it("boot registers them again from the stored manifest, before anything reads them", async () => {
		const { withdrawPluginVariables } = await import("./pluginVariables")
		// A fresh process: nothing of the plugin's in the registry.
		withdrawPluginVariables(PLUGIN)
		expect(getVariable(SECRET_VAR)).toBeUndefined()
		const { bootstrapPlugins, shutdownPlugins } = await import("./index")
		// `register()` re-checks every band on a re-declaration, so a boot that
		// registered the definitions BEFORE the variables would refuse the
		// banded ones out loud here.
		const warn = vi.spyOn(console, "warn")
		try {
			await bootstrapPlugins(db)
		} finally {
			await shutdownPlugins()
			warn.mockRestore()
		}
		const refusals = warn.mock.calls
			.map((c) => String(c[0]))
			.filter((l) => l.includes(PLUGIN) || /variable/.test(l))
		expect(refusals).toEqual([])
		expect(getVariable(SECRET_VAR)?.scope).toHaveProperty("secretEntry")
		expect(getVariable(BRIEFING_VAR)).toBeTruthy()
		const scope = await scopeAt(RESPOND, "speakPrompt")
		expect(scope).toHaveProperty("secretEntry")
		// The boot scan finds nothing to complain about in the plugin's specs.
		const { scanContextTemplateFits } = await import(
			"$lib/server/pipelines/entities/contextTemplateFit"
		)
		const scan = await scanContextTemplateFits(db)
		expect(scan.misfits ?? []).toEqual([])
	})

	it("re-registering an identical declaration is idempotent", async () => {
		const { syncPluginVariables } = await import("./pluginVariables")
		expect(await syncPluginVariables(db)).toEqual([])
		expect(await syncPluginVariables(db)).toEqual([])
		expect(getVariable(SECRET_VAR)).toBeTruthy()
	})

	it("withdraws them when the plugin is uninstalled", async () => {
		const { syncPluginVariables } = await import("./pluginVariables")
		await db.delete(schema.plugins).where(eq(schema.plugins.pluginId, PLUGIN))
		await syncPluginVariables(db)
		expect(getVariable(SECRET_VAR)).toBeUndefined()
		expect(getVariable(BRIEFING_VAR)).toBeUndefined()
	})
})
