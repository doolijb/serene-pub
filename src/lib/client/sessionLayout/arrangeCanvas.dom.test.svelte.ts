/**
 * The Arrange tab over panels v2: the canvas's three plain stacks and their
 * drop targets, the dividers, Fit · Fill and Priority, the chosen tab, the
 * inspector pane, the status line (no lock, no toast), and the editor's Done
 * diff rule: an untouched layout is never rewritten.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import type { PanelLayoutV2 } from "@serene-pub/sdk"
import ArrangeCanvas from "./ArrangeCanvas.svelte"
import SessionLayoutEditor from "./SessionLayoutEditor.svelte"
import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
import {
	MIDDLE_EMPTY,
	addTab,
	newPanel,
	removeTab,
	type ArrangeOutcome
} from "./arrangeOps"
import {
	PANEL_DRAG_TYPE,
	TAB_DRAG_TYPE,
	TRAY_DRAG_TYPE,
	type ArrangeTarget
} from "./editorMembership.svelte"
import { createSideRailModel } from "./sideRailModel.svelte"
import { createSessionLayoutModel } from "./sessionLayoutModel.svelte"
import { askSettingsInArrange } from "./widgetSettingsFlow.svelte"
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

const LAYOUT: PanelLayoutV2 = {
	version: 2,
	left: [],
	middle: [{ key: "p1", tabs: ["messages"] }],
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

function canvas(start: PanelLayoutV2 = LAYOUT) {
	const state = $state<{
		panels: PanelLayoutV2
		armedId: string | null
		dragOverZone: string | null
		chosen: string | null
		chose: (string | null)[]
	}>({
		panels: start,
		armedId: null,
		dragOverZone: null,
		chosen: null,
		chose: []
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
					: newPanel(state.panels, widget, at.panel)
			)
				? widget
				: null,
		duplicateWidget: () => null,
		removeWidget: (id: string) => edit(removeTab(state.panels, id)),
		draggedId: (e: DragEvent) =>
			e.dataTransfer?.getData(TAB_DRAG_TYPE) || null,
		draggedWidget: (e: DragEvent) =>
			e.dataTransfer?.getData(TRAY_DRAG_TYPE) || null
	}
	const rail = createSideRailModel({
		inst: () => undefined,
		iconOf: () => Icons.Box,
		middleWidgetIcon: () => Icons.Box
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
				editGeom: {
					left: 300,
					centre: 600,
					right: 300,
					scale: 1,
					sideColumns: 1
				},
				rail,
				label: (id: string) => id,
				get chosen() {
					return state.chosen
				},
				onChoose: (id: string | null) => {
					state.chose.push(id)
					state.chosen = id
				}
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
		expect(
			document.querySelectorAll(
				'[data-arrange-panel="p2"] [data-arrange-tab]'
			).length
		).toBe(2)
	})

	test("dropping between panels makes a new panel there", async () => {
		const state = canvas()
		await settle()
		document
			.querySelector('[data-arrange-gap="right:1"]')!
			.dispatchEvent(dragEvent("drop", { [TRAY_DRAG_TYPE]: "chronicle" }))
		await settle()
		expect(state.panels.right.map((p) => p.tabs)).toEqual([
			["stats"],
			["chronicle"],
			["lore-entries"]
		])
	})

	test("dragging a placed tab onto another panel's strip moves it there", async () => {
		const state = canvas()
		await settle()
		document
			.querySelector('[data-arrange-strip="p2"]')!
			.dispatchEvent(
				dragEvent("drop", { [TAB_DRAG_TYPE]: "lore-entries" })
			)
		await settle()
		expect(state.panels.right.map((p) => p.tabs)).toEqual([
			["stats", "lore-entries"]
		])
	})

	test("no lock and no pin toggle: every tab has a plain ×, and the last Messages goes like any tab once something else is in the middle", async () => {
		const state = canvas({
			...LAYOUT,
			middle: [
				{ key: "p1", tabs: ["messages"] },
				{ key: "p4", tabs: ["chronicle"] }
			]
		})
		await settle()
		expect(document.querySelector("[data-tab-lock]") === null).toBe(true)
		expect(document.querySelector("[data-panel-pin]") === null).toBe(true)
		;(
			document.querySelector(
				'[data-tab-remove="messages"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.panels.middle).toEqual([
			{ key: "p4", tabs: ["chronicle"] }
		])
	})

	test("tap-to-place: an armed chip offers every strip and gap", async () => {
		const state = canvas()
		state.armedId = "chronicle"
		await settle()
		;(
			document.querySelector(
				'[data-place-panel="left:0"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.panels.left.map((p) => p.tabs)).toEqual([["chronicle"]])
	})

	test("the middle is drawn like a side: gaps around cards, and a drop in its gap makes a panel there", async () => {
		const state = canvas()
		await settle()
		expect(
			document.querySelectorAll(
				'[data-arrange-zone="middle"] [data-arrange-gap]'
			).length
		).toBe(2)
		expect(
			document.querySelectorAll(
				'[data-arrange-zone="middle"] [data-arrange-panel]'
			).length
		).toBe(1)
		document
			.querySelector('[data-arrange-gap="middle:1"]')!
			.dispatchEvent(dragEvent("drop", { [TRAY_DRAG_TYPE]: "chronicle" }))
		await settle()
		expect(state.panels.middle.map((p) => p.tabs)).toEqual([
			["messages"],
			["chronicle"]
		])
	})

	test("an empty zone draws one filling gap that says where to drop", async () => {
		canvas()
		await settle()
		expect(
			document
				.querySelector('[data-arrange-zone="left"] .agap-fill')
				?.textContent?.trim()
		).toBe("Drop a widget here")
	})

	test("the hint under the middle says how priority gives way", async () => {
		canvas()
		await settle()
		expect(
			document
				.querySelector('[data-arrange-zone="middle"] .azone-note')
				?.textContent?.replace(/\s+/g, " ")
				.trim()
		).toBe(
			"When a zone runs out of height, Low gives way first, then Normal. High keeps its height longest."
		)
	})

	test("the divider between two adjacent fill panels of a side moves a twelfth with the arrow keys", async () => {
		const state = canvas()
		await settle()
		const divider = document.querySelector<HTMLElement>(
			'[data-arrange-divider="right:1"]'
		)!
		expect(divider.getAttribute("role")).toBe("separator")
		divider.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
		)
		await settle()
		expect(state.panels.right.map((p) => p.height)).toEqual([
			{ share: 7 },
			{ share: 5 }
		])
	})

	test("the middle has dividers too: two fill panels, the arrow keys write { share }", async () => {
		const state = canvas({
			...LAYOUT,
			middle: [
				{ key: "p1", tabs: ["messages"] },
				{ key: "p4", tabs: ["notes"] }
			]
		})
		await settle()
		const divider = document.querySelector<HTMLElement>(
			'[data-arrange-divider="middle:1"]'
		)!
		expect(divider === null).toBe(false)
		divider.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })
		)
		await settle()
		expect(state.panels.middle.map((p) => p.height)).toEqual([
			{ share: 5 },
			{ share: 7 }
		])
	})

	test("no divider next to a Fit panel (the Composer declares fit)", async () => {
		canvas({
			...LAYOUT,
			middle: [
				{ key: "p1", tabs: ["messages"] },
				{ key: "p4", tabs: ["composer"] }
			]
		})
		await settle()
		expect(
			document.querySelectorAll(
				'[data-arrange-zone="middle"] [data-arrange-divider]'
			).length
		).toBe(0)
	})

	test("Fit and Fill set a panel's height", async () => {
		const state = canvas({
			...LAYOUT,
			right: [{ key: "p2", tabs: ["notes"] }]
		})
		await settle()
		;(
			document.querySelector(
				'[data-height-fit="p2"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.panels.right[0].height).toBe("fit")
		;(
			document.querySelector(
				'[data-height-fill="p2"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect("height" in state.panels.right[0]).toBe(false)
	})

	test("Fill on a Composer panel writes height: fill; Fit on it writes nothing", async () => {
		const state = canvas({
			...LAYOUT,
			middle: [
				{ key: "p1", tabs: ["messages"] },
				{ key: "p4", tabs: ["composer"] }
			]
		})
		await settle()
		expect(
			document
				.querySelector('[data-height-fit="p4"]')
				?.getAttribute("aria-pressed")
		).toBe("true")
		;(
			document.querySelector(
				'[data-height-fit="p4"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect("height" in state.panels.middle[1]).toBe(false)
		;(
			document.querySelector(
				'[data-height-fill="p4"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.panels.middle[1].height).toBe("fill")
	})

	test("Priority: a Composer panel shows High; Low writes priority: low; High on a High one writes nothing", async () => {
		const state = canvas({
			...LAYOUT,
			middle: [
				{ key: "p1", tabs: ["messages"] },
				{ key: "p4", tabs: ["composer"] }
			]
		})
		await settle()
		const group = document.querySelector(
			'[data-arrange-panel="p4"] [role="group"][aria-label="Priority"]'
		)
		expect(group === null).toBe(false)
		const pressed = (v: string) =>
			document
				.querySelector(`[data-priority-${v}="p4"]`)
				?.getAttribute("aria-pressed")
		expect([pressed("high"), pressed("normal"), pressed("low")]).toEqual([
			"true",
			"false",
			"false"
		])
		;(
			document.querySelector(
				'[data-priority-high="p4"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect("priority" in state.panels.middle[1]).toBe(false)
		;(
			document.querySelector(
				'[data-priority-low="p4"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.panels.middle[1].priority).toBe("low")
		expect([pressed("high"), pressed("normal"), pressed("low")]).toEqual([
			"false",
			"false",
			"true"
		])
	})

	test("clicking a tab's name or its gear chooses it; clicking empty canvas clears the choice", async () => {
		const state = canvas()
		await settle()
		;(
			document.querySelector(
				'[data-arrange-tab="stats"] .atab-name'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.chose).toEqual(["stats"])
		expect(
			document
				.querySelector('[data-arrange-panel="p2"]')
				?.getAttribute("data-chosen")
		).toBe("stats")
		expect(
			document
				.querySelector('[data-arrange-panel="p3"]')
				?.hasAttribute("data-chosen")
		).toBe(false)
		;(
			document.querySelector(
				'[data-tab-settings="lore-entries"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.chose).toEqual(["stats", "lore-entries"])
		expect(
			document
				.querySelector('[data-tab-settings="lore-entries"]')
				?.hasAttribute("aria-haspopup")
		).toBe(false)
		;(
			document.querySelector("[data-arrange-canvas]") as HTMLElement
		).click()
		await settle()
		expect(state.chose).toEqual(["stats", "lore-entries", null])
		// A click inside a card (its tools) is not empty canvas.
		;(
			document.querySelector(
				'[data-height-fit="p2"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(state.chose.length).toBe(3)
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
		apps.push(
			mount(LayoutEditorToolbar, { target: host, props: props as never })
		)
		await settle()
		const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) =>
			t.textContent?.trim()
		)
		expect(tabs).toEqual(["Layouts", "Arrange"])
		const labels = [...document.querySelectorAll("button")].map((b) =>
			b.textContent?.trim()
		)
		expect(labels).not.toContain("Grid")
		// There is no rail: the Rails lens is gone with it.
		expect(labels).not.toContain("Rails")
	})
})

describe("the editor's Done", () => {
	function editor() {
		const manager = new SurfaceManager()
		manager.init(
			1,
			coreDefaultWidgets(true),
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
					onClose
				}
			})
		)
		return { setPanels, onLayout, onClose, model }
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
		const notice = () =>
			document.querySelector("[data-arrange-notice]")?.textContent?.trim()
		expect(notice()).toBe("")
		;(
			document.querySelector(
				'[data-tab-remove="messages"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(notice()).toBe(MIDDLE_EMPTY)
		expect(
			document.querySelector('[data-arrange-panel="p1"]')
		).not.toBeNull()
		;(
			document.querySelector(
				'[data-tab-remove="stats"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(notice()).toBe("")
		done().click()
		await settle()
		expect(onLayout).toHaveBeenCalledOnce()
	})

	test("Done after a change writes the panels; Undo puts the edit back first", async () => {
		const { onLayout } = editor()
		await settle()
		;(
			document.querySelector(
				'[data-tab-remove="stats"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(document.querySelector('[data-arrange-panel="p2"]')).toBeNull()
		;(
			document.querySelector("[data-editor-undo]") as HTMLButtonElement
		).click()
		await settle()
		expect(
			document.querySelector('[data-arrange-panel="p2"]')
		).not.toBeNull()
		;(
			document.querySelector(
				'[data-tab-remove="lore-entries"]'
			) as HTMLButtonElement
		).click()
		await settle()
		done().click()
		await settle()
		expect(onLayout).toHaveBeenCalledOnce()
		const written = onLayout.mock.calls[0][0].panels as PanelLayoutV2
		expect(written.right.map((p) => p.tabs)).toEqual([["stats"]])
	})
	test("moving the middle's only panel to a side says MIDDLE_EMPTY on the status line", async () => {
		const { onLayout } = editor()
		await settle()
		document
			.querySelector('[data-arrange-gap="left:0"]')!
			.dispatchEvent(dragEvent("drop", { [PANEL_DRAG_TYPE]: "p1" }))
		await settle()
		expect(
			document.querySelector("[data-arrange-notice]")?.textContent?.trim()
		).toBe(MIDDLE_EMPTY)
		expect(
			document.querySelector(
				'[data-arrange-zone="middle"] [data-arrange-panel="p1"]'
			) === null
		).toBe(false)
		expect(onLayout).not.toHaveBeenCalled()
	})

	const pane = () => document.querySelector(".edit-inspector")
	const paneTitle = () =>
		pane()?.querySelector(".ai-title")?.textContent?.trim()

	test("with nothing chosen the pane is Layout settings; choosing a tab shows its title; Escape clears the choice", async () => {
		editor()
		await settle()
		expect(paneTitle()).toBe("Layout settings")
		;(
			document.querySelector(
				'[data-arrange-tab="stats"] .atab-name'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(paneTitle()).toBe("stats")
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true
			})
		)
		await settle()
		expect(paneTitle()).toBe("Layout settings")
	})

	test("a Backing change from the pane is one Undo step and is written on Done", async () => {
		const { onLayout } = editor()
		await settle()
		const glass = pane()!.querySelector<HTMLInputElement>(
			'input[type="radio"][value="glass"]'
		)!
		glass.checked = true
		glass.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		expect(
			pane()!.querySelector<HTMLInputElement>(
				'input[type="radio"][value="glass"]'
			)!.checked
		).toBe(true)
		;(
			document.querySelector("[data-editor-undo]") as HTMLButtonElement
		).click()
		await settle()
		expect(
			pane()!.querySelector<HTMLInputElement>(
				'input[type="radio"][value="card"]'
			)!.checked
		).toBe(true)
		const again = pane()!.querySelector<HTMLInputElement>(
			'input[type="radio"][value="glass"]'
		)!
		again.checked = true
		again.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		done().click()
		await settle()
		expect(onLayout).toHaveBeenCalledOnce()
		expect(
			(onLayout.mock.calls[0][0].panels as PanelLayoutV2).backing
		).toBe("glass")
	})

	test("the style overlay's ask (askSettingsInArrange) switches to Arrange and chooses that tab", async () => {
		const { model } = editor()
		await settle()
		model.editTab = "layouts"
		await settle()
		askSettingsInArrange("stats")
		await settle()
		expect(model.editTab).toBe("arrange")
		expect(
			document
				.querySelector('[data-arrange-panel="p2"]')
				?.getAttribute("data-chosen")
		).toBe("stats")
	})
})
