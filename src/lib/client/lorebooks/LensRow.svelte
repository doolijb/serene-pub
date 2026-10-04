<script lang="ts">
	import type { LoreLens } from "$lib/shared/lorebooks/loreRoute"
	import { LORE_LENS_REGISTRY, shortcutLabel } from "./lenses/registry"

	/**
	 * How the set is drawn — the second of the workspace's three controls,
	 * drawn from the lens registry (`lenses/registry.ts`): a lens declared
	 * there is a button here, with its label, icon and shortcut.
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

	/** Wrong answers cost a wrong glyph in a hint, never behaviour. */
	const mac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad|ipod/i.test(navigator.platform || "")
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
	{#each LORE_LENS_REGISTRY as d (d.id)}
		{@const Icon = d.icon}
		{@const reason = d.reason?.() ?? null}
		<button
			type="button"
			class="btn btn-sm min-w-0 {lens === d.id
				? 'preset-tonal-primary'
				: 'preset-tonal-surface'} {compact
				? 'gap-1'
				: 'h-auto flex-col gap-0.5 px-1 py-1.5'}"
			disabled={!!reason}
			title={reason ?? `${d.label} (${shortcutLabel(d.shortcut, mac)})`}
			aria-pressed={lens === d.id}
			aria-keyshortcuts={d.shortcut}
			data-lore-lens={d.id}
			onclick={() => onLens(d.id)}
		>
			<Icon size={14} aria-hidden="true" />
			{#if compact}
				<span class="sr-only">{d.label}</span>
			{:else}
				<span class="w-full truncate text-[11px] leading-tight">
					{d.label}
				</span>
			{/if}
		</button>
	{/each}
</div>
