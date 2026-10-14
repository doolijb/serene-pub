/**
 * The seam between the app's template assistance — `completionsAt`,
 * `templateDiagnostics`, each pure and tested on its own — and CodeMirror's
 * completion and lint vocabularies.
 *
 * The app side already ranks completions and places findings; this file only
 * translates. Ranking is kept by returning the list unfiltered (`filter:
 * false`), because a second ranking pass would disagree with the first.
 */
import type { Completion as CmCompletion, CompletionResult } from "@codemirror/autocomplete"
import type { Diagnostic } from "@codemirror/lint"
import type { EditorView } from "@codemirror/view"
import type { Completion, CompletionKind } from "$lib/shared/utils/templateAssist"
import type { TemplateDiagnostic } from "$lib/shared/utils/templateDiagnostics"

const CM_TYPE: Record<CompletionKind, string> = {
	field: "property",
	variable: "variable",
	helper: "function",
	filter: "function",
	block: "keyword",
	tag: "keyword",
	this: "variable",
	data: "variable",
	placeholder: "text"
}

/** The column `detail` shows beside a label: a signature, or the type. */
export function completionDetail(c: Completion): string | undefined {
	if (c.detail) return c.detail
	if (c.type) return `${c.type}${c.optional ? "?" : ""}`
	return undefined
}

/** The sentence under the list: description, then who supplies it. */
export function completionInfo(c: Completion): string | undefined {
	const parts: string[] = []
	if (c.description) parts.push(c.description)
	if (c.declarer) parts.push(`From ${c.declarer}`)
	return parts.length ? parts.join("\n") : undefined
}

export interface ApplyOptions {
	/** Called after an insert that leaves a slot selected: the list wants back. */
	onslot?: (view: EditorView) => void
}

/** Replace the completion's own range, then select its slot or sit after it. */
export function applyCompletion(view: EditorView, c: Completion, opts: ApplyOptions = {}) {
	const len = view.state.doc.length
	const from = Math.min(c.start, len)
	const to = Math.min(Math.max(c.end, from), len)
	const a = from + (c.select ? c.select.start : c.insert.length)
	const b = from + (c.select ? c.select.end : c.insert.length)
	view.dispatch({
		changes: { from, to, insert: c.insert },
		selection: { anchor: a, head: b },
		userEvent: "input.complete"
	})
	if (c.select) opts.onslot?.(view)
}

/**
 * One CodeMirror result for the app's list. Every item carries its own range,
 * so `from` is the earliest of them and each option applies its own replace.
 */
export function toCompletionResult(
	items: readonly Completion[],
	opts: ApplyOptions = {}
): CompletionResult | null {
	if (!items.length) return null
	const from = Math.min(...items.map((c) => c.start))
	const options: CmCompletion[] = items.map((c) => {
		const info = completionInfo(c)
		return {
			label: c.label,
			detail: completionDetail(c),
			type: CM_TYPE[c.kind],
			info: info
				? () => {
						const el = document.createElement("div")
						for (const line of info.split("\n")) {
							const p = document.createElement("div")
							p.textContent = line
							el.append(p)
						}
						return el
					}
				: undefined,
			apply: (view) => applyCompletion(view, c, opts)
		}
	})
	return { from, options, filter: false }
}

/**
 * Lint, but not a parse error while the source is mid-word.
 *
 * A template being typed is usually not parseable, and reporting that as an
 * error on every keystroke trains people to ignore the panel. The parse error
 * is real and worth showing — once they have stopped typing.
 */
export function visibleDiagnostics(
	all: readonly TemplateDiagnostic[],
	focused: boolean
): TemplateDiagnostic[] {
	return focused ? all.filter((d) => d.kind !== "syntax") : [...all]
}

/** The app's findings as CodeMirror diagnostics, each fix as an action. */
export function toCmDiagnostics(
	diagnostics: readonly TemplateDiagnostic[],
	docLength: number,
	readonly = false
): Diagnostic[] {
	return diagnostics.map((d) => {
		const from = Math.max(0, Math.min(d.start, docLength))
		const to = Math.max(from, Math.min(d.end, docLength))
		const fix = d.fix
		return {
			from,
			to,
			severity: d.severity,
			message: d.message,
			actions:
				fix && !readonly
					? [
							{
								name: fix.label,
								apply(view: EditorView) {
									const len = view.state.doc.length
									const a = Math.min(fix.start, len)
									const b = Math.min(Math.max(fix.end, a), len)
									view.dispatch({
										changes: { from: a, to: b, insert: fix.text },
										selection: { anchor: a + fix.text.length }
									})
								}
							}
						]
					: undefined
		}
	})
}
