/**
 * W3, the variable layout form: a layout with a reference shows it as words,
 * the preview follows the source, a new layout's **Use it everywhere** starts
 * off with the counted sentence, and Save sends the reference and the switch.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, listen, emitted } = vi.hoisted(() => {
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		},
		emitted: [] as Array<[string, any]>
	}
})
const socket = {
	emit: (event: string, payload: unknown) => emitted.push([event, payload]),
	on: () => {},
	off: () => {}
}
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		emitted.push([`ask:${key}`, params])
		return listen(key, handler)
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => Promise.resolve(),
	adminUnsavedEdits: () => {},
	adminPage: { url: new URL("http://localhost/admin/variable-layouts") },
	adminRouter: {
		setQuery: () => {},
		path: "/admin/variable-layouts",
		go: () => {}
	},
	interceptAdminLink: () => {}
}))
vi.mock("$lib/client/components/templates/TemplateEditor.svelte", async () => ({
	default: (await import("./TemplateEditorStub.svelte")).default
}))

import VariableLayoutForm from "./VariableLayoutForm.svelte"

const VARIABLE_ID = "core:var/characters@1"
const VARIABLE = {
	variableId: VARIABLE_ID,
	label: "Characters",
	description: "",
	supplier: "Serene Pub",
	scope: { characters: {} },
	sample: [],
	default: null,
	pubDiffersFromDefault: false,
	inUse: null,
	rows: []
}
const ROWS = [
	{
		id: 7,
		name: "Ada's list",
		source: "{{#each characters}}{{name}}{{/each}}",
		engine: "core:template/handlebars@1",
		isImmutable: false,
		poolId: VARIABLE_ID,
		poolLabel: "Characters",
		usedBy: [],
		reference: "ada/list@1"
	},
	{
		id: 3,
		name: "Titled",
		source: "x",
		engine: "core:template/liquid@1",
		isImmutable: true,
		poolId: VARIABLE_ID,
		poolLabel: "Characters",
		usedBy: [],
		reference: "core/titled@1"
	}
]

let app: Record<string, any> | null = null
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	vi.useRealTimers()
})

async function settle() {
	flushSync()
	await tick()
	flushSync()
}
function feed(key: string, msg: unknown) {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
}
async function render(props: Record<string, unknown>) {
	app = mount(VariableLayoutForm, {
		target: document.body,
		props: { variableId: VARIABLE_ID, ...props }
	})
	await settle()
	feed("pipelines:libraryVariable", { variable: VARIABLE })
	feed("pipelines:library", { variableTemplates: ROWS })
	await settle()
}
const previews = () =>
	emitted.filter(([e]) => e === "pipelines:previewTemplate")
const type = async (el: Element, value: string) => {
	;(el as HTMLInputElement).value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}

describe("variable layout form", () => {
	test("a row with a reference shows it as words, with no owner or slug input", async () => {
		await render({ id: 7 })
		expect(document.body.textContent).toContain("ada/list@1")
		expect(document.body.textContent).toContain(
			"Fixed once saved, so templates that name it keep working."
		)
		expect(document.body.textContent).toContain("Handlebars")
		expect(document.body.textContent).not.toContain("Owner slug")
	})

	test("typing in the source previews it against the variable", async () => {
		await render({ id: 7 })
		await vi.advanceTimersByTimeAsync(500)
		previews().length = 0
		emitted.length = 0
		await type(document.querySelector("textarea")!, "{{characters}}")
		expect(previews()).toHaveLength(0)
		await vi.advanceTimersByTimeAsync(500)
		expect(previews()).toHaveLength(1)
		expect(previews()[0][1]).toMatchObject({
			kind: "variable",
			poolId: VARIABLE_ID,
			source: "{{characters}}"
		})
	})

	test("add: Use it everywhere starts off and reads the counted sentence", async () => {
		await render({})
		feed("pipelines:libraryUseEverywhereCounts", {
			variableId: VARIABLE_ID,
			pipelines: 9,
			contextTemplates: 3
		})
		await settle()
		const sw = document.querySelector(
			'input[role="switch"]'
		) as HTMLInputElement
		expect(sw.checked).toBe(false)
		expect(document.body.textContent).toContain("9 pipelines, 3 templates.")
	})

	test("add: Save sends the reference and useEverywhere off", async () => {
		await render({})
		const name = document.querySelector(
			'input[type="text"]'
		) as HTMLInputElement
		await type(name, "My List")
		await type(document.querySelector("textarea")!, "{{characters}}")
		emitted.length = 0
		const save = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Save"
		)!
		save.click()
		await settle()
		const create = emitted.find(
			([e]) => e === "pipelines:libraryCreateTemplate"
		)
		expect(create?.[1]).toMatchObject({
			kind: "variable",
			poolId: VARIABLE_ID,
			name: "My List",
			reference: { ownerSlug: "ada", slug: "my-list" },
			useEverywhere: false
		})
	})
})
