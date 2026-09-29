<script lang="ts">
	/**
	 * The PHONE editor (ruled 2026-09-10), split out of SessionLayout.
	 *
	 * Below the breakpoint the layout is an ordered list per zone, because that
	 * is what the session draws there — no side-by-side placements, anchors
	 * reduced to order, each side group a panel that is either open or an icon.
	 * The editor edits exactly those three facts, through ./mobileEdit, into the
	 * SAME `editArranged` the grid writes and the same commit on Done. There is
	 * no mobile layout blob and no mobile preset.
	 *
	 * The two gates that decide whether this is mounted at all — `mobileEdit`
	 * and `liveStowed` — stay in SessionLayout, because the live session's own
	 * mount reads them. This component is only what is drawn once they say yes,
	 * and its sheet state is its own: closing the editor unmounts it, which
	 * resets that state with no work in SessionLayout's `closeEditor`.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"
	import type { GsLayout } from "./GridStackZone.svelte"
	import type { Arranged, ZoneKey } from "./arrangedGeometry"
	// The phone editor's model (ruled 2026-09-10): below the breakpoint the
	// layout is an ordered list per zone, not a grid, and these are the only
	// edits it may make to the one arrangement. See ./mobileEdit.
	import {
		mobileRows,
		moveMember,
		moveRow,
		moveRowTo,
		restackZone,
		setRowPinned,
		type MobileRow
	} from "./mobileEdit"
	import type { RenderUnit } from "./tabGroups"
	import type { SimTier } from "./simulator"
	// A widget's settings and style open in the one app-level modal — the same
	// one the desktop editor's gear opens, a full-screen sheet at this width.
	import { openWidgetSettings } from "./widgetSettingsModal.svelte"
	import { isInstanceOf } from "$lib/shared/widgets/instanceId"

	/** One side's previewed column, as SessionLayout's `previewColumn` returns it. */
	type PreviewColumn = { frame: GsLayout; units: RenderUnit[] }

	interface Props {
		/**
		 * The editor's working arrangement — the same object the grid editor
		 * writes, bound so `writeZone` stores a re-ordered zone into it.
		 */
		editArranged: Arranged
		/** The three previewed columns; only their `frame` is edited here. */
		leftPreview: PreviewColumn
		rightPreview: PreviewColumn
		middlePreview: PreviewColumn
		/** The Move tab's width preset, and the width it stands for. */
		simTier: SimTier | null
		simWidth: number | null
		/**
		 * The arrangement as it stood the moment Actual was left. Written into
		 * as well as read, for the reason `toggleGroupPin` is (see
		 * SessionLayout): leaving the preview restores this snapshot. Bound, so
		 * that write is a co-owner's rather than a stranger's.
		 */
		simSnapshot: Arranged | null
		/** The canonical side zones, or null where the layout has none. */
		leftZoneId: string | null
		rightZoneId: string | null
		/**
		 * The live column's open/closed state, keyed by `groupKey`. Bound for
		 * the same reason `simSnapshot` is: pinning a row writes into it.
		 */
		groupOpen: Record<string, boolean>
		groupKey: (side: "left" | "right", key: string) => string
		/** SessionLayout's lookups over the surface manager. */
		inst: (id: string) => PanelInstance | undefined
		iconOf: (p: PanelInstance) => any
		middleWidgetIcon: (id: string) => any
		widgetLabel: (id: string) => string
		/** Everything not yet placed — the picker sheet's list. */
		paletteWidgets: PanelInstance[]
		/** The one landing and the one removal, both SessionLayout's. */
		place: (target: string, widgetId: string, beforeId?: string) => void
		removeWidget: (widgetId: string) => void
		/**
		 * What the primary floor says about a widget (./primaryFloor): the note
		 * shown in place of its ×, when it is the last instance of the genre's
		 * primary widget, else null.
		 */
		floorNoteOf: (widgetId: string) => string | null
		/** The layouts sheet. */
		presets: Sockets.Sessions.LayoutPreset[]
		activePreset: Sockets.Sessions.LayoutPreset | null
		applyPreset: (presetId: number) => void
		/**
		 * The name box for "save this arrangement as a preset". Bound because
		 * SessionLayout's Done reads it — `finishEditing` calls `savePreset`.
		 */
		presetName: string
		savePreset: () => void
		resetLayout: () => void
		/** The sticky bar's two commit controls, SessionLayout's own. */
		onCancel: () => void
		onDone: () => void
		/**
		 * A preset's picture. Defined in SessionLayout because the desktop
		 * Presets pane draws it too, and passed down so both draw the one.
		 */
		presetPicture: Snippet<[unknown]>
	}

	let {
		editArranged = $bindable(),
		leftPreview,
		rightPreview,
		middlePreview,
		simTier,
		simWidth,
		simSnapshot = $bindable(),
		leftZoneId,
		rightZoneId,
		groupOpen = $bindable(),
		groupKey,
		inst,
		iconOf,
		middleWidgetIcon,
		widgetLabel,
		paletteWidgets,
		place,
		removeWidget,
		floorNoteOf,
		presets,
		activePreset,
		applyPreset,
		presetName = $bindable(),
		savePreset,
		resetLayout,
		onCancel,
		onDone,
		presetPicture
	}: Props = $props()

	/** The zone a widget is being added to, if the picker sheet is open. */
	let pickerTarget = $state<{ zone: ZoneKey; id: string } | null>(null)
	/** The presets sheet is open. */
	let presetSheet = $state(false)
	/** The group a drag handle is carrying, for the row's own styling. */
	let dragRowKey = $state<string | null>(null)

	/** The frame the phone editor writes into — the working one, or the default. */
	function editFrame(zone: ZoneKey): GsLayout {
		return (
			zone === "left"
				? leftPreview
				: zone === "right"
					? rightPreview
					: middlePreview
		).frame
	}
	/**
	 * Store one zone's re-ordered arrangement.
	 *
	 * Written into a simulated tier's snapshot as well, for the reason a pin is
	 * (see SessionLayout's `toggleGroupPin`): leaving the preview restores that snapshot, and an
	 * order the user stated must survive it without also rescuing the clamp a
	 * narrow preview made of everything else.
	 */
	function writeZone(zone: ZoneKey, next: GsLayout) {
		if (next === editFrame(zone)) return
		editArranged[zone] = next
		if (simTier !== null && simSnapshot) simSnapshot[zone] = next
	}
	function moveRowIn(zone: ZoneKey, key: string, delta: number) {
		writeZone(zone, moveRow(editFrame(zone), key, delta))
	}
	function moveMemberIn(
		zone: ZoneKey,
		key: string,
		id: string,
		delta: number
	) {
		writeZone(zone, moveMember(editFrame(zone), key, id, delta))
	}
	/**
	 * Add or remove a widget from the phone editor, cells and all.
	 *
	 * The grid editor lets gridstack seed a newcomer and report the result back;
	 * with no grid mounted the arrangement has to be written here, or Done would
	 * commit a frame that does not name the widget just added — and the side
	 * would draw everything except it. Removal closes the row it leaves behind.
	 */
	function addWidgetTo(zone: ZoneKey, zoneId: string, widgetId: string) {
		// Read the frame BEFORE the placement: `place` rewrites the zone's
		// widget list, which is what `editFrame` is derived from.
		const frame = editFrame(zone)
		const foot = frame.items.length
			? Math.max(...frame.items.map((i) => i.y + i.h))
			: 0
		const h = 3
		place(zoneId, widgetId)
		writeZone(zone, {
			cols: frame.cols,
			rows: Math.max(frame.rows, foot + h),
			items: [
				...frame.items,
				{ id: widgetId, x: 0, y: foot, w: frame.cols, h }
			]
		})
	}
	function removeWidgetFrom(zone: ZoneKey, widgetId: string) {
		const frame = editFrame(zone)
		removeWidget(widgetId)
		writeZone(
			zone,
			restackZone({
				...frame,
				items: frame.items.filter((i) => i.id !== widgetId)
			})
		)
	}
	function setRowPin(zone: ZoneKey, key: string, pinned: boolean) {
		writeZone(zone, setRowPinned(editFrame(zone), key, pinned))
		// "Pinned" IS "expanded by default", so the live column follows.
		if (zone !== "middle") groupOpen[groupKey(zone, key)] = pinned
	}

	/** The zones the phone editor lists, chat first. */
	let mobileZones = $derived(
		(
			[
				["middle", "Middle", Icons.MessageSquare, null],
				["left", "Left", Icons.PanelLeft, leftZoneId],
				["right", "Right", Icons.PanelRight, rightZoneId]
			] as const
		)
			.filter(([key, , , zoneId]) => key === "middle" || !!zoneId)
			.map(([key, label, icon, zoneId]) => ({
				key,
				label,
				icon,
				zoneId,
				rows: mobileRows(editFrame(key))
			}))
	)
	function rowIcon(row: MobileRow) {
		if (row.members.length > 1) return Icons.Layers
		const id = row.members[0]
		if (isInstanceOf(id, "messages")) return middleWidgetIcon(id)
		const p = inst(id)
		return p ? iconOf(p) : Icons.LayoutPanelTop
	}
	function rowTitle(row: MobileRow): string {
		return row.members.map(widgetLabel).join(" · ")
	}

	/* ── the drag handle ────────────────────────────────────────────────────
	 * A touch reorder, spent as the same single steps the arrow buttons are: a
	 * pointer that has travelled a whole row's height asks for the next index,
	 * and `moveRowTo` decides whether the arrangement can express it. Pointer
	 * events rather than HTML drag-and-drop, which no mobile browser fires.
	 */
	let dragZone: ZoneKey | null = null
	let dragIndex = 0
	let dragOriginY = 0
	let dragStepPx = 44

	function startRowDrag(
		e: PointerEvent,
		zone: ZoneKey,
		key: string,
		index: number
	) {
		const grip = e.currentTarget as HTMLElement
		const row = grip.closest("li") as HTMLElement | null
		if (!row) return
		e.preventDefault()
		grip.setPointerCapture(e.pointerId)
		dragZone = zone
		dragRowKey = key
		dragIndex = index
		dragOriginY = e.clientY
		dragStepPx = Math.max(24, row.offsetHeight)
	}
	function dragRow(e: PointerEvent) {
		if (!dragRowKey || !dragZone) return
		const steps = Math.trunc((e.clientY - dragOriginY) / dragStepPx)
		if (!steps) return
		const zone = dragZone
		const key = dragRowKey
		const before = editFrame(zone)
		const next = moveRowTo(before, key, dragIndex + steps)
		writeZone(zone, next)
		dragOriginY += steps * dragStepPx
		const at = mobileRows(next).findIndex((r) => r.key === key)
		if (at >= 0) dragIndex = at
	}
	function endRowDrag(e: PointerEvent) {
		const grip = e.currentTarget as HTMLElement
		if (grip.hasPointerCapture(e.pointerId))
			grip.releasePointerCapture(e.pointerId)
		dragRowKey = null
		dragZone = null
	}

	/** Escape closes the topmost sheet, innermost first. */
	$effect(() => {
		if (!pickerTarget && !presetSheet) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return
			if (pickerTarget) pickerTarget = null
			else presetSheet = false
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})
</script>

<!-- The PHONE editor (ruled 2026-09-10). A screen this narrow draws no
     side-by-side widgets and no rail, so the editor is what the session is: an
     ordered list per zone, a pin per group, and sheets for everything that a
     desktop hovers for. It writes the same arrangement the grid does — see
     ./mobileEdit — and commits down the same path.

     It sits OVER the live session rather than replacing it, so nothing in the
     session reloads while the order is edited. -->
{#snippet mobileRowItem(
	zone: ZoneKey,
	zoneId: string | null,
	rows: MobileRow[],
	row: MobileRow,
	index: number
)}
	{@const Icon = rowIcon(row)}
	{@const title = rowTitle(row)}
	<li class="medit-row" class:dragging={dragRowKey === row.key}>
		<div class="medit-line">
			<!-- The drag handle. `touch-action: none` (in CSS) is what stops the
			     page scrolling under a finger that is reordering. -->
			<button
				class="medit-grip"
				aria-label="Reorder {title}"
				onpointerdown={(e) => startRowDrag(e, zone, row.key, index)}
				onpointermove={dragRow}
				onpointerup={endRowDrag}
				onpointercancel={endRowDrag}
			>
				<Icons.GripVertical size={16} />
			</button>
			<Icon size={16} />
			<span class="medit-name">{title}</span>
			{#if row.rank !== 1}
				<span class="medit-badge">
					{row.rank === 0 ? "First" : "Last"}
				</span>
			{/if}
		</div>
		<div class="medit-acts">
			<button
				class="medit-btn"
				disabled={index === 0}
				aria-label="Move {title} up"
				onclick={() => moveRowIn(zone, row.key, -1)}
			>
				<Icons.ChevronUp size={15} />
			</button>
			<button
				class="medit-btn"
				disabled={index === rows.length - 1}
				aria-label="Move {title} down"
				onclick={() => moveRowIn(zone, row.key, 1)}
			>
				<Icons.ChevronDown size={15} />
			</button>
			{#if zone !== "middle"}
				<!-- The per-group pin, the arrangement's own field: pinned it is
				     open from the start and keeps its height, unpinned it waits
				     as an entry in the panels menu. -->
				<button
					class="medit-btn"
					class:on={row.pinned}
					aria-pressed={row.pinned}
					aria-label={row.pinned ? `Unpin ${title}` : `Pin ${title}`}
					onclick={() => setRowPin(zone, row.key, !row.pinned)}
				>
					<Icons.Pin size={15} />
				</button>
			{/if}
			<button
				class="medit-btn"
				aria-label="Open {title} settings"
				aria-haspopup="dialog"
				onclick={(e) =>
					openWidgetSettings(
						{
							widgetId: row.members[0],
							label: widgetLabel(row.members[0])
						},
						e.currentTarget
					)}
			>
				<Icons.Settings size={15} />
			</button>
			{#if zoneId && row.members.length === 1}
				{@const keep = floorNoteOf(row.members[0])}
				{#if keep}
					<!-- The primary floor keeps the last Messages: no ×, and
					     the reason where the × would be. -->
					<span class="medit-floor" role="note" title={keep} aria-label={keep}>
						<Icons.Lock size={14} aria-hidden="true" />
					</span>
				{:else}
					<button
						class="medit-btn"
						aria-label="Remove {title}"
						onclick={() => removeWidgetFrom(zone, row.members[0])}
					>
						<Icons.X size={15} />
					</button>
				{/if}
			{/if}
		</div>
		{#if row.members.length > 1}
			<!-- A tab group's own order: which tab comes first. -->
			<ul class="medit-members">
				{#each row.members as id, m (id)}
					<li class="medit-member">
						<span class="medit-name">{widgetLabel(id)}</span>
						<button
							class="medit-btn"
							disabled={m === 0}
							aria-label="Move {widgetLabel(id)} earlier"
							onclick={() => moveMemberIn(zone, row.key, id, -1)}
						>
							<Icons.ChevronUp size={14} />
						</button>
						<button
							class="medit-btn"
							disabled={m === row.members.length - 1}
							aria-label="Move {widgetLabel(id)} later"
							onclick={() => moveMemberIn(zone, row.key, id, 1)}
						>
							<Icons.ChevronDown size={14} />
						</button>
						<button
							class="medit-btn"
							aria-label="Open {widgetLabel(id)} settings"
							aria-haspopup="dialog"
							onclick={(e) =>
								openWidgetSettings(
									{ widgetId: id, label: widgetLabel(id) },
									e.currentTarget
								)}
						>
							<Icons.Settings size={14} />
						</button>
						{#if zoneId}
							{@const keep = floorNoteOf(id)}
							{#if keep}
								<span class="medit-floor" role="note" title={keep} aria-label={keep}>
									<Icons.Lock size={13} aria-hidden="true" />
								</span>
							{:else}
								<button
									class="medit-btn"
									aria-label="Remove {widgetLabel(id)}"
									onclick={() => removeWidgetFrom(zone, id)}
								>
									<Icons.X size={14} />
								</button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="medit" role="dialog" aria-label="Layout" data-pop-keep>
	<header class="medit-head">
		<Icons.LayoutDashboard size={15} />
		<span class="medit-heading">Layout</span>
		<span class="flex-1"></span>
		{#if simTier !== null}
			<span class="medit-note">Previewing {simWidth} px</span>
		{/if}
	</header>
	<div class="medit-body">
		<p class="medit-note">
			A screen this narrow draws one widget under the next. Drag a handle,
			or use the arrows, to change the order.
		</p>
		{#each mobileZones as z (z.key)}
			{@const ZoneIcon = z.icon}
			<section class="medit-zone">
				<header class="medit-zone-head">
					<ZoneIcon size={13} />
					{z.label}
					<span class="flex-1"></span>
					{#if z.zoneId}
						<button
							class="medit-chip"
							onclick={() =>
								(pickerTarget = z.zoneId
									? { zone: z.key, id: z.zoneId }
									: null)}
						>
							<Icons.Plus size={13} />
							Add
						</button>
					{/if}
				</header>
				<ul class="medit-list">
					{#each z.rows as row, i (row.key)}
						{@render mobileRowItem(z.key, z.zoneId, z.rows, row, i)}
					{/each}
					{#if !z.rows.length}
						<li class="medit-empty">Nothing here yet.</li>
					{/if}
				</ul>
			</section>
		{/each}
	</div>
	<!-- The sticky bar is the toolbar down here: commit, cancel and restore
	     without a row of tabs a thumb cannot reach. -->
	<div class="medit-bar">
		<button class="medit-chip" onclick={() => (presetSheet = true)}>
			<Icons.LayoutTemplate size={14} />
			Presets
		</button>
		<button
			class="medit-chip"
			title="Drop this session's own arrangement"
			aria-label="Reset to default"
			onclick={resetLayout}
		>
			<Icons.RotateCcw size={14} />
		</button>
		<span class="flex-1"></span>
		<button class="medit-chip" onclick={onCancel}>Cancel</button>
		<button class="medit-chip primary" onclick={onDone}>
			<Icons.Check size={14} />
			Done
		</button>
	</div>
</div>

{#if pickerTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="msheet-scrim" onclick={() => (pickerTarget = null)}></div>
	<div class="msheet" role="dialog" aria-label="Add a widget" data-pop-keep>
		<header class="msheet-head">
			<Icons.Plus size={14} />
			<span>Add a widget</span>
			<span class="flex-1"></span>
			<button
				class="medit-btn"
				aria-label="Close"
				onclick={() => (pickerTarget = null)}
			>
				<Icons.X size={16} />
			</button>
		</header>
		<div class="msheet-body">
			{#each paletteWidgets as p (p.id)}
				{@const IconCmp = iconOf(p)}
				<button
					class="msheet-item"
					onclick={() => {
						const target = pickerTarget
						pickerTarget = null
						if (target) addWidgetTo(target.zone, target.id, p.id)
					}}
				>
					<IconCmp size={18} />
					<span>{p.title}</span>
				</button>
			{:else}
				<p class="medit-note">All widgets are placed.</p>
			{/each}
		</div>
	</div>
{/if}

{#if presetSheet}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="msheet-scrim" onclick={() => (presetSheet = false)}></div>
	<div class="msheet" role="dialog" aria-label="Layouts" data-pop-keep>
		<header class="msheet-head">
			<Icons.LayoutTemplate size={14} />
			<span>Layouts</span>
			<span class="flex-1"></span>
			<button
				class="medit-btn"
				aria-label="Close"
				onclick={() => (presetSheet = false)}
			>
				<Icons.X size={16} />
			</button>
		</header>
		<div class="msheet-body">
			{#each presets as p (p.id)}
				<button
					class="msheet-item"
					class:on={activePreset?.id === p.id}
					aria-pressed={activePreset?.id === p.id}
					onclick={() => {
						applyPreset(p.id)
						presetSheet = false
					}}
				>
					{@render presetPicture(p.layout)}
					<span>{p.name}</span>
				</button>
			{/each}
			<div class="msheet-save">
				<input
					class="preset-input"
					type="text"
					placeholder="Name this layout"
					maxlength="80"
					aria-label="Name this layout"
					bind:value={presetName}
				/>
				<button
					class="medit-chip primary"
					disabled={!presetName.trim()}
					onclick={() => {
						savePreset()
						presetSheet = false
					}}
				>
					Save
				</button>
			</div>
			<button
				class="medit-chip"
				onclick={() => {
					resetLayout()
					presetSheet = false
				}}
			>
				<Icons.RotateCcw size={14} />
				Reset to default
			</button>
		</div>
	</div>
{/if}

<style>
	/* ── the phone editor ──────────────────────────────────────────────────
	   Fixed over the session, which stays mounted underneath: a full-height
	   column of head / scrolling list / sticky bar, so the commit controls are
	   at the thumb end whatever the list does. */
	.medit {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-50);
		color: var(--color-surface-contrast-50);
	}
	:global([data-mode="dark"]) .medit {
		background: var(--color-surface-950);
		color: var(--color-surface-contrast-950);
	}
	.medit-head,
	.medit-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		border-block-end: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
	}
	.medit-bar {
		border-block-end: none;
		border-block-start: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
		/* The home indicator on a phone sits over the last few pixels. */
		padding-block-end: max(0.5rem, env(safe-area-inset-bottom));
	}
	.medit-heading {
		font-weight: 600;
	}
	.medit-body {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.medit-note {
		font-size: 0.75rem;
		opacity: 0.7;
		margin: 0;
	}
	.medit-zone {
		border: 1px solid color-mix(in oklab, currentColor 14%, transparent);
		border-radius: 0.5rem;
		overflow: hidden;
	}
	.medit-zone-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		background: color-mix(in oklab, currentColor 6%, transparent);
	}
	.medit-list,
	.medit-members {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.medit-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.4rem;
		padding: 0.4rem 0.5rem;
		border-block-start: 1px solid
			color-mix(in oklab, currentColor 10%, transparent);
	}
	.medit-row.dragging {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 14%,
			transparent
		);
	}
	.medit-line {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex: 1 1 10rem;
		min-inline-size: 0;
	}
	.medit-name {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
	}
	.medit-badge {
		font-size: 0.6875rem;
		padding: 0.1rem 0.3rem;
		border-radius: 0.25rem;
		background: color-mix(in oklab, currentColor 12%, transparent);
	}
	.medit-acts {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}
	/* A touch target, not an icon: 2.25rem is the smallest square a thumb hits
	   reliably, and every control in this editor is one. */
	.medit-btn,
	.medit-grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		border-radius: 0.4rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.medit-grip {
		/* The page must not scroll under a finger that is reordering. */
		touch-action: none;
		cursor: grab;
	}
	.medit-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}
	/* Where the × would be on the row the primary floor keeps: the reason, as
	   a quiet lock (its label says it), taking the ×'s square so the row's
	   controls do not shift. */
	.medit-floor {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 2.25rem;
		block-size: 2.25rem;
		color: var(--color-surface-600-400);
	}
	.medit-btn.on {
		color: var(--color-primary-500);
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 40%,
			transparent
		);
	}
	.medit-members {
		flex-basis: 100%;
		padding-inline-start: 2.25rem;
	}
	.medit-member {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8rem;
		opacity: 0.85;
	}
	.medit-empty {
		padding: 0.5rem;
		font-size: 0.75rem;
		opacity: 0.6;
	}
	.medit-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.4rem 0.7rem;
		min-block-size: 2.25rem;
		border-radius: 0.4rem;
		border: 1px solid color-mix(in oklab, currentColor 22%, transparent);
		background: transparent;
		color: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.medit-chip.primary {
		background: var(--color-primary-500);
		color: var(--color-primary-contrast-500);
		border-color: transparent;
	}
	.medit-chip:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── the sheets ────────────────────────────────────────────────────────
	   A picker, the layouts and one widget's settings each arrive over the
	   editor rather than inside it: on a screen this narrow there is no room
	   beside the list, and a hover overlay has nothing to hover. */
	.msheet-scrim {
		position: fixed;
		inset: 0;
		z-index: 41;
		background: rgba(0, 0, 0, 0.4);
	}
	.msheet {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		z-index: 42;
		display: flex;
		flex-direction: column;
		max-block-size: 85dvh;
		border-start-start-radius: 0.75rem;
		border-start-end-radius: 0.75rem;
		background: var(--color-surface-50);
		color: var(--color-surface-contrast-50);
		box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3);
	}
	:global([data-mode="dark"]) .msheet {
		background: var(--color-surface-950);
		color: var(--color-surface-contrast-950);
	}
	.msheet-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		font-weight: 600;
		font-size: 0.85rem;
		border-block-end: 1px solid
			color-mix(in oklab, currentColor 14%, transparent);
	}
	.msheet-body {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		padding: 0.75rem;
		padding-block-end: max(0.75rem, env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.msheet-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		min-block-size: 2.75rem;
		border-radius: 0.4rem;
		border: 1px solid color-mix(in oklab, currentColor 16%, transparent);
		background: transparent;
		color: inherit;
		font-size: 0.85rem;
		text-align: start;
		cursor: pointer;
	}
	.msheet-item.on {
		border-color: var(--color-primary-500);
	}
	.msheet-save {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.msheet-save .preset-input {
		flex: 1;
		min-inline-size: 0;
	}
	/* Duplicated from SessionLayout's Presets pane, not shared: Svelte scopes
	   a component's CSS to its own markup, and the sheet's name box left that
	   scope with the sheet. The desktop pane still carries the original. */
	.preset-input {
		padding: 0.28rem 0.5rem;
		border-radius: 0.5rem;
		font-size: 14px;
		width: 10rem;
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(
			in oklab,
			var(--color-surface-100) 80%,
			transparent
		);
		color: var(--color-surface-800);
	}
	:global([data-mode="dark"]) .preset-input {
		background: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
		color: var(--color-surface-100);
	}
</style>
