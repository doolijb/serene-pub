import Handlebars from "handlebars"
// The variable registry is the vocabulary. Importing the SDK registers core's
// declarations as a side effect of module load, which is the same route every
// other consumer takes — there is no separate "load the variables" step to
// forget.
import { allVariables } from "@serene-pub/sdk"
import type { TemplateScope } from "@serene-pub/sdk"
import { checkTemplateSourceReport } from "@serene-pub/sdk/template-check"
import { CORE_TEMPLATE_ENGINE } from "$lib/shared/pipelines/templateEngines"
import { templateCheckWith } from "$lib/shared/utils/templateCheckOptions"

// Parses a context config template's raw text (the source of truth) into a
// generic tree of cards that mirrors the template's actual Handlebars AST
// structure — no fixed/hardcoded list of "known" section names. Any block
// helper ({{#if}}/{{#each}}/{{#with}}/{{#unless}}/{{#systemBlock}}/any custom
// helper) becomes a card exposing its tag and holding its body as children;
// any variable reference standing alone on its own line becomes its own leaf
// card; any run of prose (optionally with inline variables sharing a line,
// e.g. "{{{name}}}: {{{message}}}") becomes one text card. The cards now
// serve only the lint below, which places each finding on the card it sits
// in; the card editor that also spliced them (insert/remove/reorder) went
// with the legacy Context sidebar in 0.6.

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

// ─── Template lint ──────────────────────────────────────────────────────────
// Distinct vocabulary from handlebarsLint.ts (lorebook entry CBS macros) —
// context config templates use real Handlebars block helpers and reference
// TemplateContext's own field names, so this checks against THAT vocabulary.
//
// The walk itself is the SDK's (`checkTemplateSource`, typed templates P4):
// one checker for this editor lint, the save-time validation
// (templateValidation.ts) and anything else that asks. What stays here is the
// vocabulary and the mapping of each finding onto the card it sits in.

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
 * to lay out — and `narrativeGraph` and `speakerRelationships` are values no
 * live path renders, kept recognised so a
 * cloned template using one does not start reporting errors just because the
 * default stopped.
 */
const STRUCTURAL_FIELDS = [
	"postHistory",
	// Depth-resolved injections (18 §4a, ruling 2026-08-23): data the
	// template loop renders, computed beside postHistory.targetIndex.
	"injectionsByIndex",
	// The author's note (Chat's genre field): data the message loop places at
	// its own targetIndex, resolved beside postHistory.
	"authorsNote",
	"sessionMessages",
	"budget",
	"char",
	"character",
	"user",
	"persona",
	"narrativeGraph",
	// Retired in 0.6 when the graph split into `relationshipsPerspectives` and
	// `relationshipsKnown`. Kept recognised on the same rule as the one above:
	// somebody who cloned the shipped template before the split should not have
	// their editor light up red. It renders empty now, which they will see —
	// a lint error would tell them their template is malformed, which it is
	// not, and send them looking for a typo.
	"speakerRelationships",
	// Stats and states. Structural rather than a declared variable because a
	// template reads KEYS out of it — `state.world.weather` — and a variable is
	// a value some layout renders to a string, which would leave nothing to
	// read into. Typed `any` like every structural name, so the walk stops here
	// and a slot a genre declares is never reported as a misspelling.
	"state"
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
export const KNOWN_TOP_LEVEL_FIELDS = new Set([
	...STRUCTURAL_FIELDS,
	...allVariables().flatMap((v) => Object.keys(v.scope))
])

export interface TemplateLintIssue {
	cardId: string
	start: number
	end: number
	message: string
}

/**
 * Flags unrecognized helper names and field references that the declared
 * shapes contradict.
 *
 * Helper names are checked at every nesting depth — a helper's identity never
 * depends on scope. Field references are checked wherever the schema can
 * speak: inside an `{{#each}}` against one element, inside `{{#with}}` against
 * its value, inside a subexpression like `(and a b)` — the SDK reads those
 * with the real parser, where this lint's own regex had to skip them.
 *
 * The rule is **stop where the schema stops talking**. A declaration of
 * `'any'`, a record's author-chosen key, a dynamic `lookup` — each is left
 * unchecked rather than guessed at: a false "unrecognized" on a
 * legitimately-scoped name is worse than a missed typo.
 *
 * A source that does not parse lints clean here: the caller shows the parse
 * error itself (`parseContextTemplate(...).parseError`), and a list of
 * consequences under it would bury the one message that matters.
 */
export function lintContextTemplate(
	source: string,
	/**
	 * The names resolvable at the root. Defaults to a context template's
	 * vocabulary; a *variable* template has a much smaller one, declared by the
	 * variable it renders — see `lintVariableTemplate`.
	 */
	vocabulary: ReadonlySet<string> = KNOWN_TOP_LEVEL_FIELDS,
	/** `templateScopeReport().untyped` — non-empty makes name findings warnings. */
	untyped?: readonly string[]
): TemplateLintIssue[] {
	// A context template's vocabulary is names without shapes: the structural
	// fields have no declaration to check against. `'any'` is the honest
	// spelling of that, and it makes one walker serve both callers rather than
	// two that have to be kept in agreement.
	const scope =
		vocabulary === KNOWN_TOP_LEVEL_FIELDS
			? contextTemplateScope()
			: Object.fromEntries(
					[...vocabulary].map((n) => [n, "any" as const])
				)
	return lintSource(source, scope, untyped) ?? []
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

/**
 * The SDK's findings, each placed on the card it sits in. `null` when the
 * source does not parse — the caller decides how to say that.
 */
function lintSource(
	source: string,
	scope: TemplateScope,
	untyped?: readonly string[]
): TemplateLintIssue[] | null {
	const report = checkTemplateSourceReport(
		CORE_TEMPLATE_ENGINE,
		source,
		scope,
		templateCheckWith(untyped)
	)
	if (report.findings.some((f) => f.kind === "syntax")) return null
	const { cards } = parseContextTemplate(source)
	return report.findings.map((f) => {
		const at = f.start ?? 0
		const card = cardAt(cards, at)
		if (!card)
			return {
				cardId: "template",
				start: f.tag?.start ?? at,
				end: f.tag?.end ?? f.end ?? at,
				message: f.message
			}
		// A mustache only becomes its own card when it is alone on a line; an
		// inline one — `{{{name}}}: {{{message}}}` — is part of the text around
		// it, so the issue points at that mustache rather than the whole run.
		if (card.kind === "text" && f.tag)
			return {
				cardId: card.id,
				start: f.tag.start,
				end: f.tag.end,
				message: f.message
			}
		return {
			cardId: card.id,
			start: card.start,
			end: card.end,
			message: f.message
		}
	})
}

/**
 * The innermost card holding `offset`: a block's own tag is the block; its
 * body and else-body are its children's.
 */
function cardAt(cards: Card[], offset: number): Card | undefined {
	for (const card of cards) {
		if (offset < card.start || offset >= card.end) continue
		if (card.kind === "block") {
			if (offset >= card.bodyStart && offset < card.bodyEnd)
				return cardAt(card.children, offset) ?? card
			if (
				card.elseChildren &&
				card.elseBodyStart !== undefined &&
				card.elseBodyEnd !== undefined &&
				offset >= card.elseBodyStart &&
				offset < card.elseBodyEnd
			)
				return cardAt(card.elseChildren, offset) ?? card
		}
		return card
	}
	return undefined
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
	const issues = lintSource(source, scope)
	if (issues) return issues
	return [
		{
			cardId: "parse",
			start: 0,
			end: source.length,
			message:
				parseContextTemplate(source).parseError ??
				"Failed to parse template"
		}
	]
}
