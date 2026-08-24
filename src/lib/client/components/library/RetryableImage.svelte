<script lang="ts">
	import type { Snippet } from "svelte"

	interface Props {
		src: string
		alt: string
		class?: string
		loading?: "lazy" | "eager"
		/**
		 * Shown whenever there's no successfully-loaded image yet: before a
		 * lazy load's IntersectionObserver has fired, during the first
		 * attempt or any retry, and after retries are exhausted. The caller
		 * doesn't need to track which of those states it's in — this just
		 * renders in place of the image until/unless one succeeds.
		 */
		fallback?: Snippet
	}
	let {
		src,
		alt,
		class: className = "",
		loading = "eager",
		fallback
	}: Props = $props()

	const MAX_RETRIES = 3
	// Fallback delay only — used when a response carries no usable
	// Retry-After (502 never sends one; only 429 does). Escalates per
	// attempt (5s/10s/15s) since an unspecified delay is a weaker signal
	// than the server's own hint and warrants more caution on repeat
	// failures.
	const DEFAULT_RETRY_DELAY_MS = 5000

	// bind:this assigns before any $effect runs, so this is always populated
	// by the time it's read below — the `!` just tells TS what's already
	// true at runtime.
	let rootEl!: HTMLDivElement
	let objectUrl = $state<string | null>(null)

	$effect(() => {
		const requestedSrc = src
		const eager = loading !== "lazy"
		let cancelled = false
		let liveObjectUrl: string | null = null
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		let controller: AbortController | undefined
		let observer: IntersectionObserver | undefined
		objectUrl = null

		function scheduleRetry(nextAttempt: number, delayMs: number) {
			timeoutId = setTimeout(() => {
				if (!cancelled) void attempt(nextAttempt)
			}, delayMs)
		}

		async function attempt(attemptNum: number) {
			controller = new AbortController()
			try {
				const response = await fetch(requestedSrc, {
					signal: controller.signal
				})
				if (cancelled) return

				if (response.ok) {
					const blob = await response.blob()
					if (cancelled) return
					liveObjectUrl = URL.createObjectURL(blob)
					objectUrl = liveObjectUrl
					return
				}

				// Only 429 (rate limited) and 502 (this route's own upstream
				// timeout/failure) are confirmed-transient. A 400/404/other
				// means the reference itself is bad — retrying would just
				// spend more shared rate-limit budget re-learning the same
				// permanent answer.
				const isTransient =
					response.status === 429 || response.status === 502
				if (!isTransient || attemptNum >= MAX_RETRIES) return

				const retryAfterHeader = response.headers.get("Retry-After")
				const retryAfterSeconds = retryAfterHeader
					? Number(retryAfterHeader)
					: NaN
				if (
					Number.isFinite(retryAfterSeconds) &&
					retryAfterSeconds > 0
				) {
					// Server-hinted delay — jitter must never undercut it:
					// retrying before the window the server actually asked
					// for just re-attempts into the same congestion it told
					// us to wait out. Only ever add up to 50% on top, never
					// subtract.
					const delayMs =
						retryAfterSeconds * 1000 * (1 + Math.random() * 0.5)
					scheduleRetry(attemptNum + 1, delayMs)
				} else {
					// No usable hint (502 typically sends none) — nothing to
					// undercut, so symmetric jitter is fine here. Spreads a
					// cold grid's simultaneous failures into a trickle
					// instead of retrying them all in lockstep waves.
					const baseDelay = DEFAULT_RETRY_DELAY_MS * (attemptNum + 1)
					scheduleRetry(
						attemptNum + 1,
						baseDelay * (0.5 + Math.random())
					)
				}
			} catch {
				// Covers both a genuine network failure AND this attempt's
				// own fetch/blob-read being aborted by teardown below — in
				// the latter case cancelled is already true, so this just
				// exits without scheduling a pointless retry timer.
				if (cancelled) return
				if (attemptNum < MAX_RETRIES) {
					const baseDelay = DEFAULT_RETRY_DELAY_MS * (attemptNum + 1)
					scheduleRetry(
						attemptNum + 1,
						baseDelay * (0.5 + Math.random())
					)
				}
			}
		}

		if (eager) {
			void attempt(0)
		} else {
			// Mirrors native loading="lazy": don't spend a shared rate-limit
			// slot on a thumbnail that isn't scrolled near the viewport yet.
			// rootMargin gives it a small head start, similar to the
			// browser's own heuristic. Observes rootEl's PARENT, not rootEl
			// itself — rootEl is display:contents (see below), which
			// generates no box, so getBoundingClientRect() on it is a
			// zero-area rect that IntersectionObserver treats as always
			// intersecting, firing for every card immediately regardless of
			// scroll position. The parent is the card's real, boxed layout
			// slot — observing it is what makes this actually gate on
			// visibility instead of silently no-op-ing into "fetch
			// everything at mount" again. Don't "simplify" this back to
			// observing rootEl directly.
			observer = new IntersectionObserver(
				(entries) => {
					if (entries[0]?.isIntersecting) {
						observer?.disconnect()
						void attempt(0)
					}
				},
				{ rootMargin: "200px" }
			)
			observer.observe(rootEl.parentElement ?? rootEl)
		}

		return () => {
			cancelled = true
			observer?.disconnect()
			controller?.abort()
			clearTimeout(timeoutId)
			if (liveObjectUrl) URL.revokeObjectURL(liveObjectUrl)
		}
	})
</script>

<div bind:this={rootEl} class="contents">
	{#if objectUrl}
		<img src={objectUrl} {alt} class={className} />
	{:else if fallback}
		{@render fallback()}
	{/if}
</div>
