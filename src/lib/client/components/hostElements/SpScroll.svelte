<script lang="ts">
	/**
	 * `sp-scroll` — a scroll region. `stick="bottom"` keeps a log anchored to
	 * its end as it grows (`stick="top"` for a newest-first log), unless the
	 * person has scrolled away from that end — and then what is on screen
	 * stays put as rows arrive, older ones prepended included. `reach-start`
	 * fires once each time the far end from `stick` is reached (load older).
	 */
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, emit, slot }: SpElementProps = $props()
	let region = $state<HTMLElement | null>(null)
	let pinned = true
	let atStart = false
	// Distance from the stuck end, kept while the person reads elsewhere —
	// the fallback when there is nothing on screen to hold on to.
	let fromEnd = 0
	/**
	 * What the reader is looking at, when scrolled away from the stuck end:
	 * the element at the top of the region, and how far below the top it
	 * sat. Rows arriving above it (older ones) or below it (a reply
	 * streaming) move the content, never it.
	 */
	let anchor: { el: Element; offset: number } | null = null

	const top = () => attrs.stick === "top"
	const distance = (el: HTMLElement) =>
		top() ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight

	$effect(() => {
		const el = region
		if (!el || (attrs.stick !== "bottom" && attrs.stick !== "top")) return
		const follow = () => {
			if (pinned) {
				el.scrollTop = top() ? 0 : el.scrollHeight
				return
			}
			// Scrolled away: hold what is on screen where it is.
			if (anchor?.el.isConnected) {
				const moved = anchor.el.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset
				if (moved) el.scrollTop += moved
			} else if (top()) el.scrollTop = fromEnd
			else el.scrollTop = el.scrollHeight - el.clientHeight - fromEnd
		}
		const ro = new ResizeObserver(follow)
		const mo = new MutationObserver(follow)
		ro.observe(el)
		mo.observe(el, { childList: true, subtree: true, characterData: true })
		follow()
		return () => {
			ro.disconnect()
			mo.disconnect()
		}
	})

	/** The element at the region's top edge, and its offset from it. */
	function takeAnchor(el: HTMLElement) {
		const box = el.getBoundingClientRect()
		const hit = document.elementFromPoint(box.left + Math.min(24, box.width / 2), box.top + 2)
		anchor = hit && el.contains(hit) && hit !== el ? { el: hit, offset: hit.getBoundingClientRect().top - box.top } : null
	}

	function onscroll() {
		if (!region) return
		fromEnd = distance(region)
		pinned = fromEnd < 4
		if (pinned) anchor = null
		else takeAnchor(region)
		const far = top()
			? region.scrollHeight - region.scrollTop - region.clientHeight <= 1
			: region.scrollTop <= 0
		if (far && !atStart) emit("reach-start")
		atStart = far
	}
</script>

<!-- A labelled scroll region takes focus so a keyboard can scroll it (axe
     scrollable-region-focusable); the lint reads the role as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="sp-scroll-region"
	role={attrs.label ? "region" : undefined}
	aria-label={attrs.label ?? undefined}
	tabindex={attrs.label ? 0 : undefined}
	style:overflow="auto"
	style:max-block-size="100%"
	bind:this={region}
	{onscroll}
	{@attach slot()}
></div>
