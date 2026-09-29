import { Node, mergeAttributes, nodeInputRule, InputRule } from "@tiptap/core"
import {
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction
} from "prosemirror-state"
import { Fragment, type NodeType } from "prosemirror-model"
import { castTagTitle, type CastTagKind } from "./castTag"

interface LorebookBindingTagOptions {
	getLabel: (raw: string) => string
	getCharType: (raw: string) => CastTagKind
}

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		LorebookBindingTag: {
			insertLorebookBindingTag: (raw: string) => ReturnType
		}
	}
}

const CHAR_TAG_REGEX = /\{\{char:(\d+)\}\}/g // Matches {{char:N}} syntax

// Custom input rule: replace all {{char:N}} in the changed text node
function LorebookBindingTagInputRule(type: any) {
	return new InputRule({
		// A just-typed `{{char:N}}` ending at the cursor. No `/g`: a global
		// regex is stateful across `exec` calls (`lastIndex`) and makes
		// `String.match` drop the capture groups the handler reads.
		find: /\{\{char:(\d+)\}\}$/,
		handler: ({ range, match, commands }) => {
			commands.deleteRange(range)
			commands.insertContent({ type: type.name, attrs: { id: match[1] } })
		}
	})
}

/**
 * Turn every literal `{{char:N}}` in the document into a cast-member chip.
 *
 * Exported for the unit test. Returns the transaction, or `undefined` when
 * nothing needed replacing.
 *
 * ⚠ **Map every position through `tr.mapping`.** `descendants` walks the
 * document as it was before this transaction; each replacement changes the
 * size of what follows (a 10-character tag becomes one atom), so a second
 * tag-bearing text node — the next pasted paragraph — sits at a different
 * position in `tr.doc` than the walk reports. Replacing at the stale position
 * cut across node boundaries and corrupted the document.
 */
export function transformCharTags(
	state: EditorState,
	type: NodeType
): Transaction | undefined {
	const tr = state.tr
	let modified = false

	state.doc.descendants((node, pos) => {
		if (!node.isText || !node.text) return true
		const parts: (string | { id: string })[] = []
		let lastIndex = 0
		let m: RegExpExecArray | null
		CHAR_TAG_REGEX.lastIndex = 0
		while ((m = CHAR_TAG_REGEX.exec(node.text)) !== null) {
			if (m.index > lastIndex)
				parts.push(node.text.slice(lastIndex, m.index))
			parts.push({ id: m[1] })
			lastIndex = m.index + m[0].length
		}
		if (parts.length === 0) return true
		if (lastIndex < node.text.length) parts.push(node.text.slice(lastIndex))

		// Text keeps its marks (bold around a tag stays bold).
		let frag = Fragment.empty
		for (const part of parts) {
			frag = frag.append(
				Fragment.from(
					typeof part === "string"
						? state.schema.text(part, node.marks)
						: type.create({ id: part.id })
				)
			)
		}
		const from = tr.mapping.map(pos)
		const to = tr.mapping.map(pos + node.nodeSize)
		tr.replaceWith(from, to, frag)
		modified = true
		return true
	})
	return modified ? tr : undefined
}

const createPasteTransformPlugin = (type: NodeType) => {
	return new Plugin({
		key: new PluginKey("LorebookBindingTagPasteTransform"),
		appendTransaction(transactions, _oldState, newState) {
			// Only run on paste or if doc changed
			if (!transactions.some((tr) => tr.docChanged)) return
			return transformCharTags(newState, type)
		}
	})
}

const createClipboardTextSerializerPlugin = (type: any) => {
	return new Plugin({
		key: new PluginKey("LorebookBindingTagClipboardTextSerializer"),
		props: {
			clipboardTextSerializer: (slice) => {
				let text = ""
				slice.content.descendants((node) => {
					if (node.type === type) {
						text += `{{char:${node.attrs.id}}}` // Use preferred {{char:N}} syntax
					} else if (node.isText) {
						text += node.text
					} else if (node.isBlock) {
						text += "\n"
					}
					return true
				})
				return text
			}
		}
	})
}

const LorebookBindingTag = Node.create<LorebookBindingTagOptions>({
	name: "LorebookBindingTag",
	inline: true,
	group: "inline",
	atom: true,
	selectable: false,

	addOptions() {
		return {
			getLabel: (raw: string) => raw,
			getCharType: (_raw: string): CastTagKind => "unknown"
		}
	},

	addAttributes() {
		return {
			id: {
				default: "",
				parseHTML: (element) => element.getAttribute("data-id"),
				renderHTML: (attributes) => ({ "data-id": attributes.id })
			}
		}
	},

	parseHTML() {
		return [
			{
				tag: "span.character-tag[data-id]"
			}
		]
	},

	renderHTML({ node, HTMLAttributes }) {
		const raw = `{{char:${node.attrs.id}}}` // Use preferred {{char:N}} syntax
		const charType = this.options.getCharType(raw)
		// A background cast member (no card) is a real member, so it gets a
		// neutral chip; only a tag with no member row at all warns.
		const typeClass =
			charType === "character"
				? "preset-filled-primary-500"
				: charType === "persona"
					? "preset-filled-secondary-500"
					: charType === "background"
						? "preset-filled-surface-500"
						: "preset-filled-warning-500"
		const label = this.options.getLabel(raw)
		return [
			"span",
			mergeAttributes(HTMLAttributes, {
				class: `badge ${typeClass} character-tag`,
				"data-id": node.attrs.id,
				contenteditable: "false",
				title: castTagTitle(charType, label)
			}),
			label
		]
	},

	addCommands() {
		return {
			insertLorebookBindingTag:
				(raw) =>
				({ commands }) => {
					return commands.insertContent(raw)
				}
		}
	},

	addGlobalAttributes() {
		return [
			{
				types: [this.name],
				attributes: {},
				renderText({ node }: { node: any }) {
					return `{{char:${node.attrs.id}}}` // Use preferred {{char:N}} syntax
				}
			}
		]
	},

	addProseMirrorPlugins() {
		return [
			createPasteTransformPlugin(this.type),
			createClipboardTextSerializerPlugin(this.type)
		]
	},
	addInputRules() {
		return [LorebookBindingTagInputRule(this.type)]
	}
})
// Usage: Call forceRawContentCopy(editor.view, () => rawContent) after editor is mounted.

export default LorebookBindingTag
