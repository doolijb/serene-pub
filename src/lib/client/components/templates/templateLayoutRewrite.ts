/**
 * Where a template names a variable's layout, and how to rewrite it (W5).
 *
 * A laid-out variable (`characters`) is written out in a context template one
 * of two ways: a bare read (`{{{characters}}}`, the pub's layout) or a call
 * that names a layout in place (`{{{layout characters "core/json@1"}}}`,
 * Liquid `{{ characters | layout: "core/json@1" }}`). This finds those, and
 * only those — `{{#each characters}}`, `characters.name`, a call inside a
 * subexpression, a Liquid call with more filters and an escaped Handlebars tag
 * are left alone — and produces the replacement text.
 *
 * The bare-read shape mirrors the server's `nameLayoutAtBareReads`
 * (`leftoverPicks.ts`), so "Move into the template" and the editor agree.
 */
import { parseVariableLayoutReference } from "@serene-pub/sdk"
import { CORE_LIQUID_ENGINE } from "$lib/shared/pipelines/templateEngines"

export interface LaidOutOccurrence {
	key: string
	/** The whole tag, braces included. */
	start: number
	end: number
	/** Null = a bare read; else the call's reference. */
	reference: string | null
}

interface Offer {
	reference: string
	label: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Every occurrence of `keys` in `source`, in source order. */
export function laidOutOccurrences(
	engine: string,
	source: string,
	keys: readonly string[]
): LaidOutOccurrence[] {
	const out: LaidOutOccurrence[] = []
	const liquid = engine === CORE_LIQUID_ENGINE
	for (const key of keys) {
		const k = escapeRe(key)
		// [pattern, is it a call that names a reference]
		const patterns: [RegExp, boolean][] = liquid
			? [
					[new RegExp(`\\{\\{-?\\s*${k}\\s*-?\\}\\}`, "g"), false],
					[
						new RegExp(
							`\\{\\{-?\\s*${k}\\s*\\|\\s*layout\\s*:\\s*(["'])([^"']*)\\1\\s*-?\\}\\}`,
							"g"
						),
						true
					]
				]
			: [
					[
						new RegExp(
							`(?<!\\\\)\\{\\{\\{~?\\s*${k}\\s*~?\\}\\}\\}`,
							"g"
						),
						false
					],
					[
						new RegExp(
							`(?<![\\\\{])\\{\\{(?!\\{)~?\\s*${k}\\s*~?\\}\\}(?!\\})`,
							"g"
						),
						false
					],
					[
						new RegExp(
							`(?<!\\\\)\\{\\{\\{~?\\s*layout\\s+${k}\\s+(["'])([^"']*)\\1\\s*~?\\}\\}\\}`,
							"g"
						),
						true
					],
					[
						new RegExp(
							`(?<![\\\\{])\\{\\{(?!\\{)~?\\s*layout\\s+${k}\\s+(["'])([^"']*)\\1\\s*~?\\}\\}(?!\\})`,
							"g"
						),
						true
					]
				]
		for (const [re, isCall] of patterns)
			for (const m of source.matchAll(re))
				out.push({
					key,
					start: m.index!,
					end: m.index! + m[0].length,
					reference: isCall ? m[2]! : null
				})
	}
	return out.sort((a, b) => a.start - b.start)
}

/** The occurrence the caret is on or touching, if any. */
export function occurrenceAt(
	engine: string,
	source: string,
	caret: number,
	keys: readonly string[]
): LaidOutOccurrence | null {
	return (
		laidOutOccurrences(engine, source, keys).find(
			(o) => o.start <= caret && caret <= o.end
		) ?? null
	)
}

/**
 * The text that replaces `[o.start, o.end)`. `reference` null = back to the
 * pub's layout. The occurrence's own whitespace control is kept.
 */
export function writeOccurrence(
	engine: string,
	source: string,
	o: LaidOutOccurrence,
	reference: string | null
): string {
	const tag = source.slice(o.start, o.end)
	if (engine === CORE_LIQUID_ENGINE) {
		const open = tag.startsWith("{{-") ? "-" : ""
		const close = tag.endsWith("-}}") ? "-" : ""
		return reference === null
			? `{{${open} ${o.key} ${close}}}`
			: `{{${open} ${o.key} | layout: "${reference}" ${close}}}`
	}
	const open = /^\{\{\{?~/.test(tag) ? "~" : ""
	const close = /~\}\}\}?$/.test(tag) ? "~" : ""
	return reference === null
		? `{{{${open}${o.key}${close}}}}`
		: `{{{${open}layout ${o.key} "${reference}"${close}}}}`
}

/**
 * The edits for one pass over the template. `choose` returns the reference an
 * occurrence should name (null = the pub's layout), or undefined to leave it.
 * An occurrence that already reads that way is not touched.
 */
export function rewriteChanges(
	engine: string,
	source: string,
	keys: readonly string[],
	choose: (o: LaidOutOccurrence) => string | null | undefined
): { from: number; to: number; insert: string }[] {
	const changes: { from: number; to: number; insert: string }[] = []
	for (const o of laidOutOccurrences(engine, source, keys)) {
		const target = choose(o)
		if (target === undefined || target === o.reference) continue
		const insert = writeOccurrence(engine, source, o, target)
		if (insert === source.slice(o.start, o.end)) continue
		changes.push({ from: o.start, to: o.end, insert })
	}
	return changes
}

const withSlug = (offers: readonly Offer[], slugs: readonly string[]) =>
	offers.find((o) => {
		const p = parseVariableLayoutReference(o.reference)
		return p !== null && slugs.includes(p.slug)
	})

/** The offer that writes the variable as it is (`json`, `as-written`). */
export function bareOffer(offers: readonly Offer[]): Offer | undefined {
	return withSlug(offers, ["json", "as-written"])
}

/** The offer that writes it with a title (`titled-json`, `titled`). */
export function titledOffer(offers: readonly Offer[]): Offer | undefined {
	return withSlug(offers, ["titled-json", "titled"])
}
