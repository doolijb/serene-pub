// Shared motion primitives for JS-driven (svelte/transition) animation.
//
// WHY THIS EXISTS: app.css has a global `@media (prefers-reduced-motion:
// reduce)` block that collapses animation/transition durations to 0.01ms.
// That rule cannot reach Svelte transitions — Svelte 5 implements them with
// the Web Animations API (element.animate(...), see
// svelte/src/internal/client/dom/elements/transitions.js), which is not
// subject to CSS transition-duration at all. So anything built on
// svelte/transition has to check the media query itself.
//
// Prefer plain CSS transitions (transition-opacity, the grid 0fr->1fr trick,
// etc.) wherever they'll do — those are already covered by app.css. Reach for
// these helpers only when the thing being animated is entering or leaving the
// DOM, which CSS alone can't handle.

import { cubicOut } from "svelte/easing"
import type { TransitionConfig } from "svelte/transition"

/** Canonical durations in ms, consolidating the ad-hoc values previously
 *  scattered across Layout.svelte (fade 150 / fly 200), the sidebars
 *  (flip 200 / fade 150) and routes/+page.svelte (fade 120). */
export const MOTION = {
	/** Fades that must not read as a delay (message enter/exit). */
	fast: 130,
	/** Size and position changes (collapsibles, list reflow). */
	base: 180,
	/** Larger surfaces (panels, drawers). */
	slow: 220
} as const

/** SSR-safe. Deliberately re-read per call rather than cached at module scope:
 *  there is no `window` during SSR, and a user can change the OS setting
 *  mid-session — reading per transition picks that up on the next animation. */
export function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	)
		return false
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Collapses a duration to 0 when the user has asked for reduced motion. */
export function motionDuration(ms: number): number {
	return prefersReducedMotion() ? 0 : ms
}

interface SoftFadeParams {
	duration?: number
	delay?: number
	/** Skip the animation entirely — for bulk inserts (initial render,
	 *  prepending older messages) where per-item fades would read as noise. */
	suppressed?: boolean
}

/**
 * Opacity-only fade.
 *
 * Deliberately has no transform and no height component. The session list's
 * autoscroll (performAutoscroll in routes/sessions/[id]/+page.svelte) reads
 * scrollHeight synchronously right after a message is inserted, so an entering
 * element has to contribute its final height to layout immediately — anything
 * that animates size would be measured mid-flight and land the scroll short.
 */
export function softFade(
	_node: Element,
	{
		duration = MOTION.fast,
		delay = 0,
		suppressed = false
	}: SoftFadeParams = {}
): TransitionConfig {
	return {
		delay: suppressed ? 0 : delay,
		duration: suppressed ? 0 : motionDuration(duration),
		easing: cubicOut,
		css: (t) => `opacity: ${t}`
	}
}

interface AnimateHeightParams {
	/** When false, size changes are adopted instantly with no animation.
	 *  Session messages pass `!msg.isGenerating`: while tokens are streaming in,
	 *  the height changes many times a second and an animation would lag
	 *  permanently behind the real content instead of settling. */
	enabled?: boolean
	duration?: number
	/** CSS selector for the scrolling ancestor to keep pinned to the bottom
	 *  while the animation runs. See the note on pinning below. */
	scrollContainer?: string
}

/**
 * Svelte action: animate an element's height when its content changes size.
 *
 * CSS cannot transition to or from `height: auto`, so this measures the real
 * height and drives it with the Web Animations API.
 *
 * Structure it as a padding-free wrapper around exactly one child:
 *
 *     <div use:animateHeight={{ enabled }}>
 *         <div class="…the real content, padding and all…">…</div>
 *     </div>
 *
 * The observer watches the *child* while the animation drives the *wrapper*,
 * which is what stops our own height writes from re-triggering the observer
 * in a feedback loop. The wrapper must have no padding of its own, or its
 * border-box height won't match what was measured.
 *
 * Pinning: the session list's autoscroll always scrolls to the very bottom, and
 * reads scrollHeight synchronously — so on its own it would measure a
 * mid-animation height and land short. Rather than avoid animating, this
 * re-pins the container every frame for the duration, but only when it was
 * already at the bottom when the change landed. A reader who has scrolled up
 * is left alone.
 */
export function animateHeight(node: HTMLElement, params: AnimateHeightParams) {
	let current: AnimateHeightParams = params ?? {}
	const inner = node.firstElementChild as HTMLElement | null
	if (!inner || typeof ResizeObserver === "undefined") {
		return {
			update(p: AnimateHeightParams) {
				current = p ?? {}
			}
		}
	}

	let lastHeight = inner.getBoundingClientRect().height
	let anim: Animation | null = null
	let raf = 0

	function stopPinning() {
		if (raf) cancelAnimationFrame(raf)
		raf = 0
	}

	const observer = new ResizeObserver(() => {
		const next = inner.getBoundingClientRect().height
		if (Math.abs(next - lastHeight) < 0.5) return

		const from = lastHeight
		lastHeight = next

		if (current.enabled === false || prefersReducedMotion()) return

		const duration = motionDuration(current.duration ?? MOTION.base)
		if (!duration) return

		anim?.cancel()
		stopPinning()

		// Clipped only while moving, so a taller "before" state can't spill
		// past the wrapper on the way down.
		const prevOverflow = node.style.overflow
		node.style.overflow = "hidden"

		anim = node.animate(
			[{ height: `${from}px` }, { height: `${next}px` }],
			{ duration, easing: "cubic-bezier(0.33, 1, 0.68, 1)" }
		)

		const container = current.scrollContainer
			? node.closest<HTMLElement>(current.scrollContainer)
			: null
		// 40px of slack so "close enough to the bottom" still counts — the
		// reader is looking at the newest message either way.
		const wasAtBottom =
			!!container &&
			container.scrollHeight -
				container.scrollTop -
				container.clientHeight <
				40
		if (wasAtBottom && container) {
			const pin = () => {
				container.scrollTop = container.scrollHeight
				raf = requestAnimationFrame(pin)
			}
			raf = requestAnimationFrame(pin)
		}

		const done = () => {
			stopPinning()
			node.style.overflow = prevOverflow
			if (wasAtBottom && container)
				container.scrollTop = container.scrollHeight
			anim = null
		}
		anim.addEventListener("finish", done, { once: true })
		anim.addEventListener("cancel", done, { once: true })
	})

	observer.observe(inner)

	return {
		update(p: AnimateHeightParams) {
			current = p ?? {}
		},
		destroy() {
			observer.disconnect()
			stopPinning()
			anim?.cancel()
		}
	}
}
