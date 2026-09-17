<script lang="ts">
	import { page } from "$app/state"
	import { afterNavigate } from "$app/navigation"
	import type { PageData } from "./$types"

	let { data }: { data: PageData } = $props()

	afterNavigate(() => {
		const hash = page.url.hash
		if (!hash) return
		const target = document.getElementById(hash.slice(1))
		target?.scrollIntoView({ behavior: "instant", block: "start" })
	})
</script>

<svelte:head>
	<title>
		{data.meta.title} — Documentation — Document View — Serene Pub
	</title>
</svelte:head>

<p><a href="/document-view/docs">← All Documentation</a></p>
<div class="a11y-doc-content">
	{@html data.html}
</div>
<p><a href="/document-view/docs">← All Documentation</a></p>
