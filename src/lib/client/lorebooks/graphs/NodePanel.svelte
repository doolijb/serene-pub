<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { GraphEdge, GraphNode, PanelEdge } from "./graphModel"

	/**
	 * One node, and everything the graph knows about it.
	 *
	 * Each edge says what it is called, which way it points, who is at the far
	 * end and where it came from, because an edge a reader cannot account for is
	 * an edge they cannot judge. What is **not** drawn sits under the same
	 * heading: two people who shared a room and nothing was written down is a
	 * gap in the book, not an absence of one.
	 *
	 * ⚠ These are the edges the canvas draws, which at a moment other than now
	 * is the web as it stood then. An edge established later is not listed here
	 * because it is not on the canvas either; the line above the canvas counts
	 * what the moment holds back.
	 */
	interface NotDrawnRow {
		otherId: number
		sentence: string
		sceneIds: number[]
	}

	interface Props {
		node: GraphNode
		edges: PanelEdge[]
		notDrawn: NotDrawnRow[]
		/** What the last turn sent, when a run recorded it. */
		ceiling: string | null
		/** Edge ids this session's build made, still to be kept or cut. */
		isNew: (edge: GraphEdge) => boolean
		/** There has to be something else on the canvas to join this to. */
		canAdd: boolean
		onOpen: () => void
		onAdd: () => void
		onKeep: (edge: GraphEdge) => void
		onEdgeClick: (edge: GraphEdge) => void
		onDeleteEdge: (edge: GraphEdge) => void
		onOpenScene: (sceneId: number) => void
		onRaiseCeiling: () => void
		onClose: () => void
	}

	let {
		node,
		edges,
		notDrawn,
		ceiling,
		isNew,
		canAdd,
		onOpen,
		onAdd,
		onKeep,
		onEdgeClick,
		onDeleteEdge,
		onOpenScene,
		onRaiseCeiling,
		onClose
	}: Props = $props()

	/** What opening this node means, which is a different page for each kind. */
	let openLabel = $derived(
		node.kind === "entry" ? "Open entry" : "Open cast member"
	)
</script>

<div
	class="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm"
	data-node-panel
>
	<div class="flex items-center gap-2">
		<span class="badge preset-tonal-surface shrink-0 text-[10px] uppercase">
			{node.kind}
		</span>
		<span class="min-w-0 flex-1 truncate font-semibold">{node.name}</span>
		<button
			class="btn btn-sm preset-tonal-surface shrink-0"
			type="button"
			onclick={onOpen}
		>
			{openLabel}
		</button>
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1.5"
			type="button"
			title="Close"
			aria-label="Close"
			onclick={onClose}
		>
			<Icons.X size={13} aria-hidden="true" />
		</button>
	</div>

	<div class="border-border flex items-center gap-2 border-t pt-2">
		<p class="flex-1 text-xs font-semibold uppercase">
			Relationships {edges.length}
		</p>
		<button
			class="btn btn-sm preset-filled-success-500 shrink-0"
			type="button"
			disabled={!canAdd}
			title={canAdd
				? "Name a relationship from here"
				: "There is nothing else on the canvas to join this to"}
			onclick={onAdd}
		>
			<Icons.Plus size={13} aria-hidden="true" /> Add
		</button>
	</div>

	{#if edges.length === 0}
		<p class="text-surface-400 text-xs italic">
			Nothing joins this to anything yet. ⌥-drag from it on the canvas, or
			press Add.
		</p>
	{/if}

	<ul class="flex flex-col gap-1.5">
		{#each edges as row (row.edge.id)}
			<li
				class="bg-surface-100-900 border-border flex flex-col gap-1 rounded-lg border p-2.5"
				data-node-edge={row.edge.id}
			>
				<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
					<button
						type="button"
						class="min-w-0 flex-1 truncate text-left text-xs font-semibold"
						onclick={() => onEdgeClick(row.edge)}
					>
						{row.edge.label}
						<span class="text-surface-400">{row.arrow}</span>
						{row.otherName}
					</button>
					<span class="text-surface-600-400 shrink-0 text-[11px]">
						{row.provenanceWord}
					</span>
					{#if row.cut}
						<span
							class="badge preset-tonal-error shrink-0 text-[10px]"
						>
							cut
						</span>
					{/if}
				</div>
				<div class="flex items-center gap-1">
					{#if row.edge.description}
						<p
							class="text-surface-700-300 min-w-0 flex-1 truncate text-xs"
						>
							{row.edge.description}
						</p>
					{:else}
						<span class="flex-1"></span>
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
					<button
						class="btn btn-sm preset-tonal-error shrink-0 p-1"
						type="button"
						title="Delete relationship"
						aria-label="Delete relationship"
						onclick={() => onDeleteEdge(row.edge)}
					>
						<Icons.Trash2 size={11} aria-hidden="true" />
					</button>
				</div>
			</li>
		{/each}
	</ul>

	{#if ceiling}
		<p class="text-surface-600-400 text-xs" data-node-ceiling>
			{ceiling} ·
			<button type="button" class="anchor" onclick={onRaiseCeiling}>
				Raise it
			</button>
		</p>
	{/if}

	{#if notDrawn.length > 0}
		<div class="border-border flex flex-col gap-2 border-t pt-2">
			<p class="text-xs font-semibold uppercase">Not drawn</p>
			{#each notDrawn as row (row.otherId)}
				<button
					type="button"
					class="border-warning-500/40 hover:bg-surface-200-800 rounded-lg border p-2 text-left text-xs leading-snug transition-colors"
					data-not-drawn={row.otherId}
					onclick={() => onOpenScene(row.sceneIds[0])}
				>
					{row.sentence}
				</button>
			{/each}
		</div>
	{/if}
</div>
