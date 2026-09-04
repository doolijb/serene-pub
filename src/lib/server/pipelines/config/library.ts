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
	humanizeTypeId
} from "$lib/server/pipelines/config/panel"
import { getVariable } from "@serene-pub/sdk"
import {
	contextPoolKeyFor,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import {
	CORE_TEMPLATE_ENGINE,
	knownEngines
} from "$lib/server/pipelines/prompt/renderers"

type Db = { select: any; insert: any; update: any; delete: any }

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
	version: string | null
	status: string | null
	nodeCount: number
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
}

/**
 * Which pipelines currently point at a given row, per slot kind.
 *
 * Walked once across both reference tables rather than queried per row: the
 * library shows every row, so a per-row query is a query per row, and the whole
 * point of this page is that it loads in one round trip.
 *
 * Config values count as well as overrides. A value on a shipped config is
 * still a pipeline selecting the row — it is *why* deleting core's rows is
 * refused — and a page that only counted overrides would tell an admin a row
 * was free and then watch the server refuse them.
 */
async function usageIndex(
	db: Db,
	slots: Set<string>
): Promise<Map<number, Set<string>>> {
	const out = new Map<number, Set<string>>()
	if (!slots.size) return out

	const specs = await db.select().from(schema.pipelineSpecs)
	const nameById = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.name ?? s.slug])
	)

	const note = (value: unknown, specId: number | null) => {
		if (typeof value !== "number") return
		const label = specId != null ? nameById.get(specId) : undefined
		if (!label) return
		const set = out.get(value) ?? new Set<string>()
		set.add(label)
		out.set(value, set)
	}

	const configs = await db.select().from(schema.pipelineConfigs)
	const specOfConfig = new Map<number, number>(
		(configs as any[]).map((c) => [c.id, c.specId])
	)
	for (const v of (await db
		.select()
		.from(schema.pipelineConfigValues)) as any[])
		if (slots.has(v.slot))
			note(v.value, specOfConfig.get(v.configId) ?? null)

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
	const promptSlots = new Set<string>()
	const templateSlots = new Set<string>()
	const variableSlots = new Set<string>()
	/**
	 * Declared pools, keyed by the whole pool key so two languages of one node
	 * type stay two headings. Filled from the declarations rather than from the
	 * rows — see `LibraryView.contextPools`.
	 */
	const nodeTypeLabels = new Map<string, string>()
	const variableLabels = new Map<string, string>()
	const promptLabels = new Map<string, string>()

	for (const spec of specs as any[]) {
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
		if (version) {
			nodeCount = (
				await db
					.select()
					.from(schema.pipelineNodes)
					.where(eq(schema.pipelineNodes.specVersionId, version.id))
			).length

			for (const d of await declarations(db, version.id)) {
				// A slot that declares no engine renders in core's — which is
				// what the column default says, and what every core slot but
				// the two unbound jinja2 ones does.
				const engine = d.engine ?? CORE_TEMPLATE_ENGINE
				if (d.control === "prompts-ref") {
					promptSlots.add(d.slot)
					if (d.nodeTypeId)
						promptLabels.set(
							promptPoolKeyFor(d.nodeTypeId, d.slot),
							// The step's own name and the slot's, because a
							// type may declare more than one prompts slot and
							// the type name alone would name both headings
							// identically.
							`${d.typeLabel || humanizeTypeId(d.nodeTypeId)} · ${d.label}`
						)
				}
				if (d.control === "variable-template-ref" && d.variableId) {
					variableSlots.add(d.slot)
					variableLabels.set(
						`${d.variableId}#${engine}`,
						`${d.label ?? d.variableId} · ${languageOf(engine)}`
					)
				}
				if (d.control === "context-template-ref" && d.nodeTypeId) {
					templateSlots.add(d.slot)
					nodeTypeLabels.set(
						contextPoolKeyFor(d.nodeTypeId, engine),
						`${humanizeTypeId(d.nodeTypeId)} · ${languageOf(engine)}`
					)
				}
			}
		}

		pipelines.push({
			slug: spec.slug,
			name: spec.name,
			version: version?.semver ?? null,
			status: version?.status ?? null,
			nodeCount
		})
	}

	const specName = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.name ?? s.slug])
	)

	const promptUse = await usageIndex(db, promptSlots)
	const prompts: LibraryPrompt[] = (
		await db
			.select()
			.from(schema.pipelinePrompts)
			.orderBy(asc(schema.pipelinePrompts.id))
	).map((p: any) => {
		const poolId = promptPoolKeyFor(p.nodeTypeId, p.slot)
		return {
			id: p.id,
			poolId,
			// A row whose pool nothing currently declares still gets a heading
			// — a prompt left behind by a disabled plugin is exactly what an
			// admin came here to find. The id is a poor heading, so it is
			// humanized rather than shown raw.
			poolLabel:
				promptLabels.get(poolId) ??
				`${humanizeTypeId(p.nodeTypeId)} · ${p.slot}`,
			...(p.createdForSpecId != null
				? { origin: specName.get(p.createdForSpecId) }
				: {}),
			name: p.name,
			isImmutable: !!p.isImmutable,
			fields: (p.fields ?? {}) as Record<string, string>,
			archived: (p.archivedFields ?? {}) as Record<string, string>,
			usedBy: [...(promptUse.get(p.id) ?? [])].sort()
		}
	})

	const templateUse = await usageIndex(db, templateSlots)
	const contextTemplates: LibraryTemplate[] = (
		await db
			.select()
			.from(schema.pipelineContextTemplates)
			.orderBy(asc(schema.pipelineContextTemplates.id))
	).map((t: any) => {
		const engine = t.engine ?? CORE_TEMPLATE_ENGINE
		return {
			id: t.id,
			name: t.name,
			source: t.source ?? "",
			engine,
			isImmutable: !!t.isImmutable,
			poolId: t.nodeTypeId,
			poolLabel:
				nodeTypeLabels.get(contextPoolKeyFor(t.nodeTypeId, engine)) ??
				`${humanizeTypeId(t.nodeTypeId)} · ${languageOf(engine)}`,
			...(t.createdForSpecId != null
				? { origin: specName.get(t.createdForSpecId) }
				: {}),
			usedBy: [...(templateUse.get(t.id) ?? [])].sort()
		}
	})

	const variableUse = await usageIndex(db, variableSlots)
	const variableTemplates: LibraryTemplate[] = (
		await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.orderBy(asc(schema.pipelineVariableTemplates.id))
	).map((t: any) => {
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

	const asPools = (labels: Map<string, string>): LibraryPool[] =>
		[...labels]
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => a.label.localeCompare(b.label))

	return {
		pipelines,
		prompts,
		contextTemplates,
		variableTemplates,
		contextPools: asPools(nodeTypeLabels),
		variablePools: asPools(variableLabels),
		promptPools: asPools(promptLabels),
		engines: knownEngines()
	}
}
