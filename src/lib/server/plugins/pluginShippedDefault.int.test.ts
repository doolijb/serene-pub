/**
 * A plugin spec's shipped default is the config its OWN package ships for it.
 *
 * Found on the Twenty Questions showcase: the Submit guess action's judge ran
 * generic instructions although the package shipped a judging config. Boot's
 * `reconcilePublishedConfigs` seeds a `pipeline-default:<slug>` row for EVERY
 * published spec (the reconcile base — deliberately, see `seed.ts`), and
 * `shippedDefault` looked that key up first, so the declaration-only row beat
 * the package's own. An action spec has no preset binding to carry a config,
 * so the shipped default is the only way its prose reaches a run.
 *
 * Pinned: the package's config wins as `shipped`; with several, the manifest's
 * first; a selection still overrides it; core specs are unchanged.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { spec, compile } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { projectPluginPackage } from "$lib/server/plugins/install"
import {
	pluginConfigSeedKey,
	syncPluginPresets
} from "$lib/server/pipelines/boot/registrySync"
import { reconcilePublishedConfigs } from "$lib/server/pipelines/boot/seed"
import {
	resolveSelectedConfig,
	selectConfig
} from "$lib/server/pipelines/config/named"
import type { PluginPackage } from "$lib/server/plugins/pluginPackage"

let db: TestDb

const PLUGIN = "acme.guess"
const JUDGE = `${PLUGIN}:spec/judge-guess`
const MULTI = `${PLUGIN}:spec/multi`
const CORE_RESPOND = "core:spec/respond"

const doc = (id: string) =>
	compile(
		spec(id, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.build()
	)

const prompt = (systemPrompt: string) => ({
	history: { prompts: { systemPrompt } }
})

const pkg: PluginPackage = {
	dir: "/nowhere",
	files: [],
	documents: [doc(JUDGE), doc(MULTI)],
	manifest: {
		schemaVersion: 1,
		slug: PLUGIN,
		name: "Guess",
		version: "0.1.0",
		pipelines: [{ id: JUDGE }, { id: MULTI }],
		configs: [
			{ spec: JUDGE, slug: "judging", label: "Judging", values: prompt("Judge.") },
			// Two for one spec: the manifest's first is the default. Declared
			// out of alphabetical order so neither slug nor label decides it.
			{ spec: MULTI, slug: "zeta", label: "Zeta", values: prompt("Z.") },
			{ spec: MULTI, slug: "alpha", label: "Alpha", values: prompt("A.") }
		]
	}
}

const specRow = async (slug: string) =>
	(
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
			.limit(1)
	)[0]!.id

const configId = async (seedKey: string) =>
	(
		await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.seedKey, seedKey))
			.limit(1)
	)[0]?.id

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	await db.insert(schema.plugins).values({
		pluginId: PLUGIN,
		name: "Guess",
		bundleSource: "//",
		bundleHash: "sha256:test",
		backends: ["quickjs"],
		backend: "quickjs",
		enabled: true,
		manifest: pkg.manifest as Record<string, unknown>
	})
	const report = await projectPluginPackage(db, pkg)
	expect(report.refused).toEqual([])
	await syncPluginPresets(db)
	// The next boot: seeds `pipeline-default:<slug>` for the plugin's specs.
	await reconcilePublishedConfigs(db)
}, 120_000)

describe("a plugin spec's shipped default", () => {
	it("is the config its own package ships, even beside a pipeline-default row", async () => {
		const id = await specRow(JUDGE)
		expect(
			await configId(`pipeline-default:${JUDGE}`),
			"the boot reconcile base still exists"
		).toBeTruthy()
		const shipped = await configId(pluginConfigSeedKey(PLUGIN, JUDGE, "judging"))
		const r = await resolveSelectedConfig(db, id, JUDGE)
		expect(r).toEqual({ configId: shipped, name: "Judging", source: "shipped" })
	})

	it("is the manifest's first when the package ships several", async () => {
		const r = await resolveSelectedConfig(db, await specRow(MULTI), MULTI)
		expect(r?.configId).toBe(
			await configId(pluginConfigSeedKey(PLUGIN, MULTI, "zeta"))
		)
		expect(r?.source).toBe("shipped")
	})

	it("still loses to an instance selection", async () => {
		const id = await specRow(JUDGE)
		const base = await configId(`pipeline-default:${JUDGE}`)
		await selectConfig(db, id, "pub", 0, base!)
		try {
			const r = await resolveSelectedConfig(db, id, JUDGE)
			expect(r).toMatchObject({ configId: base, source: "pub" })
		} finally {
			await selectConfig(db, id, "pub", 0, null)
		}
	})

	it("leaves core specs on their pipeline-default rows", async () => {
		const r = await resolveSelectedConfig(
			db,
			await specRow(CORE_RESPOND),
			CORE_RESPOND
		)
		expect(r?.configId).toBe(await configId(`pipeline-default:${CORE_RESPOND}`))
		expect(r?.source).toBe("shipped")
	})
})
