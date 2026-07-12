<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { DocSection } from "$lib/shared/utils/docsIndex"

	let {
		section,
		onclick
	}: {
		section: DocSection
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
		{#if section.depth <= 1}
			<Icons.BookOpen class="h-5 w-5 opacity-90" />
		{:else}
			<Icons.FileText class="h-5 w-5 opacity-90" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<h5 class="h5 truncate font-semibold">{section.title}</h5>
		{#if section.preview}
			<p class="mt-1 text-sm opacity-80">
				{section.preview}
			</p>
		{/if}
	</div>
	<Icons.ChevronRight class="h-5 w-5 flex-shrink-0 opacity-90" />
</button>
