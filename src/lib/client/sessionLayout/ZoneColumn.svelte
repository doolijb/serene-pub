<script lang="ts" module>
	/** One panel's place and measured box, as the column hands it to the render. */
	export type CellAt = {
		index: number
		count: number
		widthPx: number
		heightPx: number
	}
</script>

<script lang="ts">
	/**
	 * ONE zone's column of panels — the height engine all three zones share
	 * (PLAN 2026-11-05 D10). A CSS grid, one row per panel. Each row's height
	 * is `allocateZone`'s answer for the column's measured height: Fit panels
	 * their content, Fill panels what is left, shares their twelfths, priority
	 * deciding who gives way when the zone runs short. Before anything is
	 * measured the rows are `cssTrackOf`'s first-frame tracks. When even the
	 * floors overflow, the column scrolls — never a panel past its floor.
	 *
	 * A Fit panel's content is measured with a ResizeObserver on the active
	 * widget's root (a remote widget's DOM is the page's DOM), read with the
	 * host's box briefly at auto height so it is the content, not the row; it
	 * re-measures on DOM or text changes and when a picture loads. A panel with no
	 * widget box in it (a plugin frame) stays at its floor. The cell's OWN
	 * height is never taken as the want: that would only ever grow.
	 *
	 * Every panel is ONE cell, always mounted (the no-reload law); the panel
	 * itself is the renderer's snippet.
	 */
	import type { Snippet } from "svelte"
	import type { DrawnPanel } from "@serene-pub/sdk"
	import {
		FIT_FLOOR_PX,
		allocateZone,
		cssTrackOf,
		floorOf
	} from "./zoneHeights"

	interface Props {
		zone: "left" | "middle" | "right"
		panels: DrawnPanel[]
		gapPx: number
		isMessages: (id: string) => boolean
		panel: Snippet<[DrawnPanel, CellAt]>
	}

	let { zone, panels, gapPx, isMessages, panel }: Props = $props()

	/** The column's measured height (0 = not laid out yet). */
	let columnPx = $state(0)
	let cellWidths = $state<Record<string, number>>({})
	let cellHeights = $state<Record<string, number>>({})
	/** A Fit panel's measured want, by panel key; replaced, never mutated. */
	let wants = $state<Record<string, number>>({})

	function setWant(key: string, px: number | null) {
		if (px === null) {
			if (!(key in wants)) return
			const { [key]: _gone, ...rest } = wants
			wants = rest
			return
		}
		if (wants[key] === px) return
		wants = { ...wants, [key]: px }
	}

	/**
	 * A Fit panel whose shown widget draws no content (measured want 0): it
	 * takes no row, no gap and draws nothing, yet stays mounted so it is
	 * measured the moment content arrives.
	 */
	let isEmpty = (p: DrawnPanel) => p.height === "fit" && wants[p.key] === 0
	let drawn = $derived(panels.filter((p) => !isEmpty(p)))

	let allocation = $derived(
		allocateZone({
			columnPx,
			gapPx,
			panels: drawn.map((p) => {
				const wantPx =
					p.height === "fit" ? (wants[p.key] ?? null) : null
				return {
					key: p.key,
					height: p.height,
					priority: p.priority,
					wantPx,
					floorPx: floorOf({
						height: p.height,
						isMessages: isMessages(p.open),
						wantPx
					})
				}
			})
		})
	)
	let rows = $derived(
		drawn.length === 0
			? "none"
			: allocation
				? allocation.map((a) => `${a.px}px`).join(" ")
				: drawn
						.map((p) =>
							cssTrackOf({
								height: p.height,
								isMessages: isMessages(p.open)
							})
						)
						.join(" ")
	)
	/** The floors alone do not fit: the column scrolls. */
	let overflows = $derived(
		allocation !== null &&
			allocation.reduce((a, b) => a + b.px, 0) +
				gapPx * Math.max(0, allocation.length - 1) >
				columnPx + 0.5
	)

	/** The widget root of a cell's shown tab: remote DOM lands in the page. */
	const ROOT = ".wtab-pane:not(.wtab-hidden) [data-sp-widget-box] > *"
	const BOX = ".wtab-pane:not(.wtab-hidden) [data-sp-widget-box]"

	function edgePx(el: Element | null): number {
		if (!el) return 0
		const cs = getComputedStyle(el)
		const n = (v: string) => Number.parseFloat(v) || 0
		return (
			n(cs.borderTopWidth) +
			n(cs.borderBottomWidth) +
			n(cs.marginTop) +
			n(cs.marginBottom)
		)
	}

	/**
	 * The root's natural height: the host's box (never the widget's own root)
	 * is un-constrained for one read, so the rect is the content rather than
	 * the row it was given. Less its own padding and borders: nothing inside
	 * them draws nothing.
	 */
	function naturalHeight(rootEl: Element): number {
		const box = rootEl.closest<HTMLElement>("[data-sp-widget-box]")
		const saved = box?.style.getPropertyValue("height") ?? ""
		const prio = box?.style.getPropertyPriority("height") ?? ""
		box?.style.setProperty("height", "auto", "important")
		const h = rootEl.getBoundingClientRect().height
		if (box) {
			if (saved) box.style.setProperty("height", saved, prio)
			else box.style.removeProperty("height")
		}
		const cs = getComputedStyle(rootEl)
		const n = (v: string) => Number.parseFloat(v) || 0
		const inner =
			n(cs.paddingTop) +
			n(cs.paddingBottom) +
			n(cs.borderTopWidth) +
			n(cs.borderBottomWidth)
		return h - inner <= 0.5 ? 0 : h
	}

	/** Watches one Fit cell's widget root and writes its want. */
	function watchFit(
		node: HTMLElement,
		arg: { key: string; fit: boolean; open: string }
	) {
		let cur = arg
		let root: Element | null = null
		let dead = false
		const ro = new ResizeObserver(() => measure())
		function measure() {
			if (dead) return
			if (!cur.fit) {
				setWant(cur.key, null)
				return
			}
			const next = node.querySelector(ROOT)
			if (next !== root) {
				if (root) ro.unobserve(root)
				root = next
				if (root) ro.observe(root)
			}
			if (!node.querySelector(BOX)) {
				// No widget box (a plugin frame, or nothing mounted yet): its floor.
				setWant(cur.key, FIT_FLOOR_PX)
				return
			}
			const content = root ? naturalHeight(root) : 0
			if (content <= 0.5) {
				// The widget draws nothing: the panel takes no height (see isEmpty).
				setWant(cur.key, 0)
				return
			}
			const strip =
				node.querySelector(".ptabs-head")?.getBoundingClientRect()
					.height ?? 0
			setWant(
				cur.key,
				Math.ceil(
					content + strip + edgePx(node.querySelector(".ptabs"))
				)
			)
		}
		const mo = new MutationObserver(() => measure())
		// No attributes: the natural read writes a style attribute (a loop).
		mo.observe(node, {
			childList: true,
			subtree: true,
			characterData: true
		})
		// A picture that loads later changes the content, not the root's box.
		const onLoad = () => measure()
		node.addEventListener("load", onLoad, true)
		node.addEventListener("error", onLoad, true)
		queueMicrotask(measure)
		return {
			update(next: typeof arg) {
				const moved = next.key !== cur.key
				if (moved) setWant(cur.key, null)
				cur = next
				measure()
			},
			destroy() {
				dead = true
				ro.disconnect()
				mo.disconnect()
				node.removeEventListener("load", onLoad, true)
				node.removeEventListener("error", onLoad, true)
				setWant(cur.key, null)
			}
		}
	}
</script>

<div
	class="zone-column"
	class:overflows
	data-zone={zone}
	bind:clientHeight={columnPx}
	style:grid-template-rows={rows}
	style:row-gap="{gapPx}px"
>
	{#each panels as p, i (p.key)}
		<div
			class="zone-cell"
			class:empty={isEmpty(p)}
			data-panel-key={p.key}
			bind:clientWidth={cellWidths[p.key]}
			bind:clientHeight={cellHeights[p.key]}
			use:watchFit={{ key: p.key, fit: p.height === "fit", open: p.open }}
		>
			{@render panel(p, {
				index: i,
				count: panels.length,
				widthPx: cellWidths[p.key] ?? 0,
				heightPx: cellHeights[p.key] ?? 0
			})}
		</div>
	{/each}
</div>

<style>
	.zone-column {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		flex: 1 1 0;
		block-size: 100%;
		min-block-size: 0;
		min-inline-size: 0;
		overflow: hidden;
	}
	.zone-column.overflows {
		overflow-y: auto;
	}
	.zone-cell {
		position: relative;
		min-block-size: 0;
		min-inline-size: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	/* A panel with nothing to show: out of the grid (no row, no gap), unseen,
	   still laid out so it is measured the moment content arrives. */
	.zone-cell.empty {
		position: absolute;
		inset-inline: 0;
		inset-block-start: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.zone-cell > :global(*) {
		flex: 1;
		min-block-size: 0;
	}
</style>
