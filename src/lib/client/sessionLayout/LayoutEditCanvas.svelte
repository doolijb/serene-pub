<script lang="ts">
	/**
	 * The Move tab's EDIT CANVAS, split out of SessionLayout: the three editor
	 * zones as ONE grid row, each drawn either as its gridstack zone or — while
	 * the Rails lens is on — as the rail preview of that side.
	 *
	 * The scrim, the simulator's frame and the `{#if placing && !mobileEdit}`
	 * that decides whether there is a canvas at all stay in SessionLayout: the
	 * frame wraps both this and the phone preview, so it cannot live in either.
	 * SessionLayout draws this component in both of those places, and it
	 * renders nothing on its own behalf.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type {
		ArrangedGridV1,
		ArrangedZone,
		ZoneId,
		ZoneLayoutV1
	} from "@serene-pub/sdk"
	// Says out loud what a zone with no free cell does to a drop (see the
	// module): gridstack snaps the card back, and silence reads as a bug.
	import { zoneIsFull } from "./zoneFull"
	// QD (./widgetInstances): under "tray only" no card offers Duplicate.
	import { duplicateOffered } from "./widgetInstances"
	// The editor's grid is gridstack (free 2D drag / resize / snap). See
	// GridStackZone — gridstack owns its DOM, Svelte owns only the host.
	import GridStackZone, { type GsItem } from "./GridStackZone.svelte"
	import {
		MIDDLE_TARGET,
		showZonePin
	} from "./arrangedGeometry"
	import type { RenderUnit } from "./tabGroups"
	import type { CellState, ColumnLayout } from "./sideRail"
	import type { SimGeometry } from "./simulator"

	/** One side's previewed column, as SessionLayout's `previewColumn` returns it. */
	type PreviewColumn = { frame: ArrangedZone; units: RenderUnit[] }

	interface Props {
		/** The editor's ¼ | ½ | ¼ split, for the real width or a simulated tier. */
		editGeom: SimGeometry
		/** The canonical side zones the editor targets, or null where there is none. */
		leftZoneId: string | null
		rightZoneId: string | null
		/** The cards each zone draws, with their restored geometry laid over. */
		leftGsItems: GsItem[]
		middleGsItems: GsItem[]
		rightGsItems: GsItem[]
		/**
		 * What each zone RE-SEEDS on (./editorSeed `editorSeedKey`): its
		 * committed members and the card the primary floor keeps — never the
		 * cards themselves, which a cross-zone drag changes.
		 */
		seedKeys: Record<ZoneId, string>
		/**
		 * The editor's working arrangement. Bound: each zone reports its frame
		 * back through `onChange`, and `editZonePanel` restores from it.
		 */
		editArranged: ArrangedGridV1
		/** Draw the side columns as rails instead of the editor's grids. */
		railPreview: boolean
		/** The zone currently under a drag (highlight). */
		dragOverZone: string | null
		/** Tap-to-place: the palette chip currently armed. */
		armedId: string | null
		onZoneDragOver: (e: DragEvent, target: string) => void
		onZoneDrop: (e: DragEvent, target: string, beforeId?: string) => void
		onZoneClick: (target: string) => void
		/** The Move tab is up, which is the only tab that draws this. */
		placing: boolean
		/** The zone template, read for one thing: a zone's own pin. */
		layout: ZoneLayoutV1
		toggleZonePin: (zoneId: string | null) => void
		removeWidget: (widgetId: string) => void
		/**
		 * A card's Duplicate (brief 7b; QD): SessionLayout mints the copy,
		 * copies its settings and style, and seats it beside the source.
		 */
		duplicateWidget: (widgetId: string) => string | null
		/** A card landed in a zone. SessionLayout keeps `lastDropped`. */
		onDropped: (id: string, zoneKey: ZoneId) => void
		pinOnDrop: (zoneId: string | null) => void
		markSimDirty: () => void
		/** The Rails lens: the previewed columns and the model resolved over them. */
		leftPreview: PreviewColumn
		rightPreview: PreviewColumn
		leftPreviewCol: ColumnLayout
		rightPreviewCol: ColumnLayout
		simNarrow: boolean
		simHeight: number
		/** Measured height and width of each preview column, bound back out. */
		previewPx: Record<"left" | "right", number>
		previewWPx: Record<"left" | "right", number>
		groupIcon: (u: RenderUnit) => any
		groupTitle: (u: RenderUnit) => string
		groupPinned: (u: RenderUnit) => boolean
		toggleGroupPin: (side: "left" | "right", u: RenderUnit) => void
		cellGridStyle: (
			u: RenderUnit,
			col: ColumnLayout,
			state: CellState
		) => string
		/**
		 * The slim rail of group icons. SessionLayout's snippet, because the
		 * LIVE `arrangedSide` renders it too — one markup, both places.
		 */
		groupRail: Snippet<
			["left" | "right", RenderUnit[], ColumnLayout, boolean]
		>
	}

	let {
		editGeom,
		leftZoneId,
		rightZoneId,
		leftGsItems,
		middleGsItems,
		rightGsItems,
		seedKeys,
		editArranged = $bindable(),
		railPreview,
		dragOverZone = $bindable(),
		armedId,
		onZoneDragOver,
		onZoneDrop,
		onZoneClick,
		placing,
		layout,
		toggleZonePin,
		removeWidget,
		duplicateWidget,
		onDropped,
		pinOnDrop,
		markSimDirty,
		leftPreview,
		rightPreview,
		leftPreviewCol,
		rightPreviewCol,
		simNarrow,
		simHeight,
		previewPx = $bindable(),
		previewWPx = $bindable(),
		groupIcon,
		groupTitle,
		groupPinned,
		toggleGroupPin,
		cellGridStyle,
		groupRail
	}: Props = $props()

</script>

<!-- One zone drawn as its real widget grid + a square-cell guide overlay. -->
{#snippet editZonePanel(
	zoneId: string | null,
	label: string,
	HeadIcon: any,
	gsItems: GsItem[],
	isMiddle: boolean,
	onChange?: (layout: ArrangedZone) => void
)}
	<!-- Which of the three arranged zones this panel IS. One expression, spent
	     on the frame below and on naming the zone a cross-zone drop landed in. -->
	{@const zoneKey = (
		isMiddle ? "middle" : zoneId === leftZoneId ? "left" : "right"
	) as ZoneId}
	<!-- The frame these cards were restored from, so the zone can re-express a
	     saved arrangement in the grid it is being drawn in — and can tell that
	     it is a restore, with nothing of its own to report yet. -->
	{@const frame = editArranged[zoneKey]}
	<!-- What the tray lands in here. The middle has no zone id (its membership
	     is the widget grid's, see `place`), so it carries the sentinel instead
	     — which is what gave it a dead `ondrop` and no tap target at all until
	     now. -->
	{@const target = isMiddle ? MIDDLE_TARGET : zoneId}
	<!-- Tap-to-place (docs: "tap it and then tap where it goes"): the palette
	     arms a chip, the zone takes it. `armedId` is the whole guard — with
	     nothing armed a click here does nothing, so the cards keep their own
	     clicks (selection, controls). The zone is a region that becomes a
	     placement target only while a chip is armed, a state no element role
	     describes; it is focusable exactly then, so Tab reaches the zones when
	     landing a widget on one is a move you can make and never otherwise. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
	<section
		class="zgrid"
		class:zgrid-middle={isMiddle}
		class:drag-over={!!target && dragOverZone === target}
		class:armed={!!target && !!armedId}
		data-pop-keep
		tabindex={target && armedId ? 0 : undefined}
		aria-label={target && armedId ? `Place in ${label}` : undefined}
		ondragover={(e) => target && onZoneDragOver(e, target)}
		ondragleave={() => (dragOverZone = null)}
		ondrop={(e) => target && onZoneDrop(e, target)}
		onclick={() => target && onZoneClick(target)}
		onkeydown={(e) => {
			// Only the zone's own Enter/Space places — a key pressed on a card's
			// button inside it is that button's, not a placement.
			if (!target || e.target !== e.currentTarget) return
			if (e.key !== "Enter" && e.key !== " ") return
			e.preventDefault()
			onZoneClick(target)
		}}
	>
		<header class="zgrid-head">
			<HeadIcon size={13} />
			{label}
			<!-- Only on Move, and only when it is true: a zone whose cells are
			     all taken snaps a DRAGGED card back, and without this the drop
			     just fails. The tray is the exception — `place` makes room for
			     what it lands (./arrangedGeometry `seatCard`), in all three
			     zones, while its cards can still give rows up; after that the
			     add is refused and says so (brief 7b review).
			     `frame` is this zone's arrangement, resolved above. -->
			{#if placing && zoneIsFull(frame)}
				<span class="flex-1"></span>
				<span class="zgrid-note">
					Full · a dragged card snaps back; adding from the tray makes
					room if it can
				</span>
			{/if}
		</header>
		<div class="zgrid-body">
			<!-- Re-seeded when the zone's committed members change, or the card
			     the floor keeps does (its × is built once, at seed) — from the
			     working frame, which holds every card dragged in, so nothing
			     arranged is lost. Never on a drag (./editorSeed). -->
			{#key seedKeys[zoneKey]}
				<GridStackZone
					items={gsItems}
					{frame}
					pinned={zoneId && showZonePin(frame)
						? layout.zones[zoneId]?.pinned !== false
						: undefined}
					onTogglePin={zoneId && showZonePin(frame)
						? () => toggleZonePin(zoneId)
						: undefined}
					{onChange}
					onRemove={(id) => removeWidget(id)}
					onDuplicate={duplicateOffered()
						? (id) => duplicateWidget(id)
						: undefined}
					onDropped={(id) => {
						onDropped(id, zoneKey)
						pinOnDrop(zoneId)
					}}
					onGesture={markSimDirty}
				/>
			{/key}
		</div>
	</section>
{/snippet}

<!-- The Move tab's RAIL PREVIEW: a side column drawn the way a session draws
     it — pinned groups docked at their share of the column, the rest icons in
     the rail, and whatever cannot fit opening over the session. The cards are
     titles, not live panels: the editor has never mounted a real panel a second
     time, and this is not the place to start.

     It replaces that side's gridstack zone while it is on (there is one saved
     arrangement and both are views of it), so arranging is the toggle away. -->
{#snippet railPreviewPanel(side: "left" | "right", label: string, HeadIcon: any)}
	{@const prev = side === "left" ? leftPreview : rightPreview}
	{@const col = side === "left" ? leftPreviewCol : rightPreviewCol}
	<section class="zgrid zgrid-rail" data-pop-keep>
		<header class="zgrid-head">
			<HeadIcon size={13} />
			{label}
			<span class="flex-1"></span>
			<span class="zgrid-note">
				{simNarrow ? "sheet" : "rail"}{simHeight ? ` · ${simHeight}px` : ""}
			</span>
		</header>
		<div
			class="zgrid-body rail-preview"
			style={simHeight ? `block-size:min(${simHeight}px,100%);` : ""}
		>
			<div class="side-column" class:col-left={side === "left"}>
				<div
					class="prev-stack"
					class:one-column={col.collapsed}
					bind:clientHeight={previewPx[side]}
					bind:clientWidth={previewWPx[side]}
					style="grid-template-rows:{col.rows || '1fr'};"
				>
					{#each prev.units as u (u.key)}
						{@const st = col.state[u.key] ?? "collapsed"}
						{@const Icon = groupIcon(u)}
						<div
							class="prev-card card-{st}"
							class:from-left={side === "left"}
							style={cellGridStyle(u, col, st)}
						>
							<div class="prev-head">
								<Icon size={12} />
								<span class="prev-title">{groupTitle(u)}</span>
								<button
									class="prev-pin"
									class:on={groupPinned(u)}
									title={groupPinned(u)
										? "Unpin — hand this group back to the rail"
										: "Pin — expanded by default, and it keeps its height"}
									aria-label="Pin {groupTitle(u)}"
									aria-pressed={groupPinned(u)}
									onclick={() => toggleGroupPin(side, u)}
								>
									<Icons.Pin size={11} />
								</button>
							</div>
							<div class="prev-body"></div>
						</div>
					{/each}
					{#if !prev.units.length}
						<span class="palette-empty">No widgets on this side.</span>
					{/if}
				</div>
				{#if prev.units.length}
					{@render groupRail(side, prev.units, col, true)}
				{/if}
			</div>
		</div>
	</section>
{/snippet}

<!-- The three editor zones. ONE markup for both the real editor and a simulated
     one, and ONE row: the three columns are tracks of a single grid row, the
     sides at the widths `simulatedGeometry` gives them and the centre track
     whatever is left. So the row is symmetric across whatever box holds it —
     the viewport in Actual, `.sim-frame` in a preview — and the three zones
     share one top and one bottom by construction rather than by two sets of
     numbers agreeing. Nothing branches on which; only the numbers change, and
     both sets come from `simulatedGeometry`.

     `GridStackZone` re-derives its column count from its own measured box, so a
     narrower frame clamps the arrangement exactly as that device would. It is
     NOT keyed on the simulated width: re-mounting would rebuild the zones from
     the saved items and throw away the arrangement in progress. -->
<div
	class="edit-canvas"
	style="grid-template-columns:{editGeom.left}px minmax(0,1fr) {editGeom.right}px;"
>
	<!-- A margin culled to 0 is one too narrow to hold a single cell — the
	     device would show no rail there, so neither do we. The track still
	     exists at 0px and gets an empty cell, so the centre stays the
	     middle track and the row stays symmetric. -->
	{#if leftZoneId && editGeom.left > 0}
		<div class="edit-side edit-side-left">
			{#if railPreview}
				{@render railPreviewPanel("left", "Left", Icons.PanelLeft)}
			{:else}
				{@render editZonePanel(
					leftZoneId,
					"Left",
					Icons.PanelLeft,
					leftGsItems,
					false,
					(l) => (editArranged.left = l)
				)}
			{/if}
		</div>
	{:else}
		<div class="edit-side edit-side-empty" aria-hidden="true"></div>
	{/if}
	<!-- Middle editor, capped to the centre half and centred in its track,
	     so it lines up with the side quarters in BOTH width modes (in
	     full-width the main is 100vw, so we cap it here). -->
	<div class="edit-center" style="max-inline-size:{editGeom.centre}px;">
		{@render editZonePanel(
			null,
			"Middle",
			Icons.MessageSquare,
			middleGsItems,
			true,
			(l) => (editArranged.middle = l)
		)}
	</div>
	{#if rightZoneId && editGeom.right > 0}
		<div class="edit-side edit-side-right">
			{#if railPreview}
				{@render railPreviewPanel(
					"right",
					"Right",
					Icons.PanelRight
				)}
			{:else}
				{@render editZonePanel(
					rightZoneId,
					"Right",
					Icons.PanelRight,
					rightGsItems,
					false,
					(l) => (editArranged.right = l)
				)}
			{/if}
		</div>
	{:else}
		<div class="edit-side edit-side-empty" aria-hidden="true"></div>
	{/if}
</div>

<style>
	/* The three zones as ONE grid row: the sides take the widths
	   `simulatedGeometry` gives them (an inline `grid-template-columns`) and
	   the centre track is what is left. They therefore share one top and one
	   bottom by construction, and the row is symmetric across whatever box
	   holds it — the window, or a simulated frame. */
	.edit-canvas {
		flex: 1;
		min-block-size: 0;
		display: grid;
		gap: 0.5rem;
		padding: 0.4rem;
		/* A dragged card must be able to cross a track. */
		overflow: visible;
	}
	.edit-side {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
	}
	/* Cap the middle editor to the centre half and centre it in its track, so
	   the ¼|½|¼ editor layout is identical whether full-width is on or off (in
	   full-width the main is 100vw, so without this the middle would fill it).
	   The cap itself is an inline style — `simulatedGeometry`'s centre, for the
	   real width or a simulated one — so this rule only owns the centring. */
	.edit-center {
		display: flex;
		flex-direction: column;
		inline-size: 100%;
		margin-inline: auto;
		min-inline-size: 0;
		min-block-size: 0;
	}

	/* ── the Move tab's rail preview ──────────────────────────────────────
	   A side column drawn as a session draws it. The cards are titles only —
	   the editor never mounts a live panel a second time — so everything here
	   is chrome; the behaviour it shows is ./sideRail's, the same call the live
	   column makes. */
	.zgrid-rail {
		overflow: visible; /* the flyout card reaches across the chat */
	}
	.zgrid-note {
		font-size: 12px;
		font-weight: 400;
		opacity: 0.75;
	}
	.rail-preview {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
	}
	.prev-stack {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.25rem;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: hidden;
	}
	.prev-card {
		display: flex;
		flex-direction: column;
		min-block-size: 0;
		border-radius: 0.5rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: var(--color-surface-50);
		overflow: hidden;
	}
	:global([data-mode="dark"]) .prev-card {
		background: var(--color-surface-950);
		border-color: color-mix(
			in oklab,
			var(--color-surface-600) 45%,
			transparent
		);
	}
	.prev-head {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.3rem;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-surface-600-400);
		background: color-mix(
			in oklab,
			var(--color-primary-500) 10%,
			transparent
		);
	}
	.prev-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.prev-pin {
		flex: none;
		display: flex;
		border-radius: 0.3rem;
		padding: 0.1rem;
		opacity: 0.45;
	}
	.prev-pin.on {
		opacity: 1;
		color: var(--color-primary-600);
	}
	.prev-body {
		flex: 1;
		min-block-size: 0;
		background: repeating-linear-gradient(
			-45deg,
			color-mix(in oklab, var(--color-surface-500) 9%, transparent) 0 5px,
			transparent 5px 10px
		);
	}
	/* Rule (c) in the preview: the card is over the session at the column's
	   full height. Absolute (not fixed) because the editor's margins are fixed
	   layers already, and the anchor is the column it left. */
	.prev-card.card-flyout {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: min(15rem, 300%);
		z-index: 5;
		box-shadow: -10px 0 28px rgba(0, 0, 0, 0.28);
		animation: fly-in-right 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.prev-card.card-flyout.from-left {
		inset-inline-end: auto;
		inset-inline-start: 0;
		box-shadow: 10px 0 28px rgba(0, 0, 0, 0.28);
		animation-name: fly-in-left;
	}

	/* A zone rendered as its own grid of square cells. Opaque so the busy chat
	   / scene backdrop behind never bleeds through the grid. */
	.zgrid {
		flex: 1;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0.7rem;
		border: 1.5px dashed
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		background: var(--color-surface-100);
		box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.55);
		/* Not clipped: a dragged card must be able to leave the zone box for a
		   cross-zone drop; the rounded corners still read via the header/body. */
		overflow: visible;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}
	:global([data-mode="dark"]) .zgrid {
		background: var(--color-surface-900);
	}
	.zgrid.drag-over {
		border-style: solid;
		border-color: var(--color-primary-500);
		background: color-mix(in oklab, var(--color-primary-500) 12%, var(--color-surface-100));
	}
	:global([data-mode="dark"]) .zgrid.drag-over {
		background: color-mix(in oklab, var(--color-primary-500) 18%, var(--color-surface-900));
	}
	/* A chip is armed: the zones that can take it say so, and the focused one
	   says which is about to. */
	.zgrid.armed {
		cursor: copy;
		border-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent);
	}
	.zgrid.armed:focus-visible {
		outline: 2px solid var(--color-primary-500);
		outline-offset: 2px;
	}
	.zgrid-middle {
		border-style: solid;
		border-color: color-mix(
			in oklab,
			var(--color-surface-400) 55%,
			transparent
		);
	}
	.zgrid-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
		padding: 0.35rem 0.6rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600);
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
	}
	:global([data-mode="dark"]) .zgrid-head {
		color: var(--color-surface-300);
	}
	/* The zone body hosts the real WidgetZone grid (which draws its own square
	   cell guides via `.cells`) plus the empty-state overlay. */
	.zgrid-body {
		position: relative;
		flex: 1;
		min-block-size: 0;
		padding: 0.4rem;
	}

	/* Duplicated from SessionLayout, not shared: a component's CSS is scoped to
	   its own markup, and the LIVE side column still needs these there. */
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

	/* The rail preview's empty note, moved here with the preview. */
	.palette-empty {
		font-size: 12px;
		color: var(--color-surface-500);
	}
</style>
