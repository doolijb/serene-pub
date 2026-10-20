/**
 * 🚧 The ruleset handler's pure half (`core:task/ruleset-resolve@1`,
 * PLAN-rulesets §17, §25, §32; BACKBONE §4.3–§4.9).
 *
 * Given a ruleset, a rigour and the owners as `read.ts` gathered them, it
 * runs the **fixed phase order** — base values → piece effects (by mode
 * priority, typed bonuses stacking) → derived stats (the ruleset's scripts,
 * then each stat's Liquid expression with its seeded `roll`) → bridges
 * (additive) → render — and returns labelled blocks, outcomes, the explain
 * trace, the deltas it refused and the changes it decided. It reads no
 * database and writes nothing: `resolve.ts` does both.
 *
 * Two moments (audit C1): `runResolve` renders the blocks a model call
 * reads; `runApply` validates the model's deltas, rolls, and lets time pass.
 * The `advance` moment is `runApply` with no deltas.
 *
 * Every modify — a piece's, a script's, a bridge's — goes through one
 * `addModify` and is folded into the shown value by one `foldModifies`
 * (audit A17), so what a sheet shows is what a roll counts. A modify on a
 * value the sheet works out (a derived stat) is skipped with an explain
 * line, never silently overwritten.
 *
 * ## What the rigours do here
 *
 *  · `prose` — what things are, in words: voice, sheet and pieces with no
 *    numbers (unless a stat says `showNumbers`), riders as prose, no dice.
 *    `apply` records what the model said and computes nothing but relative
 *    arithmetic.
 *  · `mechanics` — adds phases 2–4, delta validation, checks and time.
 *  · `scripts` — `mechanics`, at index depth by default, with the ruleset's
 *    `derived`-phase scripts (QuickJS, `scripts.ts`) laid over in phase 3.
 *
 * Deterministic: owners in key order, fields in the ruleset's order, pieces
 * by name — so the same state renders the same bytes.
 */

import {
	advanceStoryTime,
	checkPiece,
	compareStoryTimes,
	i18nText,
	predicateHolds,
	rulesetSelectorFamily,
	rulesetSelectors,
	slotListItemText,
	type FiveBand,
	type MechanicDecl,
	type MechanicPredicate,
	type RenderDepth,
	type RepertoireDecl,
	type Rigour,
	type RulesetBonuses,
	type RulesetConventions,
	type SlotPiece,
	type SlotValue,
	type StoryTime
} from "@serene-pub/sdk"
import { evaluate, isRefusal } from "$lib/server/state/expressions"
import { slotKey } from "$lib/server/state/keys"
import { byString, compendiumRow, DEPTHS, minutesPer, normaliseSlotRef, parseAtTime, slotNamed } from "./common"
import { degreeOf, rollDice } from "./dice"
import { roundsSince } from "./rounds"
import type {
	EngineChange,
	EngineInput,
	EngineOutput,
	ExplainTerm,
	HeldPiece,
	HeldRepertoire,
	Outcome,
	OwnerView,
	ProposedDelta,
	RejectedDelta,
	RulesetBlock,
	RulesetBlocks
} from "./types"

// ── Small helpers ───────────────────────────────────────────────────────────

/** The estimate every block carries: four characters a token. The budget recounts with the run's tokenizer. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

const RIGOUR_RANK: Record<Rigour, number> = { prose: 0, mechanics: 1, scripts: 2 }
const atLeast = (rigour: Rigour, floor: Rigour): boolean => RIGOUR_RANK[rigour] >= RIGOUR_RANK[floor]

/** Block priorities: what a budget keeps longest. */
const PRIORITY = { voice: 100, outcomes: 90, sheet: 80, holder: 70, pieces: 60, ties: 50, gm: 45, custom: 40 } as const

const CHECK_OPS = new Set(["hit", "use", "traverse"])

/** Case-folded word tokens — what selection matches names and traits against. */
export function tokensOf(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((t) => t.length > 0)
	)
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** An I18n label as English text. */
const text = (v: Parameters<typeof i18nText>[0], fallback = ""): string => i18nText(v) ?? fallback

/** Selector words a person reads differently than the id spells them. */
const SELECTOR_WORDS: Readonly<Record<string, string>> = { mod: "modifier", dc: "DC", ac: "AC" }

/** `strength-mod` → `strength modifier`. */
const selectorWords = (segment: string): string =>
	segment
		.split("-")
		.filter(Boolean)
		.map((w) => SELECTOR_WORDS[w] ?? w)
		.join(" ")

/**
 * What a person reads for a selector in an explain line or an outcome:
 * the stat's own label, else the selector's declared `label` when the
 * ruleset gives one, else its words — `attack.melee` → _Melee attack_,
 * `strength-mod` → _Strength modifier_. Never the bare id.
 */
export function selectorLabel(input: Pick<EngineInput, "ruleset">, owner: Pick<OwnerView, "stats"> | null, selector: string): string {
	const stat = owner?.stats.find((s) => s.selector === selector)
	if (stat?.label) return stat.label
	const decl = rulesetSelectors(input.ruleset).get(selector) as { label?: Parameters<typeof i18nText>[0] } | undefined
	const declared = decl?.label !== undefined ? text(decl.label) : ""
	if (declared) return declared
	const parts = selector.split(".").filter(Boolean).map(selectorWords)
	// `attack.melee` reads _melee attack_; a lone word reads as itself.
	const words = parts.length > 1 ? [...parts.slice(1).reverse(), parts[0]!].join(" ") : (parts[0] ?? selector)
	return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Every selector a modify on a check may name to reach `selector` (audit A2):
 * itself, each dotted parent (`attack.melee` → `attack`), and the generic
 * check a check counts `within` — the SDK's `rulesetSelectorFamily`, so the
 * engine and the authoring check agree on what "covers" means.
 */
export function selectorFamily(input: Pick<EngineInput, "ruleset">, selector: string): readonly string[] {
	return rulesetSelectorFamily(input.ruleset, selector)
}

/** One block from its renders, at the depth it starts at. */
function block(depths: Partial<Record<RenderDepth, string>>, depth: RenderDepth, priority: number): RulesetBlock | undefined {
	const at = renderAt(depths, depth)
	if (!at) return undefined
	return { text: at, tokens: estimateTokens(at), priority, depth, depths }
}

/** A render at `depth`, else the next shallower one that exists. */
export function renderAt(depths: Partial<Record<RenderDepth, string>>, depth: RenderDepth): string | undefined {
	for (let i = DEPTHS.indexOf(depth); i >= 0; i--) {
		const t = depths[DEPTHS[i]!]
		if (t) return t
	}
	return undefined
}

// ── Phases 1–4: the numbers ─────────────────────────────────────────────────

/**
 * One owner partway or all the way through the phases: every selector's
 * value and the terms that made it. Opaque outside the engine — `scripts.ts`
 * reads only `values`, between phases 2 and 3.
 */
export interface Resolved {
	values: Map<string, SlotValue>
	terms: Map<string, ExplainTerm[]>
	/** Selectors whose value is derived — by a script or the stat's expression. */
	derived: Map<string, string>
	/** Passive degree adjustments per check selector. */
	adjust: Map<string, number>
	/** Every modify so far, by target — kept so a check stacks its own beside them. */
	modifies: Map<string, Modify[]>
	/** Each folded target's value and terms before any modify, so a later fold restacks from the start. */
	bases: Map<string, { value: SlotValue | undefined; terms: ExplainTerm[] }>
	/** Modifies skipped because their target is worked out, as explain sentences. */
	skipped: string[]
	riders: string[]
}

interface Modify {
	value: number
	bonusType?: string
	label: string
	origin: ExplainTerm["origin"]
}

/**
 * Typed-bonus stacking (BACKBONE §2.5), as the session's conventions say
 * (`conventions.bonuses`): untyped terms all add; under
 * `highest-per-type` (the default) only the highest bonus and the worst
 * penalty of each type count, under `sum` typed terms add too. The **edge**
 * type is never a number: one highest bonus and one lowest penalty net to
 * +1, 0 or −1 — roll twice and keep the higher, or the lower.
 */
export function stackModifies(
	mods: readonly Modify[],
	bonuses?: RulesetBonuses
): { kept: Modify[]; edge: number } {
	const out: Modify[] = []
	const typed = new Map<string, { best?: Modify; worst?: Modify }>()
	let up = false
	let down = false
	for (const m of mods) {
		if (bonuses?.edge && m.bonusType === bonuses.edge) {
			if (m.value > 0) up = true
			else if (m.value < 0) down = true
			continue
		}
		if (!m.bonusType || bonuses?.stacking === "sum") {
			out.push(m)
			continue
		}
		const slot = typed.get(m.bonusType) ?? {}
		if (m.value >= 0) {
			if (!slot.best || m.value > slot.best.value) slot.best = m
		} else if (!slot.worst || m.value < slot.worst.value) slot.worst = m
		typed.set(m.bonusType, slot)
	}
	for (const type of [...typed.keys()].sort(byString)) {
		const { best, worst } = typed.get(type)!
		if (best) out.push(best)
		if (worst) out.push(worst)
	}
	return { kept: out, edge: (up ? 1 : 0) - (down ? 1 : 0) }
}

/** The conventions this resolution plays by: the session's (settings laid over), else the ruleset's own. */
const conventionsOf = (input: EngineInput): RulesetConventions => input.conventions ?? input.ruleset.conventions

/** Does a mechanic's predicate hold, for this piece, over these values? */
export function predicateHoldsFor(
	p: MechanicPredicate | undefined,
	ctx: { values: Map<string, SlotValue>; piece?: HeldPiece }
): boolean {
	if (!p) return true
	if ("all" in p) return p.all.every((q) => predicateHoldsFor(q, ctx))
	if ("any" in p) return p.any.some((q) => predicateHoldsFor(q, ctx))
	if ("not" in p) return !predicateHoldsFor(p.not, ctx)
	if ("traits" in p) {
		const held = new Set((ctx.piece?.props.traits ?? []).map((t) => String(t).toLowerCase()))
		const has = (t: string) => held.has(t.toLowerCase())
		const { all, any, none } = p.traits
		return (!all || all.every(has)) && (!any || any.some(has)) && (!none || !none.some(has))
	}
	const value = p.path.startsWith("piece.")
		? ctx.piece?.props[p.path.slice("piece.".length)]
		: ctx.values.get(p.path)
	const scope = { ...Object.fromEntries(ctx.values), piece: ctx.piece?.props ?? {} }
	return predicateHolds(p, value, scope)
}

const pieceName = (p: HeldPiece): string => String(p.props.name ?? p.key)

/** Each held piece, with the mechanics its repertoire declares, in render order. */
function* heldMechanics(owner: OwnerView): Generator<{ rep: HeldRepertoire; piece: HeldPiece; m: MechanicDecl }> {
	for (const rep of owner.repertoires)
		for (const piece of rep.pieces) for (const m of rep.repertoire.mechanics ?? []) yield { rep, piece, m }
}

const newResolved = (): Resolved => ({
	values: new Map(),
	terms: new Map(),
	derived: new Map(),
	adjust: new Map(),
	modifies: new Map(),
	bases: new Map(),
	skipped: [],
	riders: []
})

/** The one way a modify joins an owner's resolution — a piece's, a script's or a bridge's alike. */
function addModify(r: Resolved, target: string, mod: Modify): void {
	const list = r.modifies.get(target) ?? []
	list.push(mod)
	r.modifies.set(target, list)
}

/** Is `selector` worked out on this owner — a stat's expression, or a script's value? */
const isDerived = (owner: OwnerView, r: Resolved, selector: string): boolean =>
	r.derived.has(selector) || owner.stats.some((s) => s.selector === selector && s.derive !== undefined)

/**
 * Fold every modify into the value it targets: stacked from the target's
 * value before any modify (so a second fold restacks the whole list, typed
 * bonuses judged together), each kept term on the explain trail. A modify
 * on a worked-out value is dropped with one explain sentence — the sheet
 * never shows a number its roll would not count.
 */
function foldModifies(input: EngineInput, owner: OwnerView, r: Resolved): void {
	const bonuses = conventionsOf(input).bonuses
	for (const [target, mods] of [...r.modifies].sort(([a], [b]) => byString(a, b))) {
		if (isDerived(owner, r, target)) {
			r.modifies.delete(target)
			const from = [...new Set(mods.map((m) => m.label))].join(", ")
			r.skipped.push(`${from} would change ${selectorLabel(input, owner, target)}, which is worked out from the sheet — skipped`)
			continue
		}
		if (!r.bases.has(target)) r.bases.set(target, { value: r.values.get(target), terms: r.terms.get(target) ?? [] })
		const base = r.bases.get(target)!
		const { kept } = stackModifies(mods, bonuses)
		// Only an edge on it: nothing to add, and nothing to show where nothing was.
		if (!kept.length && base.value === undefined) continue
		r.values.set(target, kept.reduce((a, k) => a + k.value, isNumber(base.value) ? base.value : 0))
		r.terms.set(target, [...base.terms, ...kept.map(({ value, label, origin }) => ({ value, label, origin }))])
	}
}

/** Phase 1 — each stat's stored value, as the base term. */
function basePhase(input: EngineInput, owner: OwnerView, r: Resolved): void {
	for (const stat of owner.stats) {
		if (stat.derive !== undefined || stat.value === undefined) continue
		r.values.set(stat.selector, stat.value)
		if (isNumber(stat.value))
			r.terms.set(stat.selector, [{ value: stat.value, label: stat.label || selectorLabel(input, owner, stat.selector), origin: { kind: "base", ref: stat.slotId } }])
	}
}

/**
 * Phase 2 — the passive piece effects, by mode priority: riders (prose, at
 * every rigour), then at `mechanics` `set`, `modify` and `adjustDegree`.
 */
function piecePhase(input: EngineInput, owner: OwnerView, r: Resolved): void {
	const passive = [...heldMechanics(owner)].filter(({ m }) => m.on === undefined)
	const holds = (piece: HeldPiece, m: MechanicDecl) => predicateHoldsFor(m.predicate, { values: r.values, piece })
	for (const { piece, m } of passive) if (m.verb === "rider" && holds(piece, m)) r.riders.push(`${pieceName(piece)}: ${m.text}`)
	if (!atLeast(input.rigour, "mechanics")) return
	for (const { piece, m } of passive)
		if (m.verb === "set" && holds(piece, m)) {
			r.values.set(m.target, m.value)
			if (isNumber(m.value)) r.terms.set(m.target, [{ value: m.value, label: pieceName(piece), origin: { kind: "piece", ref: piece.key } }])
		}
	for (const { piece, m } of passive)
		if (m.verb === "modify" && holds(piece, m))
			addModify(r, m.target, { value: m.value, bonusType: m.bonusType, label: pieceName(piece), origin: { kind: "piece", ref: piece.key } })
	foldModifies(input, owner, r)
	for (const { piece, m } of passive)
		if (m.verb === "adjustDegree" && holds(piece, m)) r.adjust.set(m.target, (r.adjust.get(m.target) ?? 0) + m.by)
}

/**
 * Phase 3 — derived, pure: the ruleset's `derived`-phase scripts first (run
 * by `scripts.ts` on phases 1–2's values), so a stat's expression may read
 * what they computed; their modifies fold with the rest. Then each derived
 * stat's expression, over the folded values.
 */
function derivedPhase(input: EngineInput, owner: OwnerView, r: Resolved, seed: string): void {
	if (!atLeast(input.rigour, "mechanics")) return
	const scripted = input.scripted?.[owner.key]
	if (scripted) {
		for (const [sel, value] of Object.entries(scripted.values).sort(([a], [b]) => byString(a, b))) {
			r.values.set(sel, value)
			r.derived.set(sel, "script")
			if (isNumber(value)) r.terms.set(sel, [{ value, label: selectorLabel(input, owner, sel), origin: { kind: "derived", ref: `script:${sel}` } }])
		}
		const selectors = rulesetSelectors(input.ruleset)
		for (const m of scripted.modifies) {
			// A script that names a selector as its label reads as that selector's words.
			const label = selectors.has(m.label) ? selectorLabel(input, owner, m.label) : m.label
			addModify(r, m.target, { value: m.value, bonusType: m.bonusType, label, origin: { kind: "derived", ref: `script:${m.seedKey}` } })
		}
		foldModifies(input, owner, r)
	}
	const bag: Record<string, SlotValue> = { ...owner.bag }
	for (const [k, v] of r.values) bag[k] = v
	for (const stat of owner.stats) {
		if (stat.derive === undefined) continue
		const result = evaluate(stat.derive, { state: {}, owner: bag, who: {} }, { seedLabel: `${seed}:ruleset:${owner.key}:${stat.selector}:derive` })
		if (isRefusal(result) || result.value === undefined || result.value === null) continue
		const value = result.value as SlotValue
		r.values.set(stat.selector, value)
		bag[stat.selector] = value
		r.derived.set(stat.selector, stat.derive)
		if (isNumber(value)) r.terms.set(stat.selector, [{ value, label: stat.derive, origin: { kind: "derived", ref: stat.slotId } }])
	}
}

/**
 * Phase 4 — bridges, additive: a field the ruleset does not own touching its
 * numbers. Its modifies fold like any other, after the derived phase, so a
 * bridge never reads back into a derived value.
 */
function bridgePhase(input: EngineInput, owner: OwnerView, r: Resolved): void {
	if (!atLeast(input.rigour, "mechanics") || !input.bridges?.length) return
	for (const bridge of input.bridges) {
		if (bridge.ruleset !== input.ruleset.id) continue
		const field = owner.custom.find((f) => f.slotId === bridge.field) ?? owner.stats.find((s) => s.slotId === bridge.field)
		if (!field) continue
		// The bridged field reads by its bare key and its id, beside the ruleset's own values.
		const scope = new Map(r.values)
		if (field.value !== undefined) {
			scope.set(slotKey(bridge.field), field.value)
			scope.set(bridge.field, field.value)
		}
		for (const e of bridge.effects) {
			if (e.on !== undefined || !predicateHoldsFor(e.predicate, { values: scope })) continue
			if (e.verb === "rider") r.riders.push(`${field.label}: ${e.text}`)
			else if (e.verb === "modify")
				addModify(r, e.target, { value: e.value, bonusType: e.bonusType, label: field.label, origin: { kind: "bridge", ref: bridge.field } })
		}
	}
	foldModifies(input, owner, r)
}

/**
 * Phases 1–2 for every owner, by key — what `scripts.ts` hands a `derived`
 * script, and where `runResolve` / `runApply` pick up, so the phases run
 * once a moment whether or not the ruleset has scripts (audit C2).
 */
export function earlyPhases(input: EngineInput): Map<string, Resolved> {
	const out = new Map<string, Resolved>()
	for (const owner of input.owners) {
		const r = newResolved()
		basePhase(input, owner, r)
		piecePhase(input, owner, r)
		out.set(owner.key, r)
	}
	return out
}

/** Phases 3–4 for every owner, on from the early phases (computed here when not handed in). */
function latePhases(input: EngineInput, seed: string, early?: Map<string, Resolved>): Map<string, Resolved> {
	const resolved = early ?? earlyPhases(input)
	for (const owner of input.owners) {
		let r = resolved.get(owner.key)
		if (!r) resolved.set(owner.key, (r = earlyPhases({ ...input, owners: [owner] }).get(owner.key)!))
		derivedPhase(input, owner, r, seed)
		bridgePhase(input, owner, r)
	}
	return resolved
}

/** `d20 12 + 3 (Strength modifier) + 2 (Proficiency) = 17`. */
export function explainText(target: string, total: number, terms: readonly ExplainTerm[]): string {
	if (!terms.length) return `${target} ${total}`
	if (terms.length === 1 && terms[0]!.origin.kind === "derived") return `${total} = ${terms[0]!.label}`
	// 🚧 As a sum is written, the total last, each number once (PLAN-dc-after-walk2
	// Q3-2, the walk's N14: "5 = 1d6 (4) 4 + Strength modifier 1"): dice whose
	// faces are shown are not counted again — "1d6 (4) + 1 (Strength modifier) = 5".
	const facesOnly = (t: ExplainTerm) => {
		if (t.origin.kind !== "roll") return false
		const m = /\(([\d, ]+)\)$/.exec(t.label)
		return !!m && m[1]!.split(",").reduce((a, f) => a + Number(f.trim() || 0), 0) === t.value
	}
	const parts = terms.map((t, i) => {
		if (t.origin.kind === "roll") return `${i === 0 ? "" : "+ "}${facesOnly(t) ? t.label : `${t.label} ${t.value}`}`
		const sign = t.value < 0 ? "− " : i === 0 ? "" : "+ "
		return `${sign}${Math.abs(t.value)} (${t.label})`
	})
	const said = parts.join(" ")
	// A lone die that says its number needs no "= total".
	return terms.length === 1 && terms[0]!.origin.kind === "roll" && !facesOnly(terms[0]!) ? said : `${said} = ${total}`
}

// ── Phase 5: render ─────────────────────────────────────────────────────────

/** The cast owners this turn names — the holders a holder-only field may be read by. */
const actingHolders = (owners: readonly OwnerView[]): OwnerView[] =>
	owners.filter((o) => o.owner.kind === "session_cast" || o.owner.kind === "player_seat")

/**
 * The shared prompt's voice — whose holder-only fields it may read inline:
 * the viewer when the viewer is one of the owners, else the one acting
 * holder. With several holders acting and no viewer, none: each holder's own
 * fields render in a block of their own (`holders`), per acting holder.
 */
function voiceOf(owners: readonly OwnerView[], viewer?: string | null): string | null {
	if (viewer && viewer !== "gm" && owners.some((o) => o.key === viewer)) return viewer
	const cast = actingHolders(owners)
	return cast.length === 1 ? cast[0]!.key : null
}

function valueText(value: SlotValue | undefined, showNumbers: boolean): string | undefined {
	if (value === undefined || value === null || value === "") return undefined
	if (typeof value === "number") return showNumbers ? String(value) : undefined
	if (Array.isArray(value)) {
		const items = value.map((i) => slotListItemText(i)).filter((t) => t && (showNumbers || !/^-?\d+(\.\d+)?$/.test(t)))
		return items.length ? items.join(", ") : undefined
	}
	if (typeof value === "object") return slotListItemText(value as never)
	return String(value)
}

/**
 * 🚧 How a piece stands, in words: its `state` (a way out's locked, closed,
 * hidden or broken — never the unremarkable `open`), the `lockDc` that state
 * is held at, and a `trap` it carries. Difficulties only where numbers show.
 * Walk 6 (2026-10-17): a door locked at DC 15 read "exits: Iron Door"
 * everywhere — the outcome, the Planner's sheet, the place's link.
 */
export function pieceStanding(props: Record<string, unknown>, numbers: boolean): string {
	const parts: string[] = []
	const state = typeof props.state === "string" ? props.state.trim() : ""
	const dc = (v: unknown) => (numbers && typeof v === "number" && Number.isFinite(v) && v > 0 ? ` (DC ${v})` : "")
	if (state && state.toLowerCase() !== "open") parts.push(`${state}${state.toLowerCase() === "locked" ? dc(props.lockDc) : ""}`)
	else if (!state && typeof props.lockDc === "number" && props.lockDc > 0) parts.push(`locked${dc(props.lockDc)}`)
	const trap = props.trap
	if (trap && typeof trap === "object" && !Array.isArray(trap)) {
		const t = trap as { name?: unknown; dc?: unknown }
		const named = typeof t.name === "string" && t.name.trim() ? ` — ${t.name.trim()}` : ""
		parts.push(`trapped${named}${dc(t.dc)}`)
	} else if (typeof trap === "string" && trap.trim()) parts.push(`trapped — ${trap.trim()}`)
	return parts.join(", ")
}

/** A piece's own fields beyond the universal four, as `key: value` words. */
function pieceFields(piece: HeldPiece, numbers: boolean): string[] {
	const skip = new Set(["name", "description", "prose", "traits", "towards", "edge", "kind", "state", "lockDc", "trap"])
	return Object.keys(piece.props)
		.filter((k) => !skip.has(k))
		.sort(byString)
		.flatMap((k) => {
			const v = piece.props[k]
			if (v === undefined || v === null || v === "") return []
			if (typeof v === "number" && !numbers) return []
			if (typeof v === "object") return []
			return [`${k}: ${String(v)}`]
		})
}

function pieceLine(piece: HeldPiece, depth: RenderDepth, numbers: boolean): string {
	const standing = pieceStanding(piece.props, numbers)
	const name = pieceName(piece) + (piece.count > 1 ? ` ×${piece.count}` : "") + (standing ? `, ${standing}` : "")
	if (depth === "index") return name
	const desc = String(piece.props.description ?? "").trim()
	if (depth === "summary") return desc ? `${name} — ${desc}` : name
	const traits = (piece.props.traits ?? []).map(String)
	const prose = String(piece.props.prose ?? "").trim()
	const fields = pieceFields(piece, numbers)
	return [
		desc ? `${name} — ${desc}` : name,
		prose,
		traits.length ? `traits: ${traits.join(", ")}` : "",
		fields.length ? fields.join("; ") : ""
	]
		.filter(Boolean)
		.join(" ")
}

const repLabel = (rep: RepertoireDecl): string => text(rep.label, rep.id).toLowerCase()

/** Who may read a repertoire's pieces in this prompt. */
function audienceAllows(rep: RepertoireDecl, owner: OwnerView, voice: string | null): boolean {
	if (rep.gmOnly) return false
	if (rep.earshot === "holder") return voice === owner.key
	return true
}

function sheetRenders(
	input: EngineInput,
	owner: OwnerView,
	r: Resolved,
	voice: string | null
): Partial<Record<RenderDepth, string>> {
	const numbers = atLeast(input.rigour, "mechanics")
	const parts: string[] = []
	for (const stat of owner.stats) {
		if (stat.holderOnly && voice !== owner.key) continue
		const v = valueText(r.values.get(stat.selector) ?? stat.value, numbers || !!stat.showNumbers)
		if (v !== undefined) parts.push(`${stat.label}: ${v}`)
	}
	// 🚧 The derived values a ruleset puts on its sheet (`onSheet`, P2-3):
	// armour class beside health — worked out, never stored, read first.
	if (numbers) parts.push(...onSheetParts(input, owner, r))
	for (const rep of owner.repertoires) {
		if (!audienceAllows(rep.repertoire, owner, voice) || !rep.pieces.length) continue
		parts.push(`${repLabel(rep.repertoire)}: ${rep.pieces.map((p) => pieceLine(p, "index", numbers)).join(", ")}`)
	}
	const index = parts.length ? `${owner.name} — ${parts.join("; ")}` : ""
	if (!index) return {}
	const notes = r.riders
	const summary = notes.length ? `${index}\n${notes.map((n) => `  · ${n}`).join("\n")}` : index
	const derived = numbers
		? [...r.derived.keys()].sort(byString).map((k) => `  · ${k} is worked out from the sheet`)
		: []
	const full = derived.length ? `${summary}\n${derived.join("\n")}` : summary
	return { index, summary, full }
}

/** 🚧 `Armour class: 16` — each `onSheet` derived selector this owner has a number for, in the ruleset's order. */
export function onSheetParts(input: Pick<EngineInput, "ruleset">, owner: Pick<OwnerView, "stats">, r: Pick<Resolved, "values">): string[] {
	const out: string[] = []
	for (const [sel, decl] of rulesetSelectors(input.ruleset)) {
		if (decl.kind !== "derived" || decl.onSheet !== true) continue
		const v = r.values.get(sel)
		if (isNumber(v)) out.push(`${text(decl.label, "") || selectorLabel(input, owner, sel)}: ${v}`)
	}
	return out
}

/** The depth a block starts at, per rigour (DoR §17.4). */
function defaultDepth(rigour: Rigour, which: "sheet" | "pieces"): RenderDepth {
	if (rigour === "scripts") return "index"
	if (rigour === "mechanics") return "summary"
	return which === "sheet" ? "index" : "summary"
}

/** Events in play this turn: named in the actions, or an op of a delta. */
function eventsInPlay(input: EngineInput, tokens: Set<string>): Set<string> {
	const events = new Set<string>()
	for (const e of ["hit", "use", "rest", "equip", "turn", "traverse"]) if (tokens.has(e)) events.add(e)
	for (const d of input.deltas) if (typeof d?.op === "string") events.add(d.op.toLowerCase())
	return events
}

/**
 * The pieces in play (BACKBONE §4.4), with no model call: a piece's name or
 * traits among the actions' words, its repertoire firing on an event in play,
 * or the piece equipped or active.
 */
export function selectPieces(input: EngineInput, owner: OwnerView): { rep: HeldRepertoire; pieces: HeldPiece[] }[] {
	const own = input.actions[owner.key] ?? ""
	const all = input.actions["*"] ?? ""
	const fromDeltas = input.deltas
		.map((d) => (typeof d?.piece === "string" ? d.piece : (d?.piece as { name?: string } | undefined)?.name ?? ""))
		.join(" ")
	const tokens = tokensOf(`${own} ${all} ${fromDeltas}`)
	const events = eventsInPlay(input, tokens)
	const out: { rep: HeldRepertoire; pieces: HeldPiece[] }[] = []
	for (const rep of owner.repertoires) {
		const firesNow = (rep.repertoire.mechanics ?? []).some((m) => m.on !== undefined && events.has(m.on))
		const picked = rep.pieces.filter((p) => {
			if (firesNow) return true
			if (p.props.equipped === true || p.props.active === true) return true
			const nameTokens = [...tokensOf(pieceName(p))]
			if (nameTokens.length && nameTokens.every((t) => tokens.has(t))) return true
			return (p.props.traits ?? []).some((t) => tokens.has(String(t).toLowerCase()))
		})
		if (picked.length) out.push({ rep, pieces: picked })
	}
	return out
}

function piecesRenders(
	input: EngineInput,
	voice: string | null,
	resolved: Map<string, Resolved>
): { depths: Partial<Record<RenderDepth, string>>; pin?: RenderDepth } {
	const numbers = atLeast(input.rigour, "mechanics")
	const lines: Record<RenderDepth, string[]> = { index: [], summary: [], full: [] }
	let pin: RenderDepth | undefined
	const prosed = new Set<string>()
	for (const owner of input.owners) {
		if (!resolved.has(owner.key)) continue
		for (const { rep, pieces } of selectPieces(input, owner)) {
			if (!audienceAllows(rep.repertoire, owner, voice)) continue
			if (rep.repertoire.renderDepth) pin = rep.repertoire.renderDepth
			const head = `${owner.name}'s ${repLabel(rep.repertoire)}`
			lines.index.push(`${head}: ${pieces.map((p) => pieceLine(p, "index", numbers)).join(", ")}`)
			for (const depth of ["summary", "full"] as const) {
				if (!prosed.has(`${depth}:${rep.repertoire.id}`)) {
					prosed.add(`${depth}:${rep.repertoire.id}`)
					lines[depth].push(`${text(rep.repertoire.label, rep.repertoire.id)}: ${rep.repertoire.prose}`)
				}
				lines[depth].push(`${head}:`, ...pieces.map((p) => `  · ${pieceLine(p, depth, numbers)}`))
			}
		}
	}
	const depths: Partial<Record<RenderDepth, string>> = {}
	for (const d of DEPTHS) if (lines[d].length) depths[d] = lines[d].join("\n")
	return { depths, pin }
}

function tiesRenders(input: EngineInput, voice: string | null): Partial<Record<RenderDepth, string>> {
	const byKey = new Map(input.owners.map((o) => [o.key, o]))
	const index: string[] = []
	const summary: string[] = []
	for (const tie of [...input.ties].sort((a, b) => a.id - b.id)) {
		const from = byKey.get(tie.from)
		const to = byKey.get(tie.to)
		if (!from || !to) continue
		const head = `${from.name} → ${to.name}: ${tie.type}${tie.title ? ` (${tie.title})` : ""}`
		index.push(head)
		summary.push(tie.description?.trim() ? `${head} — ${tie.description.trim()}` : head)
	}
	// Relational pieces pointing at someone present: the ruleset's decoration on the tie.
	const numbers = atLeast(input.rigour, "mechanics")
	for (const owner of input.owners)
		for (const rep of owner.repertoires) {
			if (!rep.repertoire.relational || !audienceAllows(rep.repertoire, owner, voice)) continue
			for (const p of rep.pieces) {
				const towards = byKey.get(String(p.props.towards ?? ""))
				const edge = input.ties.find((t) => String(t.id) === String(p.props.edge ?? ""))
				if (!towards && !edge) continue
				const other = towards?.name ?? (edge ? byKey.get(edge.to === owner.key ? edge.from : edge.to)?.name : undefined) ?? ""
				index.push(`${owner.name} → ${other}: ${pieceLine(p, "index", numbers)}`)
				summary.push(`${owner.name} → ${other}: ${pieceLine(p, "full", numbers)}`)
			}
		}
	return index.length ? { index: index.join("\n"), summary: summary.join("\n") } : {}
}

function customRenders(input: EngineInput, voice: string | null): Partial<Record<RenderDepth, string>> {
	const lines: string[] = []
	for (const owner of input.owners) {
		const parts = owner.custom
			.filter((f) => !f.holderOnly || voice === owner.key)
			.flatMap((f) => {
				// Fields outside the ruleset render at prose whatever the rigour.
				const v = valueText(f.value, false)
				return v === undefined ? [] : [`${f.label}: ${v}`]
			})
		if (parts.length) lines.push(`${owner.name} — ${parts.join("; ")}`)
	}
	return lines.length ? { index: lines.join("\n") } : {}
}

/**
 * One acting holder's own: their holder-only stats and fields and their
 * holder-audience pieces — what only their voice may read.
 */
function holderRenders(
	input: EngineInput,
	owner: OwnerView,
	r: Resolved
): Partial<Record<RenderDepth, string>> {
	const numbers = atLeast(input.rigour, "mechanics")
	const parts: string[] = []
	for (const stat of owner.stats) {
		if (!stat.holderOnly) continue
		const v = valueText(r.values.get(stat.selector) ?? stat.value, numbers || !!stat.showNumbers)
		if (v !== undefined) parts.push(`${stat.label}: ${v}`)
	}
	for (const f of owner.custom) {
		if (!f.holderOnly) continue
		const v = valueText(f.value, false)
		if (v !== undefined) parts.push(`${f.label}: ${v}`)
	}
	const summary = [...parts]
	for (const rep of owner.repertoires) {
		if (rep.repertoire.earshot !== "holder" || rep.repertoire.gmOnly || !rep.pieces.length) continue
		parts.push(`${repLabel(rep.repertoire)}: ${rep.pieces.map((p) => pieceLine(p, "index", numbers)).join(", ")}`)
		summary.push(`${repLabel(rep.repertoire)}: ${rep.pieces.map((p) => pieceLine(p, "summary", numbers)).join("; ")}`)
	}
	if (!parts.length) return {}
	const head = `${owner.name}, known only to ${owner.name}`
	return { index: `${head} — ${parts.join("; ")}`, summary: `${head} — ${summary.join("; ")}` }
}

/** Every held piece of a game-master repertoire — read only in the owner's or game master's view. */
function gmRenders(input: EngineInput): Partial<Record<RenderDepth, string>> {
	const numbers = atLeast(input.rigour, "mechanics")
	const index: string[] = []
	const full: string[] = []
	for (const owner of input.owners)
		for (const rep of owner.repertoires) {
			if (!rep.repertoire.gmOnly || !rep.pieces.length) continue
			const head = `${owner.name}'s ${repLabel(rep.repertoire)}`
			index.push(`${head}: ${rep.pieces.map((p) => pieceLine(p, "index", numbers)).join(", ")}`)
			full.push(`${head}:`, ...rep.pieces.map((p) => `  · ${pieceLine(p, "full", numbers)}`))
		}
	if (!index.length) return {}
	const note = "For the game master only — never say these to the players."
	return { index: `${note}\n${index.join("\n")}`, full: `${note}\n${full.join("\n")}` }
}


// ── Apply: deltas, checks, time ─────────────────────────────────────────────

/** An owner a delta names: its key, a `{ kind, id }`, or its name. */
function ownerOf(input: EngineInput, ref: unknown): OwnerView | undefined {
	if (typeof ref === "string") {
		const s = ref.trim()
		return (
			input.owners.find((o) => o.key === s) ??
			input.owners.find((o) => o.name.toLowerCase() === s.toLowerCase())
		)
	}
	if (ref && typeof ref === "object") {
		const { kind, id } = ref as { kind?: unknown; id?: unknown }
		return input.owners.find((o) => o.owner.kind === kind && o.owner.id === id)
	}
	return undefined
}

function heldPieceNamed(rep: HeldRepertoire | undefined, ref: unknown): HeldPiece | undefined {
	if (!rep) return undefined
	const name =
		typeof ref === "string" ? ref : ref && typeof ref === "object" ? String((ref as { name?: unknown }).name ?? "") : ""
	const want = name.trim().toLowerCase()
	if (!want) return undefined
	return rep.pieces.find(
		(p) =>
			p.key === want ||
			(p.item.kind === "compendium" && p.item.pieceId === want) ||
			(p.item.kind === "lore" && String(p.item.entryId) === want)
	)
}

/**
 * A piece in one line, as an outcome says it: a library row by its row's
 * name (`Potion of Healing`, never `potion-of-healing`), an override first,
 * ×N when more than one is held — the server's mirror of core-catalog's
 * `pieceText`. Anything else as `slotListItemText` reads it.
 */
export function pieceDisplayText(input: Pick<EngineInput, "ruleset">, piece: SlotPiece, repertoireId?: string): string {
	if ((piece as { kind?: unknown }).kind !== "compendium") return slotListItemText(piece)
	const ref = piece as Extract<SlotPiece, { kind: "compendium" }>
	const override = (ref.overrides as { name?: unknown } | undefined)?.name
	let name = typeof override === "string" && override.trim() ? override.trim() : ""
	if (!name) {
		// 🚧 In the repertoire the piece is held in first (P2-5): row ids are unique there only.
		const rowName = (
			(repertoireId !== undefined ? compendiumRow(input.ruleset, ref.pieceId, repertoireId) : undefined) ?? compendiumRow(input.ruleset, ref.pieceId)
		)?.props.name
		if (typeof rowName === "string" && rowName) name = rowName
	}
	if (!name) {
		const words = ref.pieceId.replace(/[-_]+/g, " ").trim()
		name = words.charAt(0).toUpperCase() + words.slice(1)
	}
	const count = typeof ref.count === "number" ? ref.count : 1
	return count > 1 ? `${name} ×${count}` : name
}

/** A piece the model named, as the item a list holds: a row of the repertoire's library when one answers to it. */
function pieceFrom(input: EngineInput, rep: RepertoireDecl, ref: unknown, reason?: string): SlotPiece | null {
	if (typeof ref === "string" && ref.trim()) {
		const found = compendiumRow(input.ruleset, ref, rep.id)
		if (found) return { kind: "compendium", compendiumId: input.ruleset.id, pieceId: found.row.id, version: found.row.version }
		return { kind: "inline", name: ref.trim(), description: reason?.trim() || ref.trim() }
	}
	if (ref && typeof ref === "object" && !Array.isArray(ref)) {
		const o = ref as Record<string, unknown>
		if (o.kind === "inline" || o.kind === "lore" || o.kind === "compendium") return o as unknown as SlotPiece
		const name = typeof o.name === "string" ? o.name : ""
		if (!name) return null
		return { ...o, kind: "inline", name, description: typeof o.description === "string" ? o.description : reason?.trim() || name }
	}
	return null
}

/**
 * `minutes` after `from`, through the calendar — real month lengths and leap
 * days; a free-form book (`calendar` null) by the smallest-part rule. Whole
 * minutes (a fraction rounds down); null when the result does not land.
 */
export function addStoryMinutes(
	from: StoryTime,
	minutes: number,
	calendar: Parameters<typeof advanceStoryTime>[3]
): StoryTime | null {
	const whole = Math.floor(minutes)
	const start: StoryTime = { year: from.year }
	if (from.month != null) start.month = from.month
	if (from.month != null && from.day != null) start.day = from.day
	if (from.hour != null) {
		start.hour = from.hour
		start.minute = from.minute ?? 0
	}
	if (!(whole > 0)) return start
	const moved = advanceStoryTime(start, whole, "minutes", calendar)
	return moved.problem !== undefined ? null : moved.time
}

interface ApplyState {
	out: EngineOutput
	resolved: Map<string, Resolved>
	/**
	 * 🚧 What this moment's changes already moved, by `<owner>|<selector>`
	 * (2026-10-18): two blows, two drinks or two spells in one change set
	 * each read the value the one before left, never the value the moment
	 * began on (the walk's #39 family).
	 */
	pending: Map<string, number>
	/** 🚧 The traits a `cure` ended this moment, by owner key: none of them lands again in it. */
	cured: Map<string, Set<string>>
	/** 🚧 How many rolled effects have an explain line, for unique keys. */
	rolls: number
	/** 🚧 The pieces this moment spent, as it left them (`spendPiece`); null once gone. */
	pieces: Map<string, PieceNow | null>
}

/** A stat's value as this moment has left it: as resolved, plus what its changes moved. */
function statNow(st: ApplyState, owner: OwnerView, stat: OwnerView["stats"][number]): number {
	const resolved = st.resolved.get(owner.key)?.values.get(stat.selector) ?? stat.value
	return (isNumber(resolved) ? resolved : 0) + (st.pending.get(`${owner.key}|${stat.selector}`) ?? 0)
}

/** A stat changed by an amount: the change written, and counted for whatever reads it next this moment. */
function addToStat(st: ApplyState, owner: OwnerView, stat: OwnerView["stats"][number], value: number, note?: string): void {
	st.out.changes.push({ owner: owner.owner, slotId: stat.slotId, op: "add", value, ...(note ? { note } : {}) })
	const key = `${owner.key}|${stat.selector}`
	st.pending.set(key, (st.pending.get(key) ?? 0) + value)
}

function reject(st: ApplyState, delta: ProposedDelta, reason: string, why: string, change?: EngineChange): void {
	const rejected: RejectedDelta = { delta, reason, why }
	st.out.rejected.push(rejected)
	if (change) st.out.reviewable.push({ change, rejected })
}

/** The integer stat a mechanic's target names on this owner, for a write. */
const ownIntegerStat = (owner: OwnerView, selector: string) =>
	owner.stats.find((s) => s.selector === selector && s.type === "integer" && s.derive === undefined)

/**
 * Fire one effect mechanic for a holder (an event's or a time trigger's) —
 * a change, or prose on the outcome. `times` repeats it (`every` passed twice).
 */
function fireEffect(
	st: ApplyState,
	input: EngineInput,
	owner: OwnerView,
	piece: HeldPiece,
	m: MechanicDecl,
	times: number,
	kind: Outcome["kind"]
): void {
	const name = pieceName(piece)
	if (m.verb === "modify") {
		const stat = ownIntegerStat(owner, m.target)
		if (!stat) return
		const value = m.value * times
		const base = statNow(st, owner, stat)
		addToStat(st, owner, stat, value, name)
		const terms: ExplainTerm[] = [
			{ value: base, label: stat.label || selectorLabel(input, owner, stat.selector), origin: { kind: "base", ref: stat.slotId } },
			{ value, label: name, origin: { kind: "piece", ref: piece.key } }
		]
		st.out.explain.push({ target: `${owner.key}.${stat.selector}`, total: base + value, terms, text: explainText(selectorLabel(input, owner, stat.selector), base + value, terms) })
		st.out.outcomes.push({ owner: owner.key, kind, text: `${owner.name}: ${stat.label} ${value < 0 ? "−" : "+"}${Math.abs(value)} (${name})` })
	} else if (m.verb === "set") {
		const stat = owner.stats.find((s) => s.selector === m.target && s.derive === undefined)
		if (!stat) return
		st.out.changes.push({ owner: owner.owner, slotId: stat.slotId, op: "set", value: m.value, note: name })
		st.out.outcomes.push({ owner: owner.key, kind, text: `${owner.name}: ${stat.label} is now ${String(m.value)} (${name})` })
	} else if (m.verb === "rider") st.out.outcomes.push({ owner: owner.key, kind, text: `${name}: ${m.text}` })
}

/** The degrees an event's effects land on: a partial success or better. */
const LANDS: readonly FiveBand[] = ["partial", "success", "crit"]

function resolveCheck(st: ApplyState, input: EngineInput, owner: OwnerView, delta: ProposedDelta, op: string): void {
	const dice = conventionsOf(input).dice
	const piece = delta.piece !== undefined && delta.piece !== null && delta.piece !== ""
		? (() => {
				for (const rep of owner.repertoires) {
					const p = heldPieceNamed(rep, delta.piece)
					if (p) return { rep, piece: p }
				}
				return null
			})()
		: undefined
	if (piece === null)
		return reject(st, delta, "unknown-piece", `${owner.name} holds nothing called ${JSON.stringify(delta.piece)} to ${op}.`)
	// The last of it already used up this moment: nothing left to use.
	if (piece && !pieceNow(st, owner, piece.rep, piece.piece))
		return reject(st, delta, "unknown-piece", `${owner.name} has no ${pieceName(piece.piece)} left to ${op}.`)
	// Prose rigour, or a ruleset with no dice: told in the story, nothing
	// rolled — but a piece used is still used (its `cure`, its `consume`).
	if (!atLeast(input.rigour, "mechanics") || !dice) {
		const told = (st.out.facts.unrolled as string[] | undefined) ?? []
		told.push(`${owner.key}:${op}${piece ? `:${pieceName(piece.piece)}` : ""}`)
		st.out.facts.unrolled = told
		if (piece) pieceUsed(st, input, owner, piece, delta, op, { lands: true, counted: false })
		return
	}
	// 🚧 Who rolls (Q2-1, ★6): a traverse's actor — the way is the place's,
	// the hands are theirs — else the delta's owner.
	const actor = op === "traverse" && delta.actor != null && delta.actor !== "" ? ownerOf(input, delta.actor) : undefined
	const roller = actor && actor.key !== owner.key && st.resolved.has(actor.key) ? actor : owner
	const r = st.resolved.get(roller.key)!
	// 🚧 An unchecked use (P1-1, owner ruling ★4): a `use` that names no
	// check — a potion drunk, a spell that rolls nothing — lands as a check
	// against nothing does, with no die thrown.
	if (op === "use" && (delta.check === undefined || delta.check === null || delta.check === "")) {
		if (piece) {
			// No check counted any of its modifies: each is an effect.
			eventEffects(st, input, owner, piece, op, r, () => false)
			pieceUsed(st, input, owner, piece, delta, op, { lands: true, counted: true })
		}
		return
	}
	const selectors = rulesetSelectors(input.ruleset)
	const selector = delta.check ?? dice.modifierOf
	if (!selector || !selectors.has(selector))
		return reject(st, delta, "unknown-selector", `${String(selector ?? "(no check named)")} is not a check or stat ${text(input.ruleset.name)} knows.`)
	if (!input.random) throw new Error("a check needs the run's randomness, and this resolution was handed none")
	const decl = selectors.get(selector)!
	// A tally adds up modifies and nothing rolls: never a check.
	if (decl.kind === "tally")
		return reject(st, delta, "unknown-selector", `${selectorLabel(input, roller, selector)} is a total, not a check — nothing rolls for it.`)
	const family = selectorFamily(input, selector)
	const reaches = (target: string) => family.includes(target)
	let baseSel = decl.kind === "check" ? decl.base ?? dice.modifierOf : decl.kind === "stat" ? selector : dice.modifierOf
	// 🚧 `rollWith` (P2-2): a check made with this piece rolls with the
	// highest of the mechanic's selectors — a finesse blade with Strength or
	// Dexterity, whichever is better.
	if (piece)
		for (const m of piece.rep.repertoire.mechanics ?? []) {
			if (m.verb !== "rollWith" || m.on !== op || !reaches(m.target)) continue
			if (!predicateHoldsFor(m.predicate, { values: r.values, piece: piece.piece })) continue
			const best = highestOf(r, m.from)
			if (best) baseSel = best.selector
		}
	const terms: ExplainTerm[] = []
	const baseValue = baseSel ? r.values.get(baseSel) : undefined
	if (baseSel && isNumber(baseValue)) {
		// The stat as it resolved: its base term and the passive modifies
		// already folded into it, each kept as its own term.
		const folded = r.terms.get(baseSel)
		if (folded?.length && folded.reduce((a, t) => a + t.value, 0) === baseValue) terms.push(...folded)
		else terms.push({ value: baseValue, label: selectorLabel(input, roller, baseSel), origin: { kind: "base", ref: baseSel } })
	}
	// Modifies on the check's whole family — itself (unless it is the stat
	// already counted), its dotted parents and the generic `check` — and the
	// used piece's own, stacked together.
	const mods = family.filter((s) => !(s === selector && baseSel === selector)).flatMap((s) => r.modifies.get(s) ?? [])
	let adjust = family.reduce((a, s) => a + (r.adjust.get(s) ?? 0), 0)
	if (piece)
		for (const m of piece.rep.repertoire.mechanics ?? []) {
			if (m.on !== op || !predicateHoldsFor(m.predicate, { values: r.values, piece: piece.piece })) continue
			if (m.verb === "modify" && reaches(m.target))
				mods.push({ value: m.value, bonusType: m.bonusType, label: pieceName(piece.piece), origin: { kind: "piece", ref: piece.piece.key } })
			else if (m.verb === "adjustDegree" && reaches(m.target)) adjust += m.by
		}
	const conv = conventionsOf(input)
	const stacked = stackModifies(mods, conv.bonuses)
	// Edge from passive modifies the base stat already folded counts too.
	const edge = Math.sign(
		stacked.edge + (baseSel === selector ? stackModifies(r.modifies.get(selector) ?? [], conv.bonuses).edge : 0)
	)
	const first = rollDice(`d${dice.sides}`, input.random).total
	const second = edge !== 0 ? rollDice(`d${dice.sides}`, input.random).total : undefined
	const natural = second === undefined ? first : edge > 0 ? Math.max(first, second) : Math.min(first, second)
	terms.unshift({
		value: natural,
		label: second === undefined ? `d${dice.sides}` : `d${dice.sides} (${first}, ${second}, ${edge > 0 ? "edge" : "against the edge"})`,
		origin: { kind: "roll", ref: `d${dice.sides}` }
	})
	for (const k of stacked.kept) terms.push({ value: k.value, label: k.label, origin: k.origin })
	const total = terms.reduce((a, t) => a + t.value, 0)
	const against = isNumber(delta.against) ? delta.against : undefined
	const degree = degreeOf(conv.degrees, { total, natural, against, adjust })
	st.out.explain.push({
		target: `${roller.key}.${selector}`,
		total,
		terms,
		text: explainText(selectorLabel(input, roller, selector), total, terms) + (against !== undefined ? ` vs ${against}` : "")
	})
	const label = degree ? text(degree.band.label, degree.band.id) : undefined
	const what = piece ? `${op} ${pieceName(piece.piece)}` : op
	st.out.outcomes.push({
		// The way's place keeps the outcome (what a genre's books match it by);
		// the words name whoever made the check.
		owner: owner.key,
		kind: "check",
		text: `${roller.name} — ${what} (${selectorLabel(input, roller, selector)}): ${label ?? "rolled, against nothing"}`,
		check: { selector, natural, total, against, band: degree?.band.id, five: degree?.five, label, ...(roller !== owner ? { actor: roller.key } : {}) }
	})
	// The event's effects: on a success or better, or always when the check
	// was against nothing (a potion drunk).
	const lands = !degree || LANDS.includes(degree.five)
	// 🚧 A failed crossing of a trapped way springs the trap on whoever tried
	// (Q2-1; Vis Itineris's rider: "A trap springs unless noticed or disarmed").
	if (op === "traverse" && piece && !lands) springTrap(st, input, roller, piece.piece)
	if (piece) {
		if (lands) eventEffects(st, input, owner, piece, op, r, reaches)
		pieceUsed(st, input, owner, piece, delta, op, {
			lands,
			counted: true,
			...(degree ? { five: degree.five } : {}),
			...(baseSel && isNumber(baseValue) ? { base: { value: baseValue, label: selectorLabel(input, roller, baseSel) } } : {})
		})
	}
}

/**
 * 🚧 A way's trap, sprung on `on` (Q2-1): its damage rolled — the dice in its
 * `damage` words, `1d4 poison` — and taken off their health; 🚧 and the
 * condition it leaves (`condition`, PLAN-dc-after-walk3 R2-1, owner ruling
 * ★2: a trap carries its own effect, rolled and laid by the table — the walk's
 * needle "sprang" and cost nothing). One outcome says all it did, which the
 * Narrator is told: "Poison needle springs on Rook: Health −3, Poisoned". A
 * trap that names neither is told, its harm left to the story.
 */
function springTrap(st: ApplyState, input: EngineInput, on: OwnerView, way: HeldPiece): void {
	const trap = way.props.trap
	if (!trap || typeof trap !== "object" || Array.isArray(trap)) return
	const t = trap as { name?: unknown; damage?: unknown; condition?: unknown }
	const name = typeof t.name === "string" && t.name.trim() ? t.name.trim() : "A trap"
	const did: string[] = []
	let explainKey: string | undefined
	const expr = typeof t.damage === "string" ? /\d+d\d+(?:\s*[+-]\s*\d+)?/.exec(t.damage)?.[0]?.replace(/\s+/g, "") : undefined
	const stat = on.stats.find((x) => x.selector === "hp" && x.derive === undefined)
	let roll: ReturnType<typeof rollDice> | undefined
	if (expr && input.random && stat)
		try {
			roll = rollDice(expr, input.random)
		} catch {
			roll = undefined
		}
	if (roll && stat) {
		const total = Math.max(0, roll.total)
		const now = statNow(st, on, stat)
		const dealt = Math.min(total, Math.max(0, now))
		if (dealt > 0) addToStat(st, on, stat, -dealt, name)
		explainKey = `${on.key}.trap.${++st.rolls}`
		const terms: ExplainTerm[] = [{ value: total, label: `${expr} (${roll.faces.join(", ")})`, origin: { kind: "roll", ref: expr! } }]
		st.out.explain.push({ target: explainKey, total, terms, text: explainText("damage", total, terms) })
		did.push(`${stat.label} −${dealt}`)
	}
	const left = trapCondition(st, input, on, t.condition, name)
	if (left) did.push(left)
	st.out.outcomes.push({
		owner: on.key,
		kind: "effect",
		text: did.length ? `${name} springs on ${on.name}: ${did.join(", ")}` : `${name} springs on ${on.name}`,
		...(explainKey ? { explainKey } : {})
	})
}

/**
 * 🚧 The condition a sprung trap leaves on `on` (R2-1): the piece of that
 * name from the repertoire of `on`'s that keeps it — the ruleset's library
 * answering to the name, else an inline piece on a `conditions` list — added
 * as any gained piece is. Its words, or null when there is none to leave, no
 * list that keeps it, or a cure this moment keeps it off.
 */
function trapCondition(st: ApplyState, input: EngineInput, on: OwnerView, raw: unknown, trapName: string): string | null {
	const wanted = typeof raw === "string" ? raw.trim() : ""
	if (!wanted) return null
	const rep =
		on.repertoires.find((r) => !!compendiumRow(input.ruleset, wanted, r.repertoire.id)) ??
		on.repertoires.find((r) => r.repertoire.id === "conditions")
	if (!rep) return null
	const piece = pieceFrom(input, rep.repertoire, wanted, trapName)
	if (!piece || checkPiece(rep.repertoire, piece)) return null
	const cured = st.cured.get(on.key)
	if (cured && traitsOf(propsOfItem(input, piece, rep.repertoire.id)).some((x) => cured.has(x))) return null
	st.out.changes.push({ owner: on.owner, slotId: rep.slotId, op: "add", items: [stamped(piece, input, rep.repertoire.id)], note: trapName })
	return pieceDisplayText(input, piece, rep.repertoire.id)
}

/** The highest number among `selectors` on this owner, and which it was (the first of a tie). */
function highestOf(r: Resolved, selectors: readonly string[]): { selector: string; value: number } | undefined {
	let best: { selector: string; value: number } | undefined
	for (const sel of selectors) {
		const v = r.values.get(sel)
		if (isNumber(v) && (!best || v > best.value)) best = { selector: sel, value: v }
	}
	return best
}

/** An event's effect mechanics that change a stat or tell prose (`modify`, `set`, `rider`), as they always fired. */
function eventEffects(
	st: ApplyState,
	input: EngineInput,
	owner: OwnerView,
	used: { rep: HeldRepertoire; piece: HeldPiece },
	op: string,
	r: Resolved,
	reaches: (target: string) => boolean
): void {
	for (const m of used.rep.repertoire.mechanics ?? []) {
		if (m.on !== op || !predicateHoldsFor(m.predicate, { values: r.values, piece: used.piece })) continue
		if (m.verb === "modify" && reaches(m.target)) continue
		if (m.verb !== "modify" && m.verb !== "set" && m.verb !== "rider") continue
		// 🚧 A way's rider is how crossing it works, not what happened
		// (Q2-1: a picked lock printed "Crossing a locked way takes a check…").
		if (op === "traverse" && m.verb === "rider") continue
		fireEffect(st, input, owner, used.piece, m, 1, "effect")
	}
}

// ── A piece used: its effects executed (owner ruling ★4, P2-1) ───────────────

/** How a piece's use went, for the effects that read it. */
interface UseContext {
	/** The check landed (a partial success or better), or none was rolled. */
	lands: boolean
	/** Dice count at this table: `harm` and `heal` roll. */
	counted: boolean
	five?: FiveBand
	/** The modifier the check rolled with — what `harm`'s `plus: 'check'` adds. */
	base?: { value: number; label: string }
}

/**
 * The dice a piece field holds, as an expression: `{ dice, die }` (a
 * weapon's `1` × `d8` → `1d8`), `{ formula }`, or the formula itself
 * (`2d4+2`). Null when the field holds none.
 */
export function diceOfPiece(props: Readonly<Record<string, unknown>>, field: string): string | null {
	const v = props[field.replace(/^piece\./, "")]
	if (typeof v === "string" && v.trim()) return v.trim()
	if (!v || typeof v !== "object" || Array.isArray(v)) return null
	const o = v as { dice?: unknown; die?: unknown; formula?: unknown }
	if (typeof o.formula === "string" && o.formula.trim()) return o.formula.trim()
	if (isNumber(o.dice) && typeof o.die === "string" && /^d\d+$/.test(o.die)) return `${o.dice}${o.die}`
	return null
}

/** Who a piece is used on: an owner this moment resolves, else a name told only. */
function aimedAtOf(input: EngineInput, raw: unknown): { owner?: OwnerView; name?: string } {
	if (raw === undefined || raw === null || raw === "") return {}
	const found = ownerOf(input, raw)
	if (found) return { owner: found }
	return typeof raw === "string" && raw.trim() ? { name: raw.trim() } : {}
}

/**
 * Roll an effect's dice — a critical doubles them (the reference rules'
 * critical hit) — with what `plus` adds and, for harm, the ruleset's
 * `damage` tally. The total and its terms, or null when the piece holds no
 * dice or the expression does not read.
 */
function rollEffect(
	st: ApplyState,
	input: EngineInput,
	r: Resolved,
	owner: OwnerView,
	used: HeldPiece,
	m: Extract<MechanicDecl, { verb: "harm" | "heal" }>,
	ctx: UseContext
): { total: number; terms: ExplainTerm[]; key: string } | null {
	const expr = diceOfPiece(used.props, m.dice)
	if (!expr || !input.random) return null
	const crit = m.verb === "harm" && ctx.five === "crit"
	let roll
	try {
		roll = rollDice(expr, input.random)
	} catch {
		st.out.explain.push({ target: `${owner.key}.${m.verb}`, total: 0, terms: [], text: `${pieceName(used)}: '${expr}' is not dice the table can roll — skipped` })
		return null
	}
	const extra = crit ? rollDice(`${roll.faces.length}d${/d(\d+)/.exec(expr)?.[1] ?? 6}`, input.random) : null
	const faces = [...roll.faces, ...(extra?.faces ?? [])]
	// 🚧 The dice alone when the expression's own number is its own term
	// (Q3-2, N14: "2d4+2 (3, 2) + 2 (Potion of healing)" counted the 2 twice
	// to the eye): "2d4 (3, 2) + 2 (Potion of healing) = 7".
	const dice = roll.modifier ? expr.replace(/\s*[+-]\s*\d+\s*$/, "") : expr
	const terms: ExplainTerm[] = [
		{ value: faces.reduce((a, b) => a + b, 0), label: `${crit ? `${dice} doubled for a critical` : dice} (${faces.join(", ")})`, origin: { kind: "roll", ref: expr } }
	]
	if (roll.modifier) terms.push({ value: roll.modifier, label: pieceName(used), origin: { kind: "piece", ref: used.key } })
	if (m.plus === "check") {
		if (ctx.base && ctx.base.value !== 0) terms.push({ value: ctx.base.value, label: ctx.base.label, origin: { kind: "derived", ref: "check" } })
	} else if (m.plus) {
		const best = highestOf(r, m.plus)
		if (best && best.value !== 0) terms.push({ value: best.value, label: selectorLabel(input, owner, best.selector), origin: { kind: "derived", ref: best.selector } })
	}
	if (m.verb === "harm")
		for (const k of stackModifies(selectorFamily(input, "damage").flatMap((s) => r.modifies.get(s) ?? []), conventionsOf(input).bonuses).kept)
			terms.push({ value: k.value, label: k.label, origin: k.origin })
	const total = Math.max(0, terms.reduce((a, t) => a + t.value, 0))
	const key = `${owner.key}.${m.verb}.${++st.rolls}`
	st.out.explain.push({ target: key, total, terms, text: explainText(m.verb === "harm" ? "damage" : "healing", total, terms) })
	return { total, terms, key }
}

/** A piece's damage type, as words — `piercing ` — or nothing. */
const damageWords = (props: Readonly<Record<string, unknown>>): string =>
	typeof props.damageType === "string" && props.damageType ? `${props.damageType} ` : ""

/**
 * A piece used: its `harm` and `heal` (where dice count and the use
 * landed), its `cure` (where it landed), then its `consume` — one use spent
 * whatever the roll. Each says what it did on the outcomes, in words a table
 * line shows; nothing a model must sum.
 */
function pieceUsed(
	st: ApplyState,
	input: EngineInput,
	holder: OwnerView,
	used: { rep: HeldRepertoire; piece: HeldPiece },
	delta: ProposedDelta,
	op: string,
	ctx: UseContext
): void {
	const r = st.resolved.get(holder.key)!
	const name = pieceName(used.piece)
	const target = aimedAtOf(input, delta.aimedAt)
	let consumes = false
	for (const m of used.rep.repertoire.mechanics ?? []) {
		if (m.on !== op || !predicateHoldsFor(m.predicate, { values: r.values, piece: used.piece })) continue
		if (m.verb === "consume") consumes = true
		else if (m.verb === "harm" && ctx.counted && ctx.lands) {
			const rolled = rollEffect(st, input, r, holder, used.piece, m, ctx)
			if (!rolled) continue
			const what = `${holder.name}'s ${name} deals ${rolled.total} ${damageWords(used.piece.props)}damage`
			const stat = target.owner ? target.owner.stats.find((x) => x.selector === m.stat && x.derive === undefined) : undefined
			if (target.owner && stat) {
				const now = statNow(st, target.owner, stat)
				const dealt = Math.min(rolled.total, Math.max(0, now))
				if (dealt > 0) addToStat(st, target.owner, stat, -dealt, name)
				st.out.outcomes.push({
					owner: target.owner.key,
					kind: "effect",
					text:
						dealt > 0
							? `${what} to ${target.owner.name}: ${stat.label} −${dealt}${dealt < rolled.total ? " (all left to lose)" : ""}`
							: `${what} to ${target.owner.name}, who has no ${stat.label.toLowerCase()} left to lose`,
					explainKey: rolled.key
				})
			} else
				st.out.outcomes.push({
					owner: holder.key,
					kind: "effect",
					text: `${what}${target.owner ? ` to ${target.owner.name}` : target.name ? ` to ${target.name}` : ""}`,
					explainKey: rolled.key
				})
		} else if (m.verb === "heal" && ctx.counted && ctx.lands) {
			const rolled = rollEffect(st, input, r, holder, used.piece, m, ctx)
			if (!rolled) continue
			const on = target.owner ?? holder
			const stat = on.stats.find((x) => x.selector === m.stat && x.derive === undefined)
			const what = `${holder.name}'s ${name} heals ${on === holder ? "" : `${on.name} `}${rolled.total}`
			if (!stat) {
				st.out.outcomes.push({ owner: on.key, kind: "effect", text: what, explainKey: rolled.key })
				continue
			}
			const now = statNow(st, on, stat)
			const room = isNumber(stat.max) ? Math.max(0, stat.max - now) : rolled.total
			const healed = Math.min(rolled.total, room)
			if (healed > 0) addToStat(st, on, stat, healed, name)
			st.out.outcomes.push({
				owner: on.key,
				kind: "effect",
				text: healed > 0 ? `${what}: ${stat.label} +${healed}${healed < rolled.total ? " (back to full)" : ""}` : `${what}: already at full ${stat.label.toLowerCase()}`,
				explainKey: rolled.key
			})
		} else if (m.verb === "cure" && ctx.lands) cure(st, input, holder, target.owner ?? holder, name, m.traits)
	}
	if (consumes) spendPiece(st, holder, used.rep, used.piece, delta.reason?.trim() || name)
}

/** A piece's traits, lower-cased. */
const traitsOf = (props: Readonly<Record<string, unknown>>): string[] =>
	Array.isArray(props.traits) ? props.traits.map((t) => String(t).toLowerCase()) : []

/**
 * `cure`: every piece `on` holds carrying one of `traits` leaves, and an
 * add this moment already queued for `on` that carries one is dropped; the
 * traits stay ended for the rest of the moment (`ApplyState.cured`) — an
 * antitoxin taken before or after the needle, in one turn, keeps the poison off.
 */
function cure(st: ApplyState, input: EngineInput, holder: OwnerView, on: OwnerView, by: string, traits: readonly string[]): void {
	const want = new Set(traits.map((t) => t.toLowerCase()))
	const cured = st.cured.get(on.key) ?? new Set<string>()
	for (const t of want) cured.add(t)
	st.cured.set(on.key, cured)
	const ended: string[] = []
	for (const rep of on.repertoires)
		for (const piece of rep.pieces) {
			if (!traitsOf(piece.props).some((t) => want.has(t))) continue
			st.out.changes.push({ owner: on.owner, slotId: rep.slotId, op: "remove", items: [piece.item], note: by })
			ended.push(pieceName(piece))
		}
	// What this moment was about to put on them, kept off.
	const kept: string[] = []
	st.out.changes = st.out.changes.filter((c) => {
		if (c.op !== "add" || !c.items?.length || c.owner.kind !== on.owner.kind || c.owner.id !== on.owner.id) return true
		const repId = on.repertoires.find((r) => r.slotId === c.slotId)?.repertoire.id
		const blocked = c.items.filter((item) => traitsOf(propsOfItem(input, item, repId)).some((t) => want.has(t)))
		if (!blocked.length) return true
		kept.push(...blocked.map((item) => pieceDisplayText(input, item, repId)))
		return false
	})
	const who = on === holder ? holder.name : on.name
	if (ended.length) st.out.outcomes.push({ owner: on.key, kind: "effect", text: `${by} ends ${ended.join(", ")} on ${who}` })
	if (kept.length) st.out.outcomes.push({ owner: on.key, kind: "effect", text: `${kept.join(", ")} does not take hold on ${who} (${by})` })
	if (!ended.length && !kept.length) st.out.outcomes.push({ owner: on.key, kind: "effect", text: `${who} takes ${by}; nothing it ends was on them` })
}

/**
 * Spend one of a held piece (audit A16): a piece with uses to spare loses
 * one; else a stack (`count`) loses one piece; only the last of the last
 * leaves. A stack of three single-use potions is three drinks, not one.
 */
function spendPiece(st: ApplyState, owner: OwnerView, rep: HeldRepertoire, held: HeldPiece, note?: string): void {
	const name = pieceName(held)
	// 🚧 The piece as this moment's earlier spends left it (2026-10-18): two
	// drinks from one stack in a turn are two, never the same one twice.
	const key = pieceKey(owner, rep, held)
	const now = pieceNow(st, owner, rep, held)
	if (!now) return
	const next: PieceNow | null =
		now.uses !== null && now.uses > 1
			? { item: patchPiece(now.item, { uses: now.uses - 1 }), uses: now.uses - 1, count: now.count }
			: now.count > 1
				? { item: { ...now.item, count: now.count - 1 } as SlotPiece, uses: now.uses, count: now.count - 1 }
				: null
	st.pieces.set(key, next)
	st.out.changes.push({ owner: owner.owner, slotId: rep.slotId, op: "remove", items: [now.item], note })
	if (!next) {
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} no longer has ${name}` })
		return
	}
	st.out.changes.push({ owner: owner.owner, slotId: rep.slotId, op: "add", items: [next.item], note })
	const left = now.uses !== null && now.uses > 1 ? `${next.uses} ${next.uses === 1 ? "use" : "uses"} left` : `${next.count} left`
	st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} uses ${name}; ${left}` })
}

/** A held piece as a moment's spends have left it: the stored item, its uses, its count. */
interface PieceNow {
	item: SlotPiece
	uses: number | null
	count: number
}

const pieceKey = (owner: OwnerView, rep: HeldRepertoire, held: HeldPiece): string => `${owner.key}|${rep.slotId}|${held.key}`

/** The piece as this moment has left it — as held, until a spend changes it; null once the last is gone. */
function pieceNow(st: ApplyState, owner: OwnerView, rep: HeldRepertoire, held: HeldPiece): PieceNow | null {
	const key = pieceKey(owner, rep, held)
	if (st.pieces.has(key)) return st.pieces.get(key)!
	return { item: held.item, uses: isNumber(held.props.uses) ? held.props.uses : null, count: held.count }
}

// ── Spell points (Vis Itineris `casting: points`, PLAN-sheet §8) ─────────────

/** The pool a caster spends under `casting: points` (core-catalog `visItinerisSpellPointsSlot`). */
export const SPELL_POINTS_SLOT = "core:slot/itineris-spell-points@1"

/** Story minutes a long rest takes: an advance of at least this long refills the pool. */
export const LONG_REST_MINUTES = 8 * 60

/** Whether the table plays spell points: the ruleset's `casting` setting, read by id. */
const playsSpellPoints = (input: EngineInput): boolean => input.settings?.casting === "points"

/** A spend on a spells repertoire, at a table playing spell points. */
const castsByPoints = (input: EngineInput, rep: HeldRepertoire): boolean =>
	playsSpellPoints(input) && rep.repertoire.id === "spells"

/** An owner's spell-point stat, when they carry one. */
const spellPointsOf = (owner: OwnerView): OwnerView["stats"][number] | undefined =>
	owner.stats.find((s) => s.slotId === SPELL_POINTS_SLOT)

/**
 * Cast a spell under `casting: points`: the spell stays known, and the pool
 * loses the spell's level (a cantrip, level 0, costs nothing). Refused, in
 * words, when the pool holds too few — or when the caster has no pool.
 */
function spendSpellPoints(st: ApplyState, input: EngineInput, owner: OwnerView, held: HeldPiece, delta: ProposedDelta): void {
	const name = pieceName(held)
	const level = isNumber(held.props.level) ? Math.max(0, Math.floor(held.props.level)) : 0
	if (level === 0) {
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} casts ${name}` })
		return
	}
	const stat = spellPointsOf(owner)
	if (!stat) return reject(st, delta, "not-enough", `${owner.name} has no spell points to cast ${name} with.`)
	// What this moment's earlier casts left (P2-4): a second spell reads the pool the first left.
	const base = statNow(st, owner, stat)
	if (base < level)
		return reject(st, delta, "not-enough", `${owner.name} has ${base} ${stat.label}, not the ${level} ${name} costs.`)
	addToStat(st, owner, stat, -level, delta.reason ?? name)
	const terms: ExplainTerm[] = [
		{ value: base, label: stat.label, origin: { kind: "base", ref: stat.slotId } },
		{ value: -level, label: name, origin: { kind: "piece", ref: held.key } }
	]
	st.out.explain.push({ target: `${owner.key}.${stat.selector}`, total: base - level, terms, text: explainText(stat.label, base - level, terms) })
	st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} casts ${name}: ${stat.label} −${level} (${base - level} left)` })
}

/**
 * A long rest under `casting: points` (an advance of at least
 * {@link LONG_REST_MINUTES}): every caster's pool back to its maximum — 🚧
 * the derive script's `spell-points-max` (by class and level, P2-4), else a
 * script's `spellPoints`, else the pool's configured `max` (set per
 * character by `set-stat-config`).
 */
function refillSpellPoints(st: ApplyState, input: EngineInput): void {
	if (!playsSpellPoints(input) || input.deltas.length) return
	const minutes = elapsedMinutesOf(input)
	if (minutes === null || minutes < LONG_REST_MINUTES) return
	for (const owner of input.owners) {
		const stat = spellPointsOf(owner)
		if (!stat) continue
		const scripted = input.scripted?.[owner.key]?.values
		const fromScript = scripted?.["spell-points-max"] ?? scripted?.spellPoints ?? scripted?.["spell-points"]
		const max = isNumber(fromScript) ? fromScript : stat.max
		if (!isNumber(max)) continue
		const current = st.resolved.get(owner.key)?.values.get(stat.selector) ?? stat.value
		if (isNumber(current) && current >= max) continue
		st.out.changes.push({ owner: owner.owner, slotId: stat.slotId, op: "set", value: max, note: "A long rest" })
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name}: ${stat.label} back to ${max} (a long rest)` })
	}
}

function applyDelta(st: ApplyState, input: EngineInput, delta: ProposedDelta): void {
	if (!delta || typeof delta !== "object") return
	const op = typeof delta.op === "string" ? delta.op.trim().toLowerCase() : ""
	const owner = ownerOf(input, delta.owner)
	if (!owner)
		return reject(st, delta, "unknown-owner", `${JSON.stringify(delta.owner)} is not one of the owners this turn resolves.`)
	if (CHECK_OPS.has(op)) return resolveCheck(st, input, owner, delta, op)
	const prose = input.rigour === "prose"
	if (delta.repertoire !== undefined) {
		const rep = owner.repertoires.find((r) => r.repertoire.id === delta.repertoire)
		if (!rep) {
			// 🚧 A field that holds this repertoire under a ruleset the session
			// does not play keeps the change in words (P2-6, owner ruling ★10).
			const parked = owner.custom.find((f) => f.parked?.repertoire === delta.repertoire)
			if (parked) return applyInWords(st, input, owner, parked, delta, op)
			return reject(st, delta, "unknown-repertoire", `${owner.name} holds no '${String(delta.repertoire)}' under ${text(input.ruleset.name)}.`)
		}
		if (op === "add") {
			const piece = pieceFrom(input, rep.repertoire, delta.piece, delta.reason)
			if (!piece) return reject(st, delta, "unknown-piece", `the delta names no piece to add to ${owner.name}'s ${repLabel(rep.repertoire)}.`)
			const why = checkPiece(rep.repertoire, piece)
			if (why) return reject(st, delta, "bad-piece", why)
			// 🚧 Kept off by a cure this moment (an antitoxin, P2-1): told, never written.
			const cured = st.cured.get(owner.key)
			if (cured && traitsOf(propsOfItem(input, piece, rep.repertoire.id)).some((t) => cured.has(t))) {
				st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${pieceDisplayText(input, piece, rep.repertoire.id)} does not take hold on ${owner.name}` })
				return
			}
			st.out.changes.push({ owner: owner.owner, slotId: rep.slotId, op: "add", items: [stamped(piece, input, rep.repertoire.id)], note: delta.reason })
			const standing = pieceStanding(piece as unknown as Record<string, unknown>, atLeast(input.rigour, "mechanics"))
			st.out.outcomes.push({
				owner: owner.key,
				kind: "effect",
				text: standing
					? `${owner.name}: ${pieceDisplayText(input, piece, rep.repertoire.id)}, ${standing}`
					: `${owner.name} gains ${pieceDisplayText(input, piece, rep.repertoire.id)}`
			})
			return
		}
		if (op === "remove" || op === "spend") {
			const held = heldPieceNamed(rep, delta.piece)
			if (!held)
				return reject(st, delta, "unknown-piece", `${owner.name}'s ${repLabel(rep.repertoire)} hold nothing called ${JSON.stringify(delta.piece)}.`)
			if (op === "spend") {
				if (castsByPoints(input, rep)) return spendSpellPoints(st, input, owner, held, delta)
				if (!pieceNow(st, owner, rep, held))
					return reject(st, delta, "unknown-piece", `${owner.name} has no ${pieceName(held)} left to spend.`)
				return spendPiece(st, owner, rep, held, delta.reason)
			}
			st.out.changes.push({ owner: owner.owner, slotId: rep.slotId, op: "remove", items: [held.item], note: delta.reason })
			st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} no longer has ${pieceName(held)}` })
			return
		}
		return reject(st, delta, "unknown-op", `'${op}' is not something a repertoire takes; say add, spend or remove.`)
	}
	// A stat, a field, or a repertoire's own slot — named by id, bare key or
	// label (`core:slot/hp@1`, `hp`, `Health`), one normaliser for all three.
	const stat = slotNamed(owner.stats, delta.slot)
	const field = stat ? undefined : slotNamed(owner.custom, delta.slot)
	const slot = String(delta.slot ?? "").trim()
	const repSlot = !stat && !field ? owner.repertoires.find((r) => normaliseSlotRef(r.slotId) === normaliseSlotRef(slot)) : undefined
	if (repSlot) return applyDelta(st, input, { ...delta, slot: undefined, repertoire: repSlot.repertoire.id })
	if (!stat && !field)
		return reject(st, delta, "unknown-slot", `${owner.name} has no '${slot || "(unnamed)"}' to change.`)
	const slotId = (stat?.slotId ?? field?.slotId)!
	if (stat?.derive !== undefined)
		return reject(st, delta, "derived-value", `${stat.label} is worked out from the sheet; change what it is worked out from.`)
	if (op === "set") {
		const change: EngineChange = { owner: owner.owner, slotId, op: "set", value: delta.value as SlotValue, note: delta.reason }
		if (stat && !prose)
			return reject(
				st,
				delta,
				"set-on-ruleset-value",
				`${stat.label} is ${text(input.ruleset.name)}'s to compute; the model may change it by an amount, not set it.`,
				change
			)
		st.out.changes.push(change)
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name}: ${stat?.label ?? field!.label} is now ${valueText(delta.value as SlotValue, !prose) ?? "changed"}` })
		return
	}
	// Relative arithmetic applies at every rigour (walk 6, 2026-10-17): at
	// `prose` nothing is rolled, but a change by an amount still counts —
	// only the telling stays in words. `gain` and `modify` are `add`'s.
	if (op === "add" || op === "spend" || op === "gain" || op === "modify") {
		const amount = Number(delta.value)
		if (!Number.isFinite(amount)) return reject(st, delta, "bad-value", `'${String(delta.value)}' is not an amount.`)
		const by = op === "spend" ? -Math.abs(amount) : op === "gain" ? Math.abs(amount) : amount
		const change: EngineChange = { owner: owner.owner, slotId, op: "add", value: by, note: delta.reason }
		const fieldNow = field ? field.value : undefined
		const base = stat ? statNow(st, owner, stat) : isNumber(fieldNow) ? fieldNow : 0
		if (op === "spend" && base < Math.abs(amount))
			return reject(st, delta, "not-enough", `${owner.name} has ${base} ${stat?.label ?? field!.label}, not ${Math.abs(amount)} to spend.`)
		if (stat) addToStat(st, owner, stat, by, delta.reason)
		else st.out.changes.push(change)
		const label = stat?.label ?? field!.label
		if (prose && !stat?.showNumbers) {
			// Told in words: the table keeps the number, the story never names it.
			st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name}: ${label} ${by < 0 ? "falls" : by > 0 ? "rises" : "holds"}` })
			return
		}
		const selector = stat?.selector ?? slotKey(slotId)
		const terms: ExplainTerm[] = [
			{ value: base, label: stat?.label || selectorLabel(input, owner, selector), origin: { kind: "base", ref: slotId } },
			{ value: by, label: delta.reason?.trim() || "proposed", origin: { kind: "piece", ref: "delta" } }
		]
		st.out.explain.push({ target: `${owner.key}.${selector}`, total: base + by, terms, text: explainText(selectorLabel(input, owner, selector), base + by, terms) })
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name}: ${label} ${by < 0 ? "−" : "+"}${Math.abs(by)}` })
		return
	}
	return reject(st, delta, "unknown-op", `'${op}' is not a change; say set, add, gain, spend, modify, remove, hit, use or traverse.`)
}

/** A thing kept in words, by its name: a word item's text before its description, a piece's name. */
function wordsItemName(input: EngineInput, item: unknown, parked: NonNullable<OwnerView["custom"][number]["parked"]>): string {
	if (!item || typeof item !== "object") return typeof item === "string" ? item.split(" — ")[0]!.trim() : ""
	const o = item as Record<string, unknown>
	if (typeof o.name === "string" && o.name.trim()) return o.name.trim()
	if (o.kind === "compendium" && typeof o.pieceId === "string") {
		const row = compendiumRow(String(o.compendiumId ?? parked.ruleset), o.pieceId, parked.repertoire)?.props.name
		return typeof row === "string" && row ? row : o.pieceId.replace(/[-_]+/g, " ")
	}
	return ""
}

/**
 * 🚧 A change to a repertoire the session's ruleset does not hold, landed on
 * the field that keeps it in words (P2-6, owner ruling ★10): an `add` writes
 * the piece as its **name and description** only — `Mace — A heavy flanged
 * club.`, a library row of the field's own ruleset by its words, never its
 * numbers — as a word item (a list that lost its repertoire holds words and
 * lore references, never a piece: the SDK's list law); `remove` / `spend`
 * take it away by name. Told in words, never a number. A word held is held
 * once: a second of the same thing adds nothing (no count is kept in words).
 */
function applyInWords(
	st: ApplyState,
	input: EngineInput,
	owner: OwnerView,
	field: OwnerView["custom"][number],
	delta: ProposedDelta,
	op: string
): void {
	const parked = field.parked!
	const held = Array.isArray(field.value) ? (field.value as unknown[]) : []
	if (op === "add") {
		const raw = delta.piece
		let name = ""
		let description = ""
		if (typeof raw === "string" && raw.trim()) {
			const row = compendiumRow(parked.ruleset, raw, parked.repertoire)
			name = (typeof row?.props.name === "string" && row.props.name) || raw.trim()
			description = (typeof row?.props.description === "string" && row.props.description) || delta.reason?.trim() || name
		} else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			const o = raw as Record<string, unknown>
			const row = o.kind === "compendium" && typeof o.pieceId === "string" ? compendiumRow(parked.ruleset, o.pieceId, parked.repertoire) : undefined
			name = (typeof o.name === "string" && o.name.trim()) || (typeof row?.props.name === "string" ? row.props.name : "")
			description = (typeof o.description === "string" && o.description.trim()) || (typeof row?.props.description === "string" ? row.props.description : "") || name
		}
		if (!name) return reject(st, delta, "unknown-piece", `the delta names no piece to add to ${owner.name}'s ${field.label.toLowerCase()}.`)
		const words = description && description.trim() !== name ? `${name} — ${description.trim()}` : name
		st.out.changes.push({ owner: owner.owner, slotId: field.slotId, op: "add", items: [words as unknown as SlotPiece], note: delta.reason })
		st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} gains ${name}` })
		return
	}
	if (op === "remove" || op === "spend") {
		const want = (typeof delta.piece === "string" ? delta.piece : String((delta.piece as { name?: unknown } | undefined)?.name ?? "")).trim().toLowerCase()
		const item = held.find((i) => {
			const n = wordsItemName(input, i, parked).toLowerCase()
			const id = i && typeof i === "object" ? String((i as { pieceId?: unknown }).pieceId ?? "").toLowerCase() : ""
			return !!want && (n === want || id === want || n === want.replace(/[-_]+/g, " "))
		})
		if (!item)
			return reject(st, delta, "unknown-piece", `${owner.name}'s ${field.label.toLowerCase()} hold nothing called ${JSON.stringify(delta.piece)}.`)
		const name = wordsItemName(input, item, parked)
		const count = item && typeof item === "object" && isNumber((item as { count?: unknown }).count) ? ((item as { count: number }).count) : 1
		st.out.changes.push({ owner: owner.owner, slotId: field.slotId, op: "remove", items: [item as SlotPiece], note: delta.reason })
		if (op === "spend" && count > 1) {
			st.out.changes.push({ owner: owner.owner, slotId: field.slotId, op: "add", items: [{ ...(item as object), count: count - 1 } as SlotPiece], note: delta.reason })
			st.out.outcomes.push({ owner: owner.key, kind: "effect", text: `${owner.name} uses one of their ${name}` })
		} else st.out.outcomes.push({ owner: owner.key, kind: "effect", text: op === "spend" ? `${owner.name} uses up ${name}` : `${owner.name} no longer has ${name}` })
		return
	}
	return reject(st, delta, "unknown-op", `'${op}' is not something a list of things takes; say add, spend or remove.`)
}

/** Story minutes passed this moment, or null for a unit no clock counts (`scene`). */
function elapsedMinutesOf(input: EngineInput): number | null {
	const t = conventionsOf(input).time
	const perUnit = minutesPer(t.unit, t.roundSeconds)
	return perUnit === null ? null : input.elapsed * perUnit
}

/**
 * Time passing: every `on: elapsed` mechanic (`every` units passed) and
 * every `on: at` one whose story date falls in the window `(now, now +
 * elapsed]` on the session's calendar. With no clock nothing dated fires,
 * and the explain trail says so once.
 */
function fireTime(st: ApplyState, input: EngineInput): void {
	if (!(input.elapsed > 0) || !atLeast(input.rigour, "mechanics")) return
	const minutes = elapsedMinutesOf(input)
	const cal = input.clock ?? null
	const to = cal && minutes !== null ? addStoryMinutes(cal.now, minutes, cal.calendar) : null
	let clockNoted = false
	for (const owner of input.owners) {
		const r = st.resolved.get(owner.key)!
		for (const { piece, m } of heldMechanics(owner)) {
			if (!predicateHoldsFor(m.predicate, { values: r.values, piece })) continue
			if (m.on === "elapsed" && isNumber(m.every) && m.every > 0) {
				const times = Math.floor(input.elapsed / m.every)
				if (times > 0) fireEffect(st, input, owner, piece, m, times, "trigger")
			} else if (m.on === "at" && typeof m.at === "string") {
				if (!cal || !to) {
					if (!clockNoted)
						st.out.explain.push({
							target: "clock",
							total: 0,
							terms: [],
							text: `needs a clock: something fires at a story date, and this session ${
								!cal ? "keeps no clock" : minutes === null ? `counts time in ${conventionsOf(input).time.unit}s` : "cannot place the time passed on its calendar"
							} — skipped`
						})
					clockNoted = true
					continue
				}
				const at = parseAtTime(m.at)
				if (at && compareStoryTimes(at, cal.now) > 0 && compareStoryTimes(at, to) <= 0) fireEffect(st, input, owner, piece, m, 1, "trigger")
			}
		}
	}
}

// ── Timed pieces ────────────────────────────────────────────────────────────

/** When a timed piece started: the round, the message, the story clock. */
export interface TimedStart {
	turn?: number
	messageId?: number
	clock?: StoryTime
}

/**
 * 🚧 A piece that lasts a while: `{ units, value, expiry, startedAt, spent }`,
 * on its `duration` object (Vis Itineris's conditions and spells) or on the piece
 * itself. `spent` is the countdown kept where no clock measures it.
 */
export interface TimedPiece {
	units: string
	value: number
	expiry?: string
	startedAt?: TimedStart
	spent?: number
	/** Where the timing lives on the piece. */
	at: "duration" | "piece"
}

/** Endings no amount of time brings (a rest, the scene's end, never). */
const UNTIMED_EXPIRY = new Set(["never", "rest", "scene-end"])
/** Units no clock counts. */
const UNTIMED_UNITS = new Set(["until-removed", "until-dispelled", "scene", "instant"])

export function timedOf(props: Readonly<Record<string, unknown>>): TimedPiece | null {
	const d = props.duration
	const nested = d && typeof d === "object" && !Array.isArray(d) && typeof (d as { units?: unknown }).units === "string"
	const src = (nested ? d : typeof props.units === "string" ? props : null) as Record<string, unknown> | null
	if (!src || !isNumber(src.value) || (src.value as number) <= 0) return null
	const startedAt = src.startedAt && typeof src.startedAt === "object" ? (src.startedAt as TimedStart) : undefined
	return {
		units: src.units as string,
		value: src.value as number,
		...(typeof src.expiry === "string" ? { expiry: src.expiry } : {}),
		...(startedAt ? { startedAt } : {}),
		...(isNumber(src.spent) ? { spent: src.spent as number } : {}),
		at: nested ? "duration" : "piece"
	}
}

/**
 * A stored piece with `patch` laid on its own props: an inline piece's
 * fields, a reference's `overrides` (audit A5) — so a library row or a lore
 * entry counts down and spends exactly as a written-out piece does, and the
 * row or entry itself is never touched.
 */
function patchPiece(item: SlotPiece, patch: Record<string, unknown>): SlotPiece {
	if (item.kind === "inline") return { ...item, ...patch } as SlotPiece
	return { ...item, overrides: { ...(item.overrides ?? {}), ...patch } } as SlotPiece
}

/** A piece's timing rewritten, where its props (`props`, overrides laid over) keep it. */
function withTiming(item: SlotPiece, props: Readonly<Record<string, unknown>>, patch: Partial<Pick<TimedPiece, "startedAt" | "spent">>): SlotPiece {
	const t = timedOf(props)
	if (!t) return item
	return patchPiece(item, t.at === "duration" ? { duration: { ...(props.duration as object), ...patch } } : patch)
}

/**
 * A stored piece's props as far as the engine can read them without a
 * database: an inline piece's own, a library row's with its overrides laid
 * over, a lore piece's overrides (its entry carries no timing).
 */
function propsOfItem(input: EngineInput, item: SlotPiece, repertoireId?: string): Record<string, unknown> {
	if (item.kind === "inline") return item as unknown as Record<string, unknown>
	const decl = item.kind === "compendium" ? (item.compendiumId === input.ruleset.id ? input.ruleset : item.compendiumId) : undefined
	// 🚧 In the repertoire the piece is held in first (P2-5), then anywhere in its ruleset.
	const row =
		item.kind === "compendium"
			? ((repertoireId !== undefined ? compendiumRow(decl, item.pieceId, repertoireId) : undefined) ?? compendiumRow(decl, item.pieceId))?.props
			: undefined
	return { ...(row ?? {}), ...(item.overrides ?? {}) }
}

/** A timed piece gaining its start as it is added: the round, and the clock when the session keeps one. */
function stamped(item: SlotPiece, input: EngineInput, repertoireId?: string): SlotPiece {
	const props = propsOfItem(input, item, repertoireId)
	const t = timedOf(props)
	if (!t || t.startedAt) return item
	const clock = input.clock?.now ? addStoryMinutes(input.clock.now, 0, input.clock.calendar) : null
	return withTiming(item, props, { startedAt: { turn: input.turn, ...(clock ? { clock } : {}) } })
}

/**
 * Timed pieces whose time has run out leave (`remove`, an outcome says so);
 * one still running where no clock measures it is marked with what it has
 * spent — on the piece, or on a reference's overrides. Rounds count down —
 * combat rounds are not story minutes (§9 A); minutes, hours and days fall
 * on the calendar from the piece's start when the session keeps a clock,
 * else count down too; turns are the session's rounds since it began
 * (`rounds.ts`). Runs before the deltas, on what was held.
 */
function expireTimed(st: ApplyState, input: EngineInput): void {
	if (!atLeast(input.rigour, "mechanics")) return
	// 🚧 The session's tasks (lane 2): *End what runs out* Off stops the
	// countdown and the ending alike; *Track conditions* Off leaves the
	// conditions repertoire alone. Absent: both run.
	if (input.expiry?.pieces === false) return
	const conv = conventionsOf(input)
	const roundSeconds = conv.time.roundSeconds ?? 6
	const minutes = elapsedMinutesOf(input)
	const rounds = conv.time.unit === "round" ? input.elapsed : minutes !== null ? (minutes * 60) / roundSeconds : 0
	const cal = input.clock ?? null
	const to = cal ? addStoryMinutes(cal.now, minutes ?? 0, cal.calendar) : null
	for (const owner of input.owners)
		for (const rep of owner.repertoires) {
			if (input.expiry?.conditions === false && rep.repertoire.id === "conditions") continue
			// One `set` of the whole list per repertoire, never a remove+add
			// pair for a piece that merely counts down: two ops on one slot in
			// one batch read the same base, and the add was lost (walk
			// 2026-10-18: Poisoned vanished on the turn it landed).
			const next: SlotPiece[] = []
			const notes: string[] = []
			let touched = false
			for (const piece of rep.pieces) {
				const t = timedOf(piece.props)
				if (!t || UNTIMED_EXPIRY.has(t.expiry ?? "elapsed") || UNTIMED_UNITS.has(t.units)) {
					next.push(piece.item)
					continue
				}
				let expired = false
				let spent: number | null = null
				if (t.units === "turn") {
					const run = roundsSince(t.startedAt?.turn, input.turn)
					if (run !== null) expired = run >= t.value
				} else if (t.units === "round") {
					if (rounds > 0) {
						const now = (t.spent ?? 0) + rounds
						if (now >= t.value) expired = true
						else spent = now
					}
				} else {
					const per = minutesPer(t.units, roundSeconds)
					if (per === null) continue
					const start = t.startedAt?.clock
					if (cal && start && to) {
						const end = addStoryMinutes(start, t.value * per, cal.calendar)
						expired = !!end && compareStoryTimes(to, end) >= 0
					} else if (minutes) {
						const now = (t.spent ?? 0) + minutes / per
						if (now >= t.value) expired = true
						else spent = now
					}
				}
				const name = pieceName(piece)
				if (expired) {
					touched = true
					notes.push(`${name} ran its course`)
					st.out.outcomes.push({ owner: owner.key, kind: "trigger", text: `${owner.name}: ${name} ends` })
				} else if (spent !== null) {
					touched = true
					notes.push(`${name}: time passes`)
					next.push(withTiming(piece.item, piece.props, { spent: Math.round(spent * 1e6) / 1e6 }))
				} else next.push(piece.item)
			}
			if (touched)
				st.out.changes.push({
					owner: owner.owner,
					slotId: rep.slotId,
					op: "set",
					value: next as unknown as SlotValue,
					note: notes.join("; "),
					// *End what runs out* on Review: the ending is a proposal.
					...(input.expiry?.review === true ? { held: true } : {})
				})
		}
}

// ── The two moments ─────────────────────────────────────────────────────────

/** The owners in key order and every one resolved through phases 1–4. */
function resolveAll(input: EngineInput, seed: string, early?: Map<string, Resolved>): { ordered: EngineInput; resolved: Map<string, Resolved> } {
	const ordered: EngineInput = { ...input, owners: [...input.owners].sort((a, b) => byString(a.key, b.key)) }
	return { ordered, resolved: latePhases(ordered, seed, early) }
}

/** The facts and explain trail both moments return: values, equipped pieces, every number a modify or derivation touched. */
function common(input: EngineInput, resolved: Map<string, Resolved>): EngineOutput {
	const out: EngineOutput = { blocks: {}, facts: {}, outcomes: [], explain: [], rejected: [], changes: [], reviewable: [] }
	const owners = input.owners
	const computes = atLeast(input.rigour, "mechanics")
	out.facts = {
		ruleset: input.ruleset.id,
		rigour: input.rigour,
		equipped: Object.fromEntries(
			owners.map((o) => [
				o.key,
				o.repertoires.flatMap((r) => r.pieces.filter((p) => p.props.equipped === true || p.props.active === true).map(pieceName))
			])
		),
		...(computes
			? {
					values: Object.fromEntries(
						owners.map((o) => [o.key, Object.fromEntries([...resolved.get(o.key)!.values].sort(([a], [b]) => byString(a, b)))])
					)
				}
			: {})
	}
	if (!computes) return out
	for (const owner of owners) {
		const r = resolved.get(owner.key)!
		for (const [sel, terms] of [...r.terms].sort(([a], [b]) => byString(a, b))) {
			if (terms.length < 2 && terms[0]?.origin.kind !== "derived") continue
			// A script's values are explained once, in its own words, below.
			if (terms.length === 1 && terms[0]!.origin.ref.startsWith("script:")) continue
			const total = r.values.get(sel)
			if (!isNumber(total)) continue
			out.explain.push({ target: `${owner.key}.${sel}`, total, terms, text: explainText(selectorLabel(input, owner, sel), total, terms) })
		}
		for (const why of r.skipped) out.explain.push({ target: `${owner.key}.skipped`, total: 0, terms: [], text: why })
		const scripted = input.scripted?.[owner.key]
		for (const e of scripted?.explain ?? []) out.explain.push({ target: `${owner.key}.script`, total: 0, terms: [], text: `${e.seedKey}: ${e.text}` })
		if (scripted?.failed.length) {
			const failed = (out.facts.scriptsFailed as unknown[] | undefined) ?? []
			failed.push(...scripted.failed.map((f) => ({ owner: owner.key, ...f })))
			out.facts.scriptsFailed = failed
		}
	}
	return out
}

/**
 * Render the blocks a model call reads: no dice, no changes. `seed` labels
 * the derive pass's `roll` (the run's seed in a run), so a replay derives
 * the same numbers; `early` is phases 1–2 when `scripts.ts` already ran them.
 */
export function runResolve(input: EngineInput, seed = "ruleset", early?: Map<string, Resolved>): EngineOutput {
	const { ordered, resolved } = resolveAll(input, seed, early)
	const out = common(ordered, resolved)
	const owners = ordered.owners
	const voice = voiceOf(owners, input.viewer)
	const voiceText = input.ruleset.voice[input.rigour] ?? input.ruleset.voice.prose ?? ""
	const blocks: RulesetBlocks = {}
	const v = block({ full: voiceText }, "full", PRIORITY.voice)
	if (v) blocks.voice = v
	const sheet: Record<RenderDepth, string[]> = { index: [], summary: [], full: [] }
	for (const owner of owners) {
		const d = sheetRenders(ordered, owner, resolved.get(owner.key)!, voice)
		for (const depth of DEPTHS) {
			const t = renderAt(d, depth)
			if (t) sheet[depth].push(t)
		}
	}
	const sheetBlock = block(
		Object.fromEntries(DEPTHS.filter((d) => sheet[d].length).map((d) => [d, sheet[d].join("\n")])),
		defaultDepth(input.rigour, "sheet"),
		PRIORITY.sheet
	)
	if (sheetBlock) blocks.sheet = sheetBlock
	const pieces = piecesRenders(ordered, voice, resolved)
	const piecesBlock = block(pieces.depths, pieces.pin ?? defaultDepth(input.rigour, "pieces"), PRIORITY.pieces)
	if (piecesBlock) blocks.pieces = piecesBlock
	const ties = block(tiesRenders(ordered, voice), "summary", PRIORITY.ties)
	if (ties) blocks.ties = ties
	const custom = block(customRenders(ordered, voice), "index", PRIORITY.custom)
	if (custom) blocks.custom = custom
	if (input.viewer === "gm") {
		const gm = block(gmRenders(ordered), defaultDepth(input.rigour, "pieces") === "index" ? "index" : "full", PRIORITY.gm)
		if (gm) blocks.gm = gm
	}
	if (voice === null) {
		const holders: Record<string, RulesetBlock> = {}
		for (const owner of actingHolders(owners)) {
			const b = block(holderRenders(ordered, owner, resolved.get(owner.key)!), "summary", PRIORITY.holder)
			if (b) holders[owner.key] = b
		}
		if (Object.keys(holders).length) blocks.holders = holders
	}
	out.blocks = blocks
	return out
}

/**
 * Apply the model's deltas and let `elapsed` pass: timed pieces that ran
 * out leave first (on what was held), then each delta is validated and
 * rolled from `input.random`, then time triggers fire. With no deltas this
 * is the `advance` moment. Returns the changes for `resolve.ts` to write.
 */
export function runApply(input: EngineInput, seed = "ruleset", early?: Map<string, Resolved>): EngineOutput {
	const { ordered, resolved } = resolveAll(input, seed, early)
	const out = common(ordered, resolved)
	const st: ApplyState = { out, resolved, pending: new Map(), cured: new Map(), rolls: 0, pieces: new Map() }
	expireTimed(st, ordered)
	for (const delta of input.deltas) applyDelta(st, ordered, delta)
	fireTime(st, ordered)
	refillSpellPoints(st, ordered)
	if (out.outcomes.length) {
		const b = block({ full: out.outcomes.map((o) => `- ${o.text}`).join("\n") }, "full", PRIORITY.outcomes)
		if (b) out.blocks = { outcomes: b }
	}
	return out
}
