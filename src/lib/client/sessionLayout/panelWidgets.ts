/**
 * The bridge between the INTERIM zone/panel system (schema.ts + SurfaceManager)
 * and the PLAN-25 widget grid (widgetGrid.ts). Pure translation only: given the
 * currently-resolved side zones and the manager's live panel instances, this
 * describes what each panel LOOKS LIKE as a widget. Nothing here renders
 * anything — it exists to prove "every panel is expressible as a widget"
 * before any live-rendering swap, and it retires once the interim zone system
 * does (staging §13.1: side zones onto the grid is the next real increment
 * after this translation is trusted).
 *
 * Known approximation: the interim system's "drawer" mode (a narrow-width,
 * scrim'd overlay — a width-driven behavior orthogonal to pin state) collapses
 * to `pinned:false` here, the same as "icons". Plan 25 doesn't yet define a
 * distinct narrow-overlay behavior of its own; this bridge doesn't invent one.
 */
import type { PanelInstance } from "../surfaces/types"
import type { ResolvedZone } from "./schema"
import { cellsFromPx, type WidgetConfig, type Zone } from "./widgetGrid"

/**
 * The widgets a set of resolved side zones would carry under the PLAN-25
 * model, given the manager's live panel instances. Strips (top/bottom) are
 * out of scope — Plan 25 has no top/bottom zones, only anchored widgets, and
 * folding strips in is a separate design question, not this bridge's job.
 */
export function widgetsFromSideZones(
	zones: ResolvedZone[],
	instances: PanelInstance[],
	cell: number
): WidgetConfig[] {
	const byId = new Map(instances.map((p) => [p.id, p]))
	const widgets: WidgetConfig[] = []
	for (const z of zones) {
		if (z.def.kind !== "side" || z.mode === "hidden") continue
		const zone: Zone = z.def.side === "left" ? "left" : "right"
		// A docked rail takes layout space (pinned); icons AND the narrow-width
		// drawer overlay both collapse the same way a plan-25 unpinned widget
		// does — see the module doc for why drawer folds in here too.
		const pinned = z.mode === "rail"
		z.def.widgets.forEach((panelId, order) => {
			const inst = byId.get(panelId)
			if (!inst || inst.role === "primary") return
			widgets.push({
				id: panelId,
				zone,
				order,
				...(z.columns > 1 ? { colSpan: z.columns } : {}),
				// The interim rail's single shared pixel width, expressed as the
				// nearest stable cell count (cellsFromPx is built for exactly
				// this: a measured/declared px size -> a whole-cell size).
				size: { w: { cells: cellsFromPx(z.width, cell) }, h: "fixed" },
				// Stacked top-down at full column width with natural height —
				// mirrors today's `.zone-stack` (align-content:start, auto rows).
				anchor: { top: true, left: true, right: true },
				pinned
			})
		})
	}
	return widgets
}
