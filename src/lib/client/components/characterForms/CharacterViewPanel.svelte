<script lang="ts">
	import { Avatar, Tabs } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { onDestroy, onMount, getContext } from "svelte"
	import EntityGalleryTab from "$lib/client/components/gallery/EntityGalleryTab.svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"

	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "characters:get" response (see charactersGet's `columns`
	// restriction) — this type mirrors that rather than hand-declaring the
	// full SelectCharacter shape, so the two can't drift out of sync.
	type ViewedCharacter = NonNullable<
		Sockets.Characters.Get.Response["character"]
	>

	interface Props {
		characterId: number
		onBack: () => void
		onEdit: () => void
		onSession: () => void
		onExport?: (character: ViewedCharacter) => void
	}

	let { characterId, onBack, onEdit, onSession, onExport }: Props = $props()

	const socket = useTypedSocket()

	let character = $state<ViewedCharacter | null>(null)
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
	<div class="shrink-0 pb-3">
		<PanelNavHeader
			title={character?.nickname || character?.name || ""}
			{onBack}
			backLabel="Back to list"
			actionsLabel="Character"
		>
			{#snippet primaryAction()}
				{#if character?.isOwner}
					<button
						class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
						onclick={onEdit}
						title="Edit character"
						aria-label="Edit character"
						type="button"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
					</button>
				{/if}
			{/snippet}
			{#snippet actions()}
				<button
					class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
					onclick={onSession}
					type="button"
				>
					<Icons.MessageSquare size={16} aria-hidden="true" />
					<span>View Sessions</span>
				</button>
				{#if character?.isOwner && onExport}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
						onclick={() => onExport?.(character!)}
						type="button"
					>
						<Icons.Download size={16} aria-hidden="true" />
						<span>Export character</span>
					</button>
				{/if}
			{/snippet}
		</PanelNavHeader>
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
				<div class="flex flex-col gap-3">
					<!-- Avatar + name -->
					<div class="card preset-tonal flex items-center gap-3 p-3">
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
							{#if tags.length > 0}
								<div class="mt-1.5 flex flex-wrap gap-1">
									{#each tags as tag}
										<span
											class="preset-tonal-surface rounded px-2 py-0.5 text-xs"
										>
											{tag}
										</span>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<!-- Description -->
					{#if character.description}
						<section class="card preset-tonal space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.FileText size={13} />
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
						<section class="card preset-tonal space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.Sparkles size={13} />
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
						<section class="card preset-tonal space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.Drama size={13} />
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
						<section class="card preset-tonal space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.MessageSquare size={13} />
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
						<section class="card preset-tonal space-y-1.5 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.MessagesSquare size={13} />
								Alternate Greetings ({character
									.alternateGreetings.length})
							</p>
							{#each character.alternateGreetings as greeting, i}
								<details
									class="preset-tonal-surface rounded p-2 text-sm"
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
						<section class="card preset-tonal space-y-1 p-3">
							<p
								class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase"
							>
								<Icons.StickyNote size={13} />
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
