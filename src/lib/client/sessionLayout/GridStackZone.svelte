<script module lang="ts">
	/** Which zone edges a widget sticks to (mirrors widgetGrid's Anchor). */
	export interface GsAnchor {
		top?: boolean
		right?: boolean
		bottom?: boolean
		left?: boolean
	}
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
		/** A required widget (chat) — movable/resizable but not removable. */
		locked?: boolean
		/** Edges the widget anchors to within its cell (toggled in the editor). */
		anchor?: GsAnchor
		/** Tab-group membership: cards sharing a group id render as one tab set. */
		group?: string
	}
	export interface GsPos {
		id: string
		x: number
		y: number
		w: number
		h: number
		anchor?: GsAnchor
		group?: string
	}
	/** A zone's captured arrangement: its cell grid dims + the items' cells. */
	export interface GsLayout {
		cols: number
		rows: number
		items: GsPos[]
	}
</script>

<script lang="ts">
	/**
	 * One editor zone backed by gridstack (PLAN 25). gridstack owns the grid and
	 * all item DOM (drag / resize / snap / collision); Svelte owns only the host
	 * element, so the two never fight over the same nodes. Cards are plain HTML
	 * content gridstack renders; removal is handled by click delegation.
	 *
	 * The cell guides are gridstack's REAL grid, drawn as outlined rounded
	 * squares. Cells are a FIXED square size; the host is sized to an exact whole
	 * number of them and centred, so a partial cell at the edge is simply culled
	 * (it becomes even margin) rather than drawn cut-off. The column count
	 * re-derives on zone resize.
	 */
	import { onMount, untrack } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import type { GridStack, GridStackNode } from "gridstack"
	import "gridstack/dist/gridstack.min.css"

	interface Props {
		items: GsItem[]
		/** Fixed square cell edge (px). Cells are exactly this; partials culled. */
		cell?: number
		onChange?: (layout: GsLayout) => void
		onRemove?: (id: string) => void
	}

	let { items, cell = 48, onChange, onRemove }: Props = $props()

	let hostEl: HTMLDivElement
	let grid: GridStack | undefined
	let cols = $state(6)

	// ── grouping (editor concept gridstack doesn't model) ──────────────────
	// Selection is reactive so the group toolbar tracks it. `gridMeta`/`gridEmit`
	// are set inside `init` so the template's group actions can reach the live
	// per-widget metadata + report changes. A group id is derived from its sorted
	// members (deterministic — no Date.now/random), and colored by a hue hash so
	// grouped cards are identifiable at a glance.
	let selected = new SvelteSet<string>()
	let gridMeta: Map<string, { anchor: GsAnchor; group?: string }> | null = null
	let gridEmit: (() => void) | null = null
	let selectionHasGroup = $derived(
		[...selected].some((id) => !!gridMeta?.get(id)?.group)
	)

	function hueFromId(id: string): number {
		let h = 0
		for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
		return h
	}
	function gscOf(id: string): HTMLElement | null | undefined {
		return grid?.engine.nodes
			.find((n) => String(n.id) === id)
			?.el?.querySelector<HTMLElement>(".gsc")
	}
	function applyGroupDom(id: string, group?: string) {
		const gsc = gscOf(id)
		if (!gsc) return
		gsc.classList.toggle("grouped", !!group)
		if (group) gsc.style.setProperty("--ghue", String(hueFromId(group)))
		else gsc.style.removeProperty("--ghue")
	}
	function setSelected(id: string, on: boolean) {
		if (on) selected.add(id)
		else selected.delete(id)
		gscOf(id)?.classList.toggle("sel", on)
	}
	function clearSelection() {
		for (const id of selected) gscOf(id)?.classList.remove("sel")
		selected.clear()
	}
	function groupSelected() {
		if (!gridMeta || selected.size < 2) return
		const members = [...selected].sort()
		const gid = "g:" + members.join("+")
		for (const id of members) {
			const m = gridMeta.get(id) ?? { anchor: {} }
			gridMeta.set(id, { ...m, group: gid })
			applyGroupDom(id, gid)
		}
		clearSelection()
		gridEmit?.()
	}
	function ungroupSelected() {
		if (!gridMeta || !selected.size) return
		for (const id of selected) {
			const m = gridMeta.get(id)
			if (m) gridMeta.set(id, { ...m, group: undefined })
			applyGroupDom(id, undefined)
		}
		clearSelection()
		gridEmit?.()
	}
	let rows = $state(6)
	// The host is exactly cols×cell by rows×cell (whole cells only), centred in
	// the zone — the sub-cell remainder is culled to margin, never a partial,
	// and the zone never scrolls: the grid is bounded to what fits the view.
	let gridW = $derived(cols * cell)
	let gridH = $derived(rows * cell)

	function esc(s: string): string {
		return s.replace(
			/[&<>"]/g,
			(c) =>
				({
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					'"': "&quot;"
				})[c] as string
		)
	}
	/** The class list that draws a thick accent border on each anchored edge. */
	function anchorClasses(a: GsAnchor): string {
		return (["top", "right", "bottom", "left"] as const)
			.filter((e) => a[e])
			.map((e) => `anch-${e}`)
			.join(" ")
	}
	/** Four edge-toggle buttons; the pressed ones mark which edges are anchored. */
	function anchorControls(a: GsAnchor): string {
		const btn = (edge: keyof GsAnchor, glyph: string) =>
			`<button class="gsc-btn gsc-anch${a[edge] ? " active" : ""}" data-act="anchor-${edge}" title="Anchor ${edge}" aria-label="Anchor to ${edge}" aria-pressed="${!!a[edge]}">${glyph}</button>`
		return (
			`<span class="gsc-anchset" title="Anchor edges">` +
			btn("top", "&#8593;") +
			btn("left", "&#8592;") +
			btn("right", "&#8594;") +
			btn("bottom", "&#8595;") +
			`</span>`
		)
	}
	function cardHtml(
		it: GsItem,
		a: GsAnchor = it.anchor ?? {},
		group = it.group
	): string {
		const rm = it.locked
			? ""
			: `<button class="gsc-btn gsc-x" data-remove="${esc(it.id)}" title="Remove ${esc(it.title)}" aria-label="Remove ${esc(it.title)}">&times;</button>`
		// Position controls — snap the widget to fill/dock without dragging — then
		// the anchor-edge cluster (toggle which edges the widget sticks to).
		const ctrls =
			`<button class="gsc-btn" data-act="fit-w" title="Fit width">&#8596;</button>` +
			`<button class="gsc-btn" data-act="fit-h" title="Fit height">&#8597;</button>` +
			`<button class="gsc-btn" data-act="dock-top" title="Dock to top">&#8607;</button>` +
			`<button class="gsc-btn" data-act="dock-bottom" title="Dock to bottom">&#8615;</button>` +
			anchorControls(a)
		const gcls = group ? " grouped" : ""
		const gstyle = group ? ` style="--ghue:${hueFromId(group)}"` : ""
		// The group id is stamped as a data-attr (not just the hue) so a card
		// dragged into another zone can recover its group there (see `dropped`).
		const gdata = group ? ` data-group="${esc(group)}"` : ""
		return `<div class="gsc ${anchorClasses(a)}${gcls}"${gstyle}${gdata}><span class="gsc-title">${esc(it.title)}</span><span class="gsc-ctrls">${ctrls}${rm}</span></div>`
	}

	// Whole cells that fit a measured length (partials culled, not drawn).
	function cellsIn(length: number): number {
		return Math.max(1, Math.floor(length / cell))
	}

	type Box = { x?: number; y?: number; w?: number; h?: number }
	function overlaps(a: Box, b: Box): boolean {
		const ax = a.x ?? 0,
			aw = a.w ?? 1,
			ay = a.y ?? 0,
			ah = a.h ?? 1
		const bx = b.x ?? 0,
			bw = b.w ?? 1,
			by = b.y ?? 0,
			bh = b.h ?? 1
		return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
	}
	/**
	 * Where to dock a widget so it STACKS instead of piling on top of one already
	 * docked: the topmost (or bottommost) free y where it collides with nothing
	 * else in its columns.
	 */
	function dockY(node: Box, dir: "top" | "bottom"): number {
		const h = node.h ?? 1
		const others = grid!.engine.nodes.filter((n) => n !== node)
		const fits = (y: number) =>
			y >= 0 &&
			y + h <= rows &&
			!others.some((n) => overlaps({ x: node.x, y, w: node.w, h }, n))
		if (dir === "top") {
			for (let y = 0; y + h <= rows; y++) if (fits(y)) return y
			return 0
		}
		for (let y = rows - h; y >= 0; y--) if (fits(y)) return y
		return Math.max(0, rows - h)
	}
	/** Fill height from the widget's top down to the next obstruction (or floor). */
	function fitHeight(node: Box): number {
		const y = node.y ?? 0
		let floor = rows
		for (const n of grid!.engine.nodes) {
			if (n === node) continue
			const nx = n.x ?? 0,
				nw = n.w ?? 1,
				ny = n.y ?? 0
			const xOverlap = (node.x ?? 0) < nx + nw && (node.x ?? 0) + (node.w ?? 1) > nx
			if (xOverlap && ny > y && ny < floor) floor = ny
		}
		return Math.max(1, floor - y)
	}

	onMount(() => {
		let disposed = false
		let cleanup: () => void = () => {}
		// gridstack touches the DOM at module load, so import it lazily on the
		// client only (a static import would crash SSR).
		;(async () => {
			const { GridStack } = await import("gridstack")
			if (disposed) return
			cleanup = init(GridStack)
		})()
		return () => {
			disposed = true
			cleanup()
		}
	})

	function init(GridStack: typeof import("gridstack").GridStack): () => void {
		// gridstack v11+ renders `content` as textContent (XSS-safe) unless a
		// render callback opts into HTML. Our content is built here from escaped
		// values, so rendering it as HTML is safe.
		GridStack.renderCB = (el, w) => {
			el.innerHTML = (w as { content?: string }).content ?? ""
		}
		const parent = hostEl.parentElement
		cols = cellsIn(parent?.clientWidth || hostEl.clientWidth || 400)
		rows = cellsIn(parent?.clientHeight || hostEl.clientHeight || 400)

		grid = GridStack.init(
			{
				column: cols,
				cellHeight: cell,
				// Cap the grid to the rows that fit the view — the zone never
				// grows/scrolls; only a widget's own content scrolls.
				maxRow: rows,
				margin: 4,
				float: true, // free placement — a card stays where you drop it
				animate: true,
				// Accept items dragged in from the OTHER zones (cross-zone drag).
				acceptWidgets: true,
				removable: false,
				// The drag helper lives on <body> so it isn't clipped by a zone's
				// bounds and can travel across zones.
				draggable: { handle: ".grid-stack-item-content", appendTo: "body" }
			},
			hostEl
		)!

		const init = untrack(() => items)
		// Editor-only per-widget metadata gridstack doesn't model (anchored edges,
		// tab-group membership). Tracked here keyed by id, mutated by the anchor
		// toggles / grouping, and reported back through `emit` so the captured
		// arrangement carries it.
		const meta = new Map<string, { anchor: GsAnchor; group?: string }>()
		const anyAnchor = (a: GsAnchor) =>
			!!(a.top || a.right || a.bottom || a.left)
		grid!.batchUpdate()
		// Resolve default placement against the measured grid. Bottom-docked
		// items reserve rows from the bottom; a fill item takes what's left; the
		// rest stack from the top. Everything full-width unless it states a w.
		const bottomReserve = init
			.filter((it) => it.place === "bottom")
			.reduce((s, it) => s + (it.h ?? 3), 0)
		let topY = 0
		let bottomY = rows
		init.forEach((it) => {
			const fullW = it.w ?? cols
			let x = it.x ?? 0
			let y = it.y ?? 0
			let w = fullW
			let h = it.h ?? 3
			if (it.x == null && it.y == null) {
				if (it.place === "bottom") {
					h = it.h ?? 3
					bottomY -= h
					x = 0
					y = bottomY
					w = fullW
				} else if (it.place === "fill") {
					x = 0
					y = topY
					w = fullW
					h = Math.max(1, rows - bottomReserve - topY)
					topY = y + h
				} else {
					x = 0
					y = topY
					w = fullW
					topY += h
				}
			}
			// Clamp to what THIS zone can hold: a restored arrangement may carry
			// geometry captured in a wider/taller zone (different viewport), and an
			// out-of-bounds w/x would overflow or clip. A no-op for the default
			// place branches, which already fit.
			w = Math.min(w, cols)
			h = Math.min(h, rows)
			x = Math.min(Math.max(0, x), Math.max(0, cols - w))
			y = Math.min(Math.max(0, y), Math.max(0, rows - h))
			meta.set(it.id, { anchor: { ...(it.anchor ?? {}) }, group: it.group })
			// NB: not gridstack-`locked` — a required widget (chat) is still fully
			// draggable/resizable; `locked` in GsItem only hides its remove button.
			grid!.addWidget({
				id: it.id,
				x,
				y,
				w,
				h,
				content: cardHtml(it, meta.get(it.id)!.anchor, it.group)
			})
		})
		grid!.batchUpdate(false)
		// Expose the live metadata + reporter so the template's group actions reach
		// them (they run outside init).
		gridMeta = meta

		const emit = () => {
			const nodes = grid!.save(false) as GridStackNode[]
			onChange?.({
				cols,
				rows,
				items: nodes.map((n) => {
					const m = meta.get(String(n.id))
					return {
						id: String(n.id),
						x: n.x ?? 0,
						y: n.y ?? 0,
						w: n.w ?? 1,
						h: n.h ?? 1,
						...(m && anyAnchor(m.anchor) ? { anchor: m.anchor } : {}),
						...(m?.group ? { group: m.group } : {})
					}
				})
			})
		}
		gridEmit = emit
		grid!.on("change added removed", emit)
		emit() // seed the initial arrangement immediately

		// Cross-zone drop: refit the incoming card to THIS zone's grid. Each zone
		// is an independent gridstack with its own column count, so a card dragged
		// from a wide zone into a narrow one arrives wider than the destination has
		// columns and would overflow/clip. Clamp its w/h to what fits and pull its
		// x/y back inside the bounds. `dropped` fires only on an actual drag-in
		// from another grid (not the initial addWidget batch), so this never
		// touches cards the user didn't just move here.
		grid!.on("dropped", ((
			_e: Event,
			_prev: GridStackNode,
			node: GridStackNode
		) => {
			if (!node?.el) return
			const w = Math.min(node.w ?? 1, cols)
			const h = Math.min(node.h ?? 1, rows)
			const x = Math.min(node.x ?? 0, Math.max(0, cols - w))
			const y = Math.min(node.y ?? 0, Math.max(0, rows - h))
			grid!.update(node.el, { w, h, x, y })
			// Recover the card's editor metadata from the DOM it brought with it
			// (gridstack moves the element, so its anchor classes + data-group
			// survive) — otherwise THIS zone's meta wouldn't know the dragged-in id
			// and its emit would drop the anchor/group.
			const gsc = node.el.querySelector<HTMLElement>(".gsc")
			const anchor: GsAnchor = {}
			for (const e of ["top", "right", "bottom", "left"] as const)
				if (gsc?.classList.contains(`anch-${e}`)) anchor[e] = true
			meta.set(String(node.id), {
				anchor,
				group: gsc?.dataset.group || undefined
			})
			emit()
		}) as any)

		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			// Position control: snap the widget to fill/dock via gridstack.
			const act = target?.closest("[data-act]")
			if (act) {
				e.preventDefault()
				e.stopPropagation()
				const el = act.closest<HTMLElement>(".grid-stack-item")
				const node = grid!.engine.nodes.find((n) => n.el === el)
				if (!node?.el) return
				const a = act.getAttribute("data-act")
				if (a === "fit-w") grid!.update(node.el, { x: 0, w: cols })
				else if (a === "fit-h")
					grid!.update(node.el, { h: fitHeight(node) })
				else if (a === "dock-top")
					grid!.update(node.el, { y: dockY(node, "top") })
				else if (a === "dock-bottom")
					grid!.update(node.el, { y: dockY(node, "bottom") })
				else if (a?.startsWith("anchor-")) {
					// Toggle one anchored edge. Geometry doesn't change, so gridstack
					// fires nothing — update the meta + DOM (button pressed-state and
					// the card's edge-highlight class) and emit by hand.
					const edge = a.slice("anchor-".length) as keyof GsAnchor
					const id = String(node.id)
					const m = meta.get(id) ?? { anchor: {} }
					const next = !m.anchor[edge]
					meta.set(id, { ...m, anchor: { ...m.anchor, [edge]: next } })
					act.classList.toggle("active", next)
					act.setAttribute("aria-pressed", String(next))
					node.el
						.querySelector(".gsc")
						?.classList.toggle(`anch-${edge}`, next)
					emit()
				}
				return
			}
			// Remove button.
			const btn = target?.closest("[data-remove]")
			if (!btn) {
				// A plain click on the card body (no control): toggle its selection
				// for grouping. Dragging still moves it — gridstack fires a drag,
				// not a click.
				const card = target?.closest<HTMLElement>(".grid-stack-item")
				if (card) {
					const node = grid!.engine.nodes.find((n) => n.el === card)
					const id = node ? String(node.id) : null
					if (id) setSelected(id, !selected.has(id))
				}
				return
			}
			e.preventDefault()
			e.stopPropagation()
			const id = btn.getAttribute("data-remove")!
			const node = grid!.engine.nodes.find((n) => String(n.id) === id)
			if (node?.el) grid!.removeWidget(node.el)
			selected.delete(id)
			onRemove?.(id)
		}
		hostEl.addEventListener("click", onClick)

		// On zone resize, re-derive how many WHOLE cells fit each axis (partials
		// culled). Columns drive gridstack's layout; rows just bound the height.
		const ro = new ResizeObserver(() => {
			const p = hostEl.parentElement
			if (!p || !grid) return
			const c = cellsIn(p.clientWidth || hostEl.clientWidth)
			const r = cellsIn(p.clientHeight || hostEl.clientHeight)
			if (c !== cols) {
				cols = c
				grid.column(cols, "list")
			}
			if (r !== rows) {
				rows = r
				grid.opts.maxRow = rows
			}
		})
		if (hostEl.parentElement) ro.observe(hostEl.parentElement)

		return () => {
			ro.disconnect()
			hostEl.removeEventListener("click", onClick)
			grid?.destroy(false)
			grid = undefined
		}
	}
</script>

<div class="gs-host">
	{#if selected.size}
		<!-- Selection toolbar (grouping). Appears while cards are selected; Group
		     needs 2+, Ungroup shows when any selected card is already grouped. -->
		<div class="gs-groupbar">
			<button
				class="gs-gbtn"
				onclick={groupSelected}
				disabled={selected.size < 2}
				title="Group selected cards as tabs"
			>
				Group ({selected.size})
			</button>
			{#if selectionHasGroup}
				<button class="gs-gbtn" onclick={ungroupSelected} title="Ungroup">
					Ungroup
				</button>
			{/if}
			<button
				class="gs-gbtn ghost"
				onclick={clearSelection}
				title="Clear selection"
				aria-label="Clear selection">&times;</button
			>
		</div>
	{/if}
	<!-- gridstack's item CSS reads --gs-column-width / --gs-cell-height but its
	     stylesheet doesn't define them for arbitrary column counts; set them
	     here (reactive to cols/cell, so resize keeps working). --gs-cell drives
	     the outlined-cell background. -->
	<div
		class="grid-stack"
		bind:this={hostEl}
		style="inline-size:{gridW}px; min-block-size:{gridH}px; --gs-cell:{cell}px; --gs-cell-height:{cell}px; --gs-column-width:calc(100% / {cols}); --gs-item-margin-top:4px; --gs-item-margin-right:4px; --gs-item-margin-bottom:4px; --gs-item-margin-left:4px;"
	></div>
</div>

<style>
	/* The zone itself never scrolls: it holds a grid bounded to whole cells that
	   fit the view, centred, with the sub-cell remainder culled to margin. Only a
	   widget's own content scrolls (gridstack item-content is overflow:auto). */
	.gs-host {
		position: relative; /* anchor for the floating group toolbar */
		block-size: 100%;
		min-block-size: 0;
		/* The grid is bounded to fit (maxRow + fixed block-size), so nothing
		   scrolls even with overflow visible — and visible lets a dragged item /
		   its helper leave the zone (cross-zone drag) instead of being clipped. */
		overflow: visible;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* Floating selection/group toolbar, pinned to the top of the zone. */
	.gs-groupbar {
		position: absolute;
		inset-block-start: 2px;
		inset-inline-start: 50%;
		transform: translateX(-50%);
		z-index: 5;
		display: flex;
		gap: 0.25rem;
		padding: 0.15rem 0.3rem;
		border-radius: 0.45rem;
		background: color-mix(in oklab, var(--color-surface-950) 82%, transparent);
		border: 1px solid
			color-mix(in oklab, var(--color-surface-50) 18%, transparent);
		box-shadow: 0 4px 14px -6px rgba(0, 0, 0, 0.6);
	}
	.gs-gbtn {
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1.2;
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
		color: var(--color-surface-50);
		background: color-mix(in oklab, var(--color-primary-500) 80%, black 4%);
	}
	.gs-gbtn.ghost {
		background: transparent;
		padding-inline: 0.3rem;
	}
	.gs-gbtn:disabled {
		opacity: 0.4;
	}
	/* gridstack's real grid, drawn as outlined rounded cells: one border box per
	   FIXED square cell, a margin/gap between them, no fill. The host is an exact
	   multiple of the cell on both axes, so the tiling never leaves a partial. */
	.grid-stack {
		flex: none;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect x='3' y='3' width='38' height='38' rx='8' ry='8' fill='none' stroke='%23808a99' stroke-opacity='0.30' stroke-width='1.25'/></svg>");
		background-size: var(--gs-cell) var(--gs-cell);
		background-position: 0 0;
		background-repeat: repeat;
	}
	:global([data-mode="dark"]) .grid-stack {
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' preserveAspectRatio='none'><rect x='3' y='3' width='38' height='38' rx='8' ry='8' fill='none' stroke='%23aab4c4' stroke-opacity='0.24' stroke-width='1.25'/></svg>");
	}

	/* The card gridstack renders inside each item. gridstack's default content
	   is opacity .8 with a shadow — reset so our card's own look shows true. */
	:global(.grid-stack .grid-stack-item-content) {
		border-radius: 0.55rem;
		overflow: hidden;
		opacity: 1;
		box-shadow: none;
	}
	:global(.grid-stack .gsc) {
		block-size: 100%;
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.45rem 0.55rem;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-surface-50);
		background: color-mix(in oklab, var(--color-primary-500) 85%, black 4%);
		border: 1px solid
			color-mix(in oklab, var(--color-primary-300) 55%, transparent);
		box-shadow: 0 3px 10px -5px rgba(0, 0, 0, 0.55);
	}
	:global(.grid-stack .gsc-title) {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Position controls — tucked to the top-right, revealed on hover so the card
	   stays clean, but the remove × stays visible. */
	:global(.grid-stack .gsc-ctrls) {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}
	:global(.grid-stack .gsc-btn) {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.2rem;
		block-size: 1.2rem;
		border-radius: 0.3rem;
		font-size: 0.85rem;
		line-height: 1;
		opacity: 0;
		transition:
			opacity 100ms ease,
			background 100ms ease;
	}
	:global(.grid-stack .grid-stack-item-content:hover .gsc-btn) {
		opacity: 0.8;
	}
	:global(.grid-stack .gsc-x) {
		opacity: 0.85; /* remove stays visible even without hover */
		font-size: 1rem;
	}
	:global(.grid-stack .gsc-btn:hover) {
		background: color-mix(in oklab, black 28%, transparent);
		opacity: 1 !important;
	}
	/* Anchor cluster — set off from the fit/dock controls by a divider. */
	:global(.grid-stack .gsc-anchset) {
		display: inline-flex;
		align-items: center;
		gap: 0.05rem;
		margin-inline-start: 0.15rem;
		padding-inline-start: 0.2rem;
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-50) 30%, transparent);
	}
	/* A set anchor stays lit even without hover, so the anchored edges read at a
	   glance; unset ones reveal on hover like the other controls. */
	:global(.grid-stack .gsc-anch.active) {
		opacity: 1 !important;
		background: var(--color-primary-300);
		color: var(--color-surface-950);
	}
	/* Identify the anchored boundaries: a thick accent border on each anchored
	   edge of the card. Independent per side, so multiple anchors stack. */
	:global(.grid-stack .gsc.anch-top) {
		border-top: 3px solid var(--color-primary-300);
	}
	:global(.grid-stack .gsc.anch-right) {
		border-right: 3px solid var(--color-primary-300);
	}
	:global(.grid-stack .gsc.anch-bottom) {
		border-bottom: 3px solid var(--color-primary-300);
	}
	:global(.grid-stack .gsc.anch-left) {
		border-left: 3px solid var(--color-primary-300);
	}
	/* Selected for grouping — a bright ring, distinct from the anchor accent. */
	:global(.grid-stack .gsc.sel) {
		outline: 2px dashed var(--color-tertiary-300, #7dd3fc);
		outline-offset: -3px;
	}
	/* Grouped — a colored inset bar keyed by the group's hue, so members of the
	   same group read as one set at a glance. */
	:global(.grid-stack .gsc.grouped) {
		box-shadow: inset 5px 0 0 0 hsl(var(--ghue, 210) 70% 62%);
	}
</style>
