<script lang="ts">
	import { substituteBindings } from "$lib/client/components/lorebookForms/entryManager"
	import type { EntryRowProps } from "./types"
	import EntryMarks from "./EntryMarks.svelte"
	import { supplySummary } from "./itemSupply"

	/** 🚧 An item reads as world lore does, with its supply beside the name when it has one. */
	let { item, source, bindings, vectorizationEnabled }: EntryRowProps = $props()

	let preview = $derived(substituteBindings(item.content, bindings))
	let supply = $derived(supplySummary(source))
</script>

<div class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
	<span class="min-w-[10ch] flex-1 truncate">{item.name}</span>
	{#if supply}
		<span class="badge preset-tonal-surface shrink-0 text-[11px]">{supply}</span>
	{/if}
</div>
{#if preview.trim()}
	<p class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap">
		{preview}
	</p>
{:else}
	<p class="text-surface-700-300 text-xs italic">No content yet.</p>
{/if}
<div class="mt-1.5 flex flex-wrap items-center gap-1">
	<EntryMarks entry={source} {vectorizationEnabled} />
</div>
