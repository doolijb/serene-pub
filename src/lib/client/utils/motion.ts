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
// etc.) wherever they'll do — those are already covered by app.css, and read
// the same three numbers as theme keys (`duration-fast` · `-base` · `-slow`,
// `--transition-duration-*` in app.css; keep the two in step). Reach for
// `motionDuration(MOTION.*)` only when the thing being animated is entering or
// leaving the DOM, which CSS alone can't handle.

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
