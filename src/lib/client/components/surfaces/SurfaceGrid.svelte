<script lang="ts">
	/**
	 * The surface grid (plan 21 §3/§4/§8): a container-responsive grid whose
	 * track count follows the *content box* width (a ResizeObserver drives the
	 * tier — so opening an app sidebar cascades the grid exactly like shrinking
	 * the window). Every active panel is mounted **once** into one flat list;
	 * placement is CSS var only (`grid-column`/`grid-row`/`order`), and drawered
	 * panels are the *same elements* pulled out of flow and slid to a rail — no
	 * reparenting, so frames never reload (§4). Drawers are absolute inside this
	 * box, so they slide over the grid but under the app sidebars (§8).
	 */
	import type { Snippet } from "svelte"
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Panel from "./Panel.svelte"
	import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
	import type { PanelInstance } from "$lib/client/surfaces/types"

	interface Props {
		manager: SurfaceManager
		sessionId: number | null
		session?: unknown
		/** The primary conversation body (the page owns its wiring). */
		primaryChildren?: Snippet
		onFrameAction?: (
			fn: string,
			messageId?: number,
			payload?: Record<string, unknown>
		) => void
	}

	let { manager, sessionId, session, primaryChildren, onFrameAction }: Props =
		$props()

	let wrapEl: HTMLDivElement | null = $state(null)
	let layoutMenuOpen = $state(false)

	// ── Container-responsive tier (§3) ──────────────────────────────
	onMount(() => {
		if (!wrapEl) return
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w) manager.setWidth(w)
		})
		ro.observe(wrapEl)
		manager.setWidth(wrapEl.clientWidth)
		return () => ro.disconnect()
	})

	const RAIL_REM = 2.25

	let place = $derived(manager.placement)
	let cols = $derived(manager.columns)
	// The rail (and its Layout hub) is available whenever the session has any
	// secondary panel to manage — not only when something is drawered.
	let railShown = $derived(
		manager.instances.some((p) => p.role !== "primary")
	)

	let gridStyle = $derived(
		`grid-template-columns:${cols.map((f) => f + "fr").join(" ")};` +
			`grid-template-rows:repeat(${place.rows},minmax(0,1fr));` +
			(railShown ? `padding-inline-end:${RAIL_REM}rem;` : "")
	)

	function slotStyle(inst: PanelInstance): string {
		const p = place.placements.get(inst.id)
		if (!p || p.location === "drawer") {
			// Drawered: pulled out of grid flow, slid to/from the rail.
			const open = manager.drawerOpenId === inst.id
			return (
				`position:absolute;inset-block:0;inset-inline-end:${RAIL_REM}rem;` +
				`width:min(360px,78%);z-index:20;` +
				`transform:translateX(${open ? "0" : "110%"});` +
				`pointer-events:${open ? "auto" : "none"};` +
				`opacity:${open ? "1" : "0"};`
			)
		}
		return (
			`grid-column:${p.col} / span ${p.colSpan};` +
			`grid-row:${p.rowStart} / span ${p.rowSpan};` +
			`order:${inst.order};`
		)
	}

	// ── Column resize gutters (§5) ──────────────────────────────────
	// Boundary i sits after column i (0-based); dragging shifts fr weight
	// between columns i and i+1. Positions are approximate (gap-agnostic) —
	// enough for a natural resize affordance.
	let boundaries = $derived.by(() => {
		const total = cols.reduce((a, b) => a + b, 0) || 1
		const out: number[] = []
		let acc = 0
		for (let i = 0; i < cols.length - 1; i++) {
			acc += cols[i]
			out.push(acc / total)
		}
		return out
	})

	let dragging = $state<number | null>(null)
	let dragStartX = 0

	function onGutterDown(e: PointerEvent, i: number) {
		dragging = i
		dragStartX = e.clientX
		;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
		e.preventDefault()
	}
	function onGutterMove(e: PointerEvent) {
		if (dragging === null || !wrapEl) return
		const w = wrapEl.clientWidth || 1
		const total = cols.reduce((a, b) => a + b, 0)
		const dxFrac = (e.clientX - dragStartX) / w
		const deltaFr = dxFrac * total
		if (Math.abs(deltaFr) < 0.02) return
		manager.resizeColumn(dragging, deltaFr)
		dragStartX = e.clientX
	}
	function onGutterUp(e: PointerEvent) {
		if (dragging === null) return
		try {
			;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
		} catch {}
		dragging = null
	}

	// ── Drawer rail: a vertical toolbar with roving tabindex (a11y) ──
	// The grid places panels by CSS `order`, which divorces visual order from
	// DOM order; the rail is the one place that matters for keyboard users, so
	// it's a proper arrow-key toolbar with a single tab stop.
	let railEl: HTMLDivElement | null = $state(null)
	let railFocus = $state(0)

	// Keep the single tab stop valid as the rail's button set changes. The
	// Layout gear is always button 0; drawered panels follow.
	$effect(() => {
		const n = 1 + manager.drawerInstances.length
		if (railFocus >= n) railFocus = Math.max(0, n - 1)
	})

	// Close the Layout menu on an outside click or Escape.
	$effect(() => {
		if (!layoutMenuOpen) return
		const onDown = (e: PointerEvent) => {
			if (railEl && !railEl.contains(e.target as Node))
				layoutMenuOpen = false
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") layoutMenuOpen = false
		}
		document.addEventListener("pointerdown", onDown, true)
		document.addEventListener("keydown", onKey)
		return () => {
			document.removeEventListener("pointerdown", onDown, true)
			document.removeEventListener("keydown", onKey)
		}
	})

	function railButtons(): HTMLButtonElement[] {
		return railEl
			? Array.from(railEl.querySelectorAll<HTMLButtonElement>("button"))
			: []
	}
	// Grid pane navigation: F6 / Shift+F6 cycles focus across panel regions in
	// *visual* order (the conventional pane-switch key). This is the answer to
	// CSS `order` divorcing Tab order from the visual sequence — Tab still walks
	// DOM order within a panel, F6 jumps between panels the way the eye does.
	function visualPanelOrder(): string[] {
		const grid = manager.gridInstances
			.map((p) => ({ id: p.id, pl: place.placements.get(p.id)! }))
			.filter((x) => x.pl)
			.sort(
				(a, b) =>
					a.pl.rowStart - b.pl.rowStart || a.pl.col - b.pl.col
			)
			.map((x) => x.id)
		return [...grid, ...place.drawerIds]
	}
	function onGridKeydown(e: KeyboardEvent) {
		if (e.key !== "F6" || !wrapEl) return
		const order = visualPanelOrder()
		if (!order.length) return
		e.preventDefault()
		const sections = order
			.map((id) =>
				wrapEl!.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)
			)
			.filter((el): el is HTMLElement => !!el)
		if (!sections.length) return
		const active = document.activeElement
		let cur = sections.findIndex(
			(s) => s === active || s.contains(active)
		)
		const dir = e.shiftKey ? -1 : 1
		const next = ((cur < 0 ? 0 : cur + dir) + sections.length) % sections.length
		// If a drawered panel is the target, slide it open first.
		const targetId = order[next]
		if (place.drawerIds.includes(targetId)) manager.openDrawer(targetId)
		sections[next]?.focus()
	}

	function onRailKeydown(e: KeyboardEvent) {
		const btns = railButtons()
		if (!btns.length) return
		let next = railFocus
		if (e.key === "ArrowDown" || e.key === "ArrowRight") next = railFocus + 1
		else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
			next = railFocus - 1
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = btns.length - 1
		else return
		e.preventDefault()
		next = (next + btns.length) % btns.length
		railFocus = next
		btns[next]?.focus()
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={wrapEl}
	class="surface-grid-wrap"
	role="group"
	aria-label="Session panels"
	onkeydown={onGridKeydown}
>
	<div class="surface-grid" style={gridStyle}>
		{#each manager.instances.filter((p) => p.active) as inst (inst.id)}
			{@const p = place.placements.get(inst.id)}
			<!-- A closed drawer slot is opacity-0 + pointer-events-none but
			     still mounted (frames must never unmount); `inert` removes it
			     from the accessibility tree and tab order while hidden. -->
			<div
				class="panel-slot"
				class:is-drawer={p?.location === "drawer"}
				inert={p?.location === "drawer" &&
					manager.drawerOpenId !== inst.id}
				style={slotStyle(inst)}
			>
				<Panel
					instance={inst}
					{manager}
					{sessionId}
					{session}
					inDrawer={p?.location === "drawer"}
					primaryChildren={inst.role === "primary"
						? primaryChildren
						: undefined}
					{onFrameAction}
				/>
			</div>
		{/each}

		<!-- Resize gutters (only when there is more than one column). -->
		{#if cols.length > 1}
			{#each boundaries as frac, i}
				<button
					class="col-gutter"
					class:active={dragging === i}
					style="left:calc({frac} * (100% - {railShown
						? RAIL_REM
						: 0}rem));"
					title="Resize columns"
					aria-label="Resize columns"
					onpointerdown={(e) => onGutterDown(e, i)}
					onpointermove={onGutterMove}
					onpointerup={onGutterUp}
					onpointercancel={onGutterUp}
				></button>
			{/each}
		{/if}

		<!-- Drawer rail: docked to the inline-end edge, always above the grid.
		     The Layout gear at the top is the one hub for customizing the grid;
		     drawered panel icons sit below it. -->
		{#if railShown}
			<div
				bind:this={railEl}
				class="drawer-rail"
				role="toolbar"
				tabindex="-1"
				aria-orientation="vertical"
				aria-label="Session panels"
				onkeydown={onRailKeydown}
			>
				<!-- The Layout hub -->
				<div class="relative">
					<button
						class="rail-btn"
						class:active={layoutMenuOpen}
						tabindex={railFocus === 0 ? 0 : -1}
						onclick={() => {
							railFocus = 0
							layoutMenuOpen = !layoutMenuOpen
						}}
						title="Customize layout"
						aria-label="Customize layout"
						aria-haspopup="menu"
						aria-expanded={layoutMenuOpen}
					>
						<Icons.SlidersHorizontal size={16} />
					</button>
					{#if layoutMenuOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="bg-surface-50-950 border-surface-200-800 absolute top-0 right-full z-40 mr-1 w-56 rounded-lg border p-1.5 shadow-xl"
							role="menu"
							aria-label="Layout"
						>
							<div
								class="text-surface-500 px-1.5 pt-0.5 pb-1 text-[11px] font-semibold tracking-wide uppercase"
							>
								Panels
							</div>
							{#each manager.secondaryPanels as inst (inst.id)}
								{@const IconCmp =
									(inst.icon && (Icons as any)[inst.icon]) ||
									Icons.LayoutPanelTop}
								<label
									class="hover:preset-tonal-surface flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs"
								>
									<input
										type="checkbox"
										class="checkbox"
										checked={inst.active}
										onchange={() =>
											inst.active
												? manager.close(inst.id)
												: manager.activate(inst.id)}
									/>
									<IconCmp size={14} />
									<span class="flex-1 truncate">{inst.title}</span>
								</label>
							{/each}

							<hr class="border-surface-200-800 my-1" />
							<button
								class="hover:preset-tonal-surface flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs"
								role="menuitem"
								onclick={() =>
									manager.setAllCollapsed(!manager.allCollapsed)}
							>
								{#if manager.allCollapsed}
									<Icons.ChevronsDownUp size={14} />
									<span>Expand all</span>
								{:else}
									<Icons.ChevronsUpDown size={14} />
									<span>Collapse all</span>
								{/if}
							</button>
							<button
								class="hover:preset-tonal-surface flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs"
								role="menuitem"
								onclick={() => {
									manager.resetLayout()
									layoutMenuOpen = false
								}}
							>
								<Icons.RotateCcw size={14} />
								<span>Reset to default</span>
							</button>

							<hr class="border-surface-200-800 my-1" />
							<div
								class="text-surface-500 px-1.5 py-0.5 text-[10px] leading-tight"
							>
								Drag the gutters between columns to resize · press
								<kbd
									class="preset-tonal-surface rounded px-1 font-mono text-[10px]"
									>F6</kbd
								> to move between panels · use each panel's title bar
								to collapse, move, or send it to this drawer.
							</div>
						</div>
					{/if}
				</div>

				<!-- Drawered panel icons -->
				{#each manager.drawerInstances as inst, i (inst.id)}
					{@const IconCmp =
						(inst.icon && (Icons as any)[inst.icon]) ||
						Icons.LayoutPanelTop}
					<button
						class="rail-btn"
						class:active={manager.drawerOpenId === inst.id}
						tabindex={i + 1 === railFocus ? 0 : -1}
						onclick={() => {
							railFocus = i + 1
							manager.openDrawer(inst.id)
						}}
						title={inst.title}
						aria-label={inst.title}
						aria-pressed={manager.drawerOpenId === inst.id}
					>
						<IconCmp size={16} />
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.surface-grid-wrap {
		/* The query container: the grid reacts to THIS box, not the viewport. */
		container-type: inline-size;
		block-size: 100%;
		inline-size: 100%;
		min-block-size: 0;
	}
	.surface-grid {
		position: relative; /* positioning context for drawers + rail (§8) */
		display: grid;
		gap: 0.5rem;
		block-size: 100%;
		min-block-size: 0;
		overflow: hidden; /* clip drawers sliding off the inline-end edge */
		/* Animate tier changes + resizes; no reparent means no FLIP needed. */
		transition:
			grid-template-columns 220ms cubic-bezier(0.22, 1, 0.36, 1),
			grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.panel-slot {
		min-inline-size: 0;
		min-block-size: 0;
	}
	.panel-slot.is-drawer {
		transition:
			transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 200ms ease;
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.18);
		border-radius: 0.5rem;
	}
	.col-gutter {
		position: absolute;
		inset-block: 0;
		inline-size: 10px;
		transform: translateX(-5px);
		background: transparent;
		cursor: col-resize;
		z-index: 15;
		border: none;
		padding: 0;
	}
	.col-gutter::after {
		content: "";
		position: absolute;
		inset-block: 20%;
		left: 50%;
		inline-size: 2px;
		transform: translateX(-1px);
		background: transparent;
		border-radius: 999px;
		transition: background 120ms ease;
	}
	/* Skeleton v5 tokens are complete colors (oklch) — use them directly,
	   with color-mix for alpha. Dark mode is [data-mode="dark"] on <html>. */
	.col-gutter:hover::after,
	.col-gutter.active::after {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 55%,
			transparent
		);
	}
	.drawer-rail {
		position: absolute;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: 2.25rem;
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding-block: 0.375rem;
		background: color-mix(
			in oklab,
			var(--color-surface-100) 60%,
			transparent
		);
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-200) 70%, transparent);
		backdrop-filter: blur(4px);
	}
	:global([data-mode="dark"]) .drawer-rail {
		background: color-mix(
			in oklab,
			var(--color-surface-900) 60%,
			transparent
		);
		border-inline-start-color: color-mix(
			in oklab,
			var(--color-surface-800) 70%,
			transparent
		);
	}
	.rail-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.75rem;
		block-size: 1.75rem;
		border-radius: 0.5rem;
		color: var(--color-surface-600);
		transition:
			background 120ms ease,
			color 120ms ease;
	}
	:global([data-mode="dark"]) .rail-btn {
		color: var(--color-surface-400);
	}
	.rail-btn:hover,
	.rail-btn.active {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 15%,
			transparent
		);
		color: var(--color-primary-600);
	}
	:global([data-mode="dark"]) .rail-btn:hover,
	:global([data-mode="dark"]) .rail-btn.active {
		color: var(--color-primary-400);
	}
	@media (prefers-reduced-motion: reduce) {
		.surface-grid,
		.panel-slot.is-drawer {
			transition: none;
		}
	}
</style>
