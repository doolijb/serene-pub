<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover } from "@skeletonlabs/skeleton-svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import RagNotice from "$lib/client/components/chatMessages/RagNotice.svelte"

	interface Props {
		newMessage: string
		onSend: () => void
		draftCompiledPrompt?: Sockets.Chats.PromptTokenCount.Response
		currentUserPersona?: SelectChatPersona & { persona?: SelectPersona }
		userPersonasInChat?: Array<SelectChatPersona & { persona?: SelectPersona }>
		onSwitchPersona?: (personaId: number) => void
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
		userPersonasInChat = [],
		onSwitchPersona,
		chat,
		lastMessage,
		editChatMessage,
		isGuest,
		showAddPersonaCTA,
		onAddPersonaClick,
		onAbortLastMessage,
		extraTabs = []
	}: Props = $props()

	let personaSwitcherOpen = $state(false)

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
		{#if chat?.id}
			<RagNotice
				chatId={chat.id}
				totalMessages={chat.chatMessages?.length ?? 0}
			/>
		{/if}

		{#snippet personaSwitcherControl()}
			<Icons.Users size="0.75em" aria-hidden="true" />
		{/snippet}

		{#snippet personaSwitcherContent()}
			<div class="grid grid-cols-2 gap-2 p-1 sm:grid-cols-3">
				{#each userPersonasInChat as cp (cp.personaId)}
					{#if cp.persona && cp.personaId != null}
						<button
							class="flex flex-col items-center gap-2 rounded-lg p-2 text-center text-sm transition"
							class:preset-filled-primary-500={cp.personaId === currentUserPersona?.personaId}
							class:preset-tonal-surface={cp.personaId !== currentUserPersona?.personaId}
							onclick={() => onSwitchPersona?.(cp.personaId!)}
						>
							<Avatar char={cp.persona} />
							<span class="w-full truncate text-xs">{cp.persona.name}</span>
						</button>
					{/if}
				{/each}
			</div>
		{/snippet}

		<MessageComposer
			bind:markdown={newMessage}
			{onSend}
			compiledPrompt={draftCompiledPrompt}
			classes=""
			extraTabs={userPersonasInChat.length > 1
				? [{ value: "personaSwitcher", title: "Switch Persona", control: personaSwitcherControl, content: personaSwitcherContent }, ...(extraTabs ?? [])]
				: extraTabs}
		>
			{#snippet leftControls()}
				{@const activePersona = currentUserPersona?.persona ?? (!isGuest ? chat?.chatPersonas?.[0]?.persona : undefined)}
				{#if activePersona}
					<div class="hidden flex-col lg:ml-2 lg:flex lg:gap-2">
						{#if userPersonasInChat.length > 1}
							<Popover
								open={personaSwitcherOpen}
								onOpenChange={(e) => (personaSwitcherOpen = e.open)}
								positioning={{ placement: "top" }}
								triggerBase="relative p-0 cursor-pointer"
								contentBase="card preset-tonal-surface p-2 space-y-1 min-w-[180px]"
								zIndex="1000"
							>
								{#snippet trigger()}
									<span class="ml-1 block">
										<Avatar char={activePersona} />
									</span>
									<span class="bg-surface-300-700 absolute -bottom-1 -right-1 flex items-center justify-center rounded-full p-0.5 shadow">
										<Icons.ChevronDown size={10} />
									</span>
								{/snippet}
								{#snippet content()}
									<p class="text-surface-500 px-2 pb-1 text-xs font-semibold uppercase tracking-wider">Switch Persona</p>
									{#each userPersonasInChat as cp (cp.personaId)}
										{#if cp.persona && cp.personaId != null}
											<button
												class="btn btn-sm w-full justify-start rounded-lg text-left"
												class:preset-filled-primary-500={cp.personaId === currentUserPersona?.personaId}
												class:preset-tonal-surface={cp.personaId !== currentUserPersona?.personaId}
												onclick={() => {
													onSwitchPersona?.(cp.personaId!)
													personaSwitcherOpen = false
												}}
											>
												{cp.persona.name}
											</button>
										{/if}
									{/each}
								{/snippet}
							</Popover>
						{:else}
							<span class="ml-1">
								<Avatar char={activePersona} />
							</span>
						{/if}
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
