/**
 * 0151 — **Variable layouts: one choice per variable** (PLAN variable-layouts
 * 2026-11-10, Data item 4). The migration adds `pipeline_variable_templates.
 * reference` / `.pub_default` and `session_presets.variable_layouts`. This
 * upgrade moves the per-step picks stored before it onto them.
 *
 * ## The invariant: no prompt changes, anywhere
 *
 * For every preset and every step it runs, the layout each variable renders
 * through after this upgrade is the one it rendered through before. Everything
 * below is in service of that, and anything it cannot model with certainty is
 * left exactly as it was.
 *
 * ## Shape: loader → pure planner → applier
 *
 *  · `loadRaw` — raw SQL through `tx` only, into plain rows (`RawRows`);
 *  · `buildSnapshot` — pure: rows → the static universe of steps, the picks'
 *    holders, the contexts that read them (`Snapshot`);
 *  · `planVariableLayoutUpgrade` — pure: snapshot → actions;
 *  · `apply` — raw SQL through `tx` only.
 * No schema-typed table is imported; the only app code used is pure constants
 * (`variableLayouts.ts`, `objectVariableLayouts.ts`, the catalogue's rows).
 *
 * ## The algorithm, exactly as implemented
 *
 * 1. **Snapshot.** Layout rows; every active spec's *steps* — `(spec, node,
 *    slot, key) → variable`, the node registry's `variables` slots with the
 *    spec's own `renders` laid over (the static universe: no open renders);
 *    the holders of picks (`registrations` rows at genre and preset scope with
 *    `values`, and `pipeline_specs.instance_values`); presets; each variable's
 *    existing pub's layout. Session-scope rows are ignored: a session's pick
 *    sits above everything, before and after.
 * 2. **Package default `D(V)`**: the rule of `defaultVariableTemplateFor` — the
 *    catalogue's row for the variable by seed key, else core's shipped default
 *    row by seed key, else the lowest-id row that is not withdrawn and not a
 *    foreign package's. (`packageDefaultFor`)
 * 3. **Contexts.** One for each registration of each genre's defaults
 *    (`genre`); one for each registration each preset can run — its genre's
 *    registrations plus its own (`preset`; over-including is safe, missing one
 *    is not); one for each spec nothing registers at any scope
 *    (`unregistered`: instance values, then `D`). A context reads, in order of
 *    strength: the preset's row for the registration, the genre's rows (an
 *    administrator's change row over the registering row), the spec's instance
 *    values.
 * 4. **Resolution** of a step in a context: preset pick → genre pick →
 *    instance pick → the preset's variable layout → the pub's layout → `D(V)`.
 *    "Before" is this on the stored state, so a second run sees the first
 *    run's results.
 * 5. **Unpromotable `V`** — no change at all to `V`'s picks or layouts — when:
 *    a pick at one of its steps is not a number naming one of its rows (a seed
 *    reference, a decision, a row of another variable); a numeric pick sits at
 *    an address no step reaches; two rows of one registration state the same
 *    slot (the later replaces the earlier whole, so a pick can hide); the
 *    active version's author preset names a layout for it; an open `renders`
 *    (a band) could carry it. When unsure: leave it alone.
 * 6. **Pub level**, per promotable `V` with no pub's layout row yet: when every
 *    genre-level context's every step rendering `V` (`genre`, `unregistered`)
 *    resolves to one row `X`, `X ≠ D(V)` and `X` is not withdrawn → `X` is
 *    marked `pub_default`.
 * 7. **Preset level**, per preset an administrator owns (`seed_key` and
 *    `owner_plugin_id` NULL, not immutable) and promotable `V` where the preset
 *    has no variable layout for it: when every step the preset runs rendering
 *    `V` resolves to one row `X`, `X ≠ (pub's layout ?? D(V))` and `X` is a core
 *    shipped row → `variable_layouts[V] = coreLayoutReferenceFor(X)`.
 * 8. **Removal**, for picks on rows an administrator owns (origin `admin` or
 *    `upgrade`; projected rows are re-written at boot and stay): a pick goes
 *    only if every context that reads it resolves identically without it, given
 *    the state so far — swept in a fixed order (registration row id, then the
 *    instance values by spec slug; node, slot, key) until nothing more can go.
 *    A genre pick outranks a preset's variable layout, so a preset keeps its
 *    own pick on a step where a different genre pick sits below it.
 * 9. **Verify**, per `V`, before applying: every context's every step is
 *    resolved again with the actions in place; any difference drops all of
 *    `V`'s actions (logged). Then apply: picks removed from `values` (emptied
 *    objects dropped, an empty `values` becomes NULL), `pub_default` set,
 *    `variable_layouts` written.
 */
import { sql } from "drizzle-orm"
import { SHIPPED_SPEECH_VARIABLE_LAYOUTS } from "@serene-pub/core-catalog"
import { rawRows } from "../rawRows"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	seedKeyFor
} from "$lib/server/pipelines/entities/variableLayouts"
import { coreLayoutReferenceFor } from "$lib/server/pipelines/entities/objectVariableLayouts"

// ── types ────────────────────────────────────────────────────────────────

type Values = Record<string, Record<string, unknown>>

export interface LayoutRow {
	id: number
	variableId: string
	seedKey: string | null
	templateId: string | null
	ownerPluginId: number | null
	withdrawn: boolean
	reference: string | null
	pubDefault: boolean
}

/** One thing a spec renders through a variable layout: `(spec, node, slot, key) → variable`. */
export interface Step {
	spec: string
	node: string
	slot: string
	key: string
	variableId: string
}

/** Somewhere picks are stored: a registration row, or a spec's instance values. */
export interface Holder {
	/** `reg:<row id>` or `inst:<spec slug>`. */
	id: string
	/** The spec whose steps its addresses mean; null when none can be told. */
	spec: string | null
	/** An administrator's row — the only kind the upgrade removes picks from. */
	removable: boolean
	values: Values | null
}

export interface Context {
	id: string
	kind: "genre" | "preset" | "unregistered"
	presetId: number | null
	spec: string
	presetHolder: string | null
	/** Strongest first. */
	genreHolders: string[]
	instanceHolder: string | null
}

export interface PresetRow {
	id: number
	/** `seed_key` and `owner_plugin_id` NULL, not immutable. */
	adminOwned: boolean
	variableLayouts: Record<string, string>
}

export interface Snapshot {
	layouts: LayoutRow[]
	/** `D(V)` per variable (null: nothing to default to). */
	defaults: Record<string, number | null>
	steps: Step[]
	holders: Holder[]
	contexts: Context[]
	presets: PresetRow[]
	/** Variables already unpromotable before the picks are read, with the reason. */
	locked: Record<string, string>
	/** Every `variables` slot name any node declares — for a holder whose spec is unknown. */
	variableSlotNames: string[]
}

export type Action =
	| {
			kind: "removePick"
			holder: string
			node: string
			slot: string
			key: string
	  }
	| { kind: "setPubLayout"; variableId: string; layoutId: number }
	| {
			kind: "setPresetLayout"
			presetId: number
			variableId: string
			reference: string
	  }

export interface Plan {
	actions: Action[]
	/** Variables left exactly as they were, and why. */
	leftAlone: Array<{ variableId: string; reason: string }>
	/** Variables whose planned actions failed verification and were dropped. */
	dropped: Array<{ variableId: string; reason: string }>
}

// ── the pure planner ─────────────────────────────────────────────────────

const plain = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

const addr = (...parts: string[]) => parts.join("\u0000")

/** A core shipped row: one core seeded, which has a fixed reference. */
const coreReferenceOf = (row: LayoutRow): string | null =>
	row.ownerPluginId == null ? coreLayoutReferenceFor(row.seedKey) : null

/** `D(V)` — the rule of `defaultVariableTemplateFor`, over a snapshot's rows. */
export function packageDefaultFor(
	variableId: string,
	layouts: readonly LayoutRow[],
	shipped: { speechSeedKey?: string; defaultSeedKey?: string }
): number | null {
	for (const seedKey of [shipped.speechSeedKey, shipped.defaultSeedKey]) {
		if (!seedKey) continue
		const row = layouts.find((r) => r.seedKey === seedKey)
		if (row) return row.id
	}
	const variableOwner = variableId.split(":")[0]
	const first = [...layouts]
		.filter((r) => r.variableId === variableId && !r.withdrawn)
		.sort((a, b) => a.id - b.id)
		.find((r) => {
			// A package's row for a variable it does not own is never the default.
			if (r.ownerPluginId == null) return true
			return (
				variableOwner !== "core" &&
				r.templateId?.split(":")[0] === variableOwner
			)
		})
	return first?.id ?? null
}

interface Sim {
	removed: Set<string>
	pub: number | null
	presetLayout: Map<number, string>
}

interface Pair {
	ctx: Context
	step: Step
}

/** What the lookups every resolution needs, built once per snapshot. */
function indexOf(snap: Snapshot) {
	const layoutById = new Map(snap.layouts.map((r) => [r.id, r]))
	const holderById = new Map(snap.holders.map((h) => [h.id, h]))
	const stepsBySpec = new Map<string, Step[]>()
	const stepAt = new Map<string, Step>()
	const slotsOfSpec = new Map<string, Map<string, Step[]>>()
	const into = <K, T>(map: Map<K, T[]>, key: K, item: T) => {
		const list = map.get(key)
		if (list) list.push(item)
		else map.set(key, [item])
	}
	for (const s of snap.steps) {
		into(stepsBySpec, s.spec, s)
		stepAt.set(addr(s.spec, s.node, s.slot, s.key), s)
		const slots = slotsOfSpec.get(s.spec) ?? new Map<string, Step[]>()
		slotsOfSpec.set(s.spec, slots)
		into(slots, addr(s.node, s.slot), s)
	}
	const refToRow = new Map<string, LayoutRow>()
	for (const r of [...snap.layouts].sort((a, b) => a.id - b.id)) {
		if (r.withdrawn) continue
		const ref = r.reference ?? coreReferenceOf(r)
		if (ref && !refToRow.has(addr(r.variableId, ref)))
			refToRow.set(addr(r.variableId, ref), r)
	}
	const pickOf = (
		h: Holder | undefined,
		step: Step,
		sim: Sim
	): number | null => {
		if (!h) return null
		if (sim.removed.has(addr(h.id, step.node, step.slot, step.key)))
			return null
		const slot = h.values?.[step.node]?.[step.slot]
		const v = plain(slot) ? slot[step.key] : undefined
		return typeof v === "number" ? v : null
	}
	/** 4. Resolution of a step in a context. */
	const resolve = (ctx: Context, step: Step, sim: Sim): number | null => {
		const layers = [
			ctx.presetHolder,
			...ctx.genreHolders,
			ctx.instanceHolder
		]
		for (const id of layers) {
			if (!id) continue
			const v = pickOf(holderById.get(id), step, sim)
			if (v !== null) return v
		}
		if (ctx.presetId != null) {
			const ref = sim.presetLayout.get(ctx.presetId)
			const row = ref
				? refToRow.get(addr(step.variableId, ref))
				: undefined
			if (row) return row.id
		}
		if (sim.pub !== null) return sim.pub
		return snap.defaults[step.variableId] ?? null
	}
	return {
		layoutById,
		holderById,
		stepsBySpec,
		stepAt,
		slotsOfSpec,
		refToRow,
		pickOf,
		resolve
	}
}

/** The state a snapshot stores: no pick removed, its pub's layout, its presets' layouts for `variableId`. */
function storedSim(snap: Snapshot, variableId: string): Sim {
	return {
		removed: new Set(),
		pub:
			snap.layouts.find(
				(r) =>
					r.variableId === variableId && r.pubDefault && !r.withdrawn
			)?.id ?? null,
		presetLayout: new Map(
			snap.presets
				.filter((p) => p.variableLayouts[variableId] !== undefined)
				.map((p) => [p.id, p.variableLayouts[variableId]!])
		)
	}
}

/** Every context's every step, resolved on the stored state: `<context>|<node>/<slot>/<key>` → layout row. */
export function resolutions(snap: Snapshot): Map<string, number | null> {
	const { stepsBySpec, resolve } = indexOf(snap)
	const sims = new Map<string, Sim>()
	const out = new Map<string, number | null>()
	for (const ctx of snap.contexts)
		for (const step of stepsBySpec.get(ctx.spec) ?? []) {
			const sim =
				sims.get(step.variableId) ?? storedSim(snap, step.variableId)
			sims.set(step.variableId, sim)
			out.set(
				`${ctx.id}|${step.node}/${step.slot}/${step.key}`,
				resolve(ctx, step, sim)
			)
		}
	return out
}

/** The snapshot a plan leaves behind (the pure twin of `apply`). */
export function applyToSnapshot(snap: Snapshot, plan: Plan): Snapshot {
	const removals = new Map<
		string,
		Array<{ node: string; slot: string; key: string }>
	>()
	for (const a of plan.actions)
		if (a.kind === "removePick") {
			const list = removals.get(a.holder) ?? []
			list.push(a)
			removals.set(a.holder, list)
		}
	return {
		...snap,
		layouts: snap.layouts.map((r) =>
			plan.actions.some(
				(a) => a.kind === "setPubLayout" && a.layoutId === r.id
			)
				? { ...r, pubDefault: true }
				: r
		),
		holders: snap.holders.map((h) => {
			const picks = removals.get(h.id)
			return picks && h.values
				? { ...h, values: withoutPicks(h.values, picks) }
				: h
		}),
		presets: snap.presets.map((p) => ({
			...p,
			variableLayouts: {
				...p.variableLayouts,
				...Object.fromEntries(
					plan.actions
						.filter(
							(a) =>
								a.kind === "setPresetLayout" &&
								a.presetId === p.id
						)
						.map((a) => [
							(a as { variableId: string }).variableId,
							(a as { reference: string }).reference
						])
				)
			}
		}))
	}
}

export function planVariableLayoutUpgrade(snap: Snapshot): Plan {
	const plan: Plan = { actions: [], leftAlone: [], dropped: [] }
	const {
		layoutById,
		holderById,
		stepsBySpec,
		stepAt,
		slotsOfSpec,
		pickOf,
		resolve
	} = indexOf(snap)

	// ── 5. what cannot be promoted ──────────────────────────────────────
	const locks = new Map<string, string>(Object.entries(snap.locked))
	const lock = (variableId: string, why: string) => {
		if (!locks.has(variableId)) locks.set(variableId, why)
	}
	const validPick = (raw: unknown, variableId: string) =>
		typeof raw === "number" &&
		layoutById.get(raw)?.variableId === variableId
	const globalSlots = new Set(snap.variableSlotNames)
	for (const h of snap.holders) {
		for (const [node, slots] of Object.entries(h.values ?? {})) {
			if (!plain(slots)) continue
			for (const [slot, val] of Object.entries(slots)) {
				const ours = h.spec
					? (slotsOfSpec.get(h.spec)?.has(addr(node, slot)) ?? false)
					: globalSlots.has(slot)
				if (!ours) continue
				const stated: Array<[string, unknown]> = plain(val)
					? Object.entries(val)
					: [["", val]]
				for (const [key, raw] of stated) {
					if (raw === null || raw === undefined) continue
					const step = h.spec
						? stepAt.get(addr(h.spec, node, slot, key))
						: undefined
					if (step) {
						if (!validPick(raw, step.variableId))
							lock(
								step.variableId,
								`a pick at ${node}/${key} does not name one of its layouts`
							)
					} else if (typeof raw === "number") {
						const row = layoutById.get(raw)
						if (row)
							lock(
								row.variableId,
								`a pick at ${node}/${slot}/${key} reaches no step this build knows`
							)
					}
				}
			}
		}
	}
	for (const ctx of snap.contexts) {
		if (ctx.genreHolders.length < 2) continue
		for (const [slotAddr, steps] of slotsOfSpec.get(ctx.spec) ?? []) {
			const [node, slot] = slotAddr.split("\u0000") as [string, string]
			const stating = ctx.genreHolders.filter((id) => {
				const v = holderById.get(id)?.values?.[node]?.[slot]
				return v !== undefined && v !== null
			})
			if (stating.length > 1)
				for (const s of steps)
					lock(
						s.variableId,
						`two rows of one registration state ${node}/${slot}`
					)
		}
	}

	const variables = [...new Set(snap.steps.map((s) => s.variableId))].sort()
	const holderOrder = (id: string) => {
		const [kind, rest] = id.split(":") as [string, string]
		return kind === "reg" ? [0, Number(rest), ""] : [1, 0, rest]
	}
	const holderCompare = (a: string, b: string) => {
		const x = holderOrder(a)
		const y = holderOrder(b)
		return (
			(x[0] as number) - (y[0] as number) ||
			(x[1] as number) - (y[1] as number) ||
			((x[2] as string) < (y[2] as string)
				? -1
				: (x[2] as string) > (y[2] as string)
					? 1
					: 0)
		)
	}
	const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

	for (const V of variables) {
		const why = locks.get(V)
		if (why) {
			plan.leftAlone.push({ variableId: V, reason: why })
			continue
		}
		const pairs: Pair[] = []
		for (const ctx of snap.contexts)
			for (const step of stepsBySpec.get(ctx.spec) ?? [])
				if (step.variableId === V) pairs.push({ ctx, step })
		if (!pairs.length) continue

		const pubRows = snap.layouts.filter(
			(r) => r.variableId === V && r.pubDefault
		)
		const sim = storedSim(snap, V)
		const before = pairs.map((p) => resolve(p.ctx, p.step, sim))
		const D = snap.defaults[V] ?? null
		const actions: Action[] = []

		// ── 6. pub level ──
		if (!pubRows.length) {
			const level = pairs
				.map((p, i) => ({ p, at: before[i]! }))
				.filter(({ p }) => p.ctx.kind !== "preset")
			const first = level[0]?.at
			if (
				first != null &&
				level.every(({ at }) => at === first) &&
				first !== D &&
				layoutById.get(first)?.variableId === V &&
				!layoutById.get(first)!.withdrawn
			) {
				sim.pub = first
				actions.push({
					kind: "setPubLayout",
					variableId: V,
					layoutId: first
				})
			}
		}

		// ── 7. preset level ──
		for (const preset of [...snap.presets].sort((a, b) => a.id - b.id)) {
			if (!preset.adminOwned || preset.variableLayouts[V] !== undefined)
				continue
			const mine = pairs
				.map((p, i) => ({ p, i }))
				.filter(({ p }) => p.ctx.presetId === preset.id)
			if (!mine.length) continue
			const x = before[mine[0]!.i]
			if (x == null || !mine.every(({ i }) => before[i] === x)) continue
			if (x === (sim.pub ?? D)) continue
			const row = layoutById.get(x)
			const reference = row ? coreReferenceOf(row) : null
			if (!row || row.variableId !== V || row.withdrawn || !reference)
				continue
			sim.presetLayout.set(preset.id, reference)
			actions.push({
				kind: "setPresetLayout",
				presetId: preset.id,
				variableId: V,
				reference
			})
		}

		// ── 8. removal ──
		const candidates: Array<{
			holder: string
			node: string
			slot: string
			key: string
		}> = []
		for (const h of snap.holders) {
			if (!h.removable || !h.spec) continue
			for (const step of stepsBySpec.get(h.spec) ?? []) {
				if (step.variableId !== V) continue
				if (pickOf(h, step, { ...sim, removed: new Set() }) !== null)
					candidates.push({
						holder: h.id,
						node: step.node,
						slot: step.slot,
						key: step.key
					})
			}
		}
		candidates.sort(
			(a, b) =>
				holderCompare(a.holder, b.holder) ||
				cmp(a.node, b.node) ||
				cmp(a.slot, b.slot) ||
				cmp(a.key, b.key)
		)
		const reads = (ctx: Context, holder: string) =>
			ctx.presetHolder === holder ||
			ctx.instanceHolder === holder ||
			ctx.genreHolders.includes(holder)
		const removals: typeof candidates = []
		for (let changed = true; changed; ) {
			changed = false
			for (const c of candidates) {
				const k = addr(c.holder, c.node, c.slot, c.key)
				if (sim.removed.has(k)) continue
				const affected = pairs.filter(
					(p) =>
						reads(p.ctx, c.holder) &&
						p.step.node === c.node &&
						p.step.slot === c.slot &&
						p.step.key === c.key
				)
				const was = affected.map((p) => resolve(p.ctx, p.step, sim))
				sim.removed.add(k)
				// A pick no context reads is not provably inert: it stays.
				if (
					affected.length &&
					affected.every(
						(p, i) => resolve(p.ctx, p.step, sim) === was[i]
					)
				) {
					removals.push(c)
					changed = true
				} else sim.removed.delete(k)
			}
		}
		for (const c of removals) actions.push({ kind: "removePick", ...c })

		// ── 9. verify ──
		const bad = pairs.findIndex(
			(p, i) => resolve(p.ctx, p.step, sim) !== before[i]
		)
		if (bad >= 0) {
			const p = pairs[bad]!
			plan.dropped.push({
				variableId: V,
				reason: `${p.ctx.id} at ${p.step.node}/${p.step.key} would have changed`
			})
			continue
		}
		plan.actions.push(...actions)
	}
	return plan
}

// ── the snapshot, from raw rows ──────────────────────────────────────────

export interface RawRows {
	layouts: LayoutRow[]
	specs: Array<{
		slug: string
		activeVersionId: number | null
		instanceValues: unknown
	}>
	nodes: Array<{
		specVersionId: number
		nodeKey: string
		definitionId: string
		definitionVersion: number
		renders: unknown
		config: unknown
	}>
	registry: Array<{
		definitionId: string
		version: number
		slots: unknown
		policy: unknown
	}>
	/** The active version's default author preset's value rows. */
	authorValues: Array<{
		specVersionId: number
		nodeKey: string
		slot: string
		path: string | null
	}>
	registrations: Array<{
		id: number
		scopeKind: string
		scopeRef: string
		presetId: number | null
		key: string
		specSlug: string | null
		triggerFamily: string | null
		dropped: boolean
		values: unknown
		origin: string
	}>
	/** Specs a session-scope row registers. */
	sessionRegistered: string[]
	presets: Array<{
		id: number
		genreId: string
		seedKey: string | null
		ownerPluginId: number | null
		isImmutable: boolean
		variableLayouts: unknown
	}>
}

const GENRE_CHANGE_PREFIX = "admin:"
const baseKeyOf = (key: string) =>
	key.startsWith(GENRE_CHANGE_PREFIX)
		? key.slice(GENRE_CHANGE_PREFIX.length)
		: key
/** Origins of rows an administrator owns — the rest are projections the boot re-writes. */
const REMOVABLE_ORIGINS: readonly string[] = ["admin", "upgrade"]

const variableIdOf = (v: unknown): string | undefined =>
	typeof v === "string"
		? v
		: plain(v) && typeof v.id === "string"
			? v.id
			: undefined

const hasValues = (v: unknown): v is Values =>
	plain(v) && Object.keys(v).length > 0

/** Defaults that need code: the catalogue's row and core's shipped default, by variable. */
function shippedDefaultsOf(variableId: string): {
	speechSeedKey?: string
	defaultSeedKey?: string
} {
	const speech = SHIPPED_SPEECH_VARIABLE_LAYOUTS.find(
		(t) => t.variableId === variableId
	)
	const shipped = SHIPPED_VARIABLE_TEMPLATES.find(
		(t) => t.variableId === variableId && t.isDefault
	)
	return {
		speechSeedKey: speech?.seedKey,
		defaultSeedKey: shipped ? seedKeyFor(shipped) : undefined
	}
}

export function buildSnapshot(raw: RawRows): Snapshot {
	// The static universe of steps.
	const registry = new Map(
		raw.registry.map((r) => [`${r.definitionId}@${r.version}`, r])
	)
	const steps: Step[] = []
	const locked: Record<string, string> = {}
	const slotNames = new Set<string>()
	let openRenders = false
	const specByVersion = new Map<number, string>()
	for (const spec of raw.specs) {
		if (spec.activeVersionId == null) continue
		specByVersion.set(spec.activeVersionId, spec.slug)
		for (const node of raw.nodes.filter(
			(n) => n.specVersionId === spec.activeVersionId
		)) {
			const row = registry.get(
				`${node.definitionId}@${node.definitionVersion}`
			)
			if (!row || !plain(row.slots)) continue
			for (const [slotName, decl] of Object.entries(row.slots)) {
				if (!plain(decl) || decl.kind !== "variables") continue
				// A slot the spec wired to another node's is that node's to choose
				// (`declarations()` skips it the same way).
				const wired = plain(node.config)
					? node.config[slotName]
					: undefined
				if (
					plain(wired) &&
					wired.__ref === "slot" &&
					((wired.ofNode && wired.ofNode !== node.nodeKey) ||
						!!wired.ofEnvoy)
				)
					continue
				const renders: Record<string, string> = plain(decl.renders)
					? { ...(decl.renders as Record<string, string>) }
					: {}
				if (plain(node.renders))
					for (const [k, id] of Object.entries(node.renders))
						if (
							Object.prototype.hasOwnProperty.call(renders, k) &&
							typeof id === "string"
						)
							renders[k] = id
				for (const [key, variableId] of Object.entries(renders))
					steps.push({
						spec: spec.slug,
						node: node.nodeKey,
						slot: slotName,
						key,
						variableId
					})
				if (plain(decl.rendersBands)) openRenders = true
			}
		}
	}
	for (const r of raw.registry)
		if (plain(r.slots))
			for (const [slotName, decl] of Object.entries(r.slots))
				if (plain(decl) && decl.kind === "variables")
					slotNames.add(slotName)

	// An open `renders` could carry any variable a node declares as a band.
	if (openRenders)
		for (const r of raw.registry) {
			const bands =
				plain(r.policy) && plain(r.policy.bands) ? r.policy.bands : {}
			for (const v of Object.values(bands)) {
				const id = variableIdOf(v)
				if (id) locked[id] ??= "an open renders (a band) may carry it"
			}
		}
	// A layout the pipeline's own author preset names.
	for (const a of raw.authorValues) {
		const spec = specByVersion.get(a.specVersionId)
		if (!spec) continue
		for (const s of steps)
			if (
				s.spec === spec &&
				s.node === a.nodeKey &&
				s.slot === a.slot &&
				(!a.path || a.path === s.key)
			)
				locked[s.variableId] ??=
					"its pipeline's author names a layout for it"
	}

	// Holders.
	const regs = [...raw.registrations].sort((a, b) => a.id - b.id)
	const registers = (r: RawRows["registrations"][number]) =>
		!r.dropped && !!r.triggerFamily && !!r.specSlug
	const specOfKey = (
		scopeKind: string,
		scopeRef: string,
		presetId: number | null,
		key: string
	): string | null => {
		const base = baseKeyOf(key)
		const own = regs.find(
			(r) =>
				registers(r) &&
				r.scopeKind === scopeKind &&
				r.scopeRef === scopeRef &&
				r.key === base
		)
		if (own) return own.specSlug
		if (scopeKind === "preset") {
			const genreId = raw.presets.find((p) => p.id === presetId)?.genreId
			const g = regs.find(
				(r) =>
					registers(r) &&
					r.scopeKind === "genre" &&
					r.scopeRef === genreId &&
					r.key === base
			)
			return g?.specSlug ?? null
		}
		return null
	}
	const holders: Holder[] = []
	for (const r of regs) {
		if (
			r.dropped ||
			!hasValues(r.values) ||
			(r.scopeKind !== "genre" && r.scopeKind !== "preset")
		)
			continue
		holders.push({
			id: `reg:${r.id}`,
			spec: registers(r)
				? r.specSlug
				: specOfKey(r.scopeKind, r.scopeRef, r.presetId, r.key),
			removable: REMOVABLE_ORIGINS.includes(r.origin),
			values: r.values
		})
	}
	const specs = raw.specs.filter((s) => s.activeVersionId != null)
	for (const s of [...specs].sort((a, b) => (a.slug < b.slug ? -1 : 1)))
		if (hasValues(s.instanceValues))
			holders.push({
				id: `inst:${s.slug}`,
				spec: s.slug,
				removable: true,
				values: s.instanceValues
			})
	const holderIds = new Set(holders.map((h) => h.id))
	const instanceOf = (spec: string) =>
		holderIds.has(`inst:${spec}`) ? `inst:${spec}` : null

	// Contexts.
	const contexts: Context[] = []
	const genreRows = (genreId: string, key: string) =>
		regs
			.filter(
				(r) =>
					r.scopeKind === "genre" &&
					r.scopeRef === genreId &&
					!r.dropped &&
					baseKeyOf(r.key) === key &&
					holderIds.has(`reg:${r.id}`)
			)
			// An administrator's change over the registering row.
			.sort(
				(a, b) =>
					Number(registers(a)) - Number(registers(b)) || a.id - b.id
			)
			.map((r) => `reg:${r.id}`)
	const genreIds = [
		...new Set(
			regs.filter((r) => r.scopeKind === "genre").map((r) => r.scopeRef)
		)
	].sort()
	for (const genreId of genreIds) {
		const keys = [
			...new Set(
				regs
					.filter(
						(r) =>
							r.scopeKind === "genre" &&
							r.scopeRef === genreId &&
							registers(r)
					)
					.map((r) => r.key)
			)
		]
		for (const key of keys) {
			const spec = regs.find(
				(r) =>
					r.scopeKind === "genre" &&
					r.scopeRef === genreId &&
					registers(r) &&
					r.key === key
			)!.specSlug!
			contexts.push({
				id: `genre:${genreId}:${key}`,
				kind: "genre",
				presetId: null,
				spec,
				presetHolder: null,
				genreHolders: genreRows(genreId, key),
				instanceHolder: instanceOf(spec)
			})
		}
	}
	for (const preset of [...raw.presets].sort((a, b) => a.id - b.id)) {
		const own = regs.filter(
			(r) =>
				r.scopeKind === "preset" &&
				r.presetId === preset.id &&
				!r.dropped
		)
		const keys = [
			...new Set([
				...regs
					.filter(
						(r) =>
							r.scopeKind === "genre" &&
							r.scopeRef === preset.genreId &&
							registers(r)
					)
					.map((r) => r.key),
				...own.filter(registers).map((r) => r.key)
			])
		]
		for (const key of keys) {
			const reg =
				own.find((r) => registers(r) && r.key === key) ??
				regs.find(
					(r) =>
						r.scopeKind === "genre" &&
						r.scopeRef === preset.genreId &&
						registers(r) &&
						r.key === key
				)!
			const row = own.find(
				(r) => r.key === key && holderIds.has(`reg:${r.id}`)
			)
			contexts.push({
				id: `preset:${preset.id}:${key}`,
				kind: "preset",
				presetId: preset.id,
				spec: reg.specSlug!,
				presetHolder: row ? `reg:${row.id}` : null,
				genreHolders: genreRows(preset.genreId, key),
				instanceHolder: instanceOf(reg.specSlug!)
			})
		}
	}
	const registered = new Set([
		...regs.filter(registers).map((r) => r.specSlug!),
		...raw.sessionRegistered
	])
	for (const s of [...specs].sort((a, b) => (a.slug < b.slug ? -1 : 1)))
		if (!registered.has(s.slug))
			contexts.push({
				id: `unregistered:${s.slug}`,
				kind: "unregistered",
				presetId: null,
				spec: s.slug,
				presetHolder: null,
				genreHolders: [],
				instanceHolder: instanceOf(s.slug)
			})

	const defaults: Record<string, number | null> = {}
	for (const v of new Set(steps.map((s) => s.variableId)))
		defaults[v] = packageDefaultFor(v, raw.layouts, shippedDefaultsOf(v))

	return {
		layouts: raw.layouts,
		defaults,
		steps,
		holders,
		contexts,
		presets: raw.presets.map((p) => ({
			id: p.id,
			adminOwned:
				p.seedKey == null && p.ownerPluginId == null && !p.isImmutable,
			variableLayouts: plain(p.variableLayouts)
				? (Object.fromEntries(
						Object.entries(p.variableLayouts).filter(
							([, v]) => typeof v === "string"
						)
					) as Record<string, string>)
				: {}
		})),
		locked,
		variableSlotNames: [...slotNames]
	}
}

// ── the loader and the applier (raw SQL, through `tx` only) ──────────────

/** A json/jsonb column as the driver returned it. */
const parsed = (v: unknown): unknown => {
	if (typeof v !== "string") return v
	try {
		return JSON.parse(v)
	} catch {
		return v
	}
}

async function loadRaw(tx: MigrationTx): Promise<RawRows> {
	const q = async <T extends Record<string, unknown>>(
		s: ReturnType<typeof sql>
	) => rawRows<T>(await tx.execute(s))
	const layouts = (
		await q<{
			id: number
			variable_id: string
			seed_key: string | null
			template_id: string | null
			owner_plugin_id: number | null
			withdrawn: boolean
			reference: string | null
			pub_default: boolean
		}>(sql`SELECT id, variable_id, seed_key, template_id, owner_plugin_id,
			withdrawn_at IS NOT NULL AS withdrawn, reference, pub_default
			FROM pipeline_variable_templates ORDER BY id`)
	).map((r) => ({
		id: r.id,
		variableId: r.variable_id,
		seedKey: r.seed_key,
		templateId: r.template_id,
		ownerPluginId: r.owner_plugin_id,
		withdrawn: !!r.withdrawn,
		reference: r.reference,
		pubDefault: !!r.pub_default
	}))
	const specs = (
		await q<{
			slug: string
			active_version_id: number | null
			instance_values: unknown
		}>(
			sql`SELECT slug, active_version_id, instance_values FROM pipeline_specs ORDER BY id`
		)
	).map((r) => ({
		slug: r.slug,
		activeVersionId: r.active_version_id,
		instanceValues: parsed(r.instance_values)
	}))
	const nodes = (
		await q<{
			spec_version_id: number
			node_key: string
			definition_id: string
			definition_version: number
			renders: unknown
			config: unknown
		}>(sql`SELECT n.spec_version_id, n.node_key, n.definition_id, n.definition_version, n.renders, n.config
			FROM pipeline_nodes n
			WHERE n.spec_version_id IN (SELECT active_version_id FROM pipeline_specs WHERE active_version_id IS NOT NULL)
			ORDER BY n.spec_version_id, n.position`)
	).map((r) => ({
		specVersionId: r.spec_version_id,
		nodeKey: r.node_key,
		definitionId: r.definition_id,
		definitionVersion: r.definition_version,
		renders: parsed(r.renders),
		config: parsed(r.config)
	}))
	const registry = (
		await q<{
			definition_id: string
			version: number
			slots: unknown
			policy: unknown
		}>(
			sql`SELECT definition_id, version, slots, policy FROM pipeline_definition_registry ORDER BY id`
		)
	).map((r) => ({
		definitionId: r.definition_id,
		version: r.version,
		slots: parsed(r.slots),
		policy: parsed(r.policy)
	}))
	const authorValues = (
		await q<{
			spec_version_id: number
			node_key: string
			slot: string
			path: string | null
		}>(
			sql`SELECT p.spec_version_id, v.node_key, v.slot, v.path
				FROM pipeline_presets p JOIN pipeline_preset_values v ON v.preset_id = p.id
				WHERE p.is_default = true AND v.value IS NOT NULL`
		)
	).map((r) => ({
		specVersionId: r.spec_version_id,
		nodeKey: r.node_key,
		slot: r.slot,
		path: r.path
	}))
	const registrations = (
		await q<{
			id: number
			scope_kind: string
			scope_ref: string
			preset_id: number | null
			key: string
			spec_slug: string | null
			trigger_family: string | null
			dropped: boolean
			values: unknown
			origin: string
		}>(sql`SELECT id, scope_kind, scope_ref, preset_id, key, spec_slug, trigger_family, dropped, "values", origin
			FROM registrations WHERE scope_kind IN ('genre', 'preset') ORDER BY id`)
	).map((r) => ({
		id: r.id,
		scopeKind: r.scope_kind,
		scopeRef: r.scope_ref,
		presetId: r.preset_id,
		key: r.key,
		specSlug: r.spec_slug,
		triggerFamily: r.trigger_family,
		dropped: !!r.dropped,
		values: parsed(r.values),
		origin: r.origin
	}))
	const sessionRegistered = (
		await q<{ spec_slug: string }>(
			sql`SELECT DISTINCT spec_slug FROM registrations
				WHERE scope_kind = 'session' AND spec_slug IS NOT NULL AND dropped = false`
		)
	).map((r) => r.spec_slug)
	const presets = (
		await q<{
			id: number
			genre_id: string
			seed_key: string | null
			owner_plugin_id: number | null
			is_immutable: boolean
			variable_layouts: unknown
		}>(sql`SELECT id, genre_id, seed_key, owner_plugin_id, is_immutable, variable_layouts
			FROM session_presets ORDER BY id`)
	).map((r) => ({
		id: r.id,
		genreId: r.genre_id,
		seedKey: r.seed_key,
		ownerPluginId: r.owner_plugin_id,
		isImmutable: !!r.is_immutable,
		variableLayouts: parsed(r.variable_layouts)
	}))
	return {
		layouts,
		specs,
		nodes,
		registry,
		authorValues,
		registrations,
		sessionRegistered,
		presets
	}
}

/** `values` with the given addresses removed; emptied objects dropped; null when nothing is left. */
export function withoutPicks(
	values: Values,
	picks: ReadonlyArray<{ node: string; slot: string; key: string }>
): Values | null {
	const out: Values = {}
	for (const [n, slots] of Object.entries(values))
		out[n] = plain(slots) ? { ...slots } : (slots as never)
	for (const { node, slot, key } of picks) {
		const slotValue = out[node]?.[slot]
		if (!plain(slotValue)) continue
		const next = { ...slotValue }
		delete next[key]
		if (Object.keys(next).length) out[node]![slot] = next
		else delete out[node]![slot]
		if (!Object.keys(out[node]!).length) delete out[node]
	}
	return Object.keys(out).length ? out : null
}

async function apply(
	tx: MigrationTx,
	snap: Snapshot,
	plan: Plan
): Promise<void> {
	const removals = new Map<
		string,
		Array<{ node: string; slot: string; key: string }>
	>()
	for (const a of plan.actions) {
		if (a.kind === "removePick") {
			const list =
				removals.get(a.holder) ??
				removals.set(a.holder, []).get(a.holder)!
			list.push({ node: a.node, slot: a.slot, key: a.key })
		} else if (a.kind === "setPubLayout") {
			await tx.execute(
				sql`UPDATE pipeline_variable_templates SET pub_default = true
					WHERE id = ${a.layoutId} AND variable_id = ${a.variableId}`
			)
		}
	}
	const layoutsOf = new Map<number, Record<string, string>>()
	for (const a of plan.actions)
		if (a.kind === "setPresetLayout") {
			const cur = layoutsOf.get(a.presetId) ?? {
				...(snap.presets.find((p) => p.id === a.presetId)
					?.variableLayouts ?? {})
			}
			cur[a.variableId] = a.reference
			layoutsOf.set(a.presetId, cur)
		}
	for (const [presetId, value] of layoutsOf)
		await tx.execute(
			sql`UPDATE session_presets SET variable_layouts = ${JSON.stringify(value)}::json WHERE id = ${presetId}`
		)
	for (const [holderId, picks] of removals) {
		const holder = snap.holders.find((h) => h.id === holderId)
		if (!holder?.values) continue
		const next = withoutPicks(holder.values, picks)
		const json = next ? JSON.stringify(next) : null
		if (holderId.startsWith("reg:"))
			await tx.execute(
				sql`UPDATE registrations SET "values" = ${json}::jsonb WHERE id = ${Number(holderId.slice(4))}`
			)
		else
			await tx.execute(
				sql`UPDATE pipeline_specs SET instance_values = ${json}::json WHERE slug = ${holderId.slice(5)}`
			)
	}
}

export async function run(tx: MigrationTx): Promise<void> {
	const snap = buildSnapshot(await loadRaw(tx))
	const plan = planVariableLayoutUpgrade(snap)
	for (const d of plan.dropped)
		console.warn(
			`[upgrade 0151] left ${d.variableId} as it was: ${d.reason}`
		)
	if (!plan.actions.length) return
	await apply(tx, snap, plan)
	const count = (kind: Action["kind"]) =>
		plan.actions.filter((a) => a.kind === kind).length
	console.log(
		`[upgrade 0151] ${count("setPubLayout")} pub layout(s), ${count("setPresetLayout")} preset variable layout(s), ` +
			`${count("removePick")} per-step pick(s) removed; ${plan.leftAlone.length} variable(s) left as they were`
	)
}
