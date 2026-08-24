import Handlebars from "handlebars"
// The variable registry is the vocabulary. Importing the SDK registers core's
// declarations as a side effect of module load, which is the same route every
// other consumer takes — there is no separate "load the variables" step to
// forget.
import { allVariables, elementOf, resolvePath } from "@serene-pub/sdk"
import type { TemplateScope, VarDecl, VarField } from "@serene-pub/sdk"
import { suggest, templateTokens } from "$lib/shared/utils/templateAssist"

// Parses a context config template's raw text (the source of truth) into a
// generic tree of cards that mirrors the template's actual Handlebars AST
// structure — no fixed/hardcoded list of "known" section names. Any block
// helper ({{#if}}/{{#each}}/{{#with}}/{{#unless}}/{{#systemBlock}}/any custom
// helper) becomes a card exposing its tag and holding its body as children;
// any variable reference standing alone on its own line becomes its own leaf
// card; any run of prose (optionally with inline variables sharing a line,
// e.g. "{{{name}}}: {{{message}}}") becomes one text card. Every mutation
// (update/remove/reorder/insert) works by splicing the original template
// string at AST-derived source offsets — never rebuilding from a mutated
// AST (Handlebars has no public AST→source serializer).

export type CardKind = "block" | "variable" | "text"

export interface BaseCard {
	id: string
	kind: CardKind
	start: number
	end: number
}

export interface BlockCard extends BaseCard {
	kind: "block"
	/** e.g. "if" | "each" | "with" | "unless" | "systemBlock" | any custom helper name. */
	helperName: string
	/** True for systemBlock/userBlock/assistantBlock — always-zero-param role wrappers. */
	isRoleWrapper: boolean
	/**
	 * Raw source text of the tag's params/hash/block-params, sliced verbatim
	 * from the original open-tag source (e.g. "(and (eq msgIndex targetIndex) hasContent)"
	 * or "sessionMessages as |sessionMessage msgIndex|") — never reconstructed from
	 * AST param nodes, so nothing about it needs re-printing.
	 */
	tagSource: string
	/** Source range of the block's own body (between the open and close tags). */
	bodyStart: number
	bodyEnd: number
	children: Card[]
	hasElse: boolean
	elseBodyStart?: number
	elseBodyEnd?: number
	elseChildren?: Card[]
}

export interface VariableCard extends BaseCard {
	kind: "variable"
	/** Raw text between the stashes, e.g. "worldLore" or "../postHistory.instructions". */
	expressionSource: string
	/** true = {{x}} (HTML-escaped), false = {{{x}}} (raw). */
	escaped: boolean
}

export interface TextCard extends BaseCard {
	kind: "text"
	/** Raw source text, verbatim — may contain inline {{mustaches}}. */
	content: string
}

export type Card = BlockCard | VariableCard | TextCard

export interface ParsedContextTemplate {
	cards: Card[]
	parseError: string | null
}

const ROLE_WRAPPER_HELPERS = new Set([
	"systemBlock",
	"userBlock",
	"assistantBlock"
])

/**
 * Deterministic (FNV-1a) string hash — not cryptographic, just needs to be
 * stable and cheap so a card's derived `id` doesn't change when its position
 * in the template does (reordering must not change identity). Collisions
 * only matter between two cards with byte-identical source text, which
 * makeId's dup-counter suffix disambiguates.
 */
function fingerprint(text: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(36)
}

function buildLineOffsets(text: string): number[] {
	const offsets = [0]
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") offsets.push(i + 1)
	}
	return offsets
}

function isWhitespace(s: string): boolean {
	return /^\s*$/.test(s)
}

/** Splits an accumulated text run into blank-line-separated paragraphs, each
 * keeping its own absolute source offsets — a single run of non-blank lines
 * (no blank line inside) stays one card; a blank line (2+ newlines) splits
 * into separate cards, mirroring how block-card gaps already work. */
function splitTextRun(
	raw: string,
	base: number
): Array<{ text: string; start: number; end: number }> {
	const parts: Array<{ text: string; start: number; end: number }> = []
	const boundary = /\n[ \t]*\n+/g
	let segStart = 0
	let m: RegExpExecArray | null
	while ((m = boundary.exec(raw)) !== null) {
		const text = raw.slice(segStart, m.index)
		if (text.trim().length > 0) {
			parts.push({ text, start: base + segStart, end: base + m.index })
		}
		segStart = boundary.lastIndex
	}
	const tail = raw.slice(segStart)
	if (tail.trim().length > 0) {
		parts.push({
			text: tail,
			start: base + segStart,
			end: base + raw.length
		})
	}
	return parts
}

export function parseContextTemplate(template: string): ParsedContextTemplate {
	const result: ParsedContextTemplate = { cards: [], parseError: null }

	let ast: any
	try {
		ast = Handlebars.parse(template)
	} catch (err: any) {
		result.parseError = err?.message || "Failed to parse template"
		return result
	}

	const lineOffsets = buildLineOffsets(template)
	const offsetOf = (pos: { line: number; column: number }) =>
		lineOffsets[pos.line - 1] + pos.column

	/** Slices the raw open-tag text (from the tag's `{{` to its own `}}`) and
	 * pulls out everything after the helper name as `tagSource` — reusing the
	 * ORIGINAL source text rather than reconstructing it from AST param
	 * nodes, so block-params (`as |a b|`) and hash args come along for free. */
	const extractTagSource = (openStart: number): string => {
		const closeIdx = template.indexOf("}}", openStart)
		const raw = template.slice(openStart, closeIdx + 2)
		const m = /^\{\{~?#\s*[^\s}]+([\s\S]*?)~?\}\}$/.exec(raw)
		return m ? m[1].trim() : ""
	}

	const walkProgram = (program: any): Card[] => {
		const cards: Card[] = []
		let textStart: number | null = null
		let textEnd: number | null = null

		// Scoped to THIS call (one parent's own direct children), not shared
		// across the whole tree — so two identical-content cards colliding
		// only ever affects disambiguation among their own true siblings.
		// Inserting/removing an identical-content card anywhere ELSE in the
		// tree (a different parent, or not a sibling of these two at all)
		// can't perturb a suffix number here. A truly global counter would
		// mean an edit far away, under an unrelated parent, could flip which
		// of two unrelated identical-content cards gets ":1" — this narrows
		// that blast radius to only matter when it's the same set of
		// siblings under the same parent that changed.
		const seenKeys = new Map<string, number>()
		const makeId = (rawText: string): string => {
			const base = fingerprint(rawText)
			const dup = seenKeys.get(base) ?? 0
			seenKeys.set(base, dup + 1)
			return dup === 0 ? base : `${base}:${dup}`
		}

		const flushText = () => {
			if (textStart === null || textEnd === null) return
			const raw = template.slice(textStart, textEnd)
			for (const p of splitTextRun(raw, textStart)) {
				// Trim exactly one leading/trailing newline for display/editing
				// (matches the surrounding block's own open/close-tag newlines,
				// which read as structural, not part of the prose) — start/end
				// stay untrimmed so a splice against them still removes the
				// full original range; updateTextCard re-adds whichever of
				// these were present so a save doesn't collapse the block onto
				// one line.
				cards.push({
					id: makeId(p.text),
					kind: "text",
					start: p.start,
					end: p.end,
					content: p.text.replace(/^\n/, "").replace(/\n$/, "")
				})
			}
			textStart = null
			textEnd = null
		}
		const appendToText = (start: number, end: number) => {
			if (textStart === null) textStart = start
			textEnd = end
		}

		const body = program.body
		for (const stmt of body) {
			const start = offsetOf(stmt.loc.start)
			const end = offsetOf(stmt.loc.end)

			if (
				stmt.type === "ContentStatement" ||
				stmt.type === "CommentStatement"
			) {
				appendToText(start, end)
				continue
			}

			if (stmt.type === "MustacheStatement") {
				// Standalone (alone on its own line) vs inline (shares a line
				// with other text/mustaches, e.g. "{{{name}}}: {{{message}}}")
				// — checked against raw source text on that line, not AST
				// siblings, so it's correct regardless of what produced the
				// surrounding text.
				const lineStart = template.lastIndexOf("\n", start - 1) + 1
				const nlIdx = template.indexOf("\n", end)
				const lineEnd = nlIdx === -1 ? template.length : nlIdx
				const before = template.slice(lineStart, start)
				const after = template.slice(end, lineEnd)
				if (isWhitespace(before) && isWhitespace(after)) {
					flushText()
					const raw = template.slice(start, end)
					const escaped = stmt.escaped
					const expressionSource = escaped
						? raw.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "")
						: raw
								.replace(/^\{\{\{\s*/, "")
								.replace(/\s*\}\}\}$/, "")
					cards.push({
						id: makeId(raw),
						kind: "variable",
						start,
						end,
						expressionSource,
						escaped
					})
				} else {
					appendToText(start, end)
				}
				continue
			}

			if (stmt.type === "BlockStatement") {
				flushText()
				const helperName: string = stmt.path?.original ?? ""
				const tagSource = extractTagSource(start)
				const bodyStart = offsetOf(stmt.program.loc.start)
				const bodyEnd = offsetOf(stmt.program.loc.end)
				const children = walkProgram(stmt.program)

				let elseBodyStart: number | undefined
				let elseBodyEnd: number | undefined
				let elseChildren: Card[] | undefined
				if (stmt.inverse) {
					elseBodyStart = offsetOf(stmt.inverse.loc.start)
					elseBodyEnd = offsetOf(stmt.inverse.loc.end)
					elseChildren = walkProgram(stmt.inverse)
				}

				const raw = template.slice(start, end)
				cards.push({
					id: makeId(raw),
					kind: "block",
					start,
					end,
					helperName,
					isRoleWrapper: ROLE_WRAPPER_HELPERS.has(helperName),
					tagSource,
					bodyStart,
					bodyEnd,
					children,
					hasElse: !!stmt.inverse,
					elseBodyStart,
					elseBodyEnd,
					elseChildren
				})
				continue
			}
			// PartialStatement/DecoratorBlock/etc. aren't used by this app's
			// templates — silently skipped (never produced by defaults.ts, and
			// a user-authored one would just not appear as its own card,
			// same "invisible unless you use Raw" fallback as everything used
			// to have before this rewrite, now limited to a much narrower set
			// of genuinely exotic constructs instead of ordinary blocks).
		}
		flushText()
		return cards
	}

	result.cards = walkProgram(ast)
	return result
}

// ─── Insertable "starter" snippets ──────────────────────────────────────────
// The one place a short fixed list still exists — not "what can exist" (the
// parser above represents anything), just "what am I offered when I click
// Add Card." Inserted content is immediately editable via the mutation
// functions below, same as every other card.

export type InsertableKind =
	| {
			kind: "block"
			helperName: string
			tagSource: string
			bodyPlaceholder?: string
	  }
	| { kind: "variable"; expressionSource: string; escaped: boolean }
	| { kind: "text"; content: string }

export interface InsertableCardOption {
	id: string
	label: string
	description: string
	spec: InsertableKind
}

export const INSERTABLE_CARD_OPTIONS: InsertableCardOption[] = [
	{
		id: "if",
		label: "If",
		description: "Shows its contents only when a condition is true.",
		spec: { kind: "block", helperName: "if", tagSource: "trigger" }
	},
	{
		id: "unless",
		label: "Unless",
		description: "Shows its contents only when a condition is false.",
		spec: { kind: "block", helperName: "unless", tagSource: "trigger" }
	},
	{
		id: "each",
		label: "Each (loop)",
		description: "Repeats its contents once per item in a list.",
		spec: { kind: "block", helperName: "each", tagSource: "items" }
	},
	{
		id: "with",
		label: "With",
		description: "Changes the current scope to a nested value.",
		spec: { kind: "block", helperName: "with", tagSource: "value" }
	},
	{
		id: "systemBlock",
		label: "System Message",
		description: "Wraps its contents as a system-role block.",
		spec: { kind: "block", helperName: "systemBlock", tagSource: "" }
	},
	{
		id: "userBlock",
		label: "User Message",
		description: "Wraps its contents as a user-role block.",
		spec: { kind: "block", helperName: "userBlock", tagSource: "" }
	},
	{
		id: "assistantBlock",
		label: "Assistant Message",
		description: "Wraps its contents as an assistant-role block.",
		spec: { kind: "block", helperName: "assistantBlock", tagSource: "" }
	},
	{
		id: "variable",
		label: "Variable",
		description: "Outputs a single value.",
		spec: { kind: "variable", expressionSource: "value", escaped: false }
	},
	{
		id: "text",
		label: "Text",
		description: "Freeform text you write yourself.",
		spec: { kind: "text", content: "Write anything here." }
	}
]

function snippetFor(spec: InsertableKind): string {
	if (spec.kind === "block") {
		const open = spec.tagSource
			? `{{#${spec.helperName} ${spec.tagSource}}}`
			: `{{#${spec.helperName}}}`
		return `${open}\n${spec.bodyPlaceholder ?? ""}\n{{/${spec.helperName}}}`
	}
	if (spec.kind === "variable") {
		return spec.escaped
			? `{{${spec.expressionSource}}}`
			: `{{{${spec.expressionSource}}}}`
	}
	return spec.content
}

/** Finds the card whose source range contains `pos`, recursing into a block's
 * children/elseChildren first (most specific match wins). Containment rather
 * than an exact `start === pos` match: a text card's range can start earlier
 * than the position we're probing for, since leading whitespace immediately
 * before it gets folded into the same ContentStatement (and thus the same
 * card's range) rather than staying a separate node. */
function findCardContaining(cards: Card[], pos: number): Card | undefined {
	for (const c of cards) {
		if (pos >= c.start && pos < c.end) {
			if (c.kind === "block") {
				return (
					findCardContaining(c.children, pos) ??
					(c.elseChildren
						? findCardContaining(c.elseChildren, pos)
						: undefined) ??
					c
				)
			}
			return c
		}
	}
	return undefined
}

/** Describes where to insert: the parent scope's own body range (used only
 * when it currently has zero children) plus its current sibling list. Pass
 * `{ parentBodyStart: 0, parentBodyEnd: template.length, siblings: parsed.cards }`
 * for the root level, or a block card's own `bodyStart`/`bodyEnd`/`children`
 * (or `elseBodyStart`/`elseBodyEnd`/`elseChildren`) for a nested scope. */
export function insertCard(
	template: string,
	target: {
		parentBodyStart: number
		parentBodyEnd: number
		siblings: Pick<BaseCard, "id" | "start" | "end">[]
	},
	atIndex: number,
	spec: InsertableKind
): { template: string; error?: string; insertedId?: string } {
	const snippet = snippetFor(spec)
	try {
		Handlebars.parse(snippet)
	} catch (err: any) {
		return { template, error: err?.message || "Invalid syntax" }
	}

	const siblings = [...target.siblings].sort((a, b) => a.start - b.start)

	let newTemplate: string
	let snippetStart: number

	if (siblings.length === 0) {
		const insertAt = target.parentBodyStart
		newTemplate =
			template.slice(0, insertAt) +
			"\n" +
			snippet +
			"\n" +
			template.slice(insertAt)
		snippetStart = insertAt + 1
	} else {
		const clamped = Math.max(0, Math.min(atIndex, siblings.length))
		if (clamped >= siblings.length) {
			const insertAt = siblings[siblings.length - 1].end
			newTemplate =
				template.slice(0, insertAt) +
				"\n\n" +
				snippet +
				template.slice(insertAt)
			snippetStart = insertAt + 2
		} else {
			const insertAt = siblings[clamped].start
			newTemplate =
				template.slice(0, insertAt) +
				snippet +
				"\n\n" +
				template.slice(insertAt)
			snippetStart = insertAt
		}
	}

	// Re-parse once to hand back the freshly-inserted card's own stable id —
	// callers use this to force a newly-added card open by default instead
	// of falling in with an ancestor's "collapsed unless freshly created"
	// rule (see ContextSidebar.svelte).
	const reparsed = parseContextTemplate(newTemplate)
	const insertedId = reparsed.parseError
		? undefined
		: findCardContaining(reparsed.cards, snippetStart)?.id

	return { template: newTemplate, insertedId }
}

export function removeCard(
	template: string,
	card: Pick<BaseCard, "start" | "end">
): string {
	let end = card.end
	if (template[end] === "\n") end += 1
	return template.slice(0, card.start) + template.slice(end)
}

export function updateTextCard(
	template: string,
	card: Pick<TextCard, "start" | "end">,
	newContent: string
): string {
	// content is displayed/edited with one leading/trailing newline trimmed
	// (see parseContextTemplate) — re-add whichever were present in the
	// original so saving doesn't collapse the surrounding block onto one line.
	const hadLeading = template[card.start] === "\n"
	const hadTrailing = template[card.end - 1] === "\n"
	const wrapped =
		(hadLeading ? "\n" : "") + newContent + (hadTrailing ? "\n" : "")
	return template.slice(0, card.start) + wrapped + template.slice(card.end)
}

export function updateVariableCard(
	template: string,
	card: Pick<VariableCard, "start" | "end">,
	newExpressionSource: string,
	newEscaped: boolean
): { template: string; error?: string } {
	const snippet = newEscaped
		? `{{${newExpressionSource}}}`
		: `{{{${newExpressionSource}}}}`
	try {
		Handlebars.parse(snippet)
	} catch (err: any) {
		return { template, error: err?.message || "Invalid expression syntax" }
	}
	return {
		template:
			template.slice(0, card.start) + snippet + template.slice(card.end)
	}
}

function extractBlockParamNames(tagSource: string): string[] {
	const m = /\bas\s*\|([^|]*)\|/.exec(tagSource)
	if (!m) return []
	return m[1].trim().split(/\s+/).filter(Boolean)
}

function collectDescendantExpressions(cards: Card[]): string[] {
	const out: string[] = []
	for (const c of cards) {
		if (c.kind === "block") {
			out.push(c.tagSource)
			out.push(...collectDescendantExpressions(c.children))
			if (c.elseChildren) {
				out.push(...collectDescendantExpressions(c.elseChildren))
			}
		} else if (c.kind === "variable") {
			out.push(c.expressionSource)
		} else {
			// Text cards can contain inline {{mustaches}} that reference a
			// block param too (e.g. "{{{sessionMessage.name}}}: {{{msgIndex}}}").
			out.push(c.content)
		}
	}
	return out
}

/**
 * Checks whether editing a block's tag would drop a block-param name
 * (`{{#each x as |a b|}}`'s `a`/`b`) that descendant cards still reference.
 * Handlebars raises no parse error for this — an orphaned reference just
 * silently renders as undefined at compile time, surfacing later in
 * Preview, disconnected from the edit that caused it. Callers should surface
 * the returned names as a confirmation prompt before calling
 * `updateBlockTag` with the same `newTagSource`, not block the edit outright
 * — renaming on purpose (with the intent to also fix up descendants
 * afterward) is still a valid thing to do.
 */
export function findOrphanedBlockParamNames(
	oldTagSource: string,
	newTagSource: string,
	descendants: Card[]
): string[] {
	const oldNames = extractBlockParamNames(oldTagSource)
	const newNames = new Set(extractBlockParamNames(newTagSource))
	const removedNames = oldNames.filter((n) => !newNames.has(n))
	if (removedNames.length === 0) return []

	const haystack = collectDescendantExpressions(descendants).join("\n")
	return removedNames.filter((name) => {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		return new RegExp(`\\b${escaped}\\b`).test(haystack)
	})
}

/** Replaces a block card's open+close tags only — its body (children, and
 * any {{else}} branch) is preserved byte-for-byte, sliced out and reinserted
 * unchanged between the new tags. */
export function updateBlockTag(
	template: string,
	card: Pick<BlockCard, "start" | "end">,
	newHelperName: string,
	newTagSource: string
): { template: string; error?: string } {
	const newOpen = newTagSource
		? `{{#${newHelperName} ${newTagSource}}}`
		: `{{#${newHelperName}}}`
	const newClose = `{{/${newHelperName}}}`
	try {
		Handlebars.parse(`${newOpen}${newClose}`)
	} catch (err: any) {
		return { template, error: err?.message || "Invalid tag syntax" }
	}

	const openTagEnd = template.indexOf("}}", card.start) + 2
	const closeTagStart = template.lastIndexOf("{{/", card.end)
	const body = template.slice(openTagEnd, closeTagStart)

	return {
		template:
			template.slice(0, card.start) +
			newOpen +
			body +
			newClose +
			template.slice(card.end)
	}
}

/** Adds an empty {{else}} branch to a block that doesn't have one yet. */
export function addElseBranch(
	template: string,
	card: Pick<BlockCard, "end">
): string {
	const closeStart = template.lastIndexOf("{{/", card.end)
	return (
		template.slice(0, closeStart) +
		"{{else}}\n\n" +
		template.slice(closeStart)
	)
}

/** Removes a block's {{else}} branch entirely, leaving the main body and close tag intact. */
export function removeElseBranch(
	template: string,
	card: Pick<BlockCard, "elseBodyStart" | "elseBodyEnd">
): string {
	if (card.elseBodyStart === undefined || card.elseBodyEnd === undefined)
		return template
	const elseTagStart = template.lastIndexOf("{{else", card.elseBodyStart)
	return template.slice(0, elseTagStart) + template.slice(card.elseBodyEnd)
}

/**
 * Rebuilds one parent scope's direct children in a new order. `siblingCards`
 * must be exactly the current sibling list at that scope (root `cards`, a
 * block's `children`, or its `elseChildren`); `orderedIds` must contain the
 * same set of `id`s currently present, just reordered.
 */
export function reorderCards(
	template: string,
	siblingCards: Pick<BaseCard, "id" | "start" | "end">[],
	orderedIds: string[]
): string {
	const sorted = [...siblingCards].sort((a, b) => a.start - b.start)
	if (sorted.length !== orderedIds.length || sorted.length === 0)
		return template

	const textById = new Map(
		sorted.map((c) => [c.id, template.slice(c.start, c.end)])
	)
	if (orderedIds.some((id) => !textById.has(id))) return template

	// Each gap (whitespace, or hand-written prose between two cards) "belongs"
	// to the card immediately before it — kept attached to that card, not to
	// a position, so reordering can't relocate text written between two
	// specific cards to sit between a different, unrelated pair just because
	// they end up adjacent.
	const gapAfterId = new Map<string, string>()
	for (let i = 0; i < sorted.length - 1; i++) {
		gapAfterId.set(
			sorted[i].id,
			template.slice(sorted[i].end, sorted[i + 1].start)
		)
	}

	let rebuilt = textById.get(orderedIds[0])!
	const usedGaps = new Set<string>()
	for (let i = 1; i < orderedIds.length; i++) {
		const prevId = orderedIds[i - 1]
		const gap = gapAfterId.get(prevId) ?? "\n\n"
		usedGaps.add(prevId)
		rebuilt += gap + textById.get(orderedIds[i])!
	}
	for (const [id, gap] of gapAfterId) {
		if (!usedGaps.has(id)) rebuilt += gap
	}

	return (
		template.slice(0, sorted[0].start) +
		rebuilt +
		template.slice(sorted[sorted.length - 1].end)
	)
}

// ─── Unrecognized-tag lint ──────────────────────────────────────────────────
// Distinct vocabulary from handlebarsLint.ts (lorebook entry CBS macros) —
// context config templates use real Handlebars block helpers and reference
// TemplateContext's own field names (src/lib/server/utils/promptBuilder/
// types.ts), so this checks against THAT vocabulary instead.

const KNOWN_HELPER_NAMES = new Set([
	"if",
	"unless",
	"each",
	"with",
	"eq",
	"ne",
	"and",
	"or",
	"json",
	"jsonValue",
	"pad",
	"isSet",
	"lookup",
	"systemBlock",
	"userBlock",
	"assistantBlock"
])

/**
 * Only the *structural* names — the ones no variable declares.
 *
 * Everything a node presents comes from the variable registry below. This list
 * used to hold those too, hand-copied from `TemplateContext`, and the header of
 * `contextConfigCards.templateFields.test.ts` records what that cost: adding
 * `speakerRelationships` to the type and not to this list made the editor
 * report "isn't a recognized field at this scope" **against the shipped default
 * template**. Two lists that must agree, with nothing connecting them, and the
 * one that fell behind was the one a user reads.
 *
 * The remainder genuinely belong here. The message loop and the macro scalars
 * are structure rather than presentation — a layout for them would have nothing
 * to lay out — and `characterLore`, `narrativeGraph` and
 * `speakerRelationships` are values no live path renders, kept recognised so a
 * cloned template using one does not start reporting errors just because the
 * default stopped.
 */
const STRUCTURAL_FIELDS = [
	"postHistory",
	// Depth-resolved injections (18 §4a, ruling 2026-08-23): data the
	// template loop renders, computed beside postHistory.targetIndex.
	"injectionsByIndex",
	"sessionMessages",
	"budget",
	"char",
	"character",
	"user",
	"persona",
	"characterLore",
	"narrativeGraph",
	// Retired in 0.6 when the graph split into `relationshipsPerspectives` and
	// `relationshipsKnown`. Kept recognised on the same rule as the two above:
	// somebody who cloned the shipped template before the split should not have
	// their editor light up red. It renders empty now, which they will see —
	// a lint error would tell them their template is malformed, which it is
	// not, and send them looking for a typo.
	"speakerRelationships"
]

/**
 * The vocabulary, read from the declarations rather than restated.
 *
 * Anything reached through `{{#each}}`/`{{#with}}` shifts scope and cannot be
 * validated without knowing that helper's target shape, which this lint
 * deliberately does not attempt (see `lintContextTemplate`) — so this is
 * top-level names only.
 *
 * Computed once at module load: `allVariables()` is a fact about the running
 * build, and a plugin registering one before this module is imported is the
 * normal case rather than a race — extension load happens at boot, and this
 * file is reached when an editor opens.
 */
const KNOWN_TOP_LEVEL_FIELDS = new Set([
	...STRUCTURAL_FIELDS,
	...allVariables().flatMap((v) => Object.keys(v.scope))
])

export interface TemplateLintIssue {
	cardId: string
	start: number
	end: number
	message: string
}

/** Extracts the leading field/path a block's tagSource refers to, when it's
 * unambiguous — a bare path, or a `some.field as |a b|` each-loop target.
 * Returns null for anything else (a subexpression condition like
 * `(and ...)`, or multi-arg tagSource this lint isn't confident reading). */
function fieldNameFromTagSource(tagSource: string): string | null {
	const trimmed = tagSource.trim()
	if (!trimmed || trimmed.startsWith("(")) return null
	const asIdx = trimmed.indexOf(" as |")
	if (asIdx !== -1) return trimmed.slice(0, asIdx).trim()
	if (/\s/.test(trimmed)) return null
	return trimmed
}

/** `characters as |c i|` → `["c", "i"]`. */
function blockParamsFromTagSource(tagSource: string): string[] {
	const m = /\bas\s*\|([^|]*)\|/.exec(tagSource)
	if (!m) return []
	return m[1]!.trim().split(/\s+/).filter(Boolean)
}

function isCheckableField(field: string): boolean {
	return !field.startsWith("@")
}

/**
 * The path-like arguments of an inline expression.
 *
 * `{{{json characters 2}}}` is what every shipped layout actually looks like,
 * so a lint that skipped any expression containing a space — which is what
 * skipping on `/\s/` amounted to — checked none of them. `2` is a literal and
 * `json` is the helper; `characters` is the one thing here that can be wrong,
 * and getting it wrong renders an empty block with no error anywhere.
 *
 * Anything with a subexpression is left alone entirely. Reading those needs
 * the real parser, and guessing at them is how a lint starts flagging working
 * templates.
 */
function pathArgs(expressionSource: string): string[] {
	const src = expressionSource.trim()
	if (!src || src.includes("(")) return []
	// Bracket-aware: `jsonValue this.[extra lore] 4` is three tokens, not four.
	const tokens = templateTokens(src).map((t) => t.text)
	// A lone token is the reference itself, not a helper call.
	const args = tokens.length === 1 ? tokens : tokens.slice(1)
	return args.filter(
		(t) =>
			!/^-?[\d.]/.test(t) &&
			!/^["']/.test(t) &&
			!t.includes("=") &&
			!["true", "false", "null", "undefined", "this", "."].includes(t)
	)
}

export interface TemplateLintIssue {
	cardId: string
	start: number
	end: number
	message: string
}

/**
 * One Handlebars context, and the names visible in it.
 *
 * `context: undefined` with no parent is the root, where a name resolves
 * against the declared scope. Inside an `{{#each}}` or `{{#with}}` the context
 * is whatever that helper narrowed to, which is the thing the old lint had no
 * way to represent — so it gave up at the first one and checked nothing
 * deeper.
 */
interface Frame {
	context?: VarField
	/** True when the context is real but unknowable — stop checking, quietly. */
	unchecked: boolean
	params: Map<string, VarField | undefined>
	parent?: Frame
}

/**
 * Resolve one reference within a frame, and say what is wrong with it.
 *
 * Returns `null` when there is nothing to report — which covers both "this is
 * correct" and "this cannot be checked", deliberately. The two are different
 * to the implementation and identical to the author.
 */
function checkRef(
	expr: string,
	frame: Frame,
	scope: TemplateScope
): string | null {
	let rest = expr.trim()
	if (!rest || !isCheckableField(rest)) return null

	// `../` walks out one context per step, and off the top means we no longer
	// know what we are looking at.
	let f: Frame = frame
	while (rest.startsWith("../")) {
		rest = rest.slice(3)
		if (!f.parent) return null
		f = f.parent
	}
	if (!rest || rest === "." || rest === "this") return null
	if (!isCheckableField(rest)) return null

	let parts = splitPath(rest)
	if (!parts.length) return null

	// `{{this.name}}` and `{{name}}` mean the same thing inside a context.
	if (parts[0] === "this") parts = parts.slice(1)
	if (!parts.length) return null

	const isRoot = !f.context && !f.parent

	// A block param shadows everything, including the context.
	if (f.params.has(parts[0]!)) {
		const bound = f.params.get(parts[0]!)
		if (!bound) return null
		return report(resolvePath(bound, parts.slice(1), parts[0]!))
	}

	if (isRoot) {
		const decl = scope[parts[0]!]
		if (decl === undefined)
			return (
				`"${parts[0]}" isn't a recognized field at this scope.` +
				didYouMean(parts[0]!, Object.keys(scope))
			)
		return report(resolvePath(decl, parts.slice(1), parts[0]!))
	}

	if (f.unchecked || !f.context) return null
	return report(resolvePath(f.context, parts, "this"))
}

/**
 * `this.[extra lore].note` → `["this", "extra lore", "note"]`.
 *
 * Splitting on `.` alone is right until a segment literal contains one, and
 * unwrapping the brackets is what lets the resolved name match the schema's
 * key — the schema knows `extra lore`, not `[extra lore]`.
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

function report(r: ReturnType<typeof resolvePath>): string | null {
	if (r.ok) return null
	const base = r.message ?? "that path does not exist."
	return base + didYouMean(r.at, r.available)
}

/**
 * The half of a lint finding that turns "this is wrong" into "here is the fix".
 *
 * Only ever appended when the nearest name is near enough to be almost
 * certainly right — see `suggest`. A confident wrong guess sends someone to
 * change a line that was correct.
 */
function didYouMean(
	typed: string | undefined,
	available: readonly string[] | undefined
): string {
	if (!typed || !available?.length) return ""
	const near = suggest(typed, available)
	return near ? ` Did you mean "${near}"?` : ""
}

/**
 * Flags unrecognized helper names and field references that the declared
 * shapes contradict.
 *
 * Helper names are checked at every nesting depth — a helper's identity never
 * depends on scope. Field references used to be checked only in scopes the
 * lint could "fully resolve", which meant it stopped dead at the first
 * `{{#each}}`: the names inside were unresolvable because nothing said what
 * one element of a collection looked like. The schema says, so the walk now
 * continues, carrying the narrowed context.
 *
 * The rule that replaces "stop at each/with" is **stop where the schema stops
 * talking**. A declaration of `'any'`, a record's author-chosen key, an
 * unparseable subexpression — each yields an unchecked frame rather than a
 * guess. That keeps the property the old comment was defending: a false
 * "unrecognized" on a legitimately-scoped name is worse than a missed typo.
 */
export function lintContextTemplate(
	cards: Card[],
	/**
	 * The names resolvable at the root. Defaults to a context template's
	 * vocabulary; a *variable* template has a much smaller one, declared by the
	 * variable it renders — see `lintVariableTemplate`.
	 */
	vocabulary: ReadonlySet<string> = KNOWN_TOP_LEVEL_FIELDS
): TemplateLintIssue[] {
	// A context template's vocabulary is names without shapes: the structural
	// fields have no declaration to check against. `'any'` is the honest
	// spelling of that, and it makes one walker serve both callers rather than
	// two that have to be kept in agreement.
	return lintCards(
		cards,
		vocabulary === KNOWN_TOP_LEVEL_FIELDS
			? contextTemplateScope()
			: Object.fromEntries(
					[...vocabulary].map((n) => [n, "any" as const])
				)
	)
}

/**
 * A context template's vocabulary as a scope.
 *
 * Names without shapes: the structural fields have no declaration to check
 * against, and `'any'` is the honest spelling of that. Exported so the editor
 * can offer the same completions the lint checks — one vocabulary, read from
 * one place, which is the property this file already had to fight for once.
 */
export function contextTemplateScope(): TemplateScope {
	return Object.fromEntries(
		[...KNOWN_TOP_LEVEL_FIELDS].map((n) => [n, "any" as const])
	)
}

function lintCards(cards: Card[], scope: TemplateScope): TemplateLintIssue[] {
	const issues: TemplateLintIssue[] = []
	const at = (card: Card, message: string) =>
		issues.push({
			cardId: card.id,
			start: card.start,
			end: card.end,
			message
		})

	function visit(list: Card[], frame: Frame) {
		for (const card of list) {
			if (card.kind === "block") {
				if (!KNOWN_HELPER_NAMES.has(card.helperName))
					at(card, `"${card.helperName}" isn't a recognized helper.`)

				const target = fieldNameFromTagSource(card.tagSource)
				if (target) {
					const problem = checkRef(target, frame, scope)
					if (problem) at(card, problem)
				}

				const inner = childFrame(card, target, frame, scope)
				visit(card.children, inner)
				// An `{{#each}}`'s else branch runs when the collection is
				// empty, so it is back in the *outer* context — not in the
				// element context the body has.
				if (card.elseChildren)
					visit(
						card.elseChildren,
						card.helperName === "each" ? frame : inner
					)
			} else if (card.kind === "variable") {
				for (const arg of pathArgs(card.expressionSource)) {
					const problem = checkRef(arg, frame, scope)
					if (problem) at(card, problem)
				}
			} else if (card.kind === "text") {
				// A mustache only becomes its own card when it is alone on a
				// line; an inline one — `{{{name}}}: {{{message}}}`, the
				// parser's own example — is part of the surrounding text. That
				// is a presentation decision, and letting it decide what gets
				// *linted* meant nothing inside a single-line `{{#each}}` was
				// ever checked. Which is most of them.
				for (const m of inlineMustaches(card.content))
					for (const arg of pathArgs(m.expression)) {
						const problem = checkRef(arg, frame, scope)
						if (problem)
							issues.push({
								cardId: card.id,
								start: card.start + m.start,
								end: card.start + m.end,
								message: problem
							})
					}
			}
		}
	}

	visit(cards, { unchecked: false, params: new Map() })
	return issues
}

/**
 * Every `{{ … }}` inside a run of text, with its offset.
 *
 * Block tags and comments are skipped — they are already cards in their own
 * right, or are not references at all.
 */
function inlineMustaches(
	content: string
): { expression: string; start: number; end: number }[] {
	const out: { expression: string; start: number; end: number }[] = []
	const RE = /\{\{\{([^{}]*)\}\}\}|\{\{([^{}]*)\}\}/g
	for (const m of content.matchAll(RE)) {
		const inner = (m[1] ?? m[2] ?? "").trim()
		if (!inner || /^[#/!>^&]/.test(inner) || inner.startsWith("else"))
			continue
		out.push({
			expression: inner,
			start: m.index!,
			end: m.index! + m[0].length
		})
	}
	return out
}

/** The context and bindings a block introduces for its own children. */
function childFrame(
	card: BlockCard,
	target: string | null,
	frame: Frame,
	scope: TemplateScope
): Frame {
	const shifts = card.helperName === "each" || card.helperName === "with"
	const names = blockParamsFromTagSource(card.tagSource)

	if (!shifts) {
		// if/unless/systemBlock/userBlock/assistantBlock keep the context they
		// were opened in.
		return frame
	}

	const resolved = target ? typeOf(target, frame, scope) : undefined
	const context =
		card.helperName === "each" ? elementOf(resolved) : asField(resolved)

	const params = new Map(frame.params)
	// `as |item index|` — the first names the value, the second the key or
	// index, which is never a declared shape.
	if (names[0]) params.set(names[0], context)
	for (const extra of names.slice(1)) params.set(extra, undefined)

	return {
		context,
		unchecked: !context,
		params,
		parent: frame
	}
}

/** What a reference resolves to, as a declaration, or undefined if unknowable. */
function typeOf(
	expr: string,
	frame: Frame,
	scope: TemplateScope
): VarDecl | undefined {
	let rest = expr.trim()
	let f: Frame = frame
	while (rest.startsWith("../")) {
		rest = rest.slice(3)
		if (!f.parent) return undefined
		f = f.parent
	}
	let parts = splitPath(rest)
	if (parts[0] === "this") parts = parts.slice(1)

	let base: VarDecl | undefined
	if (parts.length && f.params.has(parts[0]!)) {
		base = f.params.get(parts[0]!)
		parts = parts.slice(1)
	} else if (!f.context && !f.parent) {
		if (!parts.length) return undefined
		base = scope[parts[0]!]
		parts = parts.slice(1)
	} else {
		base = f.context
	}

	const r = resolvePath(base, parts)
	return r.ok ? (r.field ?? (parts.length ? undefined : base)) : undefined
}

function asField(decl: VarDecl | undefined): VarField | undefined {
	return decl && decl !== "any" && !Array.isArray(decl) ? decl : undefined
}

/**
 * Lint one variable layout against the scope its variable declares.
 *
 * The failure this exists for is silent: a layout writing
 * `{{#each character}}` over a scope keyed `characters` renders an empty
 * string, with no error anywhere. You find out when a reply arrives with no
 * cast in it, and the layout looks correct in the editor the whole time.
 *
 * The vocabulary is the declaration's own `scope`, not the context template's —
 * a layout for `characters` has exactly one name in scope, and offering it the
 * whole context vocabulary would accept `{{{scenario}}}` here and render
 * nothing.
 */
export function lintVariableTemplate(
	source: string,
	scope: TemplateScope
): TemplateLintIssue[] {
	const parsed = parseContextTemplate(source)
	if (parsed.parseError)
		return [
			{
				cardId: "parse",
				start: 0,
				end: source.length,
				message: parsed.parseError
			}
		]
	return lintCards(parsed.cards, scope)
}
