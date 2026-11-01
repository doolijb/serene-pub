/**
 * Start a session › applet genres (M2c): choosing one opens its launcher, "Use the start form" keeps this form,
 * and an applet's own create-session request collapses to a one-press confirm.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }))
vi.mock("$app/navigation", () => ({ goto: gotoMock }))

const { listeners, requests, socket } = vi.hoisted(() => ({
	listeners: new Map<string, Array<(msg: any) => void>>(),
	requests: [] as Array<{ key: string; params: any }>,
	socket: { emit: () => {}, on: () => {}, off: () => {} }
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => listeners.set(key, (listeners.get(key) ?? []).filter((h) => h !== handler))
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (key: string, params: unknown, handler: (msg: any) => void) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} }
}))

import StartSessionForm from "./StartSessionForm.svelte"

const APPLET = "acme.cards:genre/solitaire"
const PLAIN = "core:genre/story"
const SHAPE = { characters: { min: 0, max: 3 }, personas: { min: 0, max: 1 } }

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	gotoMock.mockReset()
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const feed = (key: string, msg: unknown) => {
	for (const h of listeners.get(key) ?? []) h(msg)
}

async function render(prefill?: any) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		props: { onCreated: () => {}, onCancel: () => {}, sessions: [] as any, prefill }
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{ genreId: PLAIN, name: "Story", description: "", shape: SHAPE },
			{
				genreId: APPLET,
				name: "Solitaire",
				description: "",
				shape: {
					...SHAPE,
					applet: true,
					view: "acme.cards",
					fields: { deck: { type: "text", label: "Deck" }, seed: { type: "number", label: { en: "Seed" } } }
				},
				appletTitle: "Card Table"
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{ id: 1, genreId: PLAIN, name: "Plain", enabled: true, isDefault: true },
			{ id: 2, genreId: APPLET, name: "Plain", enabled: true, isDefault: true }
		]
	})
	feed("characters:list", { characterList: [] })
	feed("lorebooks:list", { lorebookList: [] })
	await settle()
}

const radio = (id: string) =>
	host.querySelector<HTMLButtonElement>(`[data-genre-card="${id}"] button[role="radio"]`)!

describe("Start a session › applet genres", () => {
	test("choosing an applet genre opens its launcher", async () => {
		await render()
		radio(APPLET).click()
		await settle()
		expect(gotoMock).toHaveBeenCalledWith("/apps/acme.cards")
		expect(radio(APPLET).getAttribute("aria-checked")).toBe("false")
	})

	test("a plain genre does not", async () => {
		await render()
		radio(PLAIN).click()
		await settle()
		expect(gotoMock).not.toHaveBeenCalled()
	})

	test("Use the start form keeps the generic form", async () => {
		await render()
		host.querySelector<HTMLButtonElement>(`[data-use-start-form="${APPLET}"]`)!.click()
		await settle()
		expect(gotoMock).not.toHaveBeenCalled()
		expect(radio(APPLET).getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[data-use-start-form]")).toBeNull()
	})

	test("an applet's own request collapses to a confirm with Change", async () => {
		await render({ genreId: APPLET, fromApplet: "acme.cards", fields: {} })
		expect(gotoMock).not.toHaveBeenCalled()
		const confirm = host.querySelector("[data-applet-confirm]")
		expect(confirm).not.toBeNull()
		expect(confirm!.textContent).toContain("Start Solitaire")
		const change = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Change…"))!
		change.click()
		await settle()
		expect(host.querySelector("[data-applet-confirm]")).toBeNull()
		expect(host.querySelector("[data-genre-card]")).not.toBeNull()
	})

	test("the confirm lists the applet's field values under the genre's declared labels (2026-10-31)", async () => {
		await render({ genreId: APPLET, fromApplet: "acme.cards", fields: { deck: "Classic", seed: 7, stray: "x" } })
		const rows = [...host.querySelectorAll("[data-applet-confirm] [data-applet-field]")].map((li) =>
			li.textContent?.replace(/\s+/g, " ").trim()
		)
		expect(rows).toEqual(["Deck: Classic", "Seed: 7"])
	})

	test("the confirm's Start sends the create request", async () => {
		await render({ genreId: APPLET, fromApplet: "acme.cards" })
		const start = [...host.querySelectorAll<HTMLButtonElement>("[data-applet-confirm] button")].find((b) =>
			b.textContent?.includes("Start Solitaire")
		)!
		start.click()
		await settle()
		expect(requests.some((r) => r.key === "sessions:create")).toBe(true)
	})
})
