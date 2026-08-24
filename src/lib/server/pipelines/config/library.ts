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
 * Prompts are namespaced, but context templates and variable layouts are shared
 * on purpose, which makes "may I delete this" genuinely unanswerable from inside
 * one pipeline's settings — the thing holding a row is routinely somewhere the
 * person looking is not. The delete refusal already says *that* something holds
 * it; this says *what*, before they try.
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
import { poolKeyFor } from "$lib/server/pipelines/entities/contextTemplateDefaults"

type Db = { select: any; insert: any; update: any; delete: any }

export interface LibraryPipeline {
	slug: string
	name: string
	version: string | null
	status: string | null
	nodeCount: number
}

export interface LibraryPrompt {
	id: number
	specSlug: string
	specName: string
	name: string
	isImmutable: boolean
	fields: Record<string, string>
	usedBy: string[]
}

export interface LibraryTemplate {
	id: number
	name: string
	source: string
	engine: string | null
	isImmutable: boolean
	/** The pool this belongs to — a node type id, or a variable id. */
	poolId: string
	/** That pool, said the way a person would say it. */
	poolLabel: string
	/** The pipeline it was authored in, when it records one. */
	origin?: string
	usedBy: string[]
}

/** A pool that exists because some node declares it, whether or not it has rows. */
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
	/** node type id → the label its steps show, for the template pool headings. */
	const nodeTypeLabels = new Map<string, string>()
	/** variable id → its registered name, same job for the layout headings. */
	const variableLabels = new Map<string, string>()

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
				if (d.control === "prompts-ref") promptSlots.add(d.slot)
				if (d.control === "variable-template-ref" && d.variableId) {
					variableSlots.add(d.slot)
					variableLabels.set(d.variableId, d.label ?? d.variableId)
				}
				if (d.control === "context-template-ref" && d.nodeTypeId) {
					templateSlots.add(d.slot)
					nodeTypeLabels.set(
						d.nodeTypeId,
						humanizeTypeId(d.nodeTypeId)
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
	const specSlug = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.slug])
	)

	const promptUse = await usageIndex(db, promptSlots)
	const prompts: LibraryPrompt[] = (
		await db
			.select()
			.from(schema.pipelinePrompts)
			.orderBy(asc(schema.pipelinePrompts.id))
	).map((p: any) => ({
		id: p.id,
		specSlug: specSlug.get(p.specId) ?? "",
		specName: specName.get(p.specId) ?? "",
		name: p.name,
		isImmutable: !!p.isImmutable,
		fields: (p.fields ?? {}) as Record<string, string>,
		usedBy: [...(promptUse.get(p.id) ?? [])].sort()
	}))

	const templateUse = await usageIndex(db, templateSlots)
	const contextTemplates: LibraryTemplate[] = (
		await db
			.select()
			.from(schema.pipelineContextTemplates)
			.orderBy(asc(schema.pipelineContextTemplates.id))
	).map((t: any) => ({
		id: t.id,
		name: t.name,
		source: t.source ?? "",
		engine: t.engine ?? null,
		isImmutable: !!t.isImmutable,
		poolId: t.nodeTypeId,
		poolLabel:
			nodeTypeLabels.get(poolKeyFor(t.nodeTypeId)) ??
			humanizeTypeId(t.nodeTypeId),
		...(t.createdForSpecId != null
			? { origin: specName.get(t.createdForSpecId) }
			: {}),
		usedBy: [...(templateUse.get(t.id) ?? [])].sort()
	}))

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
		return {
			id: t.id,
			name: t.name,
			source: t.source ?? "",
			engine: t.engine ?? null,
			isImmutable: !!t.isImmutable,
			poolId: t.variableId,
			poolLabel: label,
			usedBy: [...(variableUse.get(t.id) ?? [])].sort()
		}
	})

	return {
		pipelines,
		prompts,
		contextTemplates,
		variableTemplates,
		contextPools: [...nodeTypeLabels]
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => a.label.localeCompare(b.label)),
		variablePools: [...variableLabels]
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => a.label.localeCompare(b.label))
	}
}
