<script lang="ts">
	import {
		docsIndex,
		getAllSections,
		type DocSection
	} from "$lib/shared/utils/docsIndex"

	let query = $state("")

	let filteredDocs = $derived.by(() => {
		const q = query.trim().toLowerCase()
		if (!q) return docsIndex
		return docsIndex.filter(
			(d) =>
				d.title.toLowerCase().includes(q) ||
				d.description.toLowerCase().includes(q)
		)
	})

	let matchingSections = $derived.by((): DocSection[] => {
		const q = query.trim().toLowerCase()
		if (!q) return []
		return getAllSections().filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.preview.toLowerCase().includes(q)
		)
	})
</script>

<svelte:head>
	<title>Documentation — Document View — Serene Pub</title>
</svelte:head>

<h1>Documentation</h1>
<p>
	Search or browse the same guides available on the standard site, reflowed
	for Document View.
</p>

<div class="a11y-field">
	<label for="a11y-docs-search">Search documentation</label>
	<input
		id="a11y-docs-search"
		type="search"
		bind:value={query}
		placeholder="e.g. lorebooks, connections, tags"
	/>
</div>

{#if query.trim()}
	<h2>Matching Sections</h2>
	{#if matchingSections.length === 0}
		<p>No sections matched "{query}".</p>
	{:else}
		<ul class="a11y-list">
			{#each matchingSections as section (section.slug + "#" + section.anchor)}
				<li class="a11y-list-item">
					<a
						href="/document-view/docs/{section.slug}#{section.anchor}"
					>
						{section.title}
					</a>
					{#if section.preview}<p>{section.preview}</p>{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<h2>All Pages</h2>
{#if filteredDocs.length === 0}
	<p>No documentation pages matched "{query}".</p>
{:else}
	<ul class="a11y-list">
		{#each filteredDocs as doc (doc.slug)}
			<li class="a11y-list-item">
				<a href="/document-view/docs/{doc.slug}">{doc.title}</a>
				{#if doc.description}<p>{doc.description}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}
