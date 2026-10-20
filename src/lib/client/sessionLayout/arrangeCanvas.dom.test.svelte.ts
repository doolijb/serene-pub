/**
 * The Arrange tab (PLAN-session-panels-2026-10-14, lane 3 and §10): the
 * canvas's drop targets — the rail strips, the dock zone of a rail-only side,
 * the primary as a place — the divider, the status line (no lock, no toast),
 * and the editor's Done diff rule: an untouched layout is never rewritten.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import type { PanelLayoutV1 } from "@serene-pub/sdk"
import ArrangeCanvas, { NARROW_SIDE_PX } from "./ArrangeCanvas.svelte"
import SessionLayoutEditor from "./SessionLayoutEditor.svelte"
import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
import { MIDDLE_EMPTY, addTab, newPanel, removeTab, type ArrangeOutcome } from "./arrangeOps"
import { PANEL_DRAG_TYPE, TAB_DRAG_TYPE, TRAY_DRAG_TYPE, type ArrangeTarget } from "./editorMembership.svelte"
import { createSideRailModel } from "./sideRailModel.svelte"
import { createSessionLayoutModel } from "./sessionLayoutModel.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { coreDefaultWidgets } from "$lib/client/components/sessionPage/coreWidgets"

const apps: ReturnType<typeof mount>[] = []
const roots: (() => void)[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	for (const stop of roots.splice(0)) stop()
	document.body.innerHTML = ""
})
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const LAYOUT: PanelLayoutV1 = {
	version: 1,
	left: [],
	middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
	right: [
		{ key: "p2", tabs: ["stats"] },
		{ key: "p3", tabs: ["lore-entries"] }
	]
}

/** A drag event carrying `data` under its drag types, as a browser's drop would. */
function dragEvent(type: string, data: Record<string, string>) {
	const e = new Event(type, { bubbles: true, cancelable: true })
	Object.defineProperty(e, "dataTransfer", {
		value: {
			getData: (t: string) => data[t] ?? "",
			setData: () => {},
			dropEffect: "move",
			effectAllowed: "move"
		}
	})
	return e
}

function canvas(start: PanelLayoutV1 = LAYOUT) {
	const state = $state<{ panels: PanelLayoutV1; armedId: string | null; dragOverZone: string | null }>({
		panels: start,
		armedId: null,
		dragOverZone: null
	})
	const edit = (o: ArrangeOutcome) => {
		if (!o.layout) return false
		state.panels = o.layout
		return true
	}
	const membership = {
		get armedId() {
			return state.armedId
		},
		set armedId(v: string | null) {
			state.armedId = v
		},
		get dragOverZone() {
			return state.dragOverZone
		},
		set dragOverZone(v: string | null) {
			state.dragOverZone = v
		},
		copyRefusalOf: () => null,
		addWidget: (widget: string, at: ArrangeTarget) =>
			edit(
				"tab" in at
					? addTab(state.panels, widget, at.tab)
					: newPanel(state.panels, widget, at.panel, at.rail ? { pinned: false } : {})
			)
				? widget
				: null,
		duplicateWidget: () => null,
		removeWidget: (id: string) => edit(removeTab(state.panels, id)),
		draggedId: (e: DragEvent) => e.dataTransfer?.getData(TAB_DRAG_TYPE) || null,
		draggedWidget: (e: DragEvent) => e.dataTransfer?.getData(TRAY_DRAG_TYPE) || null
	}
	const rail = createSideRailModel({
		inst: () => undefined,
		iconOf: () => Icons.Box,
		middleWidgetIcon: () => Icons.Box,
		widgetLabel: (id) => id
	})
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(ArrangeCanvas, {
			target: host,
			props: {
				get panels() {
					return state.panels
				},
				edit,
				membership,
				editGeom: { left: 300, centre: 600, right: 300, scale: 1, sideColumns: 1 },
				rail,
				label: (id: string) => id,
				openSettings: () => {}
			}
		})
	)
	return state
}

describe("the Arrange canvas", () => {
	test("dropping a tray widget onto a panel's tab strip adds it as a tab", async () => {
		const state = canvas()
		await settle()
		document
			.querySelector('[data-arrange-strip="p2"]')!
			.dispatchEvent(dragEvent("drop", { [TRAY_DRAG_TYPE]: "chronicle" }))
		await settle()
		expect(state.panels.right[0].tabs).toEqual(["stats", "chronicle"])
		// Now a two-tab panel: its strip draws both.
		expect(document.querySelectorAll('[data-arrange-panel="p2"] [data-arrange-tab]').length).toBe(2)
	})

	test("dropping between panels makes a new panel there", async () => {
		const state = canvas()
		await settle()
		document
			.querySelector('[data-arrange-gap="right:1"]')!
			.dispatchEvent(dragEvent("drop", { [TRAY_DRAG_TYPE]: "chronicle" }))
		await settle()
		expect(state.panels.right.map((p) => p.tabs)).toEqual([["stats"], ["chronicle"], ["lore-entries"]])
	})

	test("dragging a placed tab onto another panel's strip moves it there", async () => {
		const state = canvas()
		await settle()
		document
			.querySelector('[data-arrange-strip="p2"]')!
			.dispatchEvent(dragEvent("drop", { [TAB_DRAG_TYPE]: "lore-entries" }))
		await settle()
		expect(state.panels.right.map((p) => p.tabs)).toEqual([["stats", "lore-entries"]])
	})

	test("no lock and no pin toggle: every tab has a plain ×, and the last Messages goes like any tab", async () => {
		const state = canvas({
			...LAYOUT,
			middle: { ...LAYOUT.middle, below: [{ key: "p4", tabs: ["chronicle"] }] }
		})
		await settle()
		expect(document.querySelector("[data-tab-lock]")).toBeNull()
		expect(document.querySelector("[data-panel-pin]")).toBeNull()
		;(document.querySelector('[data-tab-remove="messages"]') as HTMLButtonElement).click()
		await settle()
		// The nearest middle panel is promoted into the primary.
		expect(state.panels.middle.primary).toEqual({ key: "p4", tabs: ["chronicle"] })
		expect(state.panels.middle.below).toEqual([])
	})

	test("tap-to-place: an armed chip offers every strip and gap", async () => {
		const state = canvas()
		state.armedId = "chronicle"
		await settle()
		;(document.querySelector('[data-place-panel="left:0"]') as HTMLButtonElement).click()
		await settle()
		expect(state.panels.left.map((p) => p.tabs)).toEqual([["chronicle"]])
	})

	test("the divider between two docked side panels moves a twelfth with the arrow keys", async () => {
		const state = canvas()
		await settle()
		const divider = document.querySelector<HTMLElement>('[data-arrange-divider="right:1"]')!
		expect(divider.getAttribute("role")).toBe("separator")
		divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
		await settle()
		expect(state.panels.right.map((p) => p.height)).toEqual([{ share: 7 }, { share: 5 }])
	})

	test("Fit and Fill set a panel's height", async () => {
		const state = canvas()
		await settle()
		;(document.querySelector('[data-height-fit="p2"]') as HTMLButtonElement).click()
		await settle()
		expect(state.panels.right[0].height).toBe("fit")
		;(document.querySelector('[data-height-fill="p2"]') as HTMLButtonElement).click()
		await settle()
		expect("height" in state.panels.right[0]).toBe(false)
	})
})

const at = (sel: string) => document.querySelector(sel)!
const drop = (sel: string, data: Record<string, string>) => at(sel).dispatchEvent(dragEvent("drop", data))

describe("the rail strips (§10 R-A, R-C)", () => {
	test("a panel dropped on a side's rail strip goes in the rail and draws as a rail row", async () => {
		const state = canvas()
		await settle()
		drop('[data-arrange-rail="right"]', { [PANEL_DRAG_TYPE]: "p2" })
		await settle()
		expect(state.panels.right.map((p) => [p.key, p.pinned])).toEqual([
			["p2", false],
			["p3", undefined]
		])
		expect(document.querySelector('[data-arrange-rail-row="p2"]')).not.toBeNull()
		expect(document.querySelector('[data-arrange-panel="p2"]')).toBeNull()
		expect(document.querySelector('[data-arrange-panel="p3"]')).not.toBeNull()
	})

	test("a panel from another place joins the end of that side, in the rail", async () => {
		const state = canvas()
		await settle()
		drop('[data-arrange-rail="left"]', { [PANEL_DRAG_TYPE]: "p3" })
		await settle()
		expect(state.panels.left).toEqual([{ key: "p3", tabs: ["lore-entries"], pinned: false }])
		expect(state.panels.right.map((p) => p.key)).toEqual(["p2"])
	})

	test("a tab dropped on a rail strip is split out into the rail", async () => {
		const state = canvas({
			...LAYOUT,
			right: [{ key: "p2", tabs: ["stats", "lore-entries"] }]
		})
		await settle()
		drop('[data-arrange-rail="right"]', { [TAB_DRAG_TYPE]: "lore-entries" })
		await settle()
		expect(state.panels.right.map((p) => [p.tabs, p.pinned])).toEqual([
			[["stats"], undefined],
			[["lore-entries"], false]
		])
	})

	test("a rail row dragged into a gap of the column is docked there", async () => {
		const state = canvas({
			...LAYOUT,
			right: [
				{ key: "p2", tabs: ["stats"], pinned: false },
				{ key: "p3", tabs: ["lore-entries"] }
			]
		})
		await settle()
		// The gap under p3 counts the whole stack (p2 is index 0, p3 index 1).
		drop('[data-arrange-gap="right:2"]', { [PANEL_DRAG_TYPE]: "p2" })
		await settle()
		expect(state.panels.right).toEqual([
			{ key: "p3", tabs: ["lore-entries"] },
			{ key: "p2", tabs: ["stats"] }
		])
	})

	test("a rail row dropped onto a docked panel's tab strip joins it as a tab", async () => {
		const state = canvas({
			...LAYOUT,
			right: [
				{ key: "p2", tabs: ["stats"], pinned: false },
				{ key: "p3", tabs: ["lore-entries"] }
			]
		})
		await settle()
		drop('[data-arrange-strip="p3"]', { [PANEL_DRAG_TYPE]: "p2" })
		await settle()
		expect(state.panels.right).toEqual([{ key: "p3", tabs: ["lore-entries", "stats"] }])
	})

	test("a side whose every panel is in the rail draws narrow: the strip and one dock zone", async () => {
		const state = canvas({
			...LAYOUT,
			right: [
				{ key: "p2", tabs: ["stats"], pinned: false },
				{ key: "p3", tabs: ["lore-entries", "chronicle"], pinned: false }
			]
		})
		await settle()
		expect(at('[data-arrange-zone="right"]').hasAttribute("data-rail-only")).toBe(true)
		expect((at("[data-arrange-canvas]") as HTMLElement).style.gridTemplateColumns).toBe(
			`300px minmax(0,1fr) ${NARROW_SIDE_PX}px`
		)
		expect(at('[data-arrange-dock="right"]').textContent?.trim()).toBe("Drop here to dock")
		expect(document.querySelectorAll('[data-arrange-zone="right"] [data-arrange-panel]').length).toBe(0)
		// A two-tab rail panel shows its count.
		expect(at('[data-arrange-rail-row="p3"] .arail-count').textContent).toBe("2")
		// An empty side keeps its column, as the session's does.
		expect(at('[data-arrange-zone="left"]').hasAttribute("data-rail-only")).toBe(false)

		drop('[data-arrange-dock="right"]', { [PANEL_DRAG_TYPE]: "p3" })
		await settle()
		expect(state.panels.right.map((p) => [p.key, p.pinned])).toEqual([
			["p2", false],
			["p3", undefined]
		])
		expect(at('[data-arrange-zone="right"]').hasAttribute("data-rail-only")).toBe(false)
		expect((at("[data-arrange-canvas]") as HTMLElement).style.gridTemplateColumns).toBe(
			"300px minmax(0,1fr) 300px"
		)
	})

	test("a tray widget dropped on a rail-only side's dock zone is a new docked panel", async () => {
		const state = canvas({ ...LAYOUT, right: [{ key: "p2", tabs: ["stats"], pinned: false }] })
		await settle()
		drop('[data-arrange-dock="right"]', { [TRAY_DRAG_TYPE]: "chronicle" })
		await settle()
		expect(state.panels.right.map((p) => [p.tabs, p.pinned])).toEqual([
			[["stats"], false],
			[["chronicle"], undefined]
		])
	})

	test("tap-to-place lights the rail: an armed chip can go straight into it", async () => {
		const state = canvas()
		state.armedId = "chronicle"
		await settle()
		const button = at('[data-place-rail="left"]') as HTMLButtonElement
		expect(button.getAttribute("aria-label")).toBe("Add to the rail")
		button.click()
		await settle()
		expect(state.panels.left).toEqual([{ key: "p4", tabs: ["chronicle"], pinned: false }])
	})
})

describe("the primary is a place (§10)", () => {
	test("a panel dropped on the primary's header becomes the primary; the old one goes to the end of above", async () => {
		const state = canvas()
		await settle()
		drop('[data-arrange-make-primary="p1"]', { [PANEL_DRAG_TYPE]: "p2" })
		await settle()
		expect(state.panels.middle.primary).toEqual({ key: "p2", tabs: ["stats"] })
		expect(state.panels.middle.above).toEqual([{ key: "p1", tabs: ["messages"] }])
		expect(state.panels.right.map((p) => p.key)).toEqual(["p3"])
	})

	test("a tab dropped on the primary's strip joins it", async () => {
		const state = canvas()
		await settle()
		drop('[data-arrange-strip="p1"]', { [TAB_DRAG_TYPE]: "stats" })
		await settle()
		expect(state.panels.middle.primary.tabs).toEqual(["messages", "stats"])
	})

	test("the primary's own grip moves it like any panel; the nearest middle panel is promoted", async () => {
		const state = canvas({
			...LAYOUT,
			middle: { ...LAYOUT.middle, below: [{ key: "p4", tabs: ["chronicle"] }] }
		})
		await settle()
		expect(at('[data-arrange-grip="p1"]').getAttribute("draggable")).toBe("true")
		drop('[data-arrange-gap="left:0"]', { [PANEL_DRAG_TYPE]: "p1" })
		await settle()
		expect(state.panels.middle.primary).toEqual({ key: "p4", tabs: ["chronicle"] })
		expect(state.panels.left).toEqual([{ key: "p1", tabs: ["messages"] }])
	})
})

describe("the toolbar", () => {
	test("Layouts and Arrange are the only tabs, and a phone preview offers no Grid", async () => {
		const props = $state<Record<string, unknown>>({
			editTab: "arrange",
			insetStart: 0,
			height: 0,
			presets: [],
			startedFrom: null,
			startedFromUpdated: false,
			startAgainFrom: null,
			presetPicture: (() => {}) as never,
			trayWidgets: [],
			trayIcon: () => Icons.Box,
			armedId: null,
			dragOverZone: null,
			onTrayDragStart: () => {},
			draggedId: () => null,
			removeWidget: () => {},
			simTier: "compact",
			setSimTier: () => {},
			startFrom: () => {},
			resetLayout: () => {},
			savePreset: () => true,
			onCancel: () => {},
			onDone: () => {}
		})
		const host = document.createElement("div")
		document.body.append(host)
		apps.push(mount(LayoutEditorToolbar, { target: host, props: props as never }))
		await settle()
		const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())
		expect(tabs).toEqual(["Layouts", "Arrange"])
		const labels = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim())
		expect(labels).not.toContain("Grid")
		// The Rails lens is gone: the canvas draws each side's rail itself (§10 R-A).
		expect(labels).not.toContain("Rails")
	})
})

describe("the editor's Done", () => {
	function editor() {
		const manager = new SurfaceManager()
		manager.init(
			1,
			coreDefaultWidgets(),
			{ panels: LAYOUT } as never,
			() => {}
		)
		const setPanels = vi.spyOn(manager, "setPanels")
		const onLayout = vi.fn()
		const onClose = vi.fn()
		const flow = { widgetLabel: (id: string) => id } as never
		let model!: ReturnType<typeof createSessionLayoutModel>
		roots.push(
			$effect.root(() => {
				model = createSessionLayoutModel({
					manager,
					editing: true,
					working: null,
					conversationDossier: null,
					panelsCtx: undefined,
					widgetLabel: (id) => id
				})
			})
		)
		const host = document.createElement("div")
		document.body.append(host)
		apps.push(
			mount(SessionLayoutEditor, {
				target: host,
				props: {
					model,
					flow,
					manager,
					sessionId: 1,
					onWorking: () => {},
					onLayout,
					onPutAway: () => {},
					onClose
				}
			})
		)
		return { setPanels, onLayout, onClose }
	}
	const done = () =>
		[...document.querySelectorAll<HTMLButtonElement>(".tool-btn")].find(
			(b) => b.textContent?.trim() === "Done"
		)!

	test("Done without a change writes nothing", async () => {
		const { setPanels, onLayout, onClose } = editor()
		await settle()
		done().click()
		await settle()
		expect(onLayout).not.toHaveBeenCalled()
		expect(setPanels).not.toHaveBeenCalled()
		expect(onClose).toHaveBeenCalledOnce()
	})

	test("a refusal is said on the status line, never a toast, and the next kept edit clears it", async () => {
		const { onLayout } = editor()
		await settle()
		const notice = () => document.querySelector("[data-arrange-notice]")?.textContent?.trim()
		expect(notice()).toBe("")
		;(document.querySelector('[data-tab-remove="messages"]') as HTMLButtonElement).click()
		await settle()
		expect(notice()).toBe(MIDDLE_EMPTY)
		expect(document.querySelector('[data-arrange-panel="p1"]')).not.toBeNull()
		;(document.querySelector('[data-tab-remove="stats"]') as HTMLButtonElement).click()
		await settle()
		expect(notice()).toBe("")
		done().click()
		await settle()
		expect(onLayout).toHaveBeenCalledOnce()
	})

	test("Done after a change writes the panels; Undo puts the edit back first", async () => {
		const { onLayout } = editor()
		await settle()
		;(document.querySelector('[data-tab-remove="stats"]') as HTMLButtonElement).click()
		await settle()
		expect(document.querySelector('[data-arrange-panel="p2"]')).toBeNull()
		;(document.querySelector("[data-editor-undo]") as HTMLButtonElement).click()
		await settle()
		expect(document.querySelector('[data-arrange-panel="p2"]')).not.toBeNull()
		;(document.querySelector('[data-tab-remove="lore-entries"]') as HTMLButtonElement).click()
		await settle()
		done().click()
		await settle()
		expect(onLayout).toHaveBeenCalledOnce()
		const written = onLayout.mock.calls[0][0].panels as PanelLayoutV1
		expect(written.right.map((p) => p.tabs)).toEqual([["stats"]])
	})
})
