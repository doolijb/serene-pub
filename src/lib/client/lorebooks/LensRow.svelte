<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { LENS_LABELS, LORE_LENSES, type LoreLens } from "./loreRoute"
	import { lensReason } from "./graphs"

	/**
	 * How the set is drawn — the second of the workspace's three controls.
	 *
	 * Every lens stands in every book and for every scope, because any scope
	 * can be drawn through any lens. A lens with nothing to draw shows its own
	 * empty state rather than being taken away.
	 */
	interface Props {
		lens: LoreLens
		/** The bottom row of the compact layout labels itself with icons. */
		compact?: boolean
		onLens: (lens: LoreLens) => void
	}

	let { lens, compact = false, onLens }: Props = $props()

	const ICONS: Record<LoreLens, any> = {
		list: Icons.List,
		cards: Icons.LayoutGrid,
		tree: Icons.ListTree,
		graph: Icons.Network,
		time: Icons.History,
		lives: Icons.Footprints,
		places: Icons.Map
	}
</script>

<!-- A FIXED grid in the rail — 4x2 since Lives joined, seven filled and one
     empty. A row that reflows with the rail's width puts a lens somewhere
     different at every width, and a control that moves is a control nobody
     learns the position of. An empty cell costs less than a moving one. The
     compact layout is one icon row along the bottom instead. -->
<div
	class={compact ? "flex justify-between gap-1" : "grid grid-cols-4 gap-1"}
	role="group"
	aria-label="Lens"
	data-lore-lens-row
>
	{#each LORE_LENSES as id (id)}
		{@const Icon = ICONS[id]}
		{@const reason = lensReason(id)}
		<button
			type="button"
			class="btn btn-sm min-w-0 {lens === id
				? 'preset-filled-primary-500'
				: 'preset-tonal-surface'} {compact
				? 'gap-1'
				: 'h-auto flex-col gap-0.5 px-1 py-1.5'}"
			disabled={!!reason}
			title={reason ?? LENS_LABELS[id]}
			aria-pressed={lens === id}
			data-lore-lens={id}
			onclick={() => onLens(id)}
		>
			<Icon size={14} aria-hidden="true" />
			{#if compact}
				<span class="sr-only">{LENS_LABELS[id]}</span>
			{:else}
				<span class="w-full truncate text-[11px] leading-tight">
					{LENS_LABELS[id]}
				</span>
			{/if}
		</button>
	{/each}
</div>
