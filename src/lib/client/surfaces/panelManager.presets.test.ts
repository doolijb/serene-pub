/**
 * The surface manager under the copy model (brief 3 of
 * `PLAN-layout-one-format-2026-09-28`): it holds the session's WHOLE layout —
 * the first open copied a starting point into the person's own row — and
 * nothing sits under it. What the old preset base did is gone with it:
 *
 *   • `init` seeds every slot from the row, and `toBlob` hands back exactly
 *     the slots it holds (an unset one stays unset);
 *   • a copy landing re-seeds the manager, and `seedCount` is how an open
 *     editor knows its working copy is stale;
 *   • a debounced save still waiting when a copy is asked for is dropped, so
 *     it cannot land after the copy and write the old layout back.
 */
import type { ArrangedGridV1 } from "@serene-pub/sdk"
import { describe, expect, it, vi } from "vitest"
import { SurfaceManager } from "./panelManager.svelte"
import {
	arrangementIsEmpty,
	loadArranged,
	unitPinned
} from "$lib/client/sessionLayout/arrangedGeometry"

type ModePanel = Sockets.Sessions.View.ModePanel

const PANELS: ModePanel[] = [
	{
		id: "tasks",
		title: "Tasks",
		role: "secondary",
		surface: { kind: "remote", owner: "core", component: "sample-notes" },
		defaultActive: false
	}
]

/** A session layout that sets all three arrangement slots. */
const WHOLE = {
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
	it("seeds every slot from the row and serialises exactly those", () => {
		const m = make(WHOLE)
		expect(m.zoneLayout).toEqual(WHOLE.zoneLayout)
		expect(m.widgetGrid).toEqual(WHOLE.widgetGrid)
		expect(m.arrangedGrid).toEqual(WHOLE.arrangedGrid)
		const blob = m.toBlob()
		expect(blob.zoneLayout).toEqual(WHOLE.zoneLayout)
		expect(blob.widgetGrid).toEqual(WHOLE.widgetGrid)
		expect(blob.arrangedGrid).toEqual(WHOLE.arrangedGrid)
	})

	it("leaves an unset slot unset — the floor draws it, nothing is borrowed", () => {
		const m = make({})
		expect(m.zoneLayout).toBeUndefined()
		expect(m.widgetGrid).toBeUndefined()
		expect(m.arrangedGrid).toBeUndefined()
		const blob = m.toBlob()
		expect("zoneLayout" in blob).toBe(false)
		expect("widgetGrid" in blob).toBe(false)
		expect("arrangedGrid" in blob).toBe(false)
	})

	it("has no base to layer: the retired names are gone", () => {
		const m = make(WHOLE) as unknown as Record<string, unknown>
		for (const name of [
			"baseLayout",
			"setBaseLayout",
			"effectiveZoneLayout",
			"effectiveWidgetGrid",
			"effectiveArrangedGrid",
			"clearArrangement"
		])
			expect(name in m).toBe(false)
	})
})

describe("SurfaceManager — a copy replaces the layout", () => {
	it("counts every seeding, so an open editor can tell its copy is stale", () => {
		const m = make(WHOLE)
		const before = m.seedCount
		m.init(1, PANELS, {}, () => {})
		expect(m.seedCount).toBe(before + 1)
		expect(m.arrangedGrid).toBeUndefined()
	})

	it("drops a pending save without sending it", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(WHOLE, save)
		m.setArrangedGrid({ right: { cols: 1, rows: 12, items: [] } })
		m.cancelPendingSave()
		vi.advanceTimersByTime(1000)
		expect(save).not.toHaveBeenCalled()
		// …and the next change schedules a save as usual.
		m.setArrangedGrid(undefined)
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})

	it("says whether it dropped one, and a refused copy sends it after all", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(WHOLE, save)
		// Nothing waiting: nothing to give back.
		expect(m.cancelPendingSave()).toBe(false)
		const dragged = { right: { cols: 1, rows: 12, items: [] } }
		m.setArrangedGrid(dragged)
		expect(m.cancelPendingSave()).toBe(true)
		// The copy was refused, so the drag is still this session's layout.
		m.persistNow()
		expect(save).toHaveBeenCalledTimes(1)
		expect(save.mock.calls[0][0].arrangedGrid).toEqual(dragged)
		// …sent once, not again when the old debounce would have fired.
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})

	it("persistNow replaces a save still waiting rather than adding one", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(WHOLE, save)
		m.setArrangedGrid({ right: { cols: 1, rows: 12, items: [] } })
		m.persistNow()
		vi.advanceTimersByTime(1000)
		expect(save).toHaveBeenCalledTimes(1)
		vi.useRealTimers()
	})
})

/**
 * The empty commit — `SessionLayout.commitArrangement`'s one hazard. Open the
 * editor, press Done with no widgets at all and no zone ever reports, so the
 * working copy is `{}` — TRUTHY, and stored it would read as "this layout has
 * an arrangement". The seam stores none instead; `done` below mirrors it.
 */
describe("SurfaceManager — an empty commit stores no arrangement", () => {
	/** What `commitArrangement` does with the editor's snapshot on Done. */
	function done(m: SurfaceManager, snapshot: ArrangedGridV1) {
		m.setArrangedGrid(arrangementIsEmpty(snapshot) ? undefined : snapshot)
	}

	it("reads an arrangement with no widgets in it as empty", () => {
		expect(arrangementIsEmpty({})).toBe(true)
		expect(
			arrangementIsEmpty({ left: { cols: 4, rows: 8, items: [] } })
		).toBe(true)
		expect(
			arrangementIsEmpty({
				middle: {
					cols: 18,
					rows: 34,
					items: [{ id: "world-state", x: 0, y: 31, w: 18, h: 3 }]
				}
			})
		).toBe(false)
	})

	it("persists no arrangement after Done on an empty editor", () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make(WHOLE, save)
		done(m, { left: { cols: 6, rows: 12, items: [] } })
		vi.advanceTimersByTime(500)
		const blob = save.mock.calls.at(-1)?.[0] ?? m.toBlob()
		expect("arrangedGrid" in blob).toBe(false)
		// The other slots are the layout's own and stay.
		expect(blob.zoneLayout).toEqual(WHOLE.zoneLayout)
		vi.useRealTimers()
	})

	it("still commits an arrangement that HAS a widget", () => {
		const m = make({})
		const real = {
			middle: {
				cols: 18,
				rows: 34,
				items: [{ id: "world-state", x: 0, y: 31, w: 18, h: 3 }]
			}
		}
		done(m, real)
		expect(m.arrangedGrid).toEqual(real)
	})
})

/**
 * The per-group pin (ruled 2026-09-10) rides the arrangement slot: it is a
 * field on the arranged items, so a layout copied in hands it back and Save as
 * new captures what the session shows. Nothing in the manager knows about it —
 * which is the property worth pinning.
 */
describe("SurfaceManager — the arrangement carries the per-group pin", () => {
	const unpinned = {
		left: {
			cols: 9,
			rows: 12,
			items: [
				{ id: "map", x: 0, y: 0, w: 9, h: 4 },
				{ id: "notes", x: 0, y: 4, w: 9, h: 4, pinned: false }
			]
		}
	}

	it("restores it from a copied-in layout", () => {
		const m = make({ arrangedGrid: unpinned })
		const items = loadArranged(m.arrangedGrid).left!.items
		expect(items.map((i) => unitPinned([i]))).toEqual([true, false])
	})

	it("saves it — Save as new sends the manager's own arrangement", () => {
		const m = make({})
		m.setArrangedGrid(unpinned)
		// What `saveLayoutPreset` sends (src/routes/sessions/[id]/+page.svelte).
		const sent = JSON.parse(JSON.stringify({ arrangedGrid: m.arrangedGrid }))
		const back = loadArranged(sent.arrangedGrid).left!.items
		expect(unitPinned(back.filter((i) => i.id === "notes"))).toBe(false)
	})

	it("reads an arrangement saved before the field existed as all pinned", () => {
		const m = make({
			arrangedGrid: {
				left: {
					cols: 9,
					rows: 12,
					items: [{ id: "map", x: 0, y: 0, w: 9, h: 4 }]
				}
			}
		})
		const items = loadArranged(m.arrangedGrid).left!.items
		expect(unitPinned(items)).toBe(true)
	})
})
