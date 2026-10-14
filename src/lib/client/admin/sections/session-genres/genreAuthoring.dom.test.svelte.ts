/**
 * Admin › Genres — a genre made in-app (PLAN-pipeline-canvas-and-genre-
 * authoring §6.2): the Add form sends `sessionGenres:create` with exactly
 * the contract's params and lands on the new genre's change form; the
 * change form of a `pub` genre opens with its Readiness checklist, gold
 * until set, with the one action on the next line — and a shipped genre's
 * has none.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

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
			url: new URL("http://localhost/admin/session-genres/new"),
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
	adminRouter: { setQuery: () => {}, path: "/admin/session-genres" },
	interceptAdminLink: () => {}
}))
// Node's own `localStorage` global has no methods without a backing file;
// AdminList remembers its page size there.
const store = new Map<string, string>()
vi.stubGlobal("localStorage", {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k)
})

import NewPage from "./NewPage.svelte"
import IdPage from "./IdPage.svelte"

const feed = (key: string, msg: unknown) => {
	for (const h of listeners.get(key) ?? []) h(msg)
	flushSync()
}
const ctx = () => new Map<string, unknown>([["userCtx", { user: { id: 1, isAdmin: true } }]])

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	gone.length = 0
})

function type(id: string, value: string) {
	const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	flushSync()
}
const saveButton = () =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Save") as
		| HTMLButtonElement
		| undefined

const GENRES = [
	{ slug: "core:genre/adventure", name: "Adventure", description: "", family: "roleplay", enabled: true, defaultPresetId: 1, presetCount: 1, createSpecSlug: "core:spec/adventure-create" },
	{ slug: "core:genre/chat", name: "Chat", description: "", family: "chat", enabled: true, defaultPresetId: 2, presetCount: 1, createSpecSlug: "core:spec/chat-create" }
]

describe("Admin › Genres › Add genre", () => {
	test("sends sessionGenres:create with the contract's params and lands on the new genre", async () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:list", { genres: GENRES })

		type("genre-new-owner", "acme.lab")
		type("genre-new-name", "quest")
		type("genre-new-label", "Quest")
		type("genre-new-description", "A party on the road.")
		;(document.querySelector('input[name="genre-new-scope"][value="create"]') as HTMLInputElement).click()
		flushSync()
		expect(document.body.textContent).toContain("acme.lab:genre/quest")

		saveButton()!.click()
		flushSync()
		const sent = emitted.filter(([e]) => e === "sessionGenres:create")
		expect(sent).toEqual([
			[
				"sessionGenres:create",
				{
					ownerSlug: "acme.lab",
					name: "quest",
					label: "Quest",
					description: "A party on the road.",
					family: undefined,
					// Chat is the default starting point.
					from: "core:genre/chat",
					scope: "create"
				}
			]
		])

		feed("sessionGenres:create", { genreId: "acme.lab:genre/quest" })
		await tick()
		expect(gone).toEqual([["/admin/session-genres/acme.lab%3Agenre%2Fquest", { replaceState: true }]])
	})

	test("refuses `core` as an owner and sends nothing", () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:list", { genres: GENRES })
		type("genre-new-owner", "core")
		type("genre-new-name", "quest")
		type("genre-new-label", "Quest")
		saveButton()!.click()
		flushSync()
		expect(emitted.some(([e]) => e === "sessionGenres:create")).toBe(false)
		expect(document.body.textContent).toContain("belongs to Serene Pub")
	})

	test("a server refusal about the owner lands on the owner field", () => {
		app = mount(NewPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:list", { genres: GENRES })
		type("genre-new-owner", "acme.lab")
		type("genre-new-name", "quest")
		type("genre-new-label", "Quest")
		saveButton()!.click()
		flushSync()
		feed("sessionGenres:create:error", { error: "The owner slug acme.lab is an installed plugin's." })
		expect(document.getElementById("genre-new-owner")!.getAttribute("aria-invalid")).toBe("true")
	})
})

const headerButtons = () =>
	[...document.querySelectorAll("header button, header a")].map((b) => b.textContent?.trim())

const RESPOND = "core:event/message-respond@1"
function detail(over: Record<string, unknown> = {}) {
	return {
		genre: {
			genreId: "acme.lab:genre/quest",
			name: "Quest",
			description: "A party on the road.",
			family: "roleplay",
			shape: {},
			createSpecSlug: "acme.lab:spec/quest-create",
			enabled: true,
			defaultPresetId: 7,
			origin: "pub",
			editable: true,
			fields: {},
			hasState: true,
			layout: { id: 3, slug: "quest", name: "Quest layout" },
			pluginsEnabled: true,
			...over
		},
		slots: [
			{ event: RESPOND, required: true, open: false, candidates: [{ slug: "acme.lab:spec/quest-respond", name: "Reply" }] }
		],
		presets: [
			{
				id: 7,
				name: "Quest",
				description: null,
				genreId: "acme.lab:genre/quest",
				bindings: {},
				primarySlug: null,
				configSelections: {},
				includedActions: null,
				enabled: true,
				isDefault: true,
				isImmutable: false
			}
		],
		sessionCount: 0,
		swaps: []
	}
}

describe("Admin › Genres › one genre — Readiness", () => {
	test("a pub genre opens with its checklist; only the next line carries the action", () => {
		page.params = { id: encodeURIComponent("acme.lab:genre/quest") }
		app = mount(IdPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:detail", detail())

		const lines = [...document.querySelectorAll("[data-readiness]")]
		expect(lines.map((l) => l.getAttribute("data-readiness"))).toEqual([
			"name", "fields", "create", "reply", "preset", "state", "layout", "events", "export"
		])
		const done = Object.fromEntries(lines.map((l) => [l.getAttribute("data-readiness"), l.getAttribute("data-done")]))
		expect(done).toMatchObject({ name: "true", fields: "false", create: "true", reply: "false", preset: "true", state: "true", layout: "true" })
		const withAction = lines.filter((l) => l.querySelector("button"))
		expect(withAction.map((l) => l.getAttribute("data-readiness"))).toEqual(["fields"])
		expect(withAction[0]!.querySelector("button")!.textContent?.trim()).toBe("Add a field")

		// The authoring cards and Export are there for a pub genre.
		expect(document.getElementById("about")).not.toBeNull()
		expect(document.getElementById("session-fields")).not.toBeNull()
		expect(headerButtons()).toContain("Export as plugin…")
	})

	test("a shipped genre has no checklist and keeps the read-only shape", () => {
		page.params = { id: encodeURIComponent("acme.lab:genre/quest") }
		app = mount(IdPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:detail", detail({ origin: "core", editable: false }))

		expect(document.querySelector("[data-readiness]")).toBeNull()
		expect(document.getElementById("about")).toBeNull()
		expect(document.body.textContent).toContain("Shape")
		expect(headerButtons()).not.toContain("Export as plugin…")
	})

	test("adding a session field and saving sends sessionGenres:update {fields}", async () => {
		page.params = { id: encodeURIComponent("acme.lab:genre/quest") }
		app = mount(IdPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:detail", detail())

		const add = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add a field" && !b.closest("[data-readiness]"))!
		add.click()
		flushSync()
		const key = document.querySelector('#session-fields input[placeholder="goal"]') as HTMLInputElement
		key.value = "goal"
		key.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		const label = document.querySelector('#session-fields input[placeholder="What people read"]') as HTMLInputElement
		label.value = "Goal"
		label.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()

		saveButton()!.click()
		await tick()
		flushSync()
		const sent = emitted.filter(([e]) => e === "sessionGenres:update")
		expect(sent).toEqual([
			["sessionGenres:update", { slug: "acme.lab:genre/quest", fields: { goal: { type: "string", label: "Goal" } } }]
		])
	})

	test("Export as plugin… with Include the source sends scaffold: true", async () => {
		page.params = { id: encodeURIComponent("acme.lab:genre/quest") }
		app = mount(IdPage, { target: document.body, context: ctx() })
		flushSync()
		feed("sessionGenres:detail", detail())

		const open = [...document.querySelectorAll("header button")].find((b) => b.textContent?.trim() === "Export as plugin…") as HTMLButtonElement
		open.click()
		flushSync()
		await tick()
		const box = [...document.querySelectorAll("label")].find((l) => l.textContent?.trim() === "Include the source")?.querySelector("input") as HTMLInputElement
		expect(box).toBeTruthy()
		expect(box.checked).toBe(false)
		box.click()
		flushSync()
		const before = emitted.length
		const go = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Export") as HTMLButtonElement
		go.click()
		flushSync()
		expect(emitted.slice(before)).toEqual([
			["plugins:exportPackage", { genreId: "acme.lab:genre/quest", version: "1.0.0", scaffold: true }]
		])
	})
})
