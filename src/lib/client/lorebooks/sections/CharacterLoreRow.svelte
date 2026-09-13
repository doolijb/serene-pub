<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { substituteBindings } from "$lib/client/components/lorebookForms/entryManager"
	import { getCharacterLoreVisibility } from "$lib/shared/utils/characterLoreVisibility"
	import type { EntryRowProps } from "./types"
	import EntryMarks from "./EntryMarks.svelte"

	/**
	 * Character lore reads as its name plus who it is private to.
	 *
	 * The visibility badge is `shrink-0` and the name `flex-1` with a floor, so
	 * a long badge drops to its own line instead of squeezing the name down to
	 * three characters.
	 */
	let { item, source, bindings, vectorizationEnabled }: EntryRowProps =
		$props()

	let preview = $derived(substituteBindings(item.content, bindings))
	let visibility = $derived(
		getCharacterLoreVisibility(source.lorebookBindingId, bindings)
	)
	let needsAttention = $derived(
		visibility.kind === "orphaned" || visibility.kind === "unbound"
	)
</script>

<div
	class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold"
>
	<span class="min-w-[10ch] flex-1 truncate">{item.name}</span>
	<span
		class="shrink-0 text-xs font-normal"
		class:text-warning-500={needsAttention}
		class:text-tertiary-600-400={visibility.kind === "narrator"}
		class:text-surface-700-300={!needsAttention &&
			visibility.kind !== "narrator"}
		title={visibility.description}
	>
		{#if visibility.kind === "orphaned"}
			<Icons.AlertTriangle size={11} class="inline" />
		{:else if visibility.kind === "unbound"}
			<Icons.LockOpen size={11} class="inline" />
		{:else if visibility.kind === "narrator"}
			<Icons.Drama size={11} class="inline" />
		{:else}
			<Icons.Lock size={11} class="inline" />
		{/if}
		{visibility.label}
	</span>
</div>
{#if preview.trim()}
	<p
		class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
	>
		{preview}
	</p>
{:else}
	<p class="text-surface-700-300 text-xs italic">No content yet.</p>
{/if}
<div class="mt-1.5 flex flex-wrap items-center gap-1">
	<EntryMarks entry={source} {vectorizationEnabled} />
</div>
