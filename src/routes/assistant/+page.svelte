<script lang="ts">
	import { goto } from "$app/navigation"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import * as Icons from "@lucide/svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import { onMount } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ChatTypes } from "$lib/shared/constants/ChatTypes"

	let assistantChats: SelectChat[] = $state([])
	let newMessage = $state("")
	const socket = useTypedSocket()
	let isCreatingChat = $state(false)
	let showDeleteChatModal = $state(false)
	let chatToDelete: SelectChat | null = $state(null)

	// Bulk delete state
	let isSelectMode = $state(false)
	let selectedChatIds = $state(new Set<number>())
	let showBulkDeleteModal = $state(false)

	// Check if we can create a new chat with the current message
	let canCreateNewChat = $derived.by(() => {
		return !isCreatingChat && newMessage.trim().length > 0
	})

	// Load assistant chats on mount
	onMount(() => {
		if (!socket) return

		// Set up listeners
		socket.on("chats:listAssistant", handleChatsListResponse)
		socket.on("chats:createAssistant", handleCreateAssistantResponse)
		socket.on("chats:titleGenerated", handleTitleGenerated)
		socket.on("chats:delete", handleChatDeleted)

		// Load list of assistant chats
		socket.emit("chats:listAssistant", {})

		// Cleanup listeners on unmount
		return () => {
			socket.off("chats:listAssistant", handleChatsListResponse)
			socket.off("chats:createAssistant", handleCreateAssistantResponse)
			socket.off("chats:titleGenerated", handleTitleGenerated)
			socket.off("chats:delete", handleChatDeleted)
		}
	})

	function handleChatsListResponse(res: Sockets.Chats.List.Response) {
		if (res.chatList) {
			// Sort by ID descending (most recent first)
			assistantChats = (res.chatList as SelectChat[]).sort(
				(a: SelectChat, b: SelectChat) => b.id - a.id
			)
		}
	}

	function handleCreateAssistantResponse(
		res: Sockets.Chats.CreateAssistant.Response
	) {
		isCreatingChat = false

		if (res.error) {
			toaster.error({ title: res.error })
			return
		}

		if (res.chat) {
			// Navigate to the new chat with initial message
			const initialMessage = newMessage.trim()
			if (initialMessage) {
				goto(
					`/assistant/${res.chat.id}?msg=${encodeURIComponent(initialMessage)}`,
					{ replaceState: true }
				)
			} else {
				goto(`/assistant/${res.chat.id}`, { replaceState: true })
			}
		}
	}

	function handleTitleGenerated(data: Sockets.Chats.TitleGenerated.Call) {
		// Update in the chat list
		assistantChats = assistantChats.map((c) =>
			c.id === data.chatId ? { ...c, name: data.title } : c
		)
	}

	function handleChatDeleted(res: any) {
		if (res.error) {
			toaster.error({ title: res.error })
			return
		}

		const deletedChatId = res.chatId || res.id

		if (deletedChatId) {
			// Remove from list
			assistantChats = assistantChats.filter(
				(c) => c.id !== deletedChatId
			)
			toaster.success({ title: "Chat deleted" })
		}
	}

	function startNewChat() {
		if (canCreateNewChat) {
			isCreatingChat = true
			socket?.emit("chats:createAssistant", {})
		}
	}

	function openChat(chatId: number) {
		goto(`/assistant/${chatId}`)
	}

	function showDeleteChatPrompt(chat: SelectChat) {
		chatToDelete = chat
		showDeleteChatModal = true
	}

	function cancelDeleteChat() {
		showDeleteChatModal = false
		chatToDelete = null
	}

	function confirmDeleteChat() {
		if (chatToDelete && socket) {
			socket.emit("chats:delete", { id: chatToDelete.id })
			showDeleteChatModal = false
			chatToDelete = null
		}
	}

	function cancelBulkDelete() {
		showBulkDeleteModal = false
	}

	function confirmBulkDelete() {
		if (socket && selectedChatIds.size > 0) {
			// Delete all selected chats
			for (const chatId of selectedChatIds) {
				socket.emit("chats:delete", { id: chatId })
			}
			selectedChatIds = new Set()
			showBulkDeleteModal = false
			isSelectMode = false
		}
	}
</script>

<div class="flex h-full w-full flex-col">
	<!-- Header -->
	<div
		class="preset-filled-surface-100-950 border-surface-400-600 flex items-center gap-4 border-b p-4"
	>
		<button
			class="btn preset-filled-surface-400-600"
			onclick={() => goto("/")}
			title="Back to Home"
		>
			<Icons.ArrowLeft size={20} />
		</button>
		<div class="flex-1">
			<h1 class="text-xl font-bold">
				<Icons.BotMessageSquare class="inline" size={24} />
				Serenity
			</h1>
			<p class="text-muted text-sm">Your AI assistant for Serene Pub</p>
		</div>
		<!-- Select mode toggle button -->
		<button
			class="btn preset-filled-surface-400-600"
			onclick={() => {
				isSelectMode = !isSelectMode
				if (!isSelectMode) {
					selectedChatIds = new Set()
				}
			}}
			title={isSelectMode ? "Cancel selection" : "Select conversations"}
		>
			{#if isSelectMode}
				<Icons.X size={20} />
				<span class="ml-2 hidden sm:inline">Cancel</span>
			{:else}
				<Icons.CheckSquare size={20} />
				<span class="ml-2 hidden sm:inline">Select</span>
			{/if}
		</button>
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if isCreatingChat}
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<div class="loading mb-4"></div>
					<p class="text-muted">
						Starting conversation with Serenity...
					</p>
				</div>
			</div>
		{:else}
			<!-- Recents List View -->
			<div class="flex flex-1 flex-col overflow-y-auto">
				<div class="mx-auto w-full max-w-3xl p-6">
					<!-- Message Input for Creating New Chat -->
					<form
						class="mb-8"
						onsubmit={(e) => {
							e.preventDefault()
							startNewChat()
						}}
					>
						<div class="relative">
							<input
								type="text"
								class="input w-full px-6 py-4 pr-14 text-lg"
								placeholder="Ask Serenity anything about Serene Pub..."
								bind:value={newMessage}
								disabled={isCreatingChat}
								aria-label="Start a new conversation"
							/>
							<button
								type="submit"
								class="btn preset-filled-primary absolute top-1/2 right-2 -translate-y-1/2"
								disabled={!canCreateNewChat}
								title="Start conversation"
							>
								{#if isCreatingChat}
									<Icons.Loader2
										size={20}
										class="animate-spin"
									/>
								{:else}
									<Icons.Send size={20} />
								{/if}
							</button>
						</div>
					</form>

					<!-- Recent Chats List -->
					{#if assistantChats.length > 0}
						<div class="space-y-2">
							<div class="mb-3 flex items-center justify-between">
								<h2 class="text-muted text-sm font-semibold">
									Recent Conversations
								</h2>
								{#if isSelectMode}
									<div class="flex items-center gap-3">
										<!-- Select All Checkbox -->
										<label
											class="flex cursor-pointer items-center gap-2"
										>
											<input
												type="checkbox"
												class="checkbox"
												checked={selectedChatIds.size ===
													assistantChats.length &&
													assistantChats.length > 0}
												onchange={(e) => {
													if (
														e.currentTarget.checked
													) {
														selectedChatIds =
															new Set(
																assistantChats.map(
																	(c) => c.id
																)
															)
													} else {
														selectedChatIds =
															new Set()
													}
												}}
											/>
											<span class="text-sm">
												Select All
											</span>
										</label>
										<!-- Delete Selected Button -->
										<button
											class="btn preset-filled-error-500 btn-sm"
											disabled={selectedChatIds.size ===
												0}
											onclick={() => {
												if (selectedChatIds.size > 0) {
													showBulkDeleteModal = true
												}
											}}
											title="Delete selected conversations"
										>
											<Icons.Trash2 size={16} />
											<span>
												Delete ({selectedChatIds.size})
											</span>
										</button>
									</div>
								{/if}
							</div>
							{#each assistantChats as assistantChat (assistantChat.id)}
								<div
									class="preset-tonal-surface border-surface-400-600 hover:preset-filled-surface-100-950 flex w-full items-start gap-2 rounded-lg border transition-colors"
								>
									{#if isSelectMode}
										<!-- Checkbox in select mode -->
										<div class="p-4">
											<input
												type="checkbox"
												class="checkbox"
												checked={selectedChatIds.has(
													assistantChat.id
												)}
												onchange={(e) => {
													if (
														e.currentTarget.checked
													) {
														selectedChatIds.add(
															assistantChat.id
														)
													} else {
														selectedChatIds.delete(
															assistantChat.id
														)
													}
													selectedChatIds = new Set(
														selectedChatIds
													)
												}}
												onclick={(e) =>
													e.stopPropagation()}
											/>
										</div>
									{/if}

									<!-- Clickable chat item -->
									<button
										class="flex min-w-0 flex-1 items-start gap-3 p-4 text-left"
										onclick={() =>
											openChat(assistantChat.id)}
										disabled={isSelectMode}
									>
										<div class="mt-1 flex-shrink-0">
											<Icons.MessageSquare
												size={20}
												class="text-primary-500"
											/>
										</div>
										<div class="min-w-0 flex-1">
											<h3 class="truncate font-medium">
												{assistantChat.name ||
													`Conversation ${assistantChat.id}`}
											</h3>
											<p class="text-muted text-xs">
												{new Date(
													assistantChat.createdAt
												).toLocaleDateString(
													undefined,
													{
														month: "short",
														day: "numeric",
														year: "numeric"
													}
												)}
												{" at "}
												{new Date(
													assistantChat.createdAt
												).toLocaleTimeString(
													undefined,
													{
														hour: "numeric",
														minute: "2-digit"
													}
												)}
											</p>
										</div>
									</button>

									<!-- Delete button (always visible) -->
									{#if !isSelectMode}
										<div class="p-4">
											<button
												class="btn-icon preset-ghost-error-500"
												onclick={(e) => {
													e.stopPropagation()
													showDeleteChatPrompt(
														assistantChat
													)
												}}
												title="Delete conversation"
											>
												<Icons.Trash2 size={16} />
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<div class="py-12 text-center">
							<Icons.MessageSquare
								size={48}
								class="text-muted mx-auto mb-4 opacity-50"
							/>
							<p class="text-muted">No conversations yet</p>
							<p class="text-muted mt-1 text-sm opacity-75">
								Start a conversation by typing a message above
							</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Delete Chat Confirmation Modal -->
<Dialog
	open={showDeleteChatModal}
	onOpenChange={(e) => {
		if (!e.open) cancelDeleteChat()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-[90vw] max-w-md p-6"
			>
				<div class="space-y-4">
					<div class="flex items-start gap-3">
						<div class="flex-1">
							<h3 class="h3">Delete Conversation?</h3>
							<p class="mt-2 text-sm opacity-80">
								Are you sure you want to delete this
								conversation? This action cannot be undone.
							</p>
							{#if chatToDelete}
								<p class="mt-2 text-sm font-medium">
									"{chatToDelete.name ||
										"Untitled Conversation"}"
								</p>
							{/if}
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<button
							class="btn preset-filled-surface-400-600"
							onclick={cancelDeleteChat}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={confirmDeleteChat}
						>
							<Icons.Trash2 size={16} />
							Delete
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- Bulk Delete Confirmation Modal -->
<Dialog
	open={showBulkDeleteModal}
	onOpenChange={(e) => {
		if (!e.open) cancelBulkDelete()
	}}
>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-[90vw] max-w-md p-6"
			>
				<div class="space-y-4">
					<div class="flex items-start gap-3">
						<div class="flex-1">
							<h3 class="h3">
								Delete {selectedChatIds.size} Conversation{selectedChatIds.size !==
								1
									? "s"
									: ""}?
							</h3>
							<p class="mt-2 text-sm opacity-80">
								Are you sure you want to delete {selectedChatIds.size}
								selected conversation{selectedChatIds.size !== 1
									? "s"
									: ""}? This action cannot be undone.
							</p>
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<button
							class="btn preset-filled-surface-400-600"
							onclick={cancelBulkDelete}
						>
							Cancel
						</button>
						<button
							class="btn preset-filled-error-500"
							onclick={confirmBulkDelete}
						>
							<Icons.Trash2 size={16} />
							Delete {selectedChatIds.size}
						</button>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
