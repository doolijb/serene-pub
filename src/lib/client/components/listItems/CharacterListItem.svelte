<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		character: Sockets.Characters.List.Response["characterList"][0]
		onclick?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		onExport?: (
			character: Sockets.Characters.List.Response["characterList"][0]
		) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
	}

	let {
		character,
		onclick,
		onEdit,
		onDelete,
		onExport,
		showControls = true,
		contentTitle = "Go to character",
		classes = ""
	}: Props = $props()

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(character)
	}
</script>

<SidebarListItem
	id={character.id}
	onclick={handleClick}
	{contentTitle}
	itemType="Character"
	classes={character.isFavorite
		? "border border-primary-500 " + classes
		: classes}
>
	{#snippet content()}
		<Avatar class="h-[4em] min-h-[4em] w-[4em] min-w-[4em]">
			<Avatar.Image
				src={avatarSrc(character) || ""}
				alt={character.nickname || character.name!}
				class="object-cover"
			/>
			<Avatar.Fallback>
				<Icons.User size={36} aria-hidden="true" />
			</Avatar.Fallback>
		</Avatar>
		<div class="relative flex min-w-0 flex-1 gap-2">
			<div class="relative min-w-0 flex-1">
				<div
					class="flex items-center gap-1 text-left font-semibold"
					id="character-name-{character.id}"
				>
					<span class="truncate">
						{character.nickname || character.name}
					</span>
					<EmbeddingStatusIcon
						embeddingModel={character.embeddingModel}
					/>
				</div>
				{#if character.description}
					<div
						class="text-muted-foreground line-clamp-2 text-left text-xs"
						id="character-desc-{character.id}"
					>
						{character.description}
					</div>
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onEdit || onExport || onDelete)}
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
						aria-label="Character options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-primary-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.User size={18} aria-hidden="true" />
									<p>Character Options</p>
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
									{#if onEdit}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onEdit?.(character.id!)
											}}
											type="button"
										>
											<Icons.Pencil
												size={16}
												aria-hidden="true"
											/>
											<span>Edit</span>
										</button>
									{/if}
									{#if onExport}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onExport?.(character)
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
												onDelete?.(character.id!)
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
