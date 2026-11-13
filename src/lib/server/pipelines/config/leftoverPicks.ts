/**
 * ⏳ **Leftover picks** (PLAN variable-layouts 2026-11-10, W4): a per-step
 * variable layout stored before layouts moved to the variable — one value at
 * `values[nodeKey][<variables slot>][key] = <layout row id>` on a registration
 * row (a genre's admin change, a preset's row) or in a pipeline's instance
 * values. The data upgrade kept only the ones that change output; nothing new
 * writes one. They stay honoured (`world.ts` reads them first), and this module
 * is the screen's read and its two ways out:
 *
 *  · `leftoverPicksFor` — each step's leftover picks, per scope, with whether
 *    the step's context template is the pub's own copy (so *Move into the
 *    template* is offered);
 *  · `clearLeftoverPick` — **Remove this pick**: removes one;
 *  · `moveLeftoversIntoTemplate` — **Move into the template**: names the picked
 *    layouts in the step's context template (`layout key "<reference>"`) and
 *    removes the step's leftovers, in one transaction, so the output is
 *    unchanged.
 *
 * Writes go through the owning modules only: registration values through
 * `registrations/genreValues.ts`, `instanceValues.ts` and `write.ts`; the
 * context template through its entity; a reference through the layouts entity.
 * Dropped at the 0.7 squash with the picks themselves.
 */
import { eq, inArray } from "drizzle-orm"
import { getVariable, i18nText } from "@serene-pub/sdk"
import { variableLayoutCalls } from "@serene-pub/sdk/template-check"
import * as schema from "$lib/server/db/schema"
import { stepKeyFor, type Viewer } from "$lib/server/pipelines/config/panel"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"

/** Where a leftover pick is stored. */
export type LeftoverScope =
	| { kind: "genre"; genreId: string }
	| { kind: "preset"; presetId: number }
	| { kind: "instance" }

export interface LeftoverPick {
	/** The step's opaque handle, `ConfigOption.step.key` (never the node key). */
	stepKey: string
	/** The variables slot's name on the step (the slot is a plugin's to name). */
	slot: string
	/** The key the slot renders (`characters`). */
	key: string
	variableId: string
	variableLabel: string
	/** The layout row the pick names. */
	templateId: number
	layoutName: string
	scope: LeftoverScope
	/** A preset-scope pick's preset, by name. */
	presetName?: string
}

export interface LeftoverStep {
	/** The step's opaque handle, `ConfigOption.step.key` (never the node key). */
	stepKey: string
	slot: string
	/** The context template the step renders with, when one is resolved. */
	contextTemplate: { id: number; name: string } | null
	/**
	 * True only when that template is the pub's own copy — not shipped, not a
	 * package's — in a language a layout call can be written in.
	 */
	canMoveIntoTemplate: boolean
	/** The step's own heading; sent only when its lines show under another step's template. */
	stepHeading?: string
	picks: LeftoverPick[]
}

/** A refusal in words, for a person. */
export class LeftoverPickRefusal extends Error {
	constructor(
		message: string,
		/** Beside the words, for code to act on; only the owner-slug refusal has one. */
		readonly code?: Sockets.Pipelines.MoveLeftoversIntoTemplate.RefusalCode
	) {
		super(message)
	}
}

type Values = Record<string, Record<string, unknown>>

interface RawPick {
	scope: LeftoverScope
	nodeKey: string
	slot: string
	path: string
	value: unknown
}

const NUL = "\u0000"

function explode(
	values: Values | null | undefined
): Array<{ nodeKey: string; slot: string; path: string; value: unknown }> {
	const out: Array<{
		nodeKey: string
		slot: string
		path: string
		value: unknown
	}> = []
	for (const [nodeKey, slots] of Object.entries(values ?? {}))
		for (const [slot, cur] of Object.entries(slots ?? {})) {
			if (cur && typeof cur === "object" && !Array.isArray(cur))
				for (const [path, value] of Object.entries(
					cur as Record<string, unknown>
				))
					out.push({ nodeKey, slot, path, value })
			else out.push({ nodeKey, slot, path: "", value: cur })
		}
	return out
}

/** The preset a view is about: the one asked for, else the session's. */
async function presetInView(
	db: Db,
	opts: { sessionId?: number; presetId?: number }
): Promise<number | null> {
	if (opts.presetId != null) return opts.presetId
	if (opts.sessionId == null) return null
	const [row] = await db
		.select({ presetId: schema.sessions.presetId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, opts.sessionId))
		.limit(1)
	return row?.presetId ?? null
}

/** Does this preset-scope row belong to the pipeline `slug`? */
async function presetRowIsOf(
	db: Db,
	slug: string,
	row: { key: string; specSlug: string | null },
	genreRegistrations: Map<string, string>
): Promise<boolean> {
	if (row.specSlug) return row.specSlug === slug
	return genreRegistrations.get(row.key) === slug
}

/** The pipeline each registration key of a genre runs. */
async function pipelineByKey(
	db: Db,
	genreId: string
): Promise<Map<string, string>> {
	const { genreRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	return new Map(
		(await genreRegistrations(db, genreId)).map((r) => [r.key, r.pipeline])
	)
}

/**
 * Every value stored for the pipeline at one of its variable keys, at the
 * scopes a leftover can sit: the genres' admin changes, the instance values,
 * and the given presets' own rows.
 */
async function storedPicks(
	db: Db,
	slug: string,
	variableAt: ReadonlySet<string>,
	presetIds: readonly number[]
): Promise<RawPick[]> {
	const { rowsAt } = await import("$lib/server/pipelines/registrations/write")
	const { genreChangeKey } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const { genreValueTargets } = await import(
		"$lib/server/pipelines/registrations/genreValues"
	)
	const { instanceStoredValues } = await import(
		"$lib/server/pipelines/registrations/instanceValues"
	)
	const out: RawPick[] = []
	const keep = (r: RawPick) => {
		if (
			typeof r.value === "number" &&
			variableAt.has(`${r.nodeKey}${NUL}${r.slot}${NUL}${r.path}`)
		)
			out.push(r)
	}

	const byGenre = new Map<string, Awaited<ReturnType<typeof rowsAt>>>()
	for (const t of await genreValueTargets(db, slug)) {
		if (!byGenre.has(t.genreId))
			byGenre.set(
				t.genreId,
				await rowsAt(db, { kind: "genre", genreId: t.genreId })
			)
		const row = byGenre
			.get(t.genreId)!
			.find((r) => r.key === genreChangeKey(t.key))
		for (const v of explode(row?.values as Values | null))
			keep({ scope: { kind: "genre", genreId: t.genreId }, ...v })
	}

	for (const v of await instanceStoredValues(db, slug))
		keep({ scope: { kind: "instance" }, ...v })

	for (const presetId of presetIds) {
		const [preset] = await db
			.select({ genreId: schema.sessionPresets.genreId })
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, presetId))
			.limit(1)
		if (!preset) continue
		const keys = await pipelineByKey(db, preset.genreId)
		for (const row of await rowsAt(db, { kind: "preset", presetId }))
			if (!row.dropped && (await presetRowIsOf(db, slug, row, keys)))
				for (const v of explode(row.values as Values | null))
					keep({ scope: { kind: "preset", presetId }, ...v })
	}
	return out
}

/** What the step's pick of a key resolves to: the strongest scope in view (preset, genre, instance). */
const STRENGTH: Record<LeftoverScope["kind"], number> = {
	preset: 3,
	genre: 2,
	instance: 1
}

/** The context template a step resolves, and whether it is the pub's own copy. */
async function stepTemplate(
	db: Db,
	decls: readonly {
		nodeDefinitionId?: string
		nodeKey: string
		slot: string
		path: string
		control?: string
		authorDefault?: unknown
	}[],
	nodeKey: string,
	viewer: Viewer,
	chain: {
		preset: Map<string, unknown>
		session: Map<string, unknown> | null
	}
): Promise<{
	id: number
	name: string
	movable: boolean
	engine: string
} | null> {
	// A step with no template slot of its own (the context builder's) writes
	// text the pipeline's one template places: that template, when the
	// pipeline has exactly one — a reference to a key the builder lays out
	// is named there (`layout characters "…"`), and Assemble places it.
	const templateDecls = decls.filter(
		(d) => d.control === "context-template-ref"
	)
	const decl =
		templateDecls.find((d) => d.nodeKey === nodeKey) ??
		(templateDecls.length === 1 ? templateDecls[0] : undefined)
	if (!decl) return null
	const key = `${decl.nodeKey}${NUL}${decl.slot}${NUL}${decl.path}`
	let value: unknown = decl.authorDefault
	if (viewer.sessionId != null && chain.session?.has(key))
		value = chain.session.get(key)
	else if (chain.preset.has(key)) value = chain.preset.get(key)
	// No stored pick: the step renders core's shipped template for its node, so
	// it is named (and never movable).
	if (typeof value !== "number") {
		if (!decl.nodeDefinitionId) return null
		const { shippedContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const shipped = await shippedContextTemplate(db, decl.nodeDefinitionId)
		return shipped
			? {
					id: shipped.id,
					name: shipped.name,
					engine: shipped.engine ?? CORE_TEMPLATE_ENGINE,
					movable: false
				}
			: null
	}
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, value))
		.limit(1)
	if (!row) return null
	const engine = row.engine ?? CORE_TEMPLATE_ENGINE
	return {
		id: row.id,
		name: row.name,
		engine,
		movable:
			!row.isImmutable &&
			row.ownerPluginId == null &&
			(engine === CORE_TEMPLATE_ENGINE || engine === CORE_LIQUID_ENGINE)
	}
}

/** A pick as the module holds it: by node key, which never leaves it. */
type PlanPick = Omit<LeftoverPick, "stepKey"> & {
	nodeKey: string
	row: { reference: string | null; isImmutable: boolean }
}

interface Plan {
	steps: Array<{
		nodeKey: string
		slot: string
		template: Awaited<ReturnType<typeof stepTemplate>>
		/** Set when the step's lines show under another step's template. */
		stepHeading?: string
		picks: PlanPick[]
	}>
}

async function planOf(
	db: Db,
	slug: string,
	viewer: Viewer,
	opts: { sessionId?: number; presetId?: number }
): Promise<Plan> {
	const { published, declarationsAndVariableKeys } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const at = await published(db, slug)
	if (!at)
		throw new LeftoverPickRefusal(
			`There is no published pipeline called '${slug}'.`
		)
	const { decls, variableKeys } = await declarationsAndVariableKeys(
		db,
		at.specVersionId
	)
	const variableAt = new Map(
		variableKeys.map((k) => [
			`${k.nodeKey}${NUL}${k.slot}${NUL}${k.path}`,
			k.variableId
		])
	)
	const presetId = await presetInView(db, opts)
	const raw = await storedPicks(
		db,
		slug,
		new Set(variableAt.keys()),
		presetId != null ? [presetId] : []
	)
	if (!raw.length) return { steps: [] }

	const ids = [...new Set(raw.map((r) => r.value as number))]
	const rows = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(inArray(schema.pipelineVariableTemplates.id, ids))
	const rowById = new Map<number, (typeof rows)[number]>(
		rows.map((r) => [r.id, r])
	)

	const { layers } = await import("$lib/server/pipelines/config/panel/read")
	const chain = await layers(db, at, viewer)
	const presetNames = new Map<number, string>()
	for (const r of raw)
		if (r.scope.kind === "preset" && !presetNames.has(r.scope.presetId)) {
			const [p] = await db
				.select({ name: schema.sessionPresets.name })
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.id, r.scope.presetId))
				.limit(1)
			if (p) presetNames.set(r.scope.presetId, p.name)
		}
	const steps = new Map<string, Plan["steps"][number]>()
	for (const r of raw) {
		const variableId = variableAt.get(
			`${r.nodeKey}${NUL}${r.slot}${NUL}${r.path}`
		)!
		const row = rowById.get(r.value as number)
		// A pick naming a row that is gone, or one of another variable, is
		// inert at run time (`derefLayout`): it is no leftover to show.
		if (!row || row.variableId !== variableId) continue
		const stepKey = `${r.nodeKey}${NUL}${r.slot}`
		let step = steps.get(stepKey)
		if (!step) {
			const own = decls.find((d) => d.nodeKey === r.nodeKey)
			// The same pairing `stepTemplate` makes: no template of its own, and
			// the pipeline's one template is used.
			const templateDecls = decls.filter(
				(d) => d.control === "context-template-ref"
			)
			const underOther =
				templateDecls.length === 1 &&
				templateDecls[0].nodeKey !== r.nodeKey
			step = {
				nodeKey: r.nodeKey,
				slot: r.slot,
				stepHeading: underOther
					? (own?.stepHeading ?? own?.typeLabel)
					: undefined,
				template: await stepTemplate(
					db,
					decls as never,
					r.nodeKey,
					viewer,
					chain as never
				),
				picks: []
			}
			steps.set(stepKey, step)
		}
		const v = getVariable(variableId)
		step.picks.push({
			nodeKey: r.nodeKey,
			slot: r.slot,
			key: r.path,
			variableId,
			variableLabel: i18nText(v?.i18n?.name) ?? r.path,
			templateId: row.id,
			layoutName: row.name,
			scope: r.scope,
			...(r.scope.kind === "preset" && presetNames.has(r.scope.presetId)
				? { presetName: presetNames.get(r.scope.presetId) }
				: {}),
			row: {
				reference: row.reference ?? null,
				isImmutable: !!row.isImmutable
			}
		})
	}
	return { steps: [...steps.values()] }
}

/** Each step's leftover picks at the scope in view — see the module note. */
export async function leftoverPicksFor(
	db: Db,
	slug: string,
	viewer: Viewer,
	secret: string,
	opts: { sessionId?: number; presetId?: number } = {}
): Promise<LeftoverStep[]> {
	const plan = await planOf(db, slug, viewer, opts)
	return plan.steps.map((s) => ({
		stepKey: stepKeyFor(secret, s.nodeKey),
		slot: s.slot,
		contextTemplate: s.template
			? { id: s.template.id, name: s.template.name }
			: null,
		canMoveIntoTemplate: !!s.template?.movable,
		...(s.stepHeading ? { stepHeading: s.stepHeading } : {}),
		picks: s.picks.map(({ row: _row, nodeKey, ...p }) => ({
			...p,
			stepKey: stepKeyFor(secret, nodeKey)
		}))
	}))
}

/**
 * **Remove this pick**: remove one leftover pick, by scope and address, through
 * the module that owns that scope's values. Refuses a scope with no such pick.
 */
export async function clearLeftoverPick(
	db: Db,
	slug: string,
	secret: string,
	scope: LeftoverScope,
	address: { stepKey: string; slot: string; key: string }
): Promise<void> {
	const { published } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const { locateStep } = await import(
		"$lib/server/pipelines/config/variableLayoutsView"
	)
	const pub = await published(db, slug)
	const nodeKey = pub
		? await locateStep(db, secret, pub.specVersionId, address.stepKey)
		: null
	if (nodeKey === null)
		throw new LeftoverPickRefusal(
			"That step is not part of this pipeline. A newer version may have removed it, or the link was made on a different install."
		)
	await clearPickAt(db, slug, scope, {
		nodeKey,
		slot: address.slot,
		key: address.key
	})
}

/** The removal itself, by node key: the module's inside, never its boundary. */
async function clearPickAt(
	db: Db,
	slug: string,
	scope: LeftoverScope,
	address: { nodeKey: string; slot: string; key: string }
): Promise<void> {
	const at = {
		nodeKey: address.nodeKey,
		slot: address.slot,
		path: address.key
	}
	const { withAddress, genreValueTargets, setGenreValue } = await import(
		"$lib/server/pipelines/registrations/genreValues"
	)
	if (scope.kind === "instance") {
		const { instanceStoredValues, setInstanceValue } = await import(
			"$lib/server/pipelines/registrations/instanceValues"
		)
		const had = (await instanceStoredValues(db, slug)).some(
			(v) =>
				v.nodeKey === at.nodeKey &&
				v.slot === at.slot &&
				v.path === at.path
		)
		if (!had) throw new LeftoverPickRefusal(noSuchPick)
		await setInstanceValue(db, slug, at, undefined)
		return
	}
	if (scope.kind === "genre") {
		const targets = (await genreValueTargets(db, slug)).filter(
			(t) => t.genreId === scope.genreId
		)
		const { rowsAt } = await import(
			"$lib/server/pipelines/registrations/write"
		)
		const { genreChangeKey } = await import(
			"$lib/server/pipelines/registrations/rows"
		)
		const rows = await rowsAt(db, { kind: "genre", genreId: scope.genreId })
		const held = targets.filter((t) =>
			explode(
				rows.find((r) => r.key === genreChangeKey(t.key))
					?.values as Values | null
			).some(
				(v) =>
					v.nodeKey === at.nodeKey &&
					v.slot === at.slot &&
					v.path === at.path
			)
		)
		if (!held.length) throw new LeftoverPickRefusal(noSuchPick)
		await setGenreValue(db, held, at, undefined)
		return
	}
	// A preset's own rows, as the administrator wrote them.
	const { rowsAt, upsertRow, deleteRow } = await import(
		"$lib/server/pipelines/registrations/write"
	)
	const { ADMIN_PRESET_ORIGINS } = await import(
		"$lib/server/pipelines/registrations/presetRows"
	)
	const [preset] = await db
		.select({ genreId: schema.sessionPresets.genreId })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, scope.presetId))
		.limit(1)
	if (!preset) throw new LeftoverPickRefusal(noSuchPick)
	const keys = await pipelineByKey(db, preset.genreId)
	let cleared = false
	for (const row of await rowsAt(db, {
		kind: "preset",
		presetId: scope.presetId
	})) {
		if (!(ADMIN_PRESET_ORIGINS as readonly string[]).includes(row.origin))
			continue
		if (!(await presetRowIsOf(db, slug, row, keys))) continue
		if (
			!explode(row.values as Values | null).some(
				(v) =>
					v.nodeKey === at.nodeKey &&
					v.slot === at.slot &&
					v.path === at.path
			)
		)
			continue
		const next = withAddress(
			(row.values as Values | null) ?? null,
			at.nodeKey,
			at.slot,
			at.path,
			undefined
		)
		const bare =
			!row.triggerFamily &&
			row.when == null &&
			row.mode == null &&
			row.order == null &&
			row.allowStacking == null &&
			row.minAge == null &&
			row.caps == null &&
			row.label == null &&
			!row.dropped
		if (!next && bare)
			await deleteRow(
				db,
				{ kind: "preset", presetId: scope.presetId },
				row.key
			)
		else {
			const { id: _id, ...rest } = row
			await upsertRow(db, { ...rest, values: next as never })
		}
		cleared = true
	}
	if (!cleared) throw new LeftoverPickRefusal(noSuchPick)
}

const noSuchPick =
	"That variable layout is no longer set here — it may have been changed since the list was loaded."

// ── Move into the template ──────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Name a layout at every bare read of `key` in a template — `{{{key}}}` and
 * `{{key}}` (Handlebars) become `{{{layout key "<ref>"}}}`; `{{ key }}`
 * (Liquid) becomes `{{ key | layout: "<ref>" }}`. Reads already inside a
 * `layout` call, block helpers (`{{#if key}}`), sub-paths (`key.name`) and
 * escaped mustaches are left alone. Returns the new source and how many reads
 * it named.
 */
export function nameLayoutAtBareReads(
	engine: string,
	source: string,
	key: string,
	reference: string
): { source: string; count: number } {
	let count = 0
	const k = escapeRe(key)
	if (engine === CORE_TEMPLATE_ENGINE) {
		const triple = new RegExp(
			`(?<!\\\\)\\{\\{\\{(~?)\\s*${k}\\s*(~?)\\}\\}\\}`,
			"g"
		)
		const double = new RegExp(
			`(?<![\\\\{])\\{\\{(?!\\{)(~?)\\s*${k}\\s*(~?)\\}\\}(?!\\})`,
			"g"
		)
		const write = (_m: string, open: string, close: string) => {
			count++
			return `{{{${open}layout ${key} "${reference}"${close}}}}`
		}
		return {
			source: source.replace(triple, write).replace(double, write),
			count
		}
	}
	const liquid = new RegExp(`\\{\\{(-?)\\s*${k}\\s*(-?)\\}\\}`, "g")
	return {
		source: source.replace(liquid, (_m, open: string, close: string) => {
			count++
			return `{{${open} ${key} | layout: "${reference}" ${close}}}`
		}),
		count
	}
}

export interface MoveResult {
	/** The template that was rewritten. */
	templateId: number
	templateName: string
	/** The keys now named in the template, with the reference each was given. */
	moved: Array<{ key: string; reference: string; reads: number }>
	/** Keys whose pick was left, with why: nothing in the template reads them bare. */
	kept: Array<{ key: string; why: string }>
	/** Layouts that were given a reference by this move. */
	stamped: Array<{ templateId: number; reference: string }>
}

/**
 * **Move into the template**: the step's leftover picks become explicit layout
 * calls in its context template, and the step's leftovers are removed — one
 * transaction, `tx` only inside. Only the pub's own copy of a template; a pick
 * whose layout has no reference needs `ownerSlug` to be given one. A key the
 * template never reads bare keeps its pick (rewriting nothing would change
 * what the key renders as).
 */
export async function moveLeftoversIntoTemplate(
	db: Db,
	slug: string,
	viewer: Viewer,
	secret: string,
	step: { stepKey: string; slot: string },
	opts: { sessionId?: number; presetId?: number; ownerSlug?: string } = {}
): Promise<MoveResult> {
	const result = await db.transaction(async (tx: Db) => {
		const plan = await planOf(tx, slug, viewer, opts)
		const found = plan.steps.find(
			(s) =>
				stepKeyFor(secret, s.nodeKey) === step.stepKey &&
				s.slot === step.slot
		)
		if (!found)
			throw new LeftoverPickRefusal(
				"That step has no variable layout left over from before."
			)
		const template = found.template
		if (!template)
			throw new LeftoverPickRefusal(
				"This step's context template could not be found, so there is nothing to move the variable layouts into."
			)
		if (!template.movable)
			throw new LeftoverPickRefusal(
				`'${template.name}' is not this pub's own copy — it ships with Serene Pub or comes from a package, so it can't be rewritten. ` +
					`Duplicate it, pick the copy for this step, and move into that.`
			)

		// One pick per key: the strongest scope in view. A weaker one naming a
		// different layout would be hidden today and shown by the move: refuse.
		const effective = new Map<string, (typeof found.picks)[number]>()
		for (const p of found.picks) {
			const held = effective.get(p.key)
			if (!held || STRENGTH[p.scope.kind] > STRENGTH[held.scope.kind])
				effective.set(p.key, p)
		}
		for (const p of found.picks) {
			const winner = effective.get(p.key)!
			if (p.templateId !== winner.templateId)
				throw new LeftoverPickRefusal(
					`${p.variableLabel} is set to '${winner.layoutName}' in one place and '${p.layoutName}' in another. ` +
						`Press Remove this pick on the one you don't want, then move the rest.`
				)
		}
		// A pick on another preset the view doesn't show would be overridden by
		// the named layout. Refuse rather than change what that preset renders.
		await refuseOtherPresetsDiffering(tx, slug, found, effective, opts)

		const [row] = await tx
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, template.id))
			.limit(1)
		if (!row)
			throw new LeftoverPickRefusal(
				"That context template no longer exists."
			)
		const engine = row.engine ?? CORE_TEMPLATE_ENGINE

		// Which keys the template reads bare (a pass with a stand-in reference).
		const reads = new Map<string, number>()
		for (const key of effective.keys())
			reads.set(
				key,
				nameLayoutAtBareReads(engine, row.source ?? "", key, "x/x@1")
					.count
			)
		const movable = [...effective.values()].filter(
			(p) => (reads.get(p.key) ?? 0) > 0
		)
		const kept = [...effective.values()]
			.filter((p) => !movable.includes(p))
			.map((p) => ({
				key: p.key,
				why: `'${template.name}' never reads ${p.key} on its own line, so there is nothing to name — its pick stays.`
			}))
		if (!movable.length)
			throw new LeftoverPickRefusal(
				`'${template.name}' doesn't write any of these variables out by name, so there is nothing to move. Press Remove this pick on each pick instead.`
			)

		// A reference for each picked layout that lacks one.
		const { stampReference } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const stamped: MoveResult["stamped"] = []
		const referenceOf = new Map<number, string>()
		for (const p of movable) {
			let reference = p.row.reference
			if (!reference) {
				if (!opts.ownerSlug?.trim())
					throw new LeftoverPickRefusal(
						`'${p.layoutName}' has no reference yet, and a template names a layout by its reference. ` +
							`Say whose name to file it under (your owner slug, for example 'acme') and it will be given one.`,
						"needs-owner-slug"
					)
				const done = await stampReference(
					tx,
					p.templateId,
					opts.ownerSlug.trim()
				)
				reference = done.reference!
				stamped.push({ templateId: p.templateId, reference })
			}
			referenceOf.set(p.templateId, reference)
		}

		let source = row.source ?? ""
		const written: Array<{ key: string; reference: string }> = []
		const moved: MoveResult["moved"] = []
		for (const p of movable) {
			const reference = referenceOf.get(p.templateId)!
			const r = nameLayoutAtBareReads(engine, source, p.key, reference)
			source = r.source
			for (let i = 0; i < r.count; i++)
				written.push({ key: p.key, reference })
			moved.push({ key: p.key, reference, reads: r.count })
		}

		const { updateContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		await updateContextTemplate(tx, template.id, { source })

		// The calls the new source carries must be exactly the ones written.
		const calls = variableLayoutCalls(engine, source)
		const expected = (list: Array<{ key: string; reference: string }>) =>
			list.map((c) => `${c.key}\u0000${c.reference}`).sort()
		const before = variableLayoutCalls(engine, row.source ?? "")
		const added = expected(calls)
		for (const b of expected(before)) {
			const at = added.indexOf(b)
			if (at >= 0) added.splice(at, 1)
		}
		if (JSON.stringify(added) !== JSON.stringify(expected(written)))
			throw new LeftoverPickRefusal(
				"The template could not be rewritten cleanly, so nothing was changed. Name the layouts in the template by hand."
			)

		// The step's leftovers go — those the template now says outright.
		for (const p of found.picks) {
			if (!movable.some((m) => m.key === p.key)) continue
			await clearPickAt(tx, slug, p.scope, {
				nodeKey: p.nodeKey,
				slot: p.slot,
				key: p.key
			})
		}
		return {
			templateId: template.id,
			templateName: template.name,
			moved,
			kept,
			stamped
		}
	})
	// The write above invalidated inside the transaction; once it is committed
	// nobody may serve the old rows.
	const { invalidateRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	invalidateRegistrations()
	return result
}

async function refuseOtherPresetsDiffering(
	db: Db,
	slug: string,
	step: Plan["steps"][number],
	effective: ReadonlyMap<string, PlanPick>,
	opts: { sessionId?: number; presetId?: number }
): Promise<void> {
	const inView = await presetInView(db, opts)
	const presets = await db
		.select({
			id: schema.sessionPresets.id,
			name: schema.sessionPresets.name
		})
		.from(schema.sessionPresets)
	const others = presets.filter((p) => p.id !== inView)
	if (!others.length) return
	const { published, declarationsAndVariableKeys } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const at = await published(db, slug)
	if (!at) return
	const { variableKeys } = await declarationsAndVariableKeys(
		db,
		at.specVersionId
	)
	const variableAt = new Set(
		variableKeys.map((k) => `${k.nodeKey}${NUL}${k.slot}${NUL}${k.path}`)
	)
	const found = await storedPicks(
		db,
		slug,
		variableAt,
		others.map((p) => p.id)
	)
	for (const r of found) {
		if (
			r.scope.kind !== "preset" ||
			r.nodeKey !== step.nodeKey ||
			r.slot !== step.slot
		)
			continue
		const winner = effective.get(r.path)
		if (!winner || r.value === winner.templateId) continue
		const name =
			others.find(
				(p) => p.id === (r.scope as { presetId: number }).presetId
			)?.name ?? "another preset"
		throw new LeftoverPickRefusal(
			`The preset '${name}' sets ${winner.variableLabel} to a different layout on this step. Naming one in the template would override it — ` +
				`open that preset's step and press Remove this pick there first.`
		)
	}
}
