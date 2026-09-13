<script lang="ts">
	import { substituteBindings } from "$lib/client/components/lorebookForms/entryManager"
	import type { EntryRowProps } from "./types"
	import EntryMarks from "./EntryMarks.svelte"

	/** World lore reads as its name over the first lines of what it says. */
	let { item, source, bindings, vectorizationEnabled }: EntryRowProps =
		$props()

	let preview = $derived(substituteBindings(item.content, bindings))
</script>

<div class="mb-1 truncate text-sm font-semibold">{item.name}</div>
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
