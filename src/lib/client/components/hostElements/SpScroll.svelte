<script lang="ts">
	/**
	 * `sp-scroll` — a scroll region. `stick="bottom"` keeps a log anchored to
	 * its end as it grows (`stick="top"` for a newest-first log), unless the
	 * person has scrolled away from that end — and then what is on screen
	 * stays put as rows arrive, older ones prepended included. `reach-start`
	 * fires once each time the far end from `stick` is reached (load older).
	 *
	 * With `stick` it does its own anchoring (the observers below), so the
	 * browser's is off (`overflow-anchor: none`): a native anchoring
	 * adjustment moves the region toward the end while the end moves
	 * further, and must never read as the person scrolling away.
	 *
	 * A scroll the reader did not make but that leaves the end — find in
	 * page, a screen reader bringing a row into view, caret browsing, a
	 * `#message-<id>` link — is left where it was put, like a reader's own:
	 * those are how a person without a wheel moves through the log. Known
	 * limit: a layout that widens the region and reverts within one task can
	 * clamp it off the end with no resize reported; the next row to land
	 * does not re-pin it (the reader is taken to have left).
	 *
	 * A LANDING (`landOn`, `LANDED_EVENT`: a `?message=` link) is told, not
	 * inferred: the scroll event of a jump comes a frame late, and a row
	 * landing in between would pin the log straight back to its end. Heard,
	 * the region lets go of the end (unless the landed element left it there)
	 * and holds the landed element where it was put; the reader returning to
	 * the end pins it again, as after any scroll away.
	 */
	import type { SpElementProps } from "./spElement.svelte"
	import { LANDED_EVENT } from "$lib/client/utils/landOn"

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
	// Where the region last stood, as `onscroll` saw it or `follow` put it:
	// only a scroll away from the stuck end, measured from here, leaves it.
	let lastTop = 0

	const top = () => attrs.stick === "top"
	const distance = (el: HTMLElement) =>
		top() ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight

	$effect(() => {
		const el = region
		if (!el || (attrs.stick !== "bottom" && attrs.stick !== "top")) return
		const follow = () => {
			if (pinned) el.scrollTop = top() ? 0 : el.scrollHeight
			// Scrolled away: hold what is on screen where it is.
			else if (anchor?.el.isConnected) {
				const moved = anchor.el.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset
				if (moved) el.scrollTop += moved
			} else if (top()) el.scrollTop = fromEnd
			else el.scrollTop = el.scrollHeight - el.clientHeight - fromEnd
			lastTop = el.scrollTop
		}
		// The region's own box, and its content's: a reflow that changes no
		// node — a web font swapping in, an image loading in the newest row —
		// moves the end without a mutation or a region resize.
		const ro = new ResizeObserver(follow)
		const watched = new Set<Element>()
		const watchContent = () => {
			for (const child of el.children)
				if (!watched.has(child)) (watched.add(child), ro.observe(child))
			for (const child of watched)
				if (child.parentElement !== el) (watched.delete(child), ro.unobserve(child))
		}
		const mo = new MutationObserver(() => (watchContent(), follow()))
		ro.observe(el)
		watchContent()
		mo.observe(el, { childList: true, subtree: true, characterData: true })
		document.fonts?.addEventListener("loadingdone", follow)
		follow()
		return () => {
			ro.disconnect()
			mo.disconnect()
			document.fonts?.removeEventListener("loadingdone", follow)
		}
	})

	// A landing inside the region: leave the end, hold the landed element.
	$effect(() => {
		const el = region
		if (!el) return
		const onLanded = (e: Event) => {
			const target = e.target
			if (!(target instanceof Element) || !el.contains(target)) return
			if (attrs.stick !== "bottom" && attrs.stick !== "top") return
			lastTop = el.scrollTop
			fromEnd = distance(el)
			pinned = fromEnd < 4
			anchor = pinned
				? null
				: { el: target, offset: target.getBoundingClientRect().top - el.getBoundingClientRect().top }
		}
		el.addEventListener(LANDED_EVENT, onLanded)
		return () => el.removeEventListener(LANDED_EVENT, onLanded)
	})

	/**
	 * The element at the region's top edge, and its offset from it. Probed at
	 * the region's horizontal centre: a region can be wider than its content
	 * (the conversation's log spans the panel with its rows in a centred
	 * column), and a probe in the gutter would find only the region itself.
	 */
	function takeAnchor(el: HTMLElement) {
		const box = el.getBoundingClientRect()
		const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2)
		anchor = hit && el.contains(hit) && hit !== el ? { el: hit, offset: hit.getBoundingClientRect().top - box.top } : null
	}

	function onscroll() {
		if (!region) return
		const was = lastTop
		lastTop = region.scrollTop
		// Pinned, a scroll toward the stuck end (or none) is the end moving —
		// a reflow, the browser's own adjustment — never the person leaving:
		// leaving the end means moving away from it.
		const away = top() ? lastTop > was : lastTop < was
		if (!pinned || away) {
			fromEnd = distance(region)
			pinned = fromEnd < 4
			if (pinned) anchor = null
			else takeAnchor(region)
		}
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
	style:overflow-anchor={attrs.stick === "bottom" || attrs.stick === "top" ? "none" : undefined}
	style:max-block-size="100%"
	bind:this={region}
	{onscroll}
	{@attach slot()}
></div>
