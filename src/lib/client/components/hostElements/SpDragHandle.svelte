<script lang="ts">
	/**
	 * 🚧 `sp-drag-handle` (vocabulary 1.4, live scenes lane E) — a grip a
	 * person drags along a list to move a boundary between its items: a
	 * scene divider's start, between the log's rows. Its body is the grip
	 * (the widget draws it); `along` names the items by one widget part, and
	 * each carries its key as `data-drag-key`.
	 *
	 * While dragged, a line (`sp-drag-handle-line`) marks the gap between
	 * two shown items nearest the pointer — snapping, never between a row's
	 * halves — and on release `move` carries `{ prev, next }`, the keys
	 * either side of that gap in document order (null at an end). Escape, a
	 * cancelled pointer or a release where nothing moved raise nothing.
	 *
	 * Pointer only, and hidden from assistive technology: the widget offers
	 * the same move another way (the divider's *Move start up / down one
	 * line*), as the vocabulary's doc requires.
	 */
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, emit, slot, host }: SpElementProps = $props()
	const disabled = $derived(flag(attrs.disabled))

	/** A widget part token, safe inside an attribute selector. */
	const PART = /^[A-Za-z0-9:._-]+$/

	type Gap = { prev: string | null; next: string | null; y: number }
	let line = $state<{ top: number; left: number; width: number } | null>(null)
	let pointer: number | null = null
	/** The grip, which holds the pointer while it is dragged. */
	let grip: HTMLElement | undefined = $state()
	let gap: Gap | null = null
	let startY = 0
	let moved = false

	/** The shown items along which the handle moves, in document order. */
	function itemsAlong(): HTMLElement[] {
		const along = attrs.along ?? ""
		if (!PART.test(along)) return []
		const box = host.closest("[data-sp-owner]") ?? host.ownerDocument?.body
		if (!box) return []
		return [
			...box.querySelectorAll<HTMLElement>(`[data-widget-part~="${along}"]`)
		].filter(
			(el) =>
				!el.hidden &&
				el.getAttribute("data-drag-key") !== null &&
				el.getClientRects().length > 0
		)
	}

	/** Every gap between the items: before the first, between each pair, after the last. */
	function gapsOf(items: HTMLElement[]): Gap[] {
		const out: Gap[] = []
		const key = (el: HTMLElement | undefined) =>
			el?.getAttribute("data-drag-key") ?? null
		for (let i = 0; i <= items.length; i++) {
			const prev = items[i - 1]
			const next = items[i]
			const y = next
				? next.getBoundingClientRect().top
				: prev!.getBoundingClientRect().bottom
			out.push({ prev: key(prev), next: key(next), y })
		}
		return out
	}

	function track(clientY: number) {
		const items = itemsAlong()
		if (!items.length) {
			gap = null
			line = null
			return
		}
		let best: Gap | null = null
		for (const g of gapsOf(items))
			if (!best || Math.abs(g.y - clientY) < Math.abs(best.y - clientY)) best = g
		gap = best
		const box = items[0].getBoundingClientRect()
		line = best ? { top: best.y - 1, left: box.left, width: box.width } : null
	}

	function stop() {
		if (pointer !== null) {
			try {
				grip?.releasePointerCapture?.(pointer)
			} catch {
				// Already released.
			}
		}
		pointer = null
		gap = null
		line = null
		moved = false
		window.removeEventListener("keydown", onKey, true)
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== "Escape") return
		e.preventDefault()
		e.stopPropagation()
		stop()
	}

	function down(e: PointerEvent) {
		if (disabled || e.button !== 0 || pointer !== null) return
		e.preventDefault()
		pointer = e.pointerId
		startY = e.clientY
		moved = false
		try {
			grip?.setPointerCapture?.(e.pointerId)
		} catch {
			// A synthetic pointer cannot be captured; the window still hears it.
		}
		window.addEventListener("keydown", onKey, true)
	}

	function move(e: PointerEvent) {
		if (pointer === null || e.pointerId !== pointer) return
		if (!moved && Math.abs(e.clientY - startY) < 4) return
		moved = true
		track(e.clientY)
	}

	function up(e: PointerEvent) {
		if (pointer === null || e.pointerId !== pointer) return
		const landed = moved ? gap : null
		stop()
		if (landed) emit("move", { prev: landed.prev, next: landed.next })
	}
</script>

<span
	bind:this={grip}
	class="sp-drag-handle-grip"
	aria-hidden="true"
	title={attrs.label ?? undefined}
	data-dragging={line ? "" : undefined}
	data-disabled={disabled ? "" : undefined}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={stop}
	{@attach slot()}
></span>
{#if line}
	<div
		class="sp-drag-handle-line"
		aria-hidden="true"
		style:top="{line.top}px"
		style:left="{line.left}px"
		style:width="{line.width}px"
	></div>
{/if}
