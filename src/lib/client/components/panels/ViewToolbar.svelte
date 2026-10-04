<script lang="ts">
	/**
	 * The top of a sidebar view's list (STYLE-GUIDE §6.3, the view toolbar;
	 * notes 25, 2026-10-02). One shape for every view, so the same control is
	 * in the same place whichever rail item opened it:
	 *
	 *   1. the ACTION row — the view's one primary, labelled and filled
	 *      (`New`, or a New menu's trigger), at the start; secondary actions
	 *      as 40px tonal icon buttons with a tooltip and an accessible name at
	 *      the end; a `⋯` for the rest after them, last.
	 *   2. the FIND row — the filter box takes the room; the filter popout and
	 *      the list/card pair are icon buttons pinned after it.
	 *   3. the CHIPS row — every narrowing in force, said once; absent when
	 *      nothing narrows.
	 *
	 * Rows with nothing in them are not drawn. The buttons themselves are the
	 * caller's (a New menu is a Popover trigger, not a button this component
	 * could own); `toolbarButtonClass` is the recipe the icon ones wear.
	 */
	import type { Snippet } from "svelte"
	import RowMenu, { type RowMenuEntries } from "../menus/RowMenu.svelte"
	import { toolbarButtonClass } from "./toolbarButton"

	interface Props {
		/** The view's noun, for the groups' accessible names, eg. "Sessions". */
		label: string
		/** The labelled, filled primary — or the New menu's trigger. */
		primary?: Snippet
		/** Secondary actions: icon buttons (`toolbarButtonClass()`), each with
		    `title` and `aria-label`. */
		actions?: Snippet
		/** The `⋯` overflow's items, with full text labels. */
		menuItems?: RowMenuEntries
		/** The filter box (`PanelFilterInput`); it takes the find row's room. */
		filter?: Snippet
		/** The filter popout and the list/card pair, after the box. */
		filterActions?: Snippet
		/** The narrowings in force, as dismissible chips. */
		chips?: Snippet
		class?: string
	}

	let {
		label,
		primary,
		actions,
		menuItems,
		filter,
		filterActions,
		chips,
		class: className = ""
	}: Props = $props()

	const hasMenu = $derived(!!menuItems?.some(Boolean))
</script>

<div class="flex min-w-0 shrink-0 flex-col gap-2 {className}" data-view-toolbar>
	{#if primary || actions || hasMenu}
		<div
			class="flex min-w-0 items-center gap-2"
			role="group"
			aria-label="{label} actions"
			data-view-toolbar-actions
		>
			{@render primary?.()}
			<div class="min-w-0 flex-1"></div>
			{@render actions?.()}
			{#if hasMenu}
				<RowMenu
					items={menuItems!}
					label={label}
					triggerLabel="More for {label.toLowerCase()}"
					triggerTitle="More"
					triggerClass={toolbarButtonClass()}
				/>
			{/if}
		</div>
	{/if}
	{#if filter || filterActions}
		<div class="flex min-w-0 items-center gap-2" data-view-toolbar-find>
			{#if filter}
				<div class="min-w-0 flex-1">
					{@render filter()}
				</div>
			{/if}
			{@render filterActions?.()}
		</div>
	{/if}
	{#if chips}
		<div
			class="flex min-w-0 flex-wrap items-center gap-2 empty:hidden"
			data-view-toolbar-chips
		>
			{@render chips()}
		</div>
	{/if}
</div>
