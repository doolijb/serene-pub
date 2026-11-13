/**
 * 🚧 (s22-V) Admin › Rulesets: a row shows how each enabled genre rates it
 * ("Genre fit"); a ruleset no genre rates shows nothing, never a dash.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans, strings and plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, request } = vi.hoisted(() => {
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
		request: (key: string, _params: unknown, handler: (msg: any) => void) =>
			listen(key, handler)
	}
})
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
	toaster: {
		error: () => {},
		warning: () => {},
		info: () => {},
		success: () => {}
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => Promise.resolve(),
	adminPage: { url: new URL("http://localhost/admin/rulesets"), params: {} },
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

import Page from "./Page.svelte"

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
})

const row = (
	rulesetId: string,
	label: string,
	over: Record<string, unknown> = {}
) => ({
	rulesetId,
	label,
	name: label,
	description: "",
	origin: "core",
	state: "shipped",
	version: null,
	draftChanged: false,
	draftFindings: 0,
	rollsDice: false,
	decides: false,
	playedBy: { sessions: 0, lorebooks: 0 },
	pluginName: null,
	...over
})
const FITS = [
	{
		genreId: "story",
		genreName: "Story",
		rating: "great",
		reason: "everything it plays best with is here"
	},
	{
		genreId: "lair",
		genreName: "Lair",
		rating: "good",
		reason: "a health-like number — told in words"
	},
	{
		genreId: "crawler",
		genreName: "Dungeon Crawler",
		rating: "poor",
		reason: "most of what it plays best with is missing"
	}
]

describe("Admin › Rulesets › genre fit", () => {
	test("a rated ruleset shows its fit line; an unrated one shows nothing, never a dash", () => {
		app = mount(Page, {
			target: document.body,
			context: new Map<string, unknown>([
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		})
		flushSync()
		for (const h of [...(listeners.get("rulesets:list") ?? [])]) {
			h({
				rulesets: [
					row("core:ruleset/vis-itineris@1", "Vis Itineris", {
						rulesetFitByGenre: FITS
					}),
					row("core:ruleset/freeform@1", "Freeform")
				]
			})
		}
		flushSync()

		const fitOf = (label: string) => {
			const li = [...document.querySelectorAll("tr, li")].find(
				(el) =>
					el.textContent?.includes(label) &&
					!el.querySelector("tr, li")
			)
			return [...(li?.querySelectorAll("[data-rules-fit]") ?? [])].map(
				(e) => e.textContent?.replace(/\s+/g, " ").trim()
			)
		}
		const rated = fitOf("Vis Itineris")
		expect(rated.length).toBeGreaterThan(0)
		expect(rated[0]).toBe(
			"Story: Great · Lair: Good · Dungeon Crawler: Poor"
		)
		expect(fitOf("Freeform")).toEqual([])
		const unrated = [...document.querySelectorAll("tr, li")].find(
			(el) =>
				el.textContent?.includes("Freeform") &&
				!el.querySelector("tr, li")
		)
		expect(unrated?.textContent?.includes("—") ?? false).toBe(false)
	})
})
