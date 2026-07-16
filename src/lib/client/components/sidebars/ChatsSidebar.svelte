<script lang="ts">
	import { getContext, onMount } from "svelte"
	import * as skio from "sveltekit-io"
	import EditChatForm from "../chatForms/EditChatForm.svelte"
	import ChatViewPanel from "../chatForms/ChatViewPanel.svelte"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import { goto } from "$app/navigation"
	import { toaster } from "$lib/client/utils/toaster"
	import { page } from "$app/state"
	import ChatListItem from "../listItems/ChatListItem.svelte"
	import ChatsUnsavedChangesModal from "../modals/ChatsUnsavedChangesModal.svelte"
	import EmptyState from "../EmptyState.svelte"

	interface Props {
		onclose?: () => Promise<boolean> | undefined
	}
	let { onclose = $bindable() }: Props = $props()

	let chats: Sockets.Chats.List.Response["chatList"] = $state([])
	let isLoading = $state(true)
	let search = $state("")
	let showEditChatForm = $state(false)
	let panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	let searchByCharacterId: number | null = $state(null)
	let searchByPersonaId: number | null = $state(null)
	let searchCharacter: SelectCharacter | null = $state(null)
	let searchPersona: SelectPersona | null = $state(null)
	let editChatId: number | null = $state(null)
	let viewingId: number | null = $state(null)
	let returnToViewId: number | null = $state(null)
	let chatFormHasChanges = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	const socket = skio.get()

	// Filtered chats derived from search
	let filteredChats: Sockets.Chats.List.Response["chatList"] = $state([])

	socket.on("chats:list", (msg: Sockets.Chats.List.Response) => {
		chats = msg.chatList || []
		isLoading = false
	})
	// The generic **:error listener in Layout.svelte already toasts this —
	// this just stops the spinner from spinning forever if the initial
	// fetch fails, so it settles into the (accurate enough) empty state.
	socket.on("chats:list:error", () => {
		isLoading = false
	})

	async function handleOnClose() {
		if (chatFormHasChanges) {
			showUnsavedChangesModal = true
			return new Promise<boolean>((resolve) => {
				confirmCloseSidebarResolve = resolve
			})
		} else {
			// Remove "chats-by-characterId" and "chats-by-personaId" from search params
			const url = new URL(window.location.href)
			url.searchParams.delete("chats-by-characterId")
			url.searchParams.delete("chats-by-personaId")
			goto(url.toString(), { replaceState: true })

			return true
		}
	}

	function handleCreateClick(
		event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }
	) {
		// Clear tutorial flag when user interacts with the highlighted button
		if (panelsCtx.digest.tutorial) {
			panelsCtx.digest.tutorial = false
		}

		showEditChatForm = true
	}

	function handleEditClick(chatId: number) {
		showEditChatForm = true
		editChatId = chatId
		viewingId = null
	}

	function handleViewClick(chatId: number) {
		viewingId = chatId
	}

	function handleEditFromView() {
		returnToViewId = viewingId
		editChatId = viewingId
		viewingId = null
		showEditChatForm = true
	}

	function handleOpenChat(chatId: number) {
		goto(`/chats/${chatId}`)
		if (panelsCtx.isMobileMenuOpen) {
			panelsCtx.isMobileMenuOpen = false
		}
		if (panelsCtx.mobilePanel) {
			panelsCtx.mobilePanel = null
		}
	}

	function handleChatClick(chat: any) {
		handleOpenChat(chat.id)
	}

	function closeEditForm() {
		showEditChatForm = false
		editChatId = null
		const returnId = returnToViewId
		returnToViewId = null
		if (returnId) viewingId = returnId
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
			socket.emit("chats:delete", { id: chatToDelete })
			showDeleteModal = false
			chatToDelete = null
		}
	}
	socket.on("chats:delete", (msg) => {
		chats = chats.filter((c) => c.id !== msg.id)
		toaster.success({ title: "Chat deleted" })
	})

	function handleCloseModalDiscard() {
		showUnsavedChangesModal = false
		// Clear search params when discarding changes and closing
		const url = new URL(window.location.href)
		url.searchParams.delete("chats-by-characterId")
		url.searchParams.delete("chats-by-personaId")
		goto(url.toString(), { replaceState: true })

		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(true)
	}

	function handleCloseModalCancel() {
		showUnsavedChangesModal = false
		if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
	}

	function handleUnsavedChangesOnOpenChange(e: { open: boolean }) {
		if (!e.open) {
			showUnsavedChangesModal = false
			if (confirmCloseSidebarResolve) confirmCloseSidebarResolve(false)
		}
	}

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
			const tagNames = (chat.chatTags || [])
				.map((ct: any) => ct.tag?.name?.toLowerCase() || "")
				.join(" ")
			return (
				chatName.includes(lower) ||
				personaNames.includes(lower) ||
				characterNames.includes(lower) ||
				tagNames.includes(lower)
			)
		})
	})

	$effect(() => {
		if (panelsCtx.digest.chatId) {
			showEditChatForm = true
			editChatId = panelsCtx.digest.chatId
			delete panelsCtx.digest.chatId
			delete panelsCtx.digest.chatCharacterId
			delete panelsCtx.digest.chatPersonaId
		}
	})

	$effect(() => {
		if (panelsCtx.digest.chatCharacterId) {
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
			socket.once(
				"characters:get",
				(msg: Sockets.Characters.Get.Response) => {
					searchCharacter = msg.character
				}
			)
			const charIdReq: Sockets.Characters.Get.Params = {
				id: searchByCharacterId
			}
			socket.emit("characters:get", charIdReq)
		}
	})

	$effect(() => {
		if (searchByPersonaId) {
			socket.once(
				"personas:get",
				(msg: Sockets.Personas.Get.Response) => {
					searchPersona = msg.persona
				}
			)
			const personaIdReq: Sockets.Personas.Get.Params = {
				id: searchByPersonaId
			}
			socket.emit("personas:get", personaIdReq)
		}
	})

	$effect(() => {
		if (editChatId && !showEditChatForm) {
			editChatId = null
		}
	})

	onMount(() => {
		socket.emit("chats:list", {})
		onclose = handleOnClose
	})
</script>

<div class="text-foreground flex h-full flex-col p-4">
	{#if showEditChatForm}
		<EditChatForm
			bind:showEditChatForm
			bind:editChatId
			bind:hasChanges={chatFormHasChanges}
			onClose={closeEditForm}
		/>
	{:else if viewingId}
		{#key viewingId}
			<ChatViewPanel
				chatId={viewingId}
				onBack={() => (viewingId = null)}
				onEdit={handleEditFromView}
				onOpen={() => handleOpenChat(viewingId!)}
			/>
		{/key}
	{:else}
		<div class="mb-2 flex gap-2">
			<button
				class="btn btn-sm preset-filled-primary-500 {panelsCtx.digest
					.tutorial
					? 'ring-primary-500/50 animate-pulse ring-4'
					: ''}"
				onclick={handleCreateClick}
				title="Create New Chat"
			>
				<Icons.Plus size={16} />
				New
			</button>
		</div>
		<div class="mb-4 flex items-center gap-2">
			<input
				class="input w-full"
				type="text"
				placeholder="Search chats, personas, characters, tags..."
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
			{#if isLoading}
				<div class="flex items-center justify-center py-8">
					<Icons.Loader2 size={20} class="text-surface-400 animate-spin" />
				</div>
			{:else if filteredChats.length === 0}
				<EmptyState
					icon={Icons.MessageSquareText}
					message={search || searchByCharacterId || searchByPersonaId
						? "No chats found matching your filters."
						: "No chats yet — start one to get roleplaying."}
					ctaLabel={search || searchByCharacterId || searchByPersonaId
						? undefined
						: "New Chat"}
					onCta={search || searchByCharacterId || searchByPersonaId
						? undefined
						: () => (showEditChatForm = true)}
				/>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each filteredChats as chat}
						<ChatListItem
							{chat}
							onclick={handleChatClick}
							onEdit={handleEditClick}
							onDelete={handleDeleteClick}
						/>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<Modal
	open={showDeleteModal}
	onOpenChange={(e) => (showDeleteModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-[95vw] border border-surface-300-700"
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

{#if showUnsavedChangesModal}
	<ChatsUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}
