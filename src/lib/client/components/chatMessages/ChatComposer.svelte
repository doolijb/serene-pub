<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"

	interface Props {
		newMessage: string
		onSend: () => void
		draftCompiledPrompt?: CompiledPrompt
		currentUserPersona?: SelectChatPersona & { persona?: SelectPersona }
		chat?: Sockets.Chats.Get.Response["chat"] & {
			chatPersonas?: Array<
				SelectChatPersona & { persona?: SelectPersona }
			>
		}
		lastMessage?: SelectChatMessage
		editChatMessage?: SelectChatMessage
		isGuest: boolean
		showAddPersonaCTA: boolean
		onAddPersonaClick: () => void
		onAbortLastMessage: (e: Event) => void
		// Extra tabs for MessageComposer
		extraTabs?: Array<{
			value: string
			title: string
			control: any
			content: any
		}>
	}

	let {
		newMessage = $bindable(),
		onSend,
		draftCompiledPrompt,
		currentUserPersona,
		chat,
		lastMessage,
		editChatMessage,
		isGuest,
		showAddPersonaCTA,
		onAddPersonaClick,
		onAbortLastMessage,
		extraTabs = []
	}: Props = $props()

	function handleSendButton(e: Event) {
		e.stopPropagation()
		onSend()
	}

	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		onAbortLastMessage(e)
	}
</script>

<div
	class="chat-input-bar preset-tonal-surface gap-4 pb-2 align-middle lg:rounded-t-lg lg:pb-4"
	class:hidden={!!editChatMessage}
>
	{#if showAddPersonaCTA}
		<!-- Call to action for guests without personas -->
		<div class="flex flex-col items-center justify-center gap-4 py-8">
			<div class="text-center">
				<Icons.UserPlus
					size={48}
					class="text-surface-500 mx-auto mb-2"
				/>
				<h3 class="h3 mb-2">Join the Conversation</h3>
				<p class="text-surface-600-400">
					You need to add a persona to this chat to send messages.
				</p>
			</div>
			<button
				class="btn preset-filled-primary-500"
				onclick={onAddPersonaClick}
			>
				<Icons.UserPlus size={20} />
				Add Your Persona
			</button>
		</div>
	{:else}
		<MessageComposer
			bind:markdown={newMessage}
			{onSend}
			compiledPrompt={draftCompiledPrompt}
			classes=""
			{extraTabs}
		>
			{#snippet leftControls()}
				{#if currentUserPersona?.persona}
					{@const persona = currentUserPersona.persona}
					<div class="hidden flex-col lg:ml-2 lg:flex lg:gap-2">
						<span class="ml-1">
							<Avatar char={persona} />
						</span>
					</div>
					<div class="lg:hidden"></div>
				{:else if !isGuest && chat?.chatPersonas?.[0]?.persona}
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
	{/if}
</div>
