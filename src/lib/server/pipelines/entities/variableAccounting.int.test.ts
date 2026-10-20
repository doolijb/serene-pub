/**
 * A spec's own `renders`, end to end (owner rulings 2026-10-13, ★2 ★5).
 *
 * The reply spec is re-saved with its Assemble node saying what `currentDate`
 * means — a plugin's plain string rather than core's date parts. The stored
 * document must read back with it (the hash covers it), the panel must offer
 * that variable's layouts, the run must hand the render that variable, and a
 * pick made while the key meant core's variable must stop applying.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { definePluginVariable, resolveConfig } from "@serene-pub/sdk"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { renderVariable } from "$lib/server/pipelines/entities/variableLayouts"

const PLAIN_DATE = definePluginVariable("acme", {
	id: "acme:var/plain-date@1",
	scope: { currentDate: { type: "string" } },
	sample: "the third day of Thaw"
}).id

let db: TestDb
let versionId: number
let plantedConfigId: number
let plantedRowId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { loadDocument, saveDocument } = await import("$lib/server/pipelines/boot/store")
	const { resolveSelectedConfig } = await import("$lib/server/pipelines/config/named")

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))

	// A pick made while `currentDate` still means core's variable: the shipped
	// "Numeric" row, written straight into the selected configuration.
	const [numeric] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(
			and(
				eq(schema.pipelineVariableTemplates.variableId, "core:var/current-date@1"),
				eq(schema.pipelineVariableTemplates.name, "Numeric")
			)
		)
	const selected = await resolveSelectedConfig(db, spec!.id, STORY_RESPOND_SPEC_ID, {})
	plantedConfigId = selected!.configId
	plantedRowId = numeric!.id
	const at = and(
		eq(schema.pipelineConfigValues.configId, selected!.configId),
		eq(schema.pipelineConfigValues.nodeKey, "prompt"),
		eq(schema.pipelineConfigValues.slot, "variables"),
		eq(schema.pipelineConfigValues.path, "currentDate")
	)
	const [stored] = await db.select().from(schema.pipelineConfigValues).where(at)
	if (stored)
		await db.update(schema.pipelineConfigValues).set({ value: numeric!.id }).where(at)
	else
		await db.insert(schema.pipelineConfigValues).values({
			configId: selected!.configId,
			nodeKey: "prompt",
			slot: "variables",
			path: "currentDate",
			value: numeric!.id
		})

	const doc = await loadDocument(db, spec!.activeVersionId!)
	const repointed = {
		...doc,
		nodes: doc.nodes.map((n) =>
			n.key === "prompt" ? { ...n, renders: { currentDate: PLAIN_DATE } } : n
		)
	}
	const { canonicalHash } = await import("@serene-pub/sdk")
	const saved = await saveDocument(db, repointed, { publish: true })
	expect(saved.written).toBe(true)
	// The node's `renders` is part of the document's identity.
	expect(saved.canonicalHash).not.toBe(canonicalHash(doc))
	expect(saved.canonicalHash).toBe(canonicalHash(repointed))
	versionId = saved.specVersionId
}, 120_000)

describe("a spec's renders, stored and read back", () => {
	it("the document reads back with the node's renders", async () => {
		const { loadDocument } = await import("$lib/server/pipelines/boot/store")
		const doc = await loadDocument(db, versionId)
		expect(doc.nodes.find((n) => n.key === "prompt")!.renders).toEqual({
			currentDate: PLAIN_DATE
		})
	}, 60_000)

	it("the panel's option for the key names the spec's variable", async () => {
		const { declarations } = await import("$lib/server/pipelines/config/panel/declarations")
		const decls = await declarations(db, versionId)
		const option = decls.find(
			(d) => d.nodeKey === "prompt" && d.slot === "variables" && d.path === "currentDate"
		)
		expect(option?.variableId).toBe(PLAIN_DATE)
		// The other keys still mean core's.
		expect(
			decls.find((d) => d.nodeKey === "prompt" && d.path === "worldLore")?.variableId
		).toBe("core:var/world-lore@1")
	}, 60_000)

	it("the run hands the render the spec's variable, and drops the pick made for core's", async () => {
		const world = await buildWorld(db, { specId: STORY_RESPOND_SPEC_ID })
		const layouts = (resolveConfig(world, ["prompt"]).prompt?.variables ?? {}) as any
		expect(layouts.currentDate?.variableId).toBe(PLAIN_DATE)
		// The "Numeric" row was core's layout for core's date parts. It no
		// longer applies to what the key means, so no source arrives…
		expect(layouts.currentDate?.source).toBeUndefined()
		// …and the plugin's own floor renders the value as written.
		expect(
			await renderVariable(layouts, "currentDate", "the third day of Thaw")
		).toBe("the third day of Thaw")
		expect(layouts.worldLore?.variableId).toBe("core:var/world-lore@1")
	}, 60_000)

	it("reconciling culls the pick made for core's variable, with a notice", async () => {
		const { reconcileConfigs } = await import("$lib/server/pipelines/config/named")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		await reconcileConfigs(db, spec!.id, versionId, STORY_RESPOND_SPEC_ID)
		const left = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, plantedConfigId),
					eq(schema.pipelineConfigValues.nodeKey, "prompt"),
					eq(schema.pipelineConfigValues.path, "currentDate")
				)
			)
		expect(left.map((r: { value: unknown }) => r.value)).not.toContain(plantedRowId)
		const notices = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(
				and(
					eq(schema.pipelineConfigNotices.configId, plantedConfigId),
					eq(schema.pipelineConfigNotices.kind, "culled"),
					eq(schema.pipelineConfigNotices.path, "currentDate")
				)
			)
		expect(notices.map((n: { previousValue: unknown }) => n.previousValue)).toContain(plantedRowId)
	}, 60_000)

	it("a preset naming core's row for the re-pointed key is not culled and written back on every boot", async () => {
		const { reconcileConfigs } = await import("$lib/server/pipelines/config/named")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		const [numeric] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, plantedRowId))
		// The author's default preset still names core's "Numeric" row by seed key.
		let [preset] = await db
			.select()
			.from(schema.pipelinePresets)
			.where(
				and(
					eq(schema.pipelinePresets.specVersionId, versionId),
					eq(schema.pipelinePresets.isDefault, true)
				)
			)
		if (!preset)
			[preset] = await db
				.insert(schema.pipelinePresets)
				.values({ specVersionId: versionId, slug: "stale", label: "Stale", isDefault: true })
				.returning()
		await db.insert(schema.pipelinePresetValues).values({
			presetId: preset!.id,
			nodeKey: "prompt",
			slot: "variables",
			path: "currentDate",
			value: { seedKey: numeric!.seedKey }
		})

		const noticesAt = async () =>
			(
				await db
					.select()
					.from(schema.pipelineConfigNotices)
					.where(eq(schema.pipelineConfigNotices.path, "currentDate"))
			).length
		await reconcileConfigs(db, spec!.id, versionId, STORY_RESPOND_SPEC_ID)
		const afterFirst = await noticesAt()
		await reconcileConfigs(db, spec!.id, versionId, STORY_RESPOND_SPEC_ID)
		// A second boot says nothing new about the address…
		expect(await noticesAt()).toBe(afterFirst)
		// …and no configuration holds core's row for a key that means the plugin's.
		const picks = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.nodeKey, "prompt"),
					eq(schema.pipelineConfigValues.path, "currentDate")
				)
			)
		const forThisSpec = picks.filter((r: { configId: number }) => r.configId === plantedConfigId)
		expect(forThisSpec.map((r: { value: unknown }) => r.value)).not.toContain(plantedRowId)
	}, 60_000)
})

