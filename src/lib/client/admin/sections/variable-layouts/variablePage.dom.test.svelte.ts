/**
 * Admin › Variable layouts › one variable (W2): Use this, Back to the
 * default, a delete refusal on its row (never a toast), the empty variable.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, toasts } = vi.hoisted(() => ({
	listeners: new Map<string, Set<(msg: any) => void>>(),
	emitted: [] as Array<[string, any]>,
	toasts: [] as string[]
}))
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
const add = (key: string, handler: any) => {
	let set = listeners.get(key)
	if (!set) listeners.set(key, (set = new Set()))
	set.add(handler)
	return () => set!.delete(handler)
}
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	useInterest: (key: string, handler: any) => {
		add(key, handler)
	},
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		emitted.push([key, params])
		return add(key, handler)
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => toasts.push("error"),
		info: () => toasts.push("info"),
		success: () => toasts.push("success"),
		warning: () => toasts.push("warning")
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: {
		url: new URL(
			"http://localhost/admin/variable-layouts/core%3Avar%2Fcharacters%401"
		),
		params: { variable: "core:var/characters@1" }
	},
	adminRouter: {
		setQuery: () => {},
		path: "/admin/variable-layouts",
		go: () => {}
	},
	interceptAdminLink: () => {}
}))

import VariablePage from "./VariablePage.svelte"

const layout = (
	id: number,
	name: string,
	over: Record<string, unknown> = {}
) => ({
	id,
	name,
	ownerLabel: "Serene Pub",
	reference: null,
	engine: "handlebars",
	isImmutable: true,
	editable: false,
	preview: `preview ${name}`,
	previewError: null,
	inUse: false,
	namedByTemplates: 0,
	chosenByPresets: [],
	...over
})
const variable = (over: Record<string, unknown> = {}) => ({
	variableId: "core:var/characters@1",
	label: "Characters",
	description: "The cast in view.",
	supplier: "Serene Pub",
	scope: {},
	sample: { name: "Ada" },
	default: { id: 1, name: "Titled JSON" },
	pubDiffersFromDefault: false,
	inUse: { id: 1, name: "Titled JSON", reference: null, reason: "default" },
	rows: [
		layout(1, "Titled JSON", { inUse: true }),
		layout(2, "Lines", {
			isImmutable: false,
			editable: true,
			ownerLabel: "This pub"
		})
	],
	differs: [],
	...over
})

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	toasts.length = 0
})
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
function feed(key: string, msg: unknown) {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
}
async function render(v = variable()) {
	app = mount(VariablePage, { target: document.body })
	await settle()
	feed("pipelines:libraryVariable", { variable: v })
	await settle()
}
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")
const button = (label: string) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) =>
		b.textContent?.trim().startsWith(label)
	)

describe("Admin › Variable layouts › a variable", () => {
	test("asks for the variable by its id", async () => {
		await render()
		expect(emitted[0]).toEqual([
			"pipelines:libraryVariable",
			{ variableId: "core:var/characters@1" }
		])
		expect(text()).toContain("Supplied by Serene Pub.")
	})

	test("the in-use row says In use and has no Use this; the other has it and sends the row id", async () => {
		await render()
		expect(text()).toContain("In use")
		const use = button("Use this")
		expect(use.length).toBeGreaterThan(0)
		expect(use.every((b) => !b.textContent?.includes("Titled"))).toBe(true)
		use[0].click()
		await settle()
		expect(emitted.at(-1)).toEqual([
			"pipelines:librarySetPubLayout",
			{ variableId: "core:var/characters@1", templateId: 2 }
		])
	})

	test("Back to the default shows only when the pub differs, and sends null", async () => {
		await render()
		expect(button("Back to the default")).toHaveLength(0)
		unmount(app!)
		document.body.innerHTML = ""
		listeners.clear()
		await render(variable({ pubDiffersFromDefault: true }))
		expect(text()).toContain("Chosen for this pub.")
		expect(text()).toContain("(Titled JSON)")
		button("Back to the default")[0].click()
		await settle()
		expect(emitted.at(-1)).toEqual([
			"pipelines:librarySetPubLayout",
			{ variableId: "core:var/characters@1", templateId: null }
		])
	})

	test("a delete refusal lands on its row, and nothing is toasted", async () => {
		await render()
		button("Delete")[0].click()
		await settle()
		const confirm = button("Delete variable layout")[0]
		expect(confirm).toBeTruthy()
		confirm.click()
		await settle()
		expect(emitted.at(-1)).toEqual([
			"pipelines:libraryDeleteTemplate",
			{ kind: "variable", id: 2 }
		])
		feed("pipelines:libraryDeleteTemplate:error", {
			error: "A preset still chooses it."
		})
		await settle()
		const alerts = [...document.querySelectorAll('[role="alert"]')].map(
			(e) => e.textContent
		)
		expect(
			alerts.some((a) => a?.includes("A preset still chooses it."))
		).toBe(true)
		expect(toasts).toEqual([])
	})

	test("a variable with no layout says As written, with New layout", async () => {
		await render(variable({ rows: [], inUse: null, default: null }))
		expect(text()).toContain("As written")
		expect(text()).toContain("this variable has no variable layout yet")
		const links = [
			...document.querySelectorAll<HTMLAnchorElement>("a")
		].filter((a) => a.textContent?.includes("New layout"))
		expect(links.length).toBeGreaterThan(0)
		expect(
			links.some((a) => a.getAttribute("href")?.endsWith("/new"))
		).toBe(true)
	})

	test("Where this differs lists each difference with its link; none, no block", async () => {
		const layout = { id: 2, name: "Lines" }
		await render(
			variable({
				differs: [
					{ kind: "template", id: 7, name: "Chat", layout },
					{
						kind: "leftover",
						specSlug: "core/story@1",
						pipelineLabel: "Story",
						stepKey: "abc",
						stepHeading: "Reply",
						layout
					},
					{ kind: "preset", id: 3, name: "Cozy", layout }
				]
			})
		)
		expect(text()).toContain("Where this differs")
		expect(text()).toContain(
			"These write this variable out with another layout than the one in use."
		)
		expect(text()).toContain("The context template Chat names Lines.")
		expect(text()).toContain(
			"Reply in Story keeps Lines, picked before layouts moved."
		)
		expect(text()).toContain("The Cozy preset chooses Lines.")
		const hrefs = [
			...document.querySelectorAll<HTMLAnchorElement>("ul li.text-sm a")
		].map((a) => a.getAttribute("href"))
		expect(hrefs).toEqual([
			"/admin/context-templates/7",
			"/admin/pipelines/core%2Fstory%401",
			"/admin/session-presets/3"
		])
		unmount(app!)
		document.body.innerHTML = ""
		listeners.clear()
		await render(variable({ differs: [] }))
		expect(text()).not.toContain("Where this differs")
	})
})
