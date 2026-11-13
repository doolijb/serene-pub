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
</script>

<script lang="ts">
	/**
	 * The **Arrange** tab's canvas: the editor's working panels (panels v2)
	 * drawn in the three zones the way the live session draws them — left,
	 * middle and right are each one plain stack of panels, top to bottom —
	 * with the handles to rearrange them. The cards are titles, never live
	 * widgets: a second mount of a real widget is what the no-reload law
	 * forbids. There is no rail, no primary panel and no pin.
	 *
	 * Every edit is one of ./arrangeOps' pure ops, handed to `edit`; the
	 * editor keeps the result (or says its refusal). Where a panel is dropped
	 * says it all:
	 * - a panel's **tab strip**: a tray widget is added as a tab (`addTab`),
	 *   a placed tab moves in (`moveTab`), a dragged panel's tabs join it;
	 * - a **gap** between panels and at each stack's ends: a new panel there
	 *   (`newPanel`), a tab split out (`splitOut`), or a panel moved
	 *   (`movePanel`).
	 * Touch: tap a tray chip, then a target (every strip and gap offers a
	 * button while a chip is armed).
	 *
	 * Between two ADJACENT panels of any zone whose effective heights are
	 * both not Fit, the gap is also a divider: drag it, or focus it and press
	 * the arrow keys, to move one twelfth of the stack between them
	 * (`setHeight` with `{ share }`). Each card also carries Fit · Fill and
	 * Priority (High · Normal · Low), which read the EFFECTIVE value — stored,
	 * else the open widget's declaration.
	 *
	 * The **chosen tab** is the editor's (`chosen` / `onChoose`): clicking a
	 * tab's name or its gear chooses it, and its settings show in the
	 * inspector pane; clicking empty canvas clears the choice. A card's tools
	 * act on its chosen tab when it holds it, else its open one.
	 */
	import * as Icons from "@lucide/svelte"
	import type { PanelLayoutV2, PanelPriority, PanelV2 } from "@serene-pub/sdk"
	import {
		heightOf,
		moveTab,
		movePanel,
		panelOfTab,
		priorityOf,
		setHeight,
		setPriority,
		setTitle,
		splitOut,
		stackOf,
		allPanels,
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
		panels: PanelLayoutV2
		/** Apply an op's outcome; `merge` folds it into the last undo step (a divider drag). */
		edit: (outcome: ArrangeOutcome, opts?: { merge?: boolean }) => boolean
		membership: ArrangeMembership
		/** The editor's ¼ | ½ | ¼ split, for the real width or a simulated tier. */
		editGeom: SimGeometry
		/** Tab icons (the live rail's). */
		rail: SideRailModel
		/** A tab's name on screen. */
		label: (id: string) => string
		/** The editor's chosen tab (instance id), or null. */
		chosen: string | null
		/** Choose a tab (its settings show in the inspector), or clear the choice (null). */
		onChoose: (id: string | null) => void
	}

	let {
		panels,
		edit,
		membership,
		editGeom,
		rail,
		label,
		chosen,
		onChoose
	}: Props = $props()

	const uid = $props.id()

	/* ── selection: which tab of a panel the card's tools act on ─────────
	 * The chosen tab when this panel holds it, else its open one. Never written. */
	function selOf(p: PanelV2): string {
		if (chosen && p.tabs.includes(chosen)) return chosen
		return p.open && p.tabs.includes(p.open) ? p.open : p.tabs[0]
	}
	/** A panel's name: its title (2+ tabs), else every tab's. */
	function panelName(p: PanelV2): string {
		if (p.title && p.tabs.length > 1) return p.title
		return p.tabs.map(label).join(" · ")
	}

	/** A click on empty canvas (not a card, a button, a field or a divider) clears the choice. */
	function onCanvasClick(e: MouseEvent) {
		const t = e.target as Element | null
		if (t?.closest?.(".acard, button, input, [role='separator']")) return
		onChoose(null)
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
	function andThen(
		first: ArrangeOutcome,
		next: (l: PanelLayoutV2) => ArrangeOutcome
	): ArrangeOutcome {
		return first.layout ? next(first.layout) : first
	}
	/** A dragged panel's tabs join another panel, in order, at `index` (end when absent). */
	function mergeInto(
		from: string,
		to: string,
		index?: number
	): ArrangeOutcome {
		const src = allPanels(panels).find((e) => e.panel.key === from)?.panel
		if (!src) return { layout: panels }
		let out: ArrangeOutcome = { layout: panels }
		src.tabs.forEach((id, k) => {
			out = andThen(out, (l) =>
				moveTab(l, id, {
					panelKey: to,
					index: index == null ? undefined : index + k
				})
			)
		})
		return out
	}
	/** A drop on a tab strip: add as a tab, move a placed tab in, or — a dragged panel — join its tabs to this panel. */
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
			edit(mergeInto(key, panelKey, index))
			return
		}
		const id = membership.draggedId(e)
		if (id) edit(moveTab(panels, id, { panelKey, index }))
	}
	/**
	 * The index a panel already in `place` lands at, counted the way
	 * `movePanel` counts it: the stack WITHOUT that panel.
	 */
	function indexWithout(
		place: StackPlace,
		index: number,
		key: string
	): number {
		const at = stackOf(panels, place).findIndex((p) => p.key === key)
		return at >= 0 && at < index ? index - 1 : index
	}
	/** A drop in a gap: a new panel there, a tab split out, or a panel moved. */
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
				movePanel(panels, key, {
					place,
					index: indexWithout(place, index, key)
				})
			)
			return
		}
		const id = membership.draggedId(e)
		if (!id) return
		const holder = panelOfTab(panels, id)?.panel
		// A lone tab moves its panel, so it counts the stack as `movePanel` does.
		const at =
			holder && holder.tabs.length === 1
				? indexWithout(place, index, holder.key)
				: index
		edit(splitOut(panels, id, { place, index: at }))
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
	/** **Split out** puts a tab right under its own panel. */
	function splitOutOf(id: string, place: StackPlace, index: number) {
		edit(splitOut(panels, id, { place, index: index + 1 }))
	}
	function heightName(p: PanelV2): "fit" | "fill" | "share" {
		const h = heightOf(p)
		if (h === "fit") return "fit"
		if (h && typeof h === "object") return "share"
		return "fill"
	}
	function shareNote(p: PanelV2): number | null {
		const h = heightOf(p)
		return h && typeof h === "object" ? h.share : null
	}
	function commitTitle(p: PanelV2, value: string) {
		edit(setTitle(panels, p.key, value))
	}
	const PRIORITIES: { value: PanelPriority; name: string }[] = [
		{ value: "high", name: "High" },
		{ value: "normal", name: "Normal" },
		{ value: "low", name: "Low" }
	]
	function pressPriority(p: PanelV2, v: PanelPriority) {
		if (priorityOf(p) !== v) edit(setPriority(panels, p.key, v))
	}

	/* ── the divider between two adjacent panels of a stack ─────────────
	 * A panel's share is its `{ share }`, else what it is drawn at now, in
	 * twelfths of the stack's non-Fit panels' height (measured), else an
	 * equal split. */
	let cardPx = $state<Record<string, number>>({})
	function sizedOf(stack: PanelV2[]): PanelV2[] {
		return stack.filter((p) => heightOf(p) !== "fit")
	}
	function shareOf(stack: PanelV2[], p: PanelV2): number {
		const h = heightOf(p)
		if (h && typeof h === "object") return h.share
		const sized = sizedOf(stack)
		const total = sized.reduce((n, d) => n + (cardPx[d.key] ?? 0), 0)
		const px = cardPx[p.key] ?? 0
		if (total > 0 && px > 0)
			return Math.max(1, Math.round((12 * px) / total))
		return Math.max(1, Math.round(12 / Math.max(1, sized.length)))
	}
	/** Set the pair's shares to `a` and `pair - a`, keeping each at least one. */
	function resizePair(
		upper: PanelV2,
		lower: PanelV2,
		a: number,
		pair: number,
		merge = false
	): boolean {
		const total = Math.max(2, pair)
		const next = Math.max(1, Math.min(total - 1, a))
		const one = setHeight(panels, upper.key, { share: next })
		if (!one.layout) return edit(one)
		const two = setHeight(one.layout, lower.key, { share: total - next })
		if (!two.layout) return edit(two)
		if (two.layout === panels) return false
		return edit(two, { merge })
	}
	function onDividerKey(
		e: KeyboardEvent,
		stack: PanelV2[],
		upper: PanelV2,
		lower: PanelV2
	) {
		const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
		if (!step) return
		e.preventDefault()
		const a = shareOf(stack, upper)
		const b = shareOf(stack, lower)
		resizePair(upper, lower, a + step, a + b)
	}
	let dragging: {
		upper: PanelV2
		lower: PanelV2
		y: number
		a: number
		pair: number
		px: number
		moved: boolean
	} | null = null
	function onDividerDown(
		e: PointerEvent,
		stack: PanelV2[],
		upper: PanelV2,
		lower: PanelV2
	) {
		if (e.button !== 0) return
		const a = shareOf(stack, upper)
		const b = shareOf(stack, lower)
		const px = sizedOf(stack).reduce((n, d) => n + (cardPx[d.key] ?? 0), 0)
		dragging = {
			upper,
			lower,
			y: e.clientY,
			a,
			pair: a + b,
			px,
			moved: false
		}
		;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
	}
	function onDividerMove(e: PointerEvent) {
		const d = dragging
		if (!d || !(d.px > 0)) return
		const twelfths = Math.round(((e.clientY - d.y) / d.px) * 12)
		if (resizePair(d.upper, d.lower, d.a + twelfths, d.pair, d.moved))
			d.moved = true
	}
	function onDividerUp() {
		dragging = null
	}

	/** A panel's share of its stack's grow, in the editor's flex column. */
	function growOf(stack: PanelV2[], p: PanelV2): string {
		const h = heightOf(p)
		if (h === "fit") return "flex: none;"
		if (typeof h === "object") return `flex: ${h.share} 1 0;`
		const sized = sizedOf(stack)
		const shares = sized.reduce((n, d) => {
			const dh = heightOf(d)
			return n + (typeof dh === "object" ? dh.share : 0)
		}, 0)
		const fills = sized.filter((d) => heightOf(d) === "fill").length
		const rest = Math.max(1, 12 - shares)
		return `flex: ${rest / Math.max(1, fills)} 1 0;`
	}
</script>

<!-- One tab in a card's strip: drag it, choose it, remove it. -->
{#snippet tab(p: PanelV2, id: string, i: number)}
	{@const on = selOf(p) === id}
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
			onclick={() => onChoose(id)}
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

<!-- One panel's card: its strip (a handle on every panel) and its tools. -->
{#snippet card(p: PanelV2, place: StackPlace, index: number, stack: PanelV2[])}
	{@const stripKey = `strip:${p.key}`}
	{@const sel = selOf(p)}
	{@const copyRefusal = membership.copyRefusalOf(sel)}
	{@const isChosen = !!chosen && p.tabs.includes(chosen)}
	{@const h = heightName(p)}
	{@const note = shareNote(p)}
	{@const prio = priorityOf(p)}
	<section
		class={[
			"acard",
			isChosen &&
				"ring-primary-500 ring-offset-surface-50-950 ring-2 ring-offset-2"
		]}
		data-arrange-panel={p.key}
		data-chosen={isChosen ? chosen : undefined}
		style={growOf(stack, p)}
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
				title="Drag to move this panel"
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
		</header>
		<div class="atools">
			<div
				class="atools-row"
				role="group"
				aria-label="{label(sel)} tools"
			>
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
						<Icons.SquareSplitVertical
							size={12}
							aria-hidden="true"
						/>
						Split out
					</button>
				{/if}
				<button
					type="button"
					class="tool"
					data-tab-settings={sel}
					aria-label="{label(sel)} settings"
					title="{label(sel)} settings"
					onclick={() => onChoose(sel)}
				>
					<Icons.Settings size={12} aria-hidden="true" />
				</button>
			</div>
			<div class="atools-row">
				<div class="aseg" role="group" aria-label="Height">
					<button
						type="button"
						class="aseg-btn"
						class:on={h === "fit"}
						aria-pressed={h === "fit"}
						data-height-fit={p.key}
						title="As tall as its content"
						onclick={() => {
							if (h !== "fit")
								edit(setHeight(panels, p.key, "fit"))
						}}
					>
						Fit
					</button>
					<button
						type="button"
						class="aseg-btn"
						class:on={h === "fill"}
						aria-pressed={h === "fill"}
						data-height-fill={p.key}
						title="Share the room left with the other filling panels"
						onclick={() => {
							if (h !== "fill")
								edit(setHeight(panels, p.key, undefined))
						}}
					>
						Fill
					</button>
				</div>
				{#if note !== null}
					<span class="anote">{note}/12</span>
				{/if}
			</div>
			<div class="atools-row">
				<div class="aseg" role="group" aria-label="Priority">
					{#each PRIORITIES as v (v.value)}
						<button
							type="button"
							class="aseg-btn"
							class:preset-pressed={prio === v.value}
							aria-pressed={prio === v.value}
							{...{ [`data-priority-${v.value}`]: p.key }}
							onclick={() => pressPriority(p, v.value)}
						>
							{v.name}
						</button>
					{/each}
				</div>
			</div>
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

<!-- A gap: a new panel goes here. Between two adjacent panels that are both
     not Fit it is also the divider that moves a twelfth of the stack between
     them. -->
{#snippet gap(
	place: StackPlace,
	index: number,
	stack: PanelV2[],
	upper?: PanelV2,
	lower?: PanelV2,
	fill = false
)}
	{@const key = `gap:${place}:${index}`}
	{@const divider =
		!!upper &&
		!!lower &&
		heightOf(upper) !== "fit" &&
		heightOf(lower) !== "fit"}
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
			{@const a = shareOf(stack, upper)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				class="adivider"
				role="separator"
				tabindex="0"
				aria-orientation="horizontal"
				aria-valuemin={1}
				aria-valuemax={Math.max(1, a + shareOf(stack, lower) - 1)}
				aria-valuenow={a}
				aria-label="Height of {label(upper.tabs[0])} and {label(
					lower.tabs[0]
				)}"
				title="Drag, or use the arrow keys, to share the height"
				data-arrange-divider="{place}:{index}"
				onkeydown={(e) => onDividerKey(e, stack, upper, lower)}
				onpointerdown={(e) => onDividerDown(e, stack, upper, lower)}
				onpointermove={onDividerMove}
				onpointerup={onDividerUp}
				onpointercancel={onDividerUp}
			></div>
		{:else if fill}
			<span class="ahint">Drop a widget here</span>
		{/if}
	</div>
{/snippet}

<!-- A zone's stack: gaps around and between its cards, or one filling gap when empty. -->
{#snippet stackOfPlace(place: StackPlace)}
	{@const stack = stackOf(panels, place)}
	{#if !stack.length}
		{@render gap(place, 0, stack, undefined, undefined, true)}
	{:else}
		{@render gap(place, 0, stack, undefined, stack[0])}
		{#each stack as p, i (p.key)}
			{@render card(p, place, i, stack)}
			{@render gap(place, i + 1, stack, p, stack[i + 1])}
		{/each}
	{/if}
{/snippet}

{#snippet zone(place: StackPlace)}
	<section
		class="azone"
		class:azone-middle={place === "middle"}
		data-pop-keep
		data-arrange-zone={place}
		aria-labelledby="{uid}-{place}"
	>
		<header class="azone-head" id="{uid}-{place}">
			{#if place === "left"}
				<Icons.PanelLeft size={13} aria-hidden="true" /> Left
			{:else if place === "right"}
				<Icons.PanelRight size={13} aria-hidden="true" /> Right
			{:else}
				<Icons.MessageSquare size={13} aria-hidden="true" /> Middle
			{/if}
		</header>
		<div class="astack">
			{@render stackOfPlace(place)}
		</div>
		{#if place === "middle"}
			<p class="azone-note">
				When a zone runs out of height, Low gives way first, then
				Normal. High keeps its height longest.
			</p>
		{/if}
	</section>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="edit-canvas"
	data-arrange-canvas
	style="grid-template-columns:{editGeom.left}px minmax(0,1fr) {editGeom.right}px;"
	onclick={onCanvasClick}
>
	{#if editGeom.left > 0}
		<div class="edit-side">{@render zone("left")}</div>
	{:else}
		<div class="edit-side" aria-hidden="true"></div>
	{/if}
	<div class="edit-center" style="max-inline-size:{editGeom.centre}px;">
		{@render zone("middle")}
	</div>
	{#if editGeom.right > 0}
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
		border: 1.5px dashed
			color-mix(in oklab, var(--color-primary-500) 55%, transparent);
		background: var(--color-surface-100);
		box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.55);
		overflow: visible;
	}
	:global([data-mode="dark"]) .azone {
		background: var(--color-surface-900);
	}
	.azone-middle {
		border-style: solid;
		border-color: color-mix(
			in oklab,
			var(--color-surface-400) 55%,
			transparent
		);
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
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
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
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		background: var(--color-surface-50);
		overflow: hidden;
	}
	:global([data-mode="dark"]) .acard {
		background: var(--color-surface-950);
		border-color: color-mix(
			in oklab,
			var(--color-surface-600) 45%,
			transparent
		);
	}
	/* The strip: drawn on every panel here, so every panel has handles. */
	.astrip {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.25rem;
		min-block-size: 32px;
		background: color-mix(
			in oklab,
			var(--color-primary-500) 10%,
			transparent
		);
		border-block-end: 1px solid
			color-mix(in oklab, var(--color-surface-400) 30%, transparent);
	}
	.astrip.drag-over,
	.atab.drag-over,
	.agap.drag-over {
		outline: 2px dashed
			color-mix(in oklab, var(--color-primary-500) 70%, transparent);
		outline-offset: -2px;
		background: color-mix(
			in oklab,
			var(--color-primary-500) 14%,
			transparent
		);
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
		background: color-mix(
			in oklab,
			var(--color-surface-500) 15%,
			transparent
		);
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
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 40%, transparent);
	}
	.tool:disabled {
		opacity: 0.5;
	}
	.aplace {
		border-style: dashed;
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 70%,
			transparent
		);
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
		background: color-mix(
			in oklab,
			var(--color-primary-500) 22%,
			transparent
		);
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
		border: 1px solid
			color-mix(in oklab, var(--color-surface-400) 40%, transparent);
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
		border: 1px dashed
			color-mix(in oklab, var(--color-surface-400) 45%, transparent);
		margin-block: 0.4rem;
	}
	.adivider {
		inline-size: 40%;
		block-size: 6px;
		border-radius: 3px;
		cursor: row-resize;
		touch-action: none;
		background: color-mix(
			in oklab,
			var(--color-surface-500) 35%,
			transparent
		);
	}
	.adivider:hover,
	.adivider:focus-visible {
		background: var(--color-primary-500);
		outline: none;
	}

	.azone-note {
		flex: none;
		margin: 0;
		padding: 0.3rem 0.6rem;
		font-size: 12px;
		color: var(--color-surface-600-400);
	}
	@media (pointer: coarse) {
		.aseg-btn,
		.atab-name,
		.atab-btn,
		.tool {
			min-block-size: 44px;
		}
	}
</style>
