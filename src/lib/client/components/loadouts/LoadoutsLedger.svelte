<script lang="ts">
	/**
	 * The **defaults ledger** in the Loadouts view (I12; DESIGN-image-generation
	 * §14.1): every job and the loadout that is its default, with **Change**
	 * (a filled default) or **Fill** (unfilled, or no default yet) — each opens
	 * that loadout's sheet. Adapted from `connections/DefaultsLedger.svelte`;
	 * the words come from `loadoutsGrid.ts` (`ledgerRows`).
	 */
	import {
		AudioLines,
		Boxes,
		Clapperboard,
		FileText,
		Image,
		ScanText,
		Type,
		Zap
	} from "@lucide/svelte"
	import type { Component } from "svelte"
	import type { LedgerRow } from "./loadoutsGrid"

	interface Props {
		rows: readonly LedgerRow[]
		onOpen: (id: number) => void
	}
	let { rows, onOpen }: Props = $props()

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

<section
	aria-labelledby="loadouts-ledger-heading"
	class="flex flex-col gap-1.5"
>
	<h3
		id="loadouts-ledger-heading"
		class="text-surface-600-400 px-0.5 text-xs font-medium"
	>
		Defaults
	</h3>
	<div class="flex flex-col">
		{#each rows as row (row.transform)}
			{@const KindIcon = OUTPUT_KIND_COMPONENTS[row.kindIcon] ?? Boxes}
			<div
				class="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5"
			>
				<span
					class="preset-tonal-surface flex size-7 shrink-0 items-center justify-center rounded-lg"
					aria-hidden="true"
				>
					<KindIcon size={14} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex items-baseline gap-1.5">
						<span class="truncate text-sm font-medium">
							{row.label}
						</span>
						<span
							class="text-surface-600-400 text-meta shrink-0 font-mono"
						>
							{row.transform}
						</span>
					</span>
					<span
						class="text-meta block truncate {row.filled
							? 'text-surface-600-400'
							: row.transform === 'text->text'
								? 'text-warning-700-300'
								: 'text-surface-600-400'}"
					>
						{row.line}
					</span>
				</span>
				{#if row.loadoutId != null}
					{@const id = row.loadoutId}
					<button
						type="button"
						class="btn btn-sm shrink-0 text-xs {row.verb ===
							'Fill' && row.transform === 'text->text'
							? 'preset-filled-primary-500'
							: 'preset-tonal-surface'}"
						aria-label={`${row.verb} the default loadout for ${row.label}`}
						onclick={() => onOpen(id)}
					>
						{row.verb}
					</button>
				{/if}
			</div>
		{/each}
	</div>
</section>
