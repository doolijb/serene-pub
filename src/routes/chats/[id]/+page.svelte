<script lang="ts">
	import { page } from "$app/state"
	import { goto } from "$app/navigation"
	import { Modal, Popover } from "@skeletonlabs/skeleton-svelte"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import MessageControls from "$lib/client/components/chatMessages/MessageControls.svelte"
	import ChatContainer from "$lib/client/components/chatMessages/ChatContainer.svelte"
	import ChatMessage from "$lib/client/components/chatMessages/ChatMessage.svelte"
	import NextCharacterBlock from "$lib/client/components/chatMessages/NextCharacterBlock.svelte"
	import ChatComposer from "$lib/client/components/chatMessages/ChatComposer.svelte"
	import GeneratingAnimation from "$lib/client/components/chatMessages/GeneratingAnimation.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onDestroy, onMount } from "svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import PersonaSelectModal from "$lib/client/components/modals/PersonaSelectModal.svelte"
	import BranchChatModal from "$lib/client/components/modals/BranchChatModal.svelte"
	import SummarizeLoreModal from "$lib/client/components/modals/SummarizeLoreModal.svelte"
	import AvatarGalleryModal from "$lib/client/components/chatMessages/AvatarGalleryModal.svelte"
	import ChatSceneImagesTab from "$lib/client/components/chatMessages/ChatSceneImagesTab.svelte"
	import ChatWorkflowTab from "$lib/client/components/chatMessages/ChatWorkflowTab.svelte"
	import { sceneImages } from "$lib/client/stores/sceneImages"
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
	let systemSettingsCtx: SystemSettingsCtx = getContext("systemSettingsCtx")

	let summarizationEnabled = $derived(!!systemSettingsCtx.settings?.summarizationEnabled)
	let vectorizationEnabled = $derived(!!systemSettingsCtx.settings?.vectorizationEnabled)

	// ── Draft autosave ────────────────────────────────────────────────────────
	// Debounce-save newMessage to the server as the user types.
	// Only runs when the chat is loaded (chat !== undefined) to avoid
	// clobbering another user's draft during a chat transition.
	$effect(() => {
		const content = newMessage
		const currentChatId = chatId
		if (!currentChatId || !chat) return
		const timer = setTimeout(() => {
			socket.emit("chats:saveDraft", { chatId: currentChatId, content })
		}, 500)
		return () => clearTimeout(timer)
	})

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

	// Summarization mode
	let isSummarizationMode = $state(false)
	let selectedMessageIds = $state(new Set<number>())
	let showSummarizeModal = $state(false)
	let summarizeLoreType = $state<"world" | "character" | "scene">("world")
	/** Message IDs already captured in a scene — hard-blocked from selection */
	let scenedMessageIds = $state(new Set<number>())
	/** Full scene list for this chat — used for in-chat scene/history-entry indicators */
	let sceneList = $state<Sockets.Scenes.List.SceneWithEntry[]>([])
	let chatResponseOrder: Sockets.Chats.GetResponseOrder.Response | undefined =
		$state()
	let availablePersonas: Sockets.Personas.List.Response["personaList"] =
		$state([])

	// Get chat id from route params
	let chatId: number = $derived.by(() => Number(page.params.id))
	let chatNotFound = $state(false)

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

	// All of the current user's personas in this chat
	let userPersonasInChat = $derived.by(() => {
		if (!chat?.chatPersonas || !userCtx.user?.id) return []
		return chat.chatPersonas.filter(
			(cp) => cp.persona?.userId === userCtx.user?.id
		)
	})

	// Manually selected persona ID — null means auto-select (first in list)
	let selectedPersonaId = $state<number | null>(null)

	// Reset selection when navigating to a different chat
	$effect(() => {
		const _watchChatId = chat?.id
		selectedPersonaId = null
	})

	// Get the current user's active persona in this chat
	let currentUserPersona = $derived.by(() => {
		if (!userPersonasInChat.length) return undefined
		if (selectedPersonaId) {
			const found = userPersonasInChat.find(
				(cp) => cp.personaId === selectedPersonaId
			)
			if (found) return found
		}
		return userPersonasInChat[0]
	})

	function switchPersona(personaId: number) {
		selectedPersonaId = personaId
	}

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
		socket.emit("chats:saveDraft", { chatId, content: "" })

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
			chatNotFound = false
			pagination = undefined
			chatResponseOrder = undefined
			draftCompiledPrompt = undefined
			editChatMessage = undefined
			newMessage = ""
			isInitialLoad = true
			lastSeenMessageId = null
			lastSeenMessageContent = ""
			loadingOlderMessages = false
			socket.emit("chats:get", { id: chatId, limit: 25 })
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
		if (!systemSettingsCtx.settings?.contextDebuggingEnabled) return
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
	// ── Summarization mode ────────────────────────────────────────
	function enterSummarizationMode(msg: SelectChatMessage) {
		openMobileMsgControls = undefined
		isSummarizationMode = true
		selectedMessageIds = new Set([msg.id])
	}

	function exitSummarizationMode() {
		isSummarizationMode = false
		selectedMessageIds = new Set()
	}

	function enterSummarizationModeEmpty() {
		openMobileMsgControls = undefined
		isSummarizationMode = true
		selectedMessageIds = new Set()
	}

	function toggleSummarizationMessage(id: number) {
		if (scenedMessageIds.has(id)) return // hard block
		const next = new Set(selectedMessageIds)
		next.has(id) ? next.delete(id) : next.add(id)
		selectedMessageIds = next
	}

	function selectAllAbove(msgIndex: number) {
		const msgs = chat!.chatMessages
		const next = new Set(selectedMessageIds)
		for (let i = msgIndex; i >= 0; i--) {
			if (scenedMessageIds.has(msgs[i].id)) break // stop at scened message
			if (next.has(msgs[i].id) && i < msgIndex) break
			next.add(msgs[i].id)
		}
		selectedMessageIds = next
	}

	function selectAllBelow(msgIndex: number) {
		const msgs = chat!.chatMessages
		const next = new Set(selectedMessageIds)
		for (let i = msgIndex; i < msgs.length; i++) {
			if (scenedMessageIds.has(msgs[i].id)) break // stop at scened message
			if (next.has(msgs[i].id) && i > msgIndex) break
			next.add(msgs[i].id)
		}
		selectedMessageIds = next
	}

	/** True when selected messages (for a scene) have a visible gap between them */
	let hasSceneGap = $derived.by(() => {
		if (!chat?.chatMessages.length || selectedMessageIds.size === 0) return false
		const msgs = chat.chatMessages
		const selectedIndices = msgs
			.map((m, i) => (selectedMessageIds.has(m.id) ? i : -1))
			.filter((i) => i !== -1)
		if (selectedIndices.length < 2) return false
		const minIdx = selectedIndices[0]
		const maxIdx = selectedIndices[selectedIndices.length - 1]
		for (let i = minIdx + 1; i < maxIdx; i++) {
			const m = msgs[i]
			if (!selectedMessageIds.has(m.id) && !m.isHidden) return true
		}
		return false
	})

	function openSummarizeModal(loreType: "world" | "history" | "character" | "scene") {
		if (loreType === "scene" && hasSceneGap) {
			toaster.error({
				title: "Non-consecutive messages selected",
				description:
					"Scenes require a consecutive sequence of messages with no visible gaps. Deselect the skipped messages or hide them first."
			})
			return
		}
		summarizeLoreType = loreType
		showSummarizeModal = true
	}

	function handleOpenEntry(lorebookId: number, historyEntryId: number) {
		panelsCtx.digest.lorebookId = lorebookId
		panelsCtx.digest.historyEntryId = historyEntryId
		panelsCtx.digest.historyEntryTab = "content"
		panelsCtx.openPanel({ key: "lorebooks", toggle: false })
	}

	function handleLorebookSet(newLorebookId: number) {
		if (chat) {
			chat = { ...chat, lorebookId: newLorebookId } as typeof chat
		}
	}
	// ─────────────────────────────────────────────────────────────

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
		if (loadingOlderMessages || !pagination?.hasMore || !chat || chat.chatMessages.length === 0) return

		loadingOlderMessages = true

		// Save scroll anchor before the DOM changes so we can restore position after prepend
		if (chatMessagesContainer) {
			chatMessagesContainer.dataset.previousScrollHeight = chatMessagesContainer.scrollHeight.toString()
			chatMessagesContainer.dataset.previousScrollTop = chatMessagesContainer.scrollTop.toString()
		}

		const beforeId = Math.min(...chat.chatMessages.map((m) => m.id))
		socket.emit("chats:get", { id: chatId, limit: 25, beforeId })

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
			if (msg.chat === null && !loadingOlderMessages) {
				chatNotFound = true
				return
			}
			if (msg.chat?.id === Number.parseInt(page.params.id)) {
				if (chat && loadingOlderMessages && msg.beforeId != null) {
					// Load-more: prepend older messages (server already deduped via cursor)
					const existingIds = new Set(chat.chatMessages.map((m) => m.id))
					const olderMessages = msg.chat.chatMessages.filter((m) => !existingIds.has(m.id))
					const allMessages = [...olderMessages, ...chat.chatMessages]
					chat.chatMessages = allMessages.sort((a, b) => a.id - b.id)

					// Restore scroll position: account for the height added above the old content
					setTimeout(() => {
						if (chatMessagesContainer) {
							const prevScrollHeight = parseInt(chatMessagesContainer.dataset.previousScrollHeight || "0")
							const prevScrollTop = parseInt(chatMessagesContainer.dataset.previousScrollTop || "0")
							const addedHeight = chatMessagesContainer.scrollHeight - prevScrollHeight
							chatMessagesContainer.scrollTop = addedHeight + prevScrollTop
							delete chatMessagesContainer.dataset.previousScrollHeight
							delete chatMessagesContainer.dataset.previousScrollTop
						}
						loadingOlderMessages = false
					}, 10)
				} else {
					// Initial load or chat switch — restore draft only on first load
					const isFirstLoad = !chat
					chat = {
						...msg.chat,
						chatMessages: msg.chat.chatMessages.sort((a, b) => a.id - b.id)
					}
					if (isFirstLoad && msg.userDraft) {
						newMessage = msg.userDraft
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

		socket?.on("scenes:scenedMessageIds", (msg: Sockets.Scenes.SenedMessageIds.Response) => {
			scenedMessageIds = new Set(msg.scenedMessageIds)
		})
		socket?.on("scenes:scenedMessageIds:error", () => {
			chatNotFound = true
		})

		socket?.on("scenes:list", (msg: Sockets.Scenes.List.Response) => {
			if (!msg.sceneList.length || msg.sceneList[0].chatId === chatId) {
				sceneList = msg.sceneList
			}
		})
		socket?.on("scenes:list:error", () => {
			chatNotFound = true
		})

		socket?.emit("scenes:scenedMessageIds", { chatId })
		socket?.emit("scenes:list", { chatId } satisfies Sockets.Scenes.List.Params)

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
	let avatarModalEntity = $state<{
		type: "character" | "persona"
		id: number
		name: string
		avatar: string | null | undefined
	} | null>(null)

	// Scene image overlays — synced into the shared store so Layout can render them
	let leftSceneImage = $state<string | null>(null)
	let rightSceneImage = $state<string | null>(null)
	let sceneImagesInitialized = $state(false)

	// Load persisted images from localStorage when navigating to a chat
	$effect(() => {
		const id = chatId
		sceneImagesInitialized = false
		leftSceneImage = null
		rightSceneImage = null
		if (id) {
			try {
				const saved = localStorage.getItem(`sceneImages:${id}`)
				if (saved) {
					const { left, right } = JSON.parse(saved)
					leftSceneImage = left ?? null
					rightSceneImage = right ?? null
				}
			} catch {}
		}
		sceneImagesInitialized = true
	})

	// Persist images to localStorage when they change (but not during initial load)
	$effect(() => {
		if (!sceneImagesInitialized) return
		const id = chatId
		if (!id) return
		const left = leftSceneImage
		const right = rightSceneImage
		if (left || right) {
			localStorage.setItem(`sceneImages:${id}`, JSON.stringify({ left, right }))
		} else {
			localStorage.removeItem(`sceneImages:${id}`)
		}
	})

	// Sync into the shared store so Layout can render them
	$effect(() => {
		sceneImages.set({ left: leftSceneImage, right: rightSceneImage })
	})
	onDestroy(() => {
		sceneImages.set({ left: null, right: null })
	})

	function handleAvatarClick(
		char: SelectCharacter | SelectPersona | undefined
	) {
		if (!char) return
		const isPersona = chat?.chatPersonas?.some((cp) => cp.persona?.id === char.id)
		const nickname = (char as any).nickname as string | null ?? null
		avatarModalEntity = {
			type: isPersona ? "persona" : "character",
			id: char.id,
			name: nickname ?? char.name ?? "",
			avatar: char.avatar ?? null
		}
		showAvatarModal = true
	}
</script>

<svelte:head>
	<title>Serene Pub - {chatNotFound ? "Not Found" : (chat?.name ?? "Loading...")}</title>
	<meta name="description" content="Serene Pub" />
</svelte:head>

{#if chatNotFound}
	<div class="flex h-full flex-col items-center justify-center gap-4 opacity-60">
		<Icons.MessageSquareOff size={48} />
		<p class="text-lg font-semibold">Chat not found</p>
		<p class="text-sm">This chat may have been deleted or you don't have access to it.</p>
	</div>
{:else}
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
		{sceneList}
		onHistoryEntryClick={({ historyEntryId, lorebookId }) => {
			panelsCtx.digest.lorebookId = lorebookId
			panelsCtx.digest.historyEntryId = historyEntryId
			panelsCtx.digest.historyEntryTab = "content"
			panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		}}
		onSceneClick={({ sceneId, historyEntryId, lorebookId }) => {
			panelsCtx.digest.lorebookId = lorebookId
			panelsCtx.digest.historyEntryId = historyEntryId
			panelsCtx.digest.historyEntryTab = "scenes"
			panelsCtx.digest.sceneId = sceneId
			panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		}}
		onNewHistoryEntry={({ lorebookId }) => {
			panelsCtx.digest.lorebookId = lorebookId
			panelsCtx.digest.historyEntryTab = "content"
			panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		}}
		onAttachLorebook={() => {
			panelsCtx.openPanel({ key: "lorebooks", toggle: false })
		}}
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
				isSummarizationMode={isSummarizationMode}
				isSelected={selectedMessageIds.has(props.msg.id)}
				onStartSummarization={summarizationEnabled && !isSummarizationMode ? enterSummarizationMode : undefined}
			>
				{#snippet GeneratingAnimationComponent()}
					{@const character = props.getMessageCharacter(props.msg)}
					<GeneratingAnimation
						text={`${character?.nickname || character?.name || "User"} is typing`}
					/>
				{/snippet}
				{#snippet messageControls(msg)}
					{#if isSummarizationMode}
						{@const isScened = scenedMessageIds.has(msg.id)}
						<div class="flex gap-2" role="group" aria-label="Selection controls">
							{#if isScened}
								<span
									class="btn btn-sm preset-filled-surface-400-600 opacity-60 cursor-not-allowed"
									title="Already captured in a scene"
								>
									<Icons.Film size={16} />
									<span class="lg:hidden">In Scene</span>
								</span>
							{:else}
								<button
									class="btn btn-sm {selectedMessageIds.has(msg.id)
										? 'preset-filled-secondary-500'
										: 'preset-filled-surface-400-600'}"
									title={selectedMessageIds.has(msg.id) ? 'Deselect message' : 'Select message'}
									onclick={() => toggleSummarizationMessage(msg.id)}
								>
									{#if selectedMessageIds.has(msg.id)}
										<Icons.CheckSquare size={16} />
									{:else}
										<Icons.Square size={16} />
									{/if}
									<span class="lg:hidden">
										{selectedMessageIds.has(msg.id) ? 'Deselect' : 'Select'}
									</span>
								</button>
								<button
									class="btn btn-sm preset-filled-surface-400-600"
									title="Select all above up to nearest selected"
									onclick={() => selectAllAbove(props.index)}
								>
									<Icons.ChevronsUp size={16} />
									<span class="lg:hidden">Select All Above</span>
								</button>
								<button
									class="btn btn-sm preset-filled-surface-400-600"
									title="Select all below up to nearest selected"
									onclick={() => selectAllBelow(props.index)}
								>
									<Icons.ChevronsDown size={16} />
									<span class="lg:hidden">Select All Below</span>
								</button>
							{/if}
						</div>
					{:else}
						<MessageControls
							{msg}
							isLastMessage={props.isLastMessage}
							canRegenerateLastMessage={props.canRegenerateLastMessage}
							editChatMessage={props.editChatMessage}
							hasGeneratingMessage={props.hasGeneratingMessage}
							onEditMessage={props.onEditMessage}
							onHideMessage={props.onHideMessage}
							onDeleteMessage={props.onDeleteMessage}
							onRegenerateMessage={props.onRegenerateMessage}
							onContinueMessage={props.onContinueMessage}
							onAbortMessage={props.onAbortMessage}
							onBranchMessage={props.onBranchMessage}
							onStartSummarization={summarizationEnabled ? enterSummarizationMode : undefined}
							debugMeta={systemSettingsCtx.settings?.contextDebuggingEnabled ? ((msg as any).debugMeta ?? null) : null}
							onShowDebugMeta={systemSettingsCtx.settings?.contextDebuggingEnabled
								? (meta: any) => {
									draftCompiledPrompt = { prompt: undefined, messages: undefined, meta }
									showDraftCompiledPromptModal = true
								  }
								: undefined}
						/>
					{/if}
				{/snippet}
			</ChatMessage>
		{/snippet}
		{#snippet ComposerComponent()}
			{#if isSummarizationMode && summarizationEnabled}
				<div class="preset-tonal-secondary flex flex-wrap items-center gap-2 p-3 lg:rounded-t-lg">
					<span class="text-sm font-semibold">
						{selectedMessageIds.size}
						{selectedMessageIds.size === 1 ? 'message' : 'messages'} selected
					</span>
					<div class="flex gap-2">
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => {
								selectedMessageIds = new Set(
									chat!.chatMessages
										.filter((m) => !scenedMessageIds.has(m.id))
										.map((m) => m.id)
								)
							}}
						>
							<Icons.CheckSquare size={16} />
							Select All
						</button>
						<button
							class="btn btn-sm preset-filled-surface-400-600"
							onclick={() => (selectedMessageIds = new Set())}
						>
							<Icons.Square size={16} />
							Select None
						</button>
					</div>
					<div class="ml-auto flex flex-wrap gap-2">
						<button
							class="btn btn-sm preset-filled-surface-500"
							onclick={exitSummarizationMode}
						>
							<Icons.X size={16} />
							Cancel
						</button>
						<button
							class="btn btn-sm preset-filled-secondary-500"
							disabled={selectedMessageIds.size === 0}
							onclick={() => openSummarizeModal('scene')}
						>
							<Icons.Film size={16} />
							Scene
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500"
							disabled={selectedMessageIds.size === 0}
							onclick={() => openSummarizeModal('world')}
						>
							<Icons.Globe size={16} />
							World Lore
						</button>
						<button
							class="btn btn-sm preset-filled-tertiary-500"
							disabled={selectedMessageIds.size === 0}
							onclick={() => openSummarizeModal('character')}
						>
							<Icons.User size={16} />
							Character Lore
						</button>
					</div>
				</div>
			{:else}
				<ChatComposer
					bind:newMessage
					onSend={handleSend}
					{draftCompiledPrompt}
					{currentUserPersona}
					{userPersonasInChat}
					onSwitchPersona={switchPersona}
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
						: [		{
									value: "extraControls",
									title: "Extra Controls",
									control: extraControlsButton,
									content: extraControlsContent
								},
								...(chat?.lorebookId
									? [{ value: "workflow", title: "Lore", control: workflowButton, content: workflowContent }]
									: []),
								{
									value: "sceneImages",
									title: "Pinned Images",
									control: sceneImagesButton,
									content: sceneImagesContent
								},
								...(systemSettingsCtx.settings?.contextDebuggingEnabled
									? [{ value: "statistics", title: "Statistics", control: statisticsButton, content: statisticsContent }]
									: [])
							]}
				/>
			{/if}
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

<SummarizeLoreModal
	bind:open={showSummarizeModal}
	onOpenChange={(e) => (showSummarizeModal = e.open)}
	{chatId}
	lorebookId={chat?.lorebookId ?? null}
	selectedMessageIds={[...selectedMessageIds]}
	initialLoreType={summarizeLoreType}
	onSaved={() => {
		socket?.emit("scenes:scenedMessageIds", { chatId })
		socket?.emit("scenes:list", { chatId } satisfies Sockets.Scenes.List.Params)
		exitSummarizationMode()
	}}
	onLorebookSet={handleLorebookSet}
	chatCharacters={(chat?.chatCharacters ?? []).map(cc => ({ type: "character" as const, id: cc.character.id, name: (cc.character as any).nickname || cc.character.name }))}
	chatPersonas={(chat?.chatPersonas ?? []).map(cp => ({ type: "persona" as const, id: cp.persona.id, name: cp.persona.name }))}
	hasSceneMessageGap={hasSceneGap}
/>

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
	contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-full w-[70em] max-h-[90dvh] flex flex-col border border-surface-300-700"
	backdropClasses="backdrop-blur-sm"
>
	{#snippet content()}
		<header class="flex shrink-0 items-center justify-between">
			<h2 class="h2">Prompt Details</h2>
			<button
				class="btn btn-sm"
				onclick={() => (showDraftCompiledPromptModal = false)}
			>
				<Icons.X size={20} />
			</button>
		</header>

		{#if draftCompiledPrompt}
			{@const rag = draftCompiledPrompt.meta.rag}
			{@const tokens = draftCompiledPrompt.meta.tokenCounts}
			{@const msgs = draftCompiledPrompt.meta.chatMessages}
			{@const src = draftCompiledPrompt.meta.sources}
			{@const tokenPct = Math.min(100, Math.round((tokens.total / tokens.limit) * 100))}
			{@const truncReason = draftCompiledPrompt.meta.truncationReason}
			{@const ragScores = rag?.scores}
			{@const msgScoreMin = ragScores?.messageScores?.length ? Math.min(...ragScores.messageScores) : null}
			{@const msgScoreMax = ragScores?.messageScores?.length ? Math.max(...ragScores.messageScores) : null}
			{@const msgScoreAvg = ragScores?.messageScores?.length ? ragScores.messageScores.reduce((a, b) => a + b, 0) / ragScores.messageScores.length : null}
			{@const loreScoreMin = ragScores?.loreScores?.length ? Math.min(...ragScores.loreScores) : null}
			{@const loreScoreMax = ragScores?.loreScores?.length ? Math.max(...ragScores.loreScores) : null}
			{@const loreScoreAvg = ragScores?.loreScores?.length ? ragScores.loreScores.reduce((a, b) => a + b, 0) / ragScores.loreScores.length : null}

			<div class="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
				<!-- ── Token Budget ──────────────────────────────────────────────── -->
				<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Token Budget</h3>
					<div class="flex items-center justify-between text-sm">
						<span class:text-error-500={contextExceeded} class:text-success-500={!contextExceeded}>
							{tokens.total.toLocaleString()} / {tokens.limit.toLocaleString()} tokens
						</span>
						<span class="text-surface-500 text-xs">{tokenPct}%</span>
					</div>
					<div class="bg-surface-300-700 h-2 w-full overflow-hidden rounded-full">
						<div
							class="h-full rounded-full transition-all {contextExceeded ? 'bg-error-500' : tokenPct > 85 ? 'bg-warning-500' : 'bg-success-500'}"
							style="width: {tokenPct}%"
						></div>
					</div>
					<div class="flex flex-wrap gap-4 text-xs text-surface-500">
						<span>Format: <span class="text-surface-300-700">{draftCompiledPrompt.meta.promptFormat || "—"}</span></span>
						{#if draftCompiledPrompt.meta.templateName}
							<span>Template: <span class="text-surface-300-700">{draftCompiledPrompt.meta.templateName}</span></span>
						{/if}
						{#if rag?.used === true}
							<span class="text-primary-400 font-medium">RAG Context Infill Engine</span>
						{:else if rag?.used === false}
							<span class="text-surface-400">Keyword Context Infill Engine</span>
						{:else}
							<span class="text-surface-400">Context Infill Engine</span>
						{/if}
					</div>
					{#if truncReason}
						<div class="flex items-center gap-1.5 rounded bg-warning-500/10 border border-warning-500/30 px-2 py-1.5 text-xs text-warning-400">
							<Icons.TriangleAlert size={12} class="shrink-0" />
							<span>Truncated: <span class="font-medium">{truncReason.replace(/_/g, " ")}</span></span>
						</div>
					{/if}
				</section>

				<!-- ── Messages ─────────────────────────────────────────────────── -->
				<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Messages</h3>
					<div class="flex items-baseline gap-2 text-sm">
						<span><span class="font-medium">{msgs.included}</span><span class="text-surface-500"> / {msgs.total} included</span></span>
						{#if msgs.total > msgs.included}
							<span class="text-warning-400 text-xs">{msgs.total - msgs.included} excluded</span>
						{/if}
					</div>
					{#if rag?.used === true}
						<div class="grid grid-cols-3 gap-2 text-xs">
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold">{rag.messages.guaranteed}</div>
								<div class="text-surface-500">Guaranteed</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold text-primary-400">{rag.messages.ragOlder}</div>
								<div class="text-surface-500">RAG recalled</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold">{rag.messages.filledIn}</div>
								<div class="text-surface-500">Fill-in</div>
							</div>
						</div>
					{:else if rag?.used === false}
						<div class="grid grid-cols-3 gap-2 text-xs">
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold">{rag.messages.guaranteed}</div>
								<div class="text-surface-500">Guaranteed</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold">{rag.messages.filledIn}</div>
								<div class="text-surface-500">Scored fill</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2 text-center">
								<div class="font-semibold text-surface-400">{rag.messages.budget}</div>
								<div class="text-surface-500">Budget</div>
							</div>
						</div>
					{/if}
					{#if msgs.excludedIds?.length > 0}
						<p class="text-surface-500 text-xs">Excluded message IDs: {msgs.excludedIds.join(", ")}</p>
					{/if}
				</section>

				<!-- ── Lore & Graph ──────────────────────────────────────────────── -->
				{#if rag?.used === true}
					{@const wl = rag.lore.worldLore}
					{@const cl = rag.lore.characterLore}
					{@const hi = rag.lore.history}
					<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Lore & Graph</h3>
						<div class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">World Lore</div>
								{#if wl.pinned + wl.rag > 0}
									<div class="font-medium">{wl.pinned + wl.rag} included</div>
									<div class="text-surface-500">{wl.pinned} pinned · {wl.rag} RAG</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Char Lore</div>
								{#if cl.pinned + cl.rag > 0}
									<div class="font-medium">{cl.pinned + cl.rag} included</div>
									<div class="text-surface-500">{cl.pinned} pinned · {cl.rag} RAG</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">History</div>
								{#if hi.pinned + hi.rag > 0}
									<div class="font-medium">{hi.pinned + hi.rag} included</div>
									<div class="text-surface-500">{hi.pinned} pinned · {hi.rag} RAG</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Graph Pairs</div>
								{#if rag.graphPairs > 0}
									<div class="font-medium text-primary-400">{rag.graphPairs} pairs</div>
									<div class="text-surface-500">relationship context</div>
								{:else}
									<div class="text-surface-500">None matched</div>
								{/if}
							</div>
						</div>
					</section>
				{:else if rag?.used === false}
					{@const wl = rag.lore.worldLore}
					{@const cl = rag.lore.characterLore}
					{@const hi = rag.lore.history}
					<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Lore</h3>
						<div class="grid grid-cols-3 gap-2 text-xs">
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">World Lore</div>
								{#if wl.included > 0}
									<div class="font-medium">{wl.included} / {wl.budget}</div>
									<div class="text-surface-500">{wl.pinned} pinned · top {wl.topScore.toFixed(2)}</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Char Lore</div>
								{#if cl.included > 0}
									<div class="font-medium">{cl.included} / {cl.budget}</div>
									<div class="text-surface-500">{cl.pinned} pinned · top {cl.topScore.toFixed(2)}</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">History</div>
								{#if hi.included > 0}
									<div class="font-medium">{hi.included} / {hi.budget}</div>
									<div class="text-surface-500">{hi.pinned} pinned · top {hi.topScore.toFixed(2)}</div>
								{:else}
									<div class="text-surface-500">None</div>
								{/if}
							</div>
						</div>
						{#if rag.entries.length > 0}
							<div class="space-y-1 pt-1">
								<div class="text-xs text-surface-500 font-medium">Top scored entries</div>
								{#each rag.entries.slice(0, 8) as entry}
									<div class="flex items-center justify-between gap-2 text-xs">
										<span class="truncate text-surface-300-700">{entry.name || entry.type}</span>
										<span class="shrink-0 font-mono text-surface-500">{entry.score.total.toFixed(3)}</span>
										<span class="shrink-0 rounded px-1 text-[10px] {entry.score.includedReason.startsWith('filled') || entry.score.includedReason.startsWith('reserved') ? 'bg-success-500/20 text-success-400' : 'bg-surface-400/20 text-surface-500'}">{entry.score.includedReason.replace(/_/g, " ")}</span>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/if}

				<!-- ── RAG Retrieval Scores ──────────────────────────────────────── -->
				{#if ragScores}
					<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">RAG Retrieval Scores</h3>
						<div class="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Threshold</div>
								<div class="font-medium font-mono">{ragScores.thresholdUsed.toFixed(3)}</div>
								<div class="text-surface-500">adaptive cutoff</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Query Window</div>
								<div class="font-medium">{ragScores.queryMessageCount}</div>
								<div class="text-surface-500">messages embedded</div>
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Msg Scores</div>
								{#if msgScoreMin !== null}
									<div class="font-medium font-mono">{msgScoreMin.toFixed(3)} – {msgScoreMax?.toFixed(3)}</div>
									<div class="text-surface-500">avg {msgScoreAvg?.toFixed(3)} · {ragScores.messageScores.length} retrieved</div>
								{:else}
									<div class="text-surface-500">None retrieved</div>
								{/if}
							</div>
							<div class="bg-surface-300-700 rounded p-2">
								<div class="text-surface-400 mb-1">Lore Scores</div>
								{#if loreScoreMin !== null}
									<div class="font-medium font-mono">{loreScoreMin.toFixed(3)} – {loreScoreMax?.toFixed(3)}</div>
									<div class="text-surface-500">avg {loreScoreAvg?.toFixed(3)} · {ragScores.loreScores.length} retrieved</div>
								{:else}
									<div class="text-surface-500">None retrieved</div>
								{/if}
							</div>
						</div>
						<!-- Score distribution bars -->
						{#if ragScores.messageScores.length > 0 || ragScores.loreScores.length > 0}
							<div class="space-y-1.5 pt-1">
								{#if ragScores.messageScores.length > 0}
									<div class="flex items-center gap-2 text-xs">
										<span class="w-16 shrink-0 text-surface-500">Messages</span>
										<div class="flex h-3 flex-1 gap-px overflow-hidden rounded">
											{#each [...ragScores.messageScores].sort((a, b) => b - a) as score}
												<div
													class="h-full shrink-0 bg-primary-500/70"
													style="width: {Math.max(2, (score / (ragScores.thresholdUsed > 0 ? 1 : 1)) * 100 / ragScores.messageScores.length)}%; opacity: {0.4 + score * 0.6}"
													title="Score: {score.toFixed(3)}"
												></div>
											{/each}
										</div>
										<span class="w-10 shrink-0 text-right text-surface-500">{ragScores.messageScores.length}</span>
									</div>
								{/if}
								{#if ragScores.loreScores.length > 0}
									<div class="flex items-center gap-2 text-xs">
										<span class="w-16 shrink-0 text-surface-500">Lore</span>
										<div class="flex h-3 flex-1 gap-px overflow-hidden rounded">
											{#each [...ragScores.loreScores].sort((a, b) => b - a) as score}
												<div
													class="h-full shrink-0 bg-secondary-500/70"
													style="width: {Math.max(2, (score / (ragScores.thresholdUsed > 0 ? 1 : 1)) * 100 / ragScores.loreScores.length)}%; opacity: {0.4 + score * 0.6}"
													title="Score: {score.toFixed(3)}"
												></div>
											{/each}
										</div>
										<span class="w-10 shrink-0 text-right text-surface-500">{ragScores.loreScores.length}</span>
									</div>
								{/if}
							</div>
						{/if}
					</section>
				{/if}

				<!-- ── Sources ───────────────────────────────────────────────────── -->
				<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Sources</h3>
					<div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
						<div>
							<p class="text-surface-400 mb-1 text-xs">Characters</p>
							{#if src.characters.length > 0}
								<ul class="space-y-0.5">
									{#each src.characters as char}
										<li class="flex items-center gap-1">
											<Icons.User size={12} class="text-surface-500 shrink-0" />
											<span class="truncate text-xs">{char.name}{char.nickname ? ` (${char.nickname})` : ""}</span>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="text-surface-500 text-xs">None</p>
							{/if}
						</div>
						<div>
							<p class="text-surface-400 mb-1 text-xs">Personas</p>
							{#if src.personas.length > 0}
								<ul class="space-y-0.5">
									{#each src.personas as persona}
										<li class="flex items-center gap-1">
											<Icons.User2 size={12} class="text-surface-500 shrink-0" />
											<span class="truncate text-xs">{persona.name}</span>
										</li>
									{/each}
								</ul>
							{:else}
								<p class="text-surface-500 text-xs">None</p>
							{/if}
						</div>
						<div>
							<p class="text-surface-400 mb-1 text-xs">Scenario</p>
							<p class="text-xs capitalize">{src.scenario ?? "None"}</p>
						</div>
					</div>
				</section>

				<!-- ── Prompt Preview ────────────────────────────────────────────── -->
				<section class="bg-surface-200-800 rounded-lg p-3 space-y-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-surface-500">Prompt Preview</h3>
					{#if draftCompiledPrompt.messages && draftCompiledPrompt.messages.length > 0}
						<!-- Chat format: render each message block -->
						<div class="max-h-96 overflow-y-auto space-y-2">
							{#each draftCompiledPrompt.messages as msg, i}
								<div class="rounded border {msg.role === 'system' ? 'border-warning-500/30 bg-warning-500/5' : msg.role === 'assistant' ? 'border-primary-500/30 bg-primary-500/5' : 'border-surface-400/30 bg-surface-300-700'} overflow-hidden">
									<div class="flex items-center gap-2 border-b border-inherit px-2 py-1">
										<span class="text-xs font-semibold uppercase tracking-wide {msg.role === 'system' ? 'text-warning-400' : msg.role === 'assistant' ? 'text-primary-400' : 'text-surface-400'}">{msg.role}</span>
										{#if msg.name}
											<span class="text-surface-500 text-xs">({msg.name})</span>
										{/if}
										<span class="ml-auto text-surface-600 text-xs">#{i + 1}</span>
									</div>
									<pre class="whitespace-pre-wrap px-2 py-1.5 text-xs leading-relaxed">{typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)}</pre>
								</div>
							{/each}
						</div>
					{:else if draftCompiledPrompt.prompt}
						<!-- Raw text format -->
						<pre class="max-h-96 overflow-y-auto whitespace-pre-wrap rounded bg-surface-300-700 p-2 text-xs leading-relaxed">{draftCompiledPrompt.prompt}</pre>
					{:else}
						<p class="text-surface-500 text-xs">No prompt content available.</p>
					{/if}
				</section>
			</div>
		{:else}
			<div class="text-surface-500 py-8 text-center text-sm">No compiled prompt data available.</div>
		{/if}

		<footer class="flex shrink-0 justify-end gap-4 pt-2">
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

<AvatarGalleryModal
	bind:open={showAvatarModal}
	onOpenChange={(e) => (showAvatarModal = e.open)}
	entity={avatarModalEntity}
/>

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

{#snippet workflowButton()}
	<Icons.BookOpen size="0.75em" />
{/snippet}

{#snippet workflowContent()}
	{#if chat?.lorebookId}
		<ChatWorkflowTab
			lorebookId={chat.lorebookId}
			{sceneList}
			onOpenEntry={handleOpenEntry}
			onEnterSummarizationMode={summarizationEnabled ? enterSummarizationModeEmpty : undefined}
		/>
	{/if}
{/snippet}

{#snippet sceneImagesButton()}
	<Icons.Images size="0.75em" />
{/snippet}

{#snippet sceneImagesContent()}
	<ChatSceneImagesTab
		chatCharacters={chat?.chatCharacters ?? []}
		chatPersonas={chat?.chatPersonas ?? []}
		bind:leftImage={leftSceneImage}
		bind:rightImage={rightSceneImage}
	/>
{/snippet}

{#snippet extraControlsButton()}
	<Icons.MessageSquare size="0.75em" />
{/snippet}

{#snippet extraControlsContent()}
	<div class="flex flex-wrap gap-2">
		<button
			class="btn btn-sm preset-tonal-primary"
			title="Continue Conversation"
			onclick={handleTriggerContinueConversation}
			disabled={!chat ||
				!chat.chatPersonas?.[0]?.personaId ||
				lastMessage?.isGenerating}
		>
			<Icons.MessageSquareMore size={14} />
			Continue
		</button>
		<button
			class="btn btn-sm preset-tonal-secondary"
			title="Trigger Character"
			onclick={handleTriggerCharacterMessage}
			disabled={!chat ||
				!chat.chatPersonas?.[0]?.personaId ||
				lastMessage?.isGenerating}
		>
			<Icons.MessageSquarePlus size={14} />
			Trigger Character
		</button>
		<button
			class="btn btn-sm preset-tonal-warning"
			title="Regenerate Last Message"
			onclick={handleRegenerateLastMessage}
			disabled={!canRegenerateLastMessage}
		>
			<Icons.RefreshCw size={14} />
			Regenerate
		</button>
	</div>
{/snippet}

{#snippet statisticsButton()}
	<Icons.BarChart2 size="0.75em" />
{/snippet}

{#snippet statisticsContent()}
	<div class="flex flex-wrap items-center gap-3">
		<button
			class="btn btn-sm preset-tonal-primary"
			title="View full prompt details"
			onclick={() => (showDraftCompiledPromptModal = true)}
			disabled={!draftCompiledPrompt}
		>
			<Icons.Info size={14} />
			Details
		</button>
		{#if draftCompiledPrompt}
			<div class="flex gap-4 text-xs">
				<div class="flex flex-col gap-0.5">
					<span class="text-surface-500 uppercase tracking-wide" style="font-size:0.65rem">Tokens</span>
					<span class:text-error-500={contextExceeded} class="font-medium tabular-nums">
						{draftCompiledPrompt.meta.tokenCounts.total} / {draftCompiledPrompt.meta.tokenCounts.limit}
					</span>
				</div>
				<div class="flex flex-col gap-0.5">
					<span class="text-surface-500 uppercase tracking-wide" style="font-size:0.65rem">Messages</span>
					<span class="font-medium tabular-nums">
						{draftCompiledPrompt.meta.chatMessages.included} / {draftCompiledPrompt.meta.chatMessages.total}
					</span>
				</div>
			</div>
		{:else}
			<span class="text-surface-500 text-xs">No statistics yet — send a message first.</span>
		{/if}
	</div>
{/snippet}
{/if}

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
