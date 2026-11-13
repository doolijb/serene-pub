/**
 * Admin › Variable layouts (W1): rows with the words of each reason, the
 * search box, the `?step=` narrowing, and no Add.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, state } = vi.hoisted(() => {
	const listeners = new Map<string, Set<(msg: any) => void>>()
	const listen = (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
	return {
		listeners,
		listen,
		requests: [] as Array<[string, any]>,
		state: { url: new URL("http://localhost/admin/variable-layouts") }
	}
})
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: any) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	},
	useInterest: (key: string, handler: any) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
	},
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		requests.push([key, params])
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: {
		get url() {
			return state.url
		},
		params: {}
	},
	adminRouter: {
		setQuery: (q: string) => {
			state.url = new URL(`http://localhost/admin/variable-layouts${q}`)
		},
		path: "/admin/variable-layouts",
		go: () => {}
	},
	interceptAdminLink: () => {}
}))

import Page from "./Page.svelte"
import { _resetTemplateVariableLayoutsForTests } from "$lib/client/components/pipelines/templateVariableLayouts.svelte"

const row = (over: Record<string, unknown>) => ({
	variableId: "core:var/x@1",
	key: null,
	label: "X",
	description: "",
	shelfId: "cast",
	shelfLabel: "Cast",
	supplier: "Serene Pub",
	inUse: null,
	reason: "as-written",
	presetsDiffering: 0,
	layoutCount: 0,
	...over
})
const inUse = (name: string, reason: string) => ({
	id: 1,
	name,
	reference: null,
	reason
})
const ROWS = [
	row({
		variableId: "core:var/characters@1",
		key: "characters",
		label: "Characters",
		inUse: inUse("Titled JSON", "pub"),
		reason: "pub",
		presetsDiffering: 1,
		layoutCount: 3
	}),
	row({
		variableId: "core:var/places@1",
		label: "Places",
		shelfId: "world",
		shelfLabel: "World",
		inUse: inUse("Lines", "automatic"),
		reason: "automatic",
		layoutCount: 2
	}),
	row({
		variableId: "core:var/time@1",
		label: "Time",
		shelfId: "world",
		shelfLabel: "World",
		inUse: inUse("Sentence", "default"),
		reason: "default",
		layoutCount: 2
	}),
	row({ variableId: "core:var/notes@1", label: "Notes", layoutCount: 0 })
]

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	_resetTemplateVariableLayoutsForTests()
	listeners.clear()
	requests.length = 0
	state.url = new URL("http://localhost/admin/variable-layouts")
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
async function render() {
	app = mount(Page, { target: document.body })
	await settle()
	feed("pipelines:libraryVariables", { variables: ROWS })
	await settle()
}
const text = () => document.body.textContent ?? ""

describe("Admin › Variable layouts", () => {
	test("each row says how it is written, and why", async () => {
		await render()
		expect(requests[0][0]).toBe("pipelines:libraryVariables")
		const t = text()
		expect(t).toContain("Titled JSON · chosen for this pub")
		expect(t).toContain("+ 1 preset")
		expect(t).toContain("Lines (automatic)")
		expect(t).toContain("Sentence")
		expect(t).toContain("As written")
		// The mono line is the template key; the variable id when it has none.
		expect(t).toContain("characters")
		expect(t).not.toContain("core:var/characters@1")
		expect(t).toContain("core:var/places@1")
	})

	test("has no Add button", async () => {
		await render()
		const labels = [...document.querySelectorAll("a, button")].map(
			(e) => e.textContent ?? ""
		)
		expect(labels.some((l) => /^\s*Add /.test(l))).toBe(false)
	})

	test("the search box narrows the rows", async () => {
		await render()
		const box = document.querySelector<HTMLInputElement>(
			'input[type="search"], input[type="text"]'
		)!
		box.value = "places"
		box.dispatchEvent(new Event("input", { bubbles: true }))
		await new Promise((r) => setTimeout(r, 400))
		await settle()
		expect(text()).toContain("Places")
		expect(text()).not.toContain("Characters")
	})

	test("?step= shows only the variables the step writes out, with Show all", async () => {
		state.url = new URL(
			"http://localhost/admin/variable-layouts?step=core%3Areply%3Ab3c1e5d27a90f4ee"
		)
		app = mount(Page, { target: document.body })
		await settle()
		expect(
			requests.find(
				([k]) => k === "pipelines:templateVariableLayouts"
			)?.[1]
		).toEqual({
			specSlug: "core:reply",
			stepKey: "b3c1e5d27a90f4ee"
		})
		feed("pipelines:libraryVariables", { variables: ROWS })
		feed("pipelines:library", {
			pipelines: [
				{
					slug: "core:reply",
					label: "Reply · Chat",
					scriptSeams: []
				}
			]
		})
		feed("pipelines:templateVariableLayouts", {
			specSlug: "core:reply",
			stepKey: "b3c1e5d27a90f4ee",
			stepHeading: "Build the prompt",
			keys: [{ key: "places", variableId: "core:var/places@1" }]
		})
		await settle()
		const t = text()
		expect(t).toContain(
			"Showing the variables Build the prompt in Reply · Chat writes out."
		)
		expect(t).toContain("Places")
		expect(t).not.toContain("Characters")
		const showAll = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Show all"
		)
		expect(showAll).toBeTruthy()
		showAll!.click()
		await settle()
		expect(state.url.search).toBe("")
	})
})
