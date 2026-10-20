/**
 * A panel in the live session (./PanelTabs; PLAN-session-panels-2026-10-14
 * §1.3): a tab strip only when it holds two or more widgets, roving arrow
 * keys across it, every tab mounted (the inactive hidden), a switch that
 * writes the panel's `open` at once, and a pin named for what it does.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, unmount } from "svelte"
import { resolveDrawn, type DrawnPanel, type PanelV1 } from "@serene-pub/sdk"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import PanelTabs from "./PanelTabs.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
	vi.useRealTimers()
})

/** A right-side panel as the SDK draws it. */
function drawnPanel(p: PanelV1): DrawnPanel {
	return resolveDrawn(
		{
			panels: {
				version: 1,
				left: [],
				right: [p],
				middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] }
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
		pinnable: true,
		onSelect,
		onPin: vi.fn(),
		onSettings: vi.fn(),
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
	test("one tab: no tablist — the widget's own chrome, controls in the corner overlay", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats"] }))
		expect(document.querySelector('[role="tablist"]')).toBeNull()
		expect(panes().length).toBe(1)
		expect(document.querySelector(".ptabs-hover")).not.toBeNull()
		expect(document.querySelector('.ptabs-hover button[aria-label="Move to the rail"]')).not.toBeNull()
		expect(document.querySelector('.ptabs-hover button[aria-label="Stats settings"]')).not.toBeNull()
	})

	test("two tabs: a tablist, every tab mounted, the inactive hidden", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"], open: "places" }))
		expect(document.querySelector('[role="tablist"]')).not.toBeNull()
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
		expect(document.getElementById(first.getAttribute("aria-labelledby")!)).toBe(tabs()[0])
		expect(document.querySelector(".ptabs-hover")).toBeNull()
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
		expect(document.activeElement).toBe(tabs()[1])
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
		expect(document.activeElement).toBe(tabs()[0])
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
		const stored: PanelV1 = { key: "r1", tabs: ["stats", "places"] }
		manager.init(
			1,
			[],
			{
				panels: {
					version: 1,
					left: [],
					right: [stored],
					middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] }
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

describe("PanelTabs — the pin and the gear", () => {
	test("a docked panel's pin is 'Move to the rail'; a rail panel's is 'Dock'", () => {
		const onPin = vi.fn()
		const { props } = render(drawnPanel({ key: "r1", tabs: ["stats", "places"] }), { onPin })
		const pin = () =>
			document.querySelector<HTMLButtonElement>('.ptabs-tools button[aria-pressed]')!
		expect(pin().getAttribute("aria-label")).toBe("Move to the rail")
		pin().click()
		expect(onPin).toHaveBeenLastCalledWith(false)
		props.panel = drawnPanel({ key: "r1", tabs: ["stats", "places"], pinned: false })
		flushSync()
		expect(pin().getAttribute("aria-label")).toBe("Dock")
		pin().click()
		expect(onPin).toHaveBeenLastCalledWith(true)
	})

	test("a strip never pins: no pin control", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"] }), { pinnable: false })
		expect(document.querySelector('button[aria-label="Move to the rail"]')).toBeNull()
		expect(document.querySelector('button[aria-label="Dock"]')).toBeNull()
	})

	test("the gear opens the ACTIVE tab's settings", () => {
		const onSettings = vi.fn()
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"], open: "places" }), { onSettings })
		const gear = document.querySelector<HTMLButtonElement>('button[aria-label="Places settings"]')!
		gear.click()
		expect(onSettings).toHaveBeenCalledWith("places", gear)
	})

	test("no controls while the editor is open", () => {
		render(drawnPanel({ key: "r1", tabs: ["stats", "places"] }), { controls: false })
		expect(document.querySelector(".ptabs-tools")).toBeNull()
		expect(document.querySelector('[role="tablist"]')).not.toBeNull()
	})
})
