/**
 * 🚧 The speech **Jinja filters** and the `core:template/jinja2@1` renderer.
 *
 * The app had no Jinja renderer; the SDK's `render(src, scope, { filters })`
 * is the engine and this file hands it the five filters
 * `SPEECH_JINJA_FILTERS` names:
 *
 *  - `tag`          an inflection label → the inline tag a tag-taking model
 *                   reads (`sadness` → `[sad]`). Empty unless `controls.tags`
 *                   is present, and unless the model's vocabulary holds the
 *                   word (through the crosswalk) or is `'open'`.
 *  - `dialogue`     a cue list → its dialogue cues.
 *  - `narration`    a cue list → every cue that is not dialogue (prose, action,
 *                   aside), the same split the shipped "Narration only" uses.
 *  - `strip_code`   text → text without fenced or inline code.
 *  - `spell_numbers` text → numbers spelt out in English (a service with no
 *                   normalisation of its own). Applies only when the scope's
 *                   `language` is absent or English.
 *
 * Every filter is pure and deterministic. A filter the render was NOT handed
 * yields nothing (the SDK's rule) — never the label as a word.
 *
 * ## Escaping
 *
 * The SDK engine renders loops first and then re-scans their OUTPUT for
 * `{{ }}` and `{% %}`, so cue text containing `{{x}}` would be substituted.
 * `escapeForTemplate` swaps every brace for a private-use placeholder before
 * the render and `restoreAfterTemplate` swaps them back after; the filters
 * escape what they return for the same reason.
 */

import {
	INFLECTION_SENTENCE_LAYOUT,
	INFLECTION_TAG_LAYOUT,
	SPEECH_TEMPLATE_ENGINE,
	type ShippedSpeechVariableLayout
} from "@serene-pub/core-catalog"
import { render, type JinjaFilter } from "@serene-pub/sdk"
import type { RenderContext } from "$lib/server/pipelines/prompt/renderers"
import { crosswalkTag } from "./tagCrosswalk"

// ── Escaping ────────────────────────────────────────────────────────────────

const OPEN = ""
const CLOSE = ""

/** Make `s` inert to the template engine: no brace, no NUL, no placeholder survives as itself. */
export function escapeForTemplate(s: string): string {
	return s
		.replace(/[\u0000]/g, "")
		.replace(/\{/g, OPEN)
		.replace(/\}/g, CLOSE)
}

/** The inverse of {@link escapeForTemplate}, for the render's output. */
export function restoreAfterTemplate(s: string): string {
	return s.replace(//g, "{").replace(//g, "}")
}

/** Escape every string in a value, deeply (cues, speaker, controls vocabulary words). */
export function escapeDeep<T>(v: T): T {
	if (typeof v === "string") return escapeForTemplate(v) as T
	if (Array.isArray(v)) return v.map((x) => escapeDeep(x)) as T
	if (v && typeof v === "object")
		return Object.fromEntries(
			Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, escapeDeep(x)])
		) as T
	return v
}

// ── Layouts ─────────────────────────────────────────────────────────────────

/** A resolved `variables`-slot entry (a variable-template row, as the host hands it). */
export interface SpeechLayoutValue {
	engine?: string
	source?: string
	variableId?: string
}

/** The scope key the line-template caller passes the selected inflection-tag layout under. */
export const TAG_LAYOUT_SCOPE_KEY = "__inflectionTagLayout"

/** Pick the selected layout for a shipped variable out of speak's raw `variables` slot value. */
export function layoutFromSlot(variables: unknown, shipped: ShippedSpeechVariableLayout): SpeechLayoutValue | undefined {
	if (!variables || typeof variables !== "object") return undefined
	const entry = (variables as Record<string, unknown>)[shipped.key]
	if (!entry || typeof entry !== "object") return undefined
	const row = entry as SpeechLayoutValue
	if (typeof row.source !== "string" || !row.source) return undefined
	// A row written for another variable is a stale pick (see derefLayout).
	if (row.variableId && row.variableId !== shipped.variableId) return undefined
	return row
}

/** Render a layout over `value`: the selected Jinja row, else the shipped layout's in-code floor. */
export function renderSpeechLayout(
	layout: SpeechLayoutValue | undefined,
	shipped: ShippedSpeechVariableLayout,
	value: unknown
): string {
	// Only Jinja layouts render here: the tag filter is synchronous and the
	// shipped rows are Jinja. Any other engine on the row is ignored (floor).
	if (layout?.source && (layout.engine ?? SPEECH_TEMPLATE_ENGINE) === SPEECH_TEMPLATE_ENGINE)
		return render(layout.source, { [shipped.key]: value })
	return shipped.render(value)
}

// ── Filters ─────────────────────────────────────────────────────────────────

const labelOf = (v: unknown): string =>
	typeof v === "string"
		? v.trim()
		: v && typeof v === "object" && typeof (v as { label?: unknown }).label === "string"
			? (v as { label: string }).label.trim()
			: ""

interface ControlsLike {
	tags?: { vocabulary?: readonly string[] | "open" }
}

const tag: JinjaFilter = (value, scope) => {
	const tags = (scope.controls as ControlsLike | null | undefined)?.tags
	if (!tags) return ""
	const label = labelOf(value)
	if (!label) return ""
	const layout = scope[TAG_LAYOUT_SCOPE_KEY] as SpeechLayoutValue | undefined
	const raw = renderSpeechLayout(layout, INFLECTION_TAG_LAYOUT, label).trim()
	if (!raw) return ""
	const vocabulary = tags.vocabulary ?? "open"
	const bracket = /^\[([^\[\]]+)\]$/.exec(raw)
	if (!bracket) return vocabulary === "open" ? escapeForTemplate(raw) : ""
	const word = crosswalkTag(bracket[1]!, label, vocabulary)
	return word ? escapeForTemplate(`[${word}]`) : ""
}

const cuesOf = (v: unknown): Array<Record<string, unknown>> =>
	Array.isArray(v) ? v.filter((c): c is Record<string, unknown> => !!c && typeof c === "object") : []

const dialogue: JinjaFilter = (value) => cuesOf(value).filter((c) => c.kind === "dialogue")
const narration: JinjaFilter = (value) => cuesOf(value).filter((c) => c.kind !== "dialogue")

/** Text without fenced blocks (``` or ~~~) or inline code spans. */
export function stripCode(text: string): string {
	return text
		.replace(/```[\s\S]*?(```|$)/g, "")
		.replace(/~~~[\s\S]*?(~~~|$)/g, "")
		.replace(/``[^`\n]*``|`[^`\n]*`/g, "")
}

const stripCodeFilter: JinjaFilter = (value) => (typeof value === "string" ? stripCode(value) : value)

const ONES = [
	"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
	"eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"
]
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
const SCALES = ["", " thousand", " million", " billion", " trillion"]
const ORDINAL_IRREGULAR: Record<string, string> = {
	one: "first", two: "second", three: "third", five: "fifth", eight: "eighth",
	nine: "ninth", twelve: "twelfth"
}

function below1000(n: number): string {
	const parts: string[] = []
	const h = Math.floor(n / 100)
	const r = n % 100
	if (h) parts.push(`${ONES[h]} hundred`)
	if (r) {
		if (r < 20) parts.push(ONES[r]!)
		else parts.push(TENS[Math.floor(r / 10)]! + (r % 10 ? `-${ONES[r % 10]}` : ""))
	}
	return parts.join(" ")
}

/** A non-negative integer as English words; null past a quadrillion. */
export function spellInteger(n: number): string | null {
	if (!Number.isSafeInteger(n) || n < 0 || n >= 1e15) return null
	if (n === 0) return "zero"
	const groups: string[] = []
	let rest = n
	for (let i = 0; rest > 0; i++, rest = Math.floor(rest / 1000)) {
		const g = rest % 1000
		if (g) groups.unshift(below1000(g) + SCALES[i])
	}
	return groups.join(" ")
}

function ordinalWord(cardinal: string): string {
	const m = /^(.*?)([a-z]+)$/.exec(cardinal)!
	const last = m[2]!
	if (ORDINAL_IRREGULAR[last]) return m[1] + ORDINAL_IRREGULAR[last]
	if (last.endsWith("y")) return m[1] + last.slice(0, -1) + "ieth"
	return m[1] + last + "th"
}

/** English only. "3 apples" → "three apples"; "1,200" → "one thousand two hundred"; "-4" → "minus four"; "2.5" → "two point five"; "21st" → "twenty-first". */
export function spellNumbers(text: string): string {
	return text.replace(/(?<![\w.])(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(st|nd|rd|th)?(?![\w])/g,
		(whole, neg: string | undefined, int: string, frac: string | undefined, ord: string | undefined) => {
			const words = spellInteger(Number(int.replace(/,/g, "")))
			if (words === null) return whole
			let out = ord && !frac ? ordinalWord(words) : words
			if (frac) out += " point " + [...frac].map((d) => ONES[Number(d)]).join(" ")
			return (neg ? "minus " : "") + out
		})
}

const spellNumbersFilter: JinjaFilter = (value, scope) => {
	if (typeof value !== "string") return value
	const language = typeof scope.language === "string" ? scope.language.toLowerCase() : ""
	if (language && !language.startsWith("en")) return value
	return spellNumbers(value)
}

/** The five filters by name — exactly `SPEECH_JINJA_FILTERS`. */
export function speechFilters(): Record<string, JinjaFilter> {
	return {
		tag,
		dialogue,
		narration,
		strip_code: stripCodeFilter,
		spell_numbers: spellNumbersFilter
	}
}

// ── The renderer ────────────────────────────────────────────────────────────

/** `core:template/jinja2@1`: the SDK engine plus the speech filters. */
export function renderJinja2(ctx: RenderContext): string {
	return render(ctx.template, ctx.variables, { filters: speechFilters() })
}

export { INFLECTION_SENTENCE_LAYOUT, INFLECTION_TAG_LAYOUT }
