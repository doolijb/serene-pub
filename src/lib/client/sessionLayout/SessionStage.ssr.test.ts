/**
 * The stage, rendered (session layout v2, P2).
 *
 * The repo has no browser test environment — the whole vitest suite runs on
 * `node` (see `vitest.config.ts`) — and adding one for a flagged renderer would
 * be a dependency in exchange for one assertion. `render` from `svelte/server`
 * needs nothing: it is the same component, the same `resolve` answer and the
 * same markup, minus the effects. That is enough to pin the two things this
 * phase is actually about — the three zones with the templates `resolve`
 * emitted, and ONE mount per unit key.
 *
 * What it cannot see: anything an effect does (the box measurement, the sheet
 * bridge, focus), and anything CSS decides. Those are the parity gate's, by eye.
 */
import { describe, expect, test } from "vitest"
import { render } from "svelte/server"
import { ADVENTURE_LAYOUT } from "@serene-pub/core-catalog"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import SessionStage from "./SessionStage.svelte"

/** Only the four members the stage reads. */
function stubManager(layout: Record<string, unknown>): SurfaceManager {
	return {
		effectiveZoneLayout: layout.zoneLayout,
		effectiveWidgetGrid: layout.widgetGrid,
		effectiveArrangedGrid: layout.arrangedGrid,
		instances: []
	} as unknown as SurfaceManager
}

function renderAdventure(): string {
	return render(SessionStage, {
		props: {
			manager: stubManager(ADVENTURE_LAYOUT),
			sessionId: 1,
			genreId: "core:genre/adventure"
		}
	}).body
}

/** Every `data-unit-key="…"` in the markup, in source order. */
function unitKeys(html: string): string[] {
	return [...html.matchAll(/data-unit-key="([^"]+)"/g)].map((m) => m[1]!)
}

describe("SessionStage", () => {
	test("draws the three zones with the templates resolve emitted", () => {
		const html = renderAdventure()
		for (const zone of ["left", "middle", "right"])
			expect(html).toContain(`data-zone="${zone}"`)

		// The middle's two row extents, as CSS: a strip as tall as its content
		// over a conversation that takes the rest.
		expect(html).toContain("grid-template-rows:auto 1fr")
		// The right column, from the legacy blob's three four-cell bands: the
		// cell module stays a variable, so the tracks follow the reader's zoom
		// instead of pinning themselves to one device's pixels.
		expect(html).toContain(
			"grid-template-rows:calc(4 * var(--sp-cell)) calc(4 * var(--sp-cell)) calc(4 * var(--sp-cell))"
		)
		// A docked side's inline size is its declared extent, as flex.
		expect(html).toContain("flex:0 0 calc(6 * var(--sp-cell))")
		// A declared side with nothing in it costs no box.
		expect(html).toMatch(/data-zone="left"[^>]*data-state="hidden"/)
	})

	test("one mount per unit key, and every unit of the document has one", () => {
		const keys = unitKeys(renderAdventure())
		expect(keys).toEqual([
			"world-state",
			"messages",
			"scene-portraits",
			"stats",
			"inventory"
		])
		// The no-reload law starts here: a key that appears twice is two mounts
		// of one widget, and a resize that swapped between them would reload it.
		expect(new Set(keys).size).toBe(keys.length)
	})

	test("each cell carries its own grid-area, not the document's", () => {
		const html = renderAdventure()
		expect(html).toMatch(
			/data-unit-key="world-state"[\s\S]{0,400}?grid-area:1 \/ 1 \/ 2 \/ 2/
		)
		expect(html).toMatch(
			/data-unit-key="messages"[\s\S]{0,400}?grid-area:2 \/ 1 \/ 3 \/ 2/
		)
	})

	test("the root carries the structural looks and the size it resolved at", () => {
		const html = renderAdventure()
		// ⏳ `chat-core` rides along for the five shared message-state rules in
		// `messageLayouts.css`; it goes with that sheet at P6.
		expect(html).toContain('class="stage chat-core"')
		expect(html).toContain('data-breakpoint="roomy"')
		expect(html).toContain("--sp-cell:2.75rem")
		expect(html).toContain("--sp-rail-width:36px")
	})

	test("an unpinned side is a rail: one icon per unit, and no grid box", () => {
		const html = render(SessionStage, {
			props: {
				manager: stubManager({
					zoneLayout: {
						version: 1,
						zones: {
							left: {
								kind: "side",
								side: "left",
								pinned: false,
								widgets: ["notes"]
							}
						}
					},
					widgetGrid: {
						version: 1,
						cell: 44,
						widgets: [
							{
								id: "messages",
								zone: "middle",
								order: 0,
								size: { w: "grow", h: "grow" }
							}
						]
					}
				}),
				sessionId: 1,
				genreId: "core:genre/chat"
			}
		}).body

		expect(html).toMatch(/data-zone="left"[^>]*data-state="rail"/)
		expect(html).toContain('class="stage-rail"')
		expect(html).toContain('aria-label="Left panels"')
		// The unit keeps its cell — mounted, out of the grid, ready to be a
		// flyout. A rail is not an unmount.
		expect(html).toMatch(/data-unit-key="notes"[^>]*data-rail=""/)
		expect(unitKeys(html)).toEqual(["notes", "messages"])
	})

	test("a session with nothing saved is the conversation and nothing else", () => {
		const html = render(SessionStage, {
			props: {
				manager: stubManager({}),
				sessionId: 1,
				genreId: "core:genre/chat"
			}
		}).body
		expect(unitKeys(html)).toEqual(["messages"])
		expect(html).toContain('data-zone="middle"')
		// No sides declared at all, so neither is drawn.
		expect(html).not.toContain('data-zone="left"')
		expect(html).not.toContain('data-zone="right"')
	})
})
