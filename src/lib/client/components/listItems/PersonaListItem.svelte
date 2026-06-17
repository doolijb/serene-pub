<script lang="ts">
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

	function handleClick() {
		onclick?.(persona)
	}

	function handleEditClick(e: MouseEvent) {
		e.stopPropagation()
		onEdit?.(persona.id!)
	}

	function handleDeleteClick(e: MouseEvent) {
		e.stopPropagation()
		onDelete?.(persona.id!)
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
		{#if showControls && (onEdit || onDelete)}
			<div class="flex flex-col gap-4">
				{#if onEdit}
					<button
						class="btn btn-sm text-primary-500 p-2"
						onclick={handleEditClick}
						title="Edit Persona"
					>
						<Icons.Edit size={16} />
					</button>
				{/if}
				{#if onDelete}
					<button
						class="btn btn-sm text-error-500 p-2"
						onclick={handleDeleteClick}
						title="Delete Persona"
					>
						<Icons.Trash2 size={16} />
					</button>
				{/if}
			</div>
		{/if}
	{/snippet}
</SidebarListItem>
