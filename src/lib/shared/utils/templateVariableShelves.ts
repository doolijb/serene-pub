/**
 * "Variables available here", made findable: the scope's roots sorted onto
 * **variable shelves** (characters, lore, history, …), each row with its
 * shape in plain words, an example where a registered variable declares one,
 * the syntax choosing it writes, and whether the template already uses it.
 *
 * Nothing here is a list of variables. The roots are the step's typed scope
 * (`scopeTreeNodes`), the examples are the registered declarations' own
 * `sample`s (`allVariables`), and a shelf is chosen from a root's name and
 * supplier, so a plugin's variable lands on a shelf without being named here.
 *
 * "Used" is a mark, never a nag: a root the template does not use is simply
 * unmarked. Whether a template should place `characterLore` is the author's
 * call (owner ruling 2026-09-30).
 */

import { allVariables, sampleValues, type VarType } from "@serene-pub/sdk"
import type { ScopeDeclarer, ScopeTreeNode } from "./templateAssist"

const LIQUID_ENGINE = "core:template/liquid@1"

/** A shelf of the variables list. ⚠ Not the character Library. */
export interface VariableShelf {
	id: string
	label: string
}

/** In display order. The last one takes what no other claims. */
export const VARIABLE_SHELVES: readonly VariableShelf[] = [
	{ id: "characters", label: "Characters and personas" },
	{ id: "lore", label: "Lore" },
	{ id: "history", label: "History and messages" },
	{ id: "instructions", label: "Instructions and scene" },
	{ id: "session", label: "Session" },
	{ id: "other", label: "Other" }
]

/**
 * The shelf a root sits on, from its name and who supplies it. The order of
 * the tests is the ruling: `characterLore` is lore before it is a character,
 * and `postHistoryInstructions` is an instruction before it is history.
 */
export function variableShelfOf(
	name: string,
	declarer?: ScopeDeclarer
): string {
	const n = name.toLowerCase()
	if (/lore|excerpt|entr(y|ies)/.test(n)) return "lore"
	if (/instruction|prompt|system|scenario/.test(n)) return "instructions"
	if (/^(char|user)$|character|persona|relationship|dialogue|cast/.test(n))
		return "characters"
	if (/history|message|injection|recalled|lines/.test(n)) return "history"
	if (
		/^(state|annex|budget)$|date|time/.test(n) ||
		declarer?.group === "annex"
	)
		return "session"
	return "other"
}

/** A value's shape, in the words the list shows. */
export function shapeWord(type: VarType | undefined): string | undefined {
	switch (type) {
		case "string":
			return "text"
		case "boolean":
			return "true/false"
		case "record":
			return "keyed list"
		default:
			return type
	}
}

const EXAMPLE_LENGTH = 80

/**
 * An example of a root's value: the `sample` of the registered variable that
 * declares it, written short. Undefined when nothing registered declares
 * the root (a step's own structural names, a plugin variable this build has
 * not loaded).
 */
export function variableExampleOf(
	root: string,
	variables = allVariables()
): string | undefined {
	const decl = variables.find((v) => Object.hasOwn(v.scope, root))
	if (!decl) return undefined
	const value = sampleValues(decl)[root]
	if (value === undefined || value === null || value === "") return undefined
	const text = typeof value === "string" ? value : JSON.stringify(value)
	return text.length > EXAMPLE_LENGTH
		? `${text.slice(0, EXAMPLE_LENGTH - 1)}…`
		: text
}

/**
 * What choosing a row writes outside a tag: a list as its loop with the caret
 * on the empty line inside, anything else as its output, triple-braced in
 * Handlebars so a layout's fences are not HTML-escaped.
 */
export function insertionFor(
	node: Pick<ScopeTreeNode, "path" | "type">,
	engine?: string
): { text: string; caret?: number } {
	const liquid = engine === LIQUID_ENGINE
	if (node.type === "list") {
		const text = liquid
			? `{% for item in ${node.path} %}\n\n{% endfor %}`
			: `{{#each ${node.path}}}\n\n{{/each}}`
		return { text, caret: text.indexOf("\n") + 1 }
	}
	return { text: liquid ? `{{ ${node.path} }}` : `{{{${node.path}}}}` }
}

const COMMENT =
	/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g
const TAG = /\{\{([\s\S]*?)\}\}|\{%-?([\s\S]*?)-?%\}/g
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g
const REACH = /@root\.|(?:\.\.\/)+/g
const NAME = /(?<![\w.$@\]-])[A-Za-z_$][\w$]*/g

/**
 * Which of `roots` the source names inside a tag, in either language.
 *
 * A tolerant scan rather than a parse, so a template mid-edit still shows
 * what it uses. A field (`this.name`, `x.name`) never counts as the root of
 * the same name; `../x` and `@root.x` do.
 */
export function usedScopeRoots(
	source: string,
	roots: Iterable<string>
): Set<string> {
	const names = new Set(roots)
	const out = new Set<string>()
	for (const m of source.replace(COMMENT, " ").matchAll(TAG)) {
		const body = (m[1] ?? m[2] ?? "")
			.replace(QUOTED, " ")
			.replace(REACH, " ")
		for (const id of body.matchAll(NAME))
			if (names.has(id[0])) out.add(id[0])
	}
	return out
}

/** A root row of the shelved tree: the tree node plus what the list adds. */
export interface ShelvedNode extends ScopeTreeNode {
	/** A shelf heading: opens and closes, never inserts. */
	shelf?: boolean
	example?: string
	/** The syntax choosing it writes outside a tag, a loop's body as `…`. */
	writes?: string
	used?: boolean
	children?: ShelvedNode[]
}

/**
 * The scope's roots on their shelves, empty shelves dropped. Root ids are
 * kept, so a row's identity does not change with the shelving.
 */
export function shelveScopeTree(
	roots: readonly ScopeTreeNode[],
	options: {
		declarers?: Readonly<Record<string, ScopeDeclarer>>
		used?: ReadonlySet<string>
		engine?: string
		example?: (root: string) => string | undefined
	} = {}
): ShelvedNode[] {
	const example =
		options.example ?? ((root: string) => variableExampleOf(root))
	const byShelf = new Map<string, ShelvedNode[]>()
	for (const root of roots) {
		const shelf = variableShelfOf(
			root.label,
			options.declarers?.[root.label]
		)
		const ex = example(root.label)
		const row: ShelvedNode = {
			...root,
			writes: insertionFor(root, options.engine).text.replace(
				"\n\n",
				"…"
			),
			...(ex ? { example: ex } : {}),
			...(options.used?.has(root.label) ? { used: true } : {})
		}
		byShelf.set(shelf, [...(byShelf.get(shelf) ?? []), row])
	}
	return VARIABLE_SHELVES.flatMap(({ id, label }) => {
		const children = byShelf.get(id)
		return children?.length
			? [{ id: `shelf:${id}`, label, path: "", shelf: true, children }]
			: []
	})
}

const matches = (node: ShelvedNode, words: string[]) => {
	const hay = [
		node.label,
		node.path,
		node.description ?? "",
		node.declarer ?? ""
	]
		.join(" ")
		.toLowerCase()
	return words.every((w) => hay.includes(w))
}

/**
 * The tree narrowed to `query`: every word must appear in a row's name, path,
 * description or supplier. A match keeps its ancestors (opened, in `reveal`)
 * and all of its own children; a shelf that matches keeps its whole shelf.
 */
export function filterShelvedTree(
	nodes: readonly ShelvedNode[],
	query: string
): { nodes: ShelvedNode[]; reveal: Set<string>; matched: number } {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	const reveal = new Set<string>()
	let matched = 0
	if (!words.length) return { nodes: [...nodes], reveal, matched }
	const walk = (list: readonly ShelvedNode[]): ShelvedNode[] =>
		list.flatMap((node) => {
			if (matches(node, words)) {
				if (!node.shelf) matched++
				else matched += node.children?.length ?? 0
				if (node.shelf) reveal.add(node.id)
				return [node]
			}
			const kept = node.children ? walk(node.children) : []
			if (!kept.length) return []
			reveal.add(node.id)
			return [{ ...node, children: kept }]
		})
	return { nodes: walk(nodes), reveal, matched }
}
