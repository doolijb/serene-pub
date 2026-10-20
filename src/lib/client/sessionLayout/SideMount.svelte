<script lang="ts" module>
	/** Where one panel is drawn: its side, its place in the column, its box. */
	export type PanelAt = {
		side: "left" | "right"
		index: number
		count: number
		widthPx: number
		heightPx?: number
	}
</script>

<script lang="ts">
	/**
	 * A side zone's ONE mount (the no-reload law). The renderer draws one of
	 * these per side, once, at a fixed place in `.layout-body`, and never swaps
	 * it for another: a side written once in the flow and once inside a fixed
	 * layer behind a flag would destroy one subtree and build the other,
	 * reloading every iframe in the zone and dropping every native panel's
	 * state. The SUBTREE never moves and only the container around it changes
	 * — the same trick a panel's tabs use to keep an inactive pane alive.
	 * ./sideSlot (and its unit tests) is the whole decision: `inline`,
	 * `stowed` (display:none, never an unmount), `overlay` (this wrapper wears
	 * the mobile sheet and IS the dialog) or `stage`.
	 *
	 * A side is a column of PANELS and its rail (PLAN-session-panels
	 * 2026-10-14): each panel a box of widget tabs, docked or in the rail,
	 * at its height (`fit` · `fill` · `{ share }`, ./sideRail). The side rail
	 * model decides which are expanded, which are icons and which one flies
	 * out (./sideRailModel `columnLayout`). Empty, it keeps an empty column.
	 *
	 * The panels themselves are the renderer's snippet (`panel`), so every
	 * widget mount stays in one file. The zone chrome this wrapper wears in
	 * the sheet (`.zone-flyout.mobile`, `.zone-head`) is styled by the
	 * renderer, which owns it for its whole body.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { DrawnPanel } from "@serene-pub/sdk"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { SideSlot } from "./sideSlot"
	import type { Gutters } from "./tuckedSides"
	import type { LiveFlyouts } from "./liveFlyouts.svelte"
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	import PanelRail from "./PanelRail.svelte"

	interface Props {
		side: "left" | "right"
		slot: SideSlot
		model: SessionLayoutModel
		/** One panel — its tabs, or its one widget. `popover`: opened over the session. */
		panel: Snippet<[DrawnPanel, PanelAt, boolean]>
		/** Body edge → the column's area, balance included: where a tucked flyout stops. */
		flowEdge: Gutters
		/** The tucked flyout, across both sides (./liveFlyouts). */
		flyouts: LiveFlyouts
		/** This side's wrapper — the dialog while it is the phone's sheet. */
		el?: HTMLDivElement | null
	}

	let {
		side,
		slot,
		model,
		panel,
		flowEdge,
		flyouts,
		el = $bindable(null)
	}: Props = $props()

	let view = $derived(model.sides[side])
	let panels = $derived(view.panels)
	/** Already 0 unless this side's slot is `inline` (./sideSlot `dockedZoneWidths`). */
	let flowPx = $derived(model.sideWidths[side])
	/** This side's EMPTY COLUMN, when it has one; 0 for a populated side. */
	let emptyPx = $derived(model.emptyColumns[side])
	let overlay = $derived(slot === "overlay")
	let sideLabel = $derived(side === "left" ? "Left" : "Right")
	let isTucked = $derived(model.tucked[side])
	/** A side on a hidden rung draws nothing — but the phone's sheet and the stage still do. */
	let shown = $derived(
		view.populated || ((overlay || slot === "stage") && panels.length > 0)
	)

	/** Measured height of the column of panels (0 = not laid out yet). */
	let columnPx = $state(0)
	/*
	 * The cell's own measured width is the widget's tier: a rail widget is
	 * `compact` however wide the window is, which is what it has to reflow
	 * against (PLAN 25). Bound per cell, because a grid item's real size is
	 * the browser's answer, not ours. The block size rides beside it so
	 * `layout.v1.box.px` can report a real box.
	 */
	let cellWidths = $state<Record<string, number>>({})
	let cellHeights = $state<Record<string, number>>({})

	/** The live column: the side rail model at this column's measure. */
	let col = $derived(
		model.rail.columnLayout(side, panels, {
			sheet: overlay,
			narrow: model.isNarrow,
			tucked: isTucked,
			tuckedKey:
				flyouts.tuckedFlyout?.side === side
					? flyouts.tuckedFlyout.key
					: null,
			alwaysDocked: model.logPanelKeys(side),
			heightPx: columnPx
		})
	)

	function tuckedOpen(key: string): boolean {
		return flyouts.tuckedOpen(side, key)
	}

	/**
	 * Rule (c)'s box: over the session, at the column's full height, on the edge
	 * the column is already on. `position: fixed` rather than absolute because
	 * the side it flies out of is a scrolling box — a fixed element is not
	 * clipped by an ancestor's overflow, and there is no transformed ancestor in
	 * the live render to re-anchor it. The column sits at the edge of
	 * `.layout-body`, which is what `bLeft` / `bRight` measure.
	 */
	function flyoutStyle(): string {
		// Tucked, it stops at the stage's edge so the rail that opened it —
		// and the other icons on it — stay in reach.
		const edge =
			(side === "left" ? model.bLeft : model.bRight) +
			(isTucked ? flowEdge[side === "left" ? "start" : "end"] : 0)
		const start =
			side === "left" ? "inset-inline-start" : "inset-inline-end"
		return `position:fixed;z-index:30;inset-block-start:${model.liveTop}px;inset-block-end:0;${start}:${edge}px;inline-size:min(22rem,86vw);`
	}
	/**
	 * A flyout closes on outside click and Escape — `data-pop-keep` marks what
	 * is inside it (the flyout itself, the rail that opened it). Only armed
	 * while a panel is actually flying: an EXPANDED panel is part of the
	 * layout and clicking the chat must not put it away. Tucked, the flyout
	 * is the tucked one's and so are its closers; while the editor previews
	 * the rail, the preview's are.
	 */
	$effect(() => {
		const k = col.flyout
		if (!k || isTucked) return
		const shut = () => {
			model.rail.groupOpen[model.rail.groupKey(side, k)] = false
			model.rail.groupFocus[side] = null
		}
		const onDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement | null)?.closest("[data-pop-keep]"))
				return
			shut()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") shut()
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})
</script>

{#snippet column()}
	<!-- The panel holding the stage's conversation (QE), when this side has
	     it: as the stage it is the ONE cell drawn, full size and open; in this
	     side's phone sheet it is the one cell NOT listed. -->
	{@const stageKey = model.stagePanelKey(side)}
	{@const asStage = slot === "stage" && stageKey !== null}
	{@const sheetHides =
		overlay && model.isNarrow && !model.editing && stageKey !== null}
	<!-- The column and its rail. The stack is a grid of one column whose
	     ROWS are the rail model's answer: a panel that collapses gives its
	     height BACK to the column. -->
	<div
		class="side-column"
		class:col-left={side === "left"}
		class:tucked={isTucked && !overlay && !asStage}
		style={flowPx > 0
			? `flex:0 0 ${flowPx}px; inline-size:${flowPx}px;`
			: ""}
	>
		<div
			class="live-side"
			class:sheet={overlay}
			bind:clientHeight={columnPx}
			style={asStage
				? "grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);"
				: `grid-template-columns:minmax(0,1fr);grid-template-rows:${col.rows || "1fr"};`}
		>
			{#each panels as p, i (p.key)}
				{@const widthPx = cellWidths[p.key] ?? 0}
				{@const heightPx = cellHeights[p.key] ?? 0}
				<!-- The stage cell is open, whatever the column decided. -->
				{@const st =
					asStage && p.key === stageKey
						? "expanded"
						: (col.state[p.key] ?? "expanded")}
				<!-- ONE cell per panel, whatever it is doing: expanded is a
				     row, collapsed is a display:none, folded is its title bar
				     and a hidden body, and a flyout is the same box
				     positioned over the session. Four containers, one mount —
				     a second call site for any of them would reload every
				     iframe in it. -->
				{@const tuckedOut = isTucked && st === "flyout"}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="live-side-cell cell-{st}"
					class:from-left={side === "left"}
					data-group-key={p.key}
					data-pop-keep={st === "flyout" ? "" : undefined}
					id={tuckedOut ? `tucked-${side}-${p.key}` : undefined}
					data-tucked-flyout={tuckedOut ? "" : undefined}
					role={tuckedOut ? "dialog" : undefined}
					aria-label={tuckedOut ? model.rail.groupTitle(p) : undefined}
					tabindex={tuckedOut ? -1 : undefined}
					data-stage-hidden={(asStage && p.key !== stageKey) ||
					(sheetHides && p.key === stageKey)
						? ""
						: undefined}
					bind:clientWidth={cellWidths[p.key]}
					bind:clientHeight={cellHeights[p.key]}
					style={asStage && p.key === stageKey
						? "grid-column:1; grid-row:1;"
						: `${model.rail.cellGridStyle(p, col, st)}${
								st === "flyout" ? flyoutStyle() : ""
							}${overlay ? `order:${i};` : ""}`}
				>
					{#if st === "folded"}
						<!-- Ruled 2026-09-10: on a phone a tap on the header
						     folds a panel to a title bar. Its own nodes, added
						     at their anchor — the widget below never moves. -->
						{@const FoldIcon = model.rail.groupIcon(p)}
						<button
							class="fold-bar"
							aria-expanded="false"
							onclick={() => model.rail.toggleGroup(side, p)}
						>
							<FoldIcon size={14} />
							<span class="fold-title">
								{model.rail.groupTitle(p)}
							</span>
							<Icons.ChevronDown size={14} />
						</button>
					{/if}
					<!-- Out over the session (rule (c), a tucked panel) or in the
					     phone's sheet, a panel is momentarily opened: carded
					     whatever its setting says (./hostCard). -->
					{@render panel(
						p,
						{ side, index: i, count: panels.length, widthPx, heightPx },
						st === "flyout" || overlay
					)}
				</div>
			{/each}
		</div>
		<!-- In the mobile SHEET there is no rail: the sheet IS the side,
		     opened from the header's own control. -->
		{#if panels.length && !overlay && !asStage}
			<PanelRail
				{side}
				{panels}
				{col}
				rail={model.rail}
				tucked={isTucked}
				{tuckedOpen}
				onToggleTucked={(key, trigger) =>
					flyouts.toggleTucked(side, key, trigger)}
			/>
		{/if}
	</div>
{/snippet}

<!-- The dialog role and the `tabindex="-1"` are the SAME condition — this
     wrapper is only focusable while it is the sheet — but the compiler
     can't follow that through two ternaries and reads a bare div with a
     dynamic tabindex. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- Stage only hides every side but the one that IS the stage (QE). -->
<div
	bind:this={el}
	class="side-slot slot-{slot}"
	data-stage-hidden={model.stageOnly && slot !== "stage" ? "" : undefined}
	class:zone-flyout={overlay}
	class:mobile={overlay}
	class:from-left={overlay && side === "left"}
	role={overlay ? "dialog" : undefined}
	aria-modal={overlay ? "true" : undefined}
	aria-label={overlay ? `${sideLabel} panels` : undefined}
	tabindex={overlay ? -1 : undefined}
	data-pop-keep={overlay ? "" : undefined}
	style={slot === "inline" && flowPx > 0 ? `--side-flow-px:${flowPx}px;` : ""}
>
	{#if overlay}
		<!-- The sheet's chrome. An `{#if}` adds and removes its OWN nodes at
		     its anchor; the mount below never moves, which is the whole
		     point (an appendChild would reload its iframes). -->
		<div class="zone-head">
			<span class="zone-label always">{sideLabel}</span>
			<span class="flex-1"></span>
			<button
				class="zone-head-btn"
				title="Close"
				aria-label="Close {sideLabel.toLowerCase()} panels"
				onclick={() => mobileSidePanels.close()}
			>
				<Icons.X size={16} />
			</button>
		</div>
	{/if}
	{#if shown}
		{@render column()}
	{:else if emptyPx > 0 && flowPx > 0}
		<!-- An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
		     `emptyColumnsPx`). Drawn exactly when its width was granted, so
		     the box and the reserve cannot disagree. Nothing in it to reach,
		     so no tab stop and no a11y tree; widgets go in from the editor. -->
		<div
			class="side-empty"
			aria-hidden="true"
			style="flex:0 0 {flowPx}px; inline-size:{flowPx}px;"
		></div>
	{/if}
</div>

<style>
	/* ── the one mount per side, moved by class (see ./sideSlot) ──────────
	   The wrapper exists so the side's subtree can stay put while its
	   CONTAINER changes; it must therefore be invisible in the flow slot, or
	   it would be a new box the layout never had. `display: contents` is
	   exactly that: the rails / the arranged grid go on being the flex items
	   of `.layout-body` they were before this element existed — same widths,
	   same 0.5rem gap. */
	.side-slot.slot-inline {
		display: contents;
	}
	/* Stowed: below the breakpoint (P6), where a side takes no room in the
	   layout at all — no box, no tab stop, no a11y tree — but is still
	   MOUNTED, so the iframes keep running and the panels keep their state
	   (the no-reload law). The renderer's `.live-body.body-stowed` is the
	   WHOLE session in that same state, under the Arrange tab's canvas. */
	.side-slot.slot-stowed {
		display: none;
	}
	/* Overlay: the same mount, wearing the mobile sheet. Every box rule comes
	   from `.zone-flyout.mobile` (the renderer's) — this wrapper IS the
	   dialog, so there is nothing here but making its contents fill the sheet
	   under the header. A rail's ladder width and the inline slot's clamp are
	   both wrong in a sheet that already has a width of its own. */
	.side-slot.slot-overlay > :global(.side-column) {
		flex: 1;
		min-block-size: 0;
	}
	/* The stage (QE, brief 7a): this side holds the conversation the phone or
	   Stage only draws full width. The wrapper becomes the body's one flex
	   item and its column or rail fills it; everything in the side but the
	   conversation is `data-stage-hidden` around its mount, and the rail's
	   own chrome goes. A container change, never a second render. */
	.side-slot.slot-stage {
		display: flex;
		flex: 1 1 auto;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.side-slot.slot-stage > :global(.side-column) {
		flex: 1;
		inline-size: auto;
	}
	/* ── the side rail model (ruled 2026-09-10) ───────────────────────────
	   A side column is a stack of toggling group panels plus a slim rail of
	   icons at its OUTER edge. `row-reverse` on a left column puts the rail on
	   the left and the stack on the right from the SAME dom order the right
	   column uses — one markup, both sides, and no reordering to move an
	   iframe. `position: relative` is the preview's flyout anchor; the live
	   flyout is fixed (see `flyoutStyle`). Its width is the inline
	   `flex: 0 0 <ladder>px` the markup writes (`sideWidths`): a grid has
	   nothing definite to be 100% OF. */
	.side-column {
		position: relative;
		display: flex;
		flex-direction: row;
		gap: 0.25rem;
		block-size: 100%;
		inline-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.side-column.col-left {
		flex-direction: row-reverse;
	}
	/* An EMPTY side's column (ruled 2026-09-29, `emptyColumns`): the room its
	   first widget will take, kept so the middle does not move into it. It
	   shows the page's own background — no tint, no border and no text, so
	   an empty column reads as part of the body (owner, 2026-10-01): a drop
	   hint belongs to the editor, where there is something to drop (6.7). */
	.side-empty {
		flex: none;
		block-size: 100%;
		min-inline-size: 0;
		background: transparent;
	}
	/* Tucked (./tuckedSides): the column is its rail and nothing more. The
	   stack keeps its mount and its cells — the one out is a fixed flyout, the
	   rest are display:none — but gives its width back to the stage. */
	.side-column.tucked {
		gap: 0;
	}
	.side-column.tucked > .live-side {
		flex: 0 0 0;
	}
	/* The stack. Still a grid, but its ROWS are the rail model's answer rather
	   than the arrangement's `repeat(rows,1fr)`: a collapsed group has to give
	   its height BACK, and an empty track of a fixed template gives nothing
	   back. Both templates are written inline, per column. `overflow: hidden`
	   keeps the measured column height — which the model is decided against —
	   from being the sum of what is in it. */
	.live-side {
		flex: 1;
		display: grid;
		gap: 0.4rem;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}
	/* The mobile sheet (ruled 2026-09-10): the side's panels LISTED, not a
	   column of them competing for height. Each is its content height, capped
	   at what the sheet has, and the list scrolls. A flex column, so the cells'
	   explicit grid rows go quiet and their `order` — the collapsed order —
	   is what the list follows. */
	.live-side.sheet {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}
	.live-side.sheet > .live-side-cell {
		flex: 0 0 auto;
		max-block-size: 100%;
	}
	.live-side-cell {
		/* The containing block for this cell's widget overlay (the renderer's
		   `.chat-arranged-cell` says why). */
		position: relative;
		min-inline-size: 0;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.live-side-cell > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
	/* Folded (mobile): the title bar stays, the widget stays MOUNTED and is
	   hidden — the fold is a display, not an unmount, or folding a panel would
	   cost it its state and reload its iframe. */
	.live-side-cell.cell-folded {
		overflow: hidden;
	}
	.live-side-cell.cell-folded > :global(*) {
		display: none;
	}
	.fold-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		inline-size: 100%;
		min-block-size: 2.75rem;
		padding-inline: 0.6rem;
		border-radius: 0.5rem;
		text-align: start;
		color: var(--color-surface-600-400);
		background: color-mix(
			in oklab,
			var(--color-surface-500) 12%,
			transparent
		);
	}
	.live-side-cell.cell-folded > .fold-bar {
		display: flex;
	}
	.fold-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
		font-weight: 650;
	}

	/* Rule (c): the group could not fit beside the pinned ones, so it is over
	   the session at the column's full height instead of squeezing it. The box
	   is the desktop pop-over's — same surface, same shadow, same slide — since
	   it is the same gesture the unpinned rails have always had. */
	.live-side-cell.cell-flyout {
		padding: 0.4rem;
		border-radius: 0.6rem 0 0 0.6rem;
		background: var(--color-surface-50);
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.22);
		animation: fly-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.live-side-cell.cell-flyout.from-left {
		border-radius: 0 0.6rem 0.6rem 0;
		border-inline-start: none;
		border-inline-end: 1px solid
			color-mix(in oklab, var(--color-surface-300) 60%, transparent);
		box-shadow: 10px 0 28px rgba(0, 0, 0, 0.22);
		animation-name: fly-in-left;
	}
	:global([data-mode="dark"]) .live-side-cell.cell-flyout {
		background: var(--color-surface-950);
		border-color: color-mix(
			in oklab,
			var(--color-surface-700) 60%,
			transparent
		);
	}
	/* The pop-over's slide (the renderer's `.zone-flyout` keeps its own copy). */
	@keyframes fly-in-right {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@keyframes fly-in-left {
		from {
			transform: translateX(-24px);
			opacity: 0;
		}
	}

</style>
