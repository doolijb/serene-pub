<script lang="ts">
	import { Popover } from "@skeletonlabs/skeleton-svelte"
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
		showControls?: boolean
		contentTitle?: string
		classes?: string
	}

	let {
		persona,
		onclick,
		onEdit,
		onDelete,
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
		<Avatar
			src={persona.avatar || ""}
			size="w-[4em] h-[4em] min-w-[4em] min-h-[4em]"
			imageClasses="object-cover"
			name={persona.name!}
		>
			<Icons.User size={36} />
		</Avatar>
		<div class="relative flex flex-1 gap-2">
			<div class="relative flex-1">
				<div class="flex items-center gap-1 text-left font-semibold">
					<span class="truncate">{persona.name}</span>
					<EmbeddingStatusIcon embeddingModel={persona.embeddingModel} />
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
		{#if showControls && (onclick || onEdit || onDelete)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
					triggerBase="btn btn-sm preset-filled-surface-400-600 p-1 shrink-0"
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
								onclick={() => { menuOpen = false; onEdit?.(persona.id!) }}
								type="button"
							>
								<Icons.Pencil size={14} /> Edit
							</button>
						{/if}
						{#if onDelete}
							<hr class="border-surface-300-700" />
							<button
								class="btn btn-sm preset-filled-error-500 w-full justify-start"
								onclick={() => { menuOpen = false; onDelete?.(persona.id!) }}
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
