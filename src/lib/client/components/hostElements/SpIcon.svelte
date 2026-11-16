<script lang="ts">
	/** `sp-icon` — an icon from the app's set by kebab-case name; decorative without a label. */
	import { declaredIconOf } from "$lib/client/components/icons/declaredIcon.svelte"
	import DeclaredIconPlaceholder from "$lib/client/components/icons/DeclaredIconPlaceholder.svelte"
	import type { SpElementProps } from "./spElement.svelte"

	let { attrs, host }: SpElementProps = $props()
	const pascal = (name: string) =>
		name
			.split("-")
			.filter(Boolean)
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join("")
	// Curated names answer at once; any other lucide name loads lazily behind
	// a same-size placeholder, and an unknown name keeps that box (★P15).
	const Icon = $derived(
		attrs.name ? declaredIconOf(pascal(attrs.name), DeclaredIconPlaceholder) : undefined
	)
	// Pixels, or a CSS length that scales with the text (`0.75em`).
	const size = $derived(
		Number(attrs.size) > 0
			? Number(attrs.size)
			: attrs.size && /^\d*\.?\d+(em|rem|px)$/.test(attrs.size)
				? attrs.size
				: 16
	)
	// The element's box is the icon's size (the base skin reads it); a context
	// that sizes its icons (a button) overrides the box, and the svg fills it.
	$effect(() => {
		host.style.setProperty("--sp-icon-size", typeof size === "number" ? `${size}px` : size)
	})
</script>

{#if Icon}
	{#if attrs.label}
		<Icon {size} role="img" aria-label={attrs.label} />
	{:else}
		<Icon {size} aria-hidden="true" />
	{/if}
{/if}
