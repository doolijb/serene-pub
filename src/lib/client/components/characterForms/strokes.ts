/**
 * 🚧 A card's strokes, as the character form edits them
 * (plans/DESIGN-card-strokes-and-dowry-2026-10-11 §A.7) — the arithmetic
 * behind `StrokeList`, kept here so it is testable without a DOM.
 *
 * The form holds ONE list for the whole card (array order is position) and
 * each field — Description, Personality — shows only its own kind. Every edit
 * here keeps the other kind's strokes exactly where they are: a reorder swaps
 * two strokes of one kind and nothing else moves.
 *
 * Pure: every function returns a new array and never mutates its input.
 */

import {
	compileStrokes,
	strokeSlugFor,
	STROKE_SLUG,
	validateStrokes,
	type Stroke,
	type StrokeFinding,
	type StrokeKind,
	type StrokeWhen
} from "@serene-pub/sdk"
import { STROKES_ENABLED } from "$lib/shared/characters/strokesFlag"

/** A stroke of one kind, with its position in the whole card's list. */
export interface KindStroke {
	stroke: Stroke
	/** Index in the whole card's list — what findings and token counts are keyed by. */
	index: number
}

/** The strokes of one kind, in order, each with its index in the whole list. */
export function strokesOfKind(all: readonly Stroke[], kind: StrokeKind): KindStroke[] {
	const out: KindStroke[] = []
	all.forEach((stroke, index) => {
		if (stroke?.kind === kind) out.push({ stroke, index })
	})
	return out
}

/** Whether the card has any stroke of this kind. */
export const hasKind = (all: readonly Stroke[], kind: StrokeKind): boolean =>
	all.some((s) => s?.kind === kind)

/** A blank stroke of a kind — in the prompt every turn until it says otherwise. */
export const blankStroke = (kind: StrokeKind): Stroke => ({
	kind,
	text: "",
	when: { mode: "always" }
})

/**
 * A stroke added at the end of its kind: right after the kind's last stroke,
 * or at the end of the list when the kind has none.
 */
export function withStrokeAdded(all: readonly Stroke[], stroke: Stroke): Stroke[] {
	const mine = strokesOfKind(all, stroke.kind)
	const at = mine.length ? mine[mine.length - 1].index + 1 : all.length
	return [...all.slice(0, at), stroke, ...all.slice(at)]
}

/** The list without the stroke at `index` (whole-list index). */
export function withStrokeRemoved(all: readonly Stroke[], index: number): Stroke[] {
	if (index < 0 || index >= all.length) return [...all]
	return all.filter((_, i) => i !== index)
}

/** Every slug the card uses, but the one at `except`. */
const slugsIn = (all: readonly Stroke[], except = -1): Set<string> =>
	new Set(all.flatMap((s, i) => (i !== except && typeof s?.slug === "string" ? [s.slug] : [])))

/** `base`, or `base-2`, `base-3`… — the first one `taken` does not hold, 64 at most. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) return base
	for (let n = 2; ; n++) {
		const suffix = `-${n}`
		const slug = `${base.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}`
		if (!taken.has(slug)) return slug
	}
}

/**
 * A copy of the stroke at `index`, right after it. A slug is per card, so the
 * copy's is made unique (`eyes` → `eyes-2`).
 */
export function withStrokeDuplicated(all: readonly Stroke[], index: number): Stroke[] {
	const source = all[index]
	if (!source) return [...all]
	// JSON, not structuredClone: the form's list is a $state proxy, which
	// structuredClone refuses.
	const copy: Stroke = JSON.parse(JSON.stringify(source))
	if (copy.slug) copy.slug = uniqueSlug(copy.slug, slugsIn(all))
	return [...all.slice(0, index + 1), copy, ...all.slice(index + 1)]
}

/**
 * The stroke at whole-list `index` moved one place among ITS kind (`by` -1 up,
 * +1 down): swapped with the neighbouring stroke of the same kind. Strokes of
 * the other kind keep their positions. At either end, nothing moves.
 */
export function withStrokeMoved(all: readonly Stroke[], index: number, by: -1 | 1): Stroke[] {
	const stroke = all[index]
	if (!stroke) return [...all]
	const mine = strokesOfKind(all, stroke.kind)
	const at = mine.findIndex((k) => k.index === index)
	const other = mine[at + by]
	if (!other) return [...all]
	const next = [...all]
	next[index] = all[other.index]
	next[other.index] = stroke
	return next
}

/**
 * The stroke at `from` dropped where the stroke at `to` is (both whole-list
 * indexes, same kind): it takes that place, and the strokes of its kind between
 * shift by one. Strokes of the other kind keep their positions.
 */
export function withStrokeDroppedAt(all: readonly Stroke[], from: number, to: number): Stroke[] {
	const a = all[from]
	const b = all[to]
	if (!a || !b || a.kind !== b.kind || from === to) return [...all]
	const mine = strokesOfKind(all, a.kind)
	const order = mine.map((k) => k.stroke)
	const fromAt = mine.findIndex((k) => k.index === from)
	const toAt = mine.findIndex((k) => k.index === to)
	const [moved] = order.splice(fromAt, 1)
	order.splice(toAt, 0, moved)
	const next = [...all]
	mine.forEach((k, i) => (next[k.index] = order[i]))
	return next
}

/**
 * A label typed: the slug follows it while the slug is still the one the old
 * label made (or there is none), and stops following once a person has set
 * it. A label cleared drops a slug that only followed it.
 */
export function strokeWithLabel(all: readonly Stroke[], index: number, label: string): Stroke {
	const stroke = all[index]
	const following = !stroke.slug || stroke.slug === autoSlugOf(all, index, stroke.label ?? "")
	const next: Stroke = { ...stroke }
	if (label) next.label = label
	else delete next.label
	if (following) {
		if (label.trim()) next.slug = uniqueSlug(strokeSlugFor(label), slugsIn(all, index))
		else delete next.slug
	}
	return next
}

/** The slug a label would give the stroke at `index`, made unique against the rest. */
export const autoSlugOf = (all: readonly Stroke[], index: number, label: string): string | undefined =>
	label.trim() ? uniqueSlug(strokeSlugFor(label), slugsIn(all, index)) : undefined

/** Whether a typed slug is one the card could save (the shape only; uniqueness is a finding). */
export const slugShapeOk = (slug: string): boolean => STROKE_SLUG.test(slug)

// ── When ────────────────────────────────────────────────────────────────────

export type WhenChoice = "always" | "off" | "keywords"

/**
 * The stroke's condition switched. Keywords keeps any keys and match settings
 * the stroke already had; the others are the bare mode.
 */
export function whenSwitched(when: StrokeWhen, to: WhenChoice): StrokeWhen {
	if (to === "always") return { mode: "always" }
	if (to === "off") return { mode: "off" }
	if (when.mode === "keywords") return when
	return { mode: "keywords", keys: [], matchMode: "substring", caseSensitive: false }
}

/** The chip's words: *Always*, *Off*, *Keywords 3*. */
export function whenChipText(when: StrokeWhen | undefined): string {
	if (!when || when.mode === "always") return "Always"
	if (when.mode === "off") return "Off"
	return when.keys.length ? `Keywords ${when.keys.length}` : "Keywords"
}

// ── Findings ────────────────────────────────────────────────────────────────

/** Which part of a stroke a finding is about — where the row says it. */
export type FindingField = "slug" | "label" | "text" | "when" | "stroke"

export interface RowFinding {
	field: FindingField
	message: string
}

const FINDING_PATH = /^strokes\[(\d+)\](?:\.(slug|label|text|when|kind))?/

/**
 * `validateStrokes`' findings, filed under the stroke they are about (whole-list
 * index) and the field the row shows them under. A finding about the list as
 * a whole (too many strokes) is filed under `-1`.
 */
export function findingsByStroke(findings: readonly StrokeFinding[]): Map<number, RowFinding[]> {
	const out = new Map<number, RowFinding[]>()
	for (const f of findings) {
		const m = FINDING_PATH.exec(f.path)
		const index = m ? Number(m[1]) : -1
		const raw = m?.[2]
		const field: FindingField =
			raw === "slug" || raw === "label" || raw === "text" || raw === "when" ? raw : "stroke"
		const list = out.get(index) ?? []
		list.push({ field, message: sentence(f.message) })
		out.set(index, list)
	}
	return out
}

/** A finding as a sentence a person reads: capitalised, full stop. */
export const sentence = (message: string): string => {
	const body = message.trim()
	const cap = body.charAt(0).toUpperCase() + body.slice(1)
	return /[.!?]$/.test(cap) ? cap : `${cap}.`
}

/** The card's strokes' findings, filed per stroke. */
export const strokeFindings = (all: readonly Stroke[]): Map<number, RowFinding[]> =>
	findingsByStroke(validateStrokes(all))

// ── Tokens ──────────────────────────────────────────────────────────────────

/** `≈ 120 tokens (model)`, or `(estimate)` when the server had no tokenizer. */
export function tokenLabel(n: number | null | undefined, model?: string | null): string {
	const count = typeof n === "number" && Number.isFinite(n) ? n : 0
	const word = count === 1 ? "token" : "tokens"
	if (model === undefined) return `≈ ${count} ${word}`
	return `≈ ${count} ${word} (${model || "estimate"})`
}

// ── The card as a whole ─────────────────────────────────────────────────────

/** The prose fields a stroke card compiles into. */
export interface CardProse {
	description: string
	personality: string
}

/**
 * The strokes a save sends. With strokes, the server derives BOTH prose
 * columns from them, so a field still shown as one text (it was never split)
 * travels as one unlabelled *Always* stroke holding that text — which
 * compiles back to exactly it. Appended, so every stroke the form shows keeps
 * its index (the token counts are keyed by it).
 */
export function strokesForSave(all: readonly Stroke[], prose: CardProse): Stroke[] {
	if (!all.length) return []
	const out = [...all]
	for (const kind of ["description", "personality"] as const) {
		const text = prose[kind]?.trim()
		if (!hasKind(all, kind) && text) out.push({ kind, text, when: { mode: "always" } })
	}
	return out
}

/**
 * The character a save sends, from the form's draft. Strokes paused
 * (`STROKES_ENABLED` off): no `strokes` key at all — the prose is the card,
 * and the server clears any stored strokes when it writes it. On: the draft
 * with `strokesForSave`'s list.
 */
export function characterForSave<T extends CardProse & { strokes: Stroke[] }>(
	draft: T
): Omit<T, "strokes"> & { strokes?: Stroke[] } {
	const { strokes, ...rest } = draft
	if (!STROKES_ENABLED) return rest
	return {
		...rest,
		strokes: strokesForSave(strokes, {
			description: draft.description,
			personality: draft.personality
		})
	}
}

/**
 * A field's text, turned into strokes so a stroke can be added beside it:
 * its prose as one stroke (when it has any), then a blank one.
 */
export function withKindStarted(all: readonly Stroke[], kind: StrokeKind, prose: string): Stroke[] {
	let next = [...all]
	if (prose.trim()) next = withStrokeAdded(next, { kind, text: prose.trim(), when: { mode: "always" } })
	return withStrokeAdded(next, blankStroke(kind))
}

/**
 * **Split into strokes** applied to one field: its kind's strokes replaced by
 * the split (the field had none — it was a textarea — so this only adds).
 */
export function withSplitApplied(all: readonly Stroke[], kind: StrokeKind, split: readonly Stroke[]): Stroke[] {
	const others = all.filter((s) => s.kind !== kind)
	return [...others, ...split]
}

/**
 * **Back to one text**: each field compiled from its strokes (a field that was
 * never split keeps its own text) and the strokes cleared — the card is the
 * legacy shape again. `off` strokes compile nowhere, so they go.
 */
export function backToOneText(all: readonly Stroke[], prose: CardProse): CardProse & { strokes: Stroke[] } {
	const compiled = (kind: StrokeKind) =>
		hasKind(all, kind) ? (compileStrokes(all, kind) ?? "") : prose[kind]
	return {
		description: compiled("description"),
		personality: compiled("personality"),
		strokes: []
	}
}

/** How many strokes of the card would be lost by Back to one text (the `off` ones). */
export const offStrokeCount = (all: readonly Stroke[]): number =>
	all.filter((s) => s.when?.mode === "off" && s.text?.trim()).length
