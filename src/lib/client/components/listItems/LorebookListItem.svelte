<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID,
		ITEM_TYPE_ID,
		LOCATION_TYPE_ID,
		WORLD_LORE_TYPE_ID
	} from "$lib/shared/entries/types"
	import {
		READ_INTO_SESSION,
		STOP_READING
	} from "$lib/client/lorebooks/scopes"

	interface Props {
		lorebook: any
		onclick?: (lorebook: any) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		bindingsCount?: number
		/**
		 * The server's figures, keyed by entry type id (`lorebooks:list`'s
		 * `entryCounts`, archived rows excluded). Falls back to the row's own.
		 */
		entryCounts?: Record<string, number>
		hasOpenSession?: boolean
		openSessionHasLorebook?: boolean
		isOpenSessionLorebook?: boolean
		/**
		 * Read this book into the open session. The caller confirms when the
		 * session already reads another book, since this replaces it.
		 */
		onAttachToSession?: (id: number) => void
		onDetachFromSession?: (id: number) => void
	}

	let {
		lorebook,
		onclick,
		onDelete,
		showControls = true,
		contentTitle = "Go to lorebook",
		classes = "",
		bindingsCount = 0,
		entryCounts,
		hasOpenSession = false,
		openSessionHasLorebook = false,
		isOpenSessionLorebook = false,
		onAttachToSession,
		onDetachFromSession
	}: Props = $props()

	let counts = $derived<Record<string, number>>(
		entryCounts ?? lorebook?.entryCounts ?? {}
	)

	/** One chip per kind the book holds, in the pool's order. */
	let kindChips = $derived(
		[
			{ typeId: WORLD_LORE_TYPE_ID, title: "World lore", icon: Icons.Globe },
			{
				typeId: CHARACTER_LORE_TYPE_ID,
				title: "Character lore",
				icon: Icons.User
			},
			{ typeId: HISTORY_TYPE_ID, title: "History", icon: Icons.Clock },
			{ typeId: LOCATION_TYPE_ID, title: "Places", icon: Icons.MapPin },
			{ typeId: ITEM_TYPE_ID, title: "Items", icon: Icons.Package }
		]
			.map((chip) => ({ ...chip, count: counts[chip.typeId] ?? 0 }))
			.filter((chip) => chip.count > 0)
	)

	function handleClick() {
		onclick?.(lorebook)
	}
</script>

<SidebarListItem
	itemType="Lorebook"
	id={lorebook.id}
	onclick={handleClick}
	{contentTitle}
	{classes}
>
	{#snippet content()}
		<div class="flex w-full items-center gap-2">
			<div class="relative flex min-w-0 flex-1 gap-2">
				<div class="relative min-w-0 flex-1">
					<div class="truncate text-left font-semibold">
						{lorebook.name}
					</div>
					{#if lorebook.description}
						<div
							class="text-surface-600-400 line-clamp-2 text-left text-xs"
						>
							{lorebook.description}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/snippet}
	{#snippet extraContent()}
		<div class="flex gap-2 text-xs">
			{#if bindingsCount > 0}
				<div class="flex items-center gap-1" title="Cast members">
					<Icons.Users size={12} aria-hidden="true" />
					{bindingsCount}
				</div>
			{/if}
			{#each kindChips as chip (chip.typeId)}
				<div class="flex items-center gap-1" title={chip.title}>
					<chip.icon size={12} aria-hidden="true" />
					{chip.count}
				</div>
			{/each}
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onDelete)}
			{@const sessionActions =
				hasOpenSession && (onAttachToSession || onDetachFromSession)}
			<RowMenu
				label="Lorebook"
				width={260}
				triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 shrink-0 p-3"
				items={[
					onclick && {
						label: "View",
						icon: Icons.Eye,
						onSelect: handleClick
					},
					sessionActions &&
						isOpenSessionLorebook && {
							label: STOP_READING,
							icon: Icons.BookX,
							title: "Stop reading this book into the open session",
							onSelect: () => onDetachFromSession?.(lorebook.id!)
						},
					sessionActions &&
						!isOpenSessionLorebook && {
							label: READ_INTO_SESSION,
							icon: Icons.BookOpen,
							title: openSessionHasLorebook
								? "The open session reads another book; this asks before replacing it"
								: "Read this book into the open session",
							onSelect: () => onAttachToSession?.(lorebook.id!)
						},
					// Paused (owner ruling 2026-09-28): shown, disabled, with
					// the reason on the row.
					{
						label: "Export (paused)",
						icon: Icons.Download,
						disabled: true,
						title: LOREBOOK_EXPORT_PAUSED,
						onSelect: () => {}
					},
					onDelete && { separator: true },
					onDelete && {
						label: "Delete",
						icon: Icons.Trash2,
						destructive: true,
						onSelect: () => onDelete?.(lorebook.id!)
					}
				]}
			/>
		{/if}
	{/snippet}
</SidebarListItem>
