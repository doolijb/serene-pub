/**
 * The surface manager under the copy model (brief 3 of
 * `PLAN-layout-one-format-2026-09-28`) and the panels
 * (PLAN-session-panels-2026-10-14): it holds the session's WHOLE layout — the
 * first open copied a starting point into the person's own row — and nothing
 * sits under it.
 *
 *   • `init` seeds the arrangement from the row: `panels` when it has them,
 *     and the ⏳ old slots READ ONLY beside them;
 *   • `toBlob` hands back the panels it holds and NEVER the old slots (the
 *     server patches by key presence, so the row keeps them, inert);
 *   • a copy landing re-seeds the manager, and `seedCount` is how an open
 *     editor knows its working copy is stale;
 *   • a debounced save still waiting when a copy is asked for is dropped, so
 *     it cannot land after the copy and write the old layout back.
 */
import type { PanelLayoutV1 } from "@serene-pub/sdk"
import { describe, expect, it, vi } from "vitest"
import { SurfaceManager } from "./panelManager.svelte"

type ModePanel = Sockets.Sessions.View.ModePanel

const PANELS: ModePanel[] = [
	{
		id: "tasks",
		title: "Tasks",
		role: "secondary",
		surface: { kind: "remote", owner: "core", component: "sample-notes" }
	}
]

const panels = (over: Partial<PanelLayoutV1> = {}): PanelLayoutV1 => ({
	version: 1,
	left: [],
	right: [],
	middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
	...over
})

/** A row saved before the panels: the three old slots. */
const OLD = {
	zoneLayout: { version: 1, zones: {} },
	widgetGrid: { version: 1, cell: 44, widgets: [] },
	arrangedGrid: { left: { cols: 4, rows: 8, items: [] } }
}

function make(layout: any, save: (blob: any) => void = () => {}) {
	const m = new SurfaceManager()
	m.init(1, PANELS, layout, save)
	return m
}

describe("SurfaceManager — the session's layout is the whole layout", () => {
	it("seeds the panels from the row and serialises them", () => {
		const p = panels({ right: [{ key: "p2", tabs: ["tasks"] }] })
		const m = make({ panels: p })
		expect(m.panels).toEqual(p)
		expect(m.toBlob().panels).toEqual(p)
	})

	it("reads the old slots, and never writes them back", () => {
		const m = make(OLD)
		expect(m.zoneLayout).toEqual(OLD.zoneLayout)
		expect(m.arrangedGrid).toEqual(OLD.arrangedGrid)
		const blob = m.toBlob()
		for (const slot of ["zoneLayout", "widgetGrid", "arrangedGrid", "panels"])
			expect(slot in blob).toBe(false)
	})

	it("leaves an unset arrangement unset — the floor draws it, nothing is borrowed", () => {
		const m = make({})
		expect(m.panels).toBeUndefined()
		expect("panels" in m.toBlob()).toBe(false)
	})

	it("has no base to layer, and no old-slot writers: the retired names are gone", () => {
		const m = make(OLD) as unknown as Record<string, unknown>
		for (const name of [
			"baseLayout",
			"setBaseLayout",
			"effectiveZoneLayout",
			"effectiveWidgetGrid",
			"effectiveArrangedGrid",
			"clearArrangement",
			"setZoneLayout",
			"setWidgetGrid",
			"setArrangedGrid"
		])
			expect(name in m).toBe(false)
	})
})

describe("SurfaceManager — a copy replaces the layout", () => {
	it("counts every seeding, so an open editor can tell its copy is stale", () => {
		const m = make({ panels: panels() })
		const before = m.seedCount
		m.init(1, PANELS, {}, () => {})
		expect(m.seedCount).toBe(before + 1)
		expect(m.panels).toBeUndefined()
	})

	it("drops a pending save without sending it", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ panels: panels() }, save)
		m.setPanels(panels({ right: [{ key: "p2", tabs: ["tasks"] }] }))
		m.cancelPendingSave()
		vi.advanceTimersByTime(1000)
		expect(save).not.toHaveBeenCalled()
		// …and the next change schedules a save as usual.
		m.setPanels(panels())
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})

	it("says whether it dropped one, and a refused copy sends it after all", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ panels: panels() }, save)
		// Nothing waiting: nothing to give back.
		expect(m.cancelPendingSave()).toBe(false)
		const dragged = panels({ left: [{ key: "p2", tabs: ["tasks"] }] })
		m.setPanels(dragged)
		expect(m.cancelPendingSave()).toBe(true)
		// The copy was refused, so the edit is still this session's layout.
		m.persistNow()
		expect(save).toHaveBeenCalledTimes(1)
		expect(save.mock.calls[0][0].panels).toEqual(dragged)
		// …sent once, not again when the old debounce would have fired.
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})

	it("persistNow replaces a save still waiting rather than adding one", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ panels: panels() }, save)
		m.setPanels(panels({ right: [{ key: "p2", tabs: ["tasks"] }] }))
		m.persistNow()
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})
})

describe("SurfaceManager — a panel's tab and pin, from the session", () => {
	const two = () =>
		panels({
			right: [
				{ key: "p2", tabs: ["tasks", "notes"] },
				{ key: "p3", tabs: ["album"], pinned: false }
			]
		})

	it("switching a tab writes `open` at once, saved with the debounced blob", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ panels: two() }, save)
		m.setPanelOpen("p2", "notes")
		// At once: the drawn layout reads it on the next frame.
		expect((m.panels as PanelLayoutV1).right[0].open).toBe("notes")
		expect(save).not.toHaveBeenCalled()
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledTimes(1)
		expect(save.mock.calls[0][0].panels.right[0].open).toBe("notes")
		// Back to the first tab: `open` is left out again.
		m.setPanelOpen("p2", "tasks")
		expect("open" in (m.panels as PanelLayoutV1).right[0]).toBe(false)
		vi.useRealTimers()
	})

	it("a tab the panel does not hold, or the one already open, writes nothing", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ panels: two() }, save)
		m.setPanelOpen("p2", "album")
		m.setPanelOpen("p2", "tasks")
		m.setPanelOpen("nope", "tasks")
		vi.advanceTimersByTime(1000)
		expect(save).not.toHaveBeenCalled()
	})

	it("the pin docks a side panel or moves it to the rail; `false` is the only value written", () => {
		const m = make({ panels: two() })
		m.setPanelPinned("p3", true)
		expect("pinned" in (m.panels as PanelLayoutV1).right[1]).toBe(false)
		m.setPanelPinned("p2", false)
		expect((m.panels as PanelLayoutV1).right[0].pinned).toBe(false)
		// The middle never pins.
		m.setPanelPinned("p1", false)
		expect("pinned" in (m.panels as PanelLayoutV1).middle.primary).toBe(false)
	})

	it("a first edit of a row with only the old slots writes the converted panels", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(
			{
				arrangedGrid: {
					right: {
						cols: 1,
						rows: 12,
						items: [
							{ id: "tasks", x: 0, y: 0, w: 1, h: 12, group: "g:notes,tasks" },
							{ id: "notes", x: 0, y: 0, w: 1, h: 12, group: "g:notes,tasks" }
						]
					}
				}
			},
			save
		)
		const key = "p2"
		m.setPanelOpen(key, "notes")
		vi.advanceTimersByTime(500)
		const blob = save.mock.calls[0][0]
		expect(blob.panels.right[0]).toMatchObject({ key, tabs: ["tasks", "notes"], open: "notes" })
		// The old slots stay on the row, never written.
		expect("arrangedGrid" in blob).toBe(false)
		vi.useRealTimers()
	})
})
