/**
 * The admin workspace's read — every authored thing a pipeline uses, at once.
 *
 * The config panel answers "what is this pipeline set to". This answers the
 * other question, the one the panel structurally cannot: *what exists, and what
 * is using it.* Those are different jobs and want different shapes — a panel is
 * per-pipeline and narrows to one option at a time, and a library is per-entity
 * and has to show the rows nobody has selected anywhere.
 *
 * ## `usedBy` is the point
 *
 * Every authored row here is shared on purpose — prompts as of the pool change,
 * context templates and variable layouts all along — which makes "may I delete
 * this" genuinely unanswerable from inside one pipeline's settings, since the
 * thing holding a row is routinely somewhere the person looking is not. The
 * delete refusal already says *that* something holds it; this says *what*,
 * before they try. Prompts used to be the exception ("namespaced, so it is only
 * ever yours"); they are not any more, and this page is where that shows.
 *
 * ## Every list is grouped by its pool, and a pool names its language
 *
 * A prompt's pool is `(node type, slot)`; a template's is `(node type, engine)`
 * and a layout's `(variable, engine)`. The engine is in the pool for the reason
 * `contextTemplates.ts` gives, and it has to be in the *heading* for a smaller
 * one: two pools rendered under one heading would interleave each language's
 * rows into the other's, and the only way to tell them apart on the page would
 * be to read the markup.
 *
 * Read-only. Every mutation keeps going through the entity modules, which is
 * where the rules that make a selection meaningful already live.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	declarations,
	humanizeTypeId,
	type Decl
} from "$lib/server/pipelines/config/panel"
import {
	getGenre,
	getVariable,
	i18nText,
	seamsOf,
	type ScriptPointDecl,
	type TemplateScope
} from "@serene-pub/sdk"
import type { ChainRow } from "$lib/server/pipelines/config/chainAddresses"
import {
	contextPoolKeyFor,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import { pipelineLabelsById } from "$lib/server/pipelines/entities/pipelineLabels"
import {
	CORE_TEMPLATE_ENGINE,
	knownEngines
} from "$lib/server/pipelines/prompt/renderers"
import { acceptedEnginesOf } from "$lib/shared/pipelines/templateEngines"

/**
 * An engine id as the name of a language, for a heading.
 *
 * `core:template/handlebars@1` is a pinned id nobody chose; "Handlebars" is
 * what somebody scanning a page of headings can actually use. Falls back to the
 * raw id when the shape is unfamiliar — a plugin may publish anything, and a
 * confident wrong guess in a heading is worse than an id.
 */
const languageOf = (engineId: string): string => {
	const name = engineId.split("/")[1]?.split("@")[0]
	if (!name) return engineId
	return name.charAt(0).toUpperCase() + name.slice(1)
}

export interface LibraryPipeline {
	slug: string
	name: string
	/**
	 * The name with its genre beside it ("Reply · Adventure"), the string
	 * `usedBy` and `origin` name this pipeline by (`pipelineLabelsById`).
	 */
	label: string
	version: string | null
	status: string | null
	nodeCount: number
	/**
	 * The prompt pools (`<node type>#<slot>`) this pipeline's active version
	 * declares a prompts slot for — the prompts it can offer. Admin › Prompts
	 * filters by pipeline on this, so "this pipeline's prompts" means every
	 * prompt valid for one of its steps, not only the ones picked today.
	 */
	promptPools: string[]
	/**
	 * The seams this pipeline's active version declares — every place a
	 * script chain may run, in run order per step (`seamsOf`), with the
	 * script kinds each accepts. Admin › Scripts' fits filters read this the
	 * way Admin › Prompts reads `promptPools`: a script fits a seam when its
	 * kind is in `accepts` (PLAN-script-placement D5).
	 */
	scriptSeams: LibraryScriptSeam[]
	/**
	 * The genres whose presets bind this pipeline to an event, by id and
	 * name. Admin › Prompts' genre filter is pipeline → genre through here.
	 */
	genres: { id: string; name: string }[]
}

/** One seam of one step of a pipeline (PLAN-script-placement D1). */
export interface LibraryScriptSeam {
	nodeKey: string
	/** The step's heading, as the settings panel names it. */
	stepLabel: string
	/** The seam address: `in:<port>` · `out:<port>` · `<pointKey>`. */
	at: string
	/** Pinned script kind ids the seam accepts. */
	accepts: string[]
}

/** A step's registry row and heading, keyed by node key. */
export interface StepSeams {
	/** Node key → the registry row its definition pins, and its heading. */
	nodes: Map<string, { row: ChainRow | null; stepLabel: string }>
	/** Every declared seam of the version, step by step, in run order. */
	seams: LibraryScriptSeam[]
}

/**
 * The seams a spec version declares, read off its nodes' registry rows with
 * `seamsOf` — the one reader of placement (D1) — plus each step's heading.
 *
 * `decls` are the version's declarations when the caller already has them
 * (`libraryView` does), for the headings; `byPin` the registry rows keyed
 * `<definitionId>@<version>`, so a walk over every pipeline reads the
 * registry once.
 */
export async function stepSeamsOf(
	db: Db,
	specVersionId: number,
	opts: { decls?: Decl[]; byPin?: Map<string, any> } = {}
): Promise<StepSeams> {
	const decls = opts.decls ?? (await declarations(db, specVersionId))
	const byPin =
		opts.byPin ??
		new Map<string, any>(
			((await db.select().from(schema.pipelineDefinitionRegistry)) as any[]).map(
				(r) => [`${r.definitionId}@${r.version}`, r]
			)
		)
	const headingOf = new Map<string, string>()
	for (const d of decls)
		if (!headingOf.has(d.nodeKey))
			headingOf.set(d.nodeKey, d.stepHeading ?? d.typeLabel)
	const nodes = (await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, specVersionId))
		.orderBy(asc(schema.pipelineNodes.position))) as any[]
	const out: StepSeams = { nodes: new Map(), seams: [] }
	for (const node of nodes) {
		const row = byPin.get(`${node.definitionId}@${node.definitionVersion}`) ?? null
		const stepLabel =
			headingOf.get(node.nodeKey) ??
			(row ? i18nText(row.i18n?.name) : undefined) ??
			humanizeTypeId(node.definitionId)
		out.nodes.set(node.nodeKey, { row, stepLabel })
		if (!row) continue
		for (const seam of seamsOf({
			slots: (row.slots ?? {}) as Record<string, unknown>,
			scriptPoints: (row.scriptPoints ?? []) as ScriptPointDecl[]
		}))
			out.seams.push({
				nodeKey: node.nodeKey,
				stepLabel,
				at: seam.at,
				accepts: [...seam.accepts]
			})
	}
	return out
}

/**
 * Pipeline → genre, through the presets that bind it (a withdrawn preset's
 * genre still counts: its rows are still on the instance). Keyed by spec
 * slug; each value is genre id → name. Admin › Prompts and Admin › Scripts
 * both filter by genre through here.
 */
export async function pipelineGenresBySlug(
	db: Db
): Promise<Map<string, Map<string, string>>> {
	const genresBySlug = new Map<string, Map<string, string>>()
	for (const preset of (await db.select().from(schema.sessionPresets)) as any[]) {
		const genreId = preset.genreId as string
		const name = (() => {
			const g = getGenre(genreId)
			return (g && i18nText(g.name)) || genreId
		})()
		for (const b of Object.values(
			(preset.bindings ?? {}) as Record<string, { spec?: string } | null>
		)) {
			if (!b?.spec) continue
			const m = genresBySlug.get(b.spec) ?? new Map<string, string>()
			m.set(genreId, name)
			genresBySlug.set(b.spec, m)
		}
	}
	return genresBySlug
}

/** One pipeline's seams and genres — what Admin › Scripts' fits read. */
export interface PipelineScriptSeams {
	specId: number
	slug: string
	label: string
	/** Owned by a switched-off plugin (R67): not offered as a fit. */
	disabled: boolean
	nodes: StepSeams["nodes"]
	seams: LibraryScriptSeam[]
	genres: { id: string; name: string }[]
}

/**
 * Every pipeline's seams, active version, with its genres — one walk shared
 * by the script usage index (which steps a stored chain sits on) and the
 * fits (which seams a script's kind is accepted at).
 */
export async function pipelineScriptSeams(db: Db): Promise<PipelineScriptSeams[]> {
	const specs = (await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))) as any[]
	const labels = await pipelineLabelsById(db)
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	const genresBySlug = await pipelineGenresBySlug(db)
	const byPin = new Map<string, any>(
		((await db.select().from(schema.pipelineDefinitionRegistry)) as any[]).map(
			(r) => [`${r.definitionId}@${r.version}`, r]
		)
	)
	const out: PipelineScriptSeams[] = []
	for (const spec of specs) {
		const steps: StepSeams = spec.activeVersionId
			? await stepSeamsOf(db, spec.activeVersionId, { byPin })
			: { nodes: new Map(), seams: [] }
		out.push({
			specId: spec.id,
			slug: spec.slug,
			label: labels.get(spec.id) ?? spec.name,
			disabled: off.owns(spec.sourcePluginId),
			nodes: steps.nodes,
			seams: steps.seams,
			genres: [...(genresBySlug.get(spec.slug) ?? new Map())]
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name))
		})
	}
	return out
}

export interface LibraryPrompt {
	id: number
	/**
	 * The pool: `<node type>#<slot>`, via `promptPoolKeyFor`.
	 *
	 * Replaces `specSlug`/`specName` as this row's identity, and the change is
	 * the whole point of the pool refactor seen from the library: "which
	 * pipeline is this prompt's" no longer has an answer, because a prompt
	 * follows its node into every pipeline that reuses it. Where it was
	 * *written* survives as `origin`, which is a fact about its history rather
	 * than a claim about its scope.
	 */
	poolId: string
	/** That pool, said the way a person would say it: step name plus slot. */
	poolLabel: string
	/** The pipeline it was authored in, when it records one. */
	origin?: string
	name: string
	isImmutable: boolean
	/** 🚧 R54: hidden from session owners' prompt choice — an administrator's switch. */
	hidden: boolean
	fields: Record<string, string>
	/**
	 * Text for fields the slot no longer declares.
	 *
	 * Shown apart and read-only. Left folded into `fields` it would be
	 * invisible — every editor renders one box per *declared* field — so a
	 * prompt somebody spent an afternoon on would be unfindable rather than
	 * merely unused. This is the "reference/copy it later" half of the ruling.
	 */
	archived: Record<string, string>
	/** Pipelines currently pointing at it, by `LibraryPipeline.label`. */
	usedBy: string[]
}

export interface LibraryTemplate {
	id: number
	name: string
	source: string
	/** Never null: the column is NOT NULL on both template tables now. */
	engine: string
	isImmutable: boolean
	/** The pool's first half — a node type id, or a variable id. */
	poolId: string
	/**
	 * That pool, said the way a person would say it — and it **names the
	 * language**. The pool is `(what it renders, which language)`, so a label
	 * that named only the node would put a Jinja row and a Handlebars row under
	 * one heading with no way to tell which was which but reading the markup.
	 */
	poolLabel: string
	/** The pipeline it was authored in, when it records one. */
	origin?: string
	usedBy: string[]
}

/**
 * A pool that exists because some node declares it, whether or not it has rows.
 *
 * `id` is the **whole** pool key — `<node type>#<slot>` for a prompt,
 * `<node type or variable>#<engine>` for a template — because that is what the
 * page groups on. A row's own `poolId` carries only the first half, with the
 * second on the row beside it (`slot` is implicit in the prompt's key, `engine`
 * is a field on a template), so a caller that needs the halves separately —
 * creating a row in an empty pool — splits this on `#`. Neither half contains
 * one; both contain colons, which is why the separator is not `:`.
 */
export interface LibraryPool {
	id: string
	label: string
	/**
	 * A context pool only: the node definition's own declared template names
	 * — its static scope. The library has no step in view, so this is all it
	 * can type; a row is checked against each step when it is picked (P7).
	 */
	scope?: TemplateScope
}

export interface LibraryView {
	pipelines: LibraryPipeline[]
	prompts: LibraryPrompt[]
	contextTemplates: LibraryTemplate[]
	variableTemplates: LibraryTemplate[]
	/**
	 * Every pool a published node declares, including the empty ones.
	 *
	 * Derived from the declarations rather than from the rows, and that is the
	 * whole reason it exists: a pool with nothing in it is exactly the pool that
	 * needs a "New" button, and grouping the rows would leave it off the page.
	 * Core ships a context template for the assemble step and none for the other
	 * nodes that declare a template slot, so this is the common case rather than
	 * an edge one.
	 */
	contextPools: LibraryPool[]
	variablePools: LibraryPool[]
	/**
	 * Every `(node type, slot)` a published node declares a prompts slot for,
	 * including the pools with nothing in them.
	 *
	 * New with the pool refactor, and it exists for the case core does not
	 * have: a plugin's node that ships no prose of its own has a real,
	 * selectable prompts slot and zero rows. Grouping the rows alone would
	 * leave that pool off the page entirely, which is a picker with no options
	 * and no way to add one — a dead end rather than a default.
	 */
	promptPools: LibraryPool[]
	/**
	 * Every registered template engine — core's plus whatever enabled
	 * extensions declare (12 §2a). The editor's picker renders from this; a
	 * single entry means the picker never appears at all.
	 */
	engines: Array<{ id: string; owner: string }>
	/**
	 * Sampling config id → the pipelines whose `sampling-ref` slots pick it,
	 * by label (the name with its genre beside it). Sampling configs are not library rows (they live in
	 * Admin → Sampling), but "which pipelines use this" is the same walk, so
	 * it is answered here rather than by a second copy of `usageIndex`.
	 */
	samplingUsedBy: Record<number, string[]>
}

/**
 * Which pipelines currently point at a given row, per slot kind.
 *
 * Walked once across both reference tables rather than queried per row: the
 * library shows every row, so a per-row query is a query per row, and the whole
 * point of this page is that it loads in one round trip.
 *
 * Registration and instance values count as well as overrides (R38, R50) —
 * the same references the delete guards refuse on, so a page never tells an
 * admin a row is free and then watches the server refuse them.
 */
async function usageIndex(
	db: Db,
	slots: Set<string>,
	labels: Map<number, string>
): Promise<Map<number, Set<string>>> {
	const out = new Map<number, Set<string>>()
	if (!slots.size) return out

	// By label, not bare name: four genres' "Reply" are four pipelines, and
	// a set of names would count them as one.
	const note = (value: unknown, specId: number | null) => {
		if (typeof value !== "number") return
		const label = specId != null ? labels.get(specId) : undefined
		if (!label) return
		const set = out.get(value) ?? new Set<string>()
		set.add(label)
		out.set(value, set)
	}

	// 🚧 R38, R50 (0110): configurations are retired — a row is selected by a
	// registration's values (the genre's defaults, a preset, a session) or a
	// pipeline's instance values, each naming its pipeline.
	{
		const { registrationValueRefs } = await import("$lib/server/pipelines/registrations/values")
		const { baseKeyOf } = await import("$lib/server/pipelines/registrations/rows")
		const specRows = (await db.select({ id: schema.pipelineSpecs.id, slug: schema.pipelineSpecs.slug }).from(schema.pipelineSpecs)) as Array<{ id: number; slug: string }>
		const specIdOfSlug = new Map(specRows.map((r) => [r.slug, r.id]))
		const regRows = (await db.select({ id: schema.registrations.id, key: schema.registrations.key, specSlug: schema.registrations.specSlug }).from(schema.registrations)) as Array<{ id: number; key: string; specSlug: string | null }>
		const slugOfKey = new Map<string, string>()
		for (const r of regRows) if (r.specSlug && !slugOfKey.has(r.key)) slugOfKey.set(r.key, r.specSlug)
		const slugOfRow = new Map(regRows.map((r) => [r.id, r.specSlug ?? slugOfKey.get(baseKeyOf(r.key)) ?? null]))
		for (const ref of await registrationValueRefs(db, [...slots])) {
			const slug = ref.scopeKind === "instance" ? ref.scopeRef : slugOfRow.get(ref.rowId)
			note(ref.value, slug ? (specIdOfSlug.get(slug) ?? null) : null)
		}
	}

	for (const o of (await db
		.select()
		.from(schema.pipelineNodeOverrides)) as any[])
		if (slots.has(o.slot)) note(o.value, o.specId)

	return out
}

export async function libraryView(db: Db): Promise<LibraryView> {
	const specs = await db
		.select()
		.from(schema.pipelineSpecs)
		.orderBy(asc(schema.pipelineSpecs.id))

	const pipelines: LibraryPipeline[] = []
	const labels = await pipelineLabelsById(db)
	const promptSlots = new Set<string>()
	const templateSlots = new Set<string>()
	const variableSlots = new Set<string>()
	const samplingSlots = new Set<string>()
	/**
	 * Declared pools, keyed by the whole pool key so two languages of one node
	 * type stay two headings. Filled from the declarations rather than from the
	 * rows — see `LibraryView.contextPools`.
	 */
	const nodeTypeLabels = new Map<string, string>()
	/** Context pool key → the definition's static template scope (P7). */
	const nodeTypeScopes = new Map<string, TemplateScope>()
	const variableLabels = new Map<string, string>()
	const promptLabels = new Map<string, string>()

	// A disabled plugin's rows are not listed (R67, owner 2026-09-24): its
	// pipelines, prompts and templates come back when it is turned on. A row
	// an uninstalled plugin left behind has no owner and is still listed.
	const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
	const off = await disabledPlugins(db)
	// The registry once, for every pipeline's seams.
	const byPin = new Map<string, any>(
		((await db.select().from(schema.pipelineDefinitionRegistry)) as any[]).map(
			(r) => [`${r.definitionId}@${r.version}`, r]
		)
	)

	for (const spec of specs as any[]) {
		if (off.owns(spec.sourcePluginId)) continue
		const [version] = spec.activeVersionId
			? await db
					.select()
					.from(schema.pipelineSpecVersions)
					.where(
						eq(schema.pipelineSpecVersions.id, spec.activeVersionId)
					)
					.limit(1)
			: []

		let nodeCount = 0
		const pools = new Set<string>()
		let scriptSeams: LibraryScriptSeam[] = []
		if (version) {
			nodeCount = (
				await db
					.select()
					.from(schema.pipelineNodes)
					.where(eq(schema.pipelineNodes.specVersionId, version.id))
			).length

			const decls = await declarations(db, version.id)
			scriptSeams = (await stepSeamsOf(db, version.id, { decls, byPin }))
				.seams
			for (const d of decls) {
				// Every language the slot accepts, so a slot declaring two gets
				// a heading per pool and the empty one is somewhere to write
				// the first row. A slot that declares nothing renders in
				// core's, which is what the column default says.
				const engines = acceptedEnginesOf(d)
				if (d.control === "prompts-ref") {
					promptSlots.add(d.slot)
					if (d.nodeDefinitionId)
						pools.add(promptPoolKeyFor(d.nodeDefinitionId, d.slot))
					if (d.nodeDefinitionId)
						promptLabels.set(
							promptPoolKeyFor(d.nodeDefinitionId, d.slot),
							// The step's own name and the slot's, because a
							// type may declare more than one prompts slot and
							// the type name alone would name both headings
							// identically.
							`${d.typeLabel || humanizeTypeId(d.nodeDefinitionId)} · ${d.label}`
						)
				}
				if (d.control === "sampling-ref") samplingSlots.add(d.slot)
				if (d.control === "variable-template-ref" && d.variableId) {
					variableSlots.add(d.slot)
					for (const engine of engines)
						variableLabels.set(
							`${d.variableId}#${engine}`,
							`${d.label ?? d.variableId} · ${languageOf(engine)}`
						)
				}
				if (d.control === "context-template-ref" && d.nodeDefinitionId) {
					templateSlots.add(d.slot)
					for (const engine of engines) {
						nodeTypeLabels.set(
							contextPoolKeyFor(d.nodeDefinitionId, engine),
							`${humanizeTypeId(d.nodeDefinitionId)} · ${languageOf(engine)}`
						)
						if (d.templateStaticScope)
							nodeTypeScopes.set(
								contextPoolKeyFor(d.nodeDefinitionId, engine),
								d.templateStaticScope
							)
					}
				}
			}
		}

		pipelines.push({
			slug: spec.slug,
			name: spec.name,
			label: labels.get(spec.id) ?? spec.name,
			version: version?.semver ?? null,
			status: version?.status ?? null,
			nodeCount,
			promptPools: [...pools].sort(),
			scriptSeams,
			genres: []
		})
	}

	// Pipeline → genre, through the presets that bind it.
	const genresBySlug = await pipelineGenresBySlug(db)
	for (const p of pipelines)
		p.genres = [...(genresBySlug.get(p.slug) ?? new Map())]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name))

	const promptUse = await usageIndex(db, promptSlots, labels)
	const prompts: LibraryPrompt[] = (
		await db
			.select()
			.from(schema.pipelinePrompts)
			.orderBy(asc(schema.pipelinePrompts.id))
	)
		.filter((p: any) => !off.owns(p.ownerPluginId))
		.map((p: any) => {
		const poolId = promptPoolKeyFor(p.nodeDefinitionId, p.slot)
		return {
			id: p.id,
			poolId,
			// A row whose pool nothing currently declares still gets a heading
			// — a prompt an uninstalled plugin left behind is exactly what an
			// admin came here to find (a disabled plugin's is not listed, R67). The id is a poor heading, so it is
			// humanized rather than shown raw.
			poolLabel:
				promptLabels.get(poolId) ??
				`${humanizeTypeId(p.nodeDefinitionId)} · ${p.slot}`,
			...(p.createdForSpecId != null
				? { origin: labels.get(p.createdForSpecId) }
				: {}),
			name: p.name,
			isImmutable: !!p.isImmutable,
			hidden: p.hidden === true,
			fields: (p.fields ?? {}) as Record<string, string>,
			archived: (p.archivedFields ?? {}) as Record<string, string>,
			usedBy: [...(promptUse.get(p.id) ?? [])].sort()
		}
	})

	const templateUse = await usageIndex(db, templateSlots, labels)
	const contextTemplates: LibraryTemplate[] = (
		await db
			.select()
			.from(schema.pipelineContextTemplates)
			.orderBy(asc(schema.pipelineContextTemplates.id))
	)
		.filter((t: any) => !off.owns(t.ownerPluginId))
		.map((t: any) => {
		const engine = t.engine ?? CORE_TEMPLATE_ENGINE
		return {
			id: t.id,
			name: t.name,
			source: t.source ?? "",
			engine,
			isImmutable: !!t.isImmutable,
			poolId: t.nodeDefinitionId,
			poolLabel:
				nodeTypeLabels.get(contextPoolKeyFor(t.nodeDefinitionId, engine)) ??
				`${humanizeTypeId(t.nodeDefinitionId)} · ${languageOf(engine)}`,
			...(t.createdForSpecId != null
				? { origin: labels.get(t.createdForSpecId) }
				: {}),
			usedBy: [...(templateUse.get(t.id) ?? [])].sort()
		}
	})

	const variableUse = await usageIndex(db, variableSlots, labels)
	const variableTemplates: LibraryTemplate[] = (
		await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.orderBy(asc(schema.pipelineVariableTemplates.id))
	)
		.filter((t: any) => !off.owns(t.ownerPluginId))
		.map((t: any) => {
		// The registry is a fact about the running build and the row came from
		// the database, so a layout whose plugin is disabled is normal rather
		// than an error — it falls back to the raw id instead of vanishing from
		// a page whose whole job is to show what exists.
		const v = getVariable(t.variableId)
		const label =
			(typeof v?.i18n?.name === "string"
				? v.i18n.name
				: (v?.i18n?.name as any)?.en) ?? t.variableId
		const engine = t.engine ?? CORE_TEMPLATE_ENGINE
		return {
			id: t.id,
			name: t.name,
			source: t.source ?? "",
			engine,
			isImmutable: !!t.isImmutable,
			poolId: t.variableId,
			poolLabel:
				variableLabels.get(`${t.variableId}#${engine}`) ??
				`${label} · ${languageOf(engine)}`,
			usedBy: [...(variableUse.get(t.id) ?? [])].sort()
		}
	})

	const asPools = (
		labels: Map<string, string>,
		scopes?: Map<string, TemplateScope>
	): LibraryPool[] =>
		[...labels]
			.map(([id, label]) => {
				const scope = scopes?.get(id)
				return { id, label, ...(scope ? { scope } : {}) }
			})
			.sort((a, b) => a.label.localeCompare(b.label))

	return {
		pipelines,
		prompts,
		contextTemplates,
		variableTemplates,
		contextPools: asPools(nodeTypeLabels, nodeTypeScopes),
		variablePools: asPools(variableLabels),
		promptPools: asPools(promptLabels),
		engines: knownEngines(),
		samplingUsedBy: Object.fromEntries(
			[...(await usageIndex(db, samplingSlots, labels))].map(([id, names]) => [
				id,
				[...names].sort()
			])
		)
	}
}
