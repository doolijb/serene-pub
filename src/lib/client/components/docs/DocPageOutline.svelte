<script lang="ts">
	import type { DocsHeading } from "$lib/shared/utils/docsIndex"

	let { headings }: { headings: DocsHeading[] } = $props()

	/**
	 * Depth 2 and 3 only. Depth 1 is the page's own title, which is already the
	 * first thing on the page, and depth 4 and below are the recovery
	 * procedures in troubleshooting.md — a list long enough to need its own
	 * scrollbar stops being an overview of the page.
	 */
	let entries = $derived(headings.filter((h) => h.depth >= 2 && h.depth <= 3))
</script>

<!-- Shown only where there is a column to spare, and only when there is enough
     structure to be worth showing: one heading is not an outline. The query is
     on the docs container rather than the viewport, because the same page is
     read full-width in main and in the narrow Help panel (STYLE-GUIDE §5.3). -->
{#if entries.length > 1}
	<nav
		aria-label="On this page"
		class="sticky top-0 hidden min-w-0 self-start py-1 [overflow-wrap:anywhere] @min-[48rem]/docs:block"
	>
		<p
			class="text-surface-600-400 mb-2 text-xs font-medium"
		>
			On this page
		</p>
		<ul class="border-surface-300-700 space-y-1 border-l">
			{#each entries as heading (heading.id)}
				<li>
					<a
						href="#{heading.id}"
						class="text-surface-700-300 hover:text-surface-900-100 hover:border-primary-500 -ml-px block border-l border-transparent py-1 text-sm leading-snug transition-colors"
						class:pl-3={heading.depth === 2}
						class:pl-6={heading.depth === 3}
					>
						{heading.text}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
{/if}
