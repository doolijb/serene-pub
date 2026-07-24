import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet } from "prosemirror-view"
import { lintHandlebarsText } from "$lib/shared/utils/handlebarsLint"

// Highlights @@decorator lines and unrecognized {{macro}} syntax as inline
// error decorations (wavy underline + native title tooltip) — unlike
// tiptapLegacyTag.ts/tiptapLorebookBindingTag.ts, these stay as plain,
// freely-editable text rather than atom nodes, since the point here is to
// flag something the author needs to fix or remove, not to insert a
// permanent token.
function computeDecorations(doc: any): DecorationSet {
	// Scan the whole document's text as one joined string (not per text
	// node) so a pattern isn't missed just because it straddles two
	// differently-marked runs (e.g. part-bold text) — each paragraph break
	// becomes a "\n" so the @@decorator check's line-anchoring still lines
	// up with how this content is actually stored (plain text with
	// newlines between paragraphs).
	let text = ""
	const posMap: number[] = []
	doc.descendants((node: any, pos: number) => {
		if (node.isText && node.text) {
			for (let i = 0; i < node.text.length; i++) {
				posMap.push(pos + i)
			}
			text += node.text
		} else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
			posMap.push(pos)
			text += "\n"
		}
		return true
	})

	const issues = lintHandlebarsText(text)
	const decorations = issues.map((issue) =>
		Decoration.inline(posMap[issue.start], posMap[issue.end - 1] + 1, {
			class: `handlebars-lint-issue handlebars-lint-${issue.kind}`,
			title: issue.message
		})
	)
	return DecorationSet.create(doc, decorations)
}

const HandlebarsLint = Extension.create({
	name: "handlebarsLint",
	addProseMirrorPlugins() {
		const key = new PluginKey("handlebarsLint")
		return [
			new Plugin({
				key,
				state: {
					init(_, { doc }) {
						return computeDecorations(doc)
					},
					apply(tr, old) {
						if (!tr.docChanged) return old.map(tr.mapping, tr.doc)
						return computeDecorations(tr.doc)
					}
				},
				props: {
					decorations(state) {
						return key.getState(state)
					}
				}
			})
		]
	}
})

export default HandlebarsLint
