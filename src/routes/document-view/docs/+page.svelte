<script lang="ts">
	import {
		docsManifest,
		loadSearchIndex,
		type DocSection
	} from "$lib/shared/utils/docsIndex"

	let query = $state("")
	let sections = $state<DocSection[]>([])
	let requested = false

	// Same bargain as the standard site: the search index is every heading and
	// its opening prose, fetched on the first keystroke rather than shipped to
	// a reader who only wanted one page.
	$effect(() => {
		if (!query.trim() || requested) return
		requested = true
		loadSearchIndex().then((entries) => (sections = entries))
	})

	let groups = $derived(
		docsManifest.nav.map((group) => ({
			...group,
			meta: docsManifest.sources[group.source],
			pages: group.pages
				.map((slug) => docsManifest.pages[slug])
				.filter((page) => !!page)
		}))
	)

	let matchingSections = $derived.by((): DocSection[] => {
		const q = query.trim().toLowerCase()
		if (!q) return []
		return sections.filter(
			(s) =>
				s.title.toLowerCase().includes(q) ||
				s.preview.toLowerCase().includes(q)
		)
	})

	let matchingPages = $derived.by(() => {
		const q = query.trim().toLowerCase()
		return groups
			.map((group) => ({
				...group,
				pages: q
					? group.pages.filter(
							(p) =>
								p.title.toLowerCase().includes(q) ||
								p.description.toLowerCase().includes(q)
						)
					: group.pages
			}))
			.filter((group) => group.pages.length > 0)
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

{#if matchingPages.length === 0}
	<h2>All Pages</h2>
	<p>No documentation pages matched "{query}".</p>
{:else}
	{#each matchingPages as group (group.source)}
		<h2>{group.group}</h2>
		{#if group.meta?.banner}
			<p>
				<strong>Note:</strong>
				{group.meta.banner}
			</p>
		{/if}
		<ul class="a11y-list">
			{#each group.pages as page (page.slug)}
				<li class="a11y-list-item">
					<a href="/document-view/docs/{page.slug}">{page.title}</a>
					{#if page.description}<p>{page.description}</p>{/if}
				</li>
			{/each}
		</ul>
	{/each}
{/if}
