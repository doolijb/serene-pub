import { describe, it, expect, vi } from "vitest"
import type { WidgetEvent } from "$lib/shared/widgets/context"
import { SurfaceManager } from "./panelManager.svelte"

type ModePanel = Sockets.Sessions.View.ModePanel

const PANELS: ModePanel[] = [
	{
		id: "tasks",
		title: "Tasks",
		role: "secondary",
		surface: { kind: "native", component: "sample-notes" },
		channels: ["tasks"],
		defaultActive: false
	},
	{
		id: "portraits",
		title: "Portraits",
		role: "secondary",
		surface: { kind: "native", component: "scene-portraits" },
		defaultActive: true
	}
]

function make(save = () => {}) {
	const m = new SurfaceManager()
	m.init(1, PANELS, {}, save)
	return m
}

describe("SurfaceManager — activation", () => {
	it("seeds a synthetic primary and honors defaultActive", () => {
		const m = make()
		expect(m.instances.find((p) => p.role === "primary")).toBeTruthy()
		expect(m.instances.find((p) => p.id === "portraits")!.active).toBe(true)
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})

	it("addable lists inactive, non-primary panels", () => {
		const m = make()
		expect(m.addable.map((p) => p.id)).toEqual(["tasks"])
	})
})

describe("SurfaceManager — channel-driven autopopulation (21 §9)", () => {
	it("activates the panel that views a channel when a message lands", () => {
		const m = make()
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		m.activateForChannel("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	it("ignores main and unknown channels, and is idempotent", () => {
		const m = make()
		m.activateForChannel("main")
		m.activateForChannel(null)
		m.activateForChannel("nope")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		m.activateForChannel("tasks")
		m.activateForChannel("tasks") // no throw, stays active
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	/**
	 * Lanes (ruling 2026-09-09): the panel is a view onto the **channel**, so
	 * the second conversation opening in it is the same panel flowing in. A
	 * panel that only matched the bare slug would sit closed while its own
	 * channel filled up.
	 */
	it("matches on the channel, whichever lane the message landed on", () => {
		const m = make()
		m.activateForChannel("tasks:4")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
	})

	it("still ignores main, whichever lane of it", () => {
		const m = make()
		m.activateForChannel("main:3")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})
})

describe("SurfaceManager — explicit intents + persistence", () => {
	it("applyOpenIntent activates and persists (debounced)", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(save)
		m.applyOpenIntent("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(true)
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledOnce()
		const blob = save.mock.calls[0][0]
		expect(blob.active.find((a: any) => a.id === "tasks").on).toBe(true)
		vi.useRealTimers()
	})

	it("couriers the widget grid: init reads it, setWidgetGrid persists it in the blob", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = new SurfaceManager()
		// init rehydrates from the blob…
		m.init(1, PANELS, { widgetGrid: { version: 1, seeded: true } }, save)
		expect(m.widgetGrid).toEqual({ version: 1, seeded: true })
		// …and an edit persists (debounced) verbatim inside the same blob.
		m.setWidgetGrid({ version: 1, edited: true })
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledOnce()
		expect(save.mock.calls[0][0].widgetGrid).toEqual({
			version: 1,
			edited: true
		})
		vi.useRealTimers()
	})

	it("omits widgetGrid from the blob when never set", () => {
		const m = make()
		expect("widgetGrid" in m.toBlob()).toBe(false)
	})

	it("applyCloseIntent deactivates a panel", () => {
		const m = make()
		m.activate("tasks")
		m.applyCloseIntent("tasks")
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
	})

	it("never closes the primary", () => {
		const m = make()
		const primaryId = m.instances.find((p) => p.role === "primary")!.id
		m.close(primaryId)
		expect(m.instances.find((p) => p.id === primaryId)!.active).toBe(true)
	})
})

describe("SurfaceManager — the Layout menu operations", () => {
	it("secondaryPanels lists all non-primary panels (active or not)", () => {
		const m = make()
		expect(m.secondaryPanels.map((p) => p.id).sort()).toEqual([
			"portraits",
			"tasks"
		])
	})

	it("collapse-all / expand-all toggles every collapsible secondary", () => {
		const m = make()
		m.activate("tasks")
		m.setAllCollapsed(true)
		expect(m.allCollapsed).toBe(true)
		expect(
			m.instances.filter((p) => p.role !== "primary").every((p) => p.collapsed)
		).toBe(true)
		m.setAllCollapsed(false)
		expect(m.allCollapsed).toBe(false)
	})

	it("reset restores mode defaults — activation, drawer, and sizes", () => {
		const m = make()
		m.setWidth(1600)
		m.activate("tasks") // not a default
		m.toggleDrawer("portraits")
		m.resizeColumn(0, 0.5)
		m.resetLayout()
		// tasks back off (defaultActive false), portraits back on & on-grid
		expect(m.instances.find((p) => p.id === "tasks")!.active).toBe(false)
		expect(m.instances.find((p) => p.id === "portraits")!.active).toBe(true)
		expect(m.instances.find((p) => p.id === "portraits")!.drawered).toBe(
			false
		)
		expect(m.colFr).toEqual({})
	})
})

describe("SurfaceManager — tier + columns", () => {
	it("derives tier from container width", () => {
		const m = make()
		m.setWidth(500)
		expect(m.tier).toBe("compact")
		m.setWidth(1200)
		expect(m.tier).toBe("roomy")
		m.setWidth(1600)
		expect(m.tier).toBe("wide")
	})

	it("resizeColumn shifts fr weight and refuses to starve a column", () => {
		const m = make()
		m.setWidth(1600) // wide → 4 columns
		m.resizeColumn(0, 0.5)
		expect(m.columns[0]).toBeGreaterThan(m.columns[1])
		// A huge shift that would drop a column below the floor is refused.
		const before = [...m.columns]
		m.resizeColumn(0, -10)
		expect(m.columns).toEqual(before)
	})
})

/**
 * The manager is the SESSION-level event source every widget bus fans out from
 * (PLAN 25). It is the one thing that already sees channel activity — the page
 * calls `activateForChannel` for every message that lands — so it is where
 * `channel:activated` is born rather than a second subscription of its own.
 */
describe("SurfaceManager — the widget event source", () => {
	it("announces a channel when a panel viewing it is surfaced", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("tasks")
		expect(seen).toEqual([
			{ kind: "channel:activated", channel: "tasks", slug: "tasks", lane: 1 }
		])
	})

	it("carries the lane, canonically (lane 1 is the bare slug)", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("tasks:4")
		expect(seen[0]).toMatchObject({
			channel: "tasks:4",
			slug: "tasks",
			lane: 4
		})
	})

	it("says nothing when nothing was surfaced — main, unknown, already open", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe((e) => seen.push(e))
		m.activateForChannel("main") // the anchored log never autopopulates
		m.activateForChannel("nope") // no panel views it
		m.activateForChannel(null)
		m.activateForChannel("tasks") // → one event
		m.activateForChannel("tasks") // already open: not a new arrival on screen
		expect(seen).toHaveLength(1)
	})

	it("unsubscribe stops delivery", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		const off = m.subscribe((e) => seen.push(e))
		off()
		m.activateForChannel("tasks")
		expect(seen).toEqual([])
	})

	it("one subscriber throwing cannot rob the next of its event", () => {
		const m = make()
		const seen: WidgetEvent[] = []
		m.subscribe(() => {
			throw new Error("widget blew up")
		})
		m.subscribe((e) => seen.push(e))
		expect(() => m.activateForChannel("tasks")).not.toThrow()
		expect(seen).toHaveLength(1)
	})
})
