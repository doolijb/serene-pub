/**
 * 🚧 Admin › Starter lorebooks (PLAN-lorebook-kinds §B): every kit on the pub.
 * A kit that comes with the pub (core's, a plugin's) offers Clone alone; an
 * admin kit offers Open in Lorebooks (to the admin who made it), Clone and
 * Delete. Delete asks first, naming the kit; Clone asks for a name.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, listen, emitted, jumps } = vi.hoisted(() => {
	const listeners = new Map<string, Set<(msg: any) => void>>()
	return {
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			let set = listeners.get(key)
			if (!set) listeners.set(key, (set = new Set()))
			set.add(handler)
			return () => set!.delete(handler)
		},
		emitted: [] as Array<[string, any]>,
		jumps: [] as any[]
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
	getAdminInterestContext: () => ({
		declareInterest: listen,
		requestWithInterest: (key: string, _params: unknown, handler: any) =>
			listen(key, handler)
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		info: () => {},
		success: () => {},
		warning: () => {}
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: { url: new URL("http://localhost/admin/starter-lorebooks") },
	adminRouter: {
		setQuery: () => {},
		path: "/admin/starter-lorebooks",
		go: () => {}
	},
	interceptAdminLink: () => {}
}))
vi.mock("$lib/client/shell/openJumpHit", () => ({
	openJumpHit: (_ctx: unknown, hit: unknown) => {
		jumps.push(hit)
		return Promise.resolve()
	}
}))

import Page from "./Page.svelte"

const KITS = [
	{
		id: "primer:drowned-coast",
		source: "core",
		name: "The Drowned Coast",
		description: "A storm-wrecked shore.",
		rulesId: "core:ruleset/vis-itineris@1",
		rulesName: "Vis Itineris",
		counts: { entries: 12, places: 3, cast: 2 }
	},
	{
		id: "book:41",
		source: "admin",
		name: "Harbour Town",
		description: "",
		rulesId: "core:ruleset/freeform@1",
		rulesName: "Freeform",
		counts: { entries: 4, places: 0, cast: 0 },
		ownerName: "Ada",
		mine: true
	},
	{
		id: "book:42",
		source: "admin",
		name: "Bram's Keep",
		description: "",
		rulesId: "core:ruleset/freeform@1",
		rulesName: "Freeform",
		counts: { entries: 1, places: 1, cast: 1 },
		ownerName: "Bram"
	}
]

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	jumps.length = 0
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function feed(key: string, msg: unknown) {
	for (const h of listeners.get(key) ?? []) h(msg)
}

async function render() {
	app = mount(Page, {
		target: document.body,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }],
			[
				"panelsCtx",
				{ openPanel: () => {}, openView: () => {}, digest: {} }
			]
		])
	})
	await settle()
	feed("starterKits:list", { kits: KITS })
	await settle()
}

/** The action buttons in one kit's row, by their data attribute. */
const actionsOf = (id: string) => {
	// A row may draw twice (table and stacked); the first is enough.
	const cell = document.querySelector(`[data-kit-actions="${id}"]`)
	if (cell === null) return null
	return [...cell.querySelectorAll("button")].map((b) =>
		b.hasAttribute("data-kit-open")
			? "open"
			: b.hasAttribute("data-kit-clone")
				? "clone"
				: b.hasAttribute("data-kit-delete")
					? "delete"
					: "?"
	)
}

describe("Admin › Starter lorebooks", () => {
	test("asks for the kits with interest declared, and lists every one", async () => {
		await render()
		expect(listeners.has("starterKits:list")).toBe(true)
		expect(document.body.textContent).toContain("The Drowned Coast")
		expect(document.body.textContent).toContain("Harbour Town")
		expect(document.body.textContent).toContain("Bram's Keep")
	})

	test("a kit that comes with the pub offers Clone alone", async () => {
		await render()
		expect(actionsOf("primer:drowned-coast")).toEqual(["clone"])
	})

	test("an admin kit offers Open in Lorebooks to its maker, Clone and Delete", async () => {
		await render()
		expect(actionsOf("book:41")).toEqual(["open", "clone", "delete"])
		// Another admin's kit: Clone and Delete (it opens only for its maker).
		expect(actionsOf("book:42")).toEqual(["clone", "delete"])
		document
			.querySelector<HTMLButtonElement>(
				'[data-kit-actions="book:41"] [data-kit-open]'
			)!
			.click()
		await settle()
		expect(jumps).toEqual([
			{ kind: "lorebook", id: 41, title: "Harbour Town" }
		])
	})

	test("Delete asks first, naming the kit, then sends starterKits:delete", async () => {
		await render()
		document
			.querySelector<HTMLButtonElement>(
				'[data-kit-actions="book:41"] [data-kit-delete]'
			)!
			.click()
		await settle()
		expect(document.body.textContent).toContain(
			'Delete the starter lorebook "Harbour Town"?'
		)
		expect(emitted.some(([e]) => e === "starterKits:delete")).toBe(false)
		const confirm = [
			...document.querySelectorAll<HTMLButtonElement>("button")
		].find((b) => b.textContent?.trim() === "Delete starter lorebook")
		expect(confirm === undefined).toBe(false)
		confirm!.click()
		await settle()
		expect(emitted).toContainEqual([
			"starterKits:delete",
			{ lorebookId: 41 }
		])
	})

	test("Clone asks for a name and sends it with the kit's card id", async () => {
		await render()
		document
			.querySelector<HTMLButtonElement>(
				'[data-kit-actions="primer:drowned-coast"] [data-kit-clone]'
			)!
			.click()
		await settle()
		const input = document.querySelector<HTMLInputElement>("#name-input")
		expect(input === null).toBe(false)
		input!.value = "Coast of my own"
		input!.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		const create = [
			...document.querySelectorAll<HTMLButtonElement>("button")
		].find((b) =>
			/^(Create|Confirm|Save|OK)$/.test(b.textContent?.trim() ?? "")
		)
		expect(create === undefined).toBe(false)
		create!.click()
		await settle()
		expect(emitted).toContainEqual([
			"starterKits:clone",
			{ id: "primer:drowned-coast", name: "Coast of my own" }
		])
	})
})

describe("Admin › Starter lorebooks, provided books (M2e)", () => {
	const PRIMER = {
		id: "book:7",
		source: "core",
		name: "Ninth Mile",
		description: "",
		rulesId: "core:ruleset/freeform@1",
		rulesName: "Freeform",
		counts: { entries: 2, places: 0, cast: 0 },
		provided: {
			pluginId: "core",
			slug: "core:primer/ninth-mile@1",
			disabled: false
		}
	}
	const sw = () =>
		document.querySelector<HTMLInputElement>(
			'input[role="switch"][aria-label="Enabled: Ninth Mile"]'
		)!

	test("a primer row has an Enabled switch and no Delete; pressing it emits at once", async () => {
		await render()
		feed("starterKits:list", { kits: [PRIMER, ...KITS] })
		await settle()
		expect(actionsOf("book:7")).toEqual(["clone"])
		expect(sw().checked).toBe(true)
		sw().click()
		await settle()
		expect(emitted).toContainEqual([
			"plugins:disableProvidedBook",
			{ pluginId: "core", slug: "core:primer/ninth-mile@1" }
		])
	})

	test("a disabled primer reads Disabled and Enable emits enable", async () => {
		await render()
		feed("starterKits:list", {
			kits: [
				{ ...PRIMER, provided: { ...PRIMER.provided, disabled: true } }
			]
		})
		await settle()
		expect(sw().checked).toBe(false)
		expect(
			document
				.querySelector('[data-kit-actions="book:7"]')!
				.textContent!.includes("Disabled")
		).toBe(true)
		sw().click()
		await settle()
		expect(emitted).toContainEqual([
			"plugins:enableProvidedBook",
			{ pluginId: "core", slug: "core:primer/ninth-mile@1" }
		])
	})

	describe("a refused switch says why", () => {
		const errs = () =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					"[data-kit-switch-error]"
				)
			)

		test("the pressing tab shows the server's sentence in the row, only there", async () => {
			await render()
			feed("starterKits:list", { kits: [PRIMER, ...KITS] })
			await settle()
			sw().click()
			await settle()
			feed("plugins:disableProvidedBook:error", {
				error: "Only admin users can manage plugins."
			})
			await settle()
			const found = errs()
			expect(found.length).toBeGreaterThan(0)
			const first = found[0]
			expect(first.getAttribute("role")).toBe("alert")
			expect(first.textContent).toContain(
				"Only admin users can manage plugins."
			)
			const actions = document.querySelector(
				'[data-kit-actions="book:7"]'
			)!
			expect(actions.parentElement!.contains(first)).toBe(true)
			for (const e of found) {
				expect(
					e.parentElement!.querySelector(
						'[data-kit-actions="book:7"]'
					)
				).not.toBeNull()
			}
		})

		test("the next successful answer clears it", async () => {
			await render()
			feed("starterKits:list", { kits: [PRIMER, ...KITS] })
			await settle()
			sw().click()
			await settle()
			feed("plugins:disableProvidedBook:error", { error: "no" })
			await settle()
			expect(errs().length).toBeGreaterThan(0)
			sw().click()
			await settle()
			feed("plugins:disableProvidedBook", {
				pluginId: "core",
				slug: PRIMER.provided.slug,
				disabled: true,
				lorebookId: 7
			})
			await settle()
			expect(errs()).toEqual([])
		})

		test("another tab's refusal shows nothing here", async () => {
			await render()
			feed("starterKits:list", { kits: [PRIMER, ...KITS] })
			await settle()
			feed("plugins:enableProvidedBook:error", { error: "x" })
			await settle()
			expect(errs()).toEqual([])
		})

		test("an error with no sentence falls back to the server's own", async () => {
			await render()
			feed("starterKits:list", {
				kits: [
					{
						...PRIMER,
						provided: { ...PRIMER.provided, disabled: true }
					}
				]
			})
			await settle()
			sw().click()
			await settle()
			feed("plugins:enableProvidedBook:error", {})
			await settle()
			expect(errs()[0].textContent).toContain(
				"The lorebook could not be enabled."
			)
		})
	})

	test("an admin kit has no switch and keeps Delete", async () => {
		await render()
		expect(document.querySelector("[data-kit-switch]")).toBeNull()
		expect(actionsOf("book:42")).toEqual(["clone", "delete"])
	})
})
