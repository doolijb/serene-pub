/**
 * What the editor knows, given a schema.
 *
 * Slice 1 made `TemplateScope` a real schema and slice 2 taught the lint to
 * walk it. This is the third thing the schema buys, and the one an author
 * actually feels: completions that know what is in scope where the cursor is,
 * hover text that answers "what *is* `nickname`", and a "did you mean" on a
 * path that is one letter off.
 *
 * ## Why this does not reuse the card parser
 *
 * `parseContextTemplate` runs the real Handlebars parser, which needs a
 * *complete* template. Half-typed source — which is the only kind an editor
 * ever sees — does not parse, so a completion built on it would switch off at
 * exactly the moment it is wanted. This scans tags with a tolerant regex and
 * keeps a block stack instead, which the plan for this feature called correctly:
 * tracking `{{#each x}}` / `{{#with x}}` and popping on `{{/…}}` is enough for
 * context, and nothing here needs to be a language service.
 *
 * The consequence to hold on to: this is a *best-effort* reading of a source
 * that may be mid-edit. Everything it cannot determine comes back as "no
 * suggestions" rather than a guess, for the same reason the lint stops where
 * the schema stops talking — a wrong completion is worse than none.
 */

import { elementOf, resolvePath } from "@serene-pub/sdk"
import type { TemplateScope, VarDecl, VarField, VarType } from "@serene-pub/sdk"

/** Helpers the editor offers after `{{#`. Mirrors the lint's vocabulary. */
export const ASSIST_HELPERS = [
	"if",
	"unless",
	"each",
	"with",
	"systemBlock",
	"userBlock",
	"assistantBlock"
] as const

const INLINE_HELPERS = ["json", "jsonValue", "eq", "ne", "and", "or"] as const

/** One Handlebars context, and the names visible in it. */
export interface AssistFrame {
	context?: VarField
	/** The context is real but unknowable — offer nothing rather than guess. */
	unchecked: boolean
	params: Map<string, VarField | undefined>
	parent?: AssistFrame
	/** Set while scanning an `{{#each}}`'s else branch, which is back outside. */
	inElse?: boolean
}

export interface Completion {
	/** What to show. */
	label: string
	/** What to type in, which is not the label when the name needs brackets. */
	insert: string
	kind: "field" | "variable" | "helper" | "this"
	type?: VarType
	description?: string
	optional?: boolean
	/** The source range this replaces. */
	start: number
	end: number
}

export interface Hover {
	/** The reference as written. */
	path: string
	type?: VarType
	description?: string
	optional?: boolean
	/** Set when the path does not resolve. */
	problem?: string
	suggestion?: string
}

const TAG = /\{\{\{[^{}]*\}\}\}|\{\{[^{}]*\}\}/g

/** A name Handlebars cannot read bare — `extra lore` must be `[extra lore]`. */
function needsBrackets(name: string): boolean {
	return !/^[A-Za-z_$][\w$]*$/.test(name)
}

function unbracket(seg: string): string {
	// Leading and trailing handled independently: a half-typed `[extra lo` is
	// what the editor sees most of the time, and it still names a field.
	let out = seg.startsWith("[") ? seg.slice(1) : seg
	if (out.endsWith("]")) out = out.slice(0, -1)
	return out
}

/**
 * Split an expression into its arguments, respecting `[segment literals]`.
 *
 * A bare `.split(/\s+/)` turns `jsonValue this.[extra lore] 4` into
 * `this.[extra` and `lore]`, and then lints both as missing fields. That is not
 * hypothetical: `extra lore` is a real key, it is what the completion list
 * inserts, and the shipped characters layout is written with it — so the naive
 * split flagged the layout Serene Pub ships.
 */
export function templateTokens(
	src: string
): { text: string; start: number }[] {
	const out: { text: string; start: number }[] = []
	let cur = ""
	let start = 0
	let depth = 0
	for (let i = 0; i < src.length; i++) {
		const c = src[i]!
		if (c === "[") depth++
		else if (c === "]") depth = Math.max(0, depth - 1)
		if (/\s/.test(c) && depth === 0) {
			if (cur) out.push({ text: cur, start })
			cur = ""
			continue
		}
		if (!cur) start = i
		cur += c
	}
	if (cur) out.push({ text: cur, start })
	return out
}

function text(v: unknown): string | undefined {
	if (typeof v === "string") return v
	if (v && typeof v === "object" && "en" in (v as Record<string, unknown>))
		return String((v as { en: string }).en)
	return undefined
}

/**
 * The block context at `offset`.
 *
 * Unclosed blocks are simply left on the stack — which is the common state of a
 * template being typed, and the reading that gives the right answer for a
 * cursor sitting inside the block that was just opened.
 */
export function contextAt(
	source: string,
	offset: number,
	scope: TemplateScope
): AssistFrame {
	let frame: AssistFrame = { unchecked: false, params: new Map() }

	for (const m of source.matchAll(TAG)) {
		const end = m.index! + m[0].length
		// A tag the cursor sits *inside* is being typed and has no meaning yet.
		if (end > offset) break

		const inner = m[0].replace(/^\{\{\{?/, "").replace(/\}?\}\}$/, "").trim()
		if (!inner) continue

		if (inner.startsWith("/")) {
			frame = frame.parent ?? frame
			continue
		}
		if (/^else\b/.test(inner)) {
			frame.inElse = true
			continue
		}
		if (!inner.startsWith("#")) continue

		const rest = inner.slice(1).trim()
		const space = rest.search(/\s/)
		const helper = space === -1 ? rest : rest.slice(0, space)
		const args = space === -1 ? "" : rest.slice(space + 1).trim()

		if (helper !== "each" && helper !== "with") {
			// A block that does not shift context still has to be popped by its
			// own `{{/…}}`, so it gets a frame that simply inherits.
			frame = {
				context: frame.context,
				unchecked: frame.unchecked,
				params: frame.params,
				parent: frame
			}
			continue
		}

		const target = targetOf(args)
		const resolved = target ? typeOf(target, frame, scope) : undefined
		const context =
			helper === "each" ? elementOf(resolved) : asField(resolved)

		const params = new Map(frame.params)
		const names = blockParams(args)
		if (names[0]) params.set(names[0], context)
		for (const extra of names.slice(1)) params.set(extra, undefined)

		frame = { context, unchecked: !context, params, parent: frame }
	}

	// An `{{#each}}`'s else branch runs on an empty collection, so it is back
	// in the enclosing context.
	if (frame.inElse && frame.parent) return frame.parent
	return frame
}

function targetOf(args: string): string | null {
	const trimmed = args.trim()
	if (!trimmed || trimmed.startsWith("(")) return null
	const asIdx = trimmed.indexOf(" as |")
	if (asIdx !== -1) return trimmed.slice(0, asIdx).trim()
	if (/\s/.test(trimmed)) return null
	return trimmed
}

function blockParams(args: string): string[] {
	const m = /\bas\s*\|([^|]*)\|/.exec(args)
	return m ? m[1]!.trim().split(/\s+/).filter(Boolean) : []
}

function asField(decl: VarDecl | undefined): VarField | undefined {
	return decl && decl !== "any" && !Array.isArray(decl) ? decl : undefined
}

/** What a written reference resolves to, or undefined when unknowable. */
function typeOf(
	expr: string,
	frame: AssistFrame,
	scope: TemplateScope
): VarDecl | undefined {
	const r = walk(expr, frame, scope)
	if (!r || !r.resolution.ok) return undefined
	return r.resolution.field ?? (r.rest.length ? undefined : r.base)
}

/**
 * Split a written reference into the part that can be resolved and the frame it
 * resolves against, following `../` and `this.` first.
 */
function walk(
	expr: string,
	frame: AssistFrame,
	scope: TemplateScope
): {
	base: VarDecl | undefined
	rest: string[]
	resolution: ReturnType<typeof resolvePath>
	/** Undefined when the leading name was not found at the root. */
	unknownRoot?: string
} | null {
	let rest = expr.trim()
	if (!rest || rest.startsWith("@")) return null

	let f = frame
	while (rest.startsWith("../")) {
		rest = rest.slice(3)
		if (!f.parent) return null
		f = f.parent
	}

	let parts = splitPath(rest)
	if (parts[0] === "this") parts = parts.slice(1)

	if (parts.length && f.params.has(parts[0]!)) {
		const base = f.params.get(parts[0]!)
		const tail = parts.slice(1)
		return { base, rest: tail, resolution: resolvePath(base, tail) }
	}

	const isRoot = !f.context && !f.parent
	if (isRoot) {
		if (!parts.length) return null
		const base = scope[parts[0]!]
		if (base === undefined)
			return {
				base: undefined,
				rest: [],
				resolution: resolvePath(undefined, []),
				unknownRoot: parts[0]!
			}
		const tail = parts.slice(1)
		return { base, rest: tail, resolution: resolvePath(base, tail) }
	}

	return {
		base: f.context,
		rest: parts,
		resolution: resolvePath(f.context, parts)
	}
}

/**
 * `this.[extra lore].note` → `["this", "extra lore", "note"]`.
 *
 * Splitting on `.` is right until a segment literal holds one, and unwrapping
 * the brackets is what lets the name match the schema's key — the schema knows
 * `extra lore`, not `[extra lore]`.
 */
function splitPath(expr: string): string[] {
	const out: string[] = []
	let cur = ""
	let inBracket = false
	for (const c of expr) {
		if (c === "[") {
			inBracket = true
			continue
		}
		if (c === "]") {
			inBracket = false
			continue
		}
		if (c === "." && !inBracket) {
			if (cur) out.push(cur)
			cur = ""
			continue
		}
		cur += c
	}
	if (cur) out.push(cur)
	return out
}

/** The `{{ … }}` the cursor is inside, if it is inside one. */
function openTagAt(
	source: string,
	offset: number
): { contentStart: number; inner: string } | null {
	const before = source.slice(0, offset)
	const open = before.lastIndexOf("{{")
	if (open === -1) return null
	// A `}}` between the last `{{` and the cursor means that tag is closed and
	// the cursor is in text after it.
	if (before.indexOf("}}", open) !== -1) return null
	const braces = before.startsWith("{{{", open) ? 3 : 2
	return { contentStart: open + braces, inner: before.slice(open + braces) }
}

/**
 * Completions at a cursor.
 *
 * Offered only inside a `{{ … }}` — a completion popping up mid-sentence while
 * someone writes prose is an interruption, not a help, and prose is a
 * first-class outcome here rather than a fallback.
 */
export function completionsAt(
	source: string,
	offset: number,
	scope: TemplateScope
): Completion[] {
	const tag = openTagAt(source, offset)
	if (!tag) return []

	const frame = contextAt(source, offset, scope)
	const { inner, contentStart } = tag

	// `{{#` — the helper itself.
	if (/^#[\w-]*$/.test(inner.trimStart())) {
		const typed = inner.trimStart().slice(1)
		const start = contentStart + inner.length - typed.length
		return ASSIST_HELPERS.filter((h) => h.startsWith(typed)).map((h) => ({
			label: h,
			insert: h,
			kind: "helper" as const,
			start,
			end: offset
		}))
	}

	// The token the caret is at the end of, which is the last one when the
	// expression does not end in whitespace.
	const toks = templateTokens(inner)
	const last = toks[toks.length - 1]
	const atEnd = last && last.start + last.text.length === inner.length
	const tokenStart = atEnd ? last!.start : inner.length
	const token = atEnd ? last!.text : ""
	const absoluteTokenStart = contentStart + tokenStart

	// The first word of a plain `{{ … }}` may be an inline helper.
	const isFirstToken = inner.slice(0, tokenStart).trim() === ""
	const helpers: Completion[] =
		isFirstToken && !inner.trimStart().startsWith("#")
			? INLINE_HELPERS.filter((h) => h.startsWith(token) && token !== "").map(
					(h) => ({
						label: h,
						insert: h,
						kind: "helper" as const,
						start: absoluteTokenStart,
						end: offset
					})
				)
			: []

	return [...pathCompletions(token, absoluteTokenStart, offset, frame, scope), ...helpers]
}

function pathCompletions(
	token: string,
	tokenStart: number,
	offset: number,
	frame: AssistFrame,
	scope: TemplateScope
): Completion[] {
	if (token.startsWith("@") || token.startsWith("(")) return []

	let f = frame
	let rest = token
	let consumed = 0
	while (rest.startsWith("../")) {
		rest = rest.slice(3)
		consumed += 3
		if (!f.parent) return []
		f = f.parent
	}

	const lastDot = rest.lastIndexOf(".")
	const partial = lastDot === -1 ? rest : rest.slice(lastDot + 1)
	const prefix = lastDot === -1 ? "" : rest.slice(0, lastDot)
	const partialStart = tokenStart + consumed + (lastDot === -1 ? 0 : lastDot + 1)

	const available = fieldsFor(prefix, f, scope)
	if (!available) return []

	const needle = unbracket(partial).toLowerCase()
	return available
		.filter((c) => c.label.toLowerCase().startsWith(needle))
		.map((c) => ({ ...c, start: partialStart, end: offset }))
}

type Candidate = Omit<Completion, "start" | "end">

/**
 * What may follow `prefix`, or `null` when nothing can be said.
 *
 * A record answers `null` rather than `[]`: its keys are whatever the data's
 * author chose, so there is no list, and offering an empty one reads as "this
 * has no fields" — the opposite of the truth.
 */
function fieldsFor(
	prefix: string,
	frame: AssistFrame,
	scope: TemplateScope
): Candidate[] | null {
	if (prefix === "" || prefix === "this") {
		const isRoot = !frame.context && !frame.parent
		const out: Candidate[] = []

		for (const [name, bound] of frame.params)
			out.push({
				label: name,
				insert: name,
				kind: "variable",
				type: bound?.type,
				description: text(bound?.description)
			})

		if (isRoot && prefix === "") {
			for (const [name, decl] of Object.entries(scope)) {
				const field = asField(decl)
				out.push({
					label: name,
					insert: needsBrackets(name) ? `[${name}]` : name,
					kind: "variable",
					type: field?.type,
					description: text(field?.description)
				})
			}
			return out
		}

		if (frame.unchecked || !frame.context) return out.length ? out : null
		return [...out, ...fieldCandidates(frame.context)]
	}

	const r = walk(prefix, frame, scope)
	if (!r || r.unknownRoot || !r.resolution.ok) return null
	const field = r.resolution.field ?? asField(r.base)
	if (!field) return null
	return fieldCandidates(field)
}

function fieldCandidates(field: VarField): Candidate[] {
	if (field.type === "list")
		return [
			{ label: "length", insert: "length", kind: "field", type: "number" }
		]
	if (field.type !== "object" || !field.fields) return []
	return Object.entries(field.fields).map(([name, f]) => ({
		label: name,
		insert: needsBrackets(name) ? `[${name}]` : name,
		kind: "field",
		type: f.type,
		description: text(f.description),
		optional: f.optional
	}))
}

/** The reference under the cursor, described. */
export function describeAt(
	source: string,
	offset: number,
	scope: TemplateScope
): Hover | null {
	const found = referenceAt(source, offset)
	if (!found) return null
	const frame = contextAt(source, found.start, scope)
	const r = walk(found.text, frame, scope)
	if (!r) return null

	if (r.unknownRoot)
		return {
			path: found.text,
			problem: `"${r.unknownRoot}" isn't a recognized field at this scope.`,
			suggestion: suggest(r.unknownRoot, Object.keys(scope))
		}

	if (!r.resolution.ok)
		return {
			path: found.text,
			problem: r.resolution.message,
			suggestion: r.resolution.at
				? suggest(r.resolution.at, r.resolution.available ?? [])
				: undefined
		}

	const field = r.resolution.field ?? asField(r.base)
	if (!field) return { path: found.text }
	return {
		path: found.text,
		type: field.type,
		description: text(field.description),
		optional: field.optional
	}
}

/** The path-like token the cursor sits in, inside a mustache. */
function referenceAt(
	source: string,
	offset: number
): { text: string; start: number; end: number } | null {
	for (const m of source.matchAll(TAG)) {
		const start = m.index!
		const end = start + m[0].length
		if (offset < start || offset > end) continue

		const braces = m[0].startsWith("{{{") ? 3 : 2
		const body = m[0].slice(braces, m[0].length - braces)
		const bodyStart = start + braces
		if (body.includes("(")) return null

		for (const t of templateTokens(body)) {
			const tStart = bodyStart + t.start
			const tEnd = tStart + t.text.length
			if (offset < tStart || offset > tEnd) continue
			const raw = t.text.replace(/^[#/]/, "")
			if (!raw || raw.startsWith("@") || /^["'\d]/.test(raw)) return null
			return { text: raw, start: tStart, end: tEnd }
		}
		return null
	}
	return null
}

/**
 * The nearest name, when there is an obviously-nearest one.
 *
 * Deliberately tight. "Did you mean" is only worth saying when it is almost
 * certainly right — a wrong guess sends someone to change a line that was
 * correct, which costs more than saying nothing.
 */
export function suggest(
	typed: string,
	available: readonly string[]
): string | undefined {
	if (!typed || !available.length) return undefined
	const limit = typed.length <= 4 ? 1 : 2
	let best: string | undefined
	let bestDistance = Infinity
	for (const name of [...available].sort()) {
		const d = distance(typed.toLowerCase(), name.toLowerCase())
		if (d < bestDistance && d <= limit) {
			best = name
			bestDistance = d
		}
	}
	return best
}

/** Levenshtein, two rows. */
function distance(a: string, b: string): number {
	if (a === b) return 0
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
	for (let i = 1; i <= a.length; i++) {
		const row = [i]
		for (let j = 1; j <= b.length; j++)
			row[j] = Math.min(
				prev[j]! + 1,
				row[j - 1]! + 1,
				prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
			)
		prev = row
	}
	return prev[b.length]!
}
