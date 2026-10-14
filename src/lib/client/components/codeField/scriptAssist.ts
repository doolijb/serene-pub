/**
 * What the scripts editor knows about a script (18 §6): its source is a
 * JavaScript **function body** run by QuickJS with the declared reads bound as
 * locals (`let { a, b } = __in`), `ctx.random()` and `ctx.log(…)` as the only
 * host callables, and `return` carrying the declared rewrites back.
 *
 * Two things follow, both pure so they are tested on their own:
 *
 * - **Lint.** A syntax error, placed, from the language's own tree — the same
 *   tree that highlights. And a *read the script uses but never declared*:
 *   the hook offers it, the chips above the source do not tick it, so in the
 *   sandbox it is simply undefined. That is the mistake a person actually
 *   makes here, and the one the server cannot see until the run fails.
 * - **Completion.** The declared reads, by name, and `ctx`'s two members.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { Diagnostic } from "@codemirror/lint"
import type { EditorState } from "@codemirror/state"

export interface ScriptAssist {
	/** The reads ticked under Declarations — bound as locals in the sandbox. */
	declared: readonly string[]
	/** Every read the hook could offer, ticked or not. */
	offered: readonly string[]
}

export const CTX_MEMBERS: readonly Completion[] = [
	{
		label: "random",
		type: "method",
		detail: "() → number",
		info: "A number in [0, 1) from the run's seed, so a replay draws the same one. Math.random() is remapped to it."
	},
	{
		label: "log",
		type: "method",
		detail: "(…values)",
		info: "Writes to the run's receipt. There is no console in the sandbox."
	}
]

/** Syntax errors from the tree, and reads used but not declared. */
export function scriptDiagnostics(state: EditorState, assist: ScriptAssist): Diagnostic[] {
	const out: Diagnostic[] = []
	const doc = state.doc
	const undeclared = new Set(assist.offered.filter((n) => !assist.declared.includes(n)))
	const warned = new Set<string>()
	let lastErrorEnd = -1
	syntaxTree(state).iterate({
		enter(node) {
			if (node.type.isError) {
				// One mark per stretch: a missing brace yields a run of error
				// nodes, and ten red waves for one slip teaches nothing.
				if (node.from <= lastErrorEnd) return
				const from = node.from
				const to = Math.max(node.to, Math.min(from + 1, doc.length))
				lastErrorEnd = to
				out.push({
					from,
					to,
					severity: "error",
					message:
						node.from === doc.length || node.to === node.from
							? "Syntax error: something is unfinished here."
							: `Syntax error near “${doc.sliceString(from, Math.min(to, from + 24))}”.`
				})
				return
			}
			if (node.name !== "VariableName") return
			const name = doc.sliceString(node.from, node.to)
			if (!undeclared.has(name) || warned.has(name)) return
			warned.add(name)
			out.push({
				from: node.from,
				to: node.to,
				severity: "warning",
				message: `“${name}” is not ticked under Reads, so it is undefined here. Tick it above to read it.`
			})
		}
	})
	return out.sort((a, b) => a.from - b.from)
}

/** The declared reads and `ctx`'s members, where a word is being typed. */
export function scriptCompletions(
	ctx: CompletionContext,
	assist: ScriptAssist
): CompletionResult | null {
	const member = ctx.matchBefore(/\bctx\.\w*/)
	if (member) {
		return {
			from: member.from + "ctx.".length,
			options: [...CTX_MEMBERS],
			validFor: /^\w*$/
		}
	}
	const word = ctx.matchBefore(/[A-Za-z_$][\w$]*/)
	if (!word && !ctx.explicit) return null
	const from = word ? word.from : ctx.pos
	const options: Completion[] = [
		...assist.declared.map(
			(name): Completion => ({
				label: name,
				type: "variable",
				detail: "read",
				info: "Declared under Reads: bound here as a local, a copy of the hook's value."
			})
		),
		{
			label: "ctx",
			type: "variable",
			detail: "random · log",
			info: "The sandbox's two host functions."
		}
	]
	return { from, options, validFor: /^[\w$]*$/ }
}
