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
	import {
		AudioLines,
		Boxes,
		Clapperboard,
		FileText,
		Image,
		ScanText,
		SlidersHorizontal,
		Star,
		Type,
		Zap
	} from "@lucide/svelte"
	import type { Component } from "svelte"
	import { tileLabel, type LoadoutGroup } from "./loadoutsGrid"

	interface Props {
		groups: readonly LoadoutGroup[]
		onOpen: (id: number) => void
	}
	let { groups, onOpen }: Props = $props()

	/** The icon per output kind (`OUTPUT_KIND_ICONS` names, in `outputKinds.ts`; `Boxes` for the fallback). */
	const OUTPUT_KIND_COMPONENTS: Record<string, Component<any>> = {
		Type,
		Image,
		AudioLines,
		Clapperboard,
		FileText,
		Zap,
		ScanText,
		Boxes
	}
</script>

<div class="flex flex-col gap-4">
	{#each groups as group (group.kind)}
		{@const GroupIcon = OUTPUT_KIND_COMPONENTS[group.icon] ?? Boxes}
		<section aria-label={group.label}>
			<header class="mb-2 flex items-center gap-2">
				<GroupIcon size={14} class="shrink-0" aria-hidden="true" />
				<h3 class="min-w-0 flex-1 truncate text-xs font-semibold">
					{group.label}
				</h3>
				<span class="text-surface-600-400 text-meta shrink-0">
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
							? 'border-primary-500/40! border'
							: ''}"
						data-default={tile.isDefault || undefined}
						aria-label={tileLabel(tile)}
						onclick={() => onOpen(tile.id)}
					>
						<span class="flex min-w-0 items-center gap-1.5">
							{#if tile.isDefault}
								<Star
									size={12}
									class="text-primary-500 shrink-0 fill-current"
									aria-hidden="true"
								/>
							{/if}
							<span
								class="text-chip min-w-0 truncate font-medium"
							>
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
								class="text-surface-600-400 text-meta flex min-w-0 items-center gap-1"
							>
								<SlidersHorizontal
									size={10}
									class="shrink-0"
									aria-hidden="true"
								/>
								<span class="truncate">{tile.sampling}</span>
							</span>
						{/if}
						{#if tile.price}
							<span
								class="text-surface-600-400 text-meta truncate"
								data-testid="loadout-tile-price"
							>
								{tile.price}
							</span>
						{/if}
						{#if tile.chip}
							<Badge
								size="sm"
								class="text-surface-700-300 max-w-full self-start truncate"
							>
								{tile.chip}
							</Badge>
						{/if}
						{#if tile.consequence}
							<span
								class="text-warning-700-300 text-meta mt-auto line-clamp-2"
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
