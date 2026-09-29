/**
 * A package's shipped configs, as rows its preset binds to.
 *
 * Found on a live walk of the Twenty Questions showcase: the preset said
 * "shipped default" and the referee ran core's narrator instructions. Two
 * faults, and each hid the other:
 *
 *  · `syncPluginPresets` dropped a binding's `config`, so no preset ever
 *    pointed at the row install wrote;
 *  · install keyed a config `plugin:<id>:<slug>`, but a config slug is unique
 *    **per spec** (the SDK's `configFindings`, and `PresetBinding.config` is
 *    "a config slug of that spec"). Two specs shipping `…-default` collided on
 *    one key, and the second moved the first's row onto its own spec — so the
 *    respond spec's referee prompt existed nowhere.
 *
 * Pinned here: both configs land as their own rows, the preset binds to the
 * one it names, a re-install is idempotent, a person's config survives it, and
 * nothing is written at a fixed id.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq, like } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { spec, compile } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"
import { projectPluginPackage } from "$lib/server/plugins/install"
import {
	pluginConfigSeedKey,
	syncPluginPresets
} from "$lib/server/pipelines/boot/registrySync"
import type { PluginPackage } from "$lib/server/plugins/pluginPackage"

let db: TestDb

const PLUGIN = "acme.quiz"
const RESPOND = `${PLUGIN}:spec/respond`
const JUDGE = `${PLUGIN}:spec/judge-guess`
const SHARED_SLUG = "quiz-default"
const PRESET_KEY = `plugin:${PLUGIN}:quiz`
const RESPOND_EVENT = "core:event/message-respond@1"

const doc = (id: string) =>
	compile(
		spec(id, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.build()
	)

const pkg = (
	respondPrompt = "You are the referee.",
	judgePrompt = "You are the character."
): PluginPackage => ({
	dir: "/nowhere",
	files: [],
	documents: [doc(RESPOND), doc(JUDGE)],
	manifest: {
		schemaVersion: 1,
		slug: PLUGIN,
		name: "Quiz",
		version: "0.1.0",
		pipelines: [{ id: RESPOND }, { id: JUDGE }],
		// The same slug over two specs — legal, and what the showcase ships.
		configs: [
			{
				spec: RESPOND,
				slug: SHARED_SLUG,
				label: "Quiz",
				values: { history: { prompts: { systemPrompt: respondPrompt } } }
			},
			{
				spec: JUDGE,
				slug: SHARED_SLUG,
				label: "Quiz",
				values: { history: { prompts: { systemPrompt: judgePrompt } } }
			}
		],
		presets: [
			{
				slug: "quiz",
				genre: `${PLUGIN}:genre/quiz`,
				label: "Quiz",
				bindings: {
					[RESPOND_EVENT]: { spec: RESPOND, config: SHARED_SLUG }
				}
			}
		]
	}
})

const installRow = async (manifest: Record<string, unknown>) =>
	db
		.insert(schema.plugins)
		.values({
			pluginId: PLUGIN,
			name: "Quiz",
			bundleSource: "//",
			bundleHash: "sha256:test",
			backends: ["quickjs"],
			backend: "quickjs",
			enabled: true,
			manifest
		})
		.onConflictDoUpdate({
			target: schema.plugins.pluginId,
			set: { enabled: true, manifest }
		})

/** Install, then the preset sync the app runs after it. */
const install = async (p: PluginPackage = pkg()) => {
	await installRow(p.manifest as Record<string, unknown>)
	const report = await projectPluginPackage(db, p)
	await syncPluginPresets(db)
	return report
}

const configBySeed = async (seedKey: string) =>
	(
		await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.seedKey, seedKey))
			.limit(1)
	)[0] as any

const valuesOf = async (configId: number) =>
	db
		.select({
			nodeKey: schema.pipelineConfigValues.nodeKey,
			slot: schema.pipelineConfigValues.slot,
			value: schema.pipelineConfigValues.value
		})
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.configId, configId))

const specId = async (slug: string) =>
	(
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
			.limit(1)
	)[0]!.id

const presetRow = async () =>
	(
		await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, PRESET_KEY))
			.limit(1)
	)[0] as any

let bystander: { id: number; row: unknown }

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	// A config somebody made before the package arrived, sitting at the next
	// id the sequence hands out. A seed written at a fixed id is exactly what
	// overwrote a person's sampling config once; this row must not move.
	const [respondCore] = await db
		.select({ specId: schema.pipelineConfigs.specId })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, "pipeline-default:core:spec/respond"))
		.limit(1)
	const [mine] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: respondCore!.specId, name: "Mine", isImmutable: false })
		.returning()
	bystander = { id: mine!.id, row: mine }

	await install()
}, 120_000)

describe("a plugin's shipped configs", () => {
	it("lands each spec's config as its own row, even when the slugs match", async () => {
		const respond = await configBySeed(pluginConfigSeedKey(PLUGIN, RESPOND, SHARED_SLUG))
		const judge = await configBySeed(pluginConfigSeedKey(PLUGIN, JUDGE, SHARED_SLUG))
		expect(respond, "respond's config must exist").toBeTruthy()
		expect(judge, "judge-guess's config must exist").toBeTruthy()
		expect(respond.id).not.toBe(judge.id)
		expect(respond.specId).toBe(await specId(RESPOND))
		expect(judge.specId).toBe(await specId(JUDGE))

		expect((await valuesOf(respond.id))[0]?.value).toEqual({
			systemPrompt: "You are the referee."
		})
		expect((await valuesOf(judge.id))[0]?.value).toEqual({
			systemPrompt: "You are the character."
		})
	})

	it("binds the preset to the config it names, not the shipped default", async () => {
		const respond = await configBySeed(pluginConfigSeedKey(PLUGIN, RESPOND, SHARED_SLUG))
		const preset = await presetRow()
		expect(preset.bindings[RESPOND_EVENT]).toEqual({
			spec: RESPOND,
			config: respond.id
		})
	})

	it("writes nothing at a fixed id: a person's row at the next id is untouched", async () => {
		const [after] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, bystander.id))
		expect(after).toEqual(bystander.row)
		const shipped = await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, `plugin:${PLUGIN}:%`))
		expect(shipped).toHaveLength(2)
		for (const r of shipped) expect(r.id).toBeGreaterThan(bystander.id)
	})

	it("is idempotent across a re-install: same rows, same binding", async () => {
		const before = await db
			.select({ id: schema.pipelineConfigs.id, seedKey: schema.pipelineConfigs.seedKey })
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, `plugin:${PLUGIN}:%`))
		const binding = (await presetRow()).bindings[RESPOND_EVENT]

		await install()

		const after = await db
			.select({ id: schema.pipelineConfigs.id, seedKey: schema.pipelineConfigs.seedKey })
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, `plugin:${PLUGIN}:%`))
		expect(after.sort((a, b) => a.id - b.id)).toEqual(
			before.sort((a, b) => a.id - b.id)
		)
		expect((await presetRow()).bindings[RESPOND_EVENT]).toEqual(binding)
	})

	it("ships an update's new values into the shipped row, which nobody can edit", async () => {
		await install(pkg("You are the referee, v2."))
		const respond = await configBySeed(pluginConfigSeedKey(PLUGIN, RESPOND, SHARED_SLUG))
		expect(respond.isImmutable).toBe(true)
		expect((await valuesOf(respond.id))[0]?.value).toEqual({
			systemPrompt: "You are the referee, v2."
		})
	})

	it("never overwrites a person's config across a re-install or an update", async () => {
		const respondSpec = await specId(RESPOND)
		// The route a person takes: duplicate the shipped config, edit the copy.
		const [copy] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: respondSpec, name: "My referee", isImmutable: false })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: copy!.id,
			nodeKey: "history",
			slot: "prompts",
			path: "",
			value: { systemPrompt: "My own referee." }
		})
		// And a shipped row somebody has made editable and changed.
		const judge = await configBySeed(pluginConfigSeedKey(PLUGIN, JUDGE, SHARED_SLUG))
		await db
			.update(schema.pipelineConfigs)
			.set({ isImmutable: false, name: "Judge, edited" })
			.where(eq(schema.pipelineConfigs.id, judge.id))
		await db
			.update(schema.pipelineConfigValues)
			.set({ value: { systemPrompt: "Edited judge." } })
			.where(eq(schema.pipelineConfigValues.configId, judge.id))

		await install(pkg("You are the referee, v3.", "You are the character, v3."))

		expect((await valuesOf(copy!.id))[0]?.value).toEqual({
			systemPrompt: "My own referee."
		})
		const judgeAfter = await configBySeed(pluginConfigSeedKey(PLUGIN, JUDGE, SHARED_SLUG))
		expect(judgeAfter.id).toBe(judge.id)
		expect(judgeAfter.name).toBe("Judge, edited")
		expect((await valuesOf(judge.id))[0]?.value).toEqual({
			systemPrompt: "Edited judge."
		})
	})

	it("adopts a row keyed by the old spelling for its own spec, never another's", async () => {
		// What the previous install left: one row under `plugin:<id>:<slug>`,
		// moved onto whichever spec was declared last (judge-guess).
		const legacyKey = `plugin:${PLUGIN}:legacy`
		const judgeSpec = await specId(JUDGE)
		const [legacy] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: judgeSpec, seedKey: legacyKey, name: "Legacy", isImmutable: true })
			.returning()
		const p = pkg()
		p.manifest.configs = [
			{ spec: RESPOND, slug: "legacy", label: "Legacy respond", values: {} },
			{ spec: JUDGE, slug: "legacy", label: "Legacy judge", values: {} }
		]
		await install(p)

		const judge = await configBySeed(pluginConfigSeedKey(PLUGIN, JUDGE, "legacy"))
		const respond = await configBySeed(pluginConfigSeedKey(PLUGIN, RESPOND, "legacy"))
		expect(judge.id, "the judge's row is the one the old key held").toBe(legacy!.id)
		expect(respond.id).not.toBe(legacy!.id)
		expect(respond.specId).toBe(await specId(RESPOND))
		expect(await configBySeed(legacyKey)).toBeUndefined()
	})

	it("moves an untouched preset onto the config an update binds", async () => {
		const p = pkg()
		p.manifest.configs = [
			...(p.manifest.configs as any[]),
			{ spec: RESPOND, slug: "quiz-loud", label: "Loud", values: {} }
		]
		;(p.manifest.presets as any[])[0].bindings = {
			[RESPOND_EVENT]: { spec: RESPOND, config: "quiz-loud" }
		}
		await install(p)
		const loud = await configBySeed(pluginConfigSeedKey(PLUGIN, RESPOND, "quiz-loud"))
		expect((await presetRow()).bindings[RESPOND_EVENT]).toEqual({
			spec: RESPOND,
			config: loud.id
		})
	})

	it("keeps a person's rebinding to their own config across a re-install and an update", async () => {
		// The defect: the sync rewrote every preset's bindings, so pointing a
		// plugin preset at your own config lasted until the next boot.
		const [own] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: await specId(RESPOND), name: "My quiz", isImmutable: false })
			.returning()
		const mine = { [RESPOND_EVENT]: { spec: RESPOND, config: own!.id } }
		// Made theirs, as a shipped config is: no longer immutable.
		await db
			.update(schema.sessionPresets)
			.set({ isImmutable: false, bindings: mine })
			.where(eq(schema.sessionPresets.seedKey, PRESET_KEY))

		await install()
		expect((await presetRow()).bindings).toEqual(mine)
		await install(pkg("You are the referee, v5."))
		expect((await presetRow()).bindings).toEqual(mine)
	})
})
