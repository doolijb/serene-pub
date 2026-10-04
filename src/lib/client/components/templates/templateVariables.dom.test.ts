/**
 * The template editor's variables list, against the scope a real reply step
 * declares (owner ruling 2026-09-30: no lint for a template that leaves out
 * `{{{characterLore}}}`, but "the editor should make available variables
 * easy to find").
 *
 * The scope is the SDK's `templateScopeReport` over Build template context
 * feeding Assemble, from the contracts' own descriptors, so the list is
 * tested against what the server ships to the editor rather than a stand-in.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
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

let app: ReturnType<typeof mount> | null = null

function open(value: string) {
	const oninput = vi.fn()
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(TemplateEditor, {
		target: host,
		props: { value, scope, label: "Template", oninput }
	})
	flushSync()
	return { host, oninput }
}

const row = (host: HTMLElement, id: string) =>
	host.querySelector<HTMLElement>(`[role="treeitem"][data-tree-id="${id}"]`)

const rowIds = (host: HTMLElement) =>
	[...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
		(r) => r.dataset.treeId
	)

afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

describe("the variables a template can use", () => {
	test("every declared variable is listed, on its shelf, with its shape and an example", () => {
		const { host } = open("")
		for (const name of Object.keys(scope))
			expect(row(host, name), name).not.toBeNull()

		const lore = row(host, "characterLore")!
		expect(lore.getAttribute("aria-level")).toBe("2")
		const shelf = row(host, "shelf:lore")!
		expect(shelf.textContent).toContain("Lore")
		expect(shelf.getAttribute("aria-expanded")).toBe("true")
		expect(lore.textContent).toContain("text")
		expect(lore.textContent).toContain("{{{characterLore}}}")
		// The registered variable's own sample.
		expect(lore.textContent).toContain("The Ashguard brand")
		expect(row(host, "sessionMessages")!.textContent).toContain("list")
	})

	test("the filter narrows the list and keeps the shelf a match sits on", async () => {
		const { host } = open("")
		const filter = host.querySelector<HTMLInputElement>(
			'input[aria-label^="Filter"]'
		)!
		expect(filter.getAttribute("aria-label")).toBe(
			`Filter ${Object.keys(scope).length} variables`
		)
		filter.value = "character lore"
		filter.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		await tick()
		const ids = rowIds(host)
		expect(ids).toContain("shelf:lore")
		expect(ids).toContain("characterLore")
		expect(ids).not.toContain("sessionMessages")
		expect(ids).not.toContain("scenario")
	})

	test("choosing a variable writes its syntax at the caret", async () => {
		const { host, oninput } = open("Before\nAfter")
		const field = host.querySelector<HTMLTextAreaElement>("textarea")!
		field.setSelectionRange(7, 7)
		row(host, "characterLore")!.click()
		await tick()
		expect(oninput).toHaveBeenLastCalledWith(
			"Before\n{{{characterLore}}}After"
		)

		row(host, "sessionMessages")!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
		)
		expect(oninput.mock.lastCall![0]).toContain(
			"{{#each sessionMessages}}\n\n{{/each}}"
		)
	})

	test("a variable the template uses is marked, and one it does not is left alone", () => {
		const { host } = open(
			"{{#systemBlock}}{{{characters}}}{{/systemBlock}}\n{{#each sessionMessages}}{{{this.name}}}{{/each}}"
		)
		expect(row(host, "characters")!.textContent).toContain("Used")
		expect(row(host, "sessionMessages")!.textContent).toContain("Used")
		const lore = row(host, "characterLore")!
		expect(lore.textContent).not.toContain("Used")
		// No nag: an unused variable raises no issue.
		expect(host.querySelector('[id$="-issues"]')).toBeNull()
	})
})
