<script lang="ts">
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount } from "svelte"

	interface Props {
		chatId: number
		onBack: () => void
		onEdit: () => void
		onOpen: () => void
		canEdit?: boolean
	}

	let { chatId, onBack, onEdit, onOpen, canEdit = true }: Props = $props()

	const socket = useTypedSocket()

	let chat = $state<Sockets.Chats.Get.Response["chat"] | null>(null)
	let isLoading = $state(true)

	onMount(() => {
		socket.on("chats:get", (msg: Sockets.Chats.Get.Response) => {
			if (msg.chat?.id === chatId) {
				chat = msg.chat
				isLoading = false
			}
		})
		socket.emit("chats:get", { id: chatId } satisfies Sockets.Chats.Get.Params)
	})

	onDestroy(() => {
		socket.off("chats:get")
	})

	let characters = $derived(
		(chat as any)?.chatCharacters?.map((cc: any) => cc.character).filter(Boolean) ?? []
	)
	let personas = $derived(
		(chat as any)?.chatPersonas?.map((cp: any) => cp.persona).filter(Boolean) ?? []
	)
	let tags = $derived((chat as any)?.tags ?? [])
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 pb-3">
		<button class="btn btn-sm preset-tonal-surface p-2" onclick={onBack} title="Back to chats">
			<Icons.ChevronLeft size={16} />
		</button>
		<h2 class="flex-1 truncate font-semibold">{chat?.name || "Chat"}</h2>
		<button class="btn btn-sm preset-tonal-surface p-2" onclick={onOpen} title="Open chat">
			<Icons.MessageSquare size={14} />
		</button>
		{#if canEdit}
			<button class="btn btn-sm preset-filled-primary-500" onclick={onEdit} title="Edit chat">
				<Icons.Pencil size={14} /> Edit
			</button>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if chat}
		<div class="flex flex-1 flex-col gap-4 overflow-y-auto">
			<!-- Characters -->
			{#if characters.length > 0}
				<section class="space-y-2">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
						Characters
					</p>
					<div class="flex flex-col gap-2">
						{#each characters as c}
							<div class="flex items-center gap-2">
								<Avatar
									src={c.avatar || ""}
									size="w-8 h-8 min-w-8 min-h-8"
									imageClasses="object-cover"
									name={c.nickname || c.name}
								>
									<Icons.User size={16} />
								</Avatar>
								<span class="truncate text-sm font-medium">{c.nickname || c.name}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Personas -->
			{#if personas.length > 0}
				<section class="space-y-2">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">
						Personas
					</p>
					<div class="flex flex-col gap-2">
						{#each personas as p}
							<div class="flex items-center gap-2">
								<Avatar
									src={p.avatar || ""}
									size="w-8 h-8 min-w-8 min-h-8"
									imageClasses="object-cover"
									name={p.name}
								>
									<Icons.UserCog size={16} />
								</Avatar>
								<span class="truncate text-sm font-medium">{p.name}</span>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Scenario -->
			{#if chat.scenario}
				<section class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Scenario</p>
					<p class="whitespace-pre-wrap text-sm leading-relaxed">{chat.scenario}</p>
				</section>
			{/if}

			<!-- Tags -->
			{#if tags.length > 0}
				<section class="space-y-1">
					<p class="text-surface-500 text-xs font-semibold uppercase tracking-wide">Tags</p>
					<div class="flex flex-wrap gap-1">
						{#each tags as tag}
							<span class="preset-tonal-surface rounded px-2 py-0.5 text-xs">{tag}</span>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{:else}
		<p class="text-surface-500 py-8 text-center text-sm">Chat not found.</p>
	{/if}
</div>
