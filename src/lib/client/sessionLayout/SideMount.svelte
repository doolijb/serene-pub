<script lang="ts">
	/**
	 * A side zone's ONE mount (the no-reload law). The renderer draws one of
	 * these per side, once, at a fixed place in `.layout-body`, and never swaps
	 * it for another: a side written once in the flow and once inside a fixed
	 * layer behind a flag would destroy one subtree and build the other,
	 * reloading every iframe in the zone and dropping every native panel's
	 * state. The SUBTREE never moves and only the container around it changes
	 * — the same trick the tab groups use to keep an inactive pane alive.
	 * ./sideSlot (and its unit tests) is the whole decision: `inline`,
	 * `stowed` (display:none, never an unmount), `overlay` (this wrapper wears
	 * the mobile sheet and IS the dialog) or `stage`.
	 *
	 * A side draws its ARRANGEMENT when it places anything (the arranged
	 * column: the side rail model's groups plus their rail), else its zones
	 * the ladder's way (a docked rail, or an icon strip that pops the zone
	 * over), else — empty — an empty column. Which is read off the drawn
	 * layout (./sessionLayoutModel).
	 *
	 * The widgets themselves are the renderer's snippets (`unit`,
	 * `panelStack`), so every widget mount stays in one file. The zone chrome
	 * this wrapper wears in the sheet (`.zone-flyout.mobile`, `.zone-head`) is
	 * styled by the renderer, which owns it for its whole body.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { ResolvedZone } from "./schema"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { RenderUnit } from "./tabGroups"
	import type { SideSlot } from "./sideSlot"
	import { rovingStep, rovingStop } from "./sideRail"
	import type { Gutters } from "./tuckedSides"
	import type { LiveFlyouts } from "./liveFlyouts.svelte"
	import { mobileSidePanels } from "./mobileSidePanels.svelte"
	import GroupRail from "./GroupRail.svelte"

	/** The cells one unit is drawn in, and the box they measured. */
	type UnitGeometry = {
		zone: { cols: number; rows: number }
		widthPx: number
		heightPx?: number
	}

	interface Props {
		side: "left" | "right"
		slot: SideSlot
		model: SessionLayoutModel
		/** One render unit's widget(s) — a lone widget, or a tab group. */
		unit: Snippet<[RenderUnit, UnitGeometry, boolean]>
		/** A zone's panel stack (the rail, or a pop-over's). */
		panelStack: Snippet<[ResolvedZone, boolean]>
		/** Body edge → the column's area, balance included: where a tucked flyout stops. */
		flowEdge: Gutters
		/**
		 * The pop-over (an un-arranged zone popped over the session) and the
		 * tucked flyout, across both sides (./liveFlyouts).
		 */
		flyouts: LiveFlyouts
		/** Pin or unpin an un-arranged zone (the rail's own pin button). */
		onSetPinned: (zoneId: string, pinned: boolean) => void
		/** This side's wrapper — the dialog while it is the phone's sheet. */
		el?: HTMLDivElement | null
	}

	let {
		side,
		slot,
		model,
		unit,
		panelStack,
		flowEdge,
		flyouts,
		onSetPinned,
		el = $bindable(null)
	}: Props = $props()

	let zones = $derived(side === "left" ? model.leftZones : model.rightZones)
	let units = $derived(side === "left" ? model.leftUnits : model.rightUnits)
	/** The arranged column's cell grid, when this side draws its arrangement. */
	let arr = $derived(model.frameOf(model.drawn[side]))
	/** Already 0 unless this side's slot is `inline` (./sideSlot `dockedZoneWidths`). */
	let flowPx = $derived(model.sideWidths[side])
	/** This side's EMPTY COLUMN, when it has one; 0 for a populated side. */
	let emptyPx = $derived(model.emptyColumns[side])
	let overlay = $derived(slot === "overlay")
	let sideLabel = $derived(side === "left" ? "Left" : "Right")
	let isTucked = $derived(model.tucked[side])

	/** Measured height and width of the column of groups (0 = not laid out yet). */
	let columnPx = $state(0)
	let columnWPx = $state(0)
	/*
	 * The cell's own measured width is the widget's tier: a rail widget is
	 * `compact` however wide the window is, which is what it has to reflow
	 * against (PLAN 25). Bound per cell rather than divided out of the zone,
	 * because a flex item's real size is the browser's answer, not ours. The
	 * block size rides beside it so `layout.v1.box.px` can report a real box.
	 */
	let cellWidths = $state<Record<string, number>>({})
	let cellHeights = $state<Record<string, number>>({})

	/** The live column: the side rail model at this column's measure. */
	let col = $derived(
		model.rail.columnLayout(side, units, arr?.rows ?? 1, {
			sheet: overlay,
			narrow: model.isNarrow,
			tucked: isTucked,
			tuckedKey:
				flyouts.tuckedFlyout?.side === side
					? flyouts.tuckedFlyout.key
					: null,
			heightPx: columnPx,
			widthPx: columnWPx
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
	 * A flyout closes on outside click and Escape, exactly like the unpinned
	 * rail's pop-over — `data-pop-keep` marks what is inside it (the flyout
	 * itself, the rail that opened it). Only armed while a group is actually
	 * flying: an EXPANDED group is part of the layout and clicking the chat
	 * must not put it away. Tucked, the flyout is the tucked one's and so are
	 * its closers; while the Move tab previews the rail, the preview's are.
	 */
	$effect(() => {
		const k = col.flyout
		if (!k || isTucked || (model.editing && model.railPreview)) return
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

	/** Which icon holds each icon strip's one tab stop, keyed by zone. */
	let railStop = $state<Record<string, number>>({})
	function onStripKeydown(e: KeyboardEvent, key: string) {
		const bar = (e.currentTarget as HTMLElement).closest("[data-rail]")
		if (!bar) return
		const btns = [
			...bar.querySelectorAll<HTMLButtonElement>(":scope > button")
		]
		const at = btns.indexOf(e.currentTarget as HTMLButtonElement)
		const next = rovingStep(e.key, at < 0 ? 0 : at, btns.length)
		if (next == null) return
		e.preventDefault()
		railStop[key] = next
		btns[next]?.focus()
	}
</script>

{#snippet sideZone(z: ResolvedZone)}
	{@const widgets = model.zoneEntriesOf(z)}
	{#if z.mode !== "hidden" && widgets.length}
		{#if z.mode === "rail"}
			<!-- Pinned rail: takes layout space. -->
			<aside
				class="zone-rail"
				style="inline-size:var(--side-flow-px, {z.width *
					z.columns}px);"
				aria-label={model.labelOf(z)}
				data-pop-keep
			>
				<div class="zone-head">
					<span class="zone-label">{model.labelOf(z)}</span>
					<span class="flex-1"></span>
					<button
						class="zone-head-btn"
						title="Unpin — collapse to icons"
						aria-label="Unpin {model.labelOf(z)}"
						onclick={(e) => {
							e.stopPropagation()
							onSetPinned(z.id, false)
						}}
					>
						<Icons.PinOff size={13} />
					</button>
				</div>
				{@render panelStack(z, false)}
			</aside>
		{:else}
			<!-- Unpinned / narrow: an icon strip; tapping pops the zone over. -->
			<div
				class="zone-iconstrip"
				tabindex="-1"
				role="toolbar"
				aria-orientation="vertical"
				aria-label={model.labelOf(z)}
				data-pop-keep
				data-rail
			>
				{#each widgets as p, i (p.id)}
					{@const IconCmp = model.entryIcon(p)}
					{@const out = isTucked && tuckedOpen(p.id)}
					<!-- Template literals, not "{p.title}": inside an expression
					     those braces are ordinary characters, and a screen reader
					     was announcing the literal text "Open {p.title}". -->
					<button
						class="icon-btn"
						tabindex={i ===
						rovingStop(railStop[`z:${z.id}`], widgets.length)
							? 0
							: -1}
						onkeydown={(e) => onStripKeydown(e, `z:${z.id}`)}
						onfocus={() => (railStop[`z:${z.id}`] = i)}
						class:active={isTucked ? out : flyouts.popId === z.id}
						title={p.title}
						aria-label={`Open ${p.title}`}
						aria-pressed={isTucked
							? undefined
							: flyouts.popId === z.id}
						aria-expanded={isTucked ? out : undefined}
						aria-haspopup={isTucked ? "dialog" : undefined}
						aria-controls={out ? `tucked-zone-${z.id}` : undefined}
						onclick={(e) => {
							e.stopPropagation()
							// Tucked, it brings THIS widget out, one at a time
							// (./tuckedSides).
							if (isTucked)
								flyouts.toggleTucked(
									side,
									p.id,
									e.currentTarget
								)
							else flyouts.togglePop(z.id, p.id)
						}}
					>
						<IconCmp size={16} />
					</button>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet arrangedSide(frame: { cols: number; rows: number })}
	<!-- The unit holding the stage's conversation (QE), when this side has
	     it: as the stage it is the ONE cell drawn, full size and open;
	     in this side's phone sheet it is the one cell NOT listed. -->
	{@const stageKey = model.stageUnitKey(side, units)}
	{@const asStage = slot === "stage" && stageKey !== null}
	{@const sheetHides =
		overlay && model.isNarrow && !model.editing && stageKey !== null}
	<!-- The column and its rail. The stack is still a grid, but its ROWS are
	     the rail model's answer rather than the arrangement's own
	     `repeat(rows,1fr)`: a group that collapses has to give its height
	     BACK to the column, and an empty track of a fixed template gives
	     nothing back. The arrangement still decides the order and each
	     group's share — see ./sideRailModel `columnLayout`. -->
	<div
		class="side-column"
		class:col-left={side === "left"}
		class:tucked={isTucked && !overlay && !asStage}
		style={flowPx > 0
			? `flex:0 0 ${flowPx}px; inline-size:${flowPx}px;`
			: ""}
	>
		<!-- One grid. Not collapsed it is the arrangement's own columns with
		     a row per band, at the heights the rail model resolved; collapsed
		     it is ONE column and a row per group, in the collapsed order —
		     which is where a top/bottom anchor ends up meaning first and
		     last. Either way the cells are placed explicitly, so nothing in
		     the `{#each}` ever has to be re-sorted to reorder the column. -->
		<div
			class="live-side"
			class:sheet={overlay}
			class:one-column={col.collapsed}
			bind:clientHeight={columnPx}
			bind:clientWidth={columnWPx}
			style={asStage
				? "grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);"
				: `grid-template-columns:repeat(${
						col.collapsed ? 1 : frame.cols
					},1fr);grid-template-rows:${col.rows || "1fr"};`}
		>
			{#each units as u (u.key)}
				{@const widthPx = cellWidths[u.key] ?? 0}
				{@const heightPx = cellHeights[u.key] ?? 0}
				<!-- The stage cell is open, whatever the column decided. -->
				{@const st =
					asStage && u.key === stageKey
						? "expanded"
						: (col.state[u.key] ?? "expanded")}
				<!-- ONE cell per group, whatever it is doing: expanded is a
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
					data-group-key={u.key}
					data-pop-keep={st === "flyout" ? "" : undefined}
					id={tuckedOut ? `tucked-${side}-${u.key}` : undefined}
					data-tucked-flyout={tuckedOut ? "" : undefined}
					role={tuckedOut ? "dialog" : undefined}
					aria-label={tuckedOut
						? model.rail.groupTitle(u)
						: undefined}
					tabindex={tuckedOut ? -1 : undefined}
					data-stage-hidden={(asStage && u.key !== stageKey) ||
					(sheetHides && u.key === stageKey)
						? ""
						: undefined}
					bind:clientWidth={cellWidths[u.key]}
					bind:clientHeight={cellHeights[u.key]}
					style={asStage && u.key === stageKey
						? "grid-column:1; grid-row:1;"
						: `${model.rail.cellGridStyle(u, col, st)}${
								st === "flyout" ? flyoutStyle() : ""
							}${
								u.members.length === 1 && !col.collapsed
									? model.anchorCellStyle(u.members[0].anchor)
									: ""
							}`}
				>
					{#if st === "folded"}
						<!-- Ruled 2026-09-10: on a phone a tap on the header
						     folds a widget to a title bar. Its own nodes,
						     added at their anchor — the widget below never
						     moves, which is the whole point. -->
						{@const FoldIcon = model.rail.groupIcon(u)}
						<button
							class="fold-bar"
							aria-expanded="false"
							onclick={() => model.rail.toggleGroup(side, u)}
						>
							<FoldIcon size={14} />
							<span class="fold-title">
								{model.rail.groupTitle(u)}
							</span>
							<Icons.ChevronDown size={14} />
						</button>
					{/if}
					<!-- Out over the session (rule (c), a tucked panel) or in the
					     phone's sheet, a group is momentarily opened: carded
					     whatever its setting says (./hostCard). -->
					{@render unit(
						u,
						{ zone: frame, widthPx, heightPx },
						st === "flyout" || overlay
					)}
				</div>
			{/each}
		</div>
		<!-- No groups, no rail. In the mobile SHEET there is no rail either:
		     the sheet IS the side, opened from the header's own control. -->
		{#if units.length && !overlay && !asStage}
			<GroupRail
				{side}
				{units}
				{col}
				markPinned={false}
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
	<!-- `arr` only when the arrangement places something (./sessionLayoutModel
	     `arrangedHere`): a box drawn here with no width reserved for it falls
	     back to `.side-column { inline-size: 100% }` and shrinks the centre. -->
	{#if arr}
		{@render arrangedSide(arr)}
	{:else if emptyPx > 0 && flowPx > 0}
		<!-- An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
		     `emptyColumnsPx`). Drawn exactly when its width was granted, so
		     the box and the reserve cannot disagree; the grant is already 0
		     where the side takes no room — stowed, in the sheet, tucked,
		     hidden, or given way to the stage. Nothing in it to reach, so no
		     tab stop and no a11y tree; widgets go in from the editor's Move
		     tab. -->
		<div
			class="side-empty"
			aria-hidden="true"
			style="flex:0 0 {flowPx}px; inline-size:{flowPx}px;"
		></div>
	{:else}
		<!-- Docked below the breakpoint, and as the stage: an unpinned
		     zone's icon strip mounts nothing, and the stage has to draw
		     its conversation. -->
		{#each zones as z (z.id)}
			{@render sideZone(
				model.isNarrow || slot === "stage" ? model.dockedZone(z) : z
			)}
		{/each}
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
	   WHOLE session in that same state, under the Move tab's canvas. */
	.side-slot.slot-stowed {
		display: none;
	}
	/* Overlay: the same mount, wearing the mobile sheet. Every box rule comes
	   from `.zone-flyout.mobile` (the renderer's) — this wrapper IS the
	   dialog, so there is nothing here but making its contents fill the sheet
	   under the header. A rail's ladder width and the inline slot's clamp are
	   both wrong in a sheet that already has a width of its own. */
	.side-slot.slot-overlay > :global(.zone-rail) {
		inline-size: 100% !important;
		max-inline-size: none;
		flex: 1;
	}
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
	.side-slot.slot-stage > :global(.zone-rail) {
		flex: 1;
		inline-size: auto !important;
		max-inline-size: none;
	}
	.side-slot.slot-stage > :global(.zone-rail > .zone-head) {
		display: none;
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

	/* ── zones (the ladder's way) ──────────────────────────────────────── */
	.zone-rail {
		display: flex;
		flex-direction: column;
		flex: none;
		min-block-size: 0;
		gap: 0.35rem;
	}
	/* The centre's floor, on the rail path. A rail is `flex: none` at the
	   ladder's definite width and `.layout-center` is `min-inline-size: 0`, so
	   two rails wider than the body would have squeezed the chat to nothing.
	   `--side-flow-px` is this side's share after the body reserved
	   MIN_CENTER_PX (see `sideWidths` / ./sideSlot), and with room to spare it
	   IS the ladder width, so the cap only bites in the tight case. */
	.side-slot.slot-inline > :global(.zone-rail) {
		max-inline-size: var(--side-flow-px, none);
	}
	/* Icon strip (unpinned rail / narrow drawer): just its icons, no boxed
	   "ring" around them. */
	.zone-iconstrip {
		display: flex;
		flex-direction: column;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		inline-size: 2.25rem;
		padding-block: 0.375rem;
		border-radius: 0.6rem;
		background: transparent;
		border: none;
	}
	/* The icon button's face — the same one ./GroupRail wears. */
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.75rem;
		block-size: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-surface-600);
	}
	:global([data-mode="dark"]) .icon-btn {
		color: var(--color-surface-400);
	}
	.icon-btn:hover,
	.icon-btn.active {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}
</style>
