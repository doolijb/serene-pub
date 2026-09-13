<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getContext } from "svelte"
	import type { EntryRowProps } from "./types"
	import SceneCastChips from "./SceneCastChips.svelte"

	/**
	 * A scene reads as its name over its summary, with the two states that
	 * decide what can be done to it next: summarized, and folded into the
	 * graph.
	 */
	let { item, source }: EntryRowProps = $props()

	const sceneSummarizesCtx: SceneSummarizesCtx =
		getContext("sceneSummarizesCtx")

	let activity = $derived(
		sceneSummarizesCtx?.activities?.find((a) => a.sceneId === source.id)
	)
</script>

<div class="mb-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold">
	<span class="min-w-0 flex-1 truncate">{item.name}</span>
	{#if source.graphed}
		<Icons.GitGraph
			size={12}
			class="text-success-500 shrink-0"
			aria-label="Added to graph"
		/>
	{/if}
	{#if activity?.status === "running"}
		<Icons.Loader
			size={13}
			class="text-primary-500 shrink-0 animate-spin"
			aria-label="Processing"
		/>
	{:else if activity?.status === "review"}
		<Icons.Eye
			size={13}
			class="text-warning-500 shrink-0"
			aria-label="Review pending"
		/>
	{/if}
</div>
{#if source.summary}
	<p
		class="text-surface-600-400 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap"
	>
		{source.summary}
	</p>
{:else}
	<p class="text-surface-700-300 text-xs italic">No summary yet.</p>
{/if}
<div class="mt-1.5 flex flex-col gap-1">
	<SceneCastChips scene={source} />
	{#if source.sessionName}
		<p class="text-surface-700-300 text-xs">
			<Icons.MessageSquare size={11} class="inline" />
			{source.sessionName}
			{#if source.selectedMessageIds?.length}
				· {source.selectedMessageIds.length} messages
			{/if}
		</p>
	{/if}
</div>
