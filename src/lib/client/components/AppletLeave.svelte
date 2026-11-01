<script lang="ts">
	/**
	 * 🚧 M2c: the applet launcher's way out, top left (z 44). It wears
	 * `FullscreenExit`'s parts and sleeps on its rule (ruled 2026-10-31): awake
	 * it is a small pill, "Leave" + Esc; after 2 s with no pointer and no focus
	 * it slides up until a 6 px edge is left, and returns on hover, touch or
	 * focus — so it does not sit over the game's own top-left corner.
	 */
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** The applet's title, for the control's accessible name. */
		title: string
		onLeave: () => void
	}

	let { title, onLeave }: Props = $props()

	const IDLE_MS = 2000

	let pointerOver = $state(false)
	let focusWithin = $state(false)
	let idle = $state(false)

	const asleep = $derived(idle && !pointerOver && !focusWithin)

	// Sleep timer: restarts whenever something keeps the control awake.
	$effect(() => {
		if (pointerOver || focusWithin) {
			idle = false
			return
		}
		const t = setTimeout(() => (idle = true), IDLE_MS)
		return () => clearTimeout(t)
	})
</script>

<div
	class="applet-leave data-[asleep]:pointer-events-none fixed top-0 left-4 z-[44] flex flex-col items-start"
	data-asleep={asleep ? "" : undefined}
	role="presentation"
	onpointerenter={() => (pointerOver = true)}
	onpointerleave={() => (pointerOver = false)}
	ontouchstart={() => (pointerOver = true)}
	onfocusin={() => (focusWithin = true)}
	onfocusout={(e) => {
		const next = e.relatedTarget as Node | null
		if (!next || !e.currentTarget.contains(next)) focusWithin = false
	}}
>
	<div
		class="applet-leave-body pt-2 transition-[transform,opacity] duration-[160ms] motion-reduce:transition-none"
	>
		<div
			class="bg-surface-50-950/90 border-surface-200-800 flex h-[34px] items-center rounded-full border px-3 backdrop-blur"
		>
			<button
				type="button"
				class="text-surface-700-300 hover:text-surface-950-50 focus-visible:outline-primary-500 flex items-center gap-2 text-chip focus-visible:outline-2"
				aria-label="Leave {title}"
				onclick={onLeave}
			>
				<Icons.ArrowLeft size={14} aria-hidden="true" />
				Leave
				<kbd
					class="bg-surface-200-800 text-surface-800-200 rounded-md px-1.5 py-0.5 font-mono text-meta"
				>
					Esc
				</kbd>
			</button>
		</div>
	</div>
	<!-- The wake area: the pill's width by 24px (44px on touch) at the top
	     edge, still there while the pill is slid away. -->
	<div
		class="pointer-events-auto pointer-coarse:h-11 absolute top-0 right-0 left-0 h-6"
		aria-hidden="true"
		style:z-index="-1"
	></div>
</div>

<style>
	.applet-leave-body {
		transform: translateY(0);
		opacity: 1;
	}
	.applet-leave[data-asleep] .applet-leave-body {
		transform: translateY(calc(-100% + 6px));
		opacity: 0.6;
	}
</style>
