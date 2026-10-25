<script lang="ts">
	import type { EntryRowProps } from "./types"
	import { kindLabel } from "./kinds"
	import { getBookData } from "../bookData.svelte"

	/**
	 * 🚧 A piece of the book's rules library as a row of the list (§C, ruling
	 * 10): its name, its list, and the *‹Rules› library* badge that says it
	 * is the rules' piece, shown under the book — read only until **Edit a
	 * copy** makes it the book's own. No row menu: there is nothing of the
	 * book's to change on it.
	 */
	let { item }: EntryRowProps = $props()

	const book = getBookData()
	let libraryName = $derived(book.library?.name ?? "Rules library")
</script>

<div class="mb-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
	<span class="min-w-[10ch] flex-1 truncate">{item.name}</span>
	<span class="badge preset-tonal-surface shrink-0 text-meta">
		{kindLabel(item.kind)}
	</span>
	<span
		class="badge preset-tonal-surface shrink-0 text-meta"
		data-library-badge
	>
		{libraryName}
	</span>
</div>
{#if item.content.trim()}
	<p
		class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
	>
		{item.content}
	</p>
{/if}
