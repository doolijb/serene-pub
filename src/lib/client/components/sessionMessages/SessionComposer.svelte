<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import MessageComposer from "$lib/client/components/sessionMessages/MessageComposer.svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import RagNotice from "$lib/client/components/sessionMessages/RagNotice.svelte"
	import RunProgressCard from "$lib/client/components/pipelines/RunProgressCard.svelte"
	import { getContext } from "svelte"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	interface Props {
		newMessage: string
		onSend: () => void
		draftCompiledPrompt?: Sockets.Sessions.PromptTokenCount.Response
		currentUserPersona?: SelectSessionPersona & { persona?: SelectPersona }
		userPersonasInSession?: Array<
			SelectSessionPersona & { persona?: SelectPersona }
		>
		onSwitchPersona?: (personaId: number) => void
		session?: Sockets.Sessions.Get.Response["session"] & {
			sessionPersonas?: Array<
				SelectSessionPersona & { persona?: SelectPersona }
			>
		}
		lastMessage?: SelectSessionMessage
		editSessionMessage?: SelectSessionMessage
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
		/** A `composer: 'none'` mode (19 §2): triggers only, no text input. */
		hideCompose?: boolean
	}

	let {
		newMessage = $bindable(),
		onSend,
		draftCompiledPrompt,
		currentUserPersona,
		userPersonasInSession = [],
		onSwitchPersona,
		session,
		lastMessage,
		editSessionMessage,
		isGuest,
		showAddPersonaCTA,
		onAddPersonaClick,
		onAbortLastMessage,
		extraTabs = [],
		hideCompose = false
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

<!-- Dropped from this element: `session-input-bar` (no rule anywhere — its only
     definition was an empty one scoped to SessionMessage, so it never applied
     here), plus `gap-4` and `align-middle`, both inert on a block box. -->
<div
	class="sp-composer preset-tonal-surface px-3 pb-2 lg:rounded-t-lg lg:pb-4"
	class:hidden={!!editSessionMessage}
>
	{#if showAddPersonaCTA}
		<!-- Call to action for guests without personas -->
		<div class="flex flex-col items-center justify-center gap-4 py-8">
			<div class="text-center">
				<Icons.UserPlus
					size={48}
					class="text-surface-700-300 mx-auto mb-2"
				/>
				<h3 class="h3 mb-2">Join the Conversation</h3>
				<p class="text-surface-600-400">
					You need to add a persona to this session to send messages.
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
		<!-- Above the composer, because a run in flight is about the message you
		     are about to get rather than the ones already there — and because it
		     has to stay visible while the transcript scrolls. -->
		{#if session?.id}
			<RunProgressCard sessionId={session.id} />
		{/if}

		{#if session?.id && systemSettingsCtx.settings?.vectorizationEnabled}
			<div class="rag-notice">
				<RagNotice
					sessionId={session.id}
					totalMessages={session.sessionMessages?.length ?? 0}
				/>
			</div>
		{/if}

		{#snippet personaSwitcherControl()}
			<Icons.Users size="0.75em" aria-hidden="true" />
		{/snippet}

		{#snippet personaSwitcherContent()}
			<div class="grid grid-cols-2 gap-2 p-1 sm:grid-cols-3">
				{#each userPersonasInSession as cp (cp.personaId)}
					{#if cp.persona && cp.personaId != null}
						<button
							class="flex flex-col items-center gap-2 rounded-lg p-2 text-center text-sm transition"
							class:preset-filled-primary-500={cp.personaId ===
								currentUserPersona?.personaId}
							class:preset-filled-surface-400-600={cp.personaId !==
								currentUserPersona?.personaId}
							onclick={() => onSwitchPersona?.(cp.personaId!)}
						>
							<Avatar char={cp.persona} />
							<span class="w-full truncate text-xs">
								{cp.persona.name}
							</span>
						</button>
					{/if}
				{/each}
			</div>
		{/snippet}

		<MessageComposer
			bind:markdown={newMessage}
			{onSend}
			{hideCompose}
			compiledPrompt={draftCompiledPrompt}
			classes=""
			extraTabs={userPersonasInSession.length > 1
				? [
						{
							value: "personaSwitcher",
							title: "Switch Persona",
							control: personaSwitcherControl,
							content: personaSwitcherContent,
							alwaysVisible: true
						},
						...(extraTabs ?? [])
					]
				: extraTabs}
		>
			{#snippet leftControls()}
				{@const activePersona =
					currentUserPersona?.persona ??
					(!isGuest
						? session?.sessionPersonas?.[0]?.persona
						: undefined)}
				{#if activePersona}
					<div class="flex flex-col max-lg:hidden lg:gap-2">
						{#if userPersonasInSession.length > 1}
							<Popover
								open={personaSwitcherOpen}
								onOpenChange={(e) =>
									(personaSwitcherOpen = e.open)}
								positioning={{ placement: "top" }}
							>
								<Popover.Trigger
									class="relative cursor-pointer p-0"
									title="Switch persona"
									aria-label="Switch persona (currently {activePersona.name})"
								>
									<span class="block">
										<Avatar char={activePersona} />
									</span>
									<span
										class="bg-surface-300-700 absolute -right-1 -bottom-1 flex items-center justify-center rounded-full p-0.5 shadow"
									>
										<Icons.ChevronDown size={10} />
									</span>
								</Popover.Trigger>
								<Portal>
									<Popover.Positioner class="z-[1000]!">
										<Popover.Content
											class="card preset-filled-surface-100-900-surface min-w-[180px] space-y-1 p-2"
										>
											<p
												class="text-surface-700-300 px-2 pb-1 text-xs font-semibold tracking-wider uppercase"
											>
												Switch Persona
											</p>
											{#each userPersonasInSession as cp (cp.personaId)}
												{#if cp.persona && cp.personaId != null}
													<button
														class="btn btn-sm w-full justify-start rounded-lg text-left"
														class:preset-filled-primary-500={cp.personaId ===
															currentUserPersona?.personaId}
														class:preset-filled-surface-400-600={cp.personaId !==
															currentUserPersona?.personaId}
														onclick={() => {
															onSwitchPersona?.(
																cp.personaId!
															)
															personaSwitcherOpen = false
														}}
													>
														{cp.persona.name}
													</button>
												{/if}
											{/each}
										</Popover.Content>
									</Popover.Positioner>
								</Portal>
							</Popover>
						{:else}
							<span class="block">
								<Avatar char={activePersona} />
							</span>
						{/if}
					</div>
				{/if}
			{/snippet}
			{#snippet rightControls()}
				<!-- `btn` is what supplies the focus-visible ring, the active
				     press feedback and the disabled dimming (see app.css); these
				     two were the only controls on the session page without it, so a
				     disabled Send looked identical to an enabled one and neither
				     button showed a focus ring for keyboard users. Sizing comes
				     from .composer-btn because `btn` would otherwise drive the
				     icon down to --btn-size. -->
				{#if !lastMessage?.isGenerating && !editSessionMessage}
					<button
						class="btn composer-btn hover:preset-tonal-success"
						type="button"
						disabled={!newMessage.trim() ||
							lastMessage?.isGenerating}
						title="Send"
						aria-label="Send message"
						onclick={handleSendButton}
					>
						<Icons.Send aria-hidden="true" />
					</button>
				{:else if lastMessage?.isGenerating}
					<button
						title="Stop Generation"
						aria-label="Stop generating"
						class="btn composer-btn text-error-500 hover:preset-tonal-error"
						type="button"
						onclick={handleAbortLastMessage}
					>
						<Icons.Square aria-hidden="true" />
					</button>
				{/if}
			{/snippet}
		</MessageComposer>
	{/if}
</div>
