// Lightweight (regex-based, not AST) lint pass for lorebook entry content —
// this content only ever contains simple inline macros/bindings, never
// Handlebars block helpers, so a real parser (like contextConfigCards.ts
// uses for context config templates) is unnecessary overkill here.
//
// Flags two things:
//  1. `@@decorator` lines (Character Card V3 spec) — recognized and always
//     stripped server-side (characterCardDecorators.ts), never rendered, so
//     always worth a visible warning rather than a silent no-op.
//  2. Any `{{...}}`/`{{{...}}}` that isn't a known, supported macro or
//     binding — renders as literal text at runtime (Handlebars only throws
//     on structural syntax errors, not on an unknown bare variable), which
//     is exactly the kind of silent failure worth surfacing in the editor.

export type LintIssueKind = "decorator" | "unsupported-macro"

export interface LintIssue {
	kind: LintIssueKind
	start: number
	end: number
	match: string
	message: string
}

// Mirrors characterCardMacros.ts's registered macro names, plus the base
// {{char}}/{{user}}/{{persona}}/{{character}} legacy tags (normally
// auto-converted to their own atom node by tiptapLegacyTag.ts before this
// ever sees them as plain text, but allowlisted here too as a harmless
// fallback for pasted/unconverted text).
const KNOWN_MACRO_NAMES = new Set([
	"char",
	"user",
	"persona",
	"character",
	"random",
	"pick",
	"roll",
	"reverse",
	"comment",
	"hidden_key",
	"//"
])

const DECORATOR_LINE_RE = /^[ \t]*@{2,}\S+(?:[ \t]+.*)?$/gm
const MUSTACHE_RE = /\{\{\{?([^{}]*?)\}?\}\}/g
const MACRO_NAME_RE = /^([a-zA-Z_/]+)/

export function lintHandlebarsText(text: string): LintIssue[] {
	const issues: LintIssue[] = []

	let m: RegExpExecArray | null
	DECORATOR_LINE_RE.lastIndex = 0
	while ((m = DECORATOR_LINE_RE.exec(text)) !== null) {
		issues.push({
			kind: "decorator",
			start: m.index,
			end: m.index + m[0].length,
			match: m[0],
			message:
				"@@ decorators aren't supported yet — this line is stripped from the rendered prompt, not applied."
		})
	}

	MUSTACHE_RE.lastIndex = 0
	while ((m = MUSTACHE_RE.exec(text)) !== null) {
		const full = m[0]
		const inner = m[1].trim()
		const nameMatch = MACRO_NAME_RE.exec(inner)
		const name = (nameMatch ? nameMatch[1] : inner).toLowerCase()
		if (KNOWN_MACRO_NAMES.has(name)) continue
		if (/^char:\d+$/.test(inner)) continue // {{char:5}} numbered binding
		issues.push({
			kind: "unsupported-macro",
			start: m.index,
			end: m.index + full.length,
			match: full,
			message: `"${full}" isn't a recognized macro or binding — it will render as literal text.`
		})
	}

	return issues.sort((a, b) => a.start - b.start)
}

export interface InsertableMacroOption {
	id: string
	label: string
	description: string
	/** Text inserted verbatim at the cursor. */
	snippet: string
}

export const INSERTABLE_MACRO_OPTIONS: InsertableMacroOption[] = [
	{
		id: "random",
		label: "Random",
		description: "Picks one of the given options at random, every time.",
		snippet: "{{random:A,B,C}}"
	},
	{
		id: "roll",
		label: "Roll",
		description: "A random whole number from 1 to N.",
		snippet: "{{roll:d6}}"
	},
	{
		id: "reverse",
		label: "Reverse",
		description: "Reverses the given text.",
		snippet: "{{reverse:text}}"
	},
	{
		id: "comment",
		label: "Comment",
		description: "Removed entirely from the rendered prompt.",
		snippet: "{{comment: note}}"
	},
	{
		id: "hidden",
		label: "Hidden",
		description: "Removed entirely from the rendered prompt.",
		snippet: "{{// note}}"
	},
	{
		id: "hidden_key",
		label: "Hidden Key",
		description: "Removed from the rendered prompt.",
		snippet: "{{hidden_key:note}}"
	}
]
