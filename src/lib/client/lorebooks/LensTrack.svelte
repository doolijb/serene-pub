<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { LoreLens } from "$lib/shared/lorebooks/loreRoute"
	import { toolbarButtonClass } from "$lib/client/components/panels/toolbarButton"
	import {
		lensDescriptor,
		LORE_LENS_REGISTRY,
		shortcutLabel
	} from "./lenses/registry"

	/**
	 * How the set is drawn — the second of the workspace's three controls,
	 * drawn from the lens registry (`lenses/registry.ts`): a lens declared
	 * there is a button here, with its label, icon and shortcut.
	 *
	 * The right end of the pool's header line (design A.3), where HOW sits
	 * beside the thing it draws. One value from a short fixed set, so it is a
	 * segmented track (STYLE-GUIDE §6.5), the view header's width switch in
	 * shape: seven 32px icon buttons in a `surface-100-900` track, the chosen
	 * one tonal primary with `aria-pressed`, each named in its `title` (with
	 * its shortcut) and its `aria-label`.
	 *
	 * Compact (design A.4) is one 40px toolbar button wearing the chosen
	 * lens's icon, opening a popout of `role="radio"` rows (§6.3).
	 *
	 * Every lens stands in every book and for every scope, because any scope
	 * can be drawn through any lens. A lens with nothing to draw shows its own
	 * empty state rather than being taken away. The shortcuts themselves are
	 * heard by the workspace (`lensForKey`); this names them.
	 */
	interface Props {
		value: LoreLens
		onselect: (lens: LoreLens) => void
		/** One popout button instead of the track (the compact find row). */
		compact?: boolean
	}

	let { value, onselect, compact = false }: Props = $props()

	let open = $state(false)

	/** Wrong answers cost a wrong glyph in a hint, never behaviour. */
	const mac =
		typeof navigator !== "undefined" &&
		/mac|iphone|ipad|ipod/i.test(navigator.platform || "")

	const chosen = $derived(lensDescriptor(value))

	/** A pick applies and closes the popout: one choice, one interaction. */
	function pick(lens: LoreLens) {
		open = false
		onselect(lens)
	}
</script>

{#if compact}
	{@const ChosenIcon = chosen.icon}
	<Popover
		{open}
		onOpenChange={(e) => (open = e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class={toolbarButtonClass()}
			title="Show as: {chosen.label}"
			aria-label="Show as: {chosen.label}"
			aria-expanded={open}
			data-lore-lens-track
		>
			<ChosenIcon size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-50-950 border-surface-200-800 w-[min(90vw,220px)] border p-2 shadow-xl"
				>
					<div
						class="flex flex-col gap-0.5"
						role="radiogroup"
						aria-label="Show as"
					>
						{#each LORE_LENS_REGISTRY as d (d.id)}
							{@const Icon = d.icon}
							{@const reason = d.reason?.() ?? null}
							{@const checked = value === d.id}
							<button
								type="button"
								role="radio"
								aria-checked={checked}
								class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm {checked
									? 'sidebar-row-active'
									: 'hover:bg-surface-200-800'}"
								class:opacity-60={!!reason}
								disabled={!!reason}
								title={reason ?? undefined}
								data-lore-lens={d.id}
								onclick={() => pick(d.id)}
							>
								<Icon
									size={16}
									class="text-surface-600-400 shrink-0"
									aria-hidden="true"
								/>
								<span class="min-w-0 truncate">{d.label}</span>
							</button>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
{:else}
	<!-- A FIXED track: the lenses stand in the registry's order at every
	     width, because a control that moves is a control nobody learns the
	     position of. -->
	<div
		class="bg-surface-100-900 flex shrink-0 gap-0.5 rounded-base p-0.5"
		role="group"
		aria-label="Show as"
		data-lore-lens-track
	>
		{#each LORE_LENS_REGISTRY as d (d.id)}
			{@const Icon = d.icon}
			{@const reason = d.reason?.() ?? null}
			{@const selected = value === d.id}
			<button
				type="button"
				class="focus-visible:outline-primary-500 flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60 {selected
					? 'preset-pressed'
					: 'text-surface-600-400 hover:bg-surface-200-800 hover:text-surface-950-50'}"
				disabled={!!reason}
				title={reason ??
					`${d.label} (${shortcutLabel(d.shortcut, mac)})`}
				aria-label={d.label}
				aria-pressed={selected}
				aria-keyshortcuts={d.shortcut}
				data-lore-lens={d.id}
				onclick={() => onselect(d.id)}
			>
				<Icon size={16} aria-hidden="true" />
			</button>
		{/each}
	</div>
{/if}
