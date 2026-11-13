/**
 * The admin reads behind Admin › Writing › Variable layouts (PLAN
 * variable-layouts 2026-11-10, W1 W2 W3 W5): which variable is written out by
 * which layout and why, one variable's layouts with their previews, what a
 * "Use it everywhere" switch would change, and what the context template editor
 * offers per laid-out key.
 *
 * Read-only. Every write goes through `entities/variableTemplates.ts`, which
 * owns the rows (P2); this module only reads. **In use** is the pub-level
 * answer — the pub's layout, else the variable's default, else none
 * (`layoutInUse`). A session's run can use another (`config/world.ts`): a
 * layout a template names, a ⏳ leftover pick, the preset's choice, or, with no
 * pub's layout, the pipeline's choice for a step. The variable page lists each
 * of those under **Where this differs**, so the screen says where the run
 * departs from it.
 *
 * ## How the template counts are made (W3)
 *
 * No engine-aware "names read" report exists, so a template's reads of a key
 * are taken from the template check itself: checked against an EMPTY scope,
 * every read of a root name is one `unknown-name` finding, in Handlebars and
 * Liquid alike, loop-bound names excluded by the checker. A `layout key "ref"`
 * call is also one such read (of its key), and `variableLayoutCalls` lists
 * exactly those calls. So a template reads a key **bare** when its reads of the
 * key outnumber its explicit calls naming it. A template in an engine the
 * checker cannot read (a plugin's) is counted apart as `unchecked`, never
 * guessed.
 */

import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	allVariables,
	getVariable,
	i18nText,
	sampleValues,
	type VariableDecl
} from "@serene-pub/sdk"
import {
	canCheckTemplateEngine,
	checkTemplateSourceReport,
	variableLayoutCalls
} from "@serene-pub/sdk/template-check"
import {
	declarationsAndVariableKeys,
	stepKeyFor,
	type VariableKey
} from "$lib/server/pipelines/config/panel"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import {
	renderVariable,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"
import {
	coreObjectLayouts,
	OBJECT_LAYOUT_NAME,
	objectLayoutSource,
	objectLayoutTemplateId
} from "$lib/server/pipelines/entities/objectVariableLayouts"
import {
	VARIABLE_SHELVES,
	variableShelfOf
} from "$lib/shared/utils/templateVariableShelves"

/** Why a variable is written out the way it is, with no session in view. */
export type VariableLayoutReasonWord =
	| "pub"
	| "default"
	| "automatic"
	| "as-written"

export interface LayoutInUse {
	id: number
	name: string
	reference: string | null
	reason: Exclude<VariableLayoutReasonWord, "as-written">
}

export interface VariableLayoutListRow {
	variableId: string
	/** The template key it renders under (its first scope root); null when it declares none. */
	key: string | null
	label: string
	description: string
	shelfId: string
	shelfLabel: string
	supplier: string
	/** Null with no layout row at all: the variable reads as written. */
	inUse: LayoutInUse | null
	reason: VariableLayoutReasonWord
	presetsDiffering: number
	layoutCount: number
}

export interface VariableLayoutRowView {
	id: number
	name: string
	ownerLabel: string
	reference: string | null
	engine: string
	isImmutable: boolean
	editable: boolean
	preview: string | null
	previewError: string | null
	inUse: boolean
	namedByTemplates: number
	chosenByPresets: { id: number; name: string }[]
}

export interface VariableLayoutView {
	variableId: string
	label: string
	description: string
	supplier: string
	scope: VariableDecl["scope"]
	sample: unknown
	default: { id: number; name: string } | null
	pubDiffersFromDefault: boolean
	inUse: LayoutInUse | null
	rows: VariableLayoutRowView[]
	/** Everything that writes this variable out with another layout than the one in use. */
	differs: VariableLayoutDifference[]
}

/** One thing that writes this variable out with another layout than the one in use. */
export type VariableLayoutDifference =
	| {
			kind: "template"
			id: number
			name: string
			layout: { id: number; name: string }
	  }
	| {
			kind: "leftover"
			specSlug: string
			pipelineLabel: string
			stepKey: string
			stepHeading?: string
			layout: { id: number; name: string }
	  }
	| {
			kind: "preset"
			id: number
			name: string
			layout: { id: number; name: string }
	  }
	| {
			kind: "authored"
			specSlug: string
			pipelineLabel: string
			stepKey: string
			stepHeading?: string
			layout: { id: number; name: string }
	  }

const SERENE_PUB = "Serene Pub"

// ── the registry's side ─────────────────────────────────────────────────

const labelOf = (decl: VariableDecl): string =>
	i18nText(decl.i18n?.name) ??
	decl.id.replace(/^.*:var\//, "").replace(/@\d+$/, "")

const descriptionOf = (decl: VariableDecl): string =>
	i18nText(decl.description) ?? i18nText(decl.i18n?.description) ?? ""

/** The root a variable's layout reads its value under — its first scope name. */
const rootOf = (decl: VariableDecl): string | undefined =>
	Object.keys(decl.scope ?? {})[0]

/** Who supplies each variable: core's are Serene Pub's, a plugin's carry its name. */
async function suppliersOf(
	db: Db,
	variableIds: string[]
): Promise<Map<string, string>> {
	const owners = variableIds.map((id) => id.split(":")[0]!)
	const { providedOwnerNames } = await import(
		"$lib/server/plugins/providedMarks"
	)
	const names = await providedOwnerNames(db, owners)
	return new Map(
		variableIds.map((id) => {
			const owner = id.split(":")[0]!
			return [
				id,
				owner === "core" ? SERENE_PUB : (names.get(owner) ?? owner)
			]
		})
	)
}

// ── the rows, presets and the run's resolution ──────────────────────────

type LayoutRow = typeof schema.pipelineVariableTemplates.$inferSelect

/** Every layout row a person may see: not withdrawn, not a disabled plugin's. */
async function liveRows(db: Db): Promise<LayoutRow[]> {
	const { disabledPlugins } = await import(
		"$lib/server/plugins/disabledPlugins"
	)
	const off = await disabledPlugins(db)
	const rows = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(isNull(schema.pipelineVariableTemplates.withdrawnAt))
		.orderBy(asc(schema.pipelineVariableTemplates.id))
	return (rows as LayoutRow[]).filter((r) => !off.owns(r.ownerPluginId))
}

interface PresetChoice {
	id: number
	name: string
	layouts: Record<string, string>
}

async function presetChoices(db: Db): Promise<PresetChoice[]> {
	const { disabledPlugins } = await import(
		"$lib/server/plugins/disabledPlugins"
	)
	const off = await disabledPlugins(db)
	const rows = await db
		.select({
			id: schema.sessionPresets.id,
			name: schema.sessionPresets.name,
			ownerPluginId: schema.sessionPresets.ownerPluginId,
			variableLayouts: schema.sessionPresets.variableLayouts
		})
		.from(schema.sessionPresets)
		.orderBy(asc(schema.sessionPresets.id))
	return (rows as any[])
		.filter((p) => !off.owns(p.ownerPluginId))
		.map((p) => {
			const v = p.variableLayouts
			const layouts =
				v && typeof v === "object" && !Array.isArray(v)
					? (Object.fromEntries(
							Object.entries(v).filter(
								([, r]) => typeof r === "string"
							)
						) as Record<string, string>)
					: {}
			return { id: p.id, name: p.name, layouts }
		})
}

let automaticSeedKeys: Set<string> | undefined
/** Whether the row is the code-derived automatic object layout of its variable. */
export function isAutomaticRow(
	row: LayoutRow,
	decl: VariableDecl | undefined
): boolean {
	if (!decl || row.name !== OBJECT_LAYOUT_NAME) return false
	const source = objectLayoutSource(decl)
	if (source === null || row.source !== source) return false
	automaticSeedKeys ??= new Set(coreObjectLayouts().map((t) => t.seedKey))
	if (row.seedKey && automaticSeedKeys.has(row.seedKey)) return true
	const owner = row.templateId?.split(":")[0]
	return (
		!!row.templateId &&
		!!owner &&
		row.templateId === objectLayoutTemplateId(owner, row.variableId)
	)
}

/**
 * The layout a variable is written out with at the pub level, no session in
 * view: the pub's layout, else the package default, else none. A session's run
 * may use another (see the module note); `variableLayoutView` lists those.
 */
async function layoutInUse(
	db: Db,
	variableId: string,
	rows: LayoutRow[]
): Promise<{ row: LayoutRow | null; reason: VariableLayoutReasonWord }> {
	const mine = rows.filter((r) => r.variableId === variableId)
	const pub = mine.find((r) => r.pubDefault)
	if (pub) return { row: pub, reason: "pub" }
	const { defaultVariableTemplateFor } = await import(
		"$lib/server/pipelines/boot/seedVariableTemplates"
	)
	const defaultId = await defaultVariableTemplateFor(db, variableId)
	const row = mine.find((r) => r.id === defaultId) ?? null
	if (!row) return { row: null, reason: "as-written" }
	return {
		row,
		reason: isAutomaticRow(row, getVariable(variableId))
			? "automatic"
			: "default"
	}
}

const inUseOf = (
	row: LayoutRow | null,
	reason: VariableLayoutReasonWord
): LayoutInUse | null =>
	row && reason !== "as-written"
		? {
				id: row.id,
				name: row.name,
				reference: row.reference ?? null,
				reason
			}
		: null

/** Presets whose own choice for the variable is a different resolvable layout. */
function presetsDiffering(
	presets: PresetChoice[],
	rows: LayoutRow[],
	variableId: string,
	inUseId: number | null
): number {
	let n = 0
	for (const p of presets) {
		const ref = p.layouts[variableId]
		if (!ref) continue
		const chosen = rows.find(
			(r) => r.variableId === variableId && r.reference === ref
		)
		if (chosen && chosen.id !== inUseId) n++
	}
	return n
}

// ── W1 ──────────────────────────────────────────────────────────────────

/** Every registered variable on its shelf, with what writes it out. */
export async function variableLayoutsList(
	db: Db
): Promise<VariableLayoutListRow[]> {
	const decls = allVariables()
	const rows = await liveRows(db)
	const presets = await presetChoices(db)
	const suppliers = await suppliersOf(
		db,
		decls.map((d) => d.id)
	)
	const out: VariableLayoutListRow[] = []
	for (const decl of decls) {
		const { row, reason } = await layoutInUse(db, decl.id, rows)
		const shelfId = variableShelfOf(rootOf(decl) ?? labelOf(decl))
		out.push({
			variableId: decl.id,
			key: rootOf(decl) ?? null,
			label: labelOf(decl),
			description: descriptionOf(decl),
			shelfId,
			shelfLabel:
				VARIABLE_SHELVES.find((s) => s.id === shelfId)?.label ??
				shelfId,
			supplier: suppliers.get(decl.id) ?? SERENE_PUB,
			inUse: inUseOf(row, reason),
			reason,
			presetsDiffering: presetsDiffering(
				presets,
				rows,
				decl.id,
				row?.id ?? null
			),
			layoutCount: rows.filter((r) => r.variableId === decl.id).length
		})
	}
	const shelfOrder = new Map(VARIABLE_SHELVES.map((s, i) => [s.id, i]))
	return out.sort(
		(a, b) =>
			(shelfOrder.get(a.shelfId) ?? 99) -
				(shelfOrder.get(b.shelfId) ?? 99) ||
			a.label.localeCompare(b.label)
	)
}

// ── which keys each node type's steps render ────────────────────────────

/** Node type → key → variable id, from the node registry's `variables` slots. */
async function renderedKeysByNodeType(
	db: Db
): Promise<Map<string, Map<string, string>>> {
	const out = new Map<string, Map<string, string>>()
	const registry = (await db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.orderBy(asc(schema.pipelineDefinitionRegistry.id))) as any[]
	for (const r of registry) {
		const keys = new Map<string, string>()
		for (const decl of Object.values(
			(r.slots ?? {}) as Record<
				string,
				{ kind?: string; renders?: Record<string, string> }
			>
		))
			if (decl?.kind === "variables")
				for (const [key, variableId] of Object.entries(
					decl.renders ?? {}
				))
					keys.set(key, variableId)
		// The newest row of a type answers; an older version's keys are history.
		if (keys.size || !out.has(r.definitionId)) out.set(r.definitionId, keys)
	}
	return out
}

/**
 * Every active step that renders a variable: spec, step, slot and key, with the
 * node type — what both counts and the leftover check walk.
 */
interface RenderingStep {
	specSlug: string
	nodeKey: string
	slot: string
	path: string
	variableId: string
	definitionId: string
	specId: number
	specName: string
	specVersionId: number
	/** The step's key as the panel declares it, for the run's own reads. */
	key: VariableKey
	/** The panel's heading for the step, when it declares one. */
	heading?: string
}

interface PublishedSteps {
	steps: RenderingStep[]
	/** Spec slug → every node type the pipeline has. */
	nodeTypes: Map<string, Set<string>>
}

async function renderingSteps(db: Db): Promise<PublishedSteps> {
	const { disabledPlugins } = await import(
		"$lib/server/plugins/disabledPlugins"
	)
	const off = await disabledPlugins(db)
	const specs = (await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))) as any[]
	const steps: RenderingStep[] = []
	const nodeTypes = new Map<string, Set<string>>()
	for (const spec of specs) {
		if (off.owns(spec.sourcePluginId) || !spec.activeVersionId) continue
		const { decls, variableKeys } = await declarationsAndVariableKeys(
			db,
			spec.activeVersionId
		)
		const nodes = await db
			.select({
				nodeKey: schema.pipelineNodes.nodeKey,
				definitionId: schema.pipelineNodes.definitionId
			})
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
		nodeTypes.set(spec.slug, new Set(nodes.map((n) => n.definitionId)))
		const typeOf = new Map(nodes.map((n) => [n.nodeKey, n.definitionId]))
		for (const k of variableKeys) {
			const decl = decls.find((d) => d.nodeKey === k.nodeKey)
			steps.push({
				specSlug: spec.slug,
				nodeKey: k.nodeKey,
				slot: k.slot,
				path: k.path,
				variableId: k.variableId,
				definitionId: typeOf.get(k.nodeKey) ?? "",
				specId: spec.id,
				specName: spec.name,
				specVersionId: spec.activeVersionId,
				key: k,
				...(decl ? { heading: decl.stepHeading ?? decl.typeLabel } : {})
			})
		}
	}
	return { steps, nodeTypes }
}

/** The variables the active versions of these pipelines render: distinct, sorted by id. */
export async function variablesRenderedByPipelines(
	db: Db,
	specSlugs: Iterable<string>
): Promise<string[]> {
	const slugs = new Set(specSlugs)
	const { steps } = await renderingSteps(db)
	return [
		...new Set(
			steps.filter((s) => slugs.has(s.specSlug)).map((s) => s.variableId)
		)
	].sort()
}

/**
 * Node type → key → variable id: what a context template of that type can
 * read as a laid-out key. A template's step (the one whose prompt it builds)
 * is not the step that renders its keys — Assemble's template reads
 * `characters`, which the context builder upstream renders — so a type gets
 * its own `variables` slots' keys (the node registry) and every key rendered
 * anywhere in a pipeline that has a node of that type.
 */
async function keysByNodeType(
	db: Db,
	published: PublishedSteps
): Promise<Map<string, Map<string, string>>> {
	const map = await renderedKeysByNodeType(db)
	for (const [slug, types] of published.nodeTypes) {
		const rendered = published.steps.filter((s) => s.specSlug === slug)
		for (const type of types) {
			const keys = map.get(type) ?? new Map<string, string>()
			for (const s of rendered)
				if (!keys.has(s.path)) keys.set(s.path, s.variableId)
			map.set(type, keys)
		}
	}
	return map
}

// ── context template scan ───────────────────────────────────────────────

interface ScannedTemplate {
	id: number
	name: string
	checked: boolean
	/** key → how many reads the template makes of it. */
	reads: Map<string, number>
	/** key → references named for it by explicit `layout` calls. */
	calls: { key: string; reference: string }[]
	nodeDefinitionId: string
}

async function scanContextTemplates(db: Db): Promise<ScannedTemplate[]> {
	const { disabledPlugins } = await import(
		"$lib/server/plugins/disabledPlugins"
	)
	const off = await disabledPlugins(db)
	const rows = (await db
		.select()
		.from(schema.pipelineContextTemplates)
		.orderBy(asc(schema.pipelineContextTemplates.id))) as any[]
	const out: ScannedTemplate[] = []
	for (const t of rows) {
		if (off.owns(t.ownerPluginId)) continue
		const engine = t.engine ?? CORE_TEMPLATE_ENGINE
		const source = t.source ?? ""
		if (!canCheckTemplateEngine(engine)) {
			out.push({
				id: t.id,
				name: t.name,
				checked: false,
				reads: new Map(),
				calls: [],
				nodeDefinitionId: t.nodeDefinitionId
			})
			continue
		}
		const report = checkTemplateSourceReport(engine, source, {})
		const reads = new Map<string, number>()
		for (const f of report.findings)
			if (f.kind === "unknown-name" && f.name)
				reads.set(f.name, (reads.get(f.name) ?? 0) + 1)
		out.push({
			id: t.id,
			name: t.name,
			checked: report.checked,
			reads,
			calls: variableLayoutCalls(engine, source),
			nodeDefinitionId: t.nodeDefinitionId
		})
	}
	return out
}

// ── every use of a layout row ───────────────────────────────────────────

/** What uses one layout row, apart from a pipeline step's leftover pick. */
export interface LayoutRowUses {
	/** The row is the pub's layout for its variable. */
	pub: boolean
	/** Presets whose variable layouts choose the row by reference. */
	presets: { id: number; name: string }[]
	/** Context templates naming the row's reference in a `layout` call for a key that renders its variable. */
	namedBy: { id: number; name: string }[]
}

/**
 * The one rule for "who uses this layout": W2's per-row counts and the
 * library's *Used by* both read it here.
 */
export async function layoutRowUses(
	db: Db,
	rows: Pick<LayoutRow, "id" | "variableId" | "reference" | "pubDefault">[]
): Promise<Map<number, LayoutRowUses>> {
	const presets = await presetChoices(db)
	const steps = await renderingSteps(db)
	const keysOf = await keysByNodeType(db, steps)
	const scanned = await scanContextTemplates(db)
	const out = new Map<number, LayoutRowUses>()
	for (const r of rows) {
		const ref = r.reference
		const namedBy: { id: number; name: string }[] = []
		if (ref)
			for (const t of scanned) {
				const mineKeys = keysOf.get(t.nodeDefinitionId)
				if (!mineKeys) continue
				if (
					t.calls.some(
						(c) =>
							c.reference === ref &&
							mineKeys.get(c.key) === r.variableId
					)
				)
					namedBy.push({ id: t.id, name: t.name })
			}
		out.set(r.id, {
			pub: !!r.pubDefault,
			presets: presets
				.filter((p) => !!ref && p.layouts[r.variableId] === ref)
				.map((p) => ({ id: p.id, name: p.name })),
			namedBy
		})
	}
	return out
}

// ── W2 ──────────────────────────────────────────────────────────────────

/** Why a variable cannot be shown: nothing registered declares it. */
export class UnknownVariableError extends Error {}

const unknownVariable = (variableId: string) =>
	new UnknownVariableError(
		`Nothing on this pub declares '${variableId}', so it has no variable layouts to show. ` +
			`A plugin's variables go away while the plugin is switched off.`
	)

/** One variable's page: what it is, its layouts with previews, and who chose which. */
export async function variableLayoutView(
	db: Db,
	variableId: string,
	secret: string
): Promise<VariableLayoutView> {
	const decl = getVariable(variableId)
	if (!decl) throw unknownVariable(variableId)

	const rows = await liveRows(db)
	const mine = rows.filter((r) => r.variableId === variableId)
	const { row: inUseRow, reason } = await layoutInUse(db, variableId, rows)
	const { defaultVariableTemplateFor } = await import(
		"$lib/server/pipelines/boot/seedVariableTemplates"
	)
	const defaultId = await defaultVariableTemplateFor(db, variableId)
	const defaultRow = mine.find((r) => r.id === defaultId) ?? null
	const pub = mine.find((r) => r.pubDefault) ?? null

	const supplier =
		(await suppliersOf(db, [variableId])).get(variableId) ?? SERENE_PUB
	const pluginNames = new Map<number, string>()
	const owners = [
		...new Set(mine.map((r) => r.ownerPluginId).filter((v) => v != null))
	]
	if (owners.length) {
		const plugins = await db
			.select({
				id: schema.plugins.id,
				name: schema.plugins.name,
				pluginId: schema.plugins.pluginId
			})
			.from(schema.plugins)
		for (const p of plugins) pluginNames.set(p.id, p.name || p.pluginId)
	}

	const uses = await layoutRowUses(db, mine)

	const root = rootOf(decl)
	const sample = root ? sampleValues(decl)[root] : undefined
	const rowViews: VariableLayoutRowView[] = []
	for (const r of mine) {
		let preview: string | null = null
		let previewError: string | null = null
		if (!root) {
			previewError =
				"This variable declares nothing for a layout to read."
		} else {
			try {
				const layouts: ResolvedLayouts = {
					[root]: {
						variableId,
						engine: r.engine ?? CORE_TEMPLATE_ENGINE,
						source: r.source ?? "",
						name: r.name
					}
				}
				preview = await renderVariable(layouts, root, sample)
			} catch (err: any) {
				previewError = String(err?.message ?? err)
			}
		}
		rowViews.push({
			id: r.id,
			name: r.name,
			ownerLabel:
				r.ownerPluginId != null
					? (pluginNames.get(r.ownerPluginId) ?? "A plugin")
					: r.isImmutable || r.seedKey
						? SERENE_PUB
						: "This pub",
			reference: r.reference ?? null,
			engine: r.engine ?? CORE_TEMPLATE_ENGINE,
			isImmutable: !!r.isImmutable,
			editable: !r.isImmutable && r.ownerPluginId == null && !r.seedKey,
			preview,
			previewError,
			inUse: r.id === inUseRow?.id,
			namedByTemplates: uses.get(r.id)!.namedBy.length,
			chosenByPresets: uses.get(r.id)!.presets
		})
	}

	return {
		variableId,
		label: labelOf(decl),
		description: descriptionOf(decl),
		supplier,
		scope: decl.scope,
		sample,
		default: defaultRow
			? { id: defaultRow.id, name: defaultRow.name }
			: null,
		pubDiffersFromDefault: !!pub && pub.id !== defaultRow?.id,
		inUse: inUseOf(inUseRow, reason),
		rows: rowViews,
		differs: await differencesOf(
			db,
			variableId,
			secret,
			mine,
			inUseRow,
			!!pub,
			uses
		)
	}
}

/**
 * Everything that writes the variable out with a layout row other than the one
 * in use, in the run's order — template, leftover, preset, authored — then by
 * name, or pipeline and step. Presets and templates are read from `layoutRowUses`
 * (the one rule for who uses a row); a leftover pick from the stored picks; the
 * author's choice only while the pub has no layout of its own, since the pub's
 * beats it in the run.
 */
async function differencesOf(
	db: Db,
	variableId: string,
	secret: string,
	mine: LayoutRow[],
	inUseRow: LayoutRow | null,
	pubHasOwn: boolean,
	uses: Map<number, LayoutRowUses>
): Promise<VariableLayoutDifference[]> {
	if (!mine.length) return []
	const inUseId = inUseRow?.id ?? null
	const other = mine.filter((r) => r.id !== inUseId)
	const layoutOf = (r: LayoutRow) => ({ id: r.id, name: r.name })
	const byName = (a: string, b: string) => a.localeCompare(b)

	const templates: Extract<VariableLayoutDifference, { kind: "template" }>[] =
		[]
	const presets: Extract<VariableLayoutDifference, { kind: "preset" }>[] = []
	for (const r of other) {
		const u = uses.get(r.id)
		for (const t of u?.namedBy ?? [])
			templates.push({
				kind: "template",
				id: t.id,
				name: t.name,
				layout: layoutOf(r)
			})
		for (const p of u?.presets ?? [])
			presets.push({
				kind: "preset",
				id: p.id,
				name: p.name,
				layout: layoutOf(r)
			})
	}
	const byThing = (
		a: { name: string; layout: { name: string } },
		b: { name: string; layout: { name: string } }
	) => byName(a.name, b.name) || byName(a.layout.name, b.layout.name)
	templates.sort(byThing)
	presets.sort(byThing)

	const { steps } = await renderingSteps(db)
	const mineSteps = steps.filter((s) => s.variableId === variableId)
	const labels = await (
		await import("$lib/server/pipelines/entities/pipelineLabels")
	).pipelineLabelsById(db)
	const where = (s: RenderingStep) => ({
		specSlug: s.specSlug,
		pipelineLabel: labels.get(s.specId) ?? s.specName,
		stepKey: stepKeyFor(secret, s.nodeKey),
		...(s.heading ? { stepHeading: s.heading } : {})
	})
	const place = (d: { pipelineLabel: string; stepHeading?: string }) =>
		`${d.pipelineLabel}\u0000${d.stepHeading ?? ""}`
	const byStep = (
		a: {
			pipelineLabel: string
			stepHeading?: string
			layout: { name: string }
		},
		b: {
			pipelineLabel: string
			stepHeading?: string
			layout: { name: string }
		}
	) => byName(place(a), place(b)) || byName(a.layout.name, b.layout.name)

	const leftovers: Extract<VariableLayoutDifference, { kind: "leftover" }>[] =
		[]
	if (mineSteps.length && other.length) {
		const held = await leftoverAddresses(db, [
			...new Set(mineSteps.map((s) => s.slot))
		])
		const seen = new Set<string>()
		for (const s of mineSteps)
			for (const id of held.get(
				`${s.specSlug}\u0000${s.nodeKey}\u0000${s.slot}\u0000${s.path}`
			) ?? []) {
				const r = other.find((o) => o.id === id)
				const at = `${s.specSlug}\u0000${s.nodeKey}\u0000${id}`
				if (!r || seen.has(at)) continue
				seen.add(at)
				leftovers.push({
					kind: "leftover",
					...where(s),
					layout: layoutOf(r)
				})
			}
	}
	leftovers.sort(byStep)

	const authored: Extract<VariableLayoutDifference, { kind: "authored" }>[] =
		[]
	if (!pubHasOwn && mineSteps.length && other.length) {
		const { declaredVariableLayouts } = await import(
			"$lib/server/pipelines/config/named"
		)
		const seen = new Set<string>()
		for (const s of mineSteps) {
			const named = await declaredVariableLayouts(
				db,
				s.specSlug,
				s.specVersionId,
				[s.key]
			)
			for (const id of named.values()) {
				const r = other.find((o) => o.id === id)
				const at = `${s.specSlug}\u0000${s.nodeKey}\u0000${id}`
				if (!r || seen.has(at)) continue
				seen.add(at)
				authored.push({
					kind: "authored",
					...where(s),
					layout: layoutOf(r)
				})
			}
		}
	}
	authored.sort(byStep)

	return [...templates, ...leftovers, ...presets, ...authored]
}

/**
 * Said after the pub's layout changes: the presets that decide for themselves
 * keep doing so, so the change does not reach their sessions (P1: nothing
 * hidden). Empty when none differ.
 */
export async function presetsKeepingTheirOwn(
	db: Db,
	variableId: string
): Promise<string[]> {
	const rows = await liveRows(db)
	const { row } = await layoutInUse(db, variableId, rows)
	const names = (await presetChoices(db))
		.filter((p) => {
			const ref = p.layouts[variableId]
			const chosen = ref
				? rows.find(
						(r) =>
							r.variableId === variableId && r.reference === ref
					)
				: undefined
			return !!chosen && chosen.id !== (row?.id ?? null)
		})
		.map((p) => p.name)
	return names.length
		? [
				`${names.length === 1 ? "This preset keeps" : "These presets keep"} its own variable layout for ` +
					`${labelOf(getVariable(variableId)!)}: ${names.map((n) => `'${n}'`).join(", ")}. ` +
					`Sessions on ${names.length === 1 ? "it" : "them"} are not changed by the pub's choice.`
			]
		: []
}

// ── W3: what "Use it everywhere" would change ───────────────────────────

export interface UseEverywhereCounts {
	variableId: string
	/** Pipelines with a step that renders the variable and no leftover pick on it. */
	pipelines: number
	/** Context templates that read the variable's key bare somewhere. */
	contextTemplates: number
	/** Context templates in a language the check cannot read: not counted either way. */
	uncheckedContextTemplates: number
}

/**
 * Leftover picks (⏳): a numeric value stored at a variables slot's key. Each
 * address holds the layout row id(s) picked there (a numeric string counts as
 * its number).
 */
async function leftoverAddresses(
	db: Db,
	slots: string[]
): Promise<Map<string, Set<number>>> {
	const out = new Map<string, Set<number>>()
	if (!slots.length) return out
	const isPick = (v: unknown) =>
		typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))
	const keep = (address: string, v: unknown) => {
		const held = out.get(address) ?? new Set<number>()
		held.add(Number(v))
		out.set(address, held)
	}
	const at = (slug: string, nodeKey: string, slot: string, path: string) =>
		`${slug}\u0000${nodeKey}\u0000${slot}\u0000${path}`

	const specs = (await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug
		})
		.from(schema.pipelineSpecs)) as Array<{ id: number; slug: string }>
	const slugOfId = new Map(specs.map((s) => [s.id, s.slug]))

	for (const o of (await db
		.select()
		.from(schema.pipelineNodeOverrides)) as any[]) {
		const slug = slugOfId.get(o.specId)
		if (slug && slots.includes(o.slot) && isPick(o.value))
			keep(at(slug, o.nodeKey, o.slot, o.path ?? ""), o.value)
	}

	const { registrationValueRefs } = await import(
		"$lib/server/pipelines/registrations/values"
	)
	const { baseKeyOf } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const regs = (await db
		.select({
			id: schema.registrations.id,
			key: schema.registrations.key,
			specSlug: schema.registrations.specSlug
		})
		.from(schema.registrations)) as Array<{
		id: number
		key: string
		specSlug: string | null
	}>
	const slugOfKey = new Map<string, string>()
	for (const r of regs)
		if (r.specSlug && !slugOfKey.has(r.key))
			slugOfKey.set(r.key, r.specSlug)
	const slugOfRow = new Map(
		regs.map((r) => [
			r.id,
			r.specSlug ?? slugOfKey.get(baseKeyOf(r.key)) ?? null
		])
	)
	for (const ref of await registrationValueRefs(db, slots)) {
		if (!isPick(ref.value)) continue
		const slug =
			ref.scopeKind === "instance"
				? ref.scopeRef
				: slugOfRow.get(ref.rowId)
		if (slug)
			keep(at(slug, ref.nodeKey, ref.slot, ref.path ?? ""), ref.value)
	}
	return out
}

/**
 * The counts behind the W3 sentence *Every template that writes {{{key}}}
 * without naming a layout uses this one: N pipelines, M templates*.
 *
 * Pipelines: distinct active pipelines with at least one step rendering the
 * variable whose address no leftover pick holds (a held step keeps its pick,
 * so it does not change). Templates: see the module note.
 */
export async function useEverywhereCounts(
	db: Db,
	variableId: string
): Promise<UseEverywhereCounts> {
	if (!getVariable(variableId)) throw unknownVariable(variableId)
	const steps = await renderingSteps(db)
	const mineSteps = steps.steps.filter((s) => s.variableId === variableId)
	const held = await leftoverAddresses(db, [
		...new Set(mineSteps.map((s) => s.slot))
	])
	const changing = new Set<string>()
	for (const s of mineSteps)
		if (
			!held.has(
				`${s.specSlug}\u0000${s.nodeKey}\u0000${s.slot}\u0000${s.path}`
			)
		)
			changing.add(s.specSlug)

	const keysOf = await keysByNodeType(db, steps)
	let bare = 0
	let unchecked = 0
	for (const t of await scanContextTemplates(db)) {
		const keys = [...(keysOf.get(t.nodeDefinitionId) ?? [])]
			.filter(([, v]) => v === variableId)
			.map(([k]) => k)
		if (!keys.length) continue
		if (!t.checked) {
			unchecked++
			continue
		}
		if (
			keys.some(
				(k) =>
					(t.reads.get(k) ?? 0) >
					t.calls.filter((c) => c.key === k).length
			)
		)
			bare++
	}
	return {
		variableId,
		pipelines: changing.size,
		contextTemplates: bare,
		uncheckedContextTemplates: unchecked
	}
}

// ── W5: the template editor ─────────────────────────────────────────────

export interface TemplateVariableLayoutKey {
	key: string
	variableId: string
	variableLabel: string
	/** Null when no row resolves: the variable is written by its floor. */
	inUse: LayoutInUse | null
	/** Every non-withdrawn layout with a reference, in the shape the SDK's offers take. */
	offers: { reference: string; label: string }[]
}

/** What the template editor is looking at: a node type, or a step of a pipeline. */
export type TemplateVariableLayoutsTarget =
	| { nodeType: string }
	| { specSlug: string; stepKey: string }

export class UnknownTemplateTargetError extends Error {}

/**
 * The node key whose opaque handle (`ConfigOption.step.key`) is `stepKey`, among
 * the nodes of one spec version — or null. A search: mint the handle of every
 * node and compare; a handle is never decoded (the panel carries no topology).
 */
export async function locateStep(
	db: Db,
	secret: string,
	specVersionId: number,
	stepKey: string
): Promise<string | null> {
	const nodes = await db
		.select({ nodeKey: schema.pipelineNodes.nodeKey })
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
	return (
		nodes.find((n) => stepKeyFor(secret, n.nodeKey) === stepKey)?.nodeKey ??
		null
	)
}

/**
 * Each laid-out key a context template can read, with the layout it is written
 * with (pub's, else default, else floor — no session is in view) and the
 * references it may name. The library asks by node type; a step by pipeline and
 * the panel's opaque step handle (`secret` is needed only for that form). A step
 * target also answers the step's heading as the panel shows it.
 */
export async function templateVariableLayouts(
	db: Db,
	target: TemplateVariableLayoutsTarget,
	secret: string
): Promise<{ keys: TemplateVariableLayoutKey[]; stepHeading?: string }> {
	let keys: Array<[string, string]>
	let stepHeading: string | undefined
	if ("nodeType" in target) {
		const byType = await keysByNodeType(db, await renderingSteps(db))
		const found = byType.get(target.nodeType)
		if (!found)
			throw new UnknownTemplateTargetError(
				`No step type '${target.nodeType}' is published on this pub.`
			)
		keys = [...found]
	} else {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, target.specSlug))
			.limit(1)
		if (!spec?.activeVersionId)
			throw new UnknownTemplateTargetError(
				`No pipeline '${target.specSlug}' is published on this pub.`
			)
		const nodeKey = await locateStep(
			db,
			secret,
			spec.activeVersionId,
			target.stepKey
		)
		if (nodeKey === null)
			throw new UnknownTemplateTargetError(
				`That step is not part of the pipeline '${target.specSlug}'. A newer version may have removed it, or the link was made on a different install.`
			)
		const { decls, variableKeys } = await declarationsAndVariableKeys(
			db,
			spec.activeVersionId
		)
		// The panel's `ConfigOption.step.heading` for this step, the same rule.
		const decl = decls.find((d) => d.nodeKey === nodeKey)
		stepHeading = decl ? (decl.stepHeading ?? decl.typeLabel) : undefined
		const ofStep = variableKeys.filter((k) => k.nodeKey === nodeKey)
		// The step's own keys first, then every other key the pipeline renders:
		// a template reads what an upstream step laid out (Assemble reads the
		// context builder's `characters`), and the step has no key of its own
		// for those.
		const seen = new Set(ofStep.map((k) => k.path))
		keys = [
			...ofStep,
			...variableKeys.filter(
				(k) =>
					k.nodeKey !== nodeKey &&
					!seen.has(k.path) &&
					seen.add(k.path)
			)
		].map((k) => [k.path, k.variableId])
	}

	const rows = await liveRows(db)
	const out: TemplateVariableLayoutKey[] = []
	for (const [key, variableId] of keys) {
		const decl = getVariable(variableId)
		if (!decl) continue
		const { row, reason } = await layoutInUse(db, variableId, rows)
		out.push({
			key,
			variableId,
			variableLabel: labelOf(decl),
			inUse: inUseOf(row, reason),
			offers: rows
				.filter((r) => r.variableId === variableId && !!r.reference)
				.map((r) => ({ reference: r.reference!, label: r.name }))
		})
	}
	return { keys: out, ...(stepHeading ? { stepHeading } : {}) }
}
