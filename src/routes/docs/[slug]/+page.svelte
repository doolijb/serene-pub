<script lang="ts">
	import { getContext } from "svelte"
	import { page } from "$app/state"
	import { afterNavigate, goto } from "$app/navigation"
	import { getAllSections, getDoc, type DocSection } from "$lib/shared/utils/docsIndex"
	import DocResultsGrid from "$lib/client/components/docs/DocResultsGrid.svelte"
	import type { DocsSearchCtx } from "../+layout.svelte"

	const docsSearchCtx: DocsSearchCtx = getContext("docsSearchCtx")

	let doc = $derived(getDoc(page.params.slug ?? ""))

	$effect(() => {
		if (!doc) goto("/docs")
	})

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

	afterNavigate(() => {
		const hash = page.url.hash
		if (!hash) return
		const target = document.getElementById(hash.slice(1))
		target?.scrollIntoView({ behavior: "instant", block: "start" })
	})
</script>

<svelte:head>
	<title>{doc ? `${doc.title} — Documentation` : "Documentation"} — Serene Pub</title>
</svelte:head>

{#if doc}
	<div class="p-6">
		<article class="prose dark:prose-invert max-w-none">
			{@html doc.html}
		</article>
	</div>

	{#if docsSearchCtx.query.trim()}
		<div
			class="border-surface-300-700 preset-tonal absolute inset-x-0 top-0 z-20 border-b p-4 shadow-lg"
		>
			<DocResultsGrid sections={filteredSections} compact onSelect={selectSection} />
		</div>
	{/if}
{/if}
