<script lang="ts">
	import { goto } from "$app/navigation"
	import { docsManifest } from "$lib/shared/utils/docsIndex"
	import DocResultCard from "$lib/client/components/docs/DocResultCard.svelte"

	/**
	 * The nav as the compiler wrote it: groups in reading order, pages in order
	 * within each group, each group carrying whatever its source declared.
	 * Nothing here decides an order — that lives in scripts/build-docs.js and
	 * in the compiler, so both this page and serenepub.com list the same thing.
	 */
	let groups = $derived(
		docsManifest.nav.map((group) => ({
			...group,
			meta: docsManifest.sources[group.source],
			pages: group.pages
				.map((slug) => docsManifest.pages[slug])
				.filter((page) => !!page)
		}))
	)
</script>

<svelte:head>
	<title>Documentation — Serene Pub</title>
</svelte:head>

<div class="p-6">
	<h1 class="h1 mb-6 font-semibold">Documentation</h1>
	<div class="space-y-8">
		{#each groups as group (group.source)}
			<section class="space-y-3">
				<div class="flex items-center gap-3">
					<h2 class="h4 font-semibold">{group.group}</h2>
					{#if group.source !== "app"}
						<!-- Reference pages are rendered from the SDK's own
						     declarations, not written by anyone. Marking the
						     group says so before a reader opens a page and
						     wonders why it reads like a spec. -->
						<span
							class="badge preset-tonal-tertiary text-xs uppercase"
						>
							Reference
						</span>
					{/if}
				</div>
				{#if group.meta?.banner}
					<p class="doc-banner">{group.meta.banner}</p>
				{/if}
				<div class="grid grid-cols-1 gap-2">
					{#each group.pages as page (page.slug)}
						<DocResultCard
							title={page.title}
							preview={page.description}
							onclick={() => goto(`/docs/${page.slug}`)}
						/>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</div>
