<script lang="ts">
	/**
	 * Renders one zone (PLAN 25) as a native CSS grid of widgets. The engine
	 * (widgetGrid.ts) turns each widget's constraints into grid CSS; this
	 * component is just the thin renderer. Content is supplied by the parent
	 * via a `widget` snippet keyed by id, so the zone never knows what a widget
	 * *is* (messages, composer, a portrait) — only where it sits.
	 *
	 * `showCells` is the visual-editor mode: columns become the fixed square-cell
	 * module and a matching cell-guide grid is drawn behind the widgets, so you
	 * SEE the cells things snap into. Everything else (grow/fixed/anchor row
	 * sizing) is identical to the live render — the editor is the live layout
	 * plus guides, which is what makes it WYSIWYG.
	 */
	import type { Snippet } from "svelte"
	import {
		cellsGridStyle,
		widgetItemStyle,
		widgetsInZone,
		zoneGridStyle,
		type GridLayout,
		type Zone
	} from "./widgetGrid"

	interface Props {
		layout: GridLayout
		zone: Zone
		/** Render a widget's content by id (the parent owns what each id is). */
		widget: Snippet<[{ id: string }]>
		/**
		 * Gap between widgets in the zone. The chat middle passes "0" so the
		 * composer sits flush against the message list (parity with the pre-grid
		 * layout); other zones keep the default breathing room.
		 */
		gap?: string
		/** Visual-editor mode: fixed square cells + a cell-guide overlay. */
		showCells?: boolean
	}

	let { layout, zone, widget, gap = "0.5rem", showCells = false }: Props =
		$props()
	let widgets = $derived(widgetsInZone(layout, zone))
	let gridStyle = $derived(
		showCells
			? cellsGridStyle(widgets, layout.cell)
			: zoneGridStyle(widgets, layout.cell)
	)
</script>

<div
	class="widget-zone"
	class:cells={showCells}
	style="{gridStyle}gap:{gap};--cell:{layout.cell}px;"
>
	{#each widgets as w (w.id)}
		<div
			class="widget"
			data-widget-id={w.id}
			style={widgetItemStyle(w, layout.cell)}
		>
			{@render widget({ id: w.id })}
		</div>
	{/each}
</div>

<style>
	.widget-zone {
		container-type: inline-size; /* widgets reflow against the ZONE (§3) */
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
		/* Pack auto-height rows at the top rather than stretch to fill leftover
		   space (default `normal` behaves like stretch here) — matters whenever
		   every widget is content-sized (e.g. a side-zone panel stack); a `1fr`
		   GROW track (the chat's messages widget) already consumes all free
		   space during track-sizing, before align-content gets a say, so this
		   is a no-op for that case. */
		align-content: start;
		/* gap is applied inline (per-zone, see the gap prop) */
	}
	/* The editor's cell guides: one soft, rounded, OUTLINED square per cell —
	   border + a margin (gap) between them, transparent interior, not a solid
	   block. Tiled at the cell module, aligned to the fixed cell columns
	   (cellsGridStyle). The inner rect is inset 3px of 44 with rx 9 → the gap;
	   `fill='none'` + a low-alpha stroke → just the outline. */
	.widget-zone.cells {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect x='3.5' y='3.5' width='37' height='37' rx='9' ry='9' fill='none' stroke='%23808a99' stroke-opacity='0.28' stroke-width='1.25'/></svg>");
		background-size: var(--cell) var(--cell);
		background-position: center top;
		background-repeat: repeat;
	}
	:global([data-mode="dark"]) .widget-zone.cells {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect x='3.5' y='3.5' width='37' height='37' rx='9' ry='9' fill='none' stroke='%23aab4c4' stroke-opacity='0.22' stroke-width='1.25'/></svg>");
	}
	/* A widget is a transparent positioned box (§8); its content brings its own
	   look. The flex just lets the content fill the widget's grid cell.
	   Overflow stays visible: the messages widget scrolls internally, and the
	   composer's popovers/tabs must not be clipped (they portal, but its inline
	   tab content grows the widget instead). */
	.widget {
		position: relative; /* anchor for edit-mode structural controls */
		min-inline-size: 0;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		overflow: visible;
	}
	.widget > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
</style>
