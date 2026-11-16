/**
 * 🚧 New lorebook's Keep a timeline switch: drawn on the Blank way only, and
 * only when the parent asks (`asksTimeline`); off each time the dialog opens;
 * sent with the confirm. The kit way sends none.
 *
 * ⚠ No DOM node is ever handed to `expect`.
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
		description: "",
		rulesId: "core:ruleset/vis-itineris@1",
		rulesName: "Vis Itineris",
		counts: { entries: 12, places: 3, cast: 2 }
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
async function render(asksTimeline?: boolean) {
	app = mount(NewLorebookDialog, {
		target: document.body,
		props: {
			open: true,
			onOpenChange: () => {},
			onConfirm: (d: unknown) => confirmed.push(d),
			onCancel: () => {},
			...(asksTimeline === undefined ? {} : { asksTimeline })
		}
	})
	await settle()
}
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const createButton = () =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === "Create"
	) ?? null
async function typeName(v: string) {
	const input = q("#new-lorebook-name") as HTMLInputElement
	input.value = v
	input.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
function chooseWay(way: "blank" | "kit") {
	const item = q(`[data-new-lorebook-way="${way}"]`)!
	;(item.querySelector<HTMLInputElement>("input") ?? item).click()
}

describe("New lorebook › Keep a timeline", () => {
	test("asksTimeline: Blank draws the switch, off, and confirm sends false", async () => {
		await render(true)
		expect(q("[data-new-lorebook-timeline]") === null).toBe(false)
		expect(q("[data-new-lorebook-timeline]")?.textContent).toContain(
			"Keep a timeline"
		)
		expect(
			(q('[data-field="new-lorebook-timeline"] input') as HTMLInputElement)
				.checked
		).toBe(false)
		await typeName("Harbour")
		createButton()!.click()
		await settle()
		expect(confirmed[0].timelineEnabled).toBe(false)
	})

	test("turned on, confirm sends true", async () => {
		await render(true)
		q('[data-field="new-lorebook-timeline"] input')!.click()
		await settle()
		await typeName("Harbour")
		createButton()!.click()
		await settle()
		expect(confirmed[0].timelineEnabled).toBe(true)
	})

	test("the kit way draws no switch and sends none", async () => {
		await render(true)
		feed("starterKits:list", { kits: KITS })
		await settle()
		chooseWay("kit")
		await settle()
		expect(q("[data-new-lorebook-timeline]") === null).toBe(true)
		q('[data-starter-kit="primer:drowned-coast"]')!.click()
		await settle()
		createButton()!.click()
		await settle()
		expect(confirmed).toHaveLength(1)
		expect("timelineEnabled" in confirmed[0]).toBe(false)
	})

	test("without asksTimeline: no switch and no field", async () => {
		await render()
		expect(q("[data-new-lorebook-timeline]") === null).toBe(true)
		await typeName("Harbour")
		createButton()!.click()
		await settle()
		expect("timelineEnabled" in confirmed[0]).toBe(false)
	})
})
