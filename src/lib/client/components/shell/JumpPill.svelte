<script lang="ts">
	/**
	 * The **Jump pill** — the always-there way in, for people who do not know
	 * there is a keystroke.
	 *
	 * It names the scope rather than the feature, so the one thing on screen
	 * saying "Search Characters" is the thing that will search characters. It
	 * hides while the overlay is up: the overlay's own input is the same
	 * control, and two of them on screen at once is one too many.
	 *
	 * z-46 — above the shell (z-10) and the mobile sheets (40/45), strictly
	 * below the modal layer (z-50) every dialog in this app portals to. See the
	 * note on the sidebar in Layout.svelte for what happens above z-50.
	 */
	import * as Icons from "@lucide/svelte"
	import type { JumpCtx } from "$lib/client/shell/jump.svelte"

	interface Props {
		jumpCtx: JumpCtx
	}

	let { jumpCtx }: Props = $props()

	/**
	 * `navigator.platform` is deprecated and still the only thing that answers
	 * this without a user-agent library. Wrong answers cost a wrong glyph in a
	 * hint, not behaviour: the handler takes either modifier regardless.
	 */
	const isMac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad|ipod/i.test(navigator.platform || "")

	const hint = isMac ? "⌘K" : "Ctrl K"
	const label = $derived(
		jumpCtx.scope.key === null
			? "Jump to anything"
			: `Search ${jumpCtx.scope.label}`
	)
</script>

{#if !jumpCtx.isOpen}
	<button
		type="button"
		class="bg-surface-950/90 border-surface-800 text-surface-400 hover:text-surface-50 hover:border-surface-700 focus-visible:outline-primary-500 fixed top-2 right-4 z-[46] flex h-[34px] w-[34px] items-center justify-center gap-2 rounded-lg border text-sm backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 lg:w-auto lg:justify-start lg:px-2.5"
		title="{label} ({hint})"
		aria-label="{label} ({hint})"
		aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
		onclick={() => jumpCtx.open()}
	>
		<Icons.Search class="size-4 shrink-0" aria-hidden="true" />
		<!-- Icon-only below `lg`: at phone width the bottom bar is already
		     carrying the names, and a pill wide enough for one more would sit
		     across the page header. -->
		<span class="hidden lg:inline">{label}</span>
		<kbd
			class="border-surface-800 text-surface-500 hidden rounded border px-1 py-px font-mono text-[11px] lg:inline"
		>
			{hint}
		</kbd>
	</button>
{/if}
