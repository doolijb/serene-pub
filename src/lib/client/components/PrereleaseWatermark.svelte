<script lang="ts">
	import { onMount } from "svelte"

	/**
	 * The permanent "this is not a production build" marker.
	 *
	 * Rendered by the root layout whenever `page.data.isPrerelease` is true,
	 * i.e. whenever the running version carries a semver pre-release suffix.
	 * The point is that a pre-release build should never be mistaken for a
	 * release one — so it is always on screen, and there is no dismiss button.
	 *
	 * ## Why the fade is JavaScript and not `:hover`
	 *
	 * Two requirements collide. The marker must never intercept a click (it
	 * sits in the bottom-right corner, over real controls), which means
	 * `pointer-events: none` permanently — and an element with no pointer
	 * events never receives `:hover`, so a CSS-only fade cannot fire.
	 *
	 * The obvious patch, `:hover { pointer-events: none }`, oscillates
	 * forever: taking pointer events away removes the hover that asked for
	 * it, which puts them back, which re-triggers the hover — a flicker loop
	 * at frame rate, and one that also eats the click it was supposed to let
	 * through, since the element is interactive again the moment the cursor
	 * leaves it.
	 *
	 * So proximity is measured instead of hovered: one document-level
	 * `pointermove` listener, coalesced to at most one measurement per frame
	 * with requestAnimationFrame, comparing the cursor against this element's
	 * own rect grown by a small padding. The element's pointer-events state
	 * never changes, so there is nothing to oscillate — the class it toggles
	 * only drives `opacity`. The padding means it starts fading *before* the
	 * cursor arrives, which is what makes it feel like it is getting out of
	 * the way rather than reacting after the fact.
	 */
	let { version }: { version: string } = $props()

	/** How close the cursor gets, in CSS px, before the marker starts fading.
	 * Roughly a fingertip's worth of slack around a very small target. */
	const PROXIMITY_PADDING = 72

	let el: HTMLElement | undefined = $state()
	let cursorIsNear = $state(false)

	onMount(() => {
		let frame = 0
		let pendingX = 0
		let pendingY = 0

		function measure() {
			frame = 0
			if (!el) return
			const rect = el.getBoundingClientRect()
			cursorIsNear =
				pendingX >= rect.left - PROXIMITY_PADDING &&
				pendingX <= rect.right + PROXIMITY_PADDING &&
				pendingY >= rect.top - PROXIMITY_PADDING &&
				pendingY <= rect.bottom + PROXIMITY_PADDING
		}

		function onPointerMove(event: PointerEvent) {
			pendingX = event.clientX
			pendingY = event.clientY
			// Coalesce: a pointermove stream can fire far more often than the
			// display refreshes, and each measurement costs a forced layout.
			if (!frame) frame = requestAnimationFrame(measure)
		}

		// The cursor can leave the window while still inside the padded box
		// (moving off the bottom-right corner of the screen is the obvious
		// case), and no further pointermove ever arrives to undo the fade.
		function onPointerOut(event: PointerEvent) {
			if (event.relatedTarget) return
			if (frame) {
				cancelAnimationFrame(frame)
				frame = 0
			}
			cursorIsNear = false
		}

		document.addEventListener("pointermove", onPointerMove, {
			passive: true
		})
		document.addEventListener("pointerout", onPointerOut)

		return () => {
			document.removeEventListener("pointermove", onPointerMove)
			document.removeEventListener("pointerout", onPointerOut)
			if (frame) cancelAnimationFrame(frame)
		}
	})
</script>

<!-- aria-hidden: decorative. Announcing a build stamp on every page (and
     again after every route change) would be noise, and Document View
     surfaces the same fact as real readable text instead — see
     AccessibleShell.svelte's footer. -->
<div
	bind:this={el}
	class="prerelease-watermark text-warning-500"
	class:is-near={cursorIsNear}
	aria-hidden="true"
>
	{version}
</div>

<style>
	.prerelease-watermark {
		position: fixed;
		right: 0.4rem;
		bottom: 0.2rem;
		/* Above the app shell, but it can never take a click, so being on top
		   costs nothing — see the block comment above. */
		z-index: 9999;
		/* THE load-bearing line. Never make this conditional. */
		pointer-events: none;
		user-select: none;
		font-size: 0.65rem;
		line-height: 1;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		opacity: 0.4;
		transition: opacity 200ms ease-out;
	}

	.prerelease-watermark.is-near {
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		/* Both states are kept — it still gets out of the way — but it snaps
		   rather than animating. */
		.prerelease-watermark {
			transition: none;
		}
	}
</style>
