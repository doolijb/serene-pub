/**
 * The lists a picker offers.
 *
 * A slot whose value is a *reference* to an authored row — a prompt, a context
 * template, a variable layout, a sampling preset, a connection — needs the set
 * of rows that reference could name. That set is narrowed differently per kind
 * (a prompt by the node that consumes it, a variable layout by the variable it
 * renders), which is why this is one place rather than a branch inside the read
 * model.
 */

import { asc, eq } from "drizzle-orm"
import {
	S,
	capabilityLabel,
	satisfies,
	type CapabilityId,
	type CapabilitySet
} from "@serene-pub/sdk"
import { shapeOfModality } from "$lib/shared/constants/ConnectionTypes"
import * as schema from "$lib/server/db/schema"
import { promptPoolKeyFor } from "$lib/server/pipelines/entities/promptPool"
import { storedCapabilities } from "$lib/server/pipelines/runtime/capabilityGuard"
import {
	CORE_TEMPLATE_ENGINE,
	contextPoolKeyFor
} from "$lib/shared/pipelines/poolKey"
import { type Db, type Decl } from "$lib/server/pipelines/config/panel/types"

/** Exported for `judgeAgainst`'s callers — see the ⚠ on it. */
export type ChoiceList = Array<{
	id: number
	label: string
	description?: string
	/** Offered, but not usable here. See `ConfigOption.choices`. */
	disabled?: boolean
	/** Why — in a person's words, never a raw capability id. */
	reason?: string
}>

/**
 * Everything a `*-ref` option in this pipeline may be pointed at.
 *
 * Loaded once per view rather than per option: a spec with five provider nodes
 * asks the same three questions five times, and the answers cannot differ
 * between nodes of the same slot kind except by declared shape, which is
 * applied below.
 */
export async function choiceSets(db: Db, specId: number) {
	// Every prompt on the instance, pooled by `(node type, slot)` rather than
	// by spec — the same rule context templates and layouts follow, and now for
	// the same reason: a prompt belongs to the NODE that consumes it, so an
	// action reusing the reply pipeline's context node is offered its twelve
	// prompts without anything being seeded or copied. Narrowed per option by
	// `nodeTypeId` + `slot` below, and grouped so the pipeline being configured
	// comes first.
	const promptRows = await db
		.select()
		.from(schema.pipelinePrompts)
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

	const POOL_ORDER = { usedHere: 0, shipped: 1, alsoFits: 2 } as const

	/**
	 * Group and order one pool's rows, for any entity keyed by a pool.
	 *
	 * Written once and used by both context templates and prompts, because
	 * since prompts became node-scoped the two answer the *same* question about
	 * the *same* kind of row: which of these was written here, which does core
	 * ship, and which merely also fits. Two copies would be two orderings for
	 * one rule, and the day they disagreed the editor's caption and the
	 * dropdown would be the halves disagreeing.
	 *
	 * **The grouping never refuses.** A row written while configuring replies
	 * stays selectable in the narrator, one group down — that is the entire
	 * point of pooling rather than namespacing.
	 */
	const pooled = (
		rows: Array<{
			id: number
			name: string
			isImmutable: boolean
			createdForSpecId: number | null
		}>,
		keyOf: (r: any) => string
	): Map<string, ChoiceList> => {
		const by = new Map<string, ChoiceList>()
		for (const r of rows as any[]) {
			const group: keyof typeof POOL_ORDER =
				r.createdForSpecId === specId
					? "usedHere"
					: r.isImmutable
						? "shipped"
						: "alsoFits"
			const key = keyOf(r)
			const list = by.get(key) ?? []
			list.push({
				id: r.id,
				label: r.name,
				// The subtitle answers the question the grouping raises — "then
				// where is this one from" — for exactly the rows where it is not
				// already obvious.
				...(group === "alsoFits" && r.createdForSpecId != null
					? {
							description: `from ${nameById.get(r.createdForSpecId)}`
						}
					: {}),
				group
			} as any)
			by.set(key, list)
		}
		for (const [, list] of by)
			list.sort(
				(a: any, b: any) =>
					POOL_ORDER[a.group as keyof typeof POOL_ORDER] -
						POOL_ORDER[b.group as keyof typeof POOL_ORDER] ||
					a.label.localeCompare(b.label)
			)
		return by
	}

	// Keyed on `(node type, engine)`, which is the pool EVERYWHERE else — the
	// unique index, `assertSelectable`, `defaultContextTemplateFor`,
	// `contextTemplateOptionGate` and `refDefaults` all use both halves. Keying
	// on the node type alone here offered a Jinja template into a Handlebars
	// slot: it stored cleanly and then rendered its own markup as prose, which
	// is the exact failure the engine half of the pool exists to prevent.
	const contextTemplatesBy = pooled(contextTemplateRows as any[], (t: any) =>
		contextPoolKeyFor(t.nodeTypeId, t.engine)
	)

	// Keyed on the composite, which is an in-memory Map key and never leaves
	// this process — the rows carry two columns and `choicesFor` rebuilds the
	// key from the declaration's two halves. See `promptPool.ts`.
	const promptsBy = pooled(promptRows as any[], (p: any) =>
		promptPoolKeyFor(p.nodeTypeId, p.slot)
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
		promptsBy,
		// The full rows, for the inline editor: a prompts-ref option carries
		// the selected row's text so editing does not need a second fetch.
		promptRows: new Map<number, any>(
			(promptRows as any[]).map((p) => [p.id, p])
		),
		// The model is the thing a person actually recognises a connection by —
		// two rows both called "Ollama" are otherwise indistinguishable in a
		// picker, which is the situation an admin with a local and a remote box
		// is in every day.
		// `shape` and `capabilities` ride along on each entry so `choicesFor` can
		// narrow by what the slot asks for. Deliberately not a filter applied
		// here: one panel renders many slots, and a set built once, blind to all
		// of them, is what lets a single query serve them all.
		connections: (connections as any[]).map((c) => ({
			id: c.id,
			label: c.name,
			shape: shapeOfModality(c.modality),
			// The stored cache, never a fresh resolution: deriving would mean
			// importing the connection's adapter module, and this read happens
			// for every connection against every slot in the panel — the one
			// place the lazy loading costs most. `{}` means nobody has tested
			// this connection, which is undetermined and not incapable.
			//
			// Read through `storedCapabilities`, which intersects the cache with
			// what the manifest still declares. The bind guard reads it that way,
			// and a picker reading RAW would offer a connection for a transform
			// the adapter has since stopped declaring — the row is selectable,
			// the run then refuses it, and nothing on screen explains why the
			// two disagreed. One reader, one answer.
			capabilities: storedCapabilities(c),
			...(c.model ? { description: c.model } : {})
		})) as ChoiceList,
		sampling: (sampling as any[]).map((s) => ({
			id: s.id,
			label: s.name,
			shape: s.shape ?? S.textGen
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
 * Everything in `list` that speaks `shape`.
 *
 * An entry carrying no shape is kept rather than dropped: rows written before
 * the column existed read as untyped, and disappearing from every picker is a
 * far worse failure than appearing in one where they do not belong.
 */
const ofShape = (list: ChoiceList, shape?: string): ChoiceList =>
	shape
		? (list.filter(
				(c) => !(c as any).shape || (c as any).shape === shape
			) as ChoiceList)
		: list

/** `Vision`, or `Vision and Image generation` — names, never ids. */
const nameCapabilities = (ids: readonly string[]): string => {
	const names = ids.map((id) => capabilityLabel(id as CapabilityId))
	if (names.length < 2) return names[0] ?? ""
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * Everything in `list`, judged against what the slot requires — and **nothing
 * removed**.
 *
 * Hiding is the tempting implementation and the wrong one. A connection that
 * simply is not in the dropdown makes *"why isn't mine in the list"* a question
 * with no answer on the screen that raised it, and the honest answer — "it
 * can't generate images" — is one this function is already holding. So an
 * unsatisfying row stays, disabled, carrying its own reason.
 *
 * An entry with no capabilities at all is a connection nobody has tested yet.
 * That is *undetermined*, not incapable, and marking it unusable would empty
 * the picker on every install that upgraded into the capability model — so it
 * is offered, with the uncertainty said out loud rather than resolved either way.
 *
 * ⚠ EXPORTED, and that is load-bearing rather than tidiness. Admin → Defaults
 * asks the identical question — "may this connection be pointed at this
 * capability, and if not, what do I put beside the greyed row" — and the second
 * copy of it would be the one that forgets the untested case and empties the
 * picker on an upgraded install. `choicesFor` is a caller of this, not its
 * owner. Each entry must carry a `capabilities` field read through
 * `storedCapabilities`; passing raw `capabilities.resolved` offers a connection
 * for a transform its adapter has since stopped declaring.
 */
export const judgeAgainst = (
	list: ChoiceList,
	requires: readonly string[]
): ChoiceList =>
	list.map((entry) => {
		const have = ((entry as any).capabilities ?? {}) as CapabilitySet
		if (!Object.keys(have).length)
			return {
				...entry,
				reason: `Not tested yet — it may not do ${nameCapabilities(requires)}.`
			}
		const verdict = satisfies(
			{ requires: requires as readonly CapabilityId[] },
			have
		)
		return verdict.ok
			? entry
			: {
					...entry,
					disabled: true,
					reason: `Can't do ${nameCapabilities(verdict.missing)}.`
				}
	})

/**
 * Takes the whole declaration rather than just its control, because two of them
 * are narrowed by something only the declaration knows: a variables option
 * offers the layouts for **its** variable, and a connection or sampling option
 * offers only what its slot can actually use.
 */
export const choicesFor = (
	d: Decl,
	sets: Awaited<ReturnType<typeof choiceSets>>
): ChoiceList | undefined => {
	// Narrowed by the pool, exactly as a context template is — the difference
	// is that a prompt's pool takes both halves. A slot's declared field set is
	// a property of the type's VERSION, so it is checked at selection
	// (`assertSelectable`) rather than fragmenting the pool on every bump.
	if (d.control === "prompts-ref")
		return d.nodeTypeId
			? (sets.promptsBy.get(promptPoolKeyFor(d.nodeTypeId, d.slot)) ?? [])
			: []
	// Judged against what the slot declared it requires, and only narrowed by
	// shape when it declared none — the fallback for every slot authored before
	// a connection could say what it can do. The two rules differ in kind, not
	// just in key: `shape` filters a row out of existence, `requires` keeps it
	// and says why it cannot be used.
	if (d.control === "connection-ref")
		return d.requires?.length
			? judgeAgainst(sets.connections, d.requires)
			: ofShape(sets.connections, d.shape)
	// Sampling stays on shape. A sampling config is not a backend and has no
	// capabilities to test; its shape is the vocabulary its values speak (F17),
	// which is exactly the right question to ask of it.
	if (d.control === "sampling-ref") return ofShape(sets.sampling, d.shape)
	if (d.control === "variable-template-ref")
		return d.variableId
			? (sets.variableTemplatesBy.get(d.variableId) ?? [])
			: []
	if (d.control === "context-template-ref")
		return d.nodeTypeId
			? (sets.contextTemplatesBy.get(
					contextPoolKeyFor(
						d.nodeTypeId,
						d.engine ?? CORE_TEMPLATE_ENGINE
					)
				) ?? [])
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
