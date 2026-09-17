<script lang="ts">
	/**
	 * The one filter box a panel puts above a list.
	 *
	 * Every view that has a list grew its own: a bare `<input class="input">`
	 * here, a hand-built icon row there, each with a different height, a
	 * different corner radius and its own idea of whether you can clear it.
	 * They are the first thing a person touches in a 400px sidebar, so they
	 * are worth having exactly once.
	 *
	 * Two things it deliberately does NOT do: debounce, and filter. It owns a
	 * string and nothing else — the view owns what the string means, because
	 * "filter" is a different query in every list and a shared component that
	 * guessed would be wrong in most of them.
	 */
	import * as Icons from "@lucide/svelte"
	import type { HTMLInputAttributes } from "svelte/elements"

	/**
	 * Everything an `<input>` takes is accepted and spread onto it —
	 * `data-lore-search` and the other per-view test/focus hooks, `onkeydown`,
	 * `disabled`. Spread FIRST in the markup, so nothing passed in can quietly
	 * replace the parts this component is responsible for.
	 */
	interface Props
		extends Omit<
			HTMLInputAttributes,
			"value" | "placeholder" | "aria-label" | "type"
		> {
		/** The current filter text. Bindable; the view owns what it means. */
		value?: string
		/**
		 * Without `count`, the whole placeholder ("Search everything").
		 *
		 * With `count`, the NOUN the list is made of — plural, lowercase
		 * ("characters", "lorebook entries") — which becomes "Filter 14
		 * characters". Phrased that way because the count is the useful part:
		 * it tells you how big the list is before you have scrolled it, and it
		 * disappears the moment you type, which is exactly when it stops
		 * mattering.
		 */
		placeholder: string
		/** How many items the unfiltered list holds. See `placeholder`. */
		count?: number
		/**
		 * Defaults to the placeholder the box is showing. Passed separately
		 * only when the visible text is too terse to stand alone as a name.
		 */
		"aria-label"?: string
		/** Forwarded to the `<input>`, for a label or a keyboard shortcut to aim at. */
		id?: string
	}

	let {
		value = $bindable(""),
		placeholder,
		count,
		"aria-label": ariaLabel,
		id,
		...rest
	}: Props = $props()

	const resolvedPlaceholder = $derived(
		count === undefined ? placeholder : `Filter ${count} ${placeholder}`
	)

	let inputEl = $state<HTMLInputElement | null>(null)

	function clear() {
		value = ""
		// Focus goes back to the box and not nowhere: the button it was on is
		// about to stop existing, and a focus left on a removed element falls
		// to <body>, losing the keyboard's place in the panel entirely.
		inputEl?.focus()
	}
</script>

<!-- The border, the radius and the focus ring live on the WRAPPER, not the
     input: the icon and the clear button are part of the same control, and a
     ring drawn around only the text would say otherwise. `focus-within` is
     what makes that honest — the ring appears whichever of the three has
     focus. -->
<div
	class="border-surface-300 bg-surface-100 dark:border-surface-800 dark:bg-surface-950 focus-within:ring-primary-500 relative flex h-10 w-full items-center gap-2 rounded-[10px] border px-2.5 focus-within:ring-2"
>
	<Icons.Search
		size={16}
		class="text-surface-500 shrink-0"
		aria-hidden="true"
	/>
	<!-- ⚠ `border-0 bg-transparent p-0` and `focus:ring-0` are not tidying.
	     @tailwindcss/forms styles a bare `[type="text"]` itself — a 1px
	     border, `border-radius: 0`, 0.5rem/0.75rem of padding, a white
	     background and, on focus, a hard-coded BLUE (#2563eb) ring that no
	     theme token reaches. Each of those has to be turned off explicitly or
	     it draws a second, square, blue control inside this one. -->
	<input
		{...rest}
		bind:this={inputEl}
		{id}
		type="text"
		class="text-foreground placeholder:text-surface-500 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm shadow-none outline-none focus:ring-0"
		placeholder={resolvedPlaceholder}
		aria-label={ariaLabel ?? resolvedPlaceholder}
		autocomplete="off"
		autocorrect="off"
		autocapitalize="off"
		spellcheck="false"
		bind:value
	/>
	{#if value}
		<!-- 32px of visible button, 44px of target on a touch screen. The
		     expansion is a `::before` overlay rather than a bigger button: the
		     control is only 40px tall, so a genuinely 44px box would either
		     stretch the row or be clipped by it. -->
		<button
			type="button"
			class="text-surface-500 hover:bg-surface-200 hover:text-foreground dark:hover:bg-surface-800 focus-visible:outline-primary-500 relative grid size-8 shrink-0 place-items-center rounded-md transition-colors before:absolute before:top-1/2 before:left-1/2 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:outline-2 pointer-coarse:before:size-11"
			title="Clear filter"
			aria-label="Clear filter"
			onclick={clear}
		>
			<Icons.X size={14} aria-hidden="true" />
		</button>
	{/if}
</div>
