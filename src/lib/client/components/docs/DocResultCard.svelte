<script lang="ts">
	import * as Icons from "@lucide/svelte"

	/**
	 * One card in a docs list — a whole page on the index, a matched section in
	 * search results.
	 *
	 * Takes the strings rather than a `DocSection`, because the index lists
	 * pages and a page is not a section: passing one would have meant inventing
	 * a section with an empty anchor for every card on the index, which is a
	 * shape nothing else in the app produces and the search code would then
	 * have had to tolerate.
	 */
	let {
		title,
		preview = "",
		depth = 1,
		onclick
	}: {
		title: string
		preview?: string
		/** 1 for a whole page, deeper for a section within one. */
		depth?: number
		onclick: () => void
	} = $props()
</script>

<button
	type="button"
	class="card preset-filled-surface-400-600 flex w-full items-start gap-4 p-4 text-left transition-colors"
	{onclick}
>
	<div
		class="bg-surface-500/20 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
	>
		{#if depth <= 1}
			<Icons.BookOpen class="h-5 w-5 opacity-90" />
		{:else}
			<Icons.FileText class="h-5 w-5 opacity-90" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<h5 class="h5 truncate font-semibold">{title}</h5>
		{#if preview}
			<p class="mt-1 text-sm opacity-80">
				{preview}
			</p>
		{/if}
	</div>
	<Icons.ChevronRight class="h-5 w-5 flex-shrink-0 opacity-90" />
</button>
