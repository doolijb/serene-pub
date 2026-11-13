/**
 * W5: the template editor names layouts in place — the caret line, the
 * Write-as buttons, "Layouts in this template", and the tree's meta line.
 * Driven through the CodeMirror view, as `templateEditorField.dom.test`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { EditorView } from "@codemirror/view"
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
	edges: [
		{
			from: "context",
			fromPort: "templateContext",
			to: "prompt",
			toPort: "templateContext"
		}
	]
} as unknown as SpecDocument
const descriptors: Record<string, any> = {
	"core:task/build-template-context": buildTemplateContext.descriptor,
	"core:task/assemble": assemble.descriptor
}
const { scope } = templateScopeReport(doc, "prompt", {
	describe: (n) => {
		const d = descriptors[n.definitionId]
		return {
			slots: d.slots,
			ports: d.ports,
			bands: d.bands,
			portSchemas: d.portSchemas
		}
	}
})

const LIQUID = "core:template/liquid@1"
const variableLayouts: Sockets.Pipelines.VariableLayouts.TemplateKey[] = [
	{
		key: "characters",
		variableId: "core:var/characters@1",
		variableLabel: "Characters",
		inUse: {
			id: 1,
			name: "Titled JSON block",
			reference: "core/titled-json@1",
			reason: "pub"
		},
		offers: [
			{ reference: "core/titled-json@1", label: "Titled JSON block" },
			{ reference: "core/json@1", label: "JSON" }
		]
	}
]

let app: ReturnType<typeof mount> | null = null
function open(
	value: string,
	opts: { readonly?: boolean; engine?: string } = {}
) {
	const oninput = vi.fn()
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(TemplateEditor, {
		target: host,
		props: {
			value,
			scope,
			label: "Template",
			oninput,
			variableLayouts,
			readonly: opts.readonly ?? false,
			...(opts.engine ? { engine: opts.engine } : {})
		}
	})
	flushSync()
	const view = EditorView.findFromDOM(
		host.querySelector<HTMLElement>(".cm-editor")!
	)!
	return { host, oninput, view }
}
const buttons = (host: HTMLElement) =>
	[...host.querySelectorAll("button")].map((b) => b.textContent!.trim())
const button = (host: HTMLElement, name: string) =>
	[...host.querySelectorAll("button")].find(
		(b) => b.textContent!.trim() === name
	)
async function caretAt(view: EditorView, anchor: number) {
	view.dispatch({ selection: { anchor } })
	flushSync()
	await tick()
}

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

describe("layouts in the template editor", () => {
	test("the caret on a bare read says how it is written and offers the other layout", async () => {
		const src = "A {{{characters}}} B {{{characters}}}"
		const { host, view } = open(src)
		await caretAt(view, 5)
		const text = host.textContent ?? ""
		expect(text).toContain(
			"Written as Titled JSON block (this pub's choice)"
		)
		expect(buttons(host)).toContain("Write as JSON here")
		expect(buttons(host)).not.toContain("Write as Titled JSON block here")
		button(host, "Write as JSON here")!.click()
		flushSync()
		expect(view.state.doc.toString()).toBe(
			'A {{{layout characters "core/json@1"}}} B {{{characters}}}'
		)
	})

	test("Liquid writes its own call", async () => {
		const { host, view } = open("{{ characters }} | {{ characters }}", {
			engine: LIQUID
		})
		await caretAt(view, 4)
		button(host, "Write as JSON here")!.click()
		flushSync()
		expect(view.state.doc.toString()).toBe(
			'{{ characters | layout: "core/json@1" }} | {{ characters }}'
		)
	})

	test("Layouts in this template: All bare, then Apply, rewrites every occurrence at once", async () => {
		const src =
			'{{{layout characters "core/titled-json@1"}}} and {{{layout characters "core/titled-json@1"}}}'
		const { host, view } = open(src)
		const toggle = button(host, "Layouts in this template")!
		expect(toggle.getAttribute("aria-expanded")).toBe("false")
		toggle.click()
		flushSync()
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		button(host, "All bare")!.click()
		flushSync()
		button(host, "Apply")!.click()
		flushSync()
		expect(view.state.doc.toString()).toBe(
			'{{{layout characters "core/json@1"}}} and {{{layout characters "core/json@1"}}}'
		)
		expect(button(host, "Apply")).toBeUndefined()
	})

	test("a read-only template shows how it is written, with nothing to press", async () => {
		const { host, view } = open("A {{{characters}}}", { readonly: true })
		await caretAt(view, 5)
		expect(host.textContent).toContain(
			"Written as Titled JSON block (this pub's choice)"
		)
		expect(buttons(host).some((b) => b.startsWith("Write as"))).toBe(false)
		expect(buttons(host)).not.toContain("Layouts in this template")
	})

	test("the tree's root says how it is written", () => {
		const { host } = open("A {{{characters}}}")
		expect(
			host.querySelector('[data-tree-id="characters"]')?.textContent
		).toContain("Written as Titled JSON block")
	})
})
