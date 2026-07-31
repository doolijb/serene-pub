<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		lorebook: any
		onclick?: (lorebook: any) => void
		onDelete?: (id: number) => void
		onExport?: (id: number) => void
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
		onDelete,
		onExport,
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
		{#if showControls && (onclick || onDelete || onExport)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm hover:bg-primary-600-400 shrink-0 p-3 {menuOpen
							? 'bg-primary-600-400'
							: ''}"
						aria-label="Lorebook options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-primary-200-800 w-[min(90vw,260px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.BookOpen
										size={18}
										aria-hidden="true"
									/>
									<p>Lorebook Options</p>
								</header>
								<article class="flex flex-col gap-2">
									{#if onclick}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												handleClick()
											}}
											type="button"
										>
											<Icons.Eye
												size={16}
												aria-hidden="true"
											/>
											<span>View</span>
										</button>
									{/if}
									{#if hasOpenChat && (onAttachToChat || onDetachFromChat)}
										{#if isOpenChatLorebook}
											<button
												class="btn btn-sm popover-menu-btn hover:preset-filled-warning-500"
												onclick={() => {
													menuOpen = false
													onDetachFromChat?.(
														lorebook.id!
													)
												}}
												type="button"
											>
												<Icons.Unlink
													size={16}
													aria-hidden="true"
												/>
												<span>
													Detach from current chat
												</span>
											</button>
										{:else}
											<button
												class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
												disabled={openChatHasLorebook}
												title={openChatHasLorebook
													? "The current chat already has a lorebook attached"
													: "Attach to current chat"}
												onclick={() => {
													menuOpen = false
													onAttachToChat?.(
														lorebook.id!
													)
												}}
												type="button"
											>
												<Icons.Link
													size={16}
													aria-hidden="true"
												/>
												<span>
													Attach to current chat
												</span>
											</button>
										{/if}
									{/if}
									{#if onExport}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onExport?.(lorebook.id!)
											}}
											type="button"
										>
											<Icons.Download
												size={16}
												aria-hidden="true"
											/>
											<span>Export</span>
										</button>
									{/if}
									{#if onDelete}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
											onclick={() => {
												menuOpen = false
												onDelete?.(lorebook.id!)
											}}
											type="button"
										>
											<Icons.Trash2
												size={16}
												aria-hidden="true"
											/>
											<span>Delete</span>
										</button>
									{/if}
								</article>
								<Popover.Arrow>
									<Popover.ArrowTip
										class="!bg-primary-200 dark:!bg-primary-800"
									/>
								</Popover.Arrow>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		{/if}
	{/snippet}
</SidebarListItem>
