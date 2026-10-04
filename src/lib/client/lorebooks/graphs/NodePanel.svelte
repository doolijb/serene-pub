<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import type { GraphEdge, GraphNode, PanelEdge } from "./graphModel"
	import { NEW_PLACE_OPTION, otherEndOptions } from "./linkDraft"

	/**
	 * One node, and everything the graph knows about it.
	 *
	 * Each edge says what it is called, which way it points, who is at the far
	 * end and where it came from, because an edge a reader cannot account for is
	 * an edge they cannot judge. What is **not** drawn sits under the same
	 * heading: two people who shared a room and nothing was written down is a
	 * gap in the book, not an absence of one.
	 *
	 * Each edge with an entry at an end is said from this node through the one
	 * sentence builder ("The rusted iron door leads south to the Guardroom.");
	 * a tie between two cast members keeps its type and arrow. **Link to…** is
	 * a searchable picker over every place on the line and the canvas, plus
	 * **New place…** (plan places-graph B4).
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
		/**
		 * What this node may be linked to: the canvas's nodes and every place
		 * on the line. This node itself is left out here.
		 */
		candidates: GraphNode[]
		/** Offer New place… in Link to…. */
		canCreatePlace?: boolean
		onOpen: () => void
		/** Link to… picked a far end: open the link form on it. */
		onLinkTo: (other: GraphNode) => void
		/** Link to… picked New place…, with whatever had been typed. */
		onNewPlace?: (typed: string) => void
		onKeep: (edge: GraphEdge) => void
		onEdgeClick: (edge: GraphEdge) => void
		onDeleteEdge: (edge: GraphEdge) => void
		/**
		 * Why an edge cannot be changed from here, or null when it can — a
		 * link another line owns is read, not written, while reading a branch.
		 */
		lockedReason?: (edge: GraphEdge) => string | null
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
		candidates,
		canCreatePlace = false,
		onOpen,
		onLinkTo,
		onNewPlace,
		onKeep,
		onEdgeClick,
		onDeleteEdge,
		lockedReason = () => null,
		onOpenScene,
		onRaiseCeiling,
		onClose
	}: Props = $props()

	/**
	 * The edge whose delete is waiting on a second press. A delete is
	 * permanent, so the first press only asks; opening another node lets go.
	 */
	let confirmingDelete = $state<number | null>(null)
	$effect(() => {
		void node.key
		confirmingDelete = null
	})

	const STATUS_BADGE: Record<string, string> = {
		resolved: "preset-tonal-surface",
		broken: "preset-tonal-error",
		evolved: "preset-tonal-warning"
	}

	/** What opening this node means, which is a different page for each kind. */
	let openLabel = $derived(
		node.kind === "entry" ? "Open entry" : "Open cast member"
	)

	let others = $derived(candidates.filter((n) => n.key !== node.key))
	let linkOptions = $derived(
		otherEndOptions(candidates, node.key, canCreatePlace && !!onNewPlace)
	)
	let canLink = $derived(linkOptions.length > 0)
</script>

<div
	class="flex min-h-0 flex-col gap-3 overflow-y-auto text-sm"
	data-node-panel
>
	<div class="flex items-center gap-2">
		<span class="badge preset-tonal-surface shrink-0 text-[11px] capitalize">
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

	<div class="panel-inset flex flex-col gap-2">
		<p class="text-xs font-semibold">Relationships {edges.length}</p>
		<div data-node-link-to>
			<Select
				label="Link to"
				labelHidden
				class="text-sm"
				placeholder={canLink
					? "Link to…"
					: "There is nothing else to link this to"}
				emptyMessage="No place or node by that name."
				disabled={!canLink}
				options={linkOptions}
				value=""
				onValueChange={(v, typed) => {
					if (v === NEW_PLACE_OPTION) {
						onNewPlace?.(typed)
						return
					}
					const other = others.find((n) => n.key === v)
					if (other) onLinkTo(other)
				}}
			/>
		</div>
	</div>

	{#if edges.length === 0}
		<p class="text-surface-600-400 text-xs italic">
			Nothing joins this to anything yet. Alt-drag (⌥ on a Mac) from it on
			the canvas, or pick something under Link to….
		</p>
	{/if}

	<ul class="flex flex-col gap-1.5">
		{#each edges as row (row.edge.id)}
			{@const locked = lockedReason(row.edge)}
			<li
				class="bg-surface-100-900 panel-edge flex flex-col gap-1 rounded-lg border p-2.5"
				data-node-edge={row.edge.id}
			>
				<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
					<button
						type="button"
						class="min-w-0 flex-1 text-left text-xs font-semibold"
						class:truncate={!row.sentence}
						onclick={() => onEdgeClick(row.edge)}
					>
						{#if row.sentence}
							<span data-node-edge-sentence>{row.sentence}</span>
						{:else}
							{row.edge.label}
							<span class="text-surface-600-400">{row.arrow}</span>
							{row.otherName}
						{/if}
					</button>
					<span class="text-surface-600-400 shrink-0 text-[11px]">
						{row.provenanceWord}
					</span>
					{#if row.statusWord}
						<span
							class="badge {STATUS_BADGE[row.statusWord] ??
								'preset-tonal-surface'} shrink-0 text-[11px]"
						>
							{row.cut ? "cut" : row.statusWord}
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
					{#if confirmingDelete === row.edge.id}
						<span class="text-error-500 shrink-0 text-xs">
							Delete for good?
						</span>
						<button
							class="btn btn-sm preset-filled-error-500 shrink-0 text-xs"
							type="button"
							data-confirm-delete-edge
							onclick={() => {
								confirmingDelete = null
								onDeleteEdge(row.edge)
							}}
						>
							Delete
						</button>
						<button
							class="btn btn-sm preset-tonal-surface shrink-0 text-xs"
							type="button"
							onclick={() => (confirmingDelete = null)}
						>
							Cancel
						</button>
					{:else}
						<button
							class="btn btn-sm preset-tonal-error shrink-0 p-1"
							type="button"
							disabled={!!locked}
							title={locked ?? "Delete relationship"}
							aria-label="Delete relationship"
							onclick={() => (confirmingDelete = row.edge.id)}
						>
							<Icons.Trash2 size={11} aria-hidden="true" />
						</button>
					{/if}
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
		<div class="panel-inset flex flex-col gap-2">
			<p class="text-xs font-semibold">Not drawn</p>
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
