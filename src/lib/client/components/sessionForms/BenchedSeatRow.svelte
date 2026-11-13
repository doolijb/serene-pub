<script lang="ts">
	/**
	 * One benched seat on the Participants tab: the seated row's anatomy (grip,
	 * face, name, one muted meta line) and then **Bring back** with the ⋯ menu.
	 * The form owns every decision; this draws the row. A fallen seat shows a
	 * Skull and "Fell in the story" in place of its meta line.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import RowMenu, { type RowMenuEntries } from "../menus/RowMenu.svelte"

	interface Props {
		name: string
		meta?: string
		fallen?: boolean
		/** `data-seat-action`, so the form finds the button after a move. */
		seatAction: string
		/** Draw the drag grip (the row is in a dndzone). */
		grip?: boolean
		/** False where this person may not change the seat (a guest on another's). */
		canBringBack?: boolean
		menuItems: RowMenuEntries
		onBringBack: () => void
		face: Snippet
	}

	let {
		name,
		meta = "",
		fallen = false,
		seatAction,
		grip = false,
		canBringBack = true,
		menuItems,
		onBringBack,
		face
	}: Props = $props()

	const hasMenu = $derived(menuItems.some((e) => !!e))
</script>

<li
	class="border-surface-200-800 rounded-base flex min-h-11 flex-wrap items-center gap-2 border p-2"
	data-dnd-handle
>
	{#if grip}
		<span
			class="text-surface-500 hover:text-primary-ink shrink-0 cursor-grab"
			data-dnd-handle
			title="Drag to bring back"
		>
			<Icons.GripVertical size={16} aria-hidden="true" />
		</span>
	{/if}
	{@render face()}
	<div class="min-w-0 flex-1">
		<div class="text-lead truncate font-medium select-none">{name}</div>
		{#if fallen}
			<div
				class="text-surface-600 dark:text-surface-400 flex items-center gap-1 truncate text-xs select-none"
			>
				<Icons.Skull size={16} aria-hidden="true" class="shrink-0" />
				Fell in the story
			</div>
		{:else if meta}
			<div
				class="text-surface-600 dark:text-surface-400 truncate text-xs select-none"
			>
				{meta}
			</div>
		{/if}
	</div>
	<div class="flex shrink-0 items-center gap-1">
		{#if canBringBack}
			<button
				type="button"
				class="btn btn-sm preset-tonal"
				data-seat-action={seatAction}
				aria-label="Bring back {name}"
				onclick={onBringBack}
			>
				Bring back
			</button>
		{/if}
		{#if hasMenu}
			<RowMenu
				items={menuItems}
				label={name}
				triggerLabel="More actions for {name}"
			/>
		{/if}
	</div>
</li>
