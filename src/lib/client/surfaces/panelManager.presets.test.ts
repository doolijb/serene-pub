/**
 * The preset base (PLAN 25 redesign) — the read-only floor the three courier
 * slots fall through to.
 *
 * Two properties carry this whole feature and both are pinned here:
 *
 *   • `toBlob` still omits an unset slot, EVEN when a preset supplies one.
 *     If it didn't, a session nobody had customised would start writing a
 *     layout row, and the preset's content would be copied into the user's own
 *     column — a reference silently becoming a stale snapshot.
 *   • a user's own slot always wins. That is why an existing arrangement
 *     cannot be changed by any of this: its slots are set, so the `??`
 *     short-circuits before the base is ever read.
 */
import { describe, expect, it, vi } from "vitest"
import { SurfaceManager } from "./panelManager.svelte"
import {
	arrangementIsEmpty,
	loadArranged,
	unitPinned,
	type Arranged
} from "$lib/client/sessionLayout/arrangedGeometry"

type ModePanel = Sockets.Sessions.View.ModePanel

const PANELS: ModePanel[] = [
	{
		id: "tasks",
		title: "Tasks",
		role: "secondary",
		surface: { kind: "native", component: "sample-notes" },
		defaultActive: false
	}
]

/** A preset that supplies all three arrangement slots. */
const BASE = {
	zoneLayout: { version: 1, from: "preset" },
	widgetGrid: { version: 1, from: "preset" },
	arrangedGrid: { left: { cols: 4, rows: 8, items: [] } }
}

function make(layout: any, base?: Record<string, unknown>, save = () => {}) {
	const m = new SurfaceManager()
	m.init(1, PANELS, layout, save, base)
	return m
}

describe("SurfaceManager — the preset base never serialises", () => {
	it("omits every unset slot from the blob even when the preset supplies one", () => {
		const m = make({}, BASE)
		const blob = m.toBlob()
		expect("zoneLayout" in blob).toBe(false)
		expect("widgetGrid" in blob).toBe(false)
		expect("arrangedGrid" in blob).toBe(false)
		// …and the base itself is not a blob key under any name.
		expect("baseLayout" in blob).toBe(false)
		expect(JSON.stringify(blob)).not.toContain("preset")
	})

	it("keeps the original omission property with no preset at all", () => {
		const m = make({})
		expect("widgetGrid" in m.toBlob()).toBe(false)
	})

	it("setting the base is not itself a persist — no row is written", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({}, undefined, save)
		m.setBaseLayout(BASE)
		vi.advanceTimersByTime(1000)
		expect(save).not.toHaveBeenCalled()
		vi.useRealTimers()
	})

	it("still serialises a slot the USER set, alongside a preset", () => {
		const m = make({}, BASE)
		m.setWidgetGrid({ version: 1, from: "user" })
		const blob = m.toBlob()
		expect(blob.widgetGrid).toEqual({ version: 1, from: "user" })
		expect("zoneLayout" in blob).toBe(false)
	})
})

describe("SurfaceManager — effective reads", () => {
	it("falls through to the preset when the user has set nothing", () => {
		const m = make({}, BASE)
		expect(m.effectiveZoneLayout).toEqual(BASE.zoneLayout)
		expect(m.effectiveWidgetGrid).toEqual(BASE.widgetGrid)
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
	})

	it("the user's own slot wins over the preset's, per slot", () => {
		const m = make({ zoneLayout: { version: 1, from: "user" } }, BASE)
		expect(m.effectiveZoneLayout).toEqual({ version: 1, from: "user" })
		// The slots the user did NOT set still come from the preset.
		expect(m.effectiveWidgetGrid).toEqual(BASE.widgetGrid)
	})

	it("an existing arrangement is IDENTICAL with or without a preset present", () => {
		const saved = {
			zoneLayout: { version: 1, from: "user" },
			widgetGrid: { version: 1, from: "user" },
			arrangedGrid: { right: { cols: 4, rows: 8, items: [] } }
		}
		const before = make(saved)
		const after = make(saved, BASE)
		expect(after.effectiveZoneLayout).toEqual(before.effectiveZoneLayout)
		expect(after.effectiveWidgetGrid).toEqual(before.effectiveWidgetGrid)
		expect(after.effectiveArrangedGrid).toEqual(
			before.effectiveArrangedGrid
		)
		expect(after.toBlob()).toEqual(before.toBlob())
	})

	it("with no preset and no saved layout, every effective read is undefined — today's behaviour", () => {
		const m = make({})
		expect(m.effectiveZoneLayout).toBeUndefined()
		expect(m.effectiveWidgetGrid).toBeUndefined()
		expect(m.effectiveArrangedGrid).toBeUndefined()
	})

	it("the shipped default's empty layout composes to no base at all", () => {
		// `presetBase({})` is undefined, so this is what init actually receives
		// for a user who has never picked a preset.
		const m = make({}, undefined)
		expect(m.baseLayout).toBeUndefined()
		expect(m.effectiveZoneLayout).toBeUndefined()
	})
})

describe("SurfaceManager — clearArrangement", () => {
	it("drops the user's slots so the preset shows through", () => {
		const m = make(
			{ zoneLayout: { from: "user" }, widgetGrid: { from: "user" } },
			BASE
		)
		m.clearArrangement()
		expect(m.effectiveZoneLayout).toEqual(BASE.zoneLayout)
		expect(m.effectiveWidgetGrid).toEqual(BASE.widgetGrid)
	})

	it("leaves the blob asserting no arrangement — not a copy of the preset", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({ zoneLayout: { from: "user" } }, BASE, save)
		m.clearArrangement()
		vi.advanceTimersByTime(500)
		expect(save).toHaveBeenCalledOnce()
		const blob = save.mock.calls[0][0]
		expect("zoneLayout" in blob).toBe(false)
		expect("widgetGrid" in blob).toBe(false)
		expect("arrangedGrid" in blob).toBe(false)
		vi.useRealTimers()
	})

	it("does not disturb panel activation", () => {
		const m = make({ active: [{ id: "tasks", on: true, order: 3 }] }, BASE)
		m.clearArrangement()
		const tasks = m.instances.find((p) => p.id === "tasks")!
		expect(tasks.active).toBe(true)
		expect(tasks.order).toBe(3)
	})
})

/**
 * The arrangement the LIVE session view reads.
 *
 * SessionLayout used to snapshot `effectiveArrangedGrid` once, into a `$state`,
 * at construction — before `+page.svelte` had `init`ed the manager, since the
 * layout blob arrives on `sessions:panelLayout:get` a round trip later. The
 * session remembered its arrangement and the page drew the default until the
 * editor was opened once. It now DERIVES from these reads instead, so each one
 * has to keep answering the current question rather than the one it was first
 * asked: every transition below is a repaint the live view depends on.
 *
 * They pass against today's manager — the slots are `$state` behind getters, so
 * a derived over them already re-runs. That is the property being pinned: cache
 * `effectiveArrangedGrid` into a plain field, or compute it in the constructor,
 * and the live view silently goes back to drawing a stale layout with nothing
 * in this suite to say so.
 */
describe("SurfaceManager — the arrangement reads stay live", () => {
	const SAVED = { middle: { cols: 18, rows: 34, items: [] } }

	it("answers with the layout a LATE init brings, not the empty construction", () => {
		const m = new SurfaceManager()
		// What SessionLayout read at construction, before the socket answered.
		expect(m.effectiveArrangedGrid).toBeUndefined()
		m.init(1, PANELS, { arrangedGrid: SAVED }, () => {})
		expect(m.effectiveArrangedGrid).toEqual(SAVED)
	})

	it("answers with a LATE preset base the same way", () => {
		const m = make({})
		expect(m.effectiveArrangedGrid).toBeUndefined()
		m.setBaseLayout(BASE)
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
	})

	it("follows Done, reset, and a preset applied — in that order", () => {
		const m = make({}, BASE)
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
		// Done commits the editor's arrangement…
		m.setArrangedGrid(SAVED)
		expect(m.effectiveArrangedGrid).toEqual(SAVED)
		// …reset drops it, and the preset shows through again…
		m.clearArrangement()
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
		// …and applying another preset repaints without a Done of any kind.
		const other = { right: { cols: 4, rows: 8, items: [] } }
		m.setBaseLayout({ arrangedGrid: other })
		expect(m.effectiveArrangedGrid).toEqual(other)
	})

	it("stops asserting an arrangement when the active preset is deleted", () => {
		const m = make({}, BASE)
		m.setBaseLayout(undefined)
		expect(m.effectiveArrangedGrid).toBeUndefined()
	})

	it("does not carry one session's arrangement into the next", () => {
		const m = make({ arrangedGrid: SAVED })
		expect(m.effectiveArrangedGrid).toEqual(SAVED)
		m.init(2, PANELS, {}, () => {})
		expect(m.effectiveArrangedGrid).toBeUndefined()
	})
})

/**
 * The empty commit — `SessionLayout.commitArrangement`'s one hazard.
 *
 * Open the editor, press Done, and the editor's working copy is written to the
 * manager. With no widgets at all no zone ever reports, so that copy is `{}` —
 * and `{}` is TRUTHY, so `effectiveArrangedGrid`'s `??` short-circuits on it and
 * the preset base stops being read. Not for this session either: the empty
 * object persists, so the base is masked across reloads with nothing but a reset
 * to undo it, and the manager cannot tell that apart from a real arrangement
 * somebody made.
 *
 * The manager is deliberately NOT where this is decided — `setArrangedGrid` is a
 * courier and stores what it is handed, verbatim (the same contract as the two
 * slots beside it). The decision is the seam's, and `arrangementIsEmpty` is the
 * predicate it makes it with; `done` below is that seam, mirrored.
 */
describe("SurfaceManager — an empty commit must not mask the preset base", () => {
	/** What `commitArrangement` does with the editor's snapshot on Done. */
	function done(m: SurfaceManager, snapshot: Arranged) {
		if (arrangementIsEmpty(snapshot)) m.clearArrangement()
		else m.setArrangedGrid(snapshot)
	}

	it("reads an arrangement with no widgets in it as empty", () => {
		expect(arrangementIsEmpty({})).toBe(true)
		// A zone that reported its cell dims and nothing to put in them.
		expect(
			arrangementIsEmpty({ left: { cols: 4, rows: 8, items: [] } })
		).toBe(true)
		expect(
			arrangementIsEmpty({
				left: { cols: 4, rows: 8, items: [] },
				middle: { cols: 18, rows: 34, items: [] }
			})
		).toBe(true)
		// One widget anywhere is an arrangement.
		expect(
			arrangementIsEmpty({
				middle: {
					cols: 18,
					rows: 34,
					items: [{ id: "composer", x: 0, y: 31, w: 18, h: 3 }]
				}
			})
		).toBe(false)
	})

	it("leaves the preset showing through after Done on an empty editor", () => {
		const m = make({}, BASE)
		done(m, {})
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
	})

	it("leaves it showing through when the zones reported dims but no widgets", () => {
		const m = make({}, BASE)
		// Deliberately NOT the base's own dims: stored verbatim this would
		// pass by coincidence rather than because the base was consulted.
		done(m, { left: { cols: 6, rows: 12, items: [] } })
		expect(m.effectiveArrangedGrid).toEqual(BASE.arrangedGrid)
	})

	it("persists no arrangement at all, so a reload still finds the preset", async () => {
		vi.useFakeTimers()
		const save = vi.fn()
		const m = make({}, BASE, save)
		done(m, {})
		vi.advanceTimersByTime(500)
		const blob = save.mock.calls.at(-1)?.[0] ?? m.toBlob()
		expect("arrangedGrid" in blob).toBe(false)
		expect(make(blob, BASE).effectiveArrangedGrid).toEqual(
			BASE.arrangedGrid
		)
		vi.useRealTimers()
	})

	it("still commits an arrangement that HAS a widget", () => {
		const m = make({}, BASE)
		const real = {
			middle: {
				cols: 18,
				rows: 34,
				items: [{ id: "composer", x: 0, y: 31, w: 18, h: 3 }]
			}
		}
		done(m, real)
		expect(m.effectiveArrangedGrid).toEqual(real)
	})

	/**
	 * The hazard itself, pinned: this is what the seam did before, and what it
	 * must never go back to doing. Passing here is not a bug — it is the courier
	 * contract working exactly as written, which is why the guard lives at the
	 * seam and not in this class.
	 */
	it("(why) an empty object handed to the courier DOES mask the base", () => {
		const m = make({}, BASE)
		m.setArrangedGrid({})
		expect(m.effectiveArrangedGrid).toEqual({})
		expect(m.effectiveArrangedGrid).not.toEqual(BASE.arrangedGrid)
	})
})

/**
 * The per-group pin (ruled 2026-09-10) rides the SAME courier slot: it is a
 * field on the arranged items, so a preset that was saved with a group unpinned
 * hands that back, and a preset saved from a session captures what the session
 * shows. Nothing in the manager knows about it — which is the property worth
 * pinning, because a slot that "just carries the blob" is what makes a new
 * field in the arrangement free.
 */
describe("SurfaceManager — a preset carries the per-group pin", () => {
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

	it("restores it from the preset for a session that has no arrangement", () => {
		const m = make({}, { arrangedGrid: unpinned })
		const items = loadArranged(m.effectiveArrangedGrid).left!.items
		expect(items.map((i) => unitPinned([i]))).toEqual([true, false])
	})

	it("saves it — the preset is written from the EFFECTIVE arrangement", () => {
		const m = make({}, BASE)
		m.setArrangedGrid(unpinned)
		// What `saveLayoutPreset` sends (src/routes/sessions/[id]/+page.svelte).
		const sent = JSON.parse(
			JSON.stringify({ arrangedGrid: m.effectiveArrangedGrid })
		)
		const back = loadArranged(sent.arrangedGrid).left!.items
		expect(unitPinned(back.filter((i) => i.id === "notes"))).toBe(false)
	})

	it("reads a preset saved before the field existed as all pinned", () => {
		const m = make({}, BASE) // BASE's zone has no pin field anywhere
		m.setArrangedGrid({
			left: {
				cols: 9,
				rows: 12,
				items: [{ id: "map", x: 0, y: 0, w: 9, h: 4 }]
			}
		})
		const items = loadArranged(m.effectiveArrangedGrid).left!.items
		expect(unitPinned(items)).toBe(true)
	})
})
