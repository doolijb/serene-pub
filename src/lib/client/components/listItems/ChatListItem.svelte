<script lang="ts">
	import { Popover } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		chat: Sockets.Chats.List.Response["chatList"][0]
		onclick?: (chat: Sockets.Chats.List.Response["chatList"][0]) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
	}

	let {
		chat,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to chat",
		classes = ""
	}: Props = $props()

	const avatars = $derived([
		...(chat.chatCharacters || []).map((cc) => ({
			type: "character",
			data: cc.character
		})),
		...(chat.chatPersonas || []).map((cp) => ({
			type: "persona",
			data: cp.persona
		}))
	])

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(chat)
	}
</script>

<SidebarListItem itemType="Chat" onclick={handleClick} {contentTitle} {classes}>
	{#snippet content()}
		<div class="relative w-fit">
			<div
				class="relative mr-2 flex flex-shrink-0 flex-grow-0 items-center"
			>
				{#if avatars.length <= 2}
					{#each avatars as avatar, i}
						<div
							class="inline-block"
							style="margin-left: {i === 0
								? '0'
								: '-0.7em'}; z-index: {10 - i};"
						>
							<Avatar char={avatar.data} />
						</div>
					{/each}
				{:else}
					{#each avatars.slice(0, 3) as avatar, i}
						<div
							class="ml-[-2.25em] inline-block first:ml-0"
							style="z-index: {10 - i};"
						>
							<Avatar char={avatar.data} />
						</div>
					{/each}
					{#if avatars.length > 3}
						<div
							class="preset-tonal-secondary relative z-1 mb-auto aspect-square rounded-full px-1 pt-[0.15em] text-xs select-none"
						>
							+{avatars.length - 3}
						</div>
					{/if}
				{/if}
			</div>
		</div>
		<div class="flex min-w-0 flex-col">
			<div class="truncate text-left font-semibold">
				{chat.name || "Untitled Chat"}
			</div>
			<div class="text-muted-foreground line-clamp-2 text-left text-xs">
				{#if chat.chatCharacters?.length}
					{chat.chatCharacters
						.map(
							(cc) => cc.character?.nickname || cc.character?.name
						)
						.filter(Boolean)
						.join(", ")}
				{/if}
				{chat.chatPersonas?.length ? "," : ""}
				{#if chat.chatPersonas?.length}
					{chat.chatPersonas
						.map((cp) => cp.persona?.name)
						.filter(Boolean)
						.join(", ")}
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && chat.canEdit && (onclick || onEdit || onDelete)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
					triggerBase="btn btn-sm preset-tonal-surface p-1 shrink-0"
					contentBase="card bg-surface-100-900 shadow-xl p-2 flex flex-col gap-1 min-w-32"
					zIndex="1000"
				>
					{#snippet trigger()}
						<Icons.Ellipsis size={16} />
					{/snippet}
					{#snippet content()}
						{#if onclick}
							<button
								class="btn btn-sm preset-tonal-surface w-full justify-start"
								onclick={() => { menuOpen = false; handleClick() }}
								type="button"
							>
								<Icons.Eye size={14} /> View
							</button>
						{/if}
						{#if onEdit}
							<button
								class="btn btn-sm preset-tonal-surface w-full justify-start"
								onclick={() => { menuOpen = false; onEdit?.(chat.id!) }}
								type="button"
							>
								<Icons.Pencil size={14} /> Edit
							</button>
						{/if}
						{#if onDelete}
							<hr class="border-surface-300-700" />
							<button
								class="btn btn-sm preset-filled-error-500 w-full justify-start"
								onclick={() => { menuOpen = false; onDelete?.(chat.id!) }}
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
