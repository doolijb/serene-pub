<script lang="ts">
	import { Modal } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"

	// Props for customizing the components used
	interface Props {
		chat: Sockets.Chats.Get.Response["chat"] | undefined
		pagination: Sockets.Chats.Get.Response["pagination"] | undefined
		loadingOlderMessages: boolean
		chatMessagesContainer: HTMLDivElement | null
		onScroll: (event: Event) => void

		// Required props for MessageComponent
		getMessageCharacter: (
			msg: SelectChatMessage
		) => SelectCharacter | SelectPersona | undefined
		canControlMessage: (msg: SelectChatMessage) => boolean
		showSwipeControls: (
			msg: SelectChatMessage,
			isGreeting: boolean
		) => boolean
		canSwipeRight: (msg: SelectChatMessage, isGreeting: boolean) => boolean
		onSwipeLeft: (msg: SelectChatMessage) => void
		onSwipeRight: (msg: SelectChatMessage) => void
		onEditMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onDeleteMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onHideMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onRegenerateMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onContinueMessage?: (event: MouseEvent, msg: SelectChatMessage) => void
		onAbortMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onBranchMessage?: (event: Event, msg: SelectChatMessage) => void
		editChatMessage: SelectChatMessage | undefined
		canRegenerateLastMessage: boolean
		hasGeneratingMessage: boolean
		isGuest: boolean

		// Snippet children
		MessageComponent: Snippet<
			[
				{
					msg: SelectChatMessage
					index: number
					chat: Sockets.Chats.Get.Response["chat"] & {
						chatMessages: SelectChatMessage[]
					}
					isLastMessage: boolean
					messagesLength: number
					getMessageCharacter: (
						msg: SelectChatMessage
					) => SelectCharacter | SelectPersona | undefined
					canControlMessage: (msg: SelectChatMessage) => boolean
					showSwipeControls: (
						msg: SelectChatMessage,
						isGreeting: boolean
					) => boolean
					canSwipeRight: (
						msg: SelectChatMessage,
						isGreeting: boolean
					) => boolean
					onSwipeLeft: (msg: SelectChatMessage) => void
					onSwipeRight: (msg: SelectChatMessage) => void
					onEditMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onDeleteMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onHideMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onRegenerateMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onContinueMessage?: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onAbortMessage: (
						event: MouseEvent,
						msg: SelectChatMessage
					) => void
					onBranchMessage?: (
						event: Event,
						msg: SelectChatMessage
					) => void
					editChatMessage: SelectChatMessage | undefined
					canRegenerateLastMessage: boolean
					hasGeneratingMessage: boolean
					isGuest: boolean
				}
			]
		>
		ComposerComponent: Snippet<[]>
		NextCharacterComponent?: Snippet<[]>
	}

	let {
		chat,
		pagination,
		loadingOlderMessages,
		chatMessagesContainer = $bindable(),
		onScroll,
		getMessageCharacter,
		canControlMessage,
		showSwipeControls,
		canSwipeRight,
		onSwipeLeft,
		onSwipeRight,
		onEditMessage,
		onDeleteMessage,
		onHideMessage,
		onRegenerateMessage,
		onContinueMessage,
		onAbortMessage,
		onBranchMessage,
		editChatMessage,
		canRegenerateLastMessage,
		hasGeneratingMessage,
		isGuest,
		MessageComponent,
		ComposerComponent,
		NextCharacterComponent
	}: Props = $props()
</script>

<div class="relative flex h-full flex-col">
	<div
		id="chat-history"
		class="flex flex-1 flex-col gap-3 overflow-auto"
		bind:this={chatMessagesContainer}
		onscroll={onScroll}
		role="log"
		aria-label="Chat messages"
		aria-live="polite"
		aria-atomic="false"
	>
		<div class="p-2">
			{#if !chat || chat.chatMessages.length === 0}
				<div class="text-muted mt-8 text-center">No messages yet.</div>
			{:else}
				<!-- Loading indicator for older messages -->
				{#if loadingOlderMessages}
					<div class="text-muted py-2 text-center">
						<div class="inline-flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-b-2 border-current"
							></div>
							Loading older messages...
						</div>
					</div>
				{/if}

				<ul
					class="flex flex-1 flex-col gap-3"
					role="group"
					aria-label="Chat conversation with {chat.chatMessages
						.length} messages"
				>
					{#each chat.chatMessages as msg, index (msg.id)}
						{@const isLastMessage =
							index === chat.chatMessages.length - 1}

						<li class="w-full">
							{@render MessageComponent({
								msg,
								index,
								chat,
								isLastMessage,
								messagesLength: chat.chatMessages.length,
								getMessageCharacter,
								canControlMessage,
								showSwipeControls,
								canSwipeRight,
								onSwipeLeft,
								onSwipeRight,
								onEditMessage,
								onDeleteMessage,
								onHideMessage,
								onRegenerateMessage,
								onContinueMessage,
								onAbortMessage,
								onBranchMessage,
								editChatMessage,
								canRegenerateLastMessage,
								hasGeneratingMessage,
								isGuest
							})}
							<!-- Show next character block after the last message if component provided -->
							{#if isLastMessage && NextCharacterComponent}
								{@render NextCharacterComponent()}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<!-- Composer area -->
	{@render ComposerComponent()}
</div>
