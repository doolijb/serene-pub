/**
 * 🚧 Admin › Rulesets › **New ruleset** (PLAN-rulesets-functions D8, lane A4,
 * 2026-10-23; the design canvas's first screen): a label and the id it makes,
 * **From scratch** first and picked, the archetypes (decided by, attributes,
 * entry types, zone types), more under a fold — the other archetypes, **A
 * copy of rules you have**, **Paste a document** — and `rulesets:create`
 * with the contract's params.
 *
 * ⚠ No DOM node is ever handed to `expect` (a failing assertion on one
 * serialises the whole happy-dom window): every check compares a boolean,
 * a string or plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { EditorView } from "@codemirror/view"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { emitted, socket, listeners, listen, request, gone, page } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, Set<(msg: any) => void>>()
	const listen = (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => set!.delete(handler)
	}
	const request = (key: string, params: unknown, handler: (msg: any) => void) => {
		emitted.push([key, params])
		return listen(key, handler)
	}
	return {
		emitted,
		request,
		socket: {
			emit: (event: string, payload: unknown) => emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen,
		gone: [] as Array<[string, unknown]>,
		page: {
			url: new URL("http://localhost/admin/rulesets/new"),
			params: {} as Record<string, string>
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: request,
	getAdminInterestContext: () => ({
		declareInterest: listen,
		useInterest: listen,
		requestWithInterest: request
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, warning: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: (path: string, opts?: unknown) => {
		gone.push([path, opts])
		return Promise.resolve()
	},
	adminPage: page,
	adminUnsavedEdits: () => {},
	adminRouter: { setQuery: () => {}, path: "/admin/rulesets" },
	interceptAdminLink: () => {}
}))
const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
})

import NewPage from "./NewPage.svelte"

const feed = (key: string, msg: unknown) => {
	for (const h of [...(listeners.get(key) ?? [])]) h(msg)
	flushSync()
}
const ctx = () => new Map<string, unknown>([["userCtx", { user: { id: 1, isAdmin: true } }]])
const settle = async () => {
	await tick()
	await Promise.resolve()
	flushSync()
}

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	gone.length = 0
	page.url = new URL("http://localhost/admin/rulesets/new")
})

function type(id: string, value: string) {
	const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
/** Type into the element a selector finds. */
function typeIn(selector: string, value: string) {
	const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const button = (text: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined
const click = (el: Element | null | undefined) => {
	;(el as HTMLElement).click()
	flushSync()
}
const sent = (event: string) => emitted.filter(([e]) => e === event).map(([, p]) => p)
const text = (selector: string) => document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? ""

const FREEFORM = "core:ruleset/freeform@1"
const VIS = "core:ruleset/vis-itineris@1"
const listRow = (rulesetId: string, label: string, origin: string, over: Record<string, unknown> = {}) => ({
	rulesetId,
	label,
	name: label,
	description: "",
	origin,
	state: origin === "pub" ? "draft" : "shipped",
	version: null,
	draftChanged: false,
	draftFindings: 0,
	rollsDice: false,
	decides: false,
	playedBy: { sessions: 0, lorebooks: 0 },
	pluginName: null,
	...over
})
const LIST = [listRow(FREEFORM, "Freeform", "core"), listRow(VIS, "Vis Itineris", "core", { rollsDice: true, decides: true })]
const MINE = listRow("acme.lab:ruleset/old@1", "Old", "pub")
const card = (stem: string, label: string, over: Record<string, unknown> = {}) => ({
	id: `core:ruleset/${stem}@1`,
	stem,
	label,
	about: `${label}, in a paragraph.`,
	goodFor: "",
	decidedBy: [],
	attributes: 0,
	entryTypes: [],
	zoneTypes: [],
	situation: "",
	...over
})
const TEMPLATES = [
	card("template-dice-pool", "Dice pool", { stem: "dice-pool", decidedBy: ["Roll a pool"], attributes: 3, entryTypes: ["Gear", "Conditions"] }),
	card("romance", "Romance", { decidedBy: ["Compare against a target", "Spend to succeed"], attributes: 3, entryTypes: ["Bonds", "Moods"], situation: "The pier at dusk." }),
	card("card-game", "Card game", { decidedBy: ["Draw a card"], attributes: 1, entryTypes: ["Cards"], zoneTypes: ["Deck", "Hand", "Discard"] })
]
const starts = (selector: string) => [...document.querySelectorAll(`${selector} [data-start]`)].map((c) => c.getAttribute("data-start"))
const picked = (value: string) => (document.querySelector(`[data-start="${value}"] input`) as HTMLInputElement | null)?.checked ?? false

describe("Admin › Rulesets › New ruleset", () => {
	test("from scratch comes first and is picked; the id follows the label under the pub's owner; Save sends no source", async () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("rulesets:list", { rulesets: [...LIST, MINE], templates: TEMPLATES })
		expect(starts("[data-start-from]")).toEqual(["scratch", TEMPLATES[1]!.id, TEMPLATES[2]!.id])
		expect(picked("scratch")).toBe(true)
		expect(text('[data-start="scratch"]')).toContain("Nothing added")
		expect(text('[data-start="scratch"]')).toContain("Truly empty: no outcomes, no time, no ways to decide.")
		expect(text("[data-starting]")).toContain("Starting from scratch.")

		type("ruleset-new-label", "Hollow Hearts")
		expect((document.getElementById("ruleset-new-id") as HTMLInputElement).value).toBe("acme.lab:ruleset/hollow-hearts@1")
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([{ ownerSlug: "acme.lab", name: "hollow-hearts", label: "Hollow Hearts", from: null }])
		feed("rulesets:create", { rulesetId: "acme.lab:ruleset/hollow-hearts@1" })
		await tick()
		expect(gone).toEqual([[`/admin/rulesets/${encodeURIComponent("acme.lab:ruleset/hollow-hearts@1")}`, { replaceState: true }]])
	})

	test("an archetype card says how it decides, what it tracks and holds; picking one sends its id; the rest wait under the fold", () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("rulesets:list", { rulesets: [...LIST, MINE], templates: TEMPLATES })
		expect(text(`[data-start="${TEMPLATES[1]!.id}"]`)).toContain("Decided by: Compare against a target · Spend to succeed · 3 attributes · Bonds, Moods")
		expect(text(`[data-start="${TEMPLATES[2]!.id}"]`)).toContain("Draw a card · 1 attribute · Cards · Deck, Hand, Discard")
		expect(starts("[data-more-starts]")).toEqual([TEMPLATES[0]!.id, "copy", "paste"])
		click(document.querySelector(`[data-start="${TEMPLATES[1]!.id}"] input`))
		expect(text("[data-template-scene]")).toContain("The pier at dusk.")
		expect(text("[data-starting]")).toContain("Starting from Romance.")
		type("ruleset-new-label", "Hearts")
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([{ ownerSlug: "acme.lab", name: "hearts", label: "Hearts", from: TEMPLATES[1]!.id }])
	})

	test("?from=<a ruleset> opens the fold on A copy of rules you have", () => {
		page.url = new URL(`http://localhost/admin/rulesets/new?from=${encodeURIComponent(VIS)}`)
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("rulesets:list", { rulesets: [...LIST, MINE], templates: TEMPLATES })
		expect(picked("copy")).toBe(true)
		expect((document.querySelector("[data-more-starts]") as HTMLDetailsElement).open).toBe(true)
		type("ruleset-new-label", "My Vis")
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([{ ownerSlug: "acme.lab", name: "my-vis", label: "My Vis", from: VIS }])
	})

	test("Paste a document: not JSON is named on the field and nothing is sent; JSON goes as the document", async () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("rulesets:list", { rulesets: [...LIST, MINE], templates: TEMPLATES })
		click(document.querySelector('[data-start="paste"] input'))
		type("ruleset-new-label", "Shared")
		const view = EditorView.findFromDOM(document.querySelector("[data-start-from] ~ details .cm-editor, details .cm-editor") as HTMLElement)!
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "{ not json" } })
		flushSync()
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([])
		expect(text("details")).toContain("That is not a ruleset's JSON")
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: JSON.stringify({ name: { en: "Theirs" }, attributes: [] }) } })
		flushSync()
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([
			{ ownerSlug: "acme.lab", name: "shared", label: "Shared", from: null, document: { name: { en: "Theirs" }, attributes: [] } }
		])
		await tick()
	})

	test("with no owner slug yet, the id asks for one; a refusal about the owner lands on the id", () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("rulesets:list", { rulesets: LIST, templates: [] })
		type("ruleset-new-label", "Hearts")
		expect((document.getElementById("ruleset-new-id") as HTMLInputElement).value).toBe(":ruleset/hearts@1")
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([])
		expect(text("form, main, body")).toContain("Start the id with an owner slug of your own")
		type("ruleset-new-id", "plugin.x:ruleset/hearts@1")
		click(button("Save"))
		expect(sent("rulesets:create")).toEqual([{ ownerSlug: "plugin.x", name: "hearts", label: "Hearts", from: null }])
		feed("rulesets:create:error", { error: "'plugin.x' is an installed plugin's name — a ruleset made here needs an owner name no plugin uses." })
		expect((document.getElementById("ruleset-new-id") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true")
	})
})
