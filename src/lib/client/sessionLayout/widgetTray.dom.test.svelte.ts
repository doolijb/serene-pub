/**
 * The layout editor's Add menu and Duplicate, on both editors (brief 7b of
 * `PLAN-layout-one-format-2026-09-28`): "we should be able to add more than
 * one of each kind of widget" (owner, 2026-09-29).
 *
 * The tray offers every widget kind every time — a placed kind stays on
 * offer with its count — and turns one away only at its `maxInstances`, with
 * the reason. The phone's Add sheet mints the copy's id itself and lands it
 * in `editPanels`; a tab offers Duplicate, landing the copy after its source.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
import MobileLayoutEditor from "./MobileLayoutEditor.svelte"
import type { TrayWidget } from "./widgetInstances"
import type { PanelLayoutV1 } from "@serene-pub/sdk"
import { UNKNOWN_PANEL } from "./arrangeOps"

const TRAY: TrayWidget[] = [
	{ id: "messages", title: "Messages", icon: "MessagesSquare", placed: 2, full: null },
	{ id: "stats", title: "Stats", icon: "Gauge", placed: 1, full: null },
	{ id: "world-state", title: "World state", placed: 0, full: null },
	{ id: "acme.audio:player", title: "Player", placed: 1, full: "Only one per layout" }
]

const picture = createRawSnippet(() => ({ render: () => `<span class="pv"></span>` }))
const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const chip = (id: string) => document.querySelector<HTMLButtonElement>(`[data-tray-widget="${id}"]`)

function toolbar(over: Record<string, unknown> = {}) {
	const props = $state<Record<string, unknown>>({
		editTab: "arrange",
		insetStart: 0,
		height: 0,
		presets: [],
		startedFrom: null,
		startedFromUpdated: false,
		startAgainFrom: null,
		mainWidgetTitle: "Messages",
		presetUsage: null,
		presetPicture: picture,
		trayWidgets: TRAY,
		trayIcon: () => Icons.Box,
		armedId: null,
		dragOverZone: null,
		onTrayDragStart: () => {},
		draggedId: () => null,
		removeWidget: () => {},
		simTier: null,
		setSimTier: () => {},
		startFrom: () => {},
		resetLayout: () => {},
		savePreset: () => true,
		onCancel: () => {},
		onDone: () => {},
		...over
	})
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(mount(LayoutEditorToolbar, { target: host, props: props as any }))
	return props
}

describe("desktop: the tray offers every widget kind every time", () => {
	test("placed kinds stay on offer, each with its count; a capped one says why", async () => {
		toolbar()
		await settle()
		expect(TRAY.map((t) => text(chip(t.id)))).toEqual([
			"Messages · 2 placed",
			"Stats · 1 placed",
			"World state",
			"Player · 1 placed · Only one per layout"
		])
	})

	test("tapping a placed kind arms it again: adding one more is the ordinary path", async () => {
		const props = toolbar()
		await settle()
		chip("stats")!.click()
		await settle()
		expect(props.armedId).toBe("stats")
	})

	test("a kind at its maxInstances is disabled, and says why", async () => {
		const props = toolbar()
		await settle()
		const full = chip("acme.audio:player")!
		expect(full.disabled).toBe(true)
		expect(full.getAttribute("title")).toBe("Only one per layout")
		expect(full.getAttribute("draggable")).toBe("false")
		full.click()
		await settle()
		expect(props.armedId).toBeNull()
	})
	test("the tray line says a widget can go into a side's rail (§10 R-C), and so does an armed chip's hint", async () => {
		const props = toolbar()
		await settle()
		expect(text(document.querySelector(".palette-tip"))).toContain("onto a side's rail to put it in the rail")
		props.armedId = "stats"
		await settle()
		expect(text(document.querySelector(".palette-hint"))).toBe("tap a panel's tabs, a gap, or a rail to place")
	})
})

/** Messages in the middle, Stats then World state in one right panel. */
const PANELS = (): PanelLayoutV1 => ({
	version: 1,
	left: [],
	middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
	right: [{ key: "p2", tabs: ["stats", "world-state"] }]
})
function phone(over: Record<string, unknown> = {}) {
	const props = $state<Record<string, unknown>>({
		editPanels: PANELS(),
		simTier: null,
		simWidth: null,
		inst: () => undefined,
		iconOf: () => Icons.Box,
		trayIcon: () => Icons.Box,
		middleWidgetIcon: () => Icons.Box,
		widgetLabel: (id: string) => id,
		trayWidgets: TRAY,
		onMinted: vi.fn(),
		presets: [],
		startedFrom: null,
		startedFromUpdated: false,
		startAgainFrom: null,
		startFrom: () => {},
		savePreset: () => true,
		resetLayout: () => {},
		mainWidgetTitle: "Messages",
		onCancel: () => {},
		onDone: () => {},
		presetPicture: picture,
		...over
	})
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(mount(MobileLayoutEditor, { target: host, props: props as any }))
	return props
}
const panels = (props: Record<string, unknown>) =>
	$state.snapshot(props.editPanels) as PanelLayoutV1
const addButtonOf = (zone: string) =>
	[...document.querySelectorAll<HTMLButtonElement>(".medit-zone")]
		.find((z) => text(z.querySelector(".medit-zone-head")).startsWith(zone))
		?.querySelector<HTMLButtonElement>(".medit-zone-head button")
const named = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)

describe("phone: the Add sheet and Duplicate", () => {
	test("the sheet lists every kind, placed ones with their count, a full one disabled", async () => {
		phone()
		await settle()
		addButtonOf("Right")!.click()
		await settle()
		// No hover on a phone: a capped kind says its reason on the row.
		expect(TRAY.map((t) => text(chip(t.id)))).toEqual([
			"Messages · 2 placed",
			"Stats · 1 placed",
			"World state",
			"Player · 1 placed · Only one per layout"
		])
		expect(chip("acme.audio:player")!.disabled).toBe(true)
	})

	test("adding a placed kind mints a copy's id: a new panel from the section, a tab from a row", async () => {
		const props = phone()
		await settle()
		addButtonOf("Right")!.click()
		await settle()
		chip("stats")!.click()
		await settle()
		expect(panels(props).right.map((p) => p.tabs)).toEqual([["stats", "world-state"], ["stats#2"]])
		expect(props.onMinted).toHaveBeenLastCalledWith("stats#2", null)

		named("Add a tab to stats · world-state")!.click()
		await settle()
		chip("stats")!.click()
		await settle()
		expect(panels(props).right.map((p) => p.tabs)).toEqual([
			["stats", "world-state", "stats#3"],
			["stats#2"]
		])
		expect(props.onMinted).toHaveBeenLastCalledWith("stats#3", null)
	})

	test("a tab's Duplicate lands the copy right after its source", async () => {
		const props = phone()
		await settle()
		const dup = named("Duplicate stats")
		expect(dup).toBeTruthy()
		dup!.click()
		await settle()
		expect(panels(props).right.map((p) => p.tabs)).toEqual([["stats", "stats#2", "world-state"]])
		expect(props.onMinted).toHaveBeenCalledWith("stats#2", "stats")
	})

	test("a refused add writes nothing and says why", async () => {
		const props = phone()
		await settle()
		named("Add a tab to stats · world-state")!.click()
		await settle()
		// The panel leaves the layout while the sheet is open.
		const without: PanelLayoutV1 = { ...PANELS(), right: [] }
		props.editPanels = without
		await settle()
		chip("world-state")!.click()
		await settle()
		expect(panels(props)).toEqual(without)
		expect(props.onMinted).not.toHaveBeenCalled()
		expect(text(document.querySelector("[data-medit-notice]"))).toBe(UNKNOWN_PANEL)
	})
})
