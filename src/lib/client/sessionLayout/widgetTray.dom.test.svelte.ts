/**
 * The layout editor's Add menu and Duplicate, on both editors (brief 7b of
 * `PLAN-layout-one-format-2026-09-28`): "we should be able to add more than
 * one of each kind of widget" (owner, 2026-09-29).
 *
 * The tray offers every widget kind every time — a placed kind stays on
 * offer with its count — and turns one away only at its `maxInstances`, with
 * the reason. The phone's Add sheet lands the id the layout minted, and a row
 * offers Duplicate.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
import MobileLayoutEditor from "./MobileLayoutEditor.svelte"
import type { TrayWidget } from "./widgetInstances"

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
		editTab: "move",
		insetStart: 0,
		height: 0,
		presets: [],
		startedFrom: null,
		startedFromUpdated: false,
		startAgainFrom: null,
		mainWidgetTitle: "Messages",
		presetUsage: null,
		presetPicture: picture,
		styleableWidgets: [],
		trayWidgets: TRAY,
		trayIcon: () => Icons.Box,
		armedId: null,
		dragOverZone: null,
		onTrayDragStart: () => {},
		draggedId: () => null,
		removeWidget: () => {},
		simTier: null,
		setSimTier: () => {},
		railPreview: false,
		simGrid: false,
		simNarrow: false,
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
})

const frame = (ids: string[]) => ({
	cols: 1,
	rows: Math.max(1, ids.length * 3),
	items: ids.map((id, i) => ({ id, x: 0, y: i * 3, w: 1, h: 3 }))
})
function phone(over: Record<string, unknown> = {}) {
	const props = $state<Record<string, unknown>>({
		editArranged: {},
		leftPreview: { frame: frame([]), units: [] },
		rightPreview: { frame: frame(["stats"]), units: [] },
		middlePreview: { frame: frame(["messages"]), units: [] },
		simTier: null,
		simWidth: null,
		simSnapshot: null,
		leftZoneId: "left",
		rightZoneId: "right",
		groupOpen: {},
		groupKey: (side: string, key: string) => `${side}:${key}`,
		inst: () => undefined,
		iconOf: () => Icons.Box,
		trayIcon: () => Icons.Box,
		middleWidgetIcon: () => Icons.Box,
		widgetLabel: (id: string) => id,
		trayWidgets: TRAY,
		addWidget: vi.fn(() => "stats#2"),
		duplicateWidget: vi.fn(() => "stats#2"),
		removeWidget: () => {},
		floorNoteOf: () => null,
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
const addButtonOf = (zone: string) =>
	[...document.querySelectorAll<HTMLButtonElement>(".medit-zone")]
		.find((z) => text(z.querySelector(".medit-zone-head")).startsWith(zone))
		?.querySelector<HTMLButtonElement>(".medit-zone-head button")

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

	test("adding a placed kind lands the minted copy's cells, not the widget id's", async () => {
		const props = phone()
		await settle()
		addButtonOf("Right")!.click()
		await settle()
		chip("stats")!.click()
		await settle()
		expect(props.addWidget).toHaveBeenCalledWith("right", "stats")
		const right = (props.editArranged as any).right
		expect(right.items.map((i: { id: string }) => i.id)).toEqual(["stats", "stats#2"])
	})

	test("a row's Duplicate asks the layout for a copy and lands it after the rest", async () => {
		const props = phone()
		await settle()
		const dup = document.querySelector<HTMLButtonElement>('[aria-label="Duplicate stats"]')
		expect(dup).toBeTruthy()
		dup!.click()
		await settle()
		expect(props.duplicateWidget).toHaveBeenCalledWith("stats")
		const right = (props.editArranged as any).right
		expect(right.items.map((i: { id: string }) => i.id)).toEqual(["stats", "stats#2"])
	})

	test("a refused add or duplicate writes nothing", async () => {
		const props = phone({ duplicateWidget: vi.fn(() => null) })
		await settle()
		document.querySelector<HTMLButtonElement>('[aria-label="Duplicate stats"]')!.click()
		await settle()
		expect((props.editArranged as any).right).toBeUndefined()
	})
})
