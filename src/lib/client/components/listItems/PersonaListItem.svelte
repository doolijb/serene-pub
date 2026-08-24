<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import EmbeddingStatusIcon from "../EmbeddingStatusIcon.svelte"

	interface Props {
		persona: Sockets.Personas.List.Response["personaList"][0]
		onclick?: (
			persona: Sockets.Personas.List.Response["personaList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		onExport?: (
			persona: Sockets.Personas.List.Response["personaList"][0]
		) => void
		onSetDefault?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
	}

	let {
		persona,
		onclick,
		onEdit,
		onDelete,
		onExport,
		onSetDefault,
		showControls = true,
		contentTitle = "Go to persona",
		classes = ""
	}: Props = $props()

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(persona)
	}
</script>

<SidebarListItem
	id={persona.id}
	onclick={handleClick}
	{contentTitle}
	itemType="Persona"
	{classes}
>
	{#snippet content()}
		<Avatar char={persona} size="w-[4em] h-[4em] min-w-[4em] min-h-[4em]" />
		<div class="relative flex min-w-0 flex-1 gap-2">
			<div class="relative min-w-0 flex-1">
				<div class="flex items-center gap-1 text-left font-semibold">
					<span class="truncate">{persona.name}</span>
					{#if persona.isDefault}
						<span
							class="bg-primary-500 shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-medium text-white"
						>
							Default
						</span>
					{/if}
					<EmbeddingStatusIcon
						embeddingModel={persona.embeddingModel}
					/>
				</div>
				{#if persona.description}
					<div
						class="text-muted-foreground line-clamp-2 text-left text-xs"
					>
						{persona.description}
					</div>
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && (onclick || onEdit || onExport || onDelete || onSetDefault)}
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
						aria-label="Persona options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-primary-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.UserCog
										size={18}
										aria-hidden="true"
									/>
									<p>Persona Options</p>
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
												onEdit?.(persona.id!)
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
												onExport?.(persona)
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
									{#if onSetDefault}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											disabled={persona.isDefault}
											onclick={() => {
												menuOpen = false
												onSetDefault?.(persona.id!)
											}}
											type="button"
										>
											<Icons.Star
												size={16}
												aria-hidden="true"
											/>
											<span>
												{persona.isDefault
													? "Default"
													: "Set as default"}
											</span>
										</button>
									{/if}
									{#if onDelete}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
											onclick={() => {
												menuOpen = false
												onDelete?.(persona.id!)
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
