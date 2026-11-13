<script lang="ts" module>
	/** After this long without `ready` the words change; the screen does not end. */
	export const STILL_LOADING_MS = 20_000
</script>

<script lang="ts">
	/**
	 * 🚧 M2d: the applet loading screen. A layer over an applet's frame from
	 * mount until the frame says `ready` — the poster dimmed as a backdrop
	 * (the ground without one), the logo or title centred, an indeterminate
	 * bar and _Loading <title>…_. Its parent is positioned.
	 *
	 * Deterministic (P1): the layer ends on `ready` and on nothing else. The
	 * 20 s timer changes the words (_Still loading…_) and never ends it. A
	 * `fatal` frame ends the loading part and leaves the HOST's sentence
	 * (`FRAME_FATAL_SENTENCE`, never the frame's own words) and, when the
	 * launcher gave `onLeave`, a Leave button.
	 *
	 * It never traps focus, autofocuses or touches a key, so Esc and the
	 * launcher's own Leave (z 44) work throughout; its z stays below that.
	 */
	import { fade } from "svelte/transition"
	import { MOTION, motionDuration } from "$lib/client/utils/motion"
	import SpProgress from "./hostElements/SpProgress.svelte"
	import { FRAME_FATAL_SENTENCE } from "./frames/frameFatal"

	interface Props {
		/** The applet's title: the words beside the bar, and the centred name when there is no logo. */
		title: string
		/** A full-cover backdrop, dimmed. */
		poster?: string
		/** A square mark, centred instead of the title text. */
		logo?: string
		/** The frame said `ready`: the layer leaves. */
		ready: boolean
		/** The frame reported a `fatal` error. */
		fatal: boolean
		/** Shows a Leave button beside the fatal sentence. */
		onLeave?: () => void
	}

	let { title, poster, logo, ready, fatal, onLeave }: Props = $props()

	let stillLoading = $state(false)
	$effect(() => {
		const t = setTimeout(() => (stillLoading = true), STILL_LOADING_MS)
		return () => clearTimeout(t)
	})
</script>

{#if !ready}
	<div
		class="bg-surface-100-900 absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 p-4 text-center"
		out:fade={{ duration: motionDuration(MOTION.slow) }}
	>
		{#if poster}
			<img
				src={poster}
				alt=""
				class="absolute inset-0 h-full w-full object-cover"
			/>
			<div class="bg-surface-50-950/70 absolute inset-0"></div>
		{/if}
		<div class="relative flex flex-col items-center gap-4">
			{#if logo}
				<img
					src={logo}
					alt=""
					class="rounded-container size-14 object-cover"
				/>
			{:else}
				<p
					data-applet-loading-title
					class="[font-family:var(--typo-heading--font-family)] text-[20px] leading-tight font-semibold tracking-[-0.01em]"
				>
					{title}
				</p>
			{/if}
			{#if fatal}
				<!-- Not an alert: `PluginFrame`'s own fatal notice under this screen already announces the sentence. -->
				<p
					data-applet-loading-fatal
					class="text-surface-700-300 max-w-xs text-sm"
				>
					{FRAME_FATAL_SENTENCE}
				</p>
				{#if onLeave}
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={onLeave}
					>
						Leave
					</button>
				{/if}
			{:else}
				<div class="text-primary-500 w-48">
					<SpProgress
						attrs={{ value: null, label: `Loading ${title}` }}
					/>
				</div>
				<p role="status" class="text-surface-600-400 text-sm">
					{stillLoading ? "Still loading…" : `Loading ${title}…`}
				</p>
			{/if}
		</div>
	</div>
{/if}
