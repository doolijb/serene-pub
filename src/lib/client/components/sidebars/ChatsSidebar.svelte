<script lang="ts">
	import { getContext, onMount } from "svelte"
	import * as skio from "sveltekit-io"
	import EditChatForm from "../chatForms/EditChatForm.svelte"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { page } from "$app/state"
	import Avatar from "../Avatar.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	let chats: Sockets.ChatsList.Response["chatsList"] = $state([])
	let search = $state("")
	let showEditChatForm = $state(false)
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let searchByCharacterId: number | null = $state(null)
	let searchByPersonaId: number | null = $state(null)
	let searchCharacter: SelectCharacter | null = $state(null)
	let searchPersona: SelectPersona | null = $state(null)
	let editChatId: number | null = $state(null)
	const socket = skio.get()

	// Filtered chats derived from search
	let filteredChats: Sockets.ChatsList.Response["chatsList"] = $state([])

	socket.on("chatsList", (msg: Sockets.ChatsList.Response) => {
		chats = msg.chatsList || []
	})

	async function handleOnClose() {
		// Remove "chats-by-characterId" and "chats-by-personaId" from search params
		const url = new URL(window.location.href)
		url.searchParams.delete("chats-by-characterId")
		url.searchParams.delete("chats-by-personaId")
		goto(url.toString(), { replaceState: true })

		return true // TODO
	}

	function handleCreateClick(
		event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }
	) {
		showEditChatForm = true
	}

	function handleEditClick(chatId: number) {
		showEditChatForm = true
		editChatId = chatId
	}

	function handleChatClick(chat: any) {
		goto(`/chats/${chat.id}`)
		// Check if mobile menu/sidebar is open and close it
		if (panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
		if (panelsCtx.mobilePanel) {
			panelsCtx.mobilePanel = null
		}
	}

	let showDeleteModal = $state(false)
	let chatToDelete: number | null = $state(null)

	function handleDeleteClick(chatId: number) {
		chatToDelete = chatId
		showDeleteModal = true
	}
	function cancelDelete() {
		showDeleteModal = false
		chatToDelete = null
	}
	function confirmDelete() {
		if (chatToDelete != null) {
			if (page.params.id === chatToDelete.toString()) {
				// If the current chat is being deleted, navigate away
				goto("/")
			}
			socket.emit("deleteChat", { id: chatToDelete })
			console.log("Deleting chat with ID:", chatToDelete)
			showDeleteModal = false
			chatToDelete = null
		}
	}
	socket.on("deleteChat", (msg) => {
		chats = chats.filter((c) => c.id !== msg.id)
		toaster.success({ title: "Chat deleted" })
	})

	$effect(() => {
		const lower = search.toLowerCase()

		let filtered = [...chats]

		// If searching by character ID, filter chats that include that character
		if (searchByCharacterId) {
			filtered = filtered.filter((chat) =>
				chat.chatCharacters?.some(
					(cc) => cc.character?.id === searchByCharacterId
				)
			)
		}

		// If searching by persona ID, filter chats that include that persona
		if (searchByPersonaId) {
			filtered = filtered.filter((chat) =>
				chat.chatPersonas?.some(
					(cp) => cp.persona?.id === searchByPersonaId
				)
			)
		}

		filteredChats = filtered.filter((chat) => {
			const chatName = chat.name?.toLowerCase() || ""
			const personaNames = (chat.chatPersonas || [])
				.map((cp) => cp.persona?.name?.toLowerCase() || "")
				.join(" ")
			const characterNames = (chat.chatCharacters || [])
				.map((cc) => cc.character?.name?.toLowerCase() || "")
				.join(" ")
			return (
				chatName.includes(lower) ||
				personaNames.includes(lower) ||
				characterNames.includes(lower)
			)
		})
	})

	$effect(() => {
		if (panelsCtx.digest.chatCharacterId) {
			console.log(
				"Searching chats by character ID:",
				panelsCtx.digest.chatCharacterId
			)
			searchByCharacterId = panelsCtx.digest.chatCharacterId
		}
		if (panelsCtx.digest.chatPersonaId) {
			searchByPersonaId = panelsCtx.digest.chatPersonaId
		}
		delete panelsCtx.digest.chatCharacterId
		delete panelsCtx.digest.chatPersonaId
	})

	$effect(() => {
		if (searchByCharacterId) {
			socket.once("character", (msg: Sockets.Character.Response) => {
				searchCharacter = msg.character
			})
			const charIdReq: Sockets.Character.Call = {
				id: searchByCharacterId
			}
			socket.emit("character", charIdReq)
		}
	})

	$effect(() => {
		if (searchByPersonaId) {
			socket.once("persona", (msg: Sockets.Persona.Response) => {
				searchPersona = msg.persona
			})
			const personaIdReq: Sockets.Persona.Call = {
				id: searchByPersonaId
			}
			socket.emit("persona", personaIdReq)
		}
	})

	$effect(() => {
		if (editChatId && !showEditChatForm) {
			editChatId = null
		}
	})

	onMount(() => {
		socket.emit("chatsList", {})
		onclose = handleOnClose
	})
</script>

<div class="text-foreground flex h-full flex-col p-4">
	{#if showEditChatForm}
		<EditChatForm bind:showEditChatForm bind:editChatId />
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500"
				onclick={handleCreateClick}
				title="Create New Chat"
			>
				<Icons.Plus size={16} />
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				class="input w-full"
				type="text"
				placeholder="Search chats, personas, characters..."
				bind:value={search}
			/>
		</div>
		{#if searchCharacter}
			<button
				class="btn btn-sm preset-filled-secondary-500 mb-2"
				onclick={() => {
					searchByCharacterId = null
					searchCharacter = null
					page.url.searchParams.delete("chats-by-characterId")
				}}
			>
				<Icons.X size={16} />
				{searchCharacter.nickname || searchCharacter.name}
			</button>
		{/if}
		{#if searchPersona}
			<button
				class="btn btn-sm preset-filled-secondary-500 mb-2"
				onclick={() => {
					searchByPersonaId = null
					searchPersona = null
					page.url.searchParams.delete("chats-by-personaId")
				}}
			>
				<Icons.X size={16} />
				{searchPersona.name}
			</button>
		{/if}
		<div class="flex-1 overflow-y-auto">
			{#if filteredChats.length === 0}
				<div class="text-muted">No chats found.</div>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each filteredChats as chat}
					{@const avatars = [
								...(chat.chatCharacters || []).map(
									(cc) => ({
										type: "character",
										data: cc.character
											})
										),
										...(chat.chatPersonas || []).map(
											(cp) => ({
												type: "persona",
												data: cp.persona
											})
										)
									]}
					<SidebarListItem
						onclick={(e) => handleChatClick(chat)}
						contentTitle="Go to chat"
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
														: '-0.7em'}; z-index: {10 -
														i};"
												>
													<Avatar
														char={avatar.data}
													/>
												</div>
											{/each}
										{:else}
											{#each avatars.slice(0, 3) as avatar, i}
												<div
													class="ml-[-2.25em] inline-block first:ml-0"
													style="z-index: {10 - i};"
												>
													<Avatar
														char={avatar.data}
													/>
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
								<div class="truncate font-semibold text-left">
									{chat.name || "Untitled Chat"}
								</div>
								<div
									class="text-muted-foreground line-clamp-2 text-xs text-left"
								>
									{#if chat.chatCharacters?.length}
										{chat.chatCharacters
											.map(
												(cc) =>
													cc.character?.nickname ||
													cc.character?.name
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
						<div class="ml-auto flex gap-4 flex-col">
								<button
									class="btn btn-sm text-primary-500 p-4"
									onclick={() => {
										handleEditClick(chat.id!)
									}}
									title="Edit Character"
								>
									<Icons.Edit size={16} />
								</button>
								<button
									class="btn btn-sm text-error-500 p-4"
									onclick={(e) => {
										e.stopPropagation()
										handleDeleteClick(chat.id!)
									}}
									title="Delete Character"
								>
									<Icons.Trash2 size={16} />
								</button>
							</div>
						{/snippet}
</SidebarListItem>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<div class="p-6">
			<h2 class="mb-2 text-lg font-bold">Delete Chat?</h2>
			<p class="mb-4">
				Are you sure you want to delete this chat and all of it's
				messages? This action cannot be undone.
			</p>
			<div class="flex justify-end gap-2">
				<button
					class="btn preset-filled-surface-500"
					onclick={cancelDelete}
				>
					Cancel
				</button>
				<button
					class="btn preset-filled-error-500"
					onclick={confirmDelete}
				>
					Delete
				</button>
			</div>
		</div>
	{/snippet}
</Modal>
