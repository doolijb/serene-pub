<script lang="ts">
	import { Popover } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		lorebook: any
		onclick?: (lorebook: any) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		bindingsCount?: number
		worldEntriesCount?: number
		characterEntriesCount?: number
		historyEntriesCount?: number
		hasOpenChat?: boolean
		openChatHasLorebook?: boolean
		isOpenChatLorebook?: boolean
		onAttachToChat?: (id: number) => void
		onDetachFromChat?: (id: number) => void
	}

	let {
		lorebook,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to lorebook",
		classes = "",
		bindingsCount = 0,
		worldEntriesCount = 0,
		characterEntriesCount = 0,
		historyEntriesCount = 0,
		hasOpenChat = false,
		openChatHasLorebook = false,
		isOpenChatLorebook = false,
		onAttachToChat,
		onDetachFromChat
	}: Props = $props()

	let menuOpen = $state(false)

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
							class="text-muted-foreground line-clamp-2 text-left text-xs"
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
				<div class="flex items-center gap-1" title="Bindings">
					<Icons.Link size={12} />
					{bindingsCount}
				</div>
			{/if}
			{#if worldEntriesCount > 0}
				<div class="flex items-center gap-1" title="World entries">
					<Icons.Globe size={12} />
					{worldEntriesCount}
				</div>
			{/if}
			{#if characterEntriesCount > 0}
				<div class="flex items-center gap-1" title="Character entries">
					<Icons.User size={12} />
					{characterEntriesCount}
				</div>
			{/if}
			{#if historyEntriesCount > 0}
				<div class="flex items-center gap-1" title="History entries">
					<Icons.Clock size={12} />
					{historyEntriesCount}
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onEdit || onDelete)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
					triggerBase="btn btn-sm preset-filled-surface-400-600 p-1 shrink-0"
					triggerAriaLabel="Lorebook options"
					contentBase="card bg-surface-100-900 shadow-xl p-2 flex flex-col gap-1 min-w-32"
					zIndex="1000"
				>
					{#snippet trigger()}
						<Icons.Ellipsis size={16} />
					{/snippet}
					{#snippet content()}
						{#if onclick}
							<button
								class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
								onclick={() => { menuOpen = false; handleClick() }}
								type="button"
							>
								<Icons.Eye size={14} /> View
							</button>
						{/if}
						{#if onEdit}
							<button
								class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
								onclick={() => { menuOpen = false; onEdit?.(lorebook.id!) }}
								type="button"
							>
								<Icons.Pencil size={14} /> Edit
							</button>
						{/if}
						{#if hasOpenChat && (onAttachToChat || onDetachFromChat)}
							<hr class="border-surface-300-700" />
							{#if isOpenChatLorebook}
								<button
									class="btn btn-sm preset-filled-warning-500 w-full justify-start"
									onclick={() => { menuOpen = false; onDetachFromChat?.(lorebook.id!) }}
									type="button"
								>
									<Icons.Unlink size={14} /> Detach from current chat
								</button>
							{:else}
								<button
									class="btn btn-sm preset-filled-success-500 w-full justify-start"
									disabled={openChatHasLorebook}
									title={openChatHasLorebook
										? "The current chat already has a lorebook attached"
										: "Attach to current chat"}
									onclick={() => { menuOpen = false; onAttachToChat?.(lorebook.id!) }}
									type="button"
								>
									<Icons.Link size={14} /> Attach to current chat
								</button>
							{/if}
						{/if}
						{#if onDelete}
							<hr class="border-surface-300-700" />
							<button
								class="btn btn-sm preset-filled-error-500 w-full justify-start"
								onclick={() => { menuOpen = false; onDelete?.(lorebook.id!) }}
								type="button"
							>
								<Icons.Trash2 size={14} /> Delete
							</button>
						{/if}
					{/snippet}
				</Popover>
			</div>
		{/if}
	{/snippet}
</SidebarListItem>
