<script lang="ts">
	/**
	 * A character folder's header row (STYLE-GUIDE §6.4).
	 *
	 * The header IS the collapse control — a `<button aria-expanded>` across the
	 * row rather than a chevron the pointer has to hit — and it sits on the same
	 * ground as the rows below it, separated only by its own `py-1`. No card, no
	 * rule: the indent of the rows underneath is what says they belong to it.
	 *
	 * The ⋯ menu is a sibling of that button, never inside it: a button inside a
	 * button is invalid, and the two actions it holds (rename, delete) are the
	 * folder's, not the group's expanded state.
	 */
	import RowMenu from "../menus/RowMenu.svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		name: string
		/** How many rows are showing under it RIGHT NOW, after the filter. */
		count: number
		expanded: boolean
		onToggle: () => void
		onRename: () => void
		onDelete: () => void
	}

	let { name, count, expanded, onToggle, onRename, onDelete }: Props =
		$props()
</script>

<div class="flex min-w-0 items-center gap-1 py-1">
	<button
		type="button"
		class="hover:text-foreground text-surface-800-200 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left"
		aria-expanded={expanded}
		onclick={onToggle}
	>
		{#if expanded}
			<Icons.FolderOpen
				size={16}
				class="text-surface-600-400 shrink-0"
				aria-hidden="true"
			/>
		{:else}
			<Icons.Folder
				size={16}
				class="text-surface-600-400 shrink-0"
				aria-hidden="true"
			/>
		{/if}
		<span class="min-w-0 truncate text-[13px] font-medium">{name}</span>
		<span class="text-surface-600-400 shrink-0 text-xs">{count}</span>
	</button>
	<RowMenu
		label="Folder"
		triggerLabel="Folder options: {name}"
		items={[
			{ label: "Rename", icon: Icons.Pencil, onSelect: onRename },
			{ separator: true },
			{
				label: "Delete",
				icon: Icons.Trash2,
				destructive: true,
				onSelect: onDelete
			}
		]}
	/>
</div>
