/**
 * The template editor's field is a real editor: completion that knows the
 * scope, lint drawn under the text and listed beneath it, and a near-miss fix
 * applied from the list. Driven through the CodeMirror view itself, against
 * the scope a real reply step declares (as `templateVariables.dom.test.ts`).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { EditorView } from "@codemirror/view"
import { currentCompletions, startCompletion } from "@codemirror/autocomplete"
import { forceLinting } from "@codemirror/lint"
import { assemble, buildTemplateContext } from "@serene-pub/contracts"
import { templateScopeReport, type SpecDocument } from "@serene-pub/sdk"
import TemplateEditor from "./TemplateEditor.svelte"

const node = (key: string, definitionId: string, config = {}) => ({
	key,
	kind: "task",
	definitionId,
	definitionVersion: definitionId === "core:task/assemble" ? 2 : 1,
	config,
	position: 0
})
const doc = {
	input: {},
	nodes: [
		node("context", "core:task/build-template-context"),
		node("prompt", "core:task/assemble", {
			prompts: { __ref: "slot", slot: "prompts", ofNode: "context" }
		})
	],
	edges: [{ from: "context", fromPort: "templateContext", to: "prompt", toPort: "templateContext" }]
} as unknown as SpecDocument
const descriptors: Record<string, any> = {
	"core:task/build-template-context": buildTemplateContext.descriptor,
	"core:task/assemble": assemble.descriptor
}
const { scope } = templateScopeReport(doc, "prompt", {
	describe: (n) => {
		const d = descriptors[n.definitionId]
		return { slots: d.slots, ports: d.ports, bands: d.bands, portSchemas: d.portSchemas }
	}
})

let app: ReturnType<typeof mount> | null = null
function open(value: string, readonly = false) {
	const oninput = vi.fn()
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(TemplateEditor, {
		target: host,
		props: { value, scope, label: "Template", oninput, readonly }
	})
	flushSync()
	const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!
	return { host, oninput, view }
}
const settle = () => new Promise((r) => setTimeout(r, 60))

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

describe("the template editor's field", () => {
	test("is a named, multiline editor with line numbers", () => {
		const { host } = open("a\nb\nc")
		const content = host.querySelector<HTMLElement>(".cm-content")!
		expect(content.getAttribute("aria-label")).toBe("Template")
		expect(content.getAttribute("role")).toBe("textbox")
		expect(host.querySelectorAll(".cm-gutter.cm-lineNumbers .cm-gutterElement").length).toBeGreaterThanOrEqual(3)
	})

	test("typing reports the value; completion after {{ knows the scope", async () => {
		const { oninput, view } = open("")
		view.dispatch({ changes: { from: 0, insert: "{{char" }, selection: { anchor: 6 } })
		expect(oninput).toHaveBeenLastCalledWith("{{char")
		startCompletion(view)
		await settle()
		const labels = currentCompletions(view.state).map((c) => c.label)
		expect(labels).toContain("characterLore")
		expect(labels).toContain("characters")
		expect(labels).not.toContain("sessionMessages")
	})

	test("an unknown name is listed as an error with a fix, and the fix rewrites it", async () => {
		const { host, oninput, view } = open("{{{characterLor}}}")
		forceLinting(view)
		await settle()
		flushSync()
		const issues = host.querySelector('[id$="-issues"]')
		expect(issues).not.toBeNull()
		expect(issues!.textContent).toContain("Error")
		expect(host.querySelector(".cm-content")!.getAttribute("aria-invalid")).toBe("true")
		expect(host.querySelector(".cm-lintRange-error")).not.toBeNull()
		const fix = issues!.querySelector<HTMLButtonElement>("button.btn")!
		expect(fix.textContent).toContain('Use "characterLore"')
		fix.click()
		await tick()
		expect(oninput).toHaveBeenLastCalledWith("{{{characterLore}}}")
		expect(view.state.doc.toString()).toBe("{{{characterLore}}}")
	})

	test("a value changed by the owner replaces the document", async () => {
		const host = document.createElement("div")
		document.body.append(host)
		let value = $state("one")
		// A thin owner: the prop is reactive, so a change from outside lands.
		app = mount(TemplateEditor, {
			target: host,
			props: {
				get value() {
					return value
				},
				scope,
				label: "Template",
				oninput: (v: string) => (value = v)
			}
		})
		flushSync()
		const view = EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor")!)!
		value = "two"
		flushSync()
		expect(view.state.doc.toString()).toBe("two")
	})

	test("read-only is not editable and offers no fix", async () => {
		const { host, view } = open("{{{mesage}}}", true)
		expect(view.state.readOnly).toBe(true)
		expect(view.contentDOM.getAttribute("contenteditable")).toBe("false")
		forceLinting(view)
		await settle()
		expect(host.querySelector('[id$="-issues"]')).toBeNull()
	})
})
