<script lang="ts">
	/**
	 * The documentation as a full page.
	 *
	 * No search box: `/docs` is searched from Jump like everything else, where
	 * a heading is a `doc` hit and the scope chip reads *Documentation* for as
	 * long as this route is open (`shell/jump.svelte.ts`, `isDocsPath`).
	 * STYLE-GUIDE §6.9 — neither this page nor the Help view has one of its
	 * own, so there is one search over one index.
	 */
	import type { Snippet } from "svelte"
	import DocsHistoryControls from "$lib/client/components/docs/DocsHistoryControls.svelte"

	let { children }: { children?: Snippet } = $props()
</script>

<div
	class="preset-tonal mt-4 flex h-[calc(100%-2rem)] flex-col overflow-hidden rounded-lg shadow-md"
>
	<div
		class="border-surface-300-700 flex items-center justify-end gap-3 border-b p-4 lg:pr-[calc(var(--jump-pill-width,0px)+1.375rem)]"
	>
		<DocsHistoryControls />
	</div>
	<!-- @container/docs is what the "On this page" outline queries. The docs
	     read as a full page in main and as a sidebar view in the Help panel, and
	     those are the same width apart; the outline has to answer to the column
	     it is in, never to the window (STYLE-GUIDE §5.3). -->
	<div class="@container/docs relative flex-1 overflow-y-auto">
		{@render children?.()}
	</div>
</div>
