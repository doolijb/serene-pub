/**
 * `GsItem` is the layout editor's own card, before it has cells. It lives in a
 * `.ts` module so plain `.ts` callers (and `tsc`, which cannot see a
 * `<script module>` export through the `*.svelte` shim) can import it;
 * `GridStackZone.svelte` re-exports it.
 */
import type { WidgetAnchor } from "@serene-pub/sdk"

export interface GsItem {
	id: string
	title: string
	x?: number
	y?: number
	w?: number
	h?: number
	/**
	 * Default vertical placement (before the user drags): "top" stacks from
	 * the top (default), "bottom" docks from the bottom, "fill" takes the
	 * space left between them. Full-width by default (w = the zone's columns).
	 */
	place?: "top" | "bottom" | "fill"
	/**
	 * Set on the card the primary floor keeps (./primaryFloor: the last
	 * placed instance of the genre's primary widget): it offers no remove
	 * control and shows this note in its place. Movable and resizable like
	 * any card, into any zone — placement is free (brief 7a).
	 */
	floorNote?: string
	/**
	 * Set on a card whose widget is at its `maxInstances` (brief 7b): it
	 * offers no Duplicate and shows this note in its place.
	 */
	copyRefusal?: string
	/** Edges the widget anchors to within its cell (toggled in the editor). */
	anchor?: WidgetAnchor
	/** Tab-group membership: cards sharing a group id render as one tab set. */
	group?: string
	/**
	 * Docked in a side column (ruled 2026-09-10). ABSENT MEANS PINNED — the
	 * only value ever written is the explicit `false`, so an arrangement
	 * without the field reads as everything pinned. See `itemPinned` /
	 * `withPins`.
	 */
	pinned?: boolean
}
