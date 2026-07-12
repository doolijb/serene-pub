<script lang="ts">
	import { getContext } from "svelte"
	import { goto } from "$app/navigation"
	import { docsIndex, getAllSections, type DocSection } from "$lib/shared/utils/docsIndex"
	import DocResultsGrid from "$lib/client/components/docs/DocResultsGrid.svelte"
	import type { DocsSearchCtx } from "./+layout.svelte"

	const docsSearchCtx: DocsSearchCtx = getContext("docsSearchCtx")

	let filteredSections = $derived.by(() => {
		const query = docsSearchCtx.query.trim().toLowerCase()
		if (!query) return []
		return getAllSections().filter(
			(section) =>
				section.title.toLowerCase().includes(query) ||
				section.preview.toLowerCase().includes(query)
		)
	})

	function selectSection(section: DocSection) {
		docsSearchCtx.query = ""
		goto(section.anchor ? `/docs/${section.slug}#${section.anchor}` : `/docs/${section.slug}`)
	}
</script>

<svelte:head>
	<title>Documentation — Serene Pub</title>
</svelte:head>

<div class="p-6">
	{#if docsSearchCtx.query.trim()}
		<DocResultsGrid sections={filteredSections} onSelect={selectSection} />
	{:else}
		<h1 class="h1 mb-6 font-semibold">Documentation</h1>
		<div class="grid grid-cols-1 gap-2">
			{#each docsIndex as doc}
				<button
					type="button"
					class="card preset-filled-surface-400-600 flex w-full items-start gap-4 p-4 text-left transition-colors"
					onclick={() => goto(`/docs/${doc.slug}`)}
				>
					<div class="min-w-0 flex-1">
						<h5 class="h5 font-semibold">{doc.title}</h5>
						{#if doc.description}
							<p class="mt-1 text-sm opacity-80">
								{doc.description}
							</p>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
