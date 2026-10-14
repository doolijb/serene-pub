<script lang="ts">
	/**
	 * A character folder's header row (STYLE-GUIDE §6.4).
	 *
	 * It wears the group label's look (`ListGroupLabel`: 12px muted words, the
	 * text 16px under the group above, no rule) because it IS the label of the
	 * rows below it — but it is also the collapse control, so it is a
	 * `<button aria-expanded>` across the row rather than a chevron the pointer
	 * has to hit. The 32px hit area comes from the button's padding, not a fixed
	 * height. No card, no rule: the indent of the rows underneath is what says
	 * they belong to it.
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

<!-- `pt-2` + the button's `py-2` put the words where `ListGroupLabel`'s
     `pt-4` does. -->
<div class="flex min-w-0 items-center gap-1 pt-2">
	<button
		type="button"
		class="text-surface-600-400 hover:text-surface-950-50 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs"
		aria-expanded={expanded}
		onclick={onToggle}
	>
		<Icons.ChevronRight
			size={14}
			class="shrink-0 transition-transform {expanded ? 'rotate-90' : ''}"
			aria-hidden="true"
		/>
		{#if expanded}
			<Icons.FolderOpen size={14} class="shrink-0" aria-hidden="true" />
		{:else}
			<Icons.Folder size={14} class="shrink-0" aria-hidden="true" />
		{/if}
		<span class="min-w-0 truncate">{name}</span>
		<span class="shrink-0 tabular-nums">{count}</span>
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
