<script lang="ts">
	import Badge from "$lib/client/components/Badge.svelte"
	/**
	 * The **loadouts grid** (I12; DESIGN-image-generation §14.1): one tile per
	 * loadout, grouped by output kind as Admin › Defaults groups, the default
	 * first in each group with the gold mark. A tile is the button: it opens
	 * the loadout's sheet. Adapted from the jobs grid (`JobsGrid.svelte`);
	 * every word comes from `loadoutsGrid.ts`.
	 *
	 * Two across in the dock, three from 36rem of list, four from 56rem — the
	 * LIST pane's own container (`@container/list`), never the whole view.
	 */
	import * as Icons from "@lucide/svelte"
	import { tileLabel, type LoadoutGroup } from "./loadoutsGrid"

	interface Props {
		groups: readonly LoadoutGroup[]
		onOpen: (id: number) => void
	}
	let { groups, onOpen }: Props = $props()
</script>

<div class="flex flex-col gap-4">
	{#each groups as group (group.kind)}
		{@const GroupIcon = (Icons as any)[group.icon] ?? Icons.Boxes}
		<section aria-label={group.label}>
			<header
				class="border-surface-200-800 mb-2 flex items-center gap-2 border-b pb-1"
			>
				<GroupIcon size={14} class="shrink-0" aria-hidden="true" />
				<h3 class="min-w-0 flex-1 truncate text-xs font-semibold">
					{group.label}
				</h3>
				<span class="text-surface-600-400 shrink-0 text-meta">
					{group.tiles.length}
				</span>
			</header>
			<div
				class="grid grid-cols-2 gap-2 @min-[36rem]/list:grid-cols-3 @min-[56rem]/list:grid-cols-4"
			>
				{#each group.tiles as tile (tile.id)}
					<button
						type="button"
						class="panel-card hover:preset-tonal-primary focus-visible:ring-primary-500 flex min-h-[88px] min-w-0 flex-col gap-1 !p-3 text-left focus-visible:ring-2 focus-visible:outline-none {tile.isDefault
							? 'border-primary-500/40!'
							: ''}"
						data-default={tile.isDefault || undefined}
						aria-label={tileLabel(tile)}
						onclick={() => onOpen(tile.id)}
					>
						<span class="flex min-w-0 items-center gap-1.5">
							{#if tile.isDefault}
								<Icons.Star
									size={12}
									class="text-primary-500 shrink-0 fill-current"
									aria-hidden="true"
								/>
							{/if}
							<span class="min-w-0 truncate text-chip font-medium">
								{tile.title}
							</span>
						</span>
						<span
							class="block truncate text-xs {tile.filled
								? ''
								: 'text-surface-600-400'}"
						>
							{tile.pair}
						</span>
						{#if tile.sampling}
							<span
								class="text-surface-600-400 flex min-w-0 items-center gap-1 text-meta"
							>
								<Icons.SlidersHorizontal
									size={10}
									class="shrink-0"
									aria-hidden="true"
								/>
								<span class="truncate">{tile.sampling}</span>
							</span>
						{/if}
						{#if tile.price}
							<span
								class="text-surface-600-400 truncate text-meta"
								data-testid="loadout-tile-price"
							>
								{tile.price}
							</span>
						{/if}
						{#if tile.chip}
							<Badge size="sm" class="text-surface-700-300 max-w-full self-start truncate">
								{tile.chip}
							</Badge>
						{/if}
						{#if tile.consequence}
							<span
								class="text-warning-700-300 mt-auto line-clamp-2 text-meta"
							>
								{tile.consequence}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>
