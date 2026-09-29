<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { GraphEdge, PanelEdge } from "../graphs/graphModel"
	import { moreLine, relationshipsAtMomentLine } from "./castRelationships"

	/**
	 * A member's relationships, on their own page.
	 *
	 * The same edges the graph draws, said in words: what it is called, which
	 * way it points, who is at the far end, and where it came from. The list
	 * shows a handful and offers the rest, because a member with twenty edges
	 * would otherwise bury the lore underneath them.
	 */
	interface Props {
		rows: PanelEdge[]
		/** How many of them have happened at the moment being read. */
		inStory: number
		/** The moment's label for an edge that has not happened yet. */
		laterLabel: (edge: GraphEdge) => string | null
		isNew: (edge: GraphEdge) => boolean
		onKeep: (edge: GraphEdge) => void
		onSeeInGraph: () => void
	}

	let { rows, inStory, laterLabel, isNew, onKeep, onSeeInGraph }: Props =
		$props()

	/** What fits before the lore below it is pushed off the screen. */
	const HEAD = 4

	let showAll = $state(false)
	let shown = $derived(showAll ? rows : rows.slice(0, HEAD))
	let hidden = $derived(rows.length - shown.length)
	let momentLine = $derived(relationshipsAtMomentLine(inStory, rows.length))
</script>

<div
	class="border-border flex flex-col gap-2 border-t pt-3"
	data-cast-relationships
>
	<div class="flex items-center gap-2">
		<h4 class="flex-1 text-sm font-semibold">
			Relationships {rows.length}
		</h4>
		<button
			class="btn btn-sm preset-tonal-surface shrink-0"
			type="button"
			onclick={onSeeInGraph}
		>
			<Icons.Network size={14} aria-hidden="true" /> See in graph
		</button>
	</div>

	{#if momentLine}
		<p class="text-surface-600-400 text-xs">{momentLine}</p>
	{/if}

	{#if rows.length === 0}
		<p class="text-surface-700-300 text-xs italic">
			Nothing joins them to anybody yet. Name one on the graph and it
			shows here.
		</p>
	{:else}
		<ul class="flex flex-col gap-1.5">
			{#each shown as row (row.edge.id)}
				{@const later = laterLabel(row.edge)}
				<li
					class="bg-surface-100-900 border-border flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border p-2"
					class:opacity-50={later !== null}
					data-cast-edge={row.edge.id}
				>
					<span class="min-w-0 flex-1 truncate text-xs font-semibold">
						{row.edge.label}
						<span class="text-surface-600-400">{row.arrow}</span>
						{row.otherName}
					</span>
					<span class="text-surface-600-400 shrink-0 text-[11px]">
						{row.provenanceWord}
					</span>
					{#if row.cut}
						<span
							class="badge preset-tonal-error shrink-0 text-[11px]"
						>
							cut
						</span>
					{/if}
					{#if later}
						<span
							class="badge preset-tonal-surface shrink-0 text-[11px]"
						>
							{later}
						</span>
					{/if}
					{#if isNew(row.edge)}
						<button
							class="btn btn-sm preset-tonal-success shrink-0 text-xs"
							type="button"
							title="Stop marking this one as new"
							onclick={() => onKeep(row.edge)}
						>
							Keep
						</button>
					{/if}
				</li>
			{/each}
		</ul>
		{#if hidden > 0}
			<button
				class="anchor self-start text-xs"
				type="button"
				onclick={() => (showAll = true)}
			>
				{moreLine(hidden)}
			</button>
		{/if}
	{/if}
</div>
