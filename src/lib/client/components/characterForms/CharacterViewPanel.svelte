<script lang="ts">
	import { Avatar, Tabs } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount, getContext } from "svelte"
	import EntityGalleryTab from "$lib/client/components/gallery/EntityGalleryTab.svelte"

	interface Props {
		characterId: number
		onBack: () => void
		onEdit: () => void
		onChat: () => void
		onExport?: (
			character: SelectCharacter & {
				isOwner?: boolean
				ownerName?: string | null
			}
		) => void
	}

	let { characterId, onBack, onEdit, onChat, onExport }: Props = $props()

	const socket = useTypedSocket()

	let character = $state<
		| (SelectCharacter & { isOwner?: boolean; ownerName?: string | null })
		| null
	>(null)
	let isLoading = $state(true)

	onMount(() => {
		socket.on("characters:get", (msg: Sockets.Characters.Get.Response) => {
			if (msg.character?.id === characterId) {
				character = msg.character
				isLoading = false
			}
		})
		socket.emit("characters:get", {
			id: characterId
		} satisfies Sockets.Characters.Get.Params)
	})

	onDestroy(() => {
		socket.off("characters:get")
	})

	let tags = $derived(
		(character as any)?.characterTags
			?.map((ct: any) => ct.tag?.name)
			.filter(Boolean) ?? []
	)

	let activeTab = $state("details")
</script>

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-2 pb-3">
		<button
			class="btn btn-sm preset-filled-surface-400-600 p-2"
			onclick={onBack}
			title="Back to list"
		>
			<Icons.ChevronLeft size={16} />
		</button>
		<h2 class="flex-1 truncate font-semibold">
			{character?.nickname || character?.name || ""}
		</h2>
		<button
			class="btn btn-sm preset-filled-surface-400-600"
			onclick={onChat}
			title="View chats"
		>
			<Icons.MessageSquare size={14} /> View Chats
		</button>
		{#if character?.isOwner}
			{#if onExport}
				<button
					class="btn btn-sm preset-filled-surface-400-600"
					onclick={() => onExport?.(character!)}
					title="Export character"
					aria-label="Export character"
				>
					<Icons.Download size={14} />
				</button>
			{/if}
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={onEdit}
				title="Edit character"
			>
				<Icons.Pencil size={14} /> Edit
			</button>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if character}
		<Tabs
			value={activeTab}
			onValueChange={(e) => (activeTab = e.value)}
			class="flex min-h-0 flex-1 flex-col"
		>
			<Tabs.List class="flex shrink-0 gap-1">
				<Tabs.Trigger value="details">
					<Icons.User size={16} /> Details
				</Tabs.Trigger>
				<Tabs.Trigger value="gallery">
					<Icons.Images size={16} /> Gallery
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content
				value="details"
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<div class="flex flex-col gap-4">
					<!-- Avatar + name -->
					<div class="flex items-center gap-3">
						<Avatar class="h-16 min-h-16 w-16 min-w-16">
							<Avatar.Image
								src={character.avatar || ""}
								alt={character.nickname || character.name}
								class="object-cover"
							/>
							<Avatar.Fallback>
								<Icons.User size={32} />
							</Avatar.Fallback>
						</Avatar>
						<div class="min-w-0 flex-1">
							<p class="truncate text-lg font-bold">
								{character.nickname || character.name}
							</p>
							{#if character.nickname && character.name !== character.nickname}
								<p
									class="text-surface-700-300 truncate text-sm"
								>
									{character.name}
								</p>
							{/if}
							{#if character.characterVersion}
								<p class="text-surface-600 text-xs">
									v{character.characterVersion}
								</p>
							{/if}
							{#if !character.isOwner && character.ownerName}
								<p
									class="text-surface-700-300 truncate text-xs"
								>
									Owned by {character.ownerName}
								</p>
							{/if}
						</div>
					</div>

					<!-- Tags -->
					{#if tags.length > 0}
						<div class="flex flex-wrap gap-1">
							{#each tags as tag}
								<span
									class="preset-tonal-surface rounded px-2 py-0.5 text-xs"
								>
									{tag}
								</span>
							{/each}
						</div>
					{/if}

					<!-- Description -->
					{#if character.description}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Description
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.description}
							</p>
						</section>
					{/if}

					<!-- Personality -->
					{#if character.personality}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Personality
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.personality}
							</p>
						</section>
					{/if}

					<!-- Scenario -->
					{#if character.scenario}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Scenario
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.scenario}
							</p>
						</section>
					{/if}

					<!-- First message -->
					{#if character.firstMessage}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								First Message
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.firstMessage}
							</p>
						</section>
					{/if}

					<!-- Alternate greetings -->
					{#if character.alternateGreetings?.length}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Alternate Greetings ({character
									.alternateGreetings.length})
							</p>
							{#each character.alternateGreetings as greeting, i}
								<details
									class="bg-surface-200-800 rounded p-2 text-sm"
								>
									<summary
										class="cursor-pointer text-xs font-medium"
									>
										Greeting {i + 1}
									</summary>
									<p
										class="mt-1 leading-relaxed whitespace-pre-wrap"
									>
										{greeting}
									</p>
								</details>
							{/each}
						</section>
					{/if}

					<!-- Creator notes -->
					{#if character.creatorNotes}
						<section class="space-y-1">
							<p
								class="text-surface-700-300 text-xs font-semibold tracking-wide uppercase"
							>
								Creator Notes
							</p>
							<p
								class="text-sm leading-relaxed whitespace-pre-wrap"
							>
								{character.creatorNotes}
							</p>
						</section>
					{/if}
				</div>
			</Tabs.Content>

			<Tabs.Content
				value="gallery"
				class="min-h-0 flex-1 overflow-y-auto"
			>
				<EntityGalleryTab
					entityType="character"
					entityId={character.id}
					entityName={character.nickname || character.name}
					isOwner={!!character.isOwner}
					currentAvatar={character.avatar}
				/>
			</Tabs.Content>
		</Tabs>
	{:else}
		<p class="text-surface-700-300 py-8 text-center text-sm">
			Character not found.
		</p>
	{/if}
</div>
