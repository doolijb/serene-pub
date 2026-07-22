<script lang="ts">
	import { page } from "$app/state"
	import { goto, afterNavigate } from "$app/navigation"
	import { getDoc } from "$lib/shared/utils/docsIndex"

	let doc = $derived(getDoc(page.params.slug ?? ""))

	$effect(() => {
		if (!doc) goto("/document-view/docs")
	})

	// docsIndex's renderer rewrites relative doc links (eg. "./chats.md") to
	// the standard site's /docs/{slug} route, since it's shared with the
	// standard docs viewer. Rewritten again here so following a link inside a
	// doc stays in Document View instead of dropping the reader onto the
	// standard site mid-read.
	let html = $derived(
		doc
			? doc.html.replaceAll('href="/docs/', 'href="/document-view/docs/')
			: ""
	)

	afterNavigate(() => {
		const hash = page.url.hash
		if (!hash) return
		const target = document.getElementById(hash.slice(1))
		target?.scrollIntoView({ behavior: "instant", block: "start" })
	})
</script>

<svelte:head>
	<title>
		{doc ? `${doc.title} — Documentation` : "Documentation"} — Document View
		— Serene Pub
	</title>
</svelte:head>

{#if doc}
	<p><a href="/document-view/docs">← All Documentation</a></p>
	<div class="a11y-doc-content">
		{@html html}
	</div>
	<p><a href="/document-view/docs">← All Documentation</a></p>
{/if}
