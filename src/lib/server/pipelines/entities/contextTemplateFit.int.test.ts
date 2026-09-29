/**
 * Typed templates P5 (2026-09-27): a context template is checked against the
 * typed scope of the step that renders it.
 *
 * - a NEW selection naming something nothing supplies is refused, naming the
 *   name, the nearest one that exists and what does (owner Q6);
 * - a warning never refuses — nor does anything at a step whose upstream
 *   declares no types;
 * - a spec's own templates (a preset's) are refused at publish — new saves
 *   only; a document already stored under its hash is not re-judged;
 * - the library save only warns, naming the pipeline;
 * - the boot scan reports a STORED misfit and refuses and changes nothing;
 * - every shipped template fits every shipped step (zero findings).
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { compile, handlebars, spec } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	namespaceView,
	writeOption,
	type ConfigOption
} from "$lib/server/pipelines/config/panel"
import { optionId } from "$lib/server/pipelines/config/panel/ids"
import {
	type BootstrapReport,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import {
	ContextTemplateNotUsableError,
	createContextTemplate
} from "$lib/server/pipelines/entities/contextTemplates"
import {
	CONTEXT_TEMPLATE_CHECKING,
	contextTemplateFitAt,
	scanContextTemplateFits,
	sharedContextTemplateWarnings
} from "$lib/server/pipelines/entities/contextTemplateFit"

const SECRET = "template-fit-secret"
const ASSEMBLE_POOL = "core:task/assemble"

let db: TestDb
let adminId: number
let boot: BootstrapReport

const admin = () => ({ userId: adminId, isAdmin: true })

let n = 0
const unique = (s: string) => `${s} ${++n}`

async function specRow(slug: string) {
	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return row!
}

/** A mutable configuration selected for `slug` — the shipped default is immutable. */
async function mutableConfig(slug: string): Promise<number> {
	const { resolveSelectedConfig, duplicateConfig, selectConfig } =
		await import("$lib/server/pipelines/config/named")
	const row = await specRow(slug)
	const shipped = await resolveSelectedConfig(db, row.id, slug, {})
	const copy = await duplicateConfig(
		db,
		shipped!.configId,
		unique("Fit host")
	)
	await selectConfig(db, row.id, "instance", 0, copy.id, adminId)
	return copy.id
}

/** The template slot's declaration and its option, found by the option's id. */
async function templateOption(
	slug: string,
	nodeKey?: string
): Promise<{ id: string; nodeKey: string; slot: string; value: unknown }> {
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const s = await specRow(slug)
	const d = (await declarations(db, s.activeVersionId!)).find(
		(x) =>
			x.control === "context-template-ref" &&
			(!nodeKey || x.nodeKey === nodeKey)
	)
	expect(d, `${slug} declares a context template slot`).toBeTruthy()
	const id = optionId(SECRET, d!.nodeKey, d!.slot, d!.path)
	const view = await namespaceView(db, SECRET, slug, admin())
	const option: ConfigOption | undefined = view!.steps
		.flatMap((st) => [...st.options, ...st.advanced])
		.find((o) => o.id === id)
	expect(option, "the panel offers it").toBeTruthy()
	return {
		id,
		nodeKey: d!.nodeKey,
		slot: d!.slot,
		value: (option as any).value
	}
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	boot = await bootstrapPipelines(db)
	const [adminRow] = await db
		.insert(schema.users)
		.values({ username: "template-fit-admin", isAdmin: true })
		.returning()
	adminId = adminRow.id
	await mutableConfig(RESPOND_SPEC_ID)
}, 120_000)

describe("the shipped catalog", () => {
	it("a fresh boot's scan checks every shipped selection and finds none that misfit", () => {
		expect(boot.templateFits).toBeDefined()
		expect(boot.templateFits!.errors).toEqual([])
		expect(boot.templateFits!.checked).toBeGreaterThan(0)
		expect(boot.templateFits!.misfits).toEqual([])
	})

	it("every shipped context template fits every published step of its pool", async () => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const shipped = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.isImmutable, true))
		expect(shipped.length).toBeGreaterThan(0)
		const specs = await db.select().from(schema.pipelineSpecs)
		let checked = 0
		const refused: string[] = []
		for (const s of specs) {
			if (s.activeVersionId == null) continue
			for (const d of await declarations(db, s.activeVersionId)) {
				if (d.control !== "context-template-ref") continue
				for (const row of shipped) {
					if (row.nodeDefinitionId !== d.nodeDefinitionId) continue
					checked++
					const fit = await contextTemplateFitAt(
						db,
						{
							specVersionId: s.activeVersionId,
							nodeKey: d.nodeKey,
							slot: d.slot
						},
						{ engine: row.engine, source: row.source ?? "" }
					)
					for (const f of fit?.refusals ?? [])
						refused.push(
							`${s.slug} '${d.nodeKey}' × '${row.name}': ${f.message}`
						)
				}
			}
		}
		expect(checked).toBeGreaterThan(0)
		expect(refused).toEqual([])
	}, 120_000)
})

describe("selection", () => {
	it("refuses a template naming something nothing supplies, with did-you-mean", async () => {
		const option = await templateOption(RESPOND_SPEC_ID)
		const row = await createContextTemplate(db, {
			nodeDefinitionId: ASSEMBLE_POOL,
			name: "Riddle layout",
			source: "{{{scenaro}}}\n{{{worldLore}}}"
		})
		const attempt = writeOption(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			admin(),
			option.id,
			row.id
		)
		await expect(attempt).rejects.toThrow(ContextTemplateNotUsableError)
		await expect(
			writeOption(db, SECRET, RESPOND_SPEC_ID, admin(), option.id, row.id)
		).rejects.toThrow(
			new RegExp(
				`^'${option.nodeKey}' can't render 'Riddle layout': it uses \`scenaro\`, ` +
					"which nothing supplies here\\. Did you mean `scenario`\\? Available: .*`scenario`"
			)
		)
		// Refused means not stored: the panel still shows what it showed.
		const after = await templateOption(RESPOND_SPEC_ID)
		expect(after.value).not.toBe(row.id)
	})

	it("allows a template that fits", async () => {
		const option = await templateOption(RESPOND_SPEC_ID)
		const row = await createContextTemplate(db, {
			nodeDefinitionId: ASSEMBLE_POOL,
			name: unique("Fits"),
			source: "{{#if characters}}{{{characters}}}{{/if}}\n{{{worldLore}}}"
		})
		await writeOption(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			admin(),
			option.id,
			row.id
		)
		expect((await templateOption(RESPOND_SPEC_ID)).value).toBe(row.id)
	})

	it("allows a selection whose only findings are warnings — an untyped step upstream", async () => {
		// Found rather than named: whichever published step renders a context
		// template with a producer upstream that declares no types.
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const specs = await db.select().from(schema.pipelineSpecs)
		let place: { slug: string; nodeKey: string } | undefined
		for (const s of specs) {
			if (s.activeVersionId == null || place) continue
			for (const d of await declarations(db, s.activeVersionId)) {
				if (
					d.control !== "context-template-ref" ||
					d.nodeDefinitionId !== ASSEMBLE_POOL
				)
					continue
				const fit = await contextTemplateFitAt(
					db,
					{
						specVersionId: s.activeVersionId,
						nodeKey: d.nodeKey,
						slot: d.slot
					},
					{
						engine: handlebars.id,
						source: "{{{notSuppliedAnywhere}}}"
					}
				)
				if (
					fit &&
					fit.untyped.length &&
					!fit.refusals.length &&
					fit.warnings.length
				) {
					place = { slug: s.slug, nodeKey: d.nodeKey }
					break
				}
			}
		}
		expect(
			place,
			"some shipped step renders with an untyped producer upstream"
		).toBeTruthy()
		await mutableConfig(place!.slug)
		const option = await templateOption(place!.slug, place!.nodeKey)
		const row = await createContextTemplate(db, {
			nodeDefinitionId: ASSEMBLE_POOL,
			name: unique("Warns only"),
			source: "{{{notSuppliedAnywhere}}}"
		})
		await writeOption(db, SECRET, place!.slug, admin(), option.id, row.id)
	})
})

describe("the library save", () => {
	it("warns, naming the pipeline, and never refuses", async () => {
		const warnings = await sharedContextTemplateWarnings(
			db,
			ASSEMBLE_POOL,
			{
				engine: handlebars.id,
				source: "{{{scenaro}}}"
			}
		)
		expect(warnings).not.toBeNull()
		expect(
			warnings!.some(
				(w) =>
					w.name === "scenaro" &&
					w.message.startsWith(`In '${RESPOND_SPEC_ID}' at '`) &&
					/Did you mean "scenario"\?/.test(w.message)
			)
		).toBe(true)
	})
})

describe("the boot scan", () => {
	it("reports a stored misfit, and refuses and changes nothing", async () => {
		const option = await templateOption(RESPOND_SPEC_ID)
		const row = await createContextTemplate(db, {
			nodeDefinitionId: ASSEMBLE_POOL,
			name: unique("Stored before P5"),
			source: "{{{secretEntri}}}"
		})
		// Stored as a selection made before selection was checked — written
		// straight to the configuration, the way an older build left it.
		const { resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const s = await specRow(RESPOND_SPEC_ID)
		const selected = await resolveSelectedConfig(
			db,
			s.id,
			RESPOND_SPEC_ID,
			{}
		)
		await db
			.insert(schema.pipelineConfigValues)
			.values({
				configId: selected!.configId,
				nodeKey: option.nodeKey,
				slot: option.slot,
				path: "",
				value: row.id
			})
			.onConflictDoUpdate({
				target: [
					schema.pipelineConfigValues.configId,
					schema.pipelineConfigValues.nodeKey,
					schema.pipelineConfigValues.slot,
					schema.pipelineConfigValues.path
				],
				set: { value: row.id }
			})

		const first = await scanContextTemplateFits(db)
		const hit = first.misfits.find((m) => m.templateId === row.id)
		expect(hit).toBeDefined()
		expect(hit!.specSlug).toBe(RESPOND_SPEC_ID)
		expect(hit!.configIds).toContain(selected!.configId)
		expect(hit!.message).toMatch(
			/can't render '.*': it uses `secretEntri`, which nothing supplies here/
		)

		// Nothing changed: the selection and the template are as they were.
		const [value] = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(
						schema.pipelineConfigValues.configId,
						selected!.configId
					),
					eq(schema.pipelineConfigValues.nodeKey, option.nodeKey),
					eq(schema.pipelineConfigValues.slot, option.slot)
				)
			)
		expect(value!.value).toBe(row.id)
		const [template] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, row.id))
		expect(template!.source).toBe("{{{secretEntri}}}")

		// Idempotent: the second pass says the same thing.
		const second = await scanContextTemplateFits(db)
		expect(second.misfits.filter((m) => m.templateId === row.id)).toEqual(
			first.misfits.filter((m) => m.templateId === row.id)
		)
	})

	it("writes one `misfit` notice per selecting config, never twice, and clears it once the template fits", async () => {
		const option = await templateOption(RESPOND_SPEC_ID)
		const row = await createContextTemplate(db, {
			nodeDefinitionId: ASSEMBLE_POOL,
			name: unique("Misfit notice"),
			source: "{{{secretEntri}}}"
		})
		const configA = await mutableConfig(RESPOND_SPEC_ID)
		const configB = await mutableConfig(RESPOND_SPEC_ID)
		for (const configId of [configA, configB])
			await db
				.insert(schema.pipelineConfigValues)
				.values({
					configId,
					nodeKey: option.nodeKey,
					slot: option.slot,
					path: "",
					value: row.id
				})
				.onConflictDoUpdate({
					target: [
						schema.pipelineConfigValues.configId,
						schema.pipelineConfigValues.nodeKey,
						schema.pipelineConfigValues.slot,
						schema.pipelineConfigValues.path
					],
					set: { value: row.id }
				})
		// The sibling kinds, which this scan must leave alone.
		const s = await specRow(RESPOND_SPEC_ID)
		await db.insert(schema.pipelineConfigNotices).values([
			{
				configId: configA,
				kind: "culled",
				nodeKey: option.nodeKey,
				slot: "someOldKnob",
				label: "An old knob",
				previousValue: 3,
				specVersionId: s.activeVersionId
			},
			{
				configId: configA,
				kind: "unbound",
				nodeKey: option.nodeKey,
				slot: "",
				label: "A node this build does not run",
				specVersionId: s.activeVersionId
			}
		])

		const misfitsOf = async (configId: number) =>
			db
				.select()
				.from(schema.pipelineConfigNotices)
				.where(
					and(
						eq(schema.pipelineConfigNotices.configId, configId),
						eq(schema.pipelineConfigNotices.kind, "misfit")
					)
				)
		const siblingsOf = async (configId: number) =>
			(
				await db
					.select()
					.from(schema.pipelineConfigNotices)
					.where(eq(schema.pipelineConfigNotices.configId, configId))
			)
				.filter((n) => n.kind !== "misfit")
				.map((n) => n.kind)
				.sort()

		const first = await scanContextTemplateFits(db)
		const hit = first.misfits.find((m) => m.templateId === row.id)!
		expect(hit.configIds.sort()).toEqual([configA, configB].sort())
		for (const configId of [configA, configB]) {
			const notices = await misfitsOf(configId)
			expect(notices).toHaveLength(1)
			expect(notices[0]!.label).toBe(hit.message)
			expect(notices[0]!.nodeKey).toBe(option.nodeKey)
			expect(notices[0]!.slot).toBe(option.slot)
			expect(notices[0]!.acknowledgedAt).toBeNull()
		}

		// A re-run writes nothing new.
		await scanContextTemplateFits(db)
		for (const configId of [configA, configB])
			expect(await misfitsOf(configId)).toHaveLength(1)

		// The template fixed: the notices go, the selection stays.
		await db
			.update(schema.pipelineContextTemplates)
			.set({ source: "Plain words and nothing else." })
			.where(eq(schema.pipelineContextTemplates.id, row.id))
		const fixed = await scanContextTemplateFits(db)
		expect(fixed.misfits.some((m) => m.templateId === row.id)).toBe(false)
		for (const configId of [configA, configB])
			expect(await misfitsOf(configId)).toHaveLength(0)

		// The other kinds were never touched.
		expect(await siblingsOf(configA)).toEqual(["culled", "unbound"])
		expect(await siblingsOf(configB)).toEqual([])
	})
})

describe("publish (law T1)", () => {
	const riddleDoc = (source: string, version = "1.0.0") =>
		compile(
			spec("fittest:spec/riddle", { version })
				.inlet("input", C.userMessage.v1())
				.query("cast", ($) =>
					C.sessionCast.v1({ scope: $.input.sessionScope })
				)
				.task("context", ($) =>
					C.buildTemplateContext.v1({ cast: $.cast.cast })
				)
				.task("prompt", ($) =>
					C.assemble.v2({
						templateContext: $.context.templateContext
					})
				)
				.preset("riddle", { label: "Riddle", default: true }, (p) =>
					p.template("prompt", { engine: handlebars.id, source })
				)
				.build()
		)

	it("refuses a new document whose preset template names nothing in scope", async () => {
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		await expect(
			saveDocument(db, riddleDoc("{{{characterz}}}"), { publish: true })
		).rejects.toThrow(
			/cannot be saved: a template does not fit the step that renders it — \[T1\] prompt: 'prompt' can't render the 'riddle' preset's template: it uses `characterz`/
		)
	})

	it("saves one that fits", async () => {
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		await expect(
			saveDocument(db, riddleDoc("{{{characters}}}", "1.0.1"), {
				publish: true
			})
		).resolves.toBeDefined()
	})

	it("never re-judges a document already stored under its hash", async () => {
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		const stored = riddleDoc("{{{characterz}}}", "0.9.0")
		// Stored while the check did not refuse — the way an older build left it.
		const refuse = CONTEXT_TEMPLATE_CHECKING.refuse
		CONTEXT_TEMPLATE_CHECKING.refuse = []
		try {
			await saveDocument(db, stored)
		} finally {
			CONTEXT_TEMPLATE_CHECKING.refuse = refuse
		}
		// The boot republishing it is not a new save.
		await expect(saveDocument(db, stored)).resolves.toBeDefined()
	})
})
