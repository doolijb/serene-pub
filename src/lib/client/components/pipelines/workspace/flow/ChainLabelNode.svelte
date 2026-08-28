<script lang="ts">
	/**
	 * A chain's caption at the head of its branch — the branch name, and for
	 * a route the predicate as the sentence its declaration is ("when call =
	 * search" / "otherwise"). A node rather than an edge label so ELK gives
	 * every branch an anchor and parallel chains land side by side.
	 */
	import { Handle } from "@xyflow/svelte"

	let { data, sourcePosition } = $props()

	const chain = $derived(data.chain as string)
	const predicate = $derived((data.predicate ?? null) as string | null)
	const index = $derived((data.index ?? null) as number | null)
</script>

<div class="flex h-full w-full items-center gap-1.5 overflow-hidden px-1">
	{#if index !== null}
		<span class="text-surface-600-400 shrink-0 font-mono text-[9px]">
			{String(index + 1).padStart(2, "0")}
		</span>
	{/if}
	<span
		class="text-surface-600-400 truncate text-[10px] font-bold tracking-[.15em] uppercase"
	>
		{chain}
	</span>
	{#if predicate}
		<span class="text-secondary-500 truncate font-mono text-[9px]">
			{predicate}
		</span>
	{/if}
	<Handle type="source" position={sourcePosition} class="!opacity-0" />
</div>
