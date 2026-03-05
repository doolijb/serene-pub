<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import ChatContainer from "$lib/client/components/chatMessages/ChatContainer.svelte"
	import ChatMessage from "$lib/client/components/chatMessages/ChatMessage.svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import AssistantDataManager from "$lib/client/components/assistant/AssistantDataManager.svelte"
	import AssistantCharacterDraftWrapper from "$lib/client/components/assistant/AssistantCharacterDraftWrapper.svelte"
	import GeneratingAnimation from "$lib/client/components/chatMessages/GeneratingAnimation.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onMount, untrack } from "svelte"
	import { toaster } from "$lib/client/utils/toaster"
	import { ChatTypes } from "$lib/shared/constants/ChatTypes"

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let newMessage = $state("")
	const socket = skio.get()
	let userCtx: UserCtx = getContext("userCtx")
	let messagesContainer: HTMLDivElement | null = $state(null)
	let isSending = $state(false)
	let openMobileMsgControls: number | undefined = $state(undefined)

	// Scroll tracking for autoscroll
	let lastSeenMessageId: number | null = $state(null)
	let lastSeenMessageContent: string = $state("")
	let isInitialLoad = $state(true)

	// Character draft state
	let characterDraft: any | null = $state(null)
	let draftValidationStatus: "valid" | "invalid" | "validating" | null =
		$state(null)
	let draftErrors: any | null = $state(null)
	let draftGeneratedFields: string[] = $state([])
	let isDraftGenerating = $state(false)
	let draftCurrentField: string | null = $state(null)
	let draftCurrentFieldIndex = $state(0)
	let draftTotalFields = $state(0)
	let isDraftCorrecting = $state(false)
	let draftCorrectionAttempt = $state(0)

	// Tool usage tracking
	let currentToolsUsed: string[] = $state([])

	// Get chat id from route params if it exists
	let chatId: number | undefined = $derived.by(() => {
		const id = page.params.id
		return id ? Number(id) : undefined
	})

	let lastMessage: SelectChatMessage | undefined = $derived.by(() => {
		if (chat && chat.chatMessages.length > 0) {
			return chat.chatMessages[chat.chatMessages.length - 1]
		}
		return undefined
	})

	let hasGeneratingMessage = $derived.by(() => {
		return chat?.chatMessages?.some((msg) => msg.isGenerating) || false
	})

	// Extract tagged entities from chat metadata
	let taggedEntities = $derived.by(() => {
		if (!chat?.metadata) return {}

		const metadata = chat.metadata

		console.log("[Page] Chat metadata:", metadata)
		console.log("[Page] Tagged entities:", metadata?.taggedEntities)

		return metadata?.taggedEntities || {}
	})

	// Extract character draft from chat metadata (stored separately from tagged entities)
	// Only update when the draft content actually changes
	$effect(() => {
		// Track chat.metadata to detect changes
		const metadata = chat?.metadata

		if (!metadata) {
			if (characterDraft !== null) {
				characterDraft = null
				console.log("[Page] No chat metadata, clearing draft")
			}
			return
		}

		const parsedMetadata = metadata

		// Draft is in dataEditor.create.characters[0], NOT in taggedEntities
		const extractedDraft =
			parsedMetadata?.dataEditor?.create?.characters?.[0] || null

		// Only update if the draft actually changed (deep comparison by stringifying)
		const currentDraftStr = characterDraft
			? JSON.stringify(characterDraft)
			: null
		const extractedDraftStr = extractedDraft
			? JSON.stringify(extractedDraft)
			: null

		if (currentDraftStr !== extractedDraftStr) {
			characterDraft = extractedDraft
			console.log("[Page] Draft changed, updating")
			console.log("[Page] Extracted character draft:", extractedDraft)
		}
	})

	// Check if we can send a message
	let canSendMessage = $derived.by(() => {
		return (
			!!chat &&
			newMessage.trim().length > 0 &&
			!hasGeneratingMessage &&
			!isSending
		)
	})

	// Load assistant chat on mount
	onMount(() => {
		if (!socket) return

		// Set up listeners first - using V2 events for new assistant system
		socket.on("chatMessage", handleChatMessage)
		socket.on("chats:get", handleChatGetResponse)
		socket.on("chats:titleGenerated", handleTitleGenerated)
		socket.on("assistant:completeV2", handleAssistantCompleteV2)
		socket.on("assistant:errorV2", handleAssistantErrorV2)
		socket.on("assistant:progress", handleAssistantProgress)
		socket.on("assistant:unlinkSuccess", handleUnlinkSuccess)
		socket.on("assistant:editDraftSuccess", handleEditDraftSuccess)
		socket.on("assistant:editDraftError", handleEditDraftError)
		socket.on("assistant:metadataUpdated", handleMetadataUpdated)

		if (chatId) {
			// Load specific chat
			socket.emit("chats:get", { id: chatId })
		}

		// Cleanup listeners on unmount
		return () => {
			;(socket as any).off("chatMessage", handleChatMessage)
			;(socket as any).off("chats:get", handleChatGetResponse)
			;(socket as any).off("chats:titleGenerated", handleTitleGenerated)
			;(socket as any).off(
				"assistant:completeV2",
				handleAssistantCompleteV2
			)
			;(socket as any).off("assistant:errorV2", handleAssistantErrorV2)
			;(socket as any).off("assistant:progress", handleAssistantProgress)
			;(socket as any).off("assistant:unlinkSuccess", handleUnlinkSuccess)
			;(socket as any).off(
				"assistant:editDraftSuccess",
				handleEditDraftSuccess
			)
			;(socket as any).off(
				"assistant:editDraftError",
				handleEditDraftError
			)
			;(socket as any).off(
				"assistant:metadataUpdated",
				handleMetadataUpdated
			)
		}
	})

	// Watch for chat ID changes to reset scroll tracking
	$effect(() => {
		if (chatId) {
			isInitialLoad = true
			lastSeenMessageId = null
			lastSeenMessageContent = ""
			// Load the chat
			socket?.emit("chats:get", { id: chatId })
		}
	})

	function handleChatGetResponse(res: Sockets.Chats.Get.Response) {
		if (!res.chat) {
			toaster.error({ title: "Chat not found" })
			goto("/assistant")
			return
		}

		// Verify it's an assistant chat
		if (res.chat.chatType !== ChatTypes.ASSISTANT) {
			toaster.error({ title: "This is not an assistant chat" })
			goto("/")
			return
		}

		chat = res.chat

		// Check for initial message from URL params (when chat was just created)
		const urlParams = new URLSearchParams(window.location.search)
		const initialMessage = urlParams.get("msg")

		if (initialMessage && initialMessage.trim()) {
			// Set the message and send it
			newMessage = initialMessage.trim()
			// Clean up the URL
			goto(`/assistant/${res.chat.id}`, { replaceState: true })
			// Send the message after a short delay to ensure chat state is ready
			setTimeout(() => {
				if (newMessage.trim()) {
					sendMessage()
				}
			}, 100)
		}

		scrollToBottom()
	}

	function handleSendMessageResponse(
		res: Sockets.Chats.SendAssistantMessage.Response
	) {
		isSending = false

		if (res.error) {
			toaster.error({ title: res.error })
		}
	}

	function handleTitleGenerated(data: Sockets.Chats.TitleGenerated.Call) {
		// Update current chat if it matches
		if (chat && data.chatId === chat.id) {
			chat = { ...chat, name: data.title }
		}

		console.log(`Chat ${data.chatId} title updated to: "${data.title}"`)
	}

	// New V2 handlers for tool-based assistant
	function handleAssistantCompleteV2(data: {
		chatId: number
		messageId: number
		toolsUsed: string[]
	}) {
		console.log("=== ASSISTANT COMPLETE V2 ===", data)
		isSending = false
		currentToolsUsed = data.toolsUsed || []

		// Chat and messages will be updated via chatMessage events
		// Just need to clear sending state
	}

	function handleAssistantErrorV2(data: { chatId: number; error: string }) {
		console.log("=== ASSISTANT ERROR V2 ===", data)
		isSending = false

		if (!chat || data.chatId !== chat.id) return

		toaster.error({
			title: "Assistant Error",
			description: data.error
		})
	}

	function handleAssistantProgress(data: {
		chatId: number
		type: "tool_execution" | "draft_generation"
		tool?: string
		status?: string
		field?: string
		currentField?: number
		totalFields?: number
		attempt?: number
	}) {
		console.log("=== ASSISTANT PROGRESS ===", data)

		if (!chat || data.chatId !== chat.id) return

		// Handle draft generation progress
		if (data.type === "draft_generation") {
			switch (data.status) {
				case "started":
					isDraftGenerating = true
					draftCurrentField = null
					draftCurrentFieldIndex = 0
					draftTotalFields = data.totalFields || 0
					draftGeneratedFields = []
					isDraftCorrecting = false
					draftCorrectionAttempt = 0
					break

				case "generating_field":
					draftCurrentField = data.field || null
					draftCurrentFieldIndex = data.currentField || 0
					break

				case "field_complete":
					if (
						data.field &&
						!draftGeneratedFields.includes(data.field)
					) {
						draftGeneratedFields = [
							...draftGeneratedFields,
							data.field
						]
					}
					break

				case "validating":
					draftValidationStatus = "validating"
					break

				case "correcting":
					isDraftCorrecting = true
					draftCorrectionAttempt = data.attempt || 0
					break

				case "complete":
					isDraftGenerating = false
					isDraftCorrecting = false
					draftValidationStatus = "valid"
					draftCurrentField = null
					break

				case "error":
					isDraftGenerating = false
					isDraftCorrecting = false
					draftValidationStatus = "invalid"
					break
			}
		}

		// Tool execution progress - could show a toast or indicator
		if (data.type === "tool_execution" && data.tool) {
			console.log(`Executing tool: ${data.tool}`)
		}
	}

	function handleUnlinkSuccess(data: any) {
		if (!chat || data.chatId !== chat.id) return

		console.log("Entity unlinked successfully:", data)

		// Get existing metadata (now a JSON object)
		const existingMetadata = chat.metadata || {}

		// Update chat metadata with new tagged entities (server already removed the entity)
		chat.metadata = {
			...existingMetadata,
			taggedEntities: data.taggedEntities
		}

		// Force reactivity
		chat = chat
		toaster.success({ title: "Entity unlinked successfully" })
	}

	function handleSaveDraft() {
		if (!socket || !chat || !characterDraft) return

		console.log("Saving character draft:", characterDraft)
		socket.emit("assistant:saveDraft", { chatId: chat.id })
	}

	function handleCancelDraft() {
		characterDraft = null
		draftValidationStatus = null
		draftErrors = null
		draftGeneratedFields = []
		isDraftGenerating = false
		draftCurrentField = null
		draftCurrentFieldIndex = 0
		draftTotalFields = 0
		isDraftCorrecting = false
		draftCorrectionAttempt = 0

		toaster.info({ title: "Draft cancelled" })
	}

	function handleRegenerateField(event: CustomEvent<{ field: string }>) {
		if (!socket || !chat) return

		console.log("Regenerating field:", event.detail.field)
		// TODO: Implement field regeneration
		toaster.info({ title: `Regenerating ${event.detail.field}...` })
	}

	function handleEditField(
		event: CustomEvent<{ field: string; value: any }>
	) {
		if (!characterDraft) return

		console.log(
			"Editing field:",
			event.detail.field,
			"=",
			event.detail.value
		)
		characterDraft = {
			...characterDraft,
			[event.detail.field]: event.detail.value
		}
	}

	// Handle updateField event (triggered on blur) - sends to server
	let draftPreviewComponent: any = $state(null)

	function handleUpdateField(
		event: CustomEvent<{ field: string; value: any }>
	) {
		if (!socket || !chat || !characterDraft) return

		const { field, value } = event.detail

		// Parse value for array fields
		let finalValue = value
		if (
			field === "alternateGreetings" ||
			field === "exampleDialogues" ||
			field === "groupOnlyGreetings" ||
			field === "source"
		) {
			// Split by newlines and filter empty lines
			finalValue = value
				.split("\n")
				.filter((line: string) => line.trim().length > 0)
		}

		console.log("Updating field via socket:", field, "=", finalValue)

		// Emit to server with new modular structure
		socket.emit("assistant:editDraft", {
			chatId: chat.id,
			operation: "create", // Currently creating new character
			entityType: "characters", // Entity type
			entityIndex: 0, // Index in the array
			field,
			value: finalValue
		})
	}

	function handleEditDraftSuccess(data: {
		chatId: number
		operation: "create" | "edit"
		entityType: "characters" | "personas"
		entityIndex: number
		field: string
		value: any
		draft: any
		chat?: any
	}) {
		console.log("Draft field updated successfully:", data.field)

		// Update the local draft
		if (
			characterDraft &&
			data.operation === "create" &&
			data.entityType === "characters" &&
			data.entityIndex === 0
		) {
			characterDraft = {
				...characterDraft,
				[data.field]: data.value
			}

			// Clear saving state in the preview component
			if (draftPreviewComponent) {
				draftPreviewComponent.clearSavingState(data.field)
			}
		}

		// Update the chat with the latest metadata if provided
		if (data.chat && chat && data.chat.id === chat.id) {
			chat = {
				...chat,
				metadata: data.chat.metadata,
				updatedAt: data.chat.updatedAt
			}
			console.log("[editDraftSuccess] Updated chat metadata")
		}

		// Show success toast
		toaster.success({
			title: "Field Updated",
			description: `${data.field} has been saved`
		})
	}

	function handleEditDraftError(data: {
		error: string
		field?: string
		value?: any
	}) {
		console.error("Failed to update draft field:", data.error)

		// Clear saving state if field is specified
		if (data.field && draftPreviewComponent) {
			draftPreviewComponent.clearSavingState(data.field)
		}

		// Show error toast
		toaster.error({
			title: "Update Failed",
			description: data.error
		})
	}

	function handleMetadataUpdated(data: {
		chatId: number
		metadata: string | object
	}) {
		console.log(
			"[handleMetadataUpdated] Received metadata update for chat",
			data.chatId
		)

		if (!chat || chat.id !== data.chatId) return

		// Update the chat's metadata, triggering the $effect that extracts the draft
		chat = {
			...chat,
			metadata: data.metadata
		}

		console.log(
			"[handleMetadataUpdated] Chat metadata updated, $effect will extract draft"
		)
	}

	function handleChatMessage(data: Sockets.ChatMessage.Call) {
		if (!chat || !data.chatMessage || data.chatMessage.chatId !== chat.id)
			return

		// Ensure chatMessages array exists
		if (!chat.chatMessages) {
			chat.chatMessages = []
		}

		const existingIndex = chat.chatMessages.findIndex(
			(m) => m.id === data.chatMessage!.id
		)

		if (existingIndex >= 0) {
			// Update existing message
			chat.chatMessages[existingIndex] = data.chatMessage
		} else {
			// Add new message
			chat.chatMessages.push(data.chatMessage)
		}

		// Trigger reactivity
		chat = chat

		// Auto-scroll to bottom when new message arrives
		if (
			data.chatMessage.role === "assistant" ||
			!data.chatMessage.isGenerating
		) {
			setTimeout(scrollToBottom, 100)
		}
	}

	async function sendMessage() {
		if (!canSendMessage || !chat || !socket) return

		const content = newMessage.trim()
		newMessage = "" // Clear input immediately
		isSending = true

		// Use new V2 event for tool-based assistant
		socket.emit("assistant:sendMessageV2", {
			chatId: chat.id,
			content
		})
	}

	function scrollToBottom() {
		if (messagesContainer) {
			setTimeout(() => {
				messagesContainer?.scrollTo({
					top: messagesContainer.scrollHeight,
					behavior: "smooth"
				})
			}, 50)
		}
	}

	// Helper function to perform autoscroll with retries
	function performAutoscroll(attempt = 1, maxAttempts = 3) {
		if (!messagesContainer) return

		const scrollHeight = messagesContainer.scrollHeight
		const clientHeight = messagesContainer.clientHeight

		// Check if there's actually content to scroll to
		if (scrollHeight > clientHeight) {
			messagesContainer.scrollTo({
				top: scrollHeight,
				behavior: isInitialLoad ? "instant" : "smooth"
			})
			return
		}

		// If no content yet and we haven't exceeded max attempts, retry
		if (attempt < maxAttempts) {
			const delay = attempt === 1 ? 100 : 300
			setTimeout(() => performAutoscroll(attempt + 1, maxAttempts), delay)
		}
	}

	// Auto-scroll to bottom on new messages, initial load, or last message content updates
	$effect(() => {
		// React to changes in messages and container
		const messagesLength = chat?.chatMessages?.length ?? 0
		const lastMsg = chat?.chatMessages?.[messagesLength - 1]
		const currentLastMessageId = lastMsg?.id
		const currentLastMessageContent = lastMsg?.content || ""

		if (messagesContainer && messagesLength > 0) {
			// Determine if we should autoscroll
			const isNewMessage =
				currentLastMessageId &&
				(!lastSeenMessageId || currentLastMessageId > lastSeenMessageId)
			const isLastMessageContentUpdated =
				currentLastMessageId === lastSeenMessageId &&
				currentLastMessageContent !== lastSeenMessageContent

			const shouldAutoscroll =
				isInitialLoad || isNewMessage || isLastMessageContentUpdated

			if (shouldAutoscroll) {
				performAutoscroll()
				isInitialLoad = false
			}

			// Update tracking variables
			if (currentLastMessageId) {
				lastSeenMessageId = currentLastMessageId
				lastSeenMessageContent = currentLastMessageContent
			}
		}
	})

	// Simple handlers for ChatMessage component
	function getMessageCharacter(msg: SelectChatMessage) {
		// For assistant chat, we can create a simple assistant "character" object
		if (msg.role === "assistant") {
			return {
				name: "Serenity",
				avatar: null
			} as any
		}
		// For user messages, return the user
		return {
			name: userCtx.user?.displayName || userCtx.user?.username || "You",
			avatar: null
		} as any
	}

	function canControlMessage(msg: SelectChatMessage) {
		// Can only delete own messages in assistant chat
		return msg.role === "user"
	}

	function showSwipeControls() {
		return false // No swipe controls in assistant chat
	}

	function canSwipeRight() {
		return false
	}

	function handleDeleteMessage(event: MouseEvent, msg: SelectChatMessage) {
		if (!socket) return
		// Simplified delete - just call the socket
		if (confirm("Delete this message?")) {
			socket.emit("chatMessages:delete", { id: msg.id })
		}
	}

	function handleRegenerateMessage(
		event: MouseEvent,
		msg: SelectChatMessage
	) {
		if (!chat || !socket) return
		socket.emit("chatMessages:regenerate", { id: msg.id })
	}

	function handleAbortMessage(event: MouseEvent, msg: SelectChatMessage) {
		if (!socket) return
		socket.emit("chatMessages:cancel", { messageId: msg.id })
	}

	function handleScroll(event: Event) {
		// No pagination in assistant chat for now
	}

	// Placeholder functions to satisfy component requirements
	function noop() {}

	function handleBackButton() {
		// Go back to assistant index
		goto("/assistant")
	}
</script>

<div class="flex h-full w-full flex-col">
	<!-- Header -->
	<div
		class="preset-filled-surface-100-950 border-surface-400-600 flex items-center gap-4 border-b p-4"
	>
		<button
			class="btn preset-tonal-surface"
			onclick={handleBackButton}
			title="Back to Serenity"
		>
			<Icons.ArrowLeft size={20} />
		</button>
		<div class="flex-1">
			<h1 class="text-xl font-bold">
				<Icons.BotMessageSquare class="inline" size={24} />
				{chat?.name || "Serenity"}
			</h1>
			<p class="text-muted text-sm">Your AI assistant for Serene Pub</p>
		</div>
	</div>

	<!-- Main Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if !chat}
			<!-- Loading specific chat -->
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<Icons.BotMessageSquare
						size={48}
						class="text-muted mx-auto mb-4"
					/>
					<p class="text-muted">Loading conversation...</p>
				</div>
			</div>
		{:else}
			<ChatContainer
				{chat}
				pagination={undefined}
				loadingOlderMessages={false}
				bind:chatMessagesContainer={messagesContainer}
				onScroll={handleScroll}
				{getMessageCharacter}
				{canControlMessage}
				{showSwipeControls}
				{canSwipeRight}
				onSwipeLeft={noop}
				onSwipeRight={noop}
				onEditMessage={noop}
				onDeleteMessage={handleDeleteMessage}
				onHideMessage={noop}
				onRegenerateMessage={handleRegenerateMessage}
				onAbortMessage={handleAbortMessage}
				editChatMessage={undefined}
				canRegenerateLastMessage={false}
				isGuest={false}
			>
				{#snippet MessageComponent({ msg, index, chat, isLastMessage })}
					<ChatMessage
						{msg}
						{index}
						{chat}
						{isLastMessage}
						messagesLength={chat.chatMessages.length}
						{getMessageCharacter}
						{canControlMessage}
						{showSwipeControls}
						{canSwipeRight}
						onSwipeLeft={noop}
						onSwipeRight={noop}
						onEditMessage={noop}
						onDeleteMessage={handleDeleteMessage}
						onHideMessage={noop}
						onRegenerateMessage={handleRegenerateMessage}
						onAbortMessage={handleAbortMessage}
						onCharacterNameClick={noop}
						onAvatarClick={noop}
						onCancelEditMessage={noop}
						onSaveEditMessage={noop}
						bind:openMobileMsgControls
						editChatMessage={undefined}
						canRegenerateLastMessage={false}
						isGuest={false}
						lastPersonaMessage={undefined}
					>
						{#snippet GeneratingAnimationComponent()}
							<GeneratingAnimation
								text={msg.metadata?.reasoning
									? "Assistant is answering"
									: "Assistant is working"}
							/>
						{/snippet}
					</ChatMessage>
				{/snippet}

				{#snippet ComposerComponent()}
					<div
						class="preset-filled-surface-50-950 border-surface-400-600 border-t"
					>
						<!-- Character Draft Preview above data manager -->
						{#if characterDraft && chat}
							{@const _ = console.log(
								"[Render] Showing draft preview"
							)}
							<AssistantCharacterDraftWrapper
								bind:this={draftPreviewComponent}
								draft={characterDraft}
								validationStatus={draftValidationStatus}
								isGenerating={isDraftGenerating}
								chatId={chat.id}
								on:save={handleSaveDraft}
								on:cancel={handleCancelDraft}
							/>
						{/if}

						<!-- Data Manager above input -->

						{#if chat}
							<div class="p-4 pb-2">
								<AssistantDataManager
									chatId={chat.id}
									{taggedEntities}
								/>
							</div>
						{/if}

						<!-- Message Input -->
						<div class="p-4 pt-2">
							<form
								class="flex gap-2"
								onsubmit={(e) => {
									e.preventDefault()
									sendMessage()
								}}
							>
								<input
									type="text"
									class="input flex-1"
									placeholder="Ask me anything about Serene Pub..."
									bind:value={newMessage}
									disabled={hasGeneratingMessage || isSending}
									aria-label="Message input"
								/>
								<button
									type="submit"
									class="btn preset-filled-primary"
									disabled={!canSendMessage}
									title="Send message"
								>
									{#if isSending}
										<Icons.Loader2
											size={20}
											class="animate-spin"
										/>
									{:else}
										<Icons.Send size={20} />
									{/if}
								</button>
							</form>
						</div>
					</div>
				{/snippet}
			</ChatContainer>
		{/if}
	</div>
</div>
