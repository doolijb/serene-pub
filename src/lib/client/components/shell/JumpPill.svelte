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
	 * z-44 — above the shell (z-10) and the mobile sheets (z-40), strictly
	 * below the sidebar / full-page view (z-45, see Layout.svelte) and the
	 * modal layer (z-50) every dialog in this app portals to. It sits under
	 * an open sidebar or full-page view; the shortcut is the way in while
	 * one is open.
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

	/**
	 * How wide the pill is drawing itself, published to the document as
	 * `--jump-pill-width` so a surface whose own controls reach this corner can
	 * keep clear of it — today that is a sidebar view in full page, whose 56px
	 * header row IS the band the pill sits in (STYLE-GUIDE §4.2, §6.8).
	 *
	 * Measured and not a constant: the label names the scope, so the same pill
	 * is 190px over Admin and 247px over Documentation, and the base face it is
	 * set in is the theme's — which a custom theme may change. `offsetWidth`
	 * rather than `clientWidth` because the 1px border is part of what has to
	 * be cleared.
	 */
	let pillWidth = $state(0)

	$effect(() => {
		// On the document element rather than passed as a prop: the header that
		// spends this is in another subtree entirely (Layout.svelte's sidebar
		// chrome) and the pill is a leaf, so a custom property is the one seam
		// that reaches it without a store.
		//
		// Never written back to zero. The pill unmounts while the overlay is
		// up, and a reserve that collapsed and grew again around that would
		// shift the header underneath the overlay and back.
		if (pillWidth > 0)
			document.documentElement.style.setProperty(
				"--jump-pill-width",
				`${pillWidth}px`
			)
	})
</script>

{#if !jumpCtx.isOpen}
	<button
		type="button"
		bind:offsetWidth={pillWidth}
		class="bg-surface-950/90 border-surface-800 text-surface-400 hover:text-surface-50 hover:border-surface-700 focus-visible:outline-primary-500 fixed top-2 right-4 z-[44] flex h-[34px] w-[34px] items-center justify-center gap-2 rounded-lg border text-sm backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 lg:w-auto lg:justify-start lg:px-2.5"
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
