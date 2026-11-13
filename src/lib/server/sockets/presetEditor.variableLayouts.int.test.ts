/**
 * A preset's variable layouts over the socket (PLAN variable-layouts
 * 2026-11-10, W6): read with what the pub would use, set and clear by
 * reference, refused on a preset written in code, a copy carrying them, and the
 * preset list's computed notice for an entry that names no layout now.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const WORLD_LORE = "core:var/world-lore@1"
const GENRE = "core:genre/story"

let db: TestDb
let dataDir: string
let admin: { id: number }
let member: { id: number }
let presetId: number
let declaredId: number
let proseId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "preset-variable-layouts-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-preset-variable-layouts-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await (
		await import("$lib/server/pipelines/boot/bootstrap")
	).bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = await createTestUser(db, "layouts-admin")
	member = await createTestUser(db, "layouts-member")
	await db
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
	const { createVariableTemplate } = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	proseId = (
		await createVariableTemplate(db as any, {
			variableId: WORLD_LORE,
			name: "Prose",
			source: "{{{json value}}}",
			reference: { ownerSlug: "acme", slug: "prose" }
		})
	).id
	const [preset] = await db
		.insert(schema.sessionPresets)
		.values({ name: "Small model", genreId: GENRE })
		.returning()
	presetId = preset!.id
	const [declared] = await db
		.insert(schema.sessionPresets)
		.values({
			name: "Shipped",
			genreId: GENRE,
			seedKey: "plugin:acme:shipped",
			isImmutable: true
		})
		.returning()
	declaredId = declared!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin: boolean) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const call = async (name: string, isAdmin: boolean, params: any) => {
	const handlers = await import("./presetEditor")
	const seen: Array<[string, any]> = []
	const res: any = await (handlers as any)[name].handler(
		socketFor(isAdmin ? admin.id : member.id, isAdmin),
		params,
		(event: string, data: any) => seen.push([event, data])
	)
	return { res, seen }
}
const read = (id = presetId) =>
	call("pipelinesPresetVariableLayoutsHandler", true, { presetId: id })
const set = (reference: string | null, extra: object = {}, id = presetId) =>
	call("pipelinesSetPresetVariableLayoutHandler", true, {
		presetId: id,
		variableId: WORLD_LORE,
		reference,
		...extra
	})

describe("pipelines:presetVariableLayouts, :setPresetVariableLayout", () => {
	test("a member is refused both", async () => {
		expect(
			(
				await call("pipelinesPresetVariableLayoutsHandler", false, {
					presetId
				})
			).res.error
		).toMatch(/Only an administrator/)
		expect(
			(
				await call("pipelinesSetPresetVariableLayoutHandler", false, {
					presetId
				})
			).res.error
		).toMatch(/Only an administrator/)
	}, 60_000)

	test("a preset states nothing by default", async () => {
		const { res, seen } = await read()
		expect(res).toEqual({
			presetId,
			editable: true,
			rows: [],
			dangling: [],
			candidates: expect.any(Array)
		})
		expect(seen).toEqual([["pipelines:presetVariableLayouts", res]])
		const missing = await read(999999)
		expect(missing.res.error).toMatch(/no such preset/)
	}, 60_000)

	test("candidates are exactly the variables this preset's pipelines render", async () => {
		const { res } = await read()
		const candidates = res.candidates as string[]
		expect(candidates.length).toBeGreaterThan(0)
		expect([...candidates].sort()).toEqual(candidates)
		expect(new Set(candidates).size).toBe(candidates.length)

		const { genreRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const { declarationsAndVariableKeys } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const registered = new Set(
			((await genreRegistrations(db as any, GENRE)) as any[]).map(
				(r) => r.pipeline as string
			)
		)
		const rendered = async (inSet: boolean) => {
			const out = new Set<string>()
			for (const spec of await db.select().from(schema.pipelineSpecs)) {
				if (!spec.activeVersionId || registered.has(spec.slug) !== inSet)
					continue
				const { variableKeys } = await declarationsAndVariableKeys(
					db as any,
					spec.activeVersionId
				)
				for (const k of variableKeys) out.add(k.variableId)
			}
			return out
		}
		expect(candidates).toEqual([...(await rendered(true))].sort())
		// A variable only a pipeline this preset doesn't register renders is absent.
		const elsewhere = [...(await rendered(false))].filter(
			(v) => !candidates.includes(v)
		)
		expect(elsewhere.length).toBeGreaterThan(0)
		for (const v of elsewhere) expect(candidates).not.toContain(v)
		// The write's answer carries them too.
		const wrote = await set("acme/prose@1")
		expect(wrote.res.candidates).toEqual(candidates)
		await set(null)
	}, 60_000)

	test("sets one by reference; the row names the layout and what the pub would use", async () => {
		const { res, seen } = await set("acme/prose@1")
		expect(res.error).toBeUndefined()
		expect(
			seen.some(([e]) => e === "pipelines:setPresetVariableLayout")
		).toBe(true)
		expect(res.editable).toBe(true)
		expect(res.dangling).toEqual([])
		expect(res.rows).toEqual([
			{
				variableId: WORLD_LORE,
				variableLabel: expect.any(String),
				reference: "acme/prose@1",
				templateId: proseId,
				layoutName: "Prose",
				// No pub's layout chosen: the package default stands in, marked so.
				pubLayout: {
					templateId: expect.any(Number),
					name: expect.any(String),
					chosen: false
				}
			}
		])
		const [row] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
		expect(row!.variableLayouts).toEqual({ [WORLD_LORE]: "acme/prose@1" })
	}, 60_000)

	test("says what the pub chose once it has", async () => {
		const { setPubLayout, layoutByReference } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const { createVariableTemplate } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const pub = await createVariableTemplate(db as any, {
			variableId: WORLD_LORE,
			name: "Pub choice",
			source: "{{{json value}}}"
		})
		await setPubLayout(db as any, WORLD_LORE, pub.id)
		const { res } = await read()
		expect(res.rows[0].pubLayout).toEqual({
			templateId: pub.id,
			name: "Pub choice",
			chosen: true
		})
		await setPubLayout(db as any, WORLD_LORE, null)
		expect(
			await layoutByReference(db as any, WORLD_LORE, "acme/prose@1")
		).toBe(proseId)
	}, 60_000)

	test("refuses an unknown variable, a malformed reference and one no layout goes by", async () => {
		const unknown = await set("acme/prose@1", {
			variableId: "core:var/not-a-thing@1"
		})
		expect(unknown.res.error).toMatch(/not a variable this pub knows/)
		const malformed = await set("Prose")
		expect(malformed.res.error).toMatch(/not a variable layout reference/)
		// A layout with no reference can't be picked: its reference doesn't exist yet.
		const bare = await set("acme/never-stamped@1")
		expect(bare.res.error).toMatch(/given one first/)
		expect((await read()).res.rows).toHaveLength(1)
	}, 60_000)

	test("refuses a preset written in code, for both events' view and write", async () => {
		const { res } = await set("acme/prose@1", {}, declaredId)
		expect(res.error).toMatch(/ships ready-made/)
		const view = await read(declaredId)
		expect(view.res.editable).toBe(false)
	}, 60_000)

	test("a reference that names nothing now is listed as dangling, in the view and in the preset list", async () => {
		await db
			.update(schema.sessionPresets)
			.set({ variableLayouts: { [WORLD_LORE]: "gone/removed@1" } })
			.where(eq(schema.sessionPresets.id, presetId))
		const { res } = await read()
		expect(res.dangling).toEqual([
			{ variableId: WORLD_LORE, reference: "gone/removed@1" }
		])
		expect(res.rows[0]).toMatchObject({
			reference: "gone/removed@1",
			templateId: null,
			layoutName: null
		})

		const { sessionPresetsList } = await import("./sessionAdmin")
		const list: any = await sessionPresetsList.handler(
			socketFor(admin.id, true),
			{} as any,
			() => {}
		)
		const row = list.presets.find((p: any) => p.id === presetId)
		expect(row.danglingVariableLayouts).toEqual([
			{ variableId: WORLD_LORE, reference: "gone/removed@1" }
		])
		expect(
			list.presets.find((p: any) => p.id === declaredId)
				.danglingVariableLayouts
		).toBeUndefined()
		await db
			.update(schema.sessionPresets)
			.set({ variableLayouts: { [WORLD_LORE]: "acme/prose@1" } })
			.where(eq(schema.sessionPresets.id, presetId))
	}, 60_000)

	test("copying a preset carries its variable layouts", async () => {
		const { sessionPresetsCreate } = await import("./sessionAdmin")
		const res: any = await sessionPresetsCreate.handler(
			socketFor(admin.id, true),
			{
				name: "Small model (copy)",
				genreId: GENRE,
				fromPresetId: presetId
			} as any,
			() => {}
		)
		expect(res.error).toBeUndefined()
		const [copy] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, res.preset.id))
		expect(copy!.variableLayouts).toEqual({ [WORLD_LORE]: "acme/prose@1" })
		// A copy of a declared preset is a person's own preset and can be edited.
		const from: any = await sessionPresetsCreate.handler(
			socketFor(admin.id, true),
			{
				name: "Shipped (copy)",
				genreId: GENRE,
				fromPresetId: declaredId
			} as any,
			() => {}
		)
		expect((await read(from.preset.id)).res.editable).toBe(true)
	}, 60_000)

	test("clears one, and refuses clearing what the preset doesn't state", async () => {
		const { res } = await set(null)
		expect(res.error).toBeUndefined()
		expect(res.rows).toEqual([])
		const [row] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
		expect(row!.variableLayouts).toEqual({})
		const again = await set(null)
		expect(again.res.error).toMatch(/no variable layout of its own/)
	}, 60_000)
})
