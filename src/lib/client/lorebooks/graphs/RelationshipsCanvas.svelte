<script lang="ts">
	import type { Snippet } from "svelte"
	import GraphVisualization from "$lib/client/components/graph/GraphVisualization.svelte"
	import type { LoreDrawing } from "../graphs"
	import type { GraphEdge, GraphNode } from "./graphModel"

	/**
	 * The relationship web, drawn wide — the Graph lens's whole book, or the
	 * Places lens's map (plan places-graph B4): one canvas, two drawings.
	 *
	 * The canvas is the whole point of either lens, so it takes the width the
	 * list and editor columns would have had. Selecting a node fills the panel
	 * beside it; nothing about a member is edited here, because a node **is** a
	 * cast member or an entry and their own page is where they are written.
	 */
	interface Props {
		/** Which drawing this is; the Places lens is a map to draw on. */
		drawing?: LoreDrawing
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
		/** The lens's own actions, beside the layout switcher (New place). */
		toolbar?: Snippet
		/** Drawn in place of the canvas while it has no nodes. */
		empty?: Snippet
		/**
		 * Every category the lens knows, unfiltered — so a category keeps its
		 * tint while a chip narrows the map to it.
		 */
		categoryOrder?: readonly string[]
	}

	let {
		drawing = "relationships",
		nodes,
		edges,
		headline,
		heldBack,
		momentLabel,
		selectedKey,
		onNodeClick,
		onEdgeClick,
		onLinkDraw,
		toolbar,
		empty,
		categoryOrder
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

	/**
	 * How to work the canvas. "Link", never "line": a line is a lorebook's
	 * main or a branch (NOMENCLATURE §8), and the lock note on the same panel
	 * names one. Alt is spelled out (⌥ is a Mac's key cap), and the keyboard's
	 * way is said too: Tab reaches the nodes, and Link to… joins two.
	 */
	let hint = $derived(
		drawing === "places"
			? "drag to move · click a place (or Tab to it and press Enter) to see its links · click a link to edit it · Alt-drag (⌥ on a Mac) between two places, or pick one and use Link to…, to link them"
			: "drag to move · click a node (or Tab to it and press Enter) to open it · Alt-drag (⌥ on a Mac) between two nodes, or use Link to…, to name a relationship"
	)
</script>

<!-- Scrolls when the canvas's floor (min-h-72) and the lines around it are
     taller than the room left for them (a phone), rather than running under
     whatever sits below. -->
<div
	class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
	data-lore-graph={drawing}
>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
		<!-- A floor under the headline: narrow, the toolbar wraps below it
		     rather than squeezing it to a word a line. -->
		<p
			class="text-surface-700-300 min-w-60 flex-1 text-sm"
			data-graph-headline
		>
			{headline}
		</p>
		{@render toolbar?.()}
		<div class="flex gap-1" role="group" aria-label="Layout">
			{#each LAYOUTS as option (option)}
				<button
					type="button"
					class="btn btn-sm {layout === option
						? 'preset-tonal-primary'
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

	{#if nodes.length === 0 && empty}
		<div class="flex min-h-72 flex-1 flex-col" data-lore-graph-empty>
			{@render empty()}
		</div>
	{:else}
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
				labels={drawing === "places" ? "always" : "auto"}
				{categoryOrder}
			/>
		</div>

		<p class="text-surface-600-400 text-xs" data-graph-hint>
			{hint}
		</p>
	{/if}
</div>
