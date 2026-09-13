<script lang="ts">
	import GraphVisualization from "$lib/client/components/graph/GraphVisualization.svelte"
	import type { GraphEdge, GraphNode } from "./graphModel"

	/**
	 * The relationship web, drawn wide.
	 *
	 * The canvas is the whole point of the graph lens, so it takes the width the
	 * list and editor columns would have had. Selecting a node fills the panel
	 * beside it; nothing about a member is edited here, because a node **is** a
	 * cast member or an entry and their own page is where they are written.
	 */
	interface Props {
		nodes: GraphNode[]
		edges: GraphEdge[]
		/** The line above the canvas, which is the drawing said out loud. */
		headline: string
		/** Edges the moment holds back, so the count can be honest. */
		heldBack: number
		momentLabel: string | null
		selectedKey: string | null
		onNodeClick: (node: GraphNode) => void
		onEdgeClick: (edge: GraphEdge) => void
		onLinkDraw: (from: GraphNode, to: GraphNode) => void
	}

	let {
		nodes,
		edges,
		headline,
		heldBack,
		momentLabel,
		selectedKey,
		onNodeClick,
		onEdgeClick,
		onLinkDraw
	}: Props = $props()

	/**
	 * One layout, offered as a switcher.
	 *
	 * The control is here rather than absent because a reader looking for the
	 * layout has to find where it would be; a second layout lands beside this
	 * one rather than replacing a plain label nobody knew was a control.
	 */
	const LAYOUTS = ["Force"] as const
	let layout = $state<(typeof LAYOUTS)[number]>("Force")
</script>

<div class="flex min-h-0 flex-1 flex-col gap-2" data-lore-graph="relationships">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		<p
			class="text-surface-700-300 min-w-0 flex-1 text-sm"
			data-graph-headline
		>
			{headline}
		</p>
		<div class="flex gap-1" role="group" aria-label="Layout">
			{#each LAYOUTS as option (option)}
				<button
					type="button"
					class="btn btn-sm {layout === option
						? 'preset-filled-primary-500'
						: 'preset-tonal-surface'}"
					aria-pressed={layout === option}
					onclick={() => (layout = option)}
				>
					{option}
				</button>
			{/each}
		</div>
	</div>

	{#if momentLabel}
		<p class="text-surface-600-400 text-xs">
			As of {momentLabel}: {edges.length} link{edges.length === 1
				? ""
				: "s"}.
			{#if heldBack > 0}
				{heldBack}
				{heldBack === 1 ? "has" : "have"} not happened yet at this moment.
			{/if}
		</p>
	{/if}

	<div
		class="bg-surface-200-800 min-h-72 flex-1 overflow-hidden rounded-lg"
		data-lore-graph-canvas
	>
		<GraphVisualization
			{nodes}
			{edges}
			{selectedKey}
			{onNodeClick}
			{onEdgeClick}
			{onLinkDraw}
		/>
	</div>

	<p class="text-surface-600-400 text-xs" data-graph-hint>
		drag to move · click a node to open it · ⌥-drag between two nodes to
		name a relationship
	</p>
</div>
