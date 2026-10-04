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
import type { GridWidget, ZoneId } from "@serene-pub/sdk"
import type { PanelInstance } from "../surfaces/types"
import type { ResolvedZone } from "./schema"
import { cellsFromPx } from "./widgetGrid"

/**
 * The widgets a set of resolved side zones would carry under the PLAN-25
 * model, given the manager's live panel instances. Strips (top/bottom) are
 * out of scope — Plan 25 has no top/bottom zones, only anchored widgets, and
 * folding strips in is a separate design question, not this bridge's job.
 *
 * Placement is free (brief 7a): a side may hold the conversation — any
 * `messages` instance, the bare id included, which is drawn like the log and
 * is never a panel instance (`isConversation` says which ids those are) — and
 * a genre's own primary panel (R71). Both GROW down the rail: a conversation
 * given its content height would have no box of its own to scroll in.
 */
export function widgetsFromSideZones(
	zones: ResolvedZone[],
	instances: PanelInstance[],
	cell: number,
	isConversation: (id: string) => boolean = () => false
): GridWidget[] {
	const byId = new Map(instances.map((p) => [p.id, p]))
	const widgets: GridWidget[] = []
	for (const z of zones) {
		if (z.def.kind !== "side" || z.mode === "hidden") continue
		const zone: ZoneId = z.def.side === "left" ? "left" : "right"
		// A docked rail takes layout space (pinned); icons AND the narrow-width
		// drawer overlay both collapse the same way a plan-25 unpinned widget
		// does — see the module doc for why drawer folds in here too.
		const pinned = z.mode === "rail"
		z.def.widgets.forEach((panelId, order) => {
			const inst = byId.get(panelId)
			const conversation = isConversation(panelId)
			if (!inst && !conversation) return
			const grows = conversation || inst?.role === "primary"
			widgets.push({
				id: panelId,
				zone,
				order,
				...(z.columns > 1 ? { colSpan: z.columns } : {}),
				// The interim rail's single shared pixel width, expressed as the
				// nearest stable cell count (cellsFromPx is built for exactly
				// this: a measured/declared px size -> a whole-cell size).
				size: {
					w: { cells: cellsFromPx(z.width, cell) },
					h: grows ? "grow" : "fixed"
				},
				// Stacked top-down at full column width with natural height —
				// mirrors today's `.zone-stack` (align-content:start, auto rows).
				anchor: { top: true, left: true, right: true },
				pinned
			})
		})
	}
	return widgets
}

/**
 * One widget a side or strip zone draws: a panel instance, or a conversation
 * (`panel: null`) — any `messages` instance, which is never a panel instance
 * and draws through the log's own renderer wherever it sits.
 */
export interface ZoneEntry {
	id: string
	title: string
	icon?: string
	panel: PanelInstance | null
}

/**
 * What a zone's widget list draws, lists and counts, in the list's order:
 * every id that names a panel instance (a genre's own primary included, R71)
 * or a conversation (`isConversation`), and nothing that names neither (a
 * plugin since disabled, a retired id).
 *
 * ONE reader for the rail, the icon strip, the strips, the editor's side
 * lists, the side counts and the phone's panels menu (brief 7a). The rail used
 * to keep panel instances alone, so a side holding only a Messages widget drew
 * nothing on the desktop and opened blank on the phone.
 */
export function zoneEntries(
	ids: readonly string[],
	instances: readonly PanelInstance[],
	isConversation: (id: string) => boolean,
	conversationTitle: (id: string) => string
): ZoneEntry[] {
	const byId = new Map(instances.map((p) => [p.id, p]))
	const out: ZoneEntry[] = []
	for (const id of ids) {
		if (isConversation(id)) {
			out.push({ id, title: conversationTitle(id), icon: "MessagesSquare", panel: null })
			continue
		}
		const p = byId.get(id)
		if (p) out.push({ id: p.id, title: p.title, icon: p.icon, panel: p })
	}
	return out
}
