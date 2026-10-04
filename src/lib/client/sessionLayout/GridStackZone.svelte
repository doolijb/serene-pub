<script module lang="ts">
	/**
	 * The stored shapes are the SDK's: a zone's arrangement (`ArrangedZone`,
	 * its cells and `ArrangedItem`s) and the edges a widget anchors to
	 * (`WidgetAnchor`) are slots of the session layout (`SessionLayoutV1`).
	 * `GsItem` is this editor's own card, before it has cells (`./gsItem`).
	 */
	import type { ArrangedItem, ArrangedZone, WidgetAnchor } from "@serene-pub/sdk"
	import type { GsItem } from "./gsItem"
	export type { GsItem }
	/**
	 * The default square cell edge (px). Exported because a caller that has to
	 * reason about a zone's column count before it is measured — the Move tab's
	 * screen-size simulator — must speak the same module this grid does.
	 */
	export const GS_CELL_PX = 48
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
	import {
		clampPos,
		frameCovers,
		reexpress,
		seedPositions
	} from "./arrangedGeometry"

	interface Props {
		items: GsItem[]
		/** Fixed square cell edge (px). Cells are exactly this; partials culled. */
		cell?: number
		/**
		 * The saved arrangement `items` were restored from, if any — the frame
		 * whose cell grid their x/y/w/h are expressed in. Read once, at seed
		 * time: it is what lets a zone drawn in a smaller window re-express the
		 * arrangement instead of crushing it, and what tells this zone it has
		 * nothing of its own to report yet (see `emit`).
		 */
		frame?: ArrangedZone
		/**
		 * The zone's docked/flyout state, for the card's pin toggle. `undefined`
		 * (the middle) has no pin at all — it is the session, not a rail.
		 */
		pinned?: boolean
		/** Flip that state. Absent = this zone cannot be pinned (the middle). */
		onTogglePin?: () => void
		onChange?: (layout: ArrangedZone) => void
		onRemove?: (id: string) => void
		/**
		 * A card's Duplicate was pressed (brief 7b). Absent = the cards offer
		 * none. The copy lands through the layout, which re-seeds the zone.
		 */
		onDuplicate?: (id: string) => void
		/**
		 * A card was dragged INTO this zone from another one. The only report
		 * that names a widget AND the zone that now holds it, which is how the
		 * commit's one-zone-per-widget invariant breaks a tie.
		 */
		onDropped?: (id: string) => void
		/**
		 * A USER GESTURE happened in this zone (drag, resize, cross-zone drop,
		 * fit/dock, anchor toggle, group/ungroup) — as opposed to the layout
		 * changing on its own.
		 *
		 * `onChange` cannot answer that question: gridstack fires `change` for a
		 * re-column just as it does for a drag, so a caller that only watches
		 * `onChange` cannot tell an edit from a re-measure. The screen-size
		 * simulator has to (it re-measures on purpose, and must not mistake its
		 * own clamp for the user rearranging things), so the gestures report
		 * themselves at the source.
		 */
		onGesture?: () => void
	}

	let {
		items,
		cell = GS_CELL_PX,
		frame,
		pinned,
		onTogglePin,
		onChange,
		onRemove,
		onDuplicate,
		onDropped,
		onGesture
	}: Props = $props()

	let hostEl: HTMLDivElement
	let grid: GridStack | undefined
	let cols = $state(6)
	/**
	 * A hand has been on this zone since it was seeded. Until then the zone is
	 * a RESTORE — everything in it came out of the saved frame — and `emit`
	 * stays quiet rather than reporting the window size the editor happened to
	 * be opened at as an arrangement the user made.
	 */
	let touched = false
	/** A user gesture: report it, and stop being a restore. */
	function gesture() {
		touched = true
		onGesture?.()
	}

	// ── grouping (editor concept gridstack doesn't model) ──────────────────
	// Selection is reactive so the group toolbar tracks it. `gridMeta`/`gridEmit`
	// are set inside `init` so the template's group actions can reach the live
	// per-widget metadata + report changes. A group id is derived from its sorted
	// members (deterministic — no Date.now/random), and colored by a hue hash so
	// grouped cards are identifiable at a glance.
	let selected = new SvelteSet<string>()
	let gridMeta: Map<
		string,
		{ anchor: WidgetAnchor; group?: string; pinned?: boolean }
	> | null = null
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
		// The id itself, not just its hue: a card dragged into another zone
		// recovers its group from this attribute (see `dropped`), so a group made
		// in THIS session has to stamp it exactly as the seeded markup does.
		if (group) gsc.dataset.group = group
		else delete gsc.dataset.group
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
		gesture()
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
		gesture()
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
	function anchorClasses(a: WidgetAnchor): string {
		return (["top", "right", "bottom", "left"] as const)
			.filter((e) => a[e])
			.map((e) => `anch-${e}`)
			.join(" ")
	}
	/** Four edge-toggle buttons; the pressed ones mark which edges are anchored. */
	function anchorControls(a: WidgetAnchor): string {
		const btn = (edge: keyof WidgetAnchor, glyph: string) =>
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
	/** Lucide's `Copy` (NOMENCLATURE §22: duplicate), drawn so it inherits the color. */
	const COPY_SVG =
		`<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" ` +
		`fill="none" stroke="currentColor" stroke-width="2.2" ` +
		`stroke-linecap="round" stroke-linejoin="round">` +
		`<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>` +
		`<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
	/** A pushpin, drawn rather than spelled so it inherits the button's color. */
	const PIN_SVG =
		`<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" ` +
		`fill="none" stroke="currentColor" stroke-width="2.2" ` +
		`stroke-linecap="round" stroke-linejoin="round">` +
		`<path d="M12 16v6"/><path d="M9 3h6l-1 6 3 4v3H7v-3l3-4z"/></svg>`
	/**
	 * The zone's pin, offered on every card in it (ruled 2026-08-30): pinned is
	 * a docked rail that takes layout space, unpinned collapses to icons that
	 * fly the panels out over the session. It is the ZONE's state — the rail is
	 * docked or it isn't — so every card in the zone shows the same toggle, and
	 * it drives the very state the live rail's own pin button does.
	 */
	function pinControl(on: boolean): string {
		return (
			`<button class="gsc-btn gsc-pin${on ? " active" : ""}" data-act="pin"` +
			` title="${on ? "Unpin" : "Pin to the side"}"` +
			` aria-label="${on ? "Unpin" : "Pin to the side"}"` +
			` aria-pressed="${on}">${PIN_SVG}</button>`
		)
	}
	/** Bring every card's pin button in line with the zone's current state. */
	function applyPinDom(on: boolean) {
		hostEl
			?.querySelectorAll<HTMLElement>(".gsc-pin")
			.forEach((b) => {
				b.classList.toggle("active", on)
				b.setAttribute("aria-pressed", String(on))
				b.setAttribute("aria-label", on ? "Unpin" : "Pin to the side")
				b.setAttribute("title", on ? "Unpin" : "Pin to the side")
			})
	}
	// The cards are gridstack-owned HTML built once at seed, so a pin flipped
	// anywhere (this zone's other cards, the live rail) is reflected here.
	$effect(() => {
		if (onTogglePin) applyPinDom(!!pinned)
	})

	function cardHtml(
		it: GsItem,
		a: WidgetAnchor = it.anchor ?? {},
		group = it.group,
		groupPinned = it.pinned
	): string {
		// The card the primary floor keeps says why it has no ×, where the ×
		// would be — a control that is simply missing reads as a bug.
		const rm = it.floorNote
			? `<span class="gsc-floor" role="note" title="${esc(it.floorNote)}" aria-label="${esc(it.floorNote)}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>`
			: `<button class="gsc-btn gsc-x" data-remove="${esc(it.id)}" title="Remove ${esc(it.title)}" aria-label="Remove ${esc(it.title)}">&times;</button>`
		// Duplicate (brief 7b): a copy of this widget beside it, its settings
		// and style copied — or, at its widget's cap, the reason, dimmed.
		const dup = !onDuplicate
			? ""
			: it.copyRefusal
				? `<span class="gsc-nocopy" role="note" title="${esc(it.copyRefusal)}" aria-label="${esc(it.copyRefusal)}">${COPY_SVG}</span>`
				: `<button class="gsc-btn gsc-dup" data-duplicate="${esc(it.id)}" title="Duplicate ${esc(it.title)}" aria-label="Duplicate ${esc(it.title)}">${COPY_SVG}</button>`
		// Position controls — snap the widget to fill/dock without dragging — then
		// the anchor-edge cluster (toggle which edges the widget sticks to).
		const ctrls =
			`<button class="gsc-btn" data-act="fit-w" title="Fit width">&#8596;</button>` +
			`<button class="gsc-btn" data-act="fit-h" title="Fit height">&#8597;</button>` +
			`<button class="gsc-btn" data-act="dock-top" title="Dock to top">&#8607;</button>` +
			`<button class="gsc-btn" data-act="dock-bottom" title="Dock to bottom">&#8615;</button>` +
			anchorControls(a) +
			(onTogglePin ? pinControl(!!pinned) : "")
		const gcls = group ? " grouped" : ""
		const gstyle = group ? ` style="--ghue:${hueFromId(group)}"` : ""
		// The group id is stamped as a data-attr (not just the hue) so a card
		// dragged into another zone can recover its group there (see `dropped`).
		const gdata = group ? ` data-group="${esc(group)}"` : ""
		// The GROUP's pin (ruled 2026-09-10) — not the zone's, which is the
		// button in `ctrls`. It is toggled on the Move tab's rail preview, never
		// here, so it is stamped only so a card dragged into another zone can
		// recover it there (see `dropped`). Absent means pinned, so the only
		// value worth carrying is the explicit `false`.
		const pdata = groupPinned === false ? ` data-pinned="false"` : ""
		return `<div class="gsc ${anchorClasses(a)}${gcls}"${gstyle}${gdata}${pdata}><span class="gsc-title">${esc(it.title)}</span><span class="gsc-ctrls">${ctrls}${dup}${rm}</span></div>`
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
				// Accept items dragged in from the OTHER zones (cross-zone drag)
				// — every card, the conversation included: placement is free
				// (brief 7a), and the one rule left, the primary floor, is about
				// the whole layout rather than any zone.
				acceptWidgets: true,
				removable: false,
				// The drag helper lives on <body> so it isn't clipped by a zone's
				// bounds and can travel across zones.
				draggable: { handle: ".grid-stack-item-content", appendTo: "body" }
			},
			hostEl
		)!

		const init = untrack(() => items)
		// The saved frame these items came out of, as it stood when the zone was
		// seeded. Held as a local (not the live prop) so a later emit can't be
		// judged against a frame it never drew.
		const seedFrame = untrack(() => frame)
		// Nothing has been added or removed since that frame was saved, so this
		// zone is a faithful restore and has nothing of its own to report.
		const restoring = frameCovers(init, seedFrame)
		// Editor-only per-widget metadata gridstack doesn't model (anchored edges,
		// tab-group membership, the group's pin). Tracked here keyed by id,
		// mutated by the anchor toggles / grouping, and reported back through
		// `emit` so the captured arrangement carries it. The PIN is never edited
		// here — it is the Move tab's rail preview's, written straight into the
		// working arrangement — but it has to be carried, or the next emit this
		// zone makes would drop it.
		const meta = new Map<
			string,
			{ anchor: WidgetAnchor; group?: string; pinned?: boolean }
		>()
		const anyAnchor = (a: WidgetAnchor) =>
			!!(a.top || a.right || a.bottom || a.left)
		grid!.batchUpdate()
		// Default placement + the re-expression of a restored arrangement into
		// the grid as measured now — pure, and tested in ./arrangedGeometry.
		const seeded = seedPositions(init, cols, rows, seedFrame)
		const placed = new Map(seeded.map((p) => [p.id, p]))
		init.forEach((it) => {
			const p = placed.get(it.id)!
			meta.set(it.id, {
				anchor: { ...(it.anchor ?? {}) },
				group: it.group,
				pinned: it.pinned
			})
			// NB: never gridstack-`locked` — the card the floor keeps is still
			// fully draggable/resizable; `floorNote` only replaces its ×.
			grid!.addWidget({
				id: it.id,
				x: p.x,
				y: p.y,
				w: p.w,
				h: p.h,
				content: cardHtml(it, meta.get(it.id)!.anchor, it.group, it.pinned)
			})
		})
		grid!.batchUpdate(false)
		applyPinDom(!!untrack(() => pinned))
		// Expose the live metadata + reporter so the template's group actions reach
		// them (they run outside init).
		gridMeta = meta

		/**
		 * The arrangement a RE-MEASURE re-expresses from: the saved frame while
		 * this zone is still a faithful restore, otherwise the arrangement as
		 * this zone last reported it. Updated only by an emit the USER caused —
		 * never by the re-measure's own result. Re-expressing from the last
		 * clamp is what loses a layout: narrow → wide would give back nothing
		 * but the narrow column's coordinates, scaled up (see the
		 * ResizeObserver below, and `reexpress` in ./arrangedGeometry).
		 *
		 * `restoring`, not `seedFrame` alone. A frame that does not account for
		 * the items on screen accounts for the WRONG ones, and the commonest
		 * such frame is the one a zone that was EMPTY when the editor opened
		 * reported for itself: `{cols, rows, items: []}`. Taken as the reference
		 * it makes `reexpress` return nothing, so every re-measure leaves
		 * gridstack's own `column(n, "none")` clamp standing — which only ever
		 * shrinks `w` — and nothing ever widens the card again. One trip through
		 * a narrow preview and the widget is stuck at a fraction of its zone,
		 * live and saved. The seeded positions are the honest reference there.
		 */
		let ref: ArrangedZone = restoring
			? seedFrame!
			: { cols, rows, items: seeded }
		/**
		 * True while the ResizeObserver is re-expressing. gridstack fires a
		 * `change` for every node it moves; the re-measure reports its result
		 * once, at the end, rather than a card at a time.
		 */
		let remeasuring = false

		const emit = (authored = true) => {
			if (remeasuring) return
			// A zone that is still a restore reports NOTHING. gridstack fires
			// `change` for its own re-measure (the column count follows the
			// window, and a restored card is drawn where the zone has room for
			// it) exactly as it does for a drag, so an unguarded emit hands the
			// editor the current window's clamp as if the user had arranged it —
			// and the next Done writes that over the real arrangement. Opening
			// the editor in a smaller window would destroy a layout, silently and
			// unrecoverably. Only a hand on a card (`touched`) speaks for the
			// user; until then the saved frame already in the editor's hands IS
			// this zone's arrangement, unclamped, and it stays that way.
			if (!touched && restoring) return
			const nodes = grid!.save(false) as GridStackNode[]
			// CLAMPED into this zone's own cell grid. gridstack reports what its
			// engine holds, and a card that arrived from another zone can be
			// reported at a cell this zone does not have (seen live: x = 7 in a
			// 7-column zone, straight after a cross-zone drop). Nothing
			// downstream re-checks — the live view spends `x`/`w` directly as
			// `grid-column`, where a column past `cols` adds IMPLICIT tracks and
			// collapses the explicit `1fr` ones to 0px, shredding every other
			// widget in the zone. `loadArranged` clamps on the way back in for
			// blobs already written; this stops another one being written.
			const layout: ArrangedZone = {
				cols,
				rows,
				items: nodes.map((n) => {
					const m = meta.get(String(n.id))
					return clampPos(
						{
							id: String(n.id),
							x: n.x ?? 0,
							y: n.y ?? 0,
							w: n.w ?? 1,
							h: n.h ?? 1,
							...(m && anyAnchor(m.anchor)
								? { anchor: m.anchor }
								: {}),
							...(m?.group ? { group: m.group } : {}),
							...(m?.pinned === false ? { pinned: false } : {})
						},
						cols,
						rows
					)
				})
			}
			if (authored) ref = layout
			onChange?.(layout)
		}
		gridEmit = emit
		// gridstack hands its listeners an Event; `emit`'s first argument is
		// whether the arrangement is the user's, so it is called by hand here.
		grid!.on("change added", () => emit())
		// A card LEAVING this zone is an edit however it left, and it has to be
		// reported as one or the zone keeps it.
		//
		// The X button already says so before it removes. The other way out is a
		// drag into another zone, and there gridstack fires `removed` here while
		// `dragstop` fires on the DESTINATION only ("if the item has moved to
		// another grid, we're done here") — so this zone never became `touched`,
		// its emit stayed guarded as a restore, and the widget stayed in its
		// arrangement while the destination gained it: the same widget in two
		// zones after Done.
		grid!.on("removed", () => {
			gesture()
			emit()
		})
		// The gesture half of the same story: `change` covers both a drag and a
		// re-column, but `dragstop`/`resizestop` fire ONLY for a hand on a card.
		grid!.on("dragstop resizestop", gesture)
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
			// A card dragged in from another zone: the drag ended over THIS grid,
			// so the source grid's dragstop is the only one that fires. Reported
			// before the refit below, whose `update` emits.
			gesture()
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
			const anchor: WidgetAnchor = {}
			for (const e of ["top", "right", "bottom", "left"] as const)
				if (gsc?.classList.contains(`anch-${e}`)) anchor[e] = true
			meta.set(String(node.id), {
				anchor,
				group: gsc?.dataset.group || undefined,
				pinned: gsc?.dataset.pinned === "false" ? false : undefined
			})
			// Named before the emit, so a caller holding both has the drop's
			// answer for this widget before it sees the arrangement it made.
			onDropped?.(String(node.id))
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
				// The pin is the ZONE's, not this card's: it moves no cell, so it
				// is intentionally not a gesture — pinning a rail must not make a
				// previewed width's clamp count as an arrangement the user made.
				if (a === "pin") {
					onTogglePin?.()
					return
				}
				// fit / dock / anchor are all deliberate edits, same as a drag —
				// reported BEFORE the update whose `change` emits.
				gesture()
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
					const edge = a.slice("anchor-".length) as keyof WidgetAnchor
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
			// Duplicate: the layout mints and seats the copy, and re-seeds this
			// zone with it — nothing to do to gridstack here.
			const dupBtn = target?.closest("[data-duplicate]")
			if (dupBtn) {
				e.preventDefault()
				e.stopPropagation()
				onDuplicate?.(dupBtn.getAttribute("data-duplicate")!)
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
			// Taking a card out is an edit like any other, and `removeWidget`
			// emits — so say so first.
			touched = true
			if (node?.el) grid!.removeWidget(node.el)
			selected.delete(id)
			onRemove?.(id)
		}
		hostEl.addEventListener("click", onClick)

		// On zone resize, re-derive how many WHOLE cells fit each axis (partials
		// culled) and RE-EXPRESS the arrangement into the grid as measured now
		// — the same proportional maths the seed uses, from the same reference.
		//
		// NOT gridstack's own re-layout. `column(n, "list")` compacts the whole
		// zone into a single column and throws x/y away, so one drag after a
		// re-column commits that stack as the user's arrangement; `"none"` is
		// no kinder in the end, since `columnChanged` still clamps x into
		// `column - 1` and w into `column`, and a wide layout that has been
		// through a phone-width preview comes back from it narrow. Neither can
		// do better, because both are asked to transform the CURRENT cells and
		// the wide ones are already gone by the second pass.
		//
		// `reexpress(ref, …)` is a pure function of the arrangement as last
		// AUTHORED, so narrow → wide lands exactly where it started while
		// narrow still shows the squeeze — the doc's "panels are squeezed to
		// fit", and the simulator's preview stays honest because the squeeze is
		// real and the arrangement it is a view of is untouched.
		const ro = new ResizeObserver(() => {
			const p = hostEl.parentElement
			if (!p || !grid) return
			const c = cellsIn(p.clientWidth || hostEl.clientWidth)
			const r = cellsIn(p.clientHeight || hostEl.clientHeight)
			if (c === cols && r === rows) return
			cols = c
			rows = r
			// Both halves: `opts.maxRow` bounds the container, `engine.maxRow`
			// is what actually vetoes a move — leave the engine on the row
			// count the zone was built at and a taller zone can never place a
			// card in the rows it just gained.
			grid.opts.maxRow = rows
			grid.engine.maxRow = rows
			remeasuring = true
			try {
				// gridstack's own column change goes FIRST and outside the
				// batch: `columnChanged` opens and closes an engine batch of
				// its own, and the engine's batch flag is a boolean rather
				// than a count — one opened around it would be shut halfway.
				grid.column(cols, "none")
				grid.batchUpdate()
				for (const q of reexpress(ref, cols, rows)) {
					const node = grid.engine.nodes.find(
						(n) => String(n.id) === q.id
					)
					if (node?.el)
						grid.update(node.el, {
							x: q.x,
							y: q.y,
							w: q.w,
							h: q.h
						})
				}
			} finally {
				// Never leave the zone batched or muted: either would be a
				// zone that silently stops reporting the user's arrangement.
				grid.batchUpdate(false)
				remeasuring = false
			}
			// One report for the whole re-measure, and NOT an authored one:
			// this is the arrangement drawn at the size it is being drawn at,
			// not a new arrangement to re-express the next resize from.
			emit(false)
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
		font-size: 13px;
		font-weight: 500;
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
		font-size: 13px;
		font-weight: 500;
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
	/* Duplicate (brief 7b) stays visible like the ×: it is how a second copy
	   of a placed widget is made, so it must be findable without a hover. At
	   the widget's cap it is a dimmed note that says why. */
	:global(.grid-stack .gsc-dup) {
		opacity: 0.85;
	}
	:global(.grid-stack .gsc-nocopy) {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.2rem;
		block-size: 1.2rem;
		opacity: 0.4;
		cursor: help;
	}
	/* Where the × would be on the card the primary floor keeps: a lock that
	   says why (its title and label), visible like the × it stands in for. */
	:global(.grid-stack .gsc-floor) {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.2rem;
		block-size: 1.2rem;
		opacity: 0.85;
		cursor: help;
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
	   glance; unset ones reveal on hover like the other controls. Same for a
	   pinned zone: docked is the state worth seeing without reaching for it. */
	:global(.grid-stack .gsc-anch.active),
	:global(.grid-stack .gsc-pin.active) {
		opacity: 1 !important;
		background: var(--color-primary-300);
		color: var(--color-surface-950);
	}
	/* The pin sits past the anchor cluster, with the same divider setting it
	   off — it is the ZONE's state, not this card's. */
	:global(.grid-stack .gsc-pin) {
		margin-inline-start: 0.15rem;
		padding-inline-start: 0.2rem;
		border-inline-start: 1px solid
			color-mix(in oklab, var(--color-surface-50) 30%, transparent);
		inline-size: 1.35rem;
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
