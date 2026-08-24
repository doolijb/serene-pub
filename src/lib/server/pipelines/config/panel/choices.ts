/**
 * The lists a picker offers.
 *
 * A slot whose value is a *reference* to an authored row — a prompt, a context
 * template, a variable layout, a sampling preset, a connection — needs the set
 * of rows that reference could name. That set is narrowed differently per kind
 * (a prompt by spec, a variable layout by the variable it renders), which is
 * why this is one place rather than a branch inside the read model.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { type Db, type Decl } from "$lib/server/pipelines/config/panel/types"

type ChoiceList = Array<{ id: number; label: string; description?: string }>

/**
 * Everything a `*-ref` option in this pipeline may be pointed at.
 *
 * Loaded once per view rather than per option: a spec with five provider nodes
 * asks the same three questions five times, and the answers cannot differ
 * between nodes of the same slot kind except by declared shape, which is
 * applied below.
 */
export async function choiceSets(db: Db, specId: number) {
	const prompts = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
		.orderBy(asc(schema.pipelinePrompts.id))

	const connections = await db
		.select()
		.from(schema.connections)
		.orderBy(asc(schema.connections.id))

	const sampling = await db
		.select()
		.from(schema.samplingConfigs)
		.orderBy(asc(schema.samplingConfigs.id))

	// Every context template on the instance, pooled by node type rather than
	// by spec — the same rule layouts follow, for the same reason: session reply
	// and the narrator run the same assemble node, so one story string serves
	// both and always has. Narrowed per option by `nodeTypeId` below, and
	// grouped so the pipeline being configured comes first.
	const contextTemplateRows = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.orderBy(asc(schema.pipelineContextTemplates.id))

	const specRows = await db.select().from(schema.pipelineSpecs)
	// The display name, not the slug: `from core:spec/respond` is the id a
	// developer reads and `from Session reply` is the thing a user recognises,
	// and this string is a subtitle in a picker.
	const nameById = new Map<number, string>(
		(specRows as any[]).map((r) => [r.id, r.name ?? r.slug])
	)

	const contextTemplatesBy = new Map<string, ChoiceList>()
	const CT_ORDER = { usedHere: 0, shipped: 1, alsoFits: 2 } as const
	for (const t of contextTemplateRows as any[]) {
		const group: keyof typeof CT_ORDER =
			t.createdForSpecId === specId
				? "usedHere"
				: t.isImmutable
					? "shipped"
					: "alsoFits"
		const list = contextTemplatesBy.get(t.nodeTypeId) ?? []
		list.push({
			id: t.id,
			label: t.name,
			// The subtitle answers the question the grouping raises — "then
			// where is this one from" — for exactly the rows where it is not
			// already obvious.
			...(group === "alsoFits" && t.createdForSpecId != null
				? { description: `from ${nameById.get(t.createdForSpecId)}` }
				: {}),
			group
		} as any)
		contextTemplatesBy.set(t.nodeTypeId, list)
	}
	for (const [, list] of contextTemplatesBy)
		list.sort(
			(a: any, b: any) =>
				CT_ORDER[a.group as keyof typeof CT_ORDER] -
					CT_ORDER[b.group as keyof typeof CT_ORDER] ||
				a.label.localeCompare(b.label)
		)

	// Every layout on the instance, not this spec's — a layout is keyed by the
	// variable it renders, so one written while configuring replies belongs in
	// the narrator's picker too. Narrowed per option by `variableId` below.
	const variableTemplates = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.orderBy(asc(schema.pipelineVariableTemplates.id))

	const byVariable = new Map<string, ChoiceList>()
	for (const t of variableTemplates as any[]) {
		const list = byVariable.get(t.variableId) ?? []
		list.push({ id: t.id, label: t.name })
		byVariable.set(t.variableId, list)
	}
	// Shipped first, matching `listVariableTemplates` — the picker's order is
	// part of what "the default" means.
	for (const [, list] of byVariable)
		list.sort((a, b) => {
			const rowA = (variableTemplates as any[]).find((t) => t.id === a.id)
			const rowB = (variableTemplates as any[]).find((t) => t.id === b.id)
			return Number(!!rowB?.isImmutable) - Number(!!rowA?.isImmutable)
		})

	// Every script on the instance, keyed by pinned type id. Like layouts, a
	// script is deliberately not namespaced to a spec — a slop filter written
	// while configuring replies belongs in the summarizer's picker too — so the
	// narrowing per option is by the hook's accepted types, applied below.
	const scriptRows = await db
		.select()
		.from(schema.pipelineScripts)
		.orderBy(asc(schema.pipelineScripts.id))

	// The type's display name and badge, from registry rows (F6) — the picker
	// subtitle has to say what kind of thing each row is, because a hook
	// accepting two operations ("rewrites content" vs "ends generations") is
	// offering two different powers under one Add button.
	const scriptTypeRegistry = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(eq(schema.pipelineTypeRegistry.kind, "script"))
	const scriptTypeMeta = new Map<
		string,
		{ name: string; blastRadius: string; operation: string }
	>()
	for (const r of scriptTypeRegistry as any[]) {
		const pinned = `${r.typeId}@${r.version}`
		const i18n = (r.i18n ?? {}) as Record<string, any>
		const text = (v: unknown) =>
			typeof v === "string" ? v : ((v as any)?.en ?? "")
		scriptTypeMeta.set(pinned, {
			name: text(i18n.name) || pinned,
			blastRadius: text(i18n.blastRadius),
			operation: pinned.replace(/@\d+$/, "").split("/").pop() ?? ""
		})
	}

	const scriptsByType = new Map<string, ChoiceList>()
	for (const s of scriptRows as any[]) {
		const meta = scriptTypeMeta.get(s.typeId)
		const list = scriptsByType.get(s.typeId) ?? []
		list.push({
			id: s.id,
			label: s.name,
			...(meta
				? { description: `${meta.name} — ${meta.blastRadius}` }
				: {})
		})
		scriptsByType.set(s.typeId, list)
	}

	return {
		prompts: (prompts as any[]).map((p) => ({
			id: p.id,
			label: p.name
		})) as ChoiceList,
		// The full rows, for the inline editor: a prompts-ref option carries
		// the selected row's text so editing does not need a second fetch.
		promptRows: new Map<number, any>(
			(prompts as any[]).map((p) => [p.id, p])
		),
		// The model is the thing a person actually recognises a connection by —
		// two rows both called "Ollama" are otherwise indistinguishable in a
		// picker, which is the situation an admin with a local and a remote box
		// is in every day.
		connections: (connections as any[]).map((c) => ({
			id: c.id,
			label: c.name,
			...(c.model ? { description: c.model } : {})
		})) as ChoiceList,
		sampling: (sampling as any[]).map((s) => ({
			id: s.id,
			label: s.name
		})) as ChoiceList,
		contextTemplatesBy,
		/** The full rows, for the inline editor — same reason as `promptRows`. */
		contextTemplateRows: new Map<number, any>(
			(contextTemplateRows as any[]).map((t) => [t.id, t])
		),
		variableTemplatesBy: byVariable,
		/** The full rows, for the inline editor — same reason as `promptRows`. */
		variableTemplateRows: new Map<number, any>(
			(variableTemplates as any[]).map((t) => [t.id, t])
		),
		scriptsByType,
		/** The full rows, to hydrate a chain's entries — same reason as `promptRows`. */
		scriptRows: new Map<number, any>(
			(scriptRows as any[]).map((s) => [s.id, s])
		),
		/** Type display info, for the chain entries' labels and badges. */
		scriptTypeMeta
	}
}

/**
 * Takes the whole declaration rather than just its control, because one of the
 * four is narrowed by something only the declaration knows: a variables option
 * offers the layouts for **its** variable, and a picker showing every layout on
 * the instance would offer a personas rendering for characters.
 */
export const choicesFor = (
	d: Decl,
	sets: Awaited<ReturnType<typeof choiceSets>>
): ChoiceList | undefined => {
	if (d.control === "prompts-ref") return sets.prompts
	if (d.control === "connection-ref") return sets.connections
	if (d.control === "sampling-ref") return sets.sampling
	if (d.control === "variable-template-ref")
		return d.variableId
			? (sets.variableTemplatesBy.get(d.variableId) ?? [])
			: []
	if (d.control === "context-template-ref")
		return d.nodeTypeId
			? (sets.contextTemplatesBy.get(d.nodeTypeId) ?? [])
			: []
	// The union of the hook's accepted types, in declaration order — which is
	// the attachment rule made visible: nothing outside `accepts` is offered,
	// and the write path refuses whatever a stale client offers anyway.
	if (d.control === "scripts-chain")
		return (d.accepts ?? []).flatMap(
			(typeId) => sets.scriptsByType.get(typeId) ?? []
		)
	return undefined
}
