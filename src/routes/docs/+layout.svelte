<script lang="ts" module>
	export class DocsSearchCtx {
		query = $state("")
	}
</script>

<script lang="ts">
	import { setContext } from "svelte"
	import type { Snippet } from "svelte"
	import DocsSearchBar from "$lib/client/components/docs/DocsSearchBar.svelte"
	import DocsHistoryControls from "$lib/client/components/docs/DocsHistoryControls.svelte"

	let { children }: { children?: Snippet } = $props()

	const docsSearchCtx = new DocsSearchCtx()
	setContext("docsSearchCtx", docsSearchCtx)
</script>

<div
	class="container mx-auto mt-4 mb-4 flex h-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden rounded-lg preset-tonal shadow-md"
>
	<div class="border-surface-300-700 flex items-center gap-3 border-b p-4">
		<DocsSearchBar bind:query={docsSearchCtx.query} />
		<DocsHistoryControls />
	</div>
	<div class="relative flex-1 overflow-y-auto">
		{@render children?.()}
	</div>
</div>
