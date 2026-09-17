<script lang="ts">
	import { page } from "$app/state"
	import { afterNavigate } from "$app/navigation"
	import DocPageOutline from "$lib/client/components/docs/DocPageOutline.svelte"
	import {
		docsPlayground,
		documentTheme
	} from "$lib/client/components/docs/docsPlayground"
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
	<title>{data.meta.title} — Documentation — Serene Pub</title>
</svelte:head>

<div
	class="grid grid-cols-1 items-start gap-0 p-6 @min-[48rem]/docs:grid-cols-[minmax(0,1fr)_14rem] @min-[48rem]/docs:gap-8"
>
	<!-- The compiler emits the article body only, already link-rewritten and
	     anchored; `prose` styles the markdown and docs.css styles the dialect
	     the compiler adds on top of it (admonitions, figures, shiki). -->
	<!-- The playground upgrade is attached rather than declared: nothing inside
	     the injected body is (or can be) a component. It adds a button to every
	     playground block and loads nothing until one is pressed. -->
	<article
		class="docs-article prose dark:prose-invert max-w-none"
		use:docsPlayground={{ theme: documentTheme }}
	>
		{@html data.html}
	</article>
	<DocPageOutline headings={data.meta.headings} />
</div>
