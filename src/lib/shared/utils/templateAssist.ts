/**
 * What the editor knows, given a schema.
 *
 * Slice 1 made `TemplateScope` a real schema and slice 2 taught the lint to
 * walk it. This is the third thing the schema buys, and the one an author
 * actually feels: completions that know what is in scope where the cursor is,
 * hover text that answers "what *is* `nickname`" (and who supplies it), and a
 * "did you mean" on a path that is one letter off.
 *
 * Typed templates P7 made it capable (owner Q8): the per-step typed scope, a
 * helper list with signatures, block snippets that close themselves, the loop
 * data inside an `{{#each}}`, key placeholders for records, the annex's dotted
 * owners bracketed on insert, ranking (prefix, then fuzzy, then grouped), the
 * same for Liquid, and a tree of the scope (`scopeTreeNodes`).
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
 * What it does NOT own is the reading of a Handlebars path. What `../` climbs
 * to, which name a block param answers, what one `{{#each}}` element is and
 * the "did you mean" are the SDK's (`handlebarsReach.ts`) — the same answers
 * the template checker gives, so a completion and a lint finding cannot
 * disagree about what is in scope (typed templates P4).
 *
 * The consequence to hold on to: this is a *best-effort* reading of a source
 * that may be mid-edit. Everything it cannot determine comes back as "no
 * suggestions" rather than a guess, for the same reason the lint stops where
 * the schema stops talking — a wrong completion is worse than none.
 */

import {
	asVarField,
	enterHandlebarsBlock,
	handlebarsPath,
	nearestName,
	resolveHandlebarsPath,
	rootHandlebarsReach,
	typeOfHandlebarsPath
} from "@serene-pub/sdk"
import type {
	HandlebarsReach,
	TemplateScope,
	VarDecl,
	VarField,
	VarType
} from "@serene-pub/sdk"
import {
	CONTEXT_LIQUID_BLOCK_TAGS,
	CONTEXT_LIQUID_REFUSED_TAGS
} from "$lib/shared/utils/templateCheckOptions"

const LIQUID_ENGINE = "core:template/liquid@1"

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

/**
 * Every helper a context template can call, with the short signature the list
 * shows. Handlebars' own plus `CONTEXT_HANDLEBARS_HELPERS` — the test holds the
 * two together, so a helper registered without a line here fails.
 */
export const HANDLEBARS_HELPER_DOCS: Readonly<
	Record<string, { signature: string; description: string; block?: "arg" | "body" }>
> = {
	if: { signature: "#if value", description: "Renders the body when the value is truthy.", block: "arg" },
	unless: { signature: "#unless value", description: "Renders the body when the value is falsy.", block: "arg" },
	each: { signature: "#each list", description: "Renders the body once per element; `this` is the element.", block: "arg" },
	with: { signature: "#with value", description: "Renders the body with `this` set to the value.", block: "arg" },
	systemBlock: { signature: "#systemBlock", description: "A system message, framed for the connection.", block: "body" },
	userBlock: { signature: "#userBlock", description: "A user message, framed for the connection.", block: "body" },
	assistantBlock: { signature: "#assistantBlock", description: "An assistant message, framed for the connection.", block: "body" },
	lookup: { signature: "lookup object key", description: "The value at a computed key." },
	log: { signature: "log value", description: "Writes to the server log; renders nothing." },
	eq: { signature: "eq a b", description: "True when a equals b." },
	ne: { signature: "ne a b", description: "True when a does not equal b." },
	and: { signature: "and a b", description: "True when both are truthy." },
	or: { signature: "or a b", description: "True when either is truthy." },
	pad: { signature: "pad n width", description: "A number as a zero-padded string." },
	isSet: { signature: "isSet value", description: "Present, as distinct from falsy — for `{{#if (isSet x)}}`." },
	json: { signature: "json value [indent]", description: "The value as JSON." },
	jsonValue: { signature: "jsonValue value [offset] indent= offset=", description: "One value as JSON, indented as if nested." }
}

/** Inline helpers: every documented helper that is not a block. */
const INLINE_HELPERS = Object.keys(HANDLEBARS_HELPER_DOCS).filter(
	(h) => !HANDLEBARS_HELPER_DOCS[h]!.block
)

/** One Handlebars context, and the names visible in it — the SDK's reach. */
export type AssistFrame = HandlebarsReach

/**
 * Who supplies a root name, in words a template author reads (typed templates
 * P7). The server derives it from `templateScopeReport().declarers` and ships
 * the label only — never a node key.
 */
export interface ScopeDeclarer {
	label: string
	/** Where it comes from, for ranking and grouping. */
	group?: "self" | "promptFields" | "builder" | "band" | "annex"
}

export interface AssistOptions {
	/** The template engine id; Liquid gets its own reading. Default Handlebars. */
	engine?: string
	/** Root name → who supplies it. */
	declarers?: Readonly<Record<string, ScopeDeclarer>>
}

export type CompletionKind =
	| "field"
	| "variable"
	| "helper"
	| "block"
	| "this"
	| "data"
	| "placeholder"
	| "filter"
	| "tag"

/** Ranking groups, in order. */
export type CompletionGroup =
	| "local"
	| "context"
	| "band"
	| "annex"
	| "state"
	| "helper"

const GROUP_ORDER: Record<CompletionGroup, number> = {
	local: 0,
	context: 1,
	band: 2,
	annex: 3,
	state: 4,
	helper: 5
}

export interface Completion {
	/** What to show. */
	label: string
	/** What to type in, which is not the label when the name needs brackets. */
	insert: string
	kind: CompletionKind
	type?: VarType
	description?: string
	optional?: boolean
	/** A helper's or filter's short signature. */
	detail?: string
	/** Who supplies it (a root name only). */
	declarer?: string
	group?: CompletionGroup
	/**
	 * Where the caret lands after inserting, relative to the start of
	 * `insert` — a snippet's argument slot or a placeholder to type over.
	 * Absent = after the insert.
	 */
	select?: { start: number; end: number }
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
	/** Who supplies the root it starts from. */
	declarer?: string
	/** Set when the path does not resolve. */
	problem?: string
	suggestion?: string
}

const TAG = /\{\{\{[^{}]*\}\}\}|\{\{[^{}]*\}\}/g

/** A name Handlebars cannot read bare — `extra lore` must be `[extra lore]`. */
function needsBrackets(name: string): boolean {
	return !/^[A-Za-z_$][\w$]*$/.test(name)
}

/** A name Liquid cannot read bare — `a.b` must be `["a.b"]`. */
function liquidNeedsBrackets(name: string): boolean {
	return !/^[A-Za-z_][\w-]*$/.test(name)
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
export function templateTokens(src: string): { text: string; start: number }[] {
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

/** The group a root name ranks in. */
function rootGroup(name: string, declarer?: ScopeDeclarer): CompletionGroup {
	if (name === "annex" || declarer?.group === "annex") return "annex"
	if (name === "state") return "state"
	if (declarer?.group === "band") return "band"
	return "context"
}

/** `abc` in `aXbYc`, in order. */
function isSubsequence(needle: string, hay: string): boolean {
	let i = 0
	for (const c of hay) if (c === needle[i]) i++
	return i === needle.length
}

/**
 * Filter and order: exact prefix first, then fuzzy (a subsequence), and
 * within each the groups — local names, the context, bands, the annex,
 * `state`, helpers — then the declared order.
 */
function rank<T extends { label: string; group?: CompletionGroup }>(
	items: T[],
	needle: string
): T[] {
	const n = needle.toLowerCase()
	const scored: { item: T; tier: number; i: number }[] = []
	// Sigils (`@index`, `‹member›`) are not part of what is typed-for.
	const bare = (s: string) => s.replace(/^[@‹]/, "")
	const nb = bare(n)
	items.forEach((item, i) => {
		const l = item.label.toLowerCase()
		const lb = bare(l)
		// Fuzzy needs the first letter to agree — a subsequence that starts
		// anywhere matches half the list and ranks noise.
		const tier = !n
			? 0
			: l.startsWith(n) || lb.startsWith(nb)
				? 0
				: nb.length > 1 && lb[0] === nb[0] && isSubsequence(nb, lb)
					? 1
					: -1
		if (tier >= 0) scored.push({ item, tier, i })
	})
	return scored
		.sort(
			(a, b) =>
				a.tier - b.tier ||
				GROUP_ORDER[a.item.group ?? "context"] -
					GROUP_ORDER[b.item.group ?? "context"] ||
				a.i - b.i
		)
		.map((s) => s.item)
}

/* ------------------------------------------------------------------ */
/* Handlebars                                                           */
/* ------------------------------------------------------------------ */

interface OpenBlock {
	helper: string
	/** What an each/with was opened over, when the schema says. */
	target?: VarField
}

interface Scan {
	reach: HandlebarsReach
	blocks: OpenBlock[]
}

function scanBlocks(source: string, offset: number, scope: TemplateScope): Scan {
	let reach: HandlebarsReach = rootHandlebarsReach()
	// The reach each open block was opened in: `{{/…}}` returns to it, and an
	// `{{else}}` runs in it (an each over nothing, a with of nothing).
	const opened: HandlebarsReach[] = []
	const blocks: OpenBlock[] = []

	for (const m of source.matchAll(TAG)) {
		const end = m.index! + m[0].length
		// A tag the cursor sits *inside* is being typed and has no meaning yet.
		if (end > offset) break

		const inner = m[0]
			.replace(/^\{\{\{?/, "")
			.replace(/\}?\}\}$/, "")
			.replace(/^~|~$/g, "")
			.trim()
		if (!inner) continue

		if (inner.startsWith("/")) {
			reach = opened.pop() ?? reach
			blocks.pop()
			continue
		}
		if (/^else\b/.test(inner)) {
			const outer = opened[opened.length - 1]
			if (outer) reach = outer
			const top = blocks[blocks.length - 1]
			// An else branch is not inside the loop any more.
			if (top) blocks[blocks.length - 1] = { helper: `${top.helper}:else` }
			continue
		}
		if (!inner.startsWith("#")) continue

		const rest = inner.slice(1).trim()
		const space = rest.search(/\s/)
		const helper = space === -1 ? rest : rest.slice(0, space)
		const args = space === -1 ? "" : rest.slice(space + 1).trim()

		const target = targetOf(args)
		const resolved =
			target && (helper === "each" || helper === "with")
				? typeOfHandlebarsPath(handlebarsPath(target), reach, scope)
				: undefined
		opened.push(reach)
		blocks.push({ helper, target: asVarField(resolved) })
		reach = enterHandlebarsBlock(reach, helper, resolved, blockParams(args))
	}

	return { reach, blocks }
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
	return scanBlocks(source, offset, scope).reach
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
	// `lastIndexOf("{{")` in `{{{` lands on the second brace.
	const start = open > 0 && before[open - 1] === "{" ? open - 1 : open
	const braces = before.startsWith("{{{", start) ? 3 : 2
	return { contentStart: start + braces, inner: before.slice(start + braces) }
}

/** The innermost each/with — what `this` is and whether loop data exists. */
function innermostContextBlock(blocks: OpenBlock[]): OpenBlock | undefined {
	for (let i = blocks.length - 1; i >= 0; i--) {
		const h = blocks[i]!.helper
		if (h === "each" || h === "with") return blocks[i]
	}
	return undefined
}

/**
 * Completions at a cursor.
 *
 * Offered only inside a `{{ … }}` (or `{% … %}` for Liquid) — a completion
 * popping up mid-sentence while someone writes prose is an interruption, not a
 * help, and prose is a first-class outcome here rather than a fallback.
 */
export function completionsAt(
	source: string,
	offset: number,
	scope: TemplateScope,
	options: AssistOptions = {}
): Completion[] {
	if (options.engine === LIQUID_ENGINE)
		return liquidCompletionsAt(source, offset, scope, options)

	const tag = openTagAt(source, offset)
	if (!tag) return []

	const { reach: frame, blocks } = scanBlocks(source, offset, scope)
	const { inner, contentStart } = tag
	const after = source.slice(offset)

	// `{{#` — the block helper itself, as a snippet that closes the block.
	if (/^~?#[\w-]*$/.test(inner.trimStart())) {
		const typed = inner.trimStart().replace(/^~?#/, "")
		const start = contentStart + inner.length - typed.length
		// Braces already typed after the caret are reused, not doubled.
		const end = offset + (after.startsWith("}}") ? 2 : 0)
		return rank(
			ASSIST_HELPERS.map((h) => {
				const doc = HANDLEBARS_HELPER_DOCS[h]!
				const takesArg = doc.block === "arg"
				const open = takesArg ? `${h} }}` : `${h}}}\n`
				const insert = `${open}${takesArg ? "\n\n" : "\n"}{{/${h}}}`
				const caret = takesArg ? h.length + 1 : open.length
				return {
					label: h,
					insert,
					kind: "block" as const,
					detail: doc.signature,
					description: doc.description,
					group: "helper" as const,
					select: { start: caret, end: caret },
					start,
					end
				}
			}),
			typed
		)
	}

	// The token the caret is at the end of, which is the last one when the
	// expression does not end in whitespace.
	const toks = templateTokens(inner)
	const last = toks[toks.length - 1]
	const atEnd = last && last.start + last.text.length === inner.length
	const tokenStart = atEnd ? last!.start : inner.length
	const token = atEnd ? last!.text : ""
	const absoluteTokenStart = contentStart + tokenStart

	// Loop data: `@index` and friends, only inside an each.
	const loop = innermostContextBlock(blocks)
	const inEach = loop?.helper === "each"
	if (token.startsWith("@")) {
		if (!inEach) return []
		return rank(loopData(loop!), token).map((c) => ({
			...c,
			start: absoluteTokenStart,
			end: offset
		}))
	}

	// The first word of a plain `{{ … }}` may be an inline helper.
	const isFirstToken = inner.slice(0, tokenStart).trim() === ""
	const isBlockOpen = inner.trimStart().startsWith("#")
	const helpers: Completion[] =
		isFirstToken && !isBlockOpen && !token.includes(".")
			? INLINE_HELPERS.map((h) => ({
					label: h,
					insert: h,
					kind: "helper" as const,
					detail: HANDLEBARS_HELPER_DOCS[h]!.signature,
					description: HANDLEBARS_HELPER_DOCS[h]!.description,
					group: "helper" as const,
					start: absoluteTokenStart,
					end: offset
				}))
			: []

	const paths = pathCompletions(
		token,
		absoluteTokenStart,
		offset,
		frame,
		scope,
		options
	)
	const pathItems = paths?.items ?? []

	// Inside an each, at the start of a bare name: `this` and the loop data.
	const local: Completion[] =
		inEach && !token.includes(".") && !token.startsWith("../")
			? [
					{
						label: "this",
						insert: "this",
						kind: "this" as const,
						type: frame.context?.type,
						description: "The current element.",
						group: "local" as const,
						start: absoluteTokenStart,
						end: offset
					},
					...loopData(loop!).map((c) => ({
						...c,
						start: absoluteTokenStart,
						end: offset
					}))
				]
			: []

	// Paths and `this` first, loop data after them: an element's own fields
	// are what the author reaches for inside a loop.
	const needle = unbracket(lastSegment(token.replace(/^(\.\.\/)+/, "")))
	return [
		...rank(pathItems, paths?.needle ?? ""),
		...rank(
			local.filter((c) => c.kind === "this"),
			needle
		),
		...rank(
			local.filter((c) => c.kind === "data"),
			needle
		),
		...rank(helpers, token)
	]
}

function loopData(block: OpenBlock): Omit<Completion, "start" | "end">[] {
	const out: Omit<Completion, "start" | "end">[] = [
		{ label: "@index", insert: "@index", kind: "data", type: "number", description: "The element's position, from 0.", group: "local" },
		{ label: "@first", insert: "@first", kind: "data", type: "boolean", description: "True on the first element.", group: "local" },
		{ label: "@last", insert: "@last", kind: "data", type: "boolean", description: "True on the last element.", group: "local" }
	]
	if (block.target?.type === "record" || block.target?.type === "object")
		out.splice(1, 0, {
			label: "@key",
			insert: "@key",
			kind: "data",
			type: "string",
			description: "The entry's key.",
			group: "local"
		})
	return out
}

/** The index of the last `.` outside a `[segment literal]`, or -1. */
function lastTopLevelDot(s: string): number {
	let depth = 0
	let at = -1
	for (let i = 0; i < s.length; i++) {
		const c = s[i]
		if (c === "[") depth++
		else if (c === "]") depth = Math.max(0, depth - 1)
		else if (c === "." && depth === 0) at = i
	}
	return at
}

function lastSegment(s: string): string {
	const d = lastTopLevelDot(s)
	return d === -1 ? s : s.slice(d + 1)
}

function pathCompletions(
	token: string,
	tokenStart: number,
	offset: number,
	frame: AssistFrame,
	scope: TemplateScope,
	options: AssistOptions
): { items: Completion[]; needle: string } | null {
	if (token.startsWith("(")) return null

	let f = frame
	let rest = token
	let consumed = 0
	while (rest.startsWith("../")) {
		rest = rest.slice(3)
		consumed += 3
		if (!f.parent) return null
		f = f.parent
	}

	const lastDot = lastTopLevelDot(rest)
	const partial = lastDot === -1 ? rest : rest.slice(lastDot + 1)
	const prefix = lastDot === -1 ? "" : rest.slice(0, lastDot)
	const partialStart =
		tokenStart + consumed + (lastDot === -1 ? 0 : lastDot + 1)

	const available = fieldsFor(prefix, f, scope, options)
	if (!available) return null

	return {
		items: available.map((c) => ({ ...c, start: partialStart, end: offset })),
		needle: unbracket(partial)
	}
}

type Candidate = Omit<Completion, "start" | "end">

/**
 * What may follow `prefix`, or `null` when nothing can be said.
 *
 * An `'any'` value answers `null` rather than `[]`: offering an empty list
 * reads as "this has no fields" — the opposite of the truth. A record offers
 * one placeholder (`‹member›`), because its keys are the data's own.
 */
function fieldsFor(
	prefix: string,
	frame: AssistFrame,
	scope: TemplateScope,
	options: AssistOptions
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
				description: text(bound?.description),
				group: "local"
			})

		if (isRoot && prefix === "") {
			out.push(...rootCandidates(scope, options, needsBrackets, (n) => `[${n}]`))
			return out
		}

		if (frame.unchecked || !frame.context) return out.length ? out : null
		return [...out, ...fieldCandidates(frame.context, "this", needsBrackets, (n) => `[${n}]`)]
	}

	const r = resolveHandlebarsPath(handlebarsPath(prefix), frame, scope)
	if (r.kind !== "resolved" || !r.resolution.ok) return null
	const field = r.resolution.field ?? asVarField(r.base)
	if (!field) return null
	return fieldCandidates(field, unbracket(lastSegment(prefix)), needsBrackets, (n) => `[${n}]`)
}

function rootCandidates(
	scope: TemplateScope,
	options: AssistOptions,
	bracketed: (n: string) => boolean,
	wrap: (n: string) => string
): Candidate[] {
	return Object.entries(scope).map(([name, decl]) => {
		const field = asVarField(decl)
		const declarer = options.declarers?.[name]
		return {
			label: name,
			insert: bracketed(name) ? wrap(name) : name,
			kind: "variable" as const,
			type: field?.type,
			description: text(field?.description),
			optional: field?.optional,
			...(declarer ? { declarer: declarer.label } : {}),
			group: rootGroup(name, declarer)
		}
	})
}

/** The word a record's placeholder uses — `state.cast.‹member›`. */
function placeholderFor(parent: string): string {
	if (parent === "cast") return "member"
	if (parent === "locations") return "place"
	if (parent === "world") return "attribute"
	return "key"
}

function fieldCandidates(
	field: VarField,
	parentName: string,
	bracketed: (n: string) => boolean,
	wrap: (n: string) => string,
	listExtras: Candidate[] = [
		{ label: "length", insert: "length", kind: "field", type: "number" }
	]
): Candidate[] {
	if (field.type === "list") return listExtras
	if (field.type === "record") {
		const word = placeholderFor(parentName)
		return [
			{
				label: `‹${word}›`,
				insert: word,
				kind: "placeholder",
				type: field.of?.type,
				description: `Any key — the names are the data's own. Type the ${word} you mean.`,
				select: { start: 0, end: word.length }
			}
		]
	}
	if (field.type !== "object" || !field.fields) return []
	return Object.entries(field.fields).map(([name, f]) => ({
		label: name,
		insert: bracketed(name) ? wrap(name) : name,
		kind: "field" as const,
		type: f.type,
		description: text(f.description),
		optional: f.optional
	}))
}

/** The reference under the cursor, described. */
export function describeAt(
	source: string,
	offset: number,
	scope: TemplateScope,
	options: AssistOptions = {}
): Hover | null {
	if (options.engine === LIQUID_ENGINE)
		return describeLiquidAt(source, offset, scope, options)
	const found = referenceAt(source, offset)
	if (!found) return null
	const frame = contextAt(source, found.start, scope)
	const path = handlebarsPath(found.text)
	if (path.data) return null
	const r = resolveHandlebarsPath(path, frame, scope)
	if (r.kind === "unchecked") return { path: found.text }

	if (r.kind === "unknown-root")
		return {
			path: found.text,
			problem: `"${r.root}" isn't a recognized field at this scope.`,
			suggestion: suggest(r.root, r.available)
		}

	// Declared at the root, not a block param or the element: who supplies it.
	const atRoot =
		!path.depth &&
		!path.scoped &&
		!frame.params.has(r.label) &&
		!frame.context &&
		scope[r.label] !== undefined
	const declarer = atRoot ? options.declarers?.[r.label]?.label : undefined

	if (!r.resolution.ok)
		return {
			path: found.text,
			problem: r.resolution.message,
			suggestion: r.resolution.at
				? suggest(r.resolution.at, r.resolution.available ?? [])
				: undefined
		}

	const field = r.resolution.field ?? asVarField(r.base)
	if (!field) return { path: found.text, ...(declarer ? { declarer } : {}) }
	return {
		path: found.text,
		type: field.type,
		description: text(field.description),
		optional: field.optional,
		...(declarer ? { declarer } : {})
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
			if (HANDLEBARS_HELPER_DOCS[raw]) return null
			return { text: raw, start: tStart, end: tEnd }
		}
		return null
	}
	return null
}

/**
 * The nearest name, when there is an obviously-nearest one — the SDK's
 * `nearestName`, the same "did you mean" the template checker's findings carry.
 */
export const suggest = nearestName

/* ------------------------------------------------------------------ */
/* Liquid                                                               */
/* ------------------------------------------------------------------ */

interface LiquidTagSnippet {
	name: string
	detail: string
	/** The text after the name, `‸` marking the caret. */
	rest: string
	/** Closes with `{% end<name> %}`. */
	block?: boolean
}

const LIQUID_TAGS: LiquidTagSnippet[] = [
	{ name: "if", detail: "if condition", rest: " ‸ %}\n\n", block: true },
	{ name: "unless", detail: "unless condition", rest: " ‸ %}\n\n", block: true },
	{ name: "elsif", detail: "elsif condition", rest: " ‸ %}" },
	{ name: "else", detail: "else", rest: " %}‸" },
	{ name: "for", detail: "for item in list", rest: " item in ‸ %}\n\n", block: true },
	{ name: "case", detail: "case value", rest: " ‸ %}\n{% when  %}\n\n", block: true },
	{ name: "when", detail: "when value", rest: " ‸ %}" },
	{ name: "assign", detail: "assign name = value", rest: " ‸ = %}" },
	{ name: "capture", detail: "capture name", rest: " ‸ %}\n\n", block: true },
	{ name: "comment", detail: "comment", rest: " %}‸\n", block: true },
	{ name: "raw", detail: "raw", rest: " %}‸\n", block: true },
	{ name: "echo", detail: "echo value", rest: " ‸ %}" },
	{ name: "increment", detail: "increment name", rest: " ‸ %}" },
	{ name: "decrement", detail: "decrement name", rest: " ‸ %}" },
	{ name: "cycle", detail: "cycle a, b", rest: " ‸ %}" },
	{ name: "break", detail: "break", rest: " %}‸" },
	{ name: "continue", detail: "continue", rest: " %}‸" },
	...CONTEXT_LIQUID_BLOCK_TAGS.map((name) => ({
		name,
		detail: `${name} … end${name}`,
		rest: " %}\n‸\n",
		block: true
	}))
].filter((t) => !(t.name in CONTEXT_LIQUID_REFUSED_TAGS))

/** Liquid's filters: core's (`CONTEXT_LIQUID_FILTERS`) and the standard set. */
export const LIQUID_FILTER_DOCS: Readonly<Record<string, string>> = {
	pad: "pad: width — a number, zero-padded",
	json: "json: indent — the value as JSON",
	jsonValue: "jsonValue: offset — one value as JSON, indented as if nested",
	abs: "abs",
	append: "append: text",
	capitalize: "capitalize",
	ceil: "ceil",
	compact: "compact",
	concat: "concat: list",
	date: "date: format",
	default: "default: fallback",
	divided_by: "divided_by: n",
	downcase: "downcase",
	escape: "escape",
	first: "first",
	floor: "floor",
	join: "join: separator",
	last: "last",
	lstrip: "lstrip",
	map: "map: field",
	minus: "minus: n",
	modulo: "modulo: n",
	newline_to_br: "newline_to_br",
	plus: "plus: n",
	prepend: "prepend: text",
	remove: "remove: text",
	replace: "replace: from, to",
	reverse: "reverse",
	round: "round: digits",
	rstrip: "rstrip",
	size: "size",
	slice: "slice: start, length",
	sort: "sort: field",
	sort_natural: "sort_natural: field",
	split: "split: separator",
	strip: "strip",
	strip_html: "strip_html",
	strip_newlines: "strip_newlines",
	times: "times: n",
	truncate: "truncate: length",
	truncatewords: "truncatewords: count",
	uniq: "uniq",
	upcase: "upcase",
	url_encode: "url_encode",
	where: "where: field, value"
}

const LIQUID_BLOCKS = new Set([
	"if",
	"unless",
	"for",
	"case",
	"capture",
	"comment",
	"raw",
	"tablerow",
	...CONTEXT_LIQUID_BLOCK_TAGS
])

const LIQUID_TAG = /\{%-?\s*([\s\S]*?)\s*-?%\}/g

/** Liquid's open blocks and loop variables before `offset`. */
function liquidScan(
	source: string,
	offset: number,
	scope: TemplateScope
): { blocks: string[]; loops: Map<string, VarField | undefined> } {
	const blocks: string[] = []
	const loopStack: { name: string; item: VarField | undefined }[] = []
	for (const m of source.matchAll(LIQUID_TAG)) {
		if (m.index! + m[0].length > offset) break
		const body = m[1]!.trim()
		const name = /^(\w+)/.exec(body)?.[1]
		if (!name) continue
		if (name.startsWith("end")) {
			const open = name.slice(3)
			const at = blocks.lastIndexOf(open)
			if (at !== -1) blocks.splice(at)
			if (open === "for") loopStack.pop()
			continue
		}
		if (!LIQUID_BLOCKS.has(name)) continue
		blocks.push(name)
		if (name === "for") {
			const f = /^for\s+(\w+)\s+in\s+(\S+)/.exec(body)
			const written = f ? parseLiquidPath(f[2]!) : undefined
			const list = written
				? liquidResolve(
						written.partial ? [...written.segments, written.partial] : written.segments,
						scope,
						loopsOf(loopStack)
					)
				: undefined
			loopStack.push({
				name: f?.[1] ?? "",
				item: list?.type === "list" || list?.type === "record" ? list.of : undefined
			})
		}
	}
	return { blocks, loops: loopsOf(loopStack) }
}

function loopsOf(
	stack: readonly { name: string; item: VarField | undefined }[]
): Map<string, VarField | undefined> {
	const loops = new Map<string, VarField | undefined>()
	for (const l of stack) if (l.name) loops.set(l.name, l.item)
	if (stack.length) loops.set("forloop", FORLOOP)
	return loops
}

const FORLOOP: VarField = {
	type: "object",
	description: "The loop's position.",
	fields: {
		index: { type: "number", description: "From 1." },
		index0: { type: "number", description: "From 0." },
		first: { type: "boolean" },
		last: { type: "boolean" },
		length: { type: "number" },
		rindex: { type: "number" },
		rindex0: { type: "number" }
	}
}

/**
 * `a.b["c.d"].e` → segments, plus the partial being typed. `inBracket` is set
 * when the caret sits inside an unclosed `["…`.
 */
function parseLiquidPath(token: string): {
	segments: string[]
	partial: string
	partialStart: number
	inBracket: false | string
} {
	const segments: string[] = []
	let cur = ""
	let curStart = 0
	let i = 0
	while (i < token.length) {
		const c = token[i]!
		if (c === ".") {
			if (cur) segments.push(cur)
			cur = ""
			curStart = i + 1
			i++
			continue
		}
		if (c === "[") {
			if (cur) segments.push(cur)
			cur = ""
			const q = token[i + 1]
			const quoted = q === '"' || q === "'"
			const from = i + (quoted ? 2 : 1)
			const close = token.indexOf(quoted ? `${q}]` : "]", from)
			if (close === -1)
				return {
					segments,
					partial: token.slice(from),
					partialStart: from,
					inBracket: quoted ? q! : "]"
				}
			segments.push(token.slice(from, close))
			i = close + (quoted ? 2 : 1)
			curStart = i
			continue
		}
		cur += c
		i++
	}
	return { segments, partial: cur, partialStart: curStart, inBracket: false }
}

function liquidResolve(
	segments: string[],
	scope: TemplateScope,
	loops: Map<string, VarField | undefined>
): VarField | undefined {
	const [first, ...tail] = segments
	if (first === undefined) return undefined
	let f: VarField | undefined = loops.has(first)
		? loops.get(first)
		: asVarField(scope[first] as VarDecl | undefined)
	for (const seg of tail) {
		if (!f) return undefined
		if (f.type === "object") f = f.fields?.[seg]
		else if (f.type === "record") f = f.of
		else if (f.type === "list")
			f =
				seg === "size"
					? { type: "number" }
					: seg === "first" || seg === "last" || /^\d+$/.test(seg)
						? f.of
						: undefined
		else return undefined
	}
	return f
}

/** The Liquid `{{ … }}` / `{% … %}` the caret is inside. */
function openLiquidTagAt(
	source: string,
	offset: number
): { kind: "output" | "tag"; contentStart: number; inner: string } | null {
	const before = source.slice(0, offset)
	const out = before.lastIndexOf("{{")
	const tag = before.lastIndexOf("{%")
	const open = Math.max(out, tag)
	if (open === -1) return null
	const kind = open === tag ? "tag" : "output"
	const close = kind === "tag" ? "%}" : "}}"
	if (before.indexOf(close, open) !== -1) return null
	const contentStart = open + 2 + (before[open + 2] === "-" ? 1 : 0)
	return { kind, contentStart, inner: before.slice(contentStart) }
}

/** The index of the last `|` outside quotes and brackets, or -1. */
function lastPipe(s: string): number {
	let quote = ""
	let depth = 0
	let at = -1
	for (let i = 0; i < s.length; i++) {
		const c = s[i]!
		if (quote) {
			if (c === quote) quote = ""
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === "[") depth++
		else if (c === "]") depth = Math.max(0, depth - 1)
		else if (c === "|" && depth === 0) at = i
	}
	return at
}

/** The path token the caret is at the end of, brackets and quotes included. */
function liquidTokenAtEnd(inner: string): { token: string; start: number } {
	let depth = 0
	let i = inner.length
	while (i > 0) {
		const c = inner[i - 1]!
		if (c === "]") depth++
		else if (c === "[") {
			if (depth === 0) {
				// An unclosed bracket being typed: keep walking back.
				i--
				continue
			}
			depth--
		} else if (depth === 0 && !/[\w.\-"']/.test(c)) break
		i--
	}
	// An unclosed `["…` leaves quotes inside; a bare word never starts with one.
	return { token: inner.slice(i), start: i }
}

function liquidCompletionsAt(
	source: string,
	offset: number,
	scope: TemplateScope,
	options: AssistOptions
): Completion[] {
	const tag = openLiquidTagAt(source, offset)
	if (!tag) return []
	const { inner, contentStart } = tag
	const after = source.slice(offset)
	const { blocks, loops } = liquidScan(source, contentStart - 2, scope)

	// Filters after `|`.
	const pipe = lastPipe(inner)
	if (pipe !== -1) {
		const m = /^\s*([\w]*)$/.exec(inner.slice(pipe + 1))
		if (m) {
			const typed = m[1]!
			const start = contentStart + inner.length - typed.length
			return rank(
				Object.entries(LIQUID_FILTER_DOCS).map(([name, detail]) => ({
					label: name,
					insert: name,
					kind: "filter" as const,
					detail,
					group: "helper" as const,
					start,
					end: offset
				})),
				typed
			)
		}
	}

	// The tag name after `{%`.
	if (tag.kind === "tag") {
		const m = /^\s*(\w*)$/.exec(inner)
		if (m) {
			const typed = m[1]!
			const start = contentStart + inner.length - typed.length
			const end = offset + (/^\s*-?%\}/.exec(after)?.[0].length ?? 0)
			const top = blocks[blocks.length - 1]
			const ends: Completion[] = top
				? [
						{
							label: `end${top}`,
							insert: `end${top} %}`,
							kind: "tag",
							detail: `closes {% ${top} %}`,
							group: "local",
							start,
							end
						}
					]
				: []
			const tags = LIQUID_TAGS.map((t) => {
				const body = t.rest.replace("‸", "")
				const caret = t.name.length + t.rest.indexOf("‸")
				const insert = `${t.name}${body}${t.block ? `{% end${t.name} %}` : ""}`
				return {
					label: t.name,
					insert,
					kind: "tag" as const,
					detail: t.detail,
					group: "helper" as const,
					select: { start: caret, end: caret },
					start,
					end
				}
			})
			return [...rank(ends, typed), ...rank(tags, typed)]
		}
	}

	// An object path.
	const { token, start: tokenStart } = liquidTokenAtEnd(inner)
	if (/^\d/.test(token) || token.startsWith('"') || token.startsWith("'"))
		return []
	const parsed = parseLiquidPath(token)
	const partialAbs = contentStart + tokenStart + parsed.partialStart
	let candidates: Candidate[]
	if (!parsed.segments.length && !parsed.inBracket) {
		const locals: Candidate[] = [...loops].map(([name, f]) => ({
			label: name,
			insert: name,
			kind: "variable" as const,
			type: f?.type,
			description: text(f?.description),
			group: "local" as const
		}))
		candidates = [
			...locals,
			...rootCandidates(scope, options, () => false, (n) => n)
		]
	} else {
		const field = liquidResolve(parsed.segments, scope, loops)
		if (!field) return []
		candidates = fieldCandidates(
			field,
			parsed.segments[parsed.segments.length - 1] ?? "",
			() => false,
			(n) => n,
			[
				{ label: "size", insert: "size", kind: "field", type: "number" },
				{ label: "first", insert: "first", kind: "field", type: field.of?.type },
				{ label: "last", insert: "last", kind: "field", type: field.of?.type }
			]
		)
	}

	const items: Completion[] = candidates.map((c) => {
		if (parsed.inBracket) {
			const close = parsed.inBracket === "]" ? "]" : `${parsed.inBracket}]`
			return { ...c, insert: `${c.insert}${close}`, start: partialAbs, end: offset }
		}
		if (c.kind !== "placeholder" && liquidNeedsBrackets(c.label) && parsed.segments.length) {
			// `annex.show` → `annex["showcase.twenty-questions"]`: the dot goes.
			return { ...c, insert: `["${c.label}"]`, start: partialAbs - 1, end: offset }
		}
		return { ...c, start: partialAbs, end: offset }
	})
	return rank(items, parsed.partial)
}

function describeLiquidAt(
	source: string,
	offset: number,
	scope: TemplateScope,
	options: AssistOptions
): Hover | null {
	const re = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g
	for (const m of source.matchAll(re)) {
		const start = m.index!
		if (offset < start || offset > start + m[0].length) continue
		const bodyStart = start + 2 + (m[0][2] === "-" ? 1 : 0)
		// Extend the word under the caret both ways over path characters.
		const isPath = (c: string | undefined) => !!c && /[\w.\-"'[\]]/.test(c)
		let a = offset
		let b = offset
		while (a > bodyStart && isPath(source[a - 1])) a--
		while (b < source.length && isPath(source[b])) b++
		const written = source.slice(a, b)
		if (!written || /^["'\d]/.test(written)) return null
		const { segments, partial } = parseLiquidPath(written)
		const all = partial ? [...segments, partial] : segments
		if (!all.length || LIQUID_FILTER_DOCS[all[0]!]) return null
		const { loops } = liquidScan(source, start, scope)
		const root = all[0]!
		if (!loops.has(root) && scope[root] === undefined)
			return {
				path: written,
				problem: `"${root}" isn't a recognized field at this scope.`,
				suggestion: suggest(root, Object.keys(scope))
			}
		const declarer = loops.has(root) ? undefined : options.declarers?.[root]?.label
		const field = liquidResolve(all, scope, loops)
		if (!field) return { path: written, ...(declarer ? { declarer } : {}) }
		return {
			path: written,
			type: field.type,
			description: text(field.description),
			optional: field.optional,
			...(declarer ? { declarer } : {})
		}
	}
	return null
}

/* ------------------------------------------------------------------ */
/* The variables tree                                                   */
/* ------------------------------------------------------------------ */

export interface ScopeTreeNode {
	/** Unique within the tree — the path, plus a marker for list elements. */
	id: string
	label: string
	/** What clicking inserts. For a list's element fields: relative to `this`. */
	path: string
	type?: VarType
	description?: string
	optional?: boolean
	declarer?: string
	/** A list's element fields are read inside `{{#each <list>}}`. */
	insideEach?: string
	children?: ScopeTreeNode[]
}

const TREE_DEPTH = 6

/**
 * The scope as a tree, for "Variables available here". Pure, so the tree the
 * panel shows and the completions the editor offers read one schema one way.
 */
export function scopeTreeNodes(
	scope: TemplateScope,
	options: AssistOptions = {}
): ScopeTreeNode[] {
	const liquid = options.engine === LIQUID_ENGINE
	const join = (base: string, name: string) =>
		liquid
			? liquidNeedsBrackets(name)
				? `${base}["${name}"]`
				: base
					? `${base}.${name}`
					: name
			: base
				? `${base}.${needsBrackets(name) ? `[${name}]` : name}`
				: needsBrackets(name)
					? `[${name}]`
					: name

	const walk = (
		field: VarField | undefined,
		base: string,
		name: string,
		depth: number,
		idBase: string
	): ScopeTreeNode[] | undefined => {
		if (!field || depth >= TREE_DEPTH) return undefined
		if (field.type === "object" && field.fields)
			return Object.entries(field.fields).map(([k, f]) => node(k, f, join(base, k), depth + 1, `${idBase}.${k}`))
		if (field.type === "record") {
			const word = placeholderFor(name)
			const p = join(base, word)
			return [
				{
					...node(`‹${word}›`, field.of, p, depth + 1, `${idBase}.‹${word}›`),
					description: `Any key — the names are the data's own.${text(field.of?.description) ? ` ${text(field.of?.description)}` : ""}`
				}
			]
		}
		if (field.type === "list" && field.of?.type === "object") {
			const each = liquid ? `for item in ${base}` : `#each ${base}`
			return Object.entries(field.of.fields ?? {}).map(([k, f]) => ({
				...node(k, f, liquid ? join("item", k) : join("", k), depth + 1, `${idBase}[].${k}`),
				insideEach: each
			}))
		}
		return undefined
	}

	const node = (
		label: string,
		field: VarField | undefined,
		path: string,
		depth: number,
		id: string
	): ScopeTreeNode => {
		const children = walk(field, path, label.replace(/[‹›]/g, ""), depth, id)
		return {
			id,
			label,
			path,
			type: field?.type,
			description: text(field?.description),
			optional: field?.optional,
			...(children?.length ? { children } : {})
		}
	}

	return Object.entries(scope).map(([name, decl]) => {
		const field = asVarField(decl)
		const declarer = options.declarers?.[name]?.label
		return {
			...node(name, field, join("", name), 0, name),
			...(declarer ? { declarer } : {})
		}
	})
}
