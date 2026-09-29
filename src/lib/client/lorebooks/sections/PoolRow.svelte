<script lang="ts">
	import type { EntryRowProps } from "./types"
	import { kindLabel } from "./kinds"

	/**
	 * The row a kind nobody has curated falls back to.
	 *
	 * It is a bootstrap and it looks like one: a name, a kind badge and the
	 * first lines of the content, with none of the state a curated row knows
	 * how to read. Every kind this build ships has a door of its own, so
	 * reaching this row means a new one needs writing.
	 */
	let { item }: EntryRowProps = $props()
</script>

<div class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
	<span class="min-w-[10ch] flex-1 truncate">{item.name}</span>
	<span class="badge preset-tonal-surface shrink-0 text-[11px]">
		{kindLabel(item.kind)}
	</span>
</div>
{#if item.content.trim()}
	<p
		class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
	>
		{item.content}
	</p>
{:else}
	<p class="text-surface-700-300 text-xs italic">No content yet.</p>
{/if}
