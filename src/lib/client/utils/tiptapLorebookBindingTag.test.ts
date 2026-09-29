/**
 * The paste transform: literal `{{char:N}}` text becomes cast-member chips.
 *
 * The regression: two tag-bearing paragraphs pasted at once. The walk reports
 * positions in the pre-transaction document, and the first replacement shrinks
 * everything after it, so the second replacement landed at a stale position
 * and cut across the paragraph boundary.
 */
import { describe, expect, test } from "vitest"
import { Schema } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { transformCharTags } from "./tiptapLorebookBindingTag"

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: { group: "block", content: "inline*" },
		text: { group: "inline" },
		tag: {
			group: "inline",
			inline: true,
			atom: true,
			attrs: { id: { default: "" } }
		}
	},
	marks: { bold: {} }
})

const p = (...content: any[]) => schema.node("paragraph", null, content)
const t = (text: string, marks: any[] = []) => schema.text(text, marks)

/** The document as `a<3>b|c<4>` — tags as `<id>`, paragraphs split by `|`. */
function flatten(doc: any): string {
	const blocks: string[] = []
	doc.forEach((block: any) => {
		let line = ""
		block.forEach((n: any) => {
			line += n.type.name === "tag" ? `<${n.attrs.id}>` : n.text
		})
		blocks.push(line)
	})
	return blocks.join("|")
}

function run(doc: any) {
	const state = EditorState.create({ schema, doc })
	return transformCharTags(state, schema.nodes.tag)
}

describe("transformCharTags", () => {
	test("does nothing when there is no tag", () => {
		expect(run(schema.node("doc", null, [p(t("plain"))]))).toBeUndefined()
	})

	test("one paragraph, two tags", () => {
		const tr = run(
			schema.node("doc", null, [p(t("{{char:1}} met {{char:22}}."))])
		)!
		expect(flatten(tr.doc)).toBe("<1> met <22>.")
	})

	test("two tag-bearing paragraphs pasted at once keep their boundary", () => {
		const tr = run(
			schema.node("doc", null, [
				p(t("Hello {{char:1}} there")),
				p(t("and {{char:2}} too")),
				p(t("{{char:3}}"))
			])
		)!
		expect(flatten(tr.doc)).toBe("Hello <1> there|and <2> too|<3>")
		expect(tr.doc.childCount).toBe(3)
	})

	test("two text nodes in one paragraph split by an existing chip", () => {
		const tr = run(
			schema.node("doc", null, [
				p(
					t("a {{char:1}} b "),
					schema.nodes.tag.create({ id: "9" }),
					t(" c {{char:2}} d")
				)
			])
		)!
		expect(flatten(tr.doc)).toBe("a <1> b <9> c <2> d")
	})

	test("text around a tag keeps its marks", () => {
		const bold = schema.marks.bold.create()
		const tr = run(
			schema.node("doc", null, [p(t("x{{char:1}}y", [bold]))])
		)!
		const para = tr.doc.firstChild!
		expect(para.firstChild!.marks.map((m: any) => m.type.name)).toEqual([
			"bold"
		])
		expect(para.lastChild!.marks.map((m: any) => m.type.name)).toEqual([
			"bold"
		])
	})
})
