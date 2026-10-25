/**
 * 🚧 New lorebook's two ways (PLAN-lorebook-kinds §B): **Blank** (name and
 * Rules) or **Start from a starter lorebook**. The choice is drawn only while the
 * pub lists a kit; picking one gives the Rules picker's place to the kit's
 * rules and sends `starterKit` with the create.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
// The Rules picker asks with `awaitReply`; answered at once with two rules.
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async () => ({
		choices: [
			{ id: "core:ruleset/freeform@1", name: "Freeform", subtitle: "" },
			{
				id: "core:ruleset/vis-itineris@1",
				name: "Vis Itineris",
				subtitle: ""
			}
		],
		defaultId: "core:ruleset/freeform@1"
	})
}))

import NewLorebookDialog from "./NewLorebookDialog.svelte"

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
		counts: { entries: 0, places: 0, cast: 0 },
		ownerName: "Ada"
	}
]

let app: ReturnType<typeof mount> | null = null
let confirmed: any[] = []
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	confirmed = []
	document.body.innerHTML = ""
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
	app = mount(NewLorebookDialog, {
		target: document.body,
		props: {
			open: true,
			onOpenChange: () => {},
			onConfirm: (d: unknown) => confirmed.push(d),
			onCancel: () => {}
		}
	})
	await settle()
}

const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const createButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === "Create"
	) ?? null

/** The way's segment: its hidden radio input is what the control listens to. */
function chooseWay(way: "blank" | "kit") {
	const item = q(`[data-new-lorebook-way="${way}"]`)!
	const input = item.querySelector<HTMLInputElement>("input")
	;(input ?? item).click()
}

describe("New lorebook › starter lorebooks", () => {
	test("asks for the kits while open; with none listed, no choice is drawn", async () => {
		await render()
		expect(requests.some((r) => r.key === "starterKits:list")).toBe(true)
		feed("starterKits:list", { kits: [] })
		await settle()
		expect(q("[data-new-lorebook-way]") === null).toBe(true)
		expect(q("[data-book-rules]") === null).toBe(false)
	})

	test("with kits listed, Blank and Start from a starter lorebook are offered; Blank keeps the Rules", async () => {
		await render()
		feed("starterKits:list", { kits: KITS })
		await settle()
		expect(q('[data-new-lorebook-way="blank"]') === null).toBe(false)
		expect(q('[data-new-lorebook-way="kit"]')?.textContent?.trim()).toBe(
			"Start from a starter lorebook"
		)
		expect(q("[data-book-rules]") === null).toBe(false)
		expect(q("[data-starter-kits]") === null).toBe(true)
	})

	test("picking a kit replaces the Rules picker with the kit's rules and sends starterKit", async () => {
		await render()
		feed("starterKits:list", { kits: KITS })
		await settle()
		chooseWay("kit")
		await settle()
		expect(q("[data-starter-kits]") === null).toBe(false)
		// The cards say what each kit is, in the interface's words.
		const admin = q('[data-starter-kit="book:41"]')!
		expect(admin.textContent).toContain("Rules: Freeform")
		expect(admin.textContent).toContain("Made by Ada")
		const core = q('[data-starter-kit="primer:drowned-coast"]')!
		expect(core.textContent).toContain(
			"Holds 12 entries, 3 places and 2 cast members"
		)
		expect(core.textContent).toContain("Comes with Serene Pub")
		core.click()
		await settle()
		expect(q("[data-book-rules]") === null).toBe(true)
		expect(q("[data-new-lorebook-kit-rules]")?.textContent).toContain(
			"Vis Itineris"
		)
		// The kit's name fills the untouched name.
		const name = q("#new-lorebook-name") as HTMLInputElement
		expect(name.value).toBe("The Drowned Coast")
		createButton()!.click()
		await settle()
		expect(confirmed).toHaveLength(1)
		expect(confirmed[0].starterKit).toEqual({ primerId: "drowned-coast" })
		expect(confirmed[0].primaryRuleset).toBeUndefined()
		expect(confirmed[0].name).toBe("The Drowned Coast")
		expect(document.body.textContent?.toLowerCase()).not.toMatch(
			/ruleset|primer|compendium|phantom/
		)
	})

	test("an admin kit travels by its row", async () => {
		await render()
		feed("starterKits:list", { kits: KITS })
		await settle()
		chooseWay("kit")
		await settle()
		q('[data-starter-kit="book:41"]')!.click()
		await settle()
		createButton()!.click()
		await settle()
		expect(confirmed[0].starterKit).toEqual({ lorebookId: 41 })
	})
})
