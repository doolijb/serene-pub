<script lang="ts">
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import { slide } from "svelte/transition"
	import Avatar from "../Avatar.svelte"


	type EntityType = "characters" | "personas" | "chats" | "lorebooks"

	interface EntityResult {
		id: number
		name: string
		nickname?: string | null
		description?: string | null
		avatar?: string | null
		// Additional fields for different types
		displayName?: string
		tagline?: string
	}

	interface PendingSelection {
		messageId: number
		reasoning: string
		results: EntityResult[]
		type: EntityType
	}

	interface LinkedEntity {
		id: number
		name: string
		type: EntityType
		avatar?: string | null
	}

	interface Props {
		chatId: number
		taggedEntities?: Record<string, number[]>
		pendingSelection?: PendingSelection | null
		onSelectionComplete?: () => void
	}

	let {
		chatId,
		taggedEntities = {},
		pendingSelection = null,
		onSelectionComplete
	}: Props = $props()


	const socket = useTypedSocket()

	let isExpanded = $state(false)
	let showAddDataModal = $state(false)
	let isLoading = $state(false)
	let availableCharacters: SelectCharacter[] = $state([])
	let searchQuery = $state("")
	let loadedCharacters: Map<number, SelectCharacter> = $state(new Map())

	// Auto-expand when pending selection appears
	$effect(() => {

		if (pendingSelection && pendingSelection.results.length > 0) {
			isExpanded = true
		} else {
		}
	})

	// Auto-select if only one result
	$effect(() => {
		if (pendingSelection && pendingSelection.results.length === 1) {
			// Auto-select SHOULD trigger response since it's from assistant's function results
			handleSelect(
				[pendingSelection.results[0].id],
				pendingSelection.type,
				true
			)
		}
	})

	// Load available characters when modal opens
	$effect(() => {
		if (showAddDataModal && socket) {
			loadAvailableCharacters()
		}
	})

	// Load linked entities when they change
	$effect(() => {
		const characterIds = taggedEntities.characters || []
		const locationIds = taggedEntities.locations || []
		const lorebooks = taggedEntities.lorebooks || []

		if (characterIds.length > 0) {
			loadLinkedCharacters(characterIds)
		}
		// Note: Don't need to manually clear - linkedEntities is derived from loadedCharacters
		// and will automatically be empty when there are no matching IDs
	})

	// Filtered characters based on search
	const filteredCharacters = $derived.by(() => {
		if (!searchQuery.trim()) return availableCharacters
		const query = searchQuery.toLowerCase()
		return availableCharacters.filter(
			(c) =>
				c.name?.toLowerCase().includes(query) ||
				c.nickname?.toLowerCase().includes(query) ||
				c.description?.toLowerCase().includes(query)
		)
	})

	// Get linked entities organized by type
	const linkedEntities = $derived.by(() => {

		const entities: Record<EntityType, LinkedEntity[]> = {
			characters: [],
			personas: [],
			chats: [],
			lorebooks: []
		}

		// Populate with actual character data
		if (taggedEntities) {
			for (const [type, ids] of Object.entries(taggedEntities)) {
				if (type === "characters" && Array.isArray(ids)) {
					entities.characters = ids.map((id) => {
						const char = loadedCharacters.get(id)
						return {
							id,
							name:
								char?.nickname ||
								char?.name ||
								`Character #${id}`,
							type: "characters" as EntityType,
							avatar: char?.avatar
						}
					})
				} else if (type in entities && Array.isArray(ids)) {
					// For other types, use placeholder for now
					entities[type as EntityType] = ids.map((id) => ({
						id,
						name: `${type.slice(0, -1)} #${id}`,
						type: type as EntityType
					}))
				}
			}
		}

		return entities
	})

	// Count total linked entities
	const totalLinked = $derived(
		Object.values(linkedEntities).reduce((sum, arr) => sum + arr.length, 0)
	)

	$effect(() => {
	})

	// Count pending selections
	const hasPendingSelection = $derived(
		pendingSelection && pendingSelection.results.length > 0
	)

	function handleSelect(
		selectedIds: number[],
		type: EntityType,
		shouldTriggerResponse = true
	) {
		if (!socket) return

		isLoading = true

		// Send selection to server
		socket.emit("assistant:selectFunctionResults", {
			chatId,
			selectedIds,
			type
		})

		// Only trigger assistant response if this is from a pending selection
		if (shouldTriggerResponse) {
			onSelectionComplete?.()
		}

		setTimeout(() => {
			isLoading = false
		}, 500)
	}

	function handleUnlink(entityId: number, type: EntityType) {
		if (!socket || !confirm(`Unlink this ${type.slice(0, -1)}?`)) return

		isLoading = true

		// Send unlink request to server
		socket.emit("assistant:unlinkEntity", {
			chatId,
			entityId,
			type
		})

		// The parent component should refresh chat data when it receives unlinkSuccess event
		setTimeout(() => {
			isLoading = false
		}, 500)
	}

	function toggleExpanded() {
		isExpanded = !isExpanded
	}

	function openAddDataModal() {
		showAddDataModal = true
	}

	function closeAddDataModal() {
		showAddDataModal = false
		searchQuery = ""
	}

	async function loadAvailableCharacters() {
		if (!socket) return

		try {
			isLoading = true

			// Create handler for the response
			const handleCharactersList = (response: any) => {
				if (response.characterList) {
					availableCharacters = response.characterList
				}
				isLoading = false
				// Remove listener after handling
				socket.off("characters:list", handleCharactersList)
			}

			// Listen for response
			socket.on("characters:list", handleCharactersList)

			// Emit request to load all characters
			socket.emit("characters:list", {})
		} catch (error) {
			console.error("Failed to load characters:", error)
			isLoading = false
		}
	}

	async function loadLinkedCharacters(characterIds: number[]) {
		if (!socket || !characterIds.length) return


		// Check if we already have all the characters loaded
		const allLoaded = characterIds.every((id) => loadedCharacters.has(id))
		if (allLoaded) {
			return
		}

		try {
			// Create a unique handler to avoid conflicts
			const handleCharactersList = (response: any) => {
				if (response.characterList) {
					// Filter to only the characters we need and store them
					const relevantChars = response.characterList.filter(
						(char: any) => characterIds.includes(char.id)
					)


					// Update the map with only id, name, nickname, avatar (lightweight)
					const newMap = new Map(loadedCharacters)
					for (const char of relevantChars) {
						newMap.set(char.id, {
							id: char.id,
							name: char.name,
							nickname: char.nickname,
							avatar: char.avatar
						} as SelectCharacter)
					}

					// Force reactivity by creating new Map
					loadedCharacters = newMap
				}
				// Clean up listener
				socket.off("characters:list", handleCharactersList)
			}

			// Listen for response
			socket.on("characters:list", handleCharactersList)

			// Request all characters
			socket.emit("characters:list", {})
		} catch (error) {
			console.error(
				"[DataManager] Failed to load linked characters:",
				error
			)
		}
	}

	function handleCharacterSelect(character: SelectCharacter) {
		if (!character.id) return

		// Add this character to the chat WITHOUT triggering assistant response
		// (manual selection, not from pending function results)
		handleSelect([character.id], "characters", false)
		closeAddDataModal()
	}

	function getEntityIcon(type: EntityType) {
		switch (type) {
			case "characters":
				return Icons.User
			case "personas":
				return Icons.UserCircle
			case "chats":
				return Icons.MessageSquare
			case "lorebooks":
				return Icons.Book
		}
	}

	function getEntityLabel(type: EntityType) {
		return type.charAt(0).toUpperCase() + type.slice(1)
	}
</script>

<div class="assistant-data-manager">
	<!-- Pending Selection Alert -->
	{#if pendingSelection && pendingSelection.results.length > 0}
		<div
			class="card variant-filled-warning mb-2 p-3"
			transition:slide={{ duration: 200 }}
		>
			<div class="flex items-start gap-3">
				<Icons.AlertCircle size={20} class="mt-0.5 flex-shrink-0" />
				<div class="min-w-0 flex-1 space-y-2">
					<div>
						<h4 class="text-sm font-semibold">
							Assistant Found Options
						</h4>
						<p class="mt-1 text-xs opacity-90">
							{pendingSelection.reasoning}
						</p>
					</div>

					<div class="flex flex-wrap gap-2">
						{#each pendingSelection.results as entity}
							<button
								class="btn btn-sm variant-ghost-surface"
								onclick={() =>
									handleSelect(
										[entity.id],
										pendingSelection!.type
									)}
								disabled={isLoading}
							>
								{#if entity.avatar}
									<img
										src={entity.avatar}
										alt={entity.name}
										class="h-5 w-5 rounded-full object-cover"
									/>
								{:else}
									{@const EntityIcon = getEntityIcon(
										pendingSelection!.type
									)}
									<EntityIcon size={16} />
								{/if}
								<span class="max-w-32 truncate">
									{entity.name}
								</span>
							</button>
						{/each}
						{#if pendingSelection.results.length > 1}
							<button
								class="btn btn-sm variant-filled"
								onclick={() =>
									handleSelect(
										pendingSelection!.results.map(
											(r) => r.id
										),
										pendingSelection!.type
									)}
								disabled={isLoading}
							>
								<Icons.Check size={16} />
								All
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Main Data Bar -->
	<div class="card variant-ghost-surface">
		<div class="flex items-center justify-between p-3">
			<button
				class="flex min-w-0 flex-1 items-center gap-2 transition-opacity hover:opacity-80"
				onclick={toggleExpanded}
			>
				<Icons.Database size={18} class="flex-shrink-0 opacity-70" />
				<span class="text-sm font-medium">Linked Data</span>
				{#if totalLinked > 0}
					<span class="badge variant-filled-surface text-xs">
						{totalLinked}
					</span>
				{/if}
				<Icons.ChevronDown
					size={18}
					class={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
				/>
			</button>

			<button
				class="btn btn-sm variant-filled-primary"
				onclick={openAddDataModal}
			>
				<Icons.Plus size={16} />
				Add Data
			</button>
		</div>

		{#if isExpanded}
			<div class="border-surface-400-600 border-t"></div>
		{/if}

		<!-- Expanded Content -->
		{#if isExpanded}
			<div class="space-y-3 p-3" transition:slide={{ duration: 200 }}>
				{#if totalLinked === 0}
					<div class="py-6 text-center opacity-50">
						<Icons.Database size={32} class="mx-auto mb-2" />
						<p class="text-sm">No data linked yet</p>
						<p class="mt-1 text-xs">
							Use "Add Data" or ask the assistant to find
							information
						</p>
					</div>
				{:else}
					<!-- Show all entity types with category labels -->
					<div class="space-y-3">
						{#each ["characters", "personas", "chats", "lorebooks"] as type}
							{@const entities =
								linkedEntities[type as EntityType]}
							{#if entities.length > 0}
								{@const EntityIcon = getEntityIcon(
									type as EntityType
								)}
								<div class="space-y-2">
									<div
										class="flex items-center gap-2 opacity-70"
									>
										<EntityIcon size={14} />
										<span
											class="text-xs font-semibold tracking-wide uppercase"
										>
											{getEntityLabel(type as EntityType)}
										</span>
									</div>
									<div class="flex flex-wrap gap-2">
										{#each entities as entity}
											<div
												class="chip variant-soft-surface"
											>
												{#if entity.avatar}
													<img
														src={entity.avatar}
														alt={entity.name}
														class="h-5 w-5 rounded-full object-cover"
													/>
												{:else}
													{@const EntityTypeIcon =
														getEntityIcon(
															entity.type
														)}
													<EntityTypeIcon size={14} />
												{/if}
												<span class="max-w-32 truncate">
													{entity.name}
												</span>
												<button
													class="btn-icon btn-icon-sm hover:variant-filled-error"
													onclick={() =>
														handleUnlink(
															entity.id,
															entity.type
														)}
													title="Unlink {entity.name}"
												>
													<Icons.X size={14} />
												</button>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Add Data Modal -->
<Modal
	open={showAddDataModal}
	onOpenChange={(e) => {
		if (!e.open) closeAddDataModal()
	}}
	contentBase="card bg-surface-100-900 p-6 space-y-6 shadow-xl max-h-[95dvh] relative overflow-hidden w-[min(95vw,800px)]"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="h2">Add Character</h2>
			<button class="btn btn-sm" onclick={closeAddDataModal}>
				<Icons.X size={20} />
			</button>
		</header>

		<input
			class="input w-full"
			type="text"
			placeholder="Search characters..."
			bind:value={searchQuery}
		/>

		<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
			<div class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap">
				{#if filteredCharacters.length === 0}
					<div class="text-surface-500 w-full py-8 text-center">
						{#if isLoading}
							Loading characters...
						{:else if availableCharacters.length === 0}
							No characters available
						{:else}
							No characters found matching your search
						{/if}
					</div>
				{/if}
				{#each filteredCharacters as character}
					<div class="flex p-1 lg:basis-1/2">
						<button
							class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-2"
							onclick={() => handleCharacterSelect(character)}
						>
							<div class="w-fit">
								<Avatar char={character} />
							</div>
							<div
								class="relative flex w-0 min-w-0 flex-1 flex-col"
							>
								<div
									class="w-full truncate text-left font-semibold"
								>
									{character.nickname || character.name}
								</div>
								<div
									class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
								>
									{character.creatorNotes ||
										character.description ||
										"No description"}
								</div>
							</div>
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/snippet}
</Modal>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.875rem;
	}
</style>
