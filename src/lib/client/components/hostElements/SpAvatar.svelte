<script lang="ts">
	/** `sp-avatar` — a participant's avatar, by reference; the page supplies the lookup. */
	import type { SpElementProps } from "./spElement.svelte"
	import { hostElementContext } from "./context.svelte"

	let { attrs }: SpElementProps = $props()
	const who = $derived(attrs.ref ? (hostElementContext.participant?.(attrs.ref) ?? null) : null)
	const size = $derived(attrs.size === "sm" ? "1.5rem" : attrs.size === "lg" ? "3rem" : "2rem")
	const initial = $derived((who?.name ?? "?").trim().slice(0, 1).toUpperCase() || "?")
</script>

<span
	class="sp-avatar-frame"
	role="img"
	aria-label={who?.name ?? "Avatar"}
	style:display="inline-grid"
	style:place-items="center"
	style:overflow="hidden"
	style:inline-size={size}
	style:block-size={size}
>
	{#if who?.avatarUrl}
		<img class="sp-avatar-image" src={who.avatarUrl} alt="" style="inline-size:100%;block-size:100%;object-fit:cover" />
	{:else}
		<span class="sp-avatar-fallback" aria-hidden="true">{initial}</span>
	{/if}
</span>
