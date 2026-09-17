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
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
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

	let menuOpen = $state(false)
</script>

<div class="flex min-w-0 items-center gap-1 py-1">
	<button
		type="button"
		class="hover:text-foreground text-surface-300 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 text-left"
		aria-expanded={expanded}
		onclick={onToggle}
	>
		{#if expanded}
			<Icons.FolderOpen
				size={16}
				class="text-surface-400 shrink-0"
				aria-hidden="true"
			/>
		{:else}
			<Icons.Folder
				size={16}
				class="text-surface-400 shrink-0"
				aria-hidden="true"
			/>
		{/if}
		<span class="min-w-0 truncate text-[13px] font-medium">{name}</span>
		<span class="text-surface-500 shrink-0 text-xs">{count}</span>
	</button>
	<div role="none">
		<Popover
			open={menuOpen}
			onOpenChange={(e) => (menuOpen = e.open)}
			positioning={{ placement: "bottom-end" }}
		>
			<Popover.Trigger
				class="btn btn-sm hover:bg-primary-600-400 shrink-0 p-2 {menuOpen
					? 'bg-primary-600-400'
					: ''}"
				aria-label="Folder options: {name}"
			>
				<Icons.EllipsisVertical size={16} aria-hidden="true" />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card bg-surface-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
					>
						<header class="popover-menu-title">
							<Icons.Folder size={18} aria-hidden="true" />
							<p>Folder Options</p>
						</header>
						<article class="flex flex-col gap-2">
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								type="button"
								onclick={() => {
									menuOpen = false
									onRename()
								}}
							>
								<Icons.Pencil size={16} aria-hidden="true" />
								<span>Rename</span>
							</button>
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
								type="button"
								onclick={() => {
									menuOpen = false
									onDelete()
								}}
							>
								<Icons.Trash2 size={16} aria-hidden="true" />
								<span>Delete</span>
							</button>
						</article>
						<Popover.Arrow>
							<Popover.ArrowTip
								class="!bg-surface-200 dark:!bg-surface-800"
							/>
						</Popover.Arrow>
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	</div>
</div>
