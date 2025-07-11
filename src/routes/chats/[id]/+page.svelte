<script lang="ts">
	import { page } from "$app/state"
	import { Modal, Popover } from "@skeletonlabs/skeleton-svelte"
	import * as skio from "sveltekit-io"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onMount } from "svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"

	let chat: Sockets.Chat.Response["chat"] | undefined = $state()
	let newMessage = $state("")
	const socket = skio.get()
	let showDeleteMessageModal = $state(false)
	let deleteChatMessage: SelectChatMessage | undefined = $state()
	let editChatMessage: SelectChatMessage | undefined = $state()
	let draftCompiledPrompt: CompiledPrompt | undefined = $state()
	let userCtx: UserCtx = getContext("userCtx")
	let panelsCtx: PanelsCtx = getContext("panelsCtx")
	let promptTokenCountTimeout: ReturnType<typeof setTimeout> | null = null
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

	function handleSend() {
		if (!newMessage.trim()) return
		// TODO: Implement send message socket call
		const msg: Sockets.SendPersonaMessage.Call = {
			chatId,
			personaId: chat?.chatPersonas?.[0]?.personaId,
			content: newMessage
		}
		socket.emit("sendPersonaMessage", msg)
		newMessage = ""
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
		console.log("Opening delete message modal for:", message)
	}

	function onOpenMessageDeleteChange(details: OpenChangeDetails) {
		showDeleteMessageModal = details.open
		if (!showDeleteMessageModal) {
			deleteChatMessage = undefined
		}
	}

	function onDeleteMessageConfirm() {
		console.log("Deleting message")
		socket.emit("deleteChatMessage", {
			id: deleteChatMessage?.id
		})
		deleteChatMessage = undefined
		showDeleteMessageModal = false
	}

	function onDeleteMessageCancel() {
		console.log("Delete message cancelled")
		deleteChatMessage = undefined
		showDeleteMessageModal = false
	}

	function handleEditMessageClick(message: SelectChatMessage) {
		openMobileMsgControls = undefined
		editChatMessage = { ...message }
	}

	function handleMessageUpdate(event?: Event) {
		if (event) event.preventDefault()
		if (!editChatMessage || !editChatMessage.content.trim()) return

		const updatedMessage: Sockets.UpdateChatMessage.Call = {
			chatMessage: editChatMessage
		}
		socket.emit("updateChatMessage", updatedMessage)
		editChatMessage = undefined
	}

	$effect(() => {
		const _chatId = page.params.id
		if (_chatId) {
			chatId = Number.parseInt(_chatId)
			socket.emit("chat", { id: chatId })
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
			socket.emit("promptTokenCount", {
				chatId,
				content: newMessage,
				personaId: chat?.chatPersonas?.[0]?.personaId || undefined,
				role: "user"
			})
		}, 2000)
	})

	let chatMessagesContainer: HTMLDivElement | null = $state(null)

	// Auto-scroll to bottom when messages change or container is mounted
	$effect(() => {
		// React to changes in messages and container
		const messagesLength = chat?.chatMessages?.length ?? 0
		if (chatMessagesContainer && messagesLength > 0) {
			// Use setTimeout to ensure DOM has updated
			setTimeout(() => {
				if (chatMessagesContainer) {
					chatMessagesContainer.scrollTo({
						top: chatMessagesContainer.scrollHeight,
						behavior: "smooth"
					})
				}
			// }, 50) // Slightly longer delay to ensure content is rendered
			}, 30)
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
	function handleHideMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		socket.emit("updateChatMessage", {
			chatMessage: { ...msg, isHidden: !msg.isHidden }
		})
	}
	function handleDeleteMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		openDeleteMessageModal(msg)
	}
	function handleRegenerateMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		socket.emit("regenerateChatMessage", { id: msg.id })
	}
	function handleAbortMessage(e: Event, msg: SelectChatMessage) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		socket.emit("abortChatMessage", { id: msg.id })
	}
	function handleSendButton(e: Event) {
		e.stopPropagation()
		handleSend()
	}
	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		if (lastMessage) socket.emit("abortChatMessage", { id: lastMessage.id })
	}
	function handleTriggerContinueConversation(e: Event) {
		e.stopPropagation()
		openMobileMsgControls = undefined
		socket.emit("triggerGenerateMessage", { chatId })
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
			socket.emit("regenerateChatMessage", { id: lastMessage.id })
		}
	}

	function onSelectTriggerCharacterMessage(characterId: number) {
		showTriggerCharacterMessageModal = false
		openMobileMsgControls = undefined
		socket.emit("triggerGenerateMessage", {
			chatId,
			characterId,
			once: true
		})
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
		const req: Sockets.ChatMessageSwipeRight.Call = {
			chatId: chatId,
			chatMessageId: msg.id
		}
		socket.emit("chatMessageSwipeRight", req)
	}

	function swipeLeft(msg: SelectChatMessage): void {
		const req: Sockets.ChatMessageSwipeLeft.Call = {
			chatId: chatId,
			chatMessageId: msg.id
		}
		socket.emit("chatMessageSwipeLeft", req)
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
		socket.on("chat", (msg: Sockets.Chat.Response) => {
			if (msg.chat.id === Number.parseInt(page.params.id)) {
				chat = msg.chat
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
					chat = {
						...chat,
						chatMessages: [...chat.chatMessages, msg.chatMessage]
					}
				}
				// Auto-scroll is handled by the $effect
			}
		})

		socket.on(
			"updateCharacter",
			(msg: Sockets.UpdateCharacter.Response) => {
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

		socket.on("updatePersona", (msg: Sockets.UpdatePersona.Response) => {
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
		})

		socket.on(
			"promptTokenCount",
			(msg: Sockets.PromptTokenCount.Response) => {
				draftCompiledPrompt = msg
			}
		)
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
	<div
		id="chat-history"
		class="flex flex-1 flex-col gap-3 overflow-auto"
		bind:this={chatMessagesContainer}
	>
		<div class="p-2">
			{#if !chat || chat.chatMessages.length === 0}
				<div class="text-muted mt-8 text-center">No messages yet.</div>
			{:else}
				<ul class="flex flex-1 flex-col gap-3">
					{#each chat.chatMessages as msg (msg.id)}
						{@const character = getMessageCharacter(msg)}
						{@const isGreeting = !!msg.metadata?.isGreeting}
						<li
							class="preset-filled-primary-50-950 flex flex-col rounded-lg p-2"
							class:opacity-50={msg.isHidden &&
								editChatMessage?.id !== msg.id}
						>
							<div class="flex justify-between gap-2">
								<div class="group flex gap-2">
									<span>
										<!-- Make avatar clickable -->
										<button
											class="m-0 w-fit p-0"
											onclick={() =>
												handleAvatarClick(character)}
											title="View Avatar"
										>
											<Avatar char={character} />
										</button>
									</span>
									<div class="flex flex-col">
										<span class="flex gap-1">
											<button
												class="funnel-display mx-0 inline-block w-fit px-0 text-[1.1em] font-bold hover:underline"
												onclick={(e) =>
													handleCharacterNameClick(
														msg
													)}
												title="Edit"
											>
												<span class="text-nowrap">
													{character?.nickname ||
														character?.name ||
														"Unknown"}
												</span>
											</button>
											{#if isGreeting}
												<span
													class="text-muted mt-1 text-xs opacity-50"
													title="Greeting message"
												>
													<Icons.Handshake
														size={16}
													/>
												</span>
											{/if}
										</span>
									</div>
								</div>

								{#if editChatMessage && editChatMessage.id === msg.id}
									<div class="flex gap-2">
										<button
											class="btn btn-sm msg-cntrl-icon preset-filled-surface-500"
											title="Cancel Edit"
											onclick={handleCancelEditMessage}
										>
											<Icons.X size={16} />
										</button>
										<button
											class="btn btn-sm msg-cntrl-icon preset-filled-success-500"
											title="Save"
											onclick={handleSaveEditMessage}
										>
											<Icons.Save
												size={16}
												class="mx-4"
											/>
										</button>
									</div>
								{:else}
									<div class="flex w-full flex-col gap-2">
										<div
											class="ml-auto hidden gap-2 lg:flex"
										>
											{@render messageControls(msg)}
										</div>
										<div class="ml-auto lg:hidden">
											<Popover
												open={openMobileMsgControls ===
													msg.id}
												onOpenChange={(e) =>
													(openMobileMsgControls =
														e.open
															? msg.id
															: undefined)}
												positioning={{
													placement: "bottom"
												}}
												triggerBase="btn btn-sm hover:bg-primary-600-400 {openMobileMsgControls ===
												msg.id
													? 'bg-primary-600-400'
													: ''}"
												contentBase="card bg-primary-200-800 p-4 space-y-4 max-w-[320px]"
												arrow
												arrowBackground="!bg-primary-200 dark:!bg-primary-800"
												zIndex="1000"
											>
												{#snippet trigger()}
													<Icons.EllipsisVertical
														size={20}
													/>
												{/snippet}
												{#snippet content()}
													<header
														class="flex justify-between"
													>
														<p
															class="text-xl font-bold"
														>
															Popover Example
														</p>
													</header>
													<article
														class="flex flex-col gap-4"
													>
														{@render messageControls(
															msg
														)}
													</article>
												{/snippet}
											</Popover>
										</div>
										{#if showSwipeControls(msg, isGreeting)}
											<div class="ml-auto flex gap-6">
												{#if ![null, undefined].includes(msg.metadata?.swipes?.currentIdx) && msg.metadata?.swipes?.history && msg.metadata?.swipes.history.length > 1}
													<button
														class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
														title="Swipe Left"
														onclick={() =>
															swipeLeft(msg)}
														disabled={!msg.metadata
															.swipes
															.currentIdx ||
															msg.metadata.swipes
																.history
																.length <= 1 ||
															msg.isGenerating}
													>
														<Icons.ChevronLeft
															size={24}
														/>
													</button>
													<span
														class="text-surface-700-300 mt-[0.2rem] h-fit select-none"
													>
														{msg.metadata.swipes
															.currentIdx +
															1}/{msg.metadata
															.swipes.history
															.length}
													</span>
												{/if}
												<button
													class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
													title="Swipe Right"
													onclick={() =>
														swipeRight(msg)}
													disabled={!canSwipeRight(
														msg,
														isGreeting
													)}
												>
													<Icons.ChevronRight
														size={24}
													/>
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<div class="flex h-fit rounded p-2 text-left">
								{#if msg.content === "" && msg.isGenerating}
									{@render generatingAnimation()}
								{:else if editChatMessage && editChatMessage.id === msg.id}
									<div
										class="chat-input-bar bg-surface-100-900 w-full rounded-xl p-2 pb-2 align-middle lg:pb-4"
									>
										<MessageComposer
											bind:markdown={
												editChatMessage.content
											}
											onSend={handleMessageUpdate}
										/>
									</div>
								{:else}
									<div class="rendered-chat-message-content">
										{@html renderMarkdownWithQuotedText(
											msg.content
										)}
									</div>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<div
		class="chat-input-bar preset-tonal-surface gap-4 pb-2 align-middle lg:rounded-t-lg lg:pb-4"
		class:hidden={!!editChatMessage}
	>
		<MessageComposer
			bind:markdown={newMessage}
			onSend={handleSend}
			compiledPrompt={draftCompiledPrompt}
			classes=""
			extraTabs={[
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
		>
			{#snippet leftControls()}
				{#if chat?.chatPersonas?.[0]?.persona}
					{@const persona = chat?.chatPersonas?.[0]?.persona}
					<div class="hidden flex-col lg:ml-2 lg:flex lg:gap-2">
						<span class="ml-1">
							<Avatar char={persona} />
						</span>
					</div>
					<div class="lg:hidden"></div>
				{/if}
			{/snippet}
			{#snippet rightControls()}
				{#if !lastMessage?.isGenerating && !editChatMessage}
					<button
						class="hover:preset-tonal-success mr-3 rounded-lg text-center lg:block lg:h-auto lg:p-3"
						type="button"
						disabled={!newMessage.trim() ||
							lastMessage?.isGenerating}
						title="Send"
						onclick={handleSendButton}
					>
						<Icons.Send size={24} class="mx-auto" />
					</button>
				{:else if lastMessage?.isGenerating}
					<button
						title="Stop Generation"
						class="text-error-500 hover:preset-tonal-error mr-3 rounded-lg text-center lg:h-auto lg:p-3"
						type="button"
						onclick={handleAbortLastMessage}
					>
						<Icons.Square size={24} class="mx-auto" />
					</button>
				{/if}
			{/snippet}
		</MessageComposer>
	</div>
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
								onSelectTriggerCharacterMessage(filtered.character.id)}
						>
							<div class="w-fit">
								<Avatar char={filtered.character} />
							</div>
							<div class="relative flex w-0 min-w-0 flex-1 flex-col">
								<div class="w-full truncate text-left font-semibold">
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

{#snippet messageControls(msg: SelectChatMessage)}
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-secondary-500"
		class:preset-filled-secondary-500={msg.isHidden}
		title={msg.isHidden ? "Unhide Message" : "Hide Message"}
		disabled={lastMessage?.isGenerating || !!editChatMessage}
		onclick={(e) => handleHideMessage(e, msg)}
	>
		<Icons.Ghost size={16} />
		<span class="lg:hidden">
			{msg.isHidden ? "Unhide Message" : "Hide Message"}
		</span>
	</button>
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
		title="Edit Message"
		disabled={lastMessage?.isGenerating ||
			!!editChatMessage ||
			msg.isGenerating ||
			msg.isHidden}
		onclick={(e) => handleEditMessage(e, msg)}
	>
		<Icons.Edit size={16} />
		<span class="lg:hidden">Edit Message</span>
	</button>
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-error-500"
		title="Delete Message"
		disabled={lastMessage?.isGenerating || !!editChatMessage}
		onclick={(e) => handleDeleteMessage(e, msg)}
	>
		<Icons.Trash2 size={16} />
		<span class="lg:hidden">Delete Message</span>
	</button>
	{#if !!msg.characterId && msg.id === lastMessage?.id && !msg.isGenerating}
		<button
			class="btn btn-sm msg-cntrl-icon hover:preset-filled-warning-500"
			title="Regenerate Response"
			disabled={!canRegenerateLastMessage}
			onclick={(e) => handleRegenerateMessage(e, msg)}
		>
			<Icons.RefreshCw size={16} />
			<span class="lg:hidden">Regenerate Response</span>
		</button>
	{/if}
	{#if msg.isGenerating}
		<button
			class="btn btn-sm msg-cntrl-icon preset-filled-error-500"
			title="Stop Generation"
			onclick={(e) => handleAbortMessage(e, msg)}
		>
			<Icons.Square size={16} />
			<span class="lg:hidden">Stop Generation</span>
		</button>
	{/if}
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

	/* .chat-messages {
		overflow-y: auto;
		flex: 1 1 0%;
		padding-bottom: 0.5rem;
	} */
	.chat-input-bar {
	}
	/* Loader styles from Uiverse.io by mobinkakei */
	.wrapper {
		width: 66px;
		height: 20px;
		position: relative;
		z-index: 1;
		margin-left: 0;
	}
	.circle {
		width: 6.6px;
		height: 6.6px;
		position: absolute;
		border-radius: 50%;
		background-color: #fff;
		left: 15%;
		transform-origin: 50%;
		animation: circle7124 0.5s alternate infinite ease;
	}
	@keyframes circle7124 {
		0% {
			top: 20px;
			height: 1.66px;
			border-radius: 50px 50px 25px 25px;
			transform: scaleX(1.7);
		}
		40% {
			height: 6.6px;
			border-radius: 50%;
			transform: scaleX(1);
		}
		100% {
			top: 0%;
		}
	}
	.circle:nth-child(2) {
		left: 45%;
		animation-delay: 0.2s;
	}
	.circle:nth-child(3) {
		left: auto;
		right: 15%;
		animation-delay: 0.3s;
	}
	.shadow {
		width: 6.6px;
		height: 1.33px;
		border-radius: 50%;
		background-color: rgba(0, 0, 0, 0.9);
		position: absolute;
		top: 20.66px;
		transform-origin: 50%;
		z-index: -1;
		left: 15%;
		filter: blur(0.33px);
		animation: shadow046 0.5s alternate infinite ease;
	}
	@keyframes shadow046 {
		0% {
			transform: scaleX(1.5);
		}
		40% {
			transform: scaleX(1);
			opacity: 0.7;
		}
		100% {
			transform: scaleX(0.2);
			opacity: 0.4;
		}
	}
	.shadow:nth-child(4) {
		left: 45%;
		animation-delay: 0.2s;
	}
	.shadow:nth-child(5) {
		left: auto;
		right: 15%;
		animation-delay: 0.3s;
	}
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

	.msg-cntrl-icon {
		@apply h-min w-min px-2 text-[1em] disabled:opacity-25;
	}
</style>
