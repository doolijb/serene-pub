<script lang="ts">
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"

	interface Props {
		personaId: number
		onBack: () => void
		onEdit: () => void
		onChat: () => void
	}

	let { personaId, onBack, onEdit, onChat }: Props = $props()

	const socket = useTypedSocket()

	let persona = $state<
		(SelectPersona & { isOwner?: boolean; ownerName?: string | null }) | null
	>(null)
	let isLoading = $state(true)

	onMount(() => {
		socket.on("personas:get", (msg: Sockets.Personas.Get.Response) => {
			if (msg.persona?.id === personaId) {
				persona = msg.persona
				isLoading = false
			}
		})
		socket.emit("personas:get", { id: personaId } satisfies Sockets.Personas.Get.Params)
	})

	onDestroy(() => {
		socket.off("personas:get")
	})

	let tags = $derived(
		(persona as any)?.personaTags
			?.map((pt: any) => pt.tag?.name)
			.filter(Boolean) ?? []
	)
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 pb-3">
		<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={onBack} title="Back to list">
			<Icons.ChevronLeft size={16} />
		</button>
		<h2 class="flex-1 truncate font-semibold">{persona?.name || ""}</h2>
		<button class="btn btn-sm preset-filled-surface-400-600 p-2" onclick={onChat} title="Open chats">
			<Icons.MessageSquare size={14} />
		</button>
		{#if persona?.isOwner}
			<button class="btn btn-sm preset-filled-primary-500" onclick={onEdit} title="Edit persona">
				<Icons.Pencil size={14} /> Edit
			</button>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if persona}
		<div class="flex flex-1 flex-col gap-4 overflow-y-auto">
			<!-- Avatar + name -->
			<div class="flex items-center gap-3">
				<Avatar class="w-16 h-16 min-w-16 min-h-16">
					<Avatar.Image src={persona.avatar || ""} alt={persona.name} class="object-cover" />
					<Avatar.Fallback>
						<Icons.User size={32} />
					</Avatar.Fallback>
				</Avatar>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<p class="truncate text-lg font-bold">{persona.name}</p>
						{#if persona.isDefault}
							<span class="preset-filled-primary-500 rounded px-1.5 py-0.5 text-xs font-medium">
								Default
							</span>
						{/if}
					</div>
					{#if !persona.isOwner && persona.ownerName}
						<p class="text-surface-700-300 truncate text-xs">Owned by {persona.ownerName}</p>
					{/if}
				</div>
			</div>

			<!-- Tags -->
			{#if tags.length > 0}
				<div class="flex flex-wrap gap-1">
					{#each tags as tag}
						<span class="preset-tonal-surface rounded px-2 py-0.5 text-xs">{tag}</span>
					{/each}
				</div>
			{/if}

			<!-- Description -->
			{#if persona.description}
				<section class="space-y-1">
					<p class="text-surface-700-300 text-xs font-semibold uppercase tracking-wide">Description</p>
					<p class="whitespace-pre-wrap text-sm leading-relaxed">{persona.description}</p>
				</section>
			{/if}
		</div>
	{:else}
		<p class="text-surface-700-300 py-8 text-center text-sm">Persona not found.</p>
	{/if}
</div>
