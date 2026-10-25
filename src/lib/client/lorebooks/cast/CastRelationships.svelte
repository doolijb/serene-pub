<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { GraphEdge, PanelEdge } from "../graphs/graphModel"
	import type { CastFace } from "../castPool"
	import CastAvatar from "./CastAvatar.svelte"
	import { relationshipsAtMomentLine } from "./castRelationships"

	/**
	 * A member's relationships, on their own tab of the member page.
	 *
	 * The same edges the graph draws, said in words: what it is called, which
	 * way it points, who is at the far end, and where it came from. Every one
	 * is listed: the tab holds nothing else for them to bury.
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
		/**
		 * The member at the far end, by graph key, as they read at the
		 * moment; undefined for an entry end or a member not on this line.
		 */
		faceOf?: (otherKey: string) => CastFace | undefined
		/** Opens the member at the far end. */
		onOpenMember?: (castId: number) => void
	}

	let {
		rows,
		inStory,
		laterLabel,
		isNew,
		onKeep,
		onSeeInGraph,
		faceOf,
		onOpenMember
	}: Props = $props()

	let momentLine = $derived(relationshipsAtMomentLine(inStory, rows.length))
</script>

<div class="panel-inset flex flex-col gap-2" data-cast-relationships>
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
			{#each rows as row (row.edge.id)}
				{@const later = laterLabel(row.edge)}
				{@const face = faceOf?.(row.otherKey)}
				<li
					class="bg-surface-100-900 panel-edge flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border p-2"
					class:opacity-50={later !== null}
					data-cast-edge={row.edge.id}
				>
					<!-- Who is at the other end leads the row (note 9): their face
					     and name, which open them, and the tie said under it. A
					     single truncated "label → name" line cut the name off. -->
					<span class="flex w-full min-w-0 items-center gap-2">
						<CastAvatar
							name={face?.name ?? row.otherName}
							kind={face?.kind ?? "background"}
							src={face?.src}
							size="sm"
						/>
						<span class="flex min-w-0 flex-1 flex-col">
							{#if face && onOpenMember}
								<button
									type="button"
									class="hover:text-primary-ink min-w-0 cursor-pointer truncate text-left text-sm font-semibold underline-offset-2 hover:underline"
									title="Open {face.name}"
									data-cast-edge-other={face.id}
									onclick={() => onOpenMember(face.id)}
								>
									{face.name}
								</button>
							{:else}
								<span
									class="min-w-0 truncate text-sm font-semibold"
								>
									{face?.name ?? row.otherName}
								</span>
							{/if}
							<span
								class="text-surface-700-300 min-w-0 text-xs"
								data-cast-edge-says
							>
								{#if row.sentence}
									{row.sentence}
								{:else}
									<span
										class="text-surface-600-400"
										title={row.direction === "out"
											? "From this member to them"
											: "From them to this member"}
									>
										{row.arrow}
									</span>
									{row.edge.label}
								{/if}
							</span>
						</span>
					</span>
					<span class="text-surface-600-400 shrink-0 text-meta">
						{row.provenanceWord}
					</span>
					{#if row.cut}
						<span
							class="badge preset-tonal-error shrink-0 text-meta"
						>
							cut
						</span>
					{/if}
					{#if later}
						<span
							class="badge preset-tonal-surface shrink-0 text-meta"
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
	{/if}
</div>
