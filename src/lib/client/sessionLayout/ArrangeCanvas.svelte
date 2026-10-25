<script module lang="ts">
	import type { ArrangeTarget } from "./editorMembership.svelte"

	/** What the canvas asks of the editor's membership (./editorMembership). */
	export interface ArrangeMembership {
		armedId: string | null
		dragOverZone: string | null
		copyRefusalOf(id: string): string | null
		addWidget(widgetId: string, at: ArrangeTarget): string | null
		duplicateWidget(id: string): string | null
		removeWidget(id: string): boolean
		draggedId(e: DragEvent): string | null
		draggedWidget(e: DragEvent): string | null
	}

	/**
	 * How wide the editor draws a RAIL-ONLY side (every panel in the rail,
	 * §10 R-A): the rail strip plus a slim "Drop here to dock" zone. The live
	 * session draws such a side at `RAIL_PX`; the editor adds only the room
	 * its dock zone needs, so the picture matches the session.
	 */
	export const NARROW_SIDE_PX = 132
</script>

<script lang="ts">
	/**
	 * The **Arrange** tab's canvas (PLAN-session-panels-2026-10-14, lane 3;
	 * owner review §10): the editor's working panels drawn in the three zones
	 * the way the live session draws them — each side a stack of DOCKED panels
	 * plus its rail at the outer edge, the middle its strips above and below
	 * the primary — with the handles to rearrange them. The cards are titles,
	 * never live widgets: a second mount of a real widget is what the
	 * no-reload law forbids.
	 *
	 * Every edit is one of ./arrangeOps' pure ops, handed to `edit`; the
	 * editor keeps the result (or says its refusal). There is no lock (§10
	 * R-B) and no pin toggle (§10 R-C): where a panel is dropped says it all.
	 * - a panel's **tab strip**: a tray widget is added as a tab (`addTab`),
	 *   a placed tab moves in (`moveTab`), a dragged panel's tabs join it;
	 * - the **primary's header**: a dragged panel becomes the primary
	 *   (`setPrimary`; the old one goes to the end of `above`); a tab joins it;
	 * - a **gap** between docked panels and at each stack's ends: a new panel
	 *   there (`newPanel`), a tab split out (`splitOut`), or a panel moved
	 *   (`movePanel`) — and on a side, whatever lands in a gap is DOCKED;
	 * - a side's **rail strip** (its outer edge): whatever lands there goes in
	 *   the rail (`setPinned(key, false)`); a rail row dragged back into a gap
	 *   or onto a tab strip leaves it;
	 * - a **rail-only side** (every panel in the rail, §10 R-A) draws narrow,
	 *   as the session does: the strip and one "Drop here to dock" zone.
	 * Touch: tap a tray chip, then a target (every strip, gap and rail offers
	 * a button while a chip is armed).
	 *
	 * Between two DOCKED side panels the gap is also a divider: drag it, or
	 * focus it and press the arrow keys, to move one twelfth of the column
	 * between them (`setHeight` with `{ share }`).
	 */
	import * as Icons from "@lucide/svelte"
	import type { PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"
	import {
		moveTab,
		movePanel,
		panelOfTab,
		setHeight,
		setPinned,
		setPrimary,
		setTitle,
		splitOut,
		stackOf,
		type ArrangeOutcome,
		type StackPlace
	} from "./arrangeOps"
	import { PANEL_DRAG_TYPE, TAB_DRAG_TYPE } from "./editorMembership.svelte"
	import { duplicateOffered } from "./widgetInstances"
	import type { SideRailModel } from "./sideRailModel.svelte"
	import type { SimGeometry } from "./simulator"

	type Side = "left" | "right"

	interface Props {
		/** The editor's working panels. */
		panels: PanelLayoutV1
		/** Apply an op's outcome; `merge` folds it into the last undo step (a divider drag). */
		edit: (outcome: ArrangeOutcome, opts?: { merge?: boolean }) => boolean
		membership: ArrangeMembership
		/** The editor's ¼ | ½ | ¼ split, for the real width or a simulated tier. */
		editGeom: SimGeometry
		/** Tab icons (the live rail's). */
		rail: SideRailModel
		/** A tab's name on screen. */
		label: (id: string) => string
		/** A tab's gear: the widget settings flow. */
		openSettings: (id: string, trigger: HTMLElement) => void
	}

	let { panels, edit, membership, editGeom, rail, label, openSettings }: Props = $props()

	const uid = $props.id()

	/* ── selection: which tab of a panel the card's tools act on ─────────
	 * The editor's own, never written: a panel's `open` is the session's. */
	let chosen = $state<Record<string, string>>({})
	function chosenOf(p: PanelV1): string {
		const c = chosen[p.key]
		if (c && p.tabs.includes(c)) return c
		return p.open && p.tabs.includes(p.open) ? p.open : p.tabs[0]
	}

	/* ── the sides: docked panels and the rail ─────────────────────────── */
	/** Every panel of the side is in the rail: the side draws narrow (§10 R-A). An empty side keeps its column, as the session's does. */
	function railOnly(side: Side): boolean {
		const stack = stackOf(panels, side)
		return stack.length > 0 && stack.every((p) => p.pinned === false)
	}
	function sideWidth(side: Side): number {
		const w = editGeom[side]
		if (w <= 0) return 0
		return railOnly(side) ? Math.min(w, NARROW_SIDE_PX) : w
	}
	let widths = $derived({ left: sideWidth("left"), right: sideWidth("right") })
	/** The room a narrow side gives back goes to the middle. */
	let centreMax = $derived(
		editGeom.centre + (editGeom.left - widths.left) + (editGeom.right - widths.right)
	)
	/** A panel's name: its title (2+ tabs), else every tab's. */
	function panelName(p: PanelV1): string {
		if (p.title && p.tabs.length > 1) return p.title
		return p.tabs.map(label).join(" · ")
	}

	/* ── drops ──────────────────────────────────────────────────────────── */
	/** What is being dragged out of the canvas itself (lights the targets that take it). */
	let dragKind = $state<"panel" | "tab" | null>(null)
	function endDrag() {
		dragKind = null
	}
	function draggedPanel(e: DragEvent): string | null {
		return e.dataTransfer?.getData(PANEL_DRAG_TYPE) || null
	}
	function over(e: DragEvent, key: string) {
		e.preventDefault()
		e.stopPropagation()
		membership.dragOverZone = key
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move"
	}
	function leave(key: string) {
		if (membership.dragOverZone === key) membership.dragOverZone = null
	}
	function landed(e: DragEvent) {
		e.preventDefault()
		e.stopPropagation()
		membership.dragOverZone = null
		dragKind = null
	}
	/** A second op on the first's layout; the first's refusal stands. */
	function andThen(first: ArrangeOutcome, next: (l: PanelLayoutV1) => ArrangeOutcome): ArrangeOutcome {
		return first.layout ? next(first.layout) : first
	}
	/** Dock (or rail) a panel that now sits in `place`; a middle strip never pins. */
	function pinIn(l: PanelLayoutV1, key: string, place: StackPlace, pinned: boolean): ArrangeOutcome {
		if (place !== "left" && place !== "right") return { layout: l }
		return setPinned(l, key, pinned)
	}
	/** The key of the panel holding a tab in `l`. */
	function keyOf(l: PanelLayoutV1, id: string): string {
		return panelOfTab(l, id)?.panel.key ?? ""
	}
	function allOf(): PanelV1[] {
		return [
			...panels.left,
			...panels.right,
			...panels.middle.above,
			panels.middle.primary,
			...panels.middle.below
		]
	}
	/** A dragged panel's tabs join another panel, in order, at `index` (end when absent). */
	function mergeInto(from: string, to: string, index?: number): ArrangeOutcome {
		const src = allOf().find((p) => p.key === from)
		if (!src) return { layout: panels }
		let out: ArrangeOutcome = { layout: panels }
		src.tabs.forEach((id, k) => {
			out = andThen(out, (l) => moveTab(l, id, { panelKey: to, index: index == null ? undefined : index + k }))
		})
		return out
	}
	/**
	 * A drop on a tab strip: add as a tab, move a placed tab in, or — a
	 * dragged panel — join its tabs to this panel. On the PRIMARY's strip a
	 * dragged panel becomes the primary instead (`setPrimary`).
	 */
	function dropOnStrip(e: DragEvent, panelKey: string, index?: number) {
		landed(e)
		const widget = membership.draggedWidget(e)
		if (widget) {
			membership.addWidget(widget, { tab: { panelKey, index } })
			return
		}
		const key = draggedPanel(e)
		if (key) {
			if (key === panelKey) return
			if (panelKey === panels.middle.primary.key) edit(setPrimary(panels, key))
			else edit(mergeInto(key, panelKey, index))
			return
		}
		const id = membership.draggedId(e)
		if (id) edit(moveTab(panels, id, { panelKey, index }))
	}
	/** "Make this the main panel": a dragged panel becomes the primary. */
	function dropOnMain(e: DragEvent) {
		landed(e)
		const key = draggedPanel(e)
		if (key) {
			edit(setPrimary(panels, key))
			return
		}
		const id = membership.draggedId(e)
		if (id) edit(moveTab(panels, id, { panelKey: panels.middle.primary.key }))
	}
	/**
	 * The index a panel already in `place` lands at, counted the way
	 * `movePanel` counts it: the stack WITHOUT that panel.
	 */
	function indexWithout(place: StackPlace, index: number, key: string): number {
		const at = stackOf(panels, place).findIndex((p) => p.key === key)
		return at >= 0 && at < index ? index - 1 : index
	}
	/**
	 * A drop in a gap (or a rail-only side's dock zone): a new panel there, a
	 * tab split out, or a panel moved. On a side whatever lands is DOCKED — a
	 * rail row dragged into the column leaves the rail.
	 */
	function dropInGap(e: DragEvent, place: StackPlace, index: number) {
		landed(e)
		const widget = membership.draggedWidget(e)
		if (widget) {
			membership.addWidget(widget, { panel: { place, index } })
			return
		}
		const key = draggedPanel(e)
		if (key) {
			edit(
				andThen(movePanel(panels, key, { place, index: indexWithout(place, index, key) }), (l) =>
					pinIn(l, key, place, true)
				)
			)
			return
		}
		const id = membership.draggedId(e)
		if (!id) return
		const holder = allOf().find((p) => p.tabs.includes(id))
		// A lone tab moves its panel, so it counts the stack as `movePanel` does.
		const at = holder && holder.tabs.length === 1 ? indexWithout(place, index, holder.key) : index
		edit(andThen(splitOut(panels, id, { place, index: at }), (l) => pinIn(l, keyOf(l, id), place, true)))
	}
	/**
	 * A drop on a side's RAIL STRIP (§10 R-C): it goes in the rail. A panel of
	 * this side stays where it is in the order; one from elsewhere joins the
	 * end; a tab is split out to the end first.
	 */
	function dropOnRail(e: DragEvent, side: Side) {
		landed(e)
		const end = stackOf(panels, side).length
		const widget = membership.draggedWidget(e)
		if (widget) {
			membership.addWidget(widget, { panel: { place: side, index: end }, rail: true })
			return
		}
		const key = draggedPanel(e)
		if (key) {
			const here = stackOf(panels, side).some((p) => p.key === key)
			const moved = here ? { layout: panels } : movePanel(panels, key, { place: side, index: end })
			edit(andThen(moved, (l) => setPinned(l, key, false)))
			return
		}
		const id = membership.draggedId(e)
		if (!id) return
		edit(andThen(splitOut(panels, id, { place: side, index: end }), (l) => setPinned(l, keyOf(l, id), false)))
	}
	/** Tap-to-place: the armed chip lands at a target. */
	function placeArmed(at: ArrangeTarget) {
		const armed = membership.armedId
		if (armed) membership.addWidget(armed, at)
	}

	/* ── the tools on a card ──────────────────────────────────────────── */
	function onTabDragStart(e: DragEvent, id: string) {
		e.stopPropagation()
		e.dataTransfer?.setData(TAB_DRAG_TYPE, id)
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
		dragKind = "tab"
	}
	function onPanelDragStart(e: DragEvent, key: string) {
		e.stopPropagation()
		e.dataTransfer?.setData(PANEL_DRAG_TYPE, key)
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
		dragKind = "panel"
	}
	/** Where **Split out** puts a tab: right under its own panel; the primary's, the top of the strip below. */
	function splitOutOf(id: string, place: StackPlace | "primary", index: number) {
		if (place === "primary") edit(splitOut(panels, id, { place: "below", index: 0 }))
		else edit(splitOut(panels, id, { place, index: index + 1 }))
	}
	function heightName(p: PanelV1): "fit" | "fill" | "share" {
		if (p.height === "fit") return "fit"
		if (p.height && typeof p.height === "object") return "share"
		return "fill"
	}
	function commitTitle(p: PanelV1, value: string) {
		edit(setTitle(panels, p.key, value))
	}

	/* ── the divider between two docked side panels ─────────────────────
	 * A panel's share is its `{ share }`, else what it is drawn at now, in
	 * twelfths of the docked panels' height (measured), else an equal split. */
	let cardPx = $state<Record<string, number>>({})
	function dockedOf(side: Side): PanelV1[] {
		return panels[side].filter((p) => p.pinned !== false)
	}
	function shareOf(side: Side, p: PanelV1): number {
		if (p.height && typeof p.height === "object") return p.height.share
		const docked = dockedOf(side)
		const total = docked.reduce((n, d) => n + (cardPx[d.key] ?? 0), 0)
		const px = cardPx[p.key] ?? 0
		if (total > 0 && px > 0) return Math.max(1, Math.round((12 * px) / total))
		return Math.max(1, Math.round(12 / Math.max(1, docked.length)))
	}
	/** Set the pair's shares to `a` and `pair - a`, keeping each at least one. */
	function resizePair(upper: PanelV1, lower: PanelV1, a: number, pair: number, merge = false): boolean {
		const total = Math.max(2, pair)
		const next = Math.max(1, Math.min(total - 1, a))
		const one = setHeight(panels, upper.key, { share: next })
		if (!one.layout) return edit(one)
		const two = setHeight(one.layout, lower.key, { share: total - next })
		if (!two.layout) return edit(two)
		if (two.layout === panels) return false
		return edit(two, { merge })
	}
	function onDividerKey(e: KeyboardEvent, side: Side, upper: PanelV1, lower: PanelV1) {
		const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
		if (!step) return
		e.preventDefault()
		const a = shareOf(side, upper)
		const b = shareOf(side, lower)
		resizePair(upper, lower, a + step, a + b)
	}
	let dragging: {
		upper: PanelV1
		lower: PanelV1
		y: number
		a: number
		pair: number
		px: number
		moved: boolean
	} | null = null
	function onDividerDown(e: PointerEvent, side: Side, upper: PanelV1, lower: PanelV1) {
		if (e.button !== 0) return
		const a = shareOf(side, upper)
		const b = shareOf(side, lower)
		const px = dockedOf(side).reduce((n, d) => n + (cardPx[d.key] ?? 0), 0)
		dragging = { upper, lower, y: e.clientY, a, pair: a + b, px, moved: false }
		;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
	}
	function onDividerMove(e: PointerEvent) {
		const d = dragging
		if (!d || !(d.px > 0)) return
		const twelfths = Math.round(((e.clientY - d.y) / d.px) * 12)
		if (resizePair(d.upper, d.lower, d.a + twelfths, d.pair, d.moved)) d.moved = true
	}
	function onDividerUp() {
		dragging = null
	}

	/** A docked panel's share of its column's grow, in the editor's flex stack. */
	function growOf(stack: PanelV1[], p: PanelV1, side: boolean): string {
		if (p.height === "fit") return "flex: none;"
		const docked = stack.filter((d) => !side || d.pinned !== false)
		const shares = docked.reduce(
			(n, d) => n + (d.height && typeof d.height === "object" ? d.height.share : 0),
			0
		)
		const fills = docked.filter((d) => d.height === undefined).length
		if (p.height && typeof p.height === "object") return `flex: ${p.height.share} 1 0;`
		const rest = Math.max(1, 12 - shares)
		return `flex: ${rest / Math.max(1, fills)} 1 0;`
	}
</script>

<!-- One tab in a card's strip: drag it, choose it, remove it. -->
{#snippet tab(p: PanelV1, id: string, i: number)}
	{@const on = chosenOf(p) === id}
	{@const dropKey = `tab:${p.key}:${i}`}
	{@const Icon = rail.tabIcon(id)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="atab"
		class:on
		class:drag-over={membership.dragOverZone === dropKey}
		draggable="true"
		data-arrange-tab={id}
		ondragstart={(e) => onTabDragStart(e, id)}
		ondragend={endDrag}
		ondragover={(e) => over(e, dropKey)}
		ondragleave={() => leave(dropKey)}
		ondrop={(e) => dropOnStrip(e, p.key, i)}
	>
		<button
			type="button"
			class="atab-name"
			aria-pressed={on}
			title={label(id)}
			onclick={() => (chosen[p.key] = id)}
		>
			<Icon size={13} aria-hidden="true" />
			<span class="atab-label">{label(id)}</span>
		</button>
		<button
			type="button"
			class="atab-btn"
			data-tab-remove={id}
			aria-label="Remove {label(id)}"
			title="Remove {label(id)}"
			onclick={() => membership.removeWidget(id)}
		>
			<Icons.X size={12} aria-hidden="true" />
		</button>
	</div>
{/snippet}

<!-- One docked panel's card: its strip (a handle on every panel) and its tools. -->
{#snippet card(p: PanelV1, place: StackPlace | "primary", index: number, stack: PanelV1[])}
	{@const side = place === "left" || place === "right"}
	{@const primary = place === "primary"}
	{@const stripKey = `strip:${p.key}`}
	{@const mainKey = `main:${p.key}`}
	{@const sel = chosenOf(p)}
	{@const copyRefusal = membership.copyRefusalOf(sel)}
	<section
		class="acard"
		class:acard-primary={primary}
		data-arrange-panel={p.key}
		style={primary ? "" : growOf(stack, p, side)}
		bind:clientHeight={cardPx[p.key]}
		aria-label={panelName(p)}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<header
			class="astrip"
			class:drag-over={membership.dragOverZone === stripKey}
			data-arrange-strip={p.key}
			ondragover={(e) => over(e, stripKey)}
			ondragleave={() => leave(stripKey)}
			ondrop={(e) => dropOnStrip(e, p.key)}
		>
			<span
				class="agrip"
				draggable="true"
				role="img"
				data-arrange-grip={p.key}
				aria-label="Drag to move this panel"
				title={primary
					? "Drag to move the main panel — the nearest panel in the middle takes its place"
					: "Drag to move this panel"}
				ondragstart={(e) => onPanelDragStart(e, p.key)}
				ondragend={endDrag}
			>
				<Icons.GripVertical size={13} aria-hidden="true" />
			</span>
			<div class="atabs" role="group" aria-label="Tabs">
				{#each p.tabs as id, i (id)}
					{@render tab(p, id, i)}
				{/each}
			</div>
			{#if membership.armedId}
				<button
					type="button"
					class="aplace"
					data-place-tab={p.key}
					onclick={() => placeArmed({ tab: { panelKey: p.key } })}
				>
					<Icons.Plus size={12} aria-hidden="true" />
					Add as a tab
				</button>
			{/if}
			<span class="flex-1"></span>
			{#if primary}
				<!-- The primary is a place (§10): a panel dropped here becomes it. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="amain"
					class:lit={dragKind === "panel"}
					class:drag-over={membership.dragOverZone === mainKey}
					data-arrange-make-primary={p.key}
					title="Drop a panel here to make it the main panel"
					ondragover={(e) => over(e, mainKey)}
					ondragleave={() => leave(mainKey)}
					ondrop={dropOnMain}
				>
					<Icons.Crown size={12} aria-hidden="true" />
					<span class:sr-only={dragKind !== "panel"}>Make this the main panel</span>
				</span>
			{/if}
		</header>
		<div class="atools">
			<div class="atools-row" role="group" aria-label="{label(sel)} tools">
				{#if duplicateOffered()}
					<button
						type="button"
						class="tool"
						data-tab-duplicate={sel}
						disabled={!!copyRefusal}
						title={copyRefusal ?? `Duplicate ${label(sel)}`}
						onclick={() => membership.duplicateWidget(sel)}
					>
						<Icons.Copy size={12} aria-hidden="true" />
						Duplicate
					</button>
				{/if}
				{#if p.tabs.length > 1}
					<button
						type="button"
						class="tool"
						data-tab-split={sel}
						title="Move {label(sel)} into a panel of its own"
						onclick={() => splitOutOf(sel, place, index)}
					>
						<Icons.SquareSplitVertical size={12} aria-hidden="true" />
						Split out
					</button>
				{/if}
				<button
					type="button"
					class="tool"
					aria-haspopup="dialog"
					data-tab-settings={sel}
					aria-label="{label(sel)} settings"
					title="{label(sel)} settings"
					onclick={(e) => openSettings(sel, e.currentTarget)}
				>
					<Icons.Settings size={12} aria-hidden="true" />
				</button>
			</div>
			{#if !primary}
				{@const h = heightName(p)}
				<div class="atools-row">
					<div class="aseg" role="group" aria-label="Height">
						<button
							type="button"
							class="aseg-btn"
							class:on={h === "fit"}
							aria-pressed={h === "fit"}
							data-height-fit={p.key}
							title="As tall as its content"
							onclick={() => edit(setHeight(panels, p.key, "fit"))}>Fit</button
						>
						<button
							type="button"
							class="aseg-btn"
							class:on={h === "fill"}
							aria-pressed={h === "fill"}
							data-height-fill={p.key}
							title="Share the room left with the other filling panels"
							onclick={() => edit(setHeight(panels, p.key, undefined))}>Fill</button
						>
					</div>
					{#if h === "share" && typeof p.height === "object"}
						<span class="anote">{p.height.share}/12</span>
					{/if}
				</div>
			{/if}
			{#if p.tabs.length > 1}
				<label class="atitle">
					<span class="sr-only">Panel name</span>
					<input
						type="text"
						maxlength="60"
						value={p.title ?? ""}
						placeholder={p.tabs.map(label).join(" · ")}
						data-panel-title={p.key}
						onkeydown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault()
								commitTitle(p, e.currentTarget.value)
							}
						}}
						onblur={(e) => commitTitle(p, e.currentTarget.value)}
					/>
				</label>
			{/if}
		</div>
	</section>
{/snippet}

<!-- A gap: a new panel goes here. Between two docked side panels it is also
     the divider that moves a twelfth of the column between them. `upper` and
     `lower` are the DOCKED neighbours (rail panels draw in the strip). -->
{#snippet gap(place: StackPlace, index: number, upper?: PanelV1, lower?: PanelV1, fill = false)}
	{@const key = `gap:${place}:${index}`}
	{@const side = place === "left" || place === "right"}
	{@const divider =
		side && !!upper && !!lower && upper.height !== "fit" && lower.height !== "fit"}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="agap"
		class:agap-fill={fill}
		class:drag-over={membership.dragOverZone === key}
		data-arrange-gap="{place}:{index}"
		ondragover={(e) => over(e, key)}
		ondragleave={() => leave(key)}
		ondrop={(e) => dropInGap(e, place, index)}
	>
		{#if membership.armedId}
			<button
				type="button"
				class="aplace"
				data-place-panel="{place}:{index}"
				onclick={() => placeArmed({ panel: { place, index } })}
			>
				<Icons.Plus size={12} aria-hidden="true" />
				New panel here
			</button>
		{:else if divider && upper && lower}
			{@const s = place as Side}
			{@const a = shareOf(s, upper)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				class="adivider"
				role="separator"
				tabindex="0"
				aria-orientation="horizontal"
				aria-valuemin={1}
				aria-valuemax={Math.max(1, a + shareOf(s, lower) - 1)}
				aria-valuenow={a}
				aria-label="Height of {label(upper.tabs[0])} and {label(lower.tabs[0])}"
				title="Drag, or use the arrow keys, to share the height"
				data-arrange-divider="{place}:{index}"
				onkeydown={(e) => onDividerKey(e, s, upper, lower)}
				onpointerdown={(e) => onDividerDown(e, s, upper, lower)}
				onpointermove={onDividerMove}
				onpointerup={onDividerUp}
				onpointercancel={onDividerUp}
			></div>
		{:else if fill}
			<span class="ahint">Drop a widget here</span>
		{/if}
	</div>
{/snippet}

<!-- A middle strip: gaps around and between its cards. -->
{#snippet stackOfPlace(place: StackPlace)}
	{@const stack = stackOf(panels, place)}
	{@render gap(place, 0, undefined, stack[0])}
	{#each stack as p, i (p.key)}
		{@render card(p, place, i, stack)}
		{@render gap(place, i + 1, p, stack[i + 1])}
	{/each}
{/snippet}

<!-- A side's column: its DOCKED panels as cards, gaps by their index in the
     whole stack (rail panels included), or — rail-only — one dock zone. -->
{#snippet sideColumn(side: Side)}
	{@const stack = stackOf(panels, side)}
	{@const docked = stack.map((p, i) => ({ p, i })).filter((d) => d.p.pinned !== false)}
	{#if !stack.length}
		{@render gap(side, 0, undefined, undefined, true)}
	{:else if !docked.length}
		{@const key = `dock:${side}`}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="adock"
			class:drag-over={membership.dragOverZone === key}
			data-arrange-dock={side}
			ondragover={(e) => over(e, key)}
			ondragleave={() => leave(key)}
			ondrop={(e) => dropInGap(e, side, stack.length)}
		>
			{#if membership.armedId}
				<button
					type="button"
					class="aplace"
					data-place-panel="{side}:{stack.length}"
					onclick={() => placeArmed({ panel: { place: side, index: stack.length } })}
				>
					<Icons.Plus size={12} aria-hidden="true" />
					Dock here
				</button>
			{:else}
				<span class="ahint">Drop here to dock</span>
			{/if}
		</div>
	{:else}
		{@render gap(side, 0, undefined, docked[0].p)}
		{#each docked as d, j (d.p.key)}
			{@render card(d.p, side, d.i, stack)}
			{@render gap(side, d.i + 1, d.p, docked[j + 1]?.p)}
		{/each}
	{/if}
{/snippet}

<!-- A side's RAIL STRIP, at its outer edge (§10 R-C): the side's rail panels
     as collapsed rows, and the drop target that puts a panel in the rail. -->
{#snippet railStrip(side: Side)}
	{@const stack = stackOf(panels, side)}
	{@const railed = stack.filter((p) => p.pinned === false)}
	{@const key = `rail:${side}`}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="arail"
		class:lit={!!membership.armedId || dragKind !== null}
		class:drag-over={membership.dragOverZone === key}
		data-arrange-rail={side}
		title="The rail — drop a panel here to put it in the rail"
		ondragover={(e) => over(e, key)}
		ondragleave={() => leave(key)}
		ondrop={(e) => dropOnRail(e, side)}
	>
		<span class="sr-only">{side === "left" ? "Left" : "Right"} rail</span>
		{#each railed as p (p.key)}
			{@const Icon = rail.tabIcon(p.tabs[0])}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="arail-row"
				draggable="true"
				data-arrange-rail-row={p.key}
				title="{panelName(p)} — in the rail. Drag it into the column to dock it."
				ondragstart={(e) => onPanelDragStart(e, p.key)}
				ondragend={endDrag}
			>
				<span class="arail-icon">
					<Icon size={15} aria-hidden="true" />
					{#if p.tabs.length > 1}
						<span class="arail-count">{p.tabs.length}</span>
					{/if}
				</span>
				<span class="arail-name">{panelName(p)}</span>
			</div>
		{/each}
		{#if membership.armedId}
			<button
				type="button"
				class="arail-place"
				data-place-rail={side}
				aria-label="Add to the rail"
				title="Add to the rail"
				onclick={() => placeArmed({ panel: { place: side, index: stack.length }, rail: true })}
			>
				<Icons.Plus size={13} aria-hidden="true" />
			</button>
		{/if}
	</div>
{/snippet}

{#snippet zone(side: Side)}
	{@const narrow = railOnly(side)}
	<section
		class="azone"
		class:azone-narrow={narrow}
		data-pop-keep
		data-arrange-zone={side}
		data-rail-only={narrow ? "" : undefined}
		aria-labelledby="{uid}-{side}"
	>
		<header class="azone-head" id="{uid}-{side}">
			{#if side === "left"}
				<Icons.PanelLeft size={13} aria-hidden="true" /> Left
			{:else}
				<Icons.PanelRight size={13} aria-hidden="true" /> Right
			{/if}
		</header>
		<div class="aside-body" class:aside-left={side === "left"}>
			{@render railStrip(side)}
			<div class="astack">
				{@render sideColumn(side)}
			</div>
		</div>
	</section>
{/snippet}

<div
	class="edit-canvas"
	data-arrange-canvas
	style="grid-template-columns:{widths.left}px minmax(0,1fr) {widths.right}px;"
>
	{#if widths.left > 0}
		<div class="edit-side">{@render zone("left")}</div>
	{:else}
		<div class="edit-side" aria-hidden="true"></div>
	{/if}
	<div class="edit-center" style="max-inline-size:{centreMax}px;">
		<section class="azone azone-middle" data-pop-keep data-arrange-zone="middle" aria-labelledby="{uid}-middle">
			<header class="azone-head" id="{uid}-middle">
				<Icons.MessageSquare size={13} aria-hidden="true" /> Middle
			</header>
			<div class="astack">
				{@render stackOfPlace("above")}
				{@render card(panels.middle.primary, "primary", 0, [])}
				{@render stackOfPlace("below")}
			</div>
		</section>
	</div>
	{#if widths.right > 0}
		<div class="edit-side">{@render zone("right")}</div>
	{:else}
		<div class="edit-side" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.edit-canvas {
		flex: 1;
		min-block-size: 0;
		display: grid;
		gap: 0.5rem;
		padding: 0.4rem;
	}
	.edit-side {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;
	}
	.edit-center {
		display: flex;
		flex-direction: column;
		inline-size: 100%;
		margin-inline: auto;
		min-inline-size: 0;
		min-block-size: 0;
	}
	/* A zone: opaque, so the session behind never bleeds through. */
	.azone {
		flex: 1;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		border-radius: 0.7rem;
		border: 1.5px dashed color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		background: var(--color-surface-100);
		box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.55);
		overflow: visible;
	}
	:global([data-mode="dark"]) .azone {
		background: var(--color-surface-900);
	}
	.azone-middle {
		border-style: solid;
		border-color: color-mix(in oklab, var(--color-surface-400) 55%, transparent);
	}
	.azone-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex: none;
		padding: 0.35rem 0.6rem;
		font-size: 13px;
		font-weight: 500;
		color: var(--color-surface-600-400);
		border-block-end: 1px solid color-mix(in oklab, var(--color-surface-400) 30%, transparent);
	}
	/* A stack: cards and the gaps between them, top to bottom. */
	.astack {
		flex: 1;
		min-block-size: 0;
		display: flex;
		flex-direction: column;
		padding: 0 0.4rem;
		overflow-y: auto;
	}
	.acard {
		display: flex;
		flex-direction: column;
		min-block-size: 72px;
		border-radius: 0.5rem;
		border: 1px solid color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: var(--color-surface-50);
		overflow: hidden;
	}
	:global([data-mode="dark"]) .acard {
		background: var(--color-surface-950);
		border-color: color-mix(in oklab, var(--color-surface-600) 45%, transparent);
	}
	.acard-primary {
		flex: 1 1 0;
		min-block-size: 120px;
	}
	/* The strip: drawn on every panel here, so every panel has handles. */
	.astrip {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.25rem;
		min-block-size: 32px;
		background: color-mix(in oklab, var(--color-primary-500) 10%, transparent);
		border-block-end: 1px solid color-mix(in oklab, var(--color-surface-400) 30%, transparent);
	}
	.astrip.drag-over,
	.atab.drag-over,
	.agap.drag-over {
		outline: 2px dashed color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		outline-offset: -2px;
		background: color-mix(in oklab, var(--color-primary-500) 14%, transparent);
	}
	.agrip {
		display: flex;
		cursor: grab;
		opacity: 0.6;
		padding: 0.1rem;
	}
	.atabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		min-inline-size: 0;
	}
	.atab {
		display: flex;
		align-items: center;
		min-inline-size: 0;
		border-radius: 0.35rem;
		border-block-end: 2px solid transparent;
		cursor: grab;
	}
	.atab.on {
		border-block-end-color: var(--color-primary-500);
	}
	.atab-name {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-inline-size: 0;
		min-block-size: 24px;
		padding: 0 0.3rem;
		font-size: 12px;
		font-weight: 500;
	}
	.atab-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-inline-size: 10rem;
	}
	.atab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 24px;
		min-inline-size: 24px;
		border-radius: 0.3rem;
		color: var(--color-surface-600-400);
	}
	.atab-btn:hover {
		background: color-mix(in oklab, var(--color-surface-500) 15%, transparent);
	}
	.atools {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.35rem 0.4rem;
		min-block-size: 0;
		overflow: hidden;
	}
	.atools-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}
	.tool,
	.aplace {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-block-size: 24px;
		padding: 0 0.45rem;
		border-radius: 0.35rem;
		font-size: 12px;
		border: 1px solid color-mix(in oklab, var(--color-surface-400) 40%, transparent);
	}
	.tool:disabled {
		opacity: 0.5;
	}
	.aplace {
		border-style: dashed;
		border-color: color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		color: var(--color-primary-700-300);
	}
	.aseg {
		display: inline-flex;
		border-radius: 0.35rem;
		background: var(--color-surface-200-800);
		padding: 1px;
	}
	.aseg-btn {
		min-block-size: 22px;
		padding: 0 0.5rem;
		font-size: 12px;
		border-radius: 0.3rem;
	}
	.aseg-btn.on {
		background: color-mix(in oklab, var(--color-primary-500) 22%, transparent);
		color: var(--color-primary-700-300);
	}
	.anote,
	.ahint {
		font-size: 12px;
		color: var(--color-surface-600-400);
	}
	.atitle input {
		inline-size: 100%;
		min-block-size: 24px;
		padding: 0 0.4rem;
		font-size: 12px;
		border-radius: 0.35rem;
		border: 1px solid color-mix(in oklab, var(--color-surface-400) 40%, transparent);
		background: transparent;
	}
	/* A gap: a thin target that opens up under a drag. */
	.agap {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		min-block-size: 10px;
		border-radius: 0.35rem;
		transition: min-block-size var(--transition-duration-base) ease;
	}
	.agap.drag-over {
		min-block-size: 32px;
	}
	.agap:has(.aplace) {
		padding-block: 0.2rem;
	}
	.agap-fill {
		flex: 1;
		border: 1px dashed color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		margin-block: 0.4rem;
	}
	.adivider {
		inline-size: 40%;
		block-size: 6px;
		border-radius: 3px;
		cursor: row-resize;
		touch-action: none;
		background: color-mix(in oklab, var(--color-surface-500) 35%, transparent);
	}
	.adivider:hover,
	.adivider:focus-visible {
		background: var(--color-primary-500);
		outline: none;
	}

	/* ── a side: the rail strip at its outer edge, the docked column ──── */
	.aside-body {
		flex: 1;
		min-block-size: 0;
		display: flex;
		flex-direction: row-reverse;
		gap: 0.25rem;
		padding-inline-end: 0.25rem;
	}
	.aside-body.aside-left {
		flex-direction: row;
		padding-inline-end: 0;
		padding-inline-start: 0.25rem;
	}
	.aside-body > .astack {
		flex: 1;
		min-inline-size: 0;
		padding: 0;
	}
	/* The strip is the live rail's width; a standing target here (§6.7: arranging is this tab's job). */
	.arail {
		flex: none;
		inline-size: 36px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding-block: 0.3rem;
		margin-block: 0.3rem;
		border-radius: 0.45rem;
		border: 1px dashed color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: color-mix(in oklab, var(--color-surface-500) 7%, transparent);
		overflow-y: auto;
	}
	.arail.lit {
		border-color: color-mix(in oklab, var(--color-primary-500) 70%, transparent);
	}
	.arail.drag-over,
	.adock.drag-over,
	.amain.drag-over {
		outline: 2px dashed color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		outline-offset: -2px;
		background: color-mix(in oklab, var(--color-primary-500) 14%, transparent);
	}
	.arail-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		inline-size: 30px;
		padding-block: 0.25rem;
		border-radius: 0.35rem;
		cursor: grab;
		color: var(--color-surface-700-300);
		background: var(--color-surface-50);
		border: 1px solid color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	:global([data-mode="dark"]) .arail-row {
		background: var(--color-surface-950);
	}
	.arail-icon {
		position: relative;
		display: flex;
	}
	.arail-count {
		position: absolute;
		inset-block-start: -0.35rem;
		inset-inline-end: -0.5rem;
		min-inline-size: 14px;
		padding-inline: 2px;
		border-radius: 999px;
		font-size: 10px;
		line-height: 14px;
		text-align: center;
		color: var(--color-surface-50);
		background: var(--color-primary-500);
	}
	/* The name reads down the strip, as a collapsed rail row's does. */
	.arail-name {
		writing-mode: vertical-rl;
		max-block-size: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		font-weight: 500;
	}
	.arail-place {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 28px;
		min-block-size: 28px;
		border-radius: 0.35rem;
		border: 1px dashed color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		color: var(--color-primary-700-300);
	}
	/* A rail-only side: the strip and one dock zone. */
	.adock {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-block: 0.4rem;
		padding: 0.3rem;
		text-align: center;
		border-radius: 0.45rem;
		border: 1px dashed color-mix(in oklab, var(--color-surface-400) 45%, transparent);
	}
	/* "Make this the main panel": quiet until a panel is dragged. */
	.amain {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-block-size: 24px;
		padding: 0 0.4rem;
		border-radius: 0.35rem;
		font-size: 12px;
		color: var(--color-surface-600-400);
		border: 1px dashed transparent;
	}
	.amain.lit {
		border-color: color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		color: var(--color-primary-700-300);
	}
</style>
