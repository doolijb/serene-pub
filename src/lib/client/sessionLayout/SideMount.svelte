<script lang="ts">
	/**
	 * A side zone's ONE mount (the no-reload law). The renderer draws one of
	 * these per side, once, at a fixed place in `.layout-body`, and never swaps
	 * it for another: a side written once in the flow and once behind a flag
	 * would destroy one subtree and build the other, reloading every iframe in
	 * the zone and dropping every native panel's state. The SUBTREE never
	 * moves and only the container around it changes — the same trick a
	 * panel's tabs use to keep an inactive pane alive. ./sideSlot (and its
	 * unit tests) is the whole decision: `inline` (a column of its own width
	 * in the row), `stowed` (display:none, never an unmount) or `solo` (the
	 * one zone drawn, the whole body).
	 *
	 * A side is a column of PANELS (./ZoneColumn — the one height engine all
	 * three zones share), every panel always open. Empty, it keeps an empty
	 * column (STYLE-GUIDE §5.3) so the middle does not move into it.
	 *
	 * The panels themselves are the renderer's snippet (`panel`), so every
	 * widget mount stays in one file.
	 */
	import type { Snippet } from "svelte"
	import type { DrawnPanel } from "@serene-pub/sdk"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { SideSlot } from "./sideSlot"
	import ZoneColumn, { type CellAt } from "./ZoneColumn.svelte"

	interface Props {
		side: "left" | "right"
		slot: SideSlot
		model: SessionLayoutModel
		/** One panel — its tabs, or its one widget. */
		panel: Snippet<[DrawnPanel, CellAt]>
		/** This side's wrapper. */
		el?: HTMLDivElement | null
	}

	let { side, slot, model, panel, el = $bindable(null) }: Props = $props()

	let view = $derived(model.sides[side])
	/** Already 0 unless this side's slot is `inline` (./sideSlot `dockedZoneWidths`). */
	let columnPx = $derived(model.sideWidths[side] || model.emptyColumns[side])
</script>

<div
	bind:this={el}
	class="side-slot slot-{slot}"
	style={slot === "inline" ? `inline-size:${columnPx}px;` : undefined}
>
	{#if view.panels.length === 0}
		<!-- An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
		     `emptyColumnsPx`). The page's own background, no text, nothing to
		     reach: no tab stop and no a11y tree; widgets go in from the editor. -->
		<div class="side-empty" aria-hidden="true"></div>
	{:else}
		<ZoneColumn
			zone={side}
			panels={view.panels}
			gapPx={model.gapPx}
			isMessages={model.isMessages}
			{panel}
		/>
	{/if}
</div>

<style>
	/* ── the one mount per side, moved by class (see ./sideSlot) ──────────
	   The wrapper is the same element in every slot; only its classes change,
	   so the subtree is never moved or remounted. */
	.side-slot {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
	}
	/* In the row: a column of its own width, the inline style's. */
	.side-slot.slot-inline {
		flex: none;
	}
	/* Stowed: another zone is the one drawn (or the viewport is a phone's) —
	   no box, no tab stop, no a11y tree, but still MOUNTED, so the iframes
	   keep running and the panels keep their state. */
	.side-slot.slot-stowed {
		display: none;
	}
	/* Solo: this side is the one zone drawn, the whole body. */
	.side-slot.slot-solo {
		flex: 1;
	}
	/* An EMPTY side's column: the room its first widget will take, kept so the
	   middle does not move into it (STYLE-GUIDE §5.3). */
	.side-empty {
		flex: 1;
		min-inline-size: 0;
		background: transparent;
	}
</style>
