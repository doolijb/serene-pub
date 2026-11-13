/**
 * A panel in the live session (./PanelTabs; PLAN-session-panels-2026-10-14
 * §1.3): a tab strip only when it holds two or more widgets, roving arrow
 * keys across it, every tab mounted (the inactive hidden), a switch that
 * writes the panel's `open` at once, and the panel's backing on its root.
 * No pin and no gear (PLAN 2026-11-05).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, unmount } from "svelte"
import { resolveDrawn, type DrawnPanel, type PanelV2 } from "@serene-pub/sdk"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import PanelTabs from "./PanelTabs.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
	vi.useRealTimers()
})

/** A right-zone panel as the SDK draws it (layout version 2). */
function drawnPanel(p: PanelV2): DrawnPanel {
	return resolveDrawn(
		{
			panels: {
				version: 2,
				left: [],
				middle: [{ key: "p1", tabs: ["messages"] }],
				right: [p]
			}
		},
		{ inline: 1300 }
	).right.panels[0]
}

const pane = createRawSnippet((t: () => { instanceId: string }) => ({
	render: () => `<div class="pane-body" data-tab="${t().instanceId}">${t().instanceId}</div>`
}))
const label = (id: string) => ({ stats: "Stats", places: "Places", album: "Album" })[id] ?? id

function render(
	panel: DrawnPanel,
	over: Record<string, unknown> = {}
): { props: Record<string, any>; onSelect: ReturnType<typeof vi.fn> } {
	const onSelect = vi.fn()
	const props = $state<Record<string, any>>({
		panel,
		label,
		onSelect,
		pane,
		...over
	})
	apps.push(mount(PanelTabs, { target: document.body, props: props as any }))
	flushSync()
	return { props, onSelect }
}
const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
const panes = () => [...document.querySelectorAll<HTMLElement>(".wtab-pane")]

describe("PanelTabs — a strip only when the panel holds two or more tabs", () => {
	test("one tab: no tablist and no controls — the widget alone", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats"] }))
		expect(document.querySelector('[role="tablist"]') === null).toBe(true)
		expect(panes().length).toBe(1)
		expect(document.querySelectorAll("button").length).toBe(0)
	})

	test("two tabs: a tablist, every tab mounted, the inactive hidden", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"], open: "places" }))
		expect(document.querySelector('[role="tablist"]') === null).toBe(false)
		expect(tabs().map((t) => [t.textContent?.trim(), t.getAttribute("aria-selected")])).toEqual([
			["Stats", "false"],
			["Places", "true"]
		])
		expect(panes().map((p) => p.classList.contains("wtab-hidden"))).toEqual([true, false])
		// Both widgets are mounted: switching never reloads one.
		expect(document.querySelectorAll(".pane-body").length).toBe(2)
		// Each pane is labelled by its tab.
		const [first] = panes()
		expect(first.getAttribute("role")).toBe("tabpanel")
		expect(document.getElementById(first.getAttribute("aria-labelledby")!) === tabs()[0]).toBe(true)
	})

	test("only the selected tab is in the tab order", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places", "album"] }))
		expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1])
	})
})

describe("PanelTabs — roving keys", () => {
	test("Right, Left, Home and End choose a tab and move the focus with it", () => {
		const panel = $state({ value: drawnPanel({ key: "r1", tabs: ["stats", "places", "album"] }) })
		const { props, onSelect } = render(panel.value)
		// The parent writes `open` and the panel redraws with it, as the manager does.
		onSelect.mockImplementation((id: string) => {
			props.panel = { ...props.panel, open: id }
		})
		tabs()[0].focus()
		tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
		flushSync()
		expect(onSelect).toHaveBeenLastCalledWith("places")
		expect(document.activeElement === tabs()[1]).toBe(true)
		expect(tabs()[1].getAttribute("aria-selected")).toBe("true")
		tabs()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
		flushSync()
		expect(onSelect).toHaveBeenLastCalledWith("album")
		tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
		flushSync()
		// Wraps to the first.
		expect(onSelect).toHaveBeenLastCalledWith("stats")
		tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
		flushSync()
		expect(onSelect).toHaveBeenLastCalledWith("album")
		tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
		flushSync()
		expect(onSelect).toHaveBeenLastCalledWith("stats")
		expect(document.activeElement === tabs()[0]).toBe(true)
	})

	test("choosing the tab already shown writes nothing", () => {
		const { onSelect } = render(drawnPanel({ key: "r1", tabs: ["stats", "places"] }))
		tabs()[0].click()
		expect(onSelect).not.toHaveBeenCalled()
	})
})

describe("PanelTabs — a switch writes `open` to the session's layout", () => {
	test("through the manager: at once in memory, saved with the debounced blob", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const manager = new SurfaceManager()
		const stored: PanelV2 = { key: "r1", tabs: ["stats", "places"] }
		manager.init(
			1,
			[],
			{
				panels: {
					version: 2,
					left: [],
					middle: [{ key: "p1", tabs: ["messages"] }],
					right: [stored]
				}
			},
			save
		)
		const { props } = render(drawnPanel(stored), {
			onSelect: (tab: string) => {
				manager.setPanelOpen("r1", tab)
				props.panel = drawnPanel((manager.panels as any).right[0])
			}
		})
		tabs()[1].click()
		flushSync()
		expect((manager.panels as any).right[0].open).toBe("places")
		expect(tabs()[1].getAttribute("aria-selected")).toBe("true")
		expect(save).not.toHaveBeenCalled()
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledTimes(1)
		expect(save.mock.calls[0][0].panels.right[0]).toEqual({
			key: "r1",
			tabs: ["stats", "places"],
			open: "places"
		})
	})
})

describe("PanelTabs — the panel is the card", () => {
	test("boxStyle lands on the root and data-backing names the backing", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats"] }), {
			boxStyle: "--sp-widget-radius: 8px",
			backing: "glass"
		})
		const root = document.querySelector<HTMLElement>(".ptabs")!
		expect(root.getAttribute("style")?.includes("--sp-widget-radius: 8px")).toBe(true)
		expect(root.getAttribute("data-backing")).toBe("glass")
	})

	test("no backing is the default", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats"] }))
		expect(document.querySelector(".ptabs")!.getAttribute("data-backing")).toBe("none")
	})

	test("a strip holds tabs and nothing else: no pin, no gear", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"] }))
		expect(document.querySelectorAll("button").length).toBe(2)
		expect(tabs().length).toBe(2)
	})
})
