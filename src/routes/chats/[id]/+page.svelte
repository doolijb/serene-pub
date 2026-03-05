<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { Modal, Popover } from "@skeletonlabs/skeleton-svelte"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import ChatContainer from "$lib/client/components/chatMessages/ChatContainer.svelte"
	import ChatMessage from "$lib/client/components/chatMessages/ChatMessage.svelte"
	import NextCharacterBlock from "$lib/client/components/chatMessages/NextCharacterBlock.svelte"
	import ChatComposer from "$lib/client/components/chatMessages/ChatComposer.svelte"
	import GeneratingAnimation from "$lib/client/components/chatMessages/GeneratingAnimation.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onMount } from "svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchChatModal from "$lib/client/components/modals/BranchChatModal.svelte"
	import { toaster } from "$lib/client/utils/toaster"

	let chat: Sockets.Chats.Get.Response["chat"] | undefined = $state()
	let pagination: Sockets.Chats.Get.Response["pagination"] | undefined =
		$state()
	let newMessage = $state("")
	const socket = skio.get()
	let showDeleteMessageModal = $state(false)
	let deleteChatMessage: SelectChatMessage | undefined = $state()
	let editChatMessage: SelectChatMessage | undefined = $state()
	let draftCompiledPrompt:
		| Sockets.Chats.PromptTokenCount.Response
		| undefined = $state()
	let userCtx: UserCtx = getContext("userCtx")
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	let promptTokenCountTimeout: ReturnType<typeof setTimeout> | null = null
	let autoTriggerTimeout: ReturnType<typeof setTimeout> | null = null
	let loadingOlderMessages = $state(false)
	let messagesContainer: HTMLElement | undefined = $state()
	let contextExceeded = $derived(
		!!draftCompiledPrompt
			? draftCompiledPrompt!.meta.tokenCounts.total >
					draftCompiledPrompt!.meta.tokenCounts.limit
			: false
	)
	let openMobileMsgControls: number | undefined = $state(undefined)
	let showDraftCompiledPromptModal = $state(false)
	let showTriggerCharacterMessageModal = $state(false)
	let triggerCharacterSearch = $state("")
	let showAddPersonaModal = $state(false)
	let showBranchChatModal = $state(false)
	let branchFromMessage: SelectChatMessage | undefined = $state()
	let chatResponseOrder: Sockets.Chats.GetResponseOrder.Response | undefined =
		$state()
	let availablePersonas: Sockets.Personas.List.Response["personaList"] =
		$state([])

	// Get chat id from route params
	let chatId: number = $derived.by(() => Number(page.params.id))

	let lastMessage: SelectChatMessage | undefined = $derived.by(() => {
		if (chat && chat.chatMessages.length > 0) {
			return chat.chatMessages[chat.chatMessages.length - 1]
		}
		return undefined
	})

	let lastPersonaMessage: SelectChatMessage | undefined = $derived.by(() => {
		if (chat && chat.chatMessages.length > 0) {
			return chat.chatMessages
				.slice()
				.reverse()
				.find((msg: SelectChatMessage) => msg.personaId)
		}
		return undefined
	})

	let canRegenerateLastMessage: boolean = $derived.by(() => {
		return (
			(!lastMessage?.metadata?.isGreeting &&
				!!lastMessage &&
				!lastMessage.isGenerating &&
				!lastMessage.isHidden &&
				(!lastPersonaMessage ||
					lastPersonaMessage.id < lastMessage.id)) ||
			false
		)
	})

	// Check if any message is currently generating
	let hasGeneratingMessage: boolean = $derived.by(() => {
		return chat?.chatMessages?.some((msg) => msg.isGenerating) || false
	})

	// Determine if we should show the next character block
	let shouldShowNextCharacterBlock: boolean = $derived.by(() => {
		const hasMessageDraft = newMessage.trim().length > 0
		const isEditingMessage = !!editChatMessage
		const hasNextCharacter = !!chatResponseOrder?.nextCharacterId
		const isGroupChat =
			!!chat?.isGroup && (chat?.chatCharacters?.length || 0) > 1

		const shouldShow =
			isGroupChat &&
			!hasGeneratingMessage &&
			!hasMessageDraft &&
			!isEditingMessage &&
			hasNextCharacter &&
			!!chat?.chatMessages?.length // Only show if there are messages

		return shouldShow
	})

	// Get the next character info from chat data
	let nextCharacter: SelectCharacter | undefined = $derived.by(() => {
		if (!chatResponseOrder?.nextCharacterId) {
			return undefined
		}

		const foundCharacter = chat?.chatCharacters?.find(
			(cc) => cc.characterId === chatResponseOrder.nextCharacterId
		)?.character

		return foundCharacter
	})

	// Check if current user is a guest (not the chat owner)
	let isGuest: boolean = $derived.by(() => {
		if (!chat || !userCtx.user?.id) return false
		const isGuest = chat.userId !== userCtx.user.id
		console.log("Guest check:", {
			chatUserId: chat.userId,
			currentUserId: userCtx.user.id,
			isGuest
		})
		return isGuest
	})

	// Check if current user has a persona in this chat
	let userHasPersonaInChat: boolean = $derived.by(() => {
		if (!chat?.chatPersonas || !userCtx.user?.id) return false
		return chat.chatPersonas.some(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	})

	// Determine if we should show the add persona CTA
	let showAddPersonaCTA: boolean = $derived.by(() => {
		return isGuest && !userHasPersonaInChat
	})

	// Get the current user's persona in this chat
	let currentUserPersona: SelectChatPersona | undefined = $derived.by(() => {
		if (!chat?.chatPersonas || !userCtx.user?.id) return undefined
		return chat.chatPersonas.find(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	})

	// Get ordered characters from chat data using the response order
	let orderedCharacters: SelectCharacter[] = $derived.by(() => {
		if (!chatResponseOrder?.characterIds || !chat?.chatCharacters) return []
		return chatResponseOrder.characterIds
			.map(
				(id) =>
					chat.chatCharacters.find((cc) => cc.characterId === id)
						?.character
			)
			.filter((char) => char !== undefined) as SelectCharacter[]
	})

	// Check if current user can edit/control a specific message
	let canControlMessage = (msg: SelectChatMessage): boolean => {
		if (!isGuest) return true // Chat owner can control all messages
		if (!userCtx.user?.id) return false

		// Guest can only control messages from their own personas
		if (msg.personaId) {
			return (
				chat?.chatPersonas?.some(
					(cp) =>
						cp.personaId === msg.personaId &&
						cp.persona?.userId === userCtx.user?.id
				) ?? false
			)
		}

		return false
	}

	// Check if all personas have responded after last character message
	let allPersonasHaveResponded = $derived.by(() => {
		if (
			!chat?.isGroup ||
			!chat?.chatMessages?.length ||
			!chat?.chatPersonas?.length
		)
			return true

		// Find the last character (assistant) message
		let lastCharacterMsgIndex = -1
		for (let i = chat.chatMessages.length - 1; i >= 0; i--) {
			if (
				chat.chatMessages[i].role === "assistant" &&
				chat.chatMessages[i].characterId
			) {
				lastCharacterMsgIndex = i
				break
			}
		}

		// If no character messages, all personas should respond
		if (lastCharacterMsgIndex === -1) return false

		// Get messages after the last character message
		const messagesAfterLastCharacter = chat.chatMessages.slice(
			lastCharacterMsgIndex + 1
		)

		// Check if each persona has sent a message after the last character message
		const personaIds = chat.chatPersonas.map((cp) => cp.personaId)
		const respondedPersonaIds = new Set(
			messagesAfterLastCharacter
				.filter((msg) => msg.role === "user" && msg.personaId)
				.map((msg) => msg.personaId)
		)

		// All personas have responded if every persona ID is in the responded set
		return personaIds.every((id) => respondedPersonaIds.has(id))
	})

	function handleSend() {
		if (!newMessage.trim()) return

		// Use the current user's persona if they have one, otherwise use the first persona (for chat owner)
		const personaId =
			currentUserPersona?.personaId || chat?.chatPersonas?.[0]?.personaId

		if (!personaId) {
			toaster.error({ title: "No persona selected for this chat" })
			return
		}

		const msg: Sockets.ChatMessages.SendPersonaMessage.Params = {
			chatId,
			personaId,
			content: newMessage
		}
		socket.emit("chatMessages:sendPersonaMessage", msg)
		newMessage = ""

		// In group chats, check if this message will complete all persona responses
		if (chat?.isGroup && chat?.chatPersonas?.length > 1) {
			// We need to check if sending this message will mean all personas have responded
			// This is a bit complex because we need to account for the message we just sent

			// Find the last character message
			let lastCharacterMsgIndex = -1
			for (let i = chat.chatMessages.length - 1; i >= 0; i--) {
				if (
					chat.chatMessages[i].role === "assistant" &&
					chat.chatMessages[i].characterId
				) {
					lastCharacterMsgIndex = i
					break
				}
			}

			console.log(
				"Checking persona responses after character at index:",
				lastCharacterMsgIndex
			)

			if (lastCharacterMsgIndex >= 0) {
				// Get messages after the last character message
				const messagesAfterLastCharacter = chat.chatMessages.slice(
					lastCharacterMsgIndex + 1
				)

				// Get persona IDs that have already responded
				const respondedPersonaIds = new Set(
					messagesAfterLastCharacter
						.filter((msg) => msg.role === "user" && msg.personaId)
						.map((msg) => msg.personaId)
				)

				// Add the persona that just sent a message
				respondedPersonaIds.add(personaId)

				// Check if all personas have now responded
				const allPersonaIds = chat.chatPersonas.map(
					(cp) => cp.personaId
				)
				const allResponded = allPersonaIds.every((id) =>
					respondedPersonaIds.has(id)
				)

				console.log("Persona turn tracking:", {
					allPersonaIds,
					respondedPersonaIds: Array.from(respondedPersonaIds),
					currentPersonaId: personaId,
					allResponded,
					messagesAfterChar: messagesAfterLastCharacter.map((m) => ({
						role: m.role,
						personaId: m.personaId,
						characterId: m.characterId
					}))
				})

				if (allResponded) {
					console.log(
						"All personas have responded, triggering character responses..."
					)
					// Clear any existing timeout
					if (autoTriggerTimeout) {
						clearTimeout(autoTriggerTimeout)
					}
					// Small delay to ensure the message is processed before triggering responses
					autoTriggerTimeout = setTimeout(() => {
						socket.emit("chats:triggerGenerateMessage", { chatId })
						autoTriggerTimeout = null
					}, 500)
				} else {
					console.log(
						"Not all personas have responded yet, waiting..."
					)
				}
			} else {
				console.log("No character messages found in chat yet")
			}
		}

		// Refresh response order after sending message
		socket.emit("chats:getResponseOrder", { chatId })
	}

	function getMessageCharacter(
		msg: SelectChatMessage
	): SelectCharacter | SelectPersona | undefined {
		if (msg.personaId) {
			const persona = chat?.chatPersonas?.find(
				(p: SelectChatPersona) => p.personaId === msg.personaId
			)?.persona
			return persona
		} else if (msg.characterId) {
			const character = chat?.chatCharacters?.find(
				(c: SelectChatCharacter) => c.characterId === msg.characterId
			)?.character
			return character
		}
	}

	function openDeleteMessageModal(message: SelectChatMessage) {
		deleteChatMessage = message
		showDeleteMessageModal = true
	}

	function onOpenMessageDeleteChange(details: OpenChangeDetails) {
		showDeleteMessageModal = details.open
		if (!showDeleteMessageModal) {
			deleteChatMessage = undefined
		}
	}

	function onDeleteMessageConfirm() {
		socket.emit("chatMessages:delete", {
			id: deleteChatMessage?.id
		})
		deleteChatMessage = undefined
		showDeleteMessageModal = false
	}

	function onDeleteMessageCancel() {
		deleteChatMessage = undefined
		showDeleteMessageModal = false
	}

	function onBranchChatConfirm(title: string) {
		if (branchFromMessage && chat) {
			socket.emit("chats:branch", {
				chatId,
				messageId: branchFromMessage.id,
				title
			})
		}
		branchFromMessage = undefined
		showBranchChatModal = false
	}

	function onBranchChatCancel() {
		branchFromMessage = undefined
		showBranchChatModal = false
	}

	function handleEditMessageClick(message: SelectChatMessage) {
		openMobileMsgControls = undefined
		editChatMessage = { ...message }
	}

	function handleMessageUpdate(event?: Event) {
		if (event) event.preventDefault()
		if (!editChatMessage || !editChatMessage.content.trim()) return

		const updatedMessage: Sockets.ChatMessages.Update.Params = {
			...editChatMessage
		}
		socket.emit("chatMessages:update", updatedMessage)
		editChatMessage = undefined
	}

	function handleRegenerateMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		socket.emit("chatMessages:regenerate", { id: msg.id })
	}

	function handleContinueMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		// The continue functionality should regenerate but preserve the existing content
		// This is handled server-side by passing continueFrom flag
		socket.emit("chatMessages:continue", { id: msg.id })
	}

	function handleHideMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		// Toggle isHidden status by updating the message
		socket.emit("chatMessages:update", {
			id: msg.id,
			isHidden: !msg.isHidden
		})
	}

	function handleDeleteMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openDeleteMessageModal(msg)
	}

	$effect(() => {
		// React to chatId changes (which is derived from page.params.id)
		if (chatId) {
			// Reset state when switching chats
			chat = undefined // Clear current chat data
			pagination = undefined
			chatResponseOrder = undefined
			draftCompiledPrompt = undefined
			editChatMessage = undefined
			newMessage = ""
			isInitialLoad = true
			lastSeenMessageId = null
			lastSeenMessageContent = ""
			loadingOlderMessages = false
			socket.emit("chats:get", { id: chatId, limit: 25, offset: 0 })
			// console.log('Debug - Emitting getChatResponseOrder for chatId:', chatId)
			socket.emit("chats:getResponseOrder", { chatId })
		}
	})

	$effect(() => {
		const _connection = userCtx?.user?.activeConnection // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _samplingConfig = userCtx?.user?.activeSamplingConfig // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _contextConfig = userCtx?.user?.activeContextConfig // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _promptConfig = userCtx?.user?.activePromptConfig // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		const _newMessage = newMessage // DO NOT REMOVE THIS LINE - REACTIVITY TRIGGER
		if (
			!chatId ||
			!lastMessage ||
			lastMessage.isGenerating ||
			!!editChatMessage
		) {
			return
		}
		if (promptTokenCountTimeout) clearTimeout(promptTokenCountTimeout)
		promptTokenCountTimeout = setTimeout(() => {
			socket.emit("chats:promptTokenCount", {
				chatId,
				content: newMessage,
				personaId: chat?.chatPersonas?.[0]?.personaId || undefined,
				role: "user"
			})
		}, 2000)
	})

	let chatMessagesContainer: HTMLDivElement | null = $state(null)
	let lastSeenMessageId: number | null = $state(null)
	let lastSeenMessageContent: string = $state("")
	let isInitialLoad = $state(true)

	// Helper function to perform autoscroll with retries
	function performAutoscroll(attempt = 1, maxAttempts = 3) {
		if (!chatMessagesContainer || loadingOlderMessages) return

		const scrollHeight = chatMessagesContainer.scrollHeight
		const clientHeight = chatMessagesContainer.clientHeight

		// Check if there's actually content to scroll to
		if (scrollHeight > clientHeight) {
			chatMessagesContainer.scrollTo({
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
		const lastMessage = chat?.chatMessages?.[messagesLength - 1]
		const currentLastMessageId = lastMessage?.id
		const currentLastMessageContent = lastMessage?.content || ""

		if (
			chatMessagesContainer &&
			messagesLength > 0 &&
			!loadingOlderMessages
		) {
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
				// Use the new performAutoscroll function
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

	function handleEditMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		handleEditMessageClick(msg)
	}
	function handleCancelEditMessage(e: Event) {
		e.stopPropagation()
		editChatMessage = undefined
	}
	function handleSaveEditMessage(e: Event) {
		e.stopPropagation()
		handleMessageUpdate(e)
	}
	function handleAbortMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		// Clear any pending auto-trigger timeout
		if (autoTriggerTimeout) {
			clearTimeout(autoTriggerTimeout)
			autoTriggerTimeout = null
		}
		socket.emit("chatMessages:cancel", { id: msg.id, chatId })
	}
	function handleBranchMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		branchFromMessage = msg
		showBranchChatModal = true
	}
	function handleSendButton(e: Event) {
		e.stopPropagation()
		handleSend()
	}
	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		// Clear any pending auto-trigger timeout
		if (autoTriggerTimeout) {
			clearTimeout(autoTriggerTimeout)
			autoTriggerTimeout = null
		}
		if (lastMessage)
			socket.emit("chatMessages:cancel", { id: lastMessage.id, chatId })
	}
	function handleTriggerContinueConversation(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		socket.emit("chats:triggerGenerateMessage", { chatId, triggered: true })
	}
	function handleTriggerCharacterMessage(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		showTriggerCharacterMessageModal = true
	}
	function handleRegenerateLastMessage(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		if (lastMessage && !lastMessage.isGenerating) {
			socket.emit("chatMessages:regenerate", { id: lastMessage.id })
		}
	}

	function onSelectTriggerCharacterMessage(characterId: number) {
		showTriggerCharacterMessageModal = false
		openMobileMsgControls = undefined
		socket.emit("chats:triggerGenerateMessage", {
			chatId,
			characterId,
			once: true
		})
	}

	function handleContinueWithNextCharacter() {
		if (!nextCharacter) return
		socket.emit("chats:triggerGenerateMessage", {
			chatId,
			characterId: nextCharacter.id,
			once: true
		})
	}

	function handleChooseDifferentCharacter() {
		showTriggerCharacterMessageModal = true
	}

	function handleAddPersona(personaId: number) {
		const req: Sockets.Chats.AddPersona.Params = {
			chatId,
			personaId
		}
		socket.emit("chats:addPersona", req)
		showAddPersonaModal = false
	}

	function handleCharacterNameClick(msg: SelectChatMessage): void {
		if (msg.characterId) {
			panelsCtx.openPanel({ key: "characters", toggle: false })
			panelsCtx.digest.characterId = msg.characterId
		} else if (msg.personaId) {
			panelsCtx.openPanel({ key: "personas", toggle: false })
			panelsCtx.digest.personaId = msg.personaId
		}
	}

	function swipeRight(msg: SelectChatMessage): void {
		const req: Sockets.ChatMessages.SwipeRight.Params = {
			id: msg.id
		}
		socket.emit("chatMessages:swipeRight", req)
	}

	function swipeLeft(msg: SelectChatMessage): void {
		const req: Sockets.ChatMessages.SwipeLeft.Params = {
			id: msg.id
		}
		socket.emit("chatMessages:swipeLeft", req)
	}

	async function loadOlderMessages() {
		if (loadingOlderMessages || !pagination?.hasMore || !chat) return

		loadingOlderMessages = true

		// Store current scroll position to restore it after loading
		const scrollHeight = chatMessagesContainer?.scrollHeight || 0
		const currentOffset = chat.chatMessages.length

		socket.emit("chats:get", {
			id: chatId,
			limit: 25,
			offset: currentOffset
		})

		// Store scroll height for position restoration
		if (chatMessagesContainer) {
			chatMessagesContainer.dataset.previousScrollHeight =
				scrollHeight.toString()
		}

		// loadingOlderMessages will be set to false in the socket response handler
	}

	function handleScroll(event: Event) {
		const target = event.target as HTMLElement
		if (!target || loadingOlderMessages || !pagination?.hasMore) return

		// Check if user scrolled to within 200px of the top
		if (target.scrollTop <= 200) {
			loadOlderMessages()
		}
	}

	function canSwipeRight(
		msg: SelectChatMessage,
		isGreeting: boolean
	): boolean {
		if (msg.isGenerating) return false
		if (lastPersonaMessage && lastPersonaMessage.id >= msg.id) {
			return false
		}
		if (isGreeting) {
			const idx = msg.metadata?.swipes?.currentIdx
			const len = msg.metadata?.swipes?.history?.length ?? 0
			if (typeof idx !== "number" || len === 0) return false
			return idx < len - 1
		}
		return true
	}

	function showSwipeControls(
		msg: SelectChatMessage,
		isGreeting: boolean
	): boolean {
		let res = false
		if (msg.id === lastMessage?.id && !isGreeting) {
			// If this is the last message, we always show swipe controls
			res = canRegenerateLastMessage
		} else if (msg.isGenerating) {
			res = false
		} else if (msg.role === "user") {
			return false
		} else if (openMobileMsgControls === msg.id) {
			res = true
		} else if (isGreeting) {
			res = (lastPersonaMessage?.id ?? 0) < msg.id
		}
		return res
	}

	onMount(() => {
		// Fetch available personas for guest users
		socket.emit("personas:list", {})

		socket.on("personas:list", (msg: Sockets.Personas.List.Response) => {
			availablePersonas = msg.personaList
		})

		socket.on("chats:get", (msg: Sockets.Chats.Get.Response) => {
			if (msg.chat.id === Number.parseInt(page.params.id)) {
				if (chat && loadingOlderMessages) {
					// Merge older messages (avoiding duplicates)
					const existingIds = new Set(
						chat.chatMessages.map((m) => m.id)
					)
					const newMessages = msg.chat.chatMessages.filter(
						(m) => !existingIds.has(m.id)
					)
					// Add older messages at the beginning, then sort all messages by ID (chronological order)
					const allMessages = [...newMessages, ...chat.chatMessages]
					chat.chatMessages = allMessages.sort((a, b) => a.id - b.id)

					// Restore scroll position after loading older messages
					setTimeout(() => {
						if (chatMessagesContainer) {
							const previousScrollHeight = parseInt(
								chatMessagesContainer.dataset
									.previousScrollHeight || "0"
							)
							const newScrollHeight =
								chatMessagesContainer.scrollHeight
							const scrollDiff =
								newScrollHeight - previousScrollHeight

							// Maintain the user's relative position by scrolling down by the difference
							chatMessagesContainer.scrollTop = scrollDiff
							delete chatMessagesContainer.dataset
								.previousScrollHeight
						}
						loadingOlderMessages = false
					}, 10)
				} else {
					// Initial load or refresh - ensure messages are sorted chronologically
					chat = {
						...msg.chat,
						chatMessages: msg.chat.chatMessages.sort(
							(a, b) => a.id - b.id
						)
					}
					loadingOlderMessages = false
				}
				pagination = msg.pagination
				// Auto-scroll is handled by the $effect
			}
		})

		socket.on("chatMessage", (msg: Sockets.ChatMessage.Response) => {
			if (chat !== undefined && msg.chatMessage.chatId === chatId) {
				const existingIndex = chat!.chatMessages.findIndex(
					(m: SelectChatMessage) => m.id === msg.chatMessage.id
				)
				if (existingIndex !== -1) {
					const updatedMessages = [...chat!.chatMessages]
					updatedMessages[existingIndex] = msg.chatMessage
					chat = { ...chat, chatMessages: updatedMessages }
				} else {
					// Add new message and maintain chronological order
					const updatedMessages = [
						...chat.chatMessages,
						msg.chatMessage
					]
					chat = {
						...chat,
						chatMessages: updatedMessages.sort(
							(a, b) => a.id - b.id
						)
					}
				}
				// Refresh response order when messages change
				socket.emit("chats:getResponseOrder", { chatId })
				// Auto-scroll is handled by the $effect
			}
		})

		socket.on(
			"characters:update",
			(msg: Sockets.Characters.Update.Response) => {
				const charId = msg.character?.id
				if (!charId || !chat) return

				// Update chat characters if the character is in the chat
				const chatCharacterIndex = chat.chatCharacters.findIndex(
					(c: SelectChatCharacter) => c.characterId === charId
				)
				if (chatCharacterIndex !== -1) {
					const updatedChatCharacters = [...chat.chatCharacters]
					updatedChatCharacters[chatCharacterIndex] = {
						...updatedChatCharacters[chatCharacterIndex],
						character: msg.character
					}
					chat = { ...chat, chatCharacters: updatedChatCharacters }
				}
			}
		)

		socket.on(
			"personas:update",
			(msg: Sockets.Personas.Update.Response) => {
				const personaId = msg.persona?.id
				if (!personaId || !chat) return

				// Update chat personas if the persona is in the chat
				const chatPersonaIndex = chat.chatPersonas.findIndex(
					(p: SelectChatPersona) => p.personaId === personaId
				)
				if (chatPersonaIndex !== -1) {
					const updatedChatPersonas = [...chat.chatPersonas]
					updatedChatPersonas[chatPersonaIndex] = {
						...updatedChatPersonas[chatPersonaIndex],
						persona: msg.persona
					}
					chat = { ...chat, chatPersonas: updatedChatPersonas }
				}
			}
		)

		socket.on(
			"chats:promptTokenCount",
			(msg: Sockets.Chats.PromptTokenCount.Response) => {
				draftCompiledPrompt = msg
			}
		)

		socket.on(
			"chatMessages:delete",
			(msg: Sockets.ChatMessages.Delete.Response) => {
				if (chat) {
					// Check if we're deleting the last message
					const wasLastMessage = lastSeenMessageId === msg.id

					// Remove the deleted message from the chat messages array
					const filteredMessages = chat.chatMessages.filter(
						(m: SelectChatMessage) => m.id !== msg.id
					)

					// Ensure messages remain sorted chronologically
					chat = {
						...chat,
						chatMessages: filteredMessages.sort(
							(a, b) => a.id - b.id
						)
					}

					// Update tracking state if we deleted the last message
					if (wasLastMessage && chat.chatMessages.length > 0) {
						const newLastMessage =
							chat.chatMessages[chat.chatMessages.length - 1]
						lastSeenMessageId = newLastMessage.id
						lastSeenMessageContent = newLastMessage.content || ""
					} else if (chat.chatMessages.length === 0) {
						lastSeenMessageId = null
						lastSeenMessageContent = ""
					}

					// Refresh response order after deletion
					socket.emit("chats:getResponseOrder", { chatId })
				}
			}
		)

		socket.on(
			"chats:getResponseOrder",
			(msg: Sockets.Chats.GetResponseOrder.Response) => {
				if (msg.chatId === chatId) {
					chatResponseOrder = msg
				}
			}
		)

		socket.on(
			"chats:addPersona",
			(msg: Sockets.Chats.AddPersona.Response) => {
				if (msg.success) {
					toaster.success({
						title: "Persona added to chat successfully"
					})
				} else if (msg.error) {
					toaster.error({ title: msg.error })
				}
			}
		)

		socket.on("chats:branch", (msg: Sockets.Chats.Branch.Response) => {
			if (msg.chat) {
				toaster.success({
					title: "Chat branched successfully"
				})
				// Navigate to the new branched chat
				goto(`/chats/${msg.chat.id}`)
			} else if (msg.error) {
				toaster.error({ title: msg.error })
			}
		})

		// Cleanup function
		return () => {
			// Clear any pending timeouts
			if (promptTokenCountTimeout) {
				clearTimeout(promptTokenCountTimeout)
			}
			if (autoTriggerTimeout) {
				clearTimeout(autoTriggerTimeout)
			}
		}
	})

	let showAvatarModal = $state(false)
	let avatarModalSrc: string | undefined = $state(undefined)

	function handleAvatarClick(
		char: SelectCharacter | SelectPersona | undefined
	) {
		if (!char) return
		if (char.avatar) {
			avatarModalSrc = char.avatar
			showAvatarModal = true
		}
	}
</script>

<svelte:head>
	<title>Serene Pub - {chat?.name}</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

<div class="relative flex h-full flex-col">
	<ChatContainer
		{chat}
		{pagination}
		{loadingOlderMessages}
		bind:chatMessagesContainer
		onScroll={handleScroll}
		{getMessageCharacter}
		{canControlMessage}
		{showSwipeControls}
		{canSwipeRight}
		{canRegenerateLastMessage}
		onSwipeLeft={swipeLeft}
		onSwipeRight={swipeRight}
		onEditMessage={handleEditMessage}
		onDeleteMessage={handleDeleteMessage}
		onHideMessage={handleHideMessage}
		onRegenerateMessage={handleRegenerateMessage}
		onContinueMessage={handleContinueMessage}
		onAbortMessage={handleAbortMessage}
		onBranchMessage={handleBranchMessage}
		{editChatMessage}
		{hasGeneratingMessage}
		{isGuest}
	>
		{#snippet MessageComponent(props)}
			<ChatMessage
				{...props}
				onCharacterNameClick={handleCharacterNameClick}
				onAvatarClick={handleAvatarClick}
				onCancelEditMessage={handleCancelEditMessage}
				onSaveEditMessage={handleSaveEditMessage}
				bind:openMobileMsgControls
				{lastPersonaMessage}
			>
				{#snippet GeneratingAnimationComponent()}
					{@const character = props.getMessageCharacter(props.msg)}
					<GeneratingAnimation
						text={`${character?.nickname || character?.name || "User"} is typing`}
					/>
				{/snippet}
			</ChatMessage>
		{/snippet}
		{#snippet ComposerComponent()}
			<ChatComposer
				bind:newMessage
				onSend={handleSend}
				{draftCompiledPrompt}
				{currentUserPersona}
				{chat}
				{lastMessage}
				{editChatMessage}
				{isGuest}
				{showAddPersonaCTA}
				onAddPersonaClick={() => {
					showAddPersonaModal = true
				}}
				onAbortLastMessage={handleAbortLastMessage}
				extraTabs={isGuest
					? []
					: [
							{
								value: "extraControls",
								title: "Extra Controls",
								control: extraControlsButton,
								content: extraControlsContent
							},
							{
								value: "statistics",
								title: "Statistics",
								control: statisticsButton,
								content: statisticsContent
							}
						]}
			/>
		{/snippet}
		{#snippet NextCharacterComponent()}
			{#if shouldShowNextCharacterBlock}
				<NextCharacterBlock
					{nextCharacter}
					shouldShow={shouldShowNextCharacterBlock}
					onContinueWithNextCharacter={handleContinueWithNextCharacter}
					onChooseDifferentCharacter={handleChooseDifferentCharacter}
				/>
			{/if}
		{/snippet}
	</ChatContainer>
</div>

<Modal
	open={showDeleteMessageModal}
	onOpenChange={onOpenMessageDeleteChange}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-sm border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex justify-between">
			<h2 class="h2">Confirm</h2>
		</header>
		<article>
			<p class="opacity-60">
				Are you sure you want to delete this message?
			</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button
				class="btn preset-filled-surface-500"
				onclick={onDeleteMessageCancel}
			>
				Cancel
			</button>
			<button
				class="btn preset-filled-error-500"
				onclick={onDeleteMessageConfirm}
			>
				Delete
			</button>
		</footer>
	{/snippet}
</Modal>

<Modal
	open={showDraftCompiledPromptModal}
	onOpenChange={(details) => (showDraftCompiledPromptModal = details.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-full w-[60em] border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex items-center justify-between">
			<h2 class="h2">Prompt Details</h2>
			<button
				class="btn btn-sm"
				onclick={() => (showDraftCompiledPromptModal = false)}
			>
				<Icons.X size={20} />
			</button>
		</header>
		<article class="space-y-2">
			{#if draftCompiledPrompt}
				<div class="mb-2">
					<b>Prompt Tokens:</b>
					<span class:text-error-500={contextExceeded}>
						{draftCompiledPrompt.meta.tokenCounts.total} / {draftCompiledPrompt
							.meta.tokenCounts.limit}
					</span>
				</div>
				<div class="mb-2">
					<b>Messages Inserted:</b>
					{draftCompiledPrompt.meta.chatMessages.included} / {draftCompiledPrompt
						.meta.chatMessages.total}
				</div>
				<div class="mb-2">
					<b>Prompt Format:</b>
					{draftCompiledPrompt.meta.promptFormat}
				</div>
				<!-- <div class="mb-2">
					<b>Truncation Reason:</b>
					{draftCompiledPrompt.meta.sources.lorebooks?.truncationReason || "None"}
				</div> -->
				<!-- <div class="mb-2">
					<b>Timestamp:</b>
					{draftCompiledPrompt.meta.timestamp}
				</div> -->
				<!-- <div class="mb-2">
					<b>World Lore:</b>
					{draftCompiledPrompt.meta.lorebooks?.worldLore
						.included || 0}
					/
					{draftCompiledPrompt.meta.sources.lorebooks?.worldLore
						.total || 0}
				</div> -->
				<!-- <div class="mb-2">
					<b>Character Lore:</b>
					{draftCompiledPrompt.meta.sources.lorebooks?.characterLore
						.included || 0}/{draftCompiledPrompt.meta.sources.lorebooks?.characterLore.total || 0}
				</div> -->
				<!-- <div class="mb-2">
					<b>History:</b>
					{draftCompiledPrompt.meta.sources.lorebooks?.history
						.included || 0}/{draftCompiledPrompt.meta.sources.lorebooks?.history.total || 0}
				</div> -->
				<div class="mb-2">
					<b>Characters Used:</b>
					<ul class="ml-4 list-disc">
						{#each draftCompiledPrompt.meta.sources.characters as char}
							<li>
								{char.name}
								{char.nickname ? `(${char.nickname})` : ""}
							</li>
						{/each}
					</ul>
				</div>
				<div class="mb-2">
					<b>Personas Used:</b>
					<ul class="ml-4 list-disc">
						{#each draftCompiledPrompt.meta.sources.personas as persona}
							<li>{persona.name}</li>
						{/each}
					</ul>
				</div>
				<div class="mb-2">
					<b>Scenario Source:</b>
					{draftCompiledPrompt.meta.sources.scenario || "None"}
				</div>
				<div class="mb-2">
					<b>Prompt Preview:</b>
					<pre
						class="bg-surface-200-800 max-h-64 overflow-x-auto rounded p-2 text-xs whitespace-pre-wrap">{draftCompiledPrompt.prompt ||
							JSON.stringify(draftCompiledPrompt.messages)}</pre>
				</div>
			{:else}
				<div class="text-muted">No compiled prompt data available.</div>
			{/if}
		</article>
		<footer class="flex justify-end gap-4">
			<button
				class="btn preset-filled-surface-500"
				onclick={() => (showDraftCompiledPromptModal = false)}
			>
				Close
			</button>
		</footer>
	{/snippet}
</Modal>

<Modal
	open={showTriggerCharacterMessageModal}
	onOpenChange={(e) => (showTriggerCharacterMessageModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-h-[95dvh] relative overflow-hidden w-[50em] max-w-95dvw"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="mb-2 flex items-center justify-between">
			<h2 class="h2">Trigger Character</h2>
			<button
				class="btn btn-sm"
				onclick={() => (showTriggerCharacterMessageModal = false)}
			>
				<Icons.X size={20} />
			</button>
		</header>
		<input
			class="input mb-4 w-full"
			type="text"
			placeholder="Search characters..."
			bind:value={triggerCharacterSearch}
		/>
		<div class="max-h-[60dvh] min-h-0 overflow-y-auto">
			<div class="relative flex flex-col pr-2 lg:flex-row lg:flex-wrap">
				{#each (chat?.chatCharacters || []).filter((cc) => {
					const c = cc.character
					if (!c) return false
					const s = triggerCharacterSearch.trim().toLowerCase()
					if (!s) return true
					return c.name?.toLowerCase().includes(s) || c.nickname
							?.toLowerCase()
							.includes(s) || c.description
							?.toLowerCase()
							.includes(s) || c.creatorNotes
							?.toLowerCase()
							.includes(s)
				}) as any[] as typeof chat.chatCharacters as filtered}
					<div class="flex p-1 lg:basis-1/2">
						<button
							class="group preset-outlined-surface-400-600 hover:preset-filled-surface-500 relative flex w-full gap-3 overflow-hidden rounded p-2"
							onclick={() =>
								onSelectTriggerCharacterMessage(
									filtered.character.id
								)}
						>
							<div class="w-fit">
								<Avatar char={filtered.character} />
							</div>
							<div
								class="relative flex w-0 min-w-0 flex-1 flex-col"
							>
								<div
									class="w-full truncate text-left font-semibold"
								>
									{filtered.character.nickname ||
										filtered.character.name}
								</div>
								<div
									class="text-surface-500 group-hover:text-surface-800-200 line-clamp-2 w-full text-left text-xs"
								>
									{filtered.character.creatorNotes ||
										filtered.character.description ||
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

<Modal
	open={showAvatarModal}
	onOpenChange={(e) => (showAvatarModal = e.open)}
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-dvw-md flex flex-col items-center border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex w-full justify-between">
			<h2 class="h2">Avatar</h2>
			<button
				class="btn btn-sm"
				onclick={() => (showAvatarModal = false)}
			>
				<Icons.X size={20} />
			</button>
		</header>
		<article class="flex w-full flex-col items-center">
			{#if avatarModalSrc}
				<img
					src={avatarModalSrc}
					alt="Avatar"
					class="border-surface-300 max-h-[60vh] max-w-full rounded-lg border"
				/>
			{:else}
				<div class="text-muted">No avatar image available.</div>
			{/if}
		</article>
	{/snippet}
</Modal>

<PersonaSelectModal
	open={showAddPersonaModal}
	onclose={() => (showAddPersonaModal = false)}
	onSelect={handleAddPersona}
	personas={availablePersonas}
	title="Add Persona to Chat"
	description="Select a persona to add to this chat. You'll be able to send messages as this persona."
/>

<BranchChatModal
	open={showBranchChatModal}
	onOpenChange={(e) => (showBranchChatModal = e.open)}
	onConfirm={onBranchChatConfirm}
	onCancel={onBranchChatCancel}
	initialTitle={chat?.name}
/>

{#snippet generatingAnimation()}
	<div class="wrapper">
		<div class="circle"></div>
		<div class="circle"></div>
		<div class="circle"></div>
		<div class="shadow"></div>
		<div class="shadow"></div>
		<div class="shadow"></div>
	</div>
{/snippet}

{#snippet extraControlsButton()}
	<Icons.MessageSquare size="0.75em" />
{/snippet}

{#snippet extraControlsContent()}
	<div class="flex gap-2">
		<button
			class="btn preset-filled-primary-500"
			title="Continue Conversation"
			onclick={handleTriggerContinueConversation}
			disabled={!chat ||
				!chat.chatPersonas?.[0]?.personaId ||
				lastMessage?.isGenerating}
		>
			<Icons.MessageSquareMore size={24} />
		</button>
		<button
			class="btn preset-filled-secondary-500"
			title="Trigger Character"
			onclick={handleTriggerCharacterMessage}
			disabled={!chat ||
				!chat.chatPersonas?.[0]?.personaId ||
				lastMessage?.isGenerating}
		>
			<Icons.MessageSquarePlus size={24} />
		</button>
		<button
			class="btn preset-filled-warning-500"
			title="Regenerate Last Message"
			onclick={handleRegenerateLastMessage}
			disabled={!canRegenerateLastMessage}
		>
			<Icons.RefreshCw size={24} />
		</button>
	</div>
{/snippet}

{#snippet statisticsButton()}
	<Icons.BarChart2 size="0.75em" />
{/snippet}

{#snippet statisticsContent()}
	<div class="flex gap-2">
		<button
			class="btn preset-filled-primary-500"
			title="View Prompt Statistics"
			onclick={() => (showDraftCompiledPromptModal = true)}
			disabled={!draftCompiledPrompt}
		>
			<Icons.Info size={24} />
		</button>
		<div class="flex flex-col text-sm">
			{#if draftCompiledPrompt}
				<div>
					<b>Prompt Tokens:</b>
					<span class:text-error-500={contextExceeded}>
						{draftCompiledPrompt.meta.tokenCounts.total} / {draftCompiledPrompt
							.meta.tokenCounts.limit}
					</span>
				</div>
				<div>
					<b>Messages Inserted:</b>
					{draftCompiledPrompt.meta.chatMessages.included} / {draftCompiledPrompt
						.meta.chatMessages.total}
					<span class="text-surface-500">
						(Includes current draft)
					</span>
				</div>
			{:else}
				<div class="text-muted">No prompt statistics available.</div>
			{/if}
		</div>
	</div>
{/snippet}

<style lang="postcss">
	@reference "tailwindcss";

	/* --- Markdown custom styles --- */
	:global(.markdown-body) {
		white-space: pre-line;
	}
	:global(.markdown-body blockquote) {
		color: #7dd3fc; /* sky-300 */
		border-left: 4px solid #38bdf8; /* sky-400 */
		background: rgba(56, 189, 248, 0.08);
		padding-left: 1em;
		margin-left: 0;
	}
	:global(.markdown-body em),
	:global(.markdown-body i) {
		color: #f472b6; /* pink-400 */
		font-style: italic;
		background: rgba(244, 114, 182, 0.08);
		border-radius: 0.2em;
		padding: 0 0.15em;
	}
	/* Preserve blank lines between paragraphs */
	:global(.markdown-body p) {
		margin-top: 1em;
		margin-bottom: 1em;
		min-height: 1.5em;
	}
</style>
