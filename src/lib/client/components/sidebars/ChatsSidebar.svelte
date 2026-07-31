<script lang="ts">
	import { getContext, onMount } from "svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import EditChatForm from "../chatForms/EditChatForm.svelte"
	import ChatViewPanel from "../chatForms/ChatViewPanel.svelte"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
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
	// embedding/embeddingModel/vectorizedAt are deliberately excluded from
	// the "characters:get"/"personas:get" responses (see charactersGet/
	// personasGet's `columns` restrictions) — these types mirror that
	// rather than hand-declaring the full Select* shape.
	let searchCharacter: Sockets.Characters.Get.Response["character"] =
		$state(null)
	let searchPersona: Sockets.Personas.Get.Response["persona"] =
		$state(null)
	let editChatId: number | null = $state(null)
	let viewingId: number | null = $state(null)
	let returnToViewId: number | null = $state(null)
	let chatFormHasChanges = $state(false)
	let showUnsavedChangesModal = $state(false)
	let confirmCloseSidebarResolve: ((v: boolean) => void) | null = null
	const socket = useTypedSocket()

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
		panelsCtx.fullscreenPanel = null
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
	let isDeleting = $state(false)

	function handleDeleteClick(chatId: number) {
		chatToDelete = chatId
		showDeleteModal = true
	}
	function cancelDelete() {
		showDeleteModal = false
		chatToDelete = null
	}
	function confirmDelete() {
		// Guard against double-submit (eg. an impatient re-click while the
		// previous delete is still in flight)
		if (isDeleting) return
		if (chatToDelete != null) {
			if (page.params.id === chatToDelete.toString()) {
				// If the current chat is being deleted, navigate away
				goto("/")
				panelsCtx.fullscreenPanel = null
			}
			isDeleting = true
			socket.emit("chats:delete", { id: chatToDelete })
			showDeleteModal = false
			chatToDelete = null
		}
	}
	socket.on("chats:delete", (msg) => {
		isDeleting = false
		chats = chats.filter((c) => c.id !== msg.id)
		toaster.success({ title: "Chat deleted" })
	})
	// Not shown to the user here - the generic onAny catch-all in Layout.svelte
	// already toasts on "chats:delete:error"; this listener just clears the
	// in-flight guard so a failed delete doesn't leave the button stuck.
	socket.on("chats:delete:error", () => {
		isDeleting = false
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
			const requestedId = searchByCharacterId
			// TypedSocket has no `.once()` — self-unsubscribe after the first
			// response to replicate the same "fire once" semantics. Also
			// guards against a stale response: if searchByCharacterId changes
			// again before this response arrives, a second listener for a
			// different id registers alongside this one — without the id
			// check, whichever response lands first (or last) can overwrite
			// searchCharacter with data for the wrong id.
			const handleCharacterGet = (
				msg: Sockets.Characters.Get.Response
			) => {
				socket.off("characters:get", handleCharacterGet)
				if (msg.character?.id !== requestedId) return
				searchCharacter = msg.character
			}
			socket.on("characters:get", handleCharacterGet)
			const charIdReq: Sockets.Characters.Get.Params = {
				id: searchByCharacterId
			}
			socket.emit("characters:get", charIdReq)

			// Covers the case where searchByCharacterId changes again (or the
			// component unmounts) before a response ever arrives — the
			// self-unsub above only fires on a real response.
			return () => socket.off("characters:get", handleCharacterGet)
		}
	})

	$effect(() => {
		if (searchByPersonaId) {
			const requestedId = searchByPersonaId
			// Same staleness guard + always-cleanup as the character search
			// effect above.
			const handlePersonaGet = (msg: Sockets.Personas.Get.Response) => {
				socket.off("personas:get", handlePersonaGet)
				if (msg.persona?.id !== requestedId) return
				searchPersona = msg.persona
			}
			socket.on("personas:get", handlePersonaGet)
			const personaIdReq: Sockets.Personas.Get.Params = {
				id: searchByPersonaId
			}
			socket.emit("personas:get", personaIdReq)

			return () => socket.off("personas:get", handlePersonaGet)
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
				aria-label="Search chats"
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
					<Icons.Loader2
						size={20}
						class="text-surface-400 animate-spin"
					/>
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

<Dialog open={showDeleteModal} onOpenChange={(e) => (showDeleteModal = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 border-surface-300-700 max-w-[95vw] space-y-4 border p-4 shadow-xl"
			>
				<div class="p-6">
					<h2 class="mb-2 text-lg font-bold">Delete Chat?</h2>
					<p class="mb-4">
						Are you sure you want to delete this chat and all of its
						messages? This action cannot be undone.
					</p>
					<div class="flex justify-end gap-2">
						<button
							class="btn preset-filled-surface-500"
							onclick={cancelDelete}
							disabled={isDeleting}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={confirmDelete}
							disabled={isDeleting}
						>
							{#if isDeleting}
								<Icons.Loader2
									size={16}
									class="animate-spin"
									aria-hidden="true"
								/>
							{/if}
							Delete
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

{#if showUnsavedChangesModal}
	<ChatsUnsavedChangesModal
		open={showUnsavedChangesModal}
		onOpenChange={handleUnsavedChangesOnOpenChange}
		onConfirm={handleCloseModalDiscard}
		onCancel={handleCloseModalCancel}
	/>
{/if}
