<script lang="ts">
	/**
	 * The drawing lenses' mount — Graph and Places are one canvas drawing two
	 * things (the descriptor's `drawing`), so moving between them keeps the
	 * canvas rather than building a second one.
	 */
	import GraphsWorkspace from "../GraphsWorkspace.svelte"
	import { loreRoute } from "../loreRoute.svelte"
	import type { LensProps } from "./types"

	let {
		lens,
		lorebookId,
		bench,
		hasUnsavedChanges = $bindable(false)
	}: LensProps = $props()
</script>

{#if lens.drawing}
	<GraphsWorkspace
		{lorebookId}
		mode={bench.mode}
		drawing={lens.drawing}
		relationships={bench.runRelationships}
		bind:hasUnsavedChanges
		onEditMember={(castId) =>
			loreRoute.navigate({
				type: "openCastMember",
				scope: "cast",
				castId
			})}
	/>
{/if}
