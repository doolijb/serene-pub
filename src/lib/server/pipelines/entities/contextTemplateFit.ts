/**
 * Does a context template fit the step that renders it? (typed templates P5)
 *
 * The host half of the SDK's `templateFit`: the stored document, the registry
 * rows (F6 — a plugin's node is read from its row, never loaded), and core's
 * two engines' vocabulary. Four callers, one answer:
 *
 * - **selection** (`assertSelectable` with the step's address) REFUSES a
 *   template naming something nothing supplies at that step — owner Q6,
 *   "refuse new selections";
 * - **publish** (`saveDocument`) refuses a spec whose own templates (a preset's,
 *   a node's) do not fit — law T1;
 * - **the library save** WARNS, because the row is shared across pipelines and
 *   fitting one says nothing about the next;
 * - **the boot scan** (`scanContextTemplateFits`) reports every stored
 *   selection that does not fit and refuses nothing — a stored row is never
 *   refused retroactively.
 *
 * Nothing refuses while a producer upstream declares no types (`untyped`):
 * the checker only warns then, because the name may still arrive.
 */

import {
	laidOutScope,
	rendersAt,
	templateFit,
	templateFitSentence,
	type SpecDocument,
	type TemplateChecking,
	type TemplateFindingKind,
	type TemplateFit
} from "@serene-pub/sdk"
import { checkTemplateSourceReport } from "@serene-pub/sdk/template-check"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rowSource } from "$lib/server/pipelines/config/panel/declarations"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { CONTEXT_TEMPLATE_CHECK } from "$lib/shared/utils/templateCheckOptions"

/**
 * Every error kind refuses here: the host passes its own helpers and Liquid
 * vocabulary, so an unknown helper or a parse failure is a fact about this
 * install, not a guess (the SDK's default refuses names and paths only).
 */
const HOST_REFUSES: readonly TemplateFindingKind[] = [
	"syntax",
	"unknown-name",
	"unknown-path",
	"unknown-helper",
	// 🚧 A `layout <key> "<reference>"` call that names no variable of this step
	// with layouts, or no layout it offers (law T1 covers references). Only a
	// check that knows which keys are laid out can say so — see
	// `contextTemplateChecking`; the plain scope below cannot.
	"layout-argument",
	"unknown-layout"
]

/**
 * Core's checker, with core's vocabulary, over a scope that does not know
 * which keys are laid out.
 *
 * ⚠ Names and paths only: the refusal of a `layout` call needs the step's laid-out
 * scope (`contextTemplateChecking`), which a caller holding just a document
 * (`templateLawFindings` at publish) does not have — adding the two layout
 * kinds here would refuse every valid `layout` call in a spec's own templates.
 */
export const CONTEXT_TEMPLATE_CHECKING: TemplateChecking = {
	check: checkTemplateSourceReport,
	options: CONTEXT_TEMPLATE_CHECK,
	refuse: HOST_REFUSES.filter(
		(k) => k !== "layout-argument" && k !== "unknown-layout"
	)
}

/**
 * The layouts every variable offers, across the whole pub: each variable's
 * rows that carry a reference and are not withdrawn — what an explicit
 * `layout` reference is checked against (and where the SDK finds its
 * near-miss). Independent of the step.
 */
export async function variableLayoutOffersOf(
	db: Db,
	variableIds: readonly string[]
): Promise<Record<string, Array<{ reference: string; label: string }>>> {
	const { listVariableTemplates, layoutByReference } = await import(
		"$lib/server/pipelines/entities/variableTemplates"
	)
	const out: Record<string, Array<{ reference: string; label: string }>> = {}
	for (const variableId of new Set(variableIds)) {
		const offered: Array<{ reference: string; label: string }> = []
		for (const row of await listVariableTemplates(db, variableId))
			if (
				row.reference &&
				(await layoutByReference(db, variableId, row.reference)) === row.id
			)
				offered.push({ reference: row.reference, label: row.name })
		out[variableId] = offered
	}
	return out
}

/**
 * Core's checking **for one step**: the same checker, but over the step's
 * laid-out scope (`laidOutScope` with what its `variables` slot renders) and
 * with the layouts every variable offers, so a `layout <key> "<reference>"`
 * call is read for what it is and an unknown reference is refused with its
 * near-miss.
 */
export async function contextTemplateChecking(
	db: Db,
	doc: SpecDocument,
	nodeKey: string,
	describe: ReturnType<typeof rowSource>
): Promise<TemplateChecking> {
	// Every key a `variables` slot renders anywhere in the document, not only
	// this node's: the context builder lays out `characters`, `scenario` and
	// the rest, and the template at Assemble reads them across a port. All the
	// document's variables-slot nodes rather than exactly the ones upstream —
	// a key two nodes lay out by different variables is the node's own, the
	// others written first so it wins. Offers stay per variable, pub-wide.
	const renders: Record<string, string> = {}
	const rendersOfNode = (key: string): Record<string, string> => {
		const node = doc.nodes.find((n) => n.key === key)
		const described = node ? describe(node) : undefined
		const out: Record<string, string> = {}
		for (const slot of Object.values(described?.slots ?? {}))
			if (slot.kind === "variables")
				Object.assign(out, rendersAt(doc, key, slot, describe))
		return out
	}
	for (const n of doc.nodes)
		if (n.key !== nodeKey) Object.assign(renders, rendersOfNode(n.key))
	Object.assign(renders, rendersOfNode(nodeKey))
	const variableLayoutOffers = await variableLayoutOffersOf(
		db,
		Object.values(renders)
	)
	return {
		...CONTEXT_TEMPLATE_CHECKING,
		check: (engine, source, scope, options) =>
			checkTemplateSourceReport(
				engine,
				source,
				laidOutScope(scope, renders),
				{ ...options, variableLayoutOffers }
			),
		refuse: HOST_REFUSES
	}
}

/** Where a template is rendered: one template slot of one published version. */
export interface TemplateAddress {
	specVersionId: number
	nodeKey: string
	slot: string
}

async function registryByPin(db: Db): Promise<Map<string, any>> {
	const registry = await db.select().from(schema.pipelineDefinitionRegistry)
	return new Map<string, any>(
		(registry as any[]).map((r) => [`${r.definitionId}@${r.version}`, r])
	)
}

/**
 * The fit of `template` at `at`, or null when the step's scope cannot be
 * computed — a document two declarers break, which the panel and the run
 * already refuse on their own terms. Not the template's fault, so not its
 * refusal.
 */
export async function contextTemplateFitAt(
	db: Db,
	at: TemplateAddress,
	template: { engine: string | null; source: string },
	/** What a walk over many templates has already read. */
	read: { byPin?: Map<string, any>; doc?: SpecDocument } = {}
): Promise<TemplateFit | null> {
	const doc =
		read.doc ??
		(await (
			await import("$lib/server/pipelines/boot/store")
		).loadDocument(db, at.specVersionId))
	try {
		const describe = rowSource(read.byPin ?? (await registryByPin(db)))
		return templateFit(
			doc,
			at.nodeKey,
			{
				engine: template.engine ?? CORE_TEMPLATE_ENGINE,
				source: template.source
			},
			await contextTemplateChecking(db, doc, at.nodeKey, describe),
			{ slot: at.slot, describe }
		)
	} catch (e) {
		console.warn(
			`[pipelines] the template scope at '${at.nodeKey}' could not be computed: ${(e as Error).message}`
		)
		return null
	}
}

/** The refusal sentence for a template that does not fit, or null when it does. */
export async function contextTemplateMisfit(
	db: Db,
	at: TemplateAddress,
	template: { name: string; engine: string | null; source: string }
): Promise<string | null> {
	const fit = await contextTemplateFitAt(db, at, template)
	if (!fit?.refusals.length) return null
	return templateFitSentence(at.nodeKey, `'${template.name}'`, fit.refusals)
}

/** Every place a pool's templates render: each published step of that node definition. */
async function placesOfPool(
	db: Db,
	poolId: string
): Promise<Array<TemplateAddress & { specId: number; slug: string }>> {
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const specs = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
	const out: Array<TemplateAddress & { specId: number; slug: string }> = []
	for (const spec of specs) {
		if (spec.activeVersionId == null) continue
		for (const d of await declarations(db, spec.activeVersionId))
			if (
				d.control === "context-template-ref" &&
				d.nodeDefinitionId === poolId
			)
				out.push({
					specId: spec.id,
					slug: spec.slug,
					specVersionId: spec.activeVersionId,
					nodeKey: d.nodeKey,
					slot: d.slot
				})
	}
	return out
}

/** One thing the library save says about a shared row, with where. */
export interface SharedTemplateWarning {
	name: string
	line?: number
	column?: number
	message: string
}

/**
 * What a library save says about a shared row (design §4.4): every finding at
 * every published step that renders this pool, as a WARNING naming the
 * pipeline — the row is shared, so fitting one step is no promise about the
 * next, and not fitting one is no reason to refuse the save. Null when no
 * published step renders the pool; the caller then falls back to the untyped
 * check.
 */
export async function sharedContextTemplateWarnings(
	db: Db,
	poolId: string,
	template: { engine: string; source: string }
): Promise<SharedTemplateWarning[] | null> {
	const places = await placesOfPool(db, poolId)
	if (!places.length) return null
	const byPin = await registryByPin(db)
	const out: SharedTemplateWarning[] = []
	const seen = new Set<string>()
	for (const at of places) {
		const fit = await contextTemplateFitAt(db, at, template, { byPin })
		if (!fit) continue
		for (const f of [...fit.refusals, ...fit.warnings]) {
			if (f.kind === "syntax") continue
			const message = `In '${at.slug}' at '${at.nodeKey}': ${f.message}`
			const key = `${message}@${f.line}:${f.column}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push({
				name: f.name ?? f.path ?? "",
				...(f.line !== undefined ? { line: f.line } : {}),
				...(f.column !== undefined ? { column: f.column } : {}),
				message
			})
		}
	}
	return out
}

// ── The boot scan ────────────────────────────────────────────────────────────

/** One stored selection that does not fit the step it is selected for. */
export interface TemplateMisfit {
	specSlug: string
	specVersionId: number
	nodeKey: string
	slot: string
	templateId: number
	templateName: string
	/** The configurations selecting it; empty when only a session or user override does. */
	configIds: number[]
	/** The refusal a new selection would get, word for word. */
	message: string
}

export interface TemplateFitScanReport {
	/** Stored selections examined. */
	checked: number
	misfits: TemplateMisfit[]
	/** `misfit` notices written this pass (one per selecting configuration). */
	noticed: number
	/** `misfit` notices removed because the template fits, or is not selected there. */
	cleared: number
	/** What went wrong, per spec, without stopping the walk. */
	errors: string[]
}

/**
 * Every stored context-template selection × the step it is selected for
 * (owner Q6): the configuration values and the session/user overrides that
 * point a template slot at a row. A selection that would be refused today is
 * REPORTED, never refused and never changed — the template, the selection and
 * the run are left exactly as they were; the person is told: through the boot
 * report, the server log, and one `misfit` notice per configuration selecting
 * it (`writeMisfitNotices`). The notices are the only thing it writes, and
 * they are reconciled rather than appended, so running it twice says the same
 * thing twice.
 */
export async function scanContextTemplateFits(
	db: Db
): Promise<TemplateFitScanReport> {
	const report: TemplateFitScanReport = {
		checked: 0,
		misfits: [],
		noticed: 0,
		cleared: 0,
		errors: []
	}
	/** Specs the walk could not finish: their notices are left as they were. */
	const unfinished = new Set<number>()
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const byPin = await registryByPin(db)
	const specs = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)

	for (const spec of specs) {
		if (spec.activeVersionId == null) continue
		try {
			const slots = (await declarations(db, spec.activeVersionId)).filter(
				(d) => d.control === "context-template-ref"
			)
			if (!slots.length) continue
			const { loadDocument } = await import(
				"$lib/server/pipelines/boot/store"
			)
			const doc = await loadDocument(db, spec.activeVersionId)
			const configs = await db
				.select({ id: schema.pipelineConfigs.id })
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
			const configIds = configs.map((c) => c.id)
			const { genreStoredValues } = await import(
				"$lib/server/pipelines/registrations/genreValues"
			)
			const genreValues = await genreStoredValues(db, spec.slug)

			for (const d of slots) {
				// templateId → the configurations selecting it.
				const selected = new Map<number, Set<number>>()
				if (configIds.length)
					for (const v of await db
						.select({
							configId: schema.pipelineConfigValues.configId,
							value: schema.pipelineConfigValues.value
						})
						.from(schema.pipelineConfigValues)
						.where(
							and(
								inArray(
									schema.pipelineConfigValues.configId,
									configIds
								),
								eq(
									schema.pipelineConfigValues.nodeKey,
									d.nodeKey
								),
								eq(schema.pipelineConfigValues.slot, d.slot)
							)
						))
						if (typeof v.value === "number") {
							if (!selected.has(v.value))
								selected.set(v.value, new Set())
							selected.get(v.value)!.add(v.configId)
						}
				for (const o of await db
					.select({ value: schema.pipelineNodeOverrides.value })
					.from(schema.pipelineNodeOverrides)
					.where(
						and(
							eq(schema.pipelineNodeOverrides.specId, spec.id),
							eq(schema.pipelineNodeOverrides.nodeKey, d.nodeKey),
							eq(schema.pipelineNodeOverrides.slot, d.slot)
						)
					))
					if (typeof o.value === "number" && !selected.has(o.value))
						selected.set(o.value, new Set())
				// 🚧 And the genre's defaults' values (PLAN-layering D5) — where an
				// instance-wide selection of a pipeline registrations run lives.
				// Reported like an override: no configuration to notice it on.
				for (const g of genreValues)
					if (
						g.nodeKey === d.nodeKey &&
						g.slot === d.slot &&
						typeof g.value === "number" &&
						!selected.has(g.value)
					)
						selected.set(g.value, new Set())
				if (!selected.size) continue

				const rows = await db
					.select()
					.from(schema.pipelineContextTemplates)
					.where(
						inArray(schema.pipelineContextTemplates.id, [
							...selected.keys()
						])
					)
				for (const row of rows as any[]) {
					report.checked++
					const at = {
						specVersionId: spec.activeVersionId,
						nodeKey: d.nodeKey,
						slot: d.slot
					}
					const fit = await contextTemplateFitAt(
						db,
						at,
						{ engine: row.engine, source: row.source ?? "" },
						{ byPin, doc }
					)
					if (!fit?.refusals.length) continue
					report.misfits.push({
						specSlug: spec.slug,
						...at,
						templateId: row.id,
						templateName: row.name,
						configIds: [...(selected.get(row.id) ?? [])],
						message: templateFitSentence(
							d.nodeKey,
							`'${row.name}'`,
							fit.refusals
						)
					})
				}
			}
		} catch (e) {
			unfinished.add(spec.id)
			report.errors.push(`${spec.slug}: ${(e as Error).message}`)
		}
	}
	try {
		await writeMisfitNotices(db, report, unfinished)
	} catch (e) {
		report.errors.push(`misfit notices: ${(e as Error).message}`)
	}
	return report
}

/** The notice kind a stored selection that does not fit is recorded under. */
export const MISFIT_NOTICE_KIND = "misfit"

/**
 * One `misfit` notice per configuration selecting a template that does not
 * fit, reconciled the way `reconcilePlacedNodes` reconciles `unbound`: the
 * healed half first — a notice whose template fits, is not
 * selected there, or belongs to a version the spec has moved off goes — then
 * the missing ones are written. A notice already there, dismissed or not, is
 * not written again; one whose sentence changed (the template was edited and
 * still does not fit) is rewritten and shown again, because it is a new fact.
 *
 * Identity is the configuration, the step's address, the version and the
 * template (`previousValue.templateId`). Only `misfit` rows are read or
 * touched; the other kinds belong to other writers. A spec the walk could not
 * finish keeps its notices — not knowing is not the same as fitting.
 */
async function writeMisfitNotices(
	db: Db,
	report: TemplateFitScanReport,
	unfinished: ReadonlySet<number>
): Promise<void> {
	const keyOf = (n: {
		configId: number
		nodeKey: string
		slot: string
		specVersionId: number | null
		templateId: unknown
	}) =>
		`${n.configId}|${n.nodeKey}|${n.slot}|${n.specVersionId}|${n.templateId}`

	const wanted = new Map<
		string,
		{ configId: number; misfit: TemplateMisfit }
	>()
	for (const m of report.misfits)
		for (const configId of m.configIds)
			wanted.set(keyOf({ ...m, configId }), {
				configId,
				misfit: m
			})

	const stored = await db
		.select({
			id: schema.pipelineConfigNotices.id,
			configId: schema.pipelineConfigNotices.configId,
			nodeKey: schema.pipelineConfigNotices.nodeKey,
			slot: schema.pipelineConfigNotices.slot,
			specVersionId: schema.pipelineConfigNotices.specVersionId,
			label: schema.pipelineConfigNotices.label,
			previousValue: schema.pipelineConfigNotices.previousValue,
			specId: schema.pipelineConfigs.specId
		})
		.from(schema.pipelineConfigNotices)
		.innerJoin(
			schema.pipelineConfigs,
			eq(schema.pipelineConfigs.id, schema.pipelineConfigNotices.configId)
		)
		.where(eq(schema.pipelineConfigNotices.kind, MISFIT_NOTICE_KIND))

	const stale: number[] = []
	const kept = new Set<string>()
	for (const n of stored) {
		const key = keyOf({
			...n,
			templateId: (n.previousValue as any)?.templateId
		})
		const want = wanted.get(key)
		if (!want) {
			if (!unfinished.has(n.specId)) stale.push(n.id)
			continue
		}
		if (kept.has(key)) {
			// A duplicate from some earlier, less careful pass.
			stale.push(n.id)
			continue
		}
		kept.add(key)
		if (n.label !== want.misfit.message)
			await db
				.update(schema.pipelineConfigNotices)
				.set({
					label: want.misfit.message,
					acknowledgedAt: null,
					createdAt: new Date()
				})
				.where(eq(schema.pipelineConfigNotices.id, n.id))
	}
	if (stale.length) {
		await db
			.delete(schema.pipelineConfigNotices)
			.where(inArray(schema.pipelineConfigNotices.id, stale))
		report.cleared += stale.length
	}

	for (const [key, { configId, misfit }] of wanted) {
		if (kept.has(key)) continue
		await db.insert(schema.pipelineConfigNotices).values({
			configId,
			kind: MISFIT_NOTICE_KIND,
			nodeKey: misfit.nodeKey,
			slot: misfit.slot,
			path: "",
			// The refusal a new selection would get, word for word.
			label: misfit.message,
			previousValue: {
				templateId: misfit.templateId,
				templateName: misfit.templateName
			},
			specVersionId: misfit.specVersionId
		})
		report.noticed++
	}
}
