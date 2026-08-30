<script module lang="ts">
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
	}
	export interface GsPos {
		id: string
		x: number
		y: number
		w: number
		h: number
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
	function cardHtml(it: GsItem): string {
		const rm = it.locked
			? ""
			: `<button class="gsc-btn gsc-x" data-remove="${esc(it.id)}" title="Remove ${esc(it.title)}" aria-label="Remove ${esc(it.title)}">&times;</button>`
		// Position controls — snap the widget to fill/dock without dragging.
		const ctrls =
			`<button class="gsc-btn" data-act="fit-w" title="Fit width">&#8596;</button>` +
			`<button class="gsc-btn" data-act="fit-h" title="Fit height">&#8597;</button>` +
			`<button class="gsc-btn" data-act="dock-top" title="Dock to top">&#8607;</button>` +
			`<button class="gsc-btn" data-act="dock-bottom" title="Dock to bottom">&#8615;</button>`
		return `<div class="gsc"><span class="gsc-title">${esc(it.title)}</span><span class="gsc-ctrls">${ctrls}${rm}</span></div>`
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
		)

		const init = untrack(() => items)
		grid.batchUpdate()
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
			// NB: not gridstack-`locked` — a required widget (chat) is still fully
			// draggable/resizable; `locked` in GsItem only hides its remove button.
			grid!.addWidget({ id: it.id, x, y, w, h, content: cardHtml(it) })
		})
		grid.batchUpdate(false)

		const emit = () => {
			const nodes = grid!.save(false) as GridStackNode[]
			onChange?.({
				cols,
				rows,
				items: nodes.map((n) => ({
					id: String(n.id),
					x: n.x ?? 0,
					y: n.y ?? 0,
					w: n.w ?? 1,
					h: n.h ?? 1
				}))
			})
		}
		grid.on("change added removed", emit)
		emit() // seed the initial arrangement immediately

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
				return
			}
			// Remove button.
			const btn = target?.closest("[data-remove]")
			if (!btn) return
			e.preventDefault()
			e.stopPropagation()
			const id = btn.getAttribute("data-remove")!
			const node = grid!.engine.nodes.find((n) => String(n.id) === id)
			if (node?.el) grid!.removeWidget(node.el)
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
</style>
