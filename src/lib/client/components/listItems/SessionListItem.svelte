<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		session: Sockets.Sessions.List.Response["sessionList"][0]
		onclick?: (
			session: Sockets.Sessions.List.Response["sessionList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		/** The currently-open chat — highlighted and pinned by the sidebar. */
		active?: boolean
	}

	let {
		session,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to session",
		classes = "",
		active = false
	}: Props = $props()

	const avatars = $derived([
		...(session.sessionCharacters || []).map((cc) => ({
			type: "character",
			data: cc.character
		})),
		...(session.sessionPersonas || []).map((cp) => ({
			type: "persona",
			data: cp.persona
		}))
	])

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(session)
	}
</script>

<SidebarListItem
	itemType="Session"
	onclick={handleClick}
	{contentTitle}
	classes={active
		? `preset-filled-primary-500/20 ring-primary-500 ring-2 ${classes}`
		: classes}
>
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
			<div class="flex items-center gap-2">
				<span class="truncate text-left font-semibold">
					{session.name || "Untitled Session"}
				</span>
				{#if session.modeName}
					<!-- The session's type (its mode): "Chat", or a custom
					     mode a plugin added. -->
					<span
						class="preset-tonal-secondary shrink-0 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
					>
						{session.modeName}
					</span>
				{/if}
				{#if active}
					<span
						class="text-primary-500 shrink-0 text-[10px] font-semibold tracking-wide uppercase"
					>
						Open
					</span>
				{/if}
			</div>
			<div class="text-muted-foreground line-clamp-2 text-left text-xs">
				{#if session.sessionCharacters?.length}
					{session.sessionCharacters
						.map(
							(cc) => cc.character?.nickname || cc.character?.name
						)
						.filter(Boolean)
						.join(", ")}
				{/if}
				{session.sessionPersonas?.length ? "," : ""}
				{#if session.sessionPersonas?.length}
					{session.sessionPersonas
						.map((cp) => cp.persona?.name)
						.filter(Boolean)
						.join(", ")}
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && session.canEdit && (onclick || onEdit || onDelete)}
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
						aria-label="Session options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-primary-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.MessageSquare
										size={18}
										aria-hidden="true"
									/>
									<p>Session Options</p>
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
												onEdit?.(session.id!)
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
									{#if onDelete && session.isOwner}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
											onclick={() => {
												menuOpen = false
												onDelete?.(session.id!)
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
