/**
 * The boot pass that gives variable layouts their **layout reference**
 * (`<owner>/<slug>@<major>`; PLAN variable-layouts 2026-11-10, Data item 2):
 * core's shipped rows, core's automatic rows and a package's rows are stamped
 * where the reference is NULL; a person's rows stay NULL; a reference is never
 * rewritten; a collision leaves a row without and warns; a second boot changes
 * nothing.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { and, asc, eq, isNull } from "drizzle-orm"
import "@serene-pub/core-catalog"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { seedVariableTemplates } from "$lib/server/pipelines/boot/seedVariableTemplates"
import { syncPluginTemplates } from "$lib/server/pipelines/boot/registrySync"
import {
	coreLayoutReferenceFor,
	coreObjectLayouts
} from "$lib/server/pipelines/entities/objectVariableLayouts"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	seedKeyFor
} from "$lib/server/pipelines/entities/variableLayouts"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const CHARS = "core:var/characters@1"
const PLUGIN = "acme.dice"
const LAYOUT_ID = `${PLUGIN}:template/dice-cast@1`

let db: TestDb

const everyRow = async () =>
	(await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.orderBy(asc(schema.pipelineVariableTemplates.id))) as any[]
const referenceBySeedKey = async (seedKey: string) =>
	((await everyRow()).find((r) => r.seedKey === seedKey) ?? {}).reference as
		| string
		| null
		| undefined

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db)
})

describe("core's rows are stamped from code", () => {
	it("gives the shipped hand-written rows their fixed slugs", async () => {
		const ref = (variableId: string, variant: "wrapped" | "content") =>
			referenceBySeedKey(seedKeyFor({ variableId, variant }))
		expect(await ref(CHARS, "wrapped")).toBe("core/titled-json@1")
		expect(await ref(CHARS, "content")).toBe("core/json@1")
		expect(await ref("core:var/scenario@1", "wrapped")).toBe(
			"core/titled@1"
		)
		expect(await ref("core:var/scenario@1", "content")).toBe(
			"core/as-written@1"
		)
		expect(await ref("core:var/current-date@1", "wrapped")).toBe(
			"core/sentence@1"
		)
		expect(await ref("core:var/current-date@1", "content")).toBe(
			"core/numeric@1"
		)
		expect(await ref("core:var/recalled-lines@1", "content")).toBe(
			"core/lines@1"
		)
		expect(await ref("core:var/inflection-tag@1", "content")).toBe(
			"core/bracket-tag@1"
		)
	})

	it("gives the automatic row for a core object variable core/json@<major>", async () => {
		expect(
			await referenceBySeedKey(
				coreObjectLayouts().find(
					(t) => t.variableId === "core:var/likenesses@1"
				)!.seedKey
			)
		).toBe("core/json@1")
	})

	it("stamps every seeded row, one reference per variable", async () => {
		const rows = (await everyRow()).filter((r) => r.seedKey)
		expect(rows.filter((r) => !r.reference).map((r) => r.seedKey)).toEqual(
			[]
		)
		const seen = new Set<string>()
		for (const r of rows) {
			const k = `${r.variableId}\u0000${r.reference}`
			expect(seen.has(k), k).toBe(false)
			seen.add(k)
		}
		for (const t of SHIPPED_VARIABLE_TEMPLATES)
			expect(await referenceBySeedKey(seedKeyFor(t))).toBe(
				coreLayoutReferenceFor(seedKeyFor(t))
			)
	})

	it("leaves a person's row without one", async () => {
		await db.insert(schema.pipelineVariableTemplates).values({
			variableId: CHARS,
			name: "Prose",
			source: "{{{characters}}}",
			engine: "core:template/handlebars@1"
		})
		await seedVariableTemplates(db)
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				and(
					eq(schema.pipelineVariableTemplates.name, "Prose"),
					isNull(schema.pipelineVariableTemplates.seedKey)
				)
			)
		expect(row!.reference).toBeNull()
	})

	it("never rewrites a reference, and a second boot changes nothing", async () => {
		const [json] = (await everyRow()).filter(
			(r) =>
				r.seedKey ===
				seedKeyFor({ variableId: CHARS, variant: "content" })
		)
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ reference: "core/custom@1" })
			.where(eq(schema.pipelineVariableTemplates.id, json.id))
		const before = await everyRow()
		await seedVariableTemplates(db)
		await syncPluginTemplates(db)
		const after = await everyRow()
		expect(after).toEqual(before)
		expect(after.find((r) => r.id === json.id).reference).toBe(
			"core/custom@1"
		)
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ reference: "core/json@1" })
			.where(eq(schema.pipelineVariableTemplates.id, json.id))
	})

	it("on a collision leaves the later row without, warns naming both, and does not crash", async () => {
		const [wrapped] = (await everyRow()).filter(
			(r) =>
				r.seedKey ===
				seedKeyFor({ variableId: CHARS, variant: "wrapped" })
		)
		// Another row of the variable already goes by the reference core would give this one.
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ reference: null })
			.where(eq(schema.pipelineVariableTemplates.id, wrapped.id))
		const [taker] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: CHARS,
				name: "Mine",
				source: "{{{characters}}}",
				engine: "core:template/handlebars@1",
				reference: "core/titled-json@1"
			})
			.returning()
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		await seedVariableTemplates(db)
		await seedVariableTemplates(db)
		const rows = await everyRow()
		expect(rows.find((r) => r.id === wrapped.id).reference).toBeNull()
		expect(rows.find((r) => r.id === taker.id).reference).toBe(
			"core/titled-json@1"
		)
		// Once per boot, naming both rows.
		const said = warn.mock.calls
			.map((c) => String(c[0]))
			.filter((m) => m.includes("core/titled-json@1"))
		expect(said.length).toBe(2)
		expect(said[0]).toContain(`#${wrapped.id}`)
		expect(said[0]).toContain(`#${taker.id}`)
		warn.mockRestore()
	})
})

describe("a package's rows are stamped from its template id", () => {
	const install = async (
		manifest: Record<string, unknown>,
		pluginId = PLUGIN
	) =>
		db
			.insert(schema.plugins)
			.values({
				pluginId,
				name: "Dice Tray",
				bundleSource: "//",
				bundleHash: "sha256:test",
				backends: ["quickjs"],
				backend: "quickjs",
				enabled: true,
				manifest
			})
			.returning()

	it("gives a declared layout <owner>/<the id's name>@<the id's major>, and an automatic one <owner>/json@<variable major>", async () => {
		await install({
			slug: PLUGIN,
			templates: [
				{
					id: LAYOUT_ID,
					kind: "variables",
					variableId: CHARS,
					engine: "core:template/handlebars@1",
					label: "Dice cast",
					body: "{{{json characters 2}}}"
				}
			]
		})
		await install(
			{
				slug: "acme.vars",
				variables: [
					{
						id: "acme.vars:var/ledger@1",
						scope: {
							ledger: { type: "record", of: { type: "string" } }
						},
						sample: { Rent: "Due Friday." }
					}
				]
			},
			"acme.vars"
		)
		const report = await syncPluginTemplates(db)
		expect(report.refused).toEqual([])
		const rows = await everyRow()
		expect(rows.find((r) => r.templateId === LAYOUT_ID).reference).toBe(
			"acme.dice/dice-cast@1"
		)
		expect(
			rows.find(
				(r) => r.templateId === "acme.vars:template/ledger-json@1"
			).reference
		).toBe("acme.vars/json@1")
	})

	it("a second sync changes no reference", async () => {
		// (A sync re-writes a present row's `updatedAt`; the references are the claim.)
		const references = async () =>
			(await everyRow()).map((r) => [r.id, r.reference])
		const before = await references()
		await syncPluginTemplates(db)
		expect(await references()).toEqual(before)
	})

	it("uses the seed's `slug` when the manifest states one, and a second boot changes nothing", async () => {
		await install(
			{
				slug: "acme.slugs",
				variables: [
					{
						id: "acme.slugs:var/ledger@1",
						scope: {
							ledger: { type: "record", of: { type: "string" } }
						},
						sample: { Rent: "Due Friday." }
					}
				],
				templates: [
					{
						id: "acme.slugs:template/cast-long-name@1",
						kind: "variables",
						variableId: CHARS,
						engine: "core:template/handlebars@1",
						label: "Cast",
						body: "{{{json characters 2}}}",
						slug: "prose"
					},
					// The SDK's `variableLayout(…, { slug: "json" })` for an
					// object variable: the automatic layout's own template id.
					{
						id: "acme.slugs:template/ledger-json@1",
						kind: "variables",
						variableId: "acme.slugs:var/ledger@1",
						engine: "core:template/handlebars@1",
						label: "Ledger",
						body: "{{{json ledger}}}",
						slug: "json"
					}
				]
			},
			"acme.slugs"
		)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const report = await syncPluginTemplates(db)
		expect(report.refused).toEqual([])
		const owned = async () =>
			(await everyRow()).filter((r) =>
				String(r.templateId ?? "").startsWith("acme.slugs:")
			)
		const first = await owned()
		expect(
			first.find((r) => r.templateId === "acme.slugs:template/cast-long-name@1")
				.reference
		).toBe("acme.slugs/prose@1")
		// One row for the clashing id, stamped once.
		const ledger = first.filter(
			(r) => r.variableId === "acme.slugs:var/ledger@1"
		)
		expect(ledger.length).toBe(1)
		expect(ledger[0].reference).toBe("acme.slugs/json@1")
		const references = async () =>
			(await everyRow()).map((r) => [r.id, r.reference])
		const before = await references()
		await syncPluginTemplates(db)
		expect(await references()).toEqual(before)
		expect(
			warn.mock.calls.filter((c) => String(c[0]).includes("acme.slugs"))
		).toEqual([])
		warn.mockRestore()
	})
})
