/**
 * Resolution by variable (PLAN variable-layouts 2026-11-10, Render item 5).
 *
 * A key a `variables` slot renders is written out by, in order: a stored
 * per-step pick (a leftover ⏳), the session's preset's variable layout, the
 * pub's layout, the package default (a layout the pipeline's author named for
 * the step, else the variable's own default), and the floor. Each entry says
 * which (`reason`), so the run inspector can.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { resolveConfig } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

const WORLD_LORE = "core:var/world-lore@1"
const NODE = "prompt"

let db: TestDb
let dataDir: string
let sessionId: number
let specId: number
let versionId: number
let presetId: number
let shippedDefaultId: number
const rows: Record<string, number> = {}

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "variable-resolution-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-variable-resolution-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "variable-resolution-user", isAdmin: false })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false })
		.returning()
	sessionId = session!.id
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	specId = spec!.id
	versionId = spec!.activeVersionId!

	const { defaultVariableTemplateFor } = await import("$lib/server/pipelines/boot/seedVariableTemplates")
	shippedDefaultId = (await defaultVariableTemplateFor(db, WORLD_LORE))!
	const layout = async (name: string, reference: string, extra: object = {}) => {
		const [row] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: WORLD_LORE,
				name,
				source: `${name}: {{{json worldLore}}}`,
				reference,
				...extra
			})
			.returning()
		rows[name] = row!.id
	}
	await layout("Pub layout", "acme/pub-layout@1")
	await layout("Preset layout", "acme/preset-layout@1")
	await layout("Leftover layout", "acme/leftover@1")

	const [preset] = await db
		.insert(schema.sessionPresets)
		.values({ name: "Small model", genreId: "core:genre/story" })
		.returning()
	presetId = preset!.id
	await db
		.update(schema.sessions)
		.set({ presetId })
		.where(eq(schema.sessions.id, sessionId))
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const resolved = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, { sessionId, specId: STORY_RESPOND_SPEC_ID })
	return ((resolveConfig(world as any, [NODE]) as any)[NODE]?.variables ?? {}).worldLore as
		| { name?: string; source?: string; reason?: string; variableId?: string }
		| undefined
}
const setPreset = (variableLayouts: Record<string, string>) =>
	db.update(schema.sessionPresets).set({ variableLayouts }).where(eq(schema.sessionPresets.id, presetId))
const setPub = async (name: string | null) => {
	await db
		.update(schema.pipelineVariableTemplates)
		.set({ pubDefault: false })
		.where(eq(schema.pipelineVariableTemplates.variableId, WORLD_LORE))
	if (name)
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ pubDefault: true })
			.where(eq(schema.pipelineVariableTemplates.id, rows[name]!))
}

describe("resolution by variable", () => {
	it("lays the key out with the package default, and says so", async () => {
		const entry = await resolved()
		expect(entry?.reason).toBe("default")
		expect(entry?.variableId).toBe(WORLD_LORE)
		const [shipped] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, shippedDefaultId))
		expect(entry?.source).toBe(shipped!.source)
	}, 60_000)

	it("a variable whose default row is its automatic object layout records it as automatic", async () => {
		// Core's own world-lore has a hand-written default, so the automatic row is
		// the one a plugin's object variable gets (`<owner>:template/<name>-json@<major>`),
		// put in its place; every row comes back as it was.
		const { objectLayoutSource, objectLayoutTemplateId, OBJECT_LAYOUT_NAME } = await import(
			"$lib/server/pipelines/entities/objectVariableLayouts"
		)
		const { getVariable } = await import("@serene-pub/sdk")
		const before = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.variableId, WORLD_LORE))
		try {
			await db
				.delete(schema.pipelineVariableTemplates)
				.where(eq(schema.pipelineVariableTemplates.variableId, WORLD_LORE))
			await db.insert(schema.pipelineVariableTemplates).values({
				variableId: WORLD_LORE,
				name: OBJECT_LAYOUT_NAME,
				source: objectLayoutSource(getVariable(WORLD_LORE)!)!,
				templateId: objectLayoutTemplateId("core", WORLD_LORE)!
			})
			const entry = await resolved()
			expect(entry?.name).toBe(OBJECT_LAYOUT_NAME)
			expect(entry?.reason).toBe("automatic")
		} finally {
			await db
				.delete(schema.pipelineVariableTemplates)
				.where(eq(schema.pipelineVariableTemplates.variableId, WORLD_LORE))
			await db.insert(schema.pipelineVariableTemplates).values(before)
		}
	}, 60_000)

	it("a layout the pipeline's author named beats the variable's own default, recorded as authored", async () => {
		const [preset] = await db
			.select()
			.from(schema.pipelinePresets)
			.where(
				and(
					eq(schema.pipelinePresets.specVersionId, versionId),
					eq(schema.pipelinePresets.isDefault, true)
				)
			)
		let presetRow = preset
		if (!presetRow)
			[presetRow] = await db
				.insert(schema.pipelinePresets)
				.values({ specVersionId: versionId, slug: "authored", label: "Authored", isDefault: true })
				.returning()
		const [named] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, rows["Leftover layout"]!))
		// Name it by its template id, the spelling a document writes.
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ templateId: "acme:template/author-pick@1" })
			.where(eq(schema.pipelineVariableTemplates.id, named!.id))
		await db.insert(schema.pipelinePresetValues).values({
			presetId: presetRow!.id,
			nodeKey: NODE,
			slot: "variables",
			path: "worldLore",
			value: { templateId: "acme:template/author-pick@1" }
		})
		const entry = await resolved()
		expect(entry?.name).toBe("Leftover layout")
		expect(entry?.reason).toBe("authored")
		// Under the pub's layout, which it must not hide.
		await setPub("Pub layout")
		expect((await resolved())?.reason).toBe("pub")
		await setPub(null)
		await db
			.delete(schema.pipelinePresetValues)
			.where(
				and(
					eq(schema.pipelinePresetValues.presetId, presetRow!.id),
					eq(schema.pipelinePresetValues.path, "worldLore")
				)
			)
	}, 60_000)

	it("the pub's layout beats the default", async () => {
		await setPub("Pub layout")
		const entry = await resolved()
		expect(entry?.reason).toBe("pub")
		expect(entry?.name).toBe("Pub layout")
	}, 60_000)

	it("the preset's variable layout beats the pub's", async () => {
		await setPreset({ [WORLD_LORE]: "acme/preset-layout@1" })
		const entry = await resolved()
		expect(entry?.reason).toBe("preset")
		expect(entry?.name).toBe("Preset layout")
	}, 60_000)

	it("a preset reference that names nothing is skipped to the pub's layout, and listed", async () => {
		await setPreset({ [WORLD_LORE]: "gone/removed@1" })
		const entry = await resolved()
		expect(entry?.reason).toBe("pub")
		expect(entry?.name).toBe("Pub layout")
		const { danglingPresetLayouts } = await import("$lib/server/pipelines/config/world")
		expect(await danglingPresetLayouts(db, presetId)).toEqual([
			{ variableId: WORLD_LORE, reference: "gone/removed@1" }
		])
		await setPreset({ [WORLD_LORE]: "acme/preset-layout@1" })
		expect(await danglingPresetLayouts(db, presetId)).toEqual([])
	}, 60_000)

	it("a stored per-step pick (leftover) beats everything, and says so", async () => {
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: NODE,
			slot: "variables",
			path: "worldLore",
			value: rows["Leftover layout"]
		})
		const entry = await resolved()
		expect(entry?.reason).toBe("leftover")
		expect(entry?.name).toBe("Leftover layout")
	}, 60_000)

	it("a stored pick survives a reconcile, in the configuration it is stored in", async () => {
		const { resolveSelectedConfig, reconcileConfigs } = await import("$lib/server/pipelines/config/named")
		const selected = await resolveSelectedConfig(db, specId, STORY_RESPOND_SPEC_ID, {})
		const at = {
			configId: selected!.configId,
			nodeKey: NODE,
			slot: "variables",
			path: "worldLore"
		}
		const where = and(
			eq(schema.pipelineConfigValues.configId, at.configId),
			eq(schema.pipelineConfigValues.nodeKey, NODE),
			eq(schema.pipelineConfigValues.slot, "variables"),
			eq(schema.pipelineConfigValues.path, "worldLore")
		)
		await db.delete(schema.pipelineConfigValues).where(where)
		await db.insert(schema.pipelineConfigValues).values({ ...at, value: rows["Leftover layout"] })
		await reconcileConfigs(db, specId, versionId, STORY_RESPOND_SPEC_ID)
		await reconcileConfigs(db, specId, versionId, STORY_RESPOND_SPEC_ID)
		const left = await db.select().from(schema.pipelineConfigValues).where(where)
		expect(left.map((r: { value: unknown }) => r.value)).toEqual([rows["Leftover layout"]])
		const culled = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(
				and(
					eq(schema.pipelineConfigNotices.configId, at.configId),
					eq(schema.pipelineConfigNotices.path, "worldLore")
				)
			)
		expect(culled).toEqual([])
	}, 60_000)

	it("with no layout row at all, the key floors with the variable, and the reason is no-layout", async () => {
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.specId, specId))
		await db
			.delete(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.path, "worldLore"))
		await setPreset({})
		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.variableId, WORLD_LORE))
		const entry = await resolved()
		expect(entry).toEqual({ variableId: WORLD_LORE, engine: expect.any(String), reason: "no-layout" })
		expect(entry?.source).toBeUndefined()
	}, 60_000)
})
