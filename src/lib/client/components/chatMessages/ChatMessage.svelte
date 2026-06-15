<script lang="ts">
	import { Popover } from "@skeletonlabs/skeleton-svelte"
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import MessageControls from "$lib/client/components/chatMessages/MessageControls.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"

	interface Props {
		msg: SelectChatMessage
		index: number
		chat: Sockets.Chats.Get.Response["chat"] & {
			chatMessages: SelectChatMessage[]
		}
		isLastMessage: boolean
		messagesLength: number
		// Functions
		getMessageCharacter: (
			msg: SelectChatMessage
		) => SelectCharacter | SelectPersona | undefined
		canControlMessage: (msg: SelectChatMessage) => boolean
		showSwipeControls: (
			msg: SelectChatMessage,
			isGreeting: boolean
		) => boolean
		canSwipeRight: (msg: SelectChatMessage, isGreeting: boolean) => boolean
		// Event handlers
		onSwipeLeft: (msg: SelectChatMessage) => void
		onSwipeRight: (msg: SelectChatMessage) => void
		onEditMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onDeleteMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onHideMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onRegenerateMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onContinueMessage?: (event: MouseEvent, msg: SelectChatMessage) => void
		onAbortMessage: (event: MouseEvent, msg: SelectChatMessage) => void
		onBranchMessage?: (event: Event, msg: SelectChatMessage) => void
		onCharacterNameClick: (msg: SelectChatMessage) => void
		onAvatarClick: (
			char: SelectCharacter | SelectPersona | undefined
		) => void
		onCancelEditMessage: () => void
		onSaveEditMessage: () => void
		openMobileMsgControls: number | undefined
		// Edit state
		editChatMessage: SelectChatMessage | undefined
		canRegenerateLastMessage: boolean
		hasGeneratingMessage: boolean
		isGuest: boolean
		// Additional needed props
		lastPersonaMessage: SelectChatMessage | undefined
		// Summarization mode
		isSummarizationMode?: boolean
		isSelected?: boolean
		onStartSummarization?: (msg: SelectChatMessage) => void
		// Snippets
		GeneratingAnimationComponent?: Snippet<[]>
		messageControls?: Snippet<[SelectChatMessage]>
		generatingAnimation?: Snippet<[]>
	}

	let {
		msg,
		index,
		chat,
		isLastMessage,
		messagesLength,
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
		onCharacterNameClick,
		onAvatarClick,
		onCancelEditMessage,
		onSaveEditMessage,
		openMobileMsgControls = $bindable(),
		editChatMessage,
		canRegenerateLastMessage,
		hasGeneratingMessage,
		isGuest,
		lastPersonaMessage,
		isSummarizationMode = false,
		isSelected = false,
		onStartSummarization,
		GeneratingAnimationComponent,
		messageControls,
		generatingAnimation
	}: Props = $props()

	// Derived values
	const character = $derived(getMessageCharacter(msg))
	const isGreeting = $derived(!!msg.metadata?.isGreeting)
	const canControl = $derived(canControlMessage(msg))
	const showSwipes = $derived(showSwipeControls(msg, isGreeting))
	const canSwipeRightVal = $derived(canSwipeRight(msg, isGreeting))
	const preContent = $derived((msg.metadata as any)?.reasoning || "")
	const hasPreContent = $derived(preContent.trim().length > 0)

	let isPreContentExpanded = $state(false)

	function handleMessageUpdate() {
		onSaveEditMessage()
	}

	function togglePreContent() {
		isPreContentExpanded = !isPreContentExpanded
	}
</script>

<li
	id="message-{msg.id}"
	class="{isSummarizationMode
		? isSelected
			? 'preset-filled-secondary-100-900'
			: 'preset-tonal-surface opacity-60'
		: 'preset-filled-primary-50-950'} flex flex-col rounded-lg p-2 transition-colors duration-150"
	class:opacity-50={!isSummarizationMode && msg.isHidden && editChatMessage?.id !== msg.id}
	tabindex="-1"
	role="article"
	aria-label="Message {index + 1} of {chat.chatMessages.length} from {(
		character as any
	)?.nickname ||
		character?.name ||
		'Unknown'}: {msg.content.slice(0, 100)}{msg.content.length > 100
		? '...'
		: ''}"
>
	<div class="flex justify-between gap-2">
		<div class="group flex gap-2">
			<span>
				<!-- Make avatar clickable -->
				<button
					class="m-0 w-fit p-0"
					onclick={() => onAvatarClick(character)}
					title="View Avatar"
				>
					<Avatar char={character || undefined} />
				</button>
			</span>
			<div class="flex flex-col">
				<span class="flex gap-1">
					<button
						class="funnel-display mx-0 inline-block w-fit px-0 text-[1.1em] font-bold hover:underline"
						onclick={(e) => onCharacterNameClick(msg)}
						title="Edit"
					>
						<span class="text-nowrap">
							{(character as any)?.nickname ||
								character?.name ||
								"Unknown"}
						</span>
					</button>
					{#if isGreeting}
						<span
							class="text-muted mt-1 text-xs opacity-50"
							title="Greeting message"
						>
							<Icons.Handshake size={16} />
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
					onclick={onCancelEditMessage}
				>
					<Icons.X size={16} />
				</button>
				<button
					class="btn btn-sm msg-cntrl-icon preset-filled-success-500"
					title="Save"
					onclick={onSaveEditMessage}
				>
					<Icons.Save size={16} class="mx-4" />
				</button>
			</div>
		{:else}
			<div class="flex w-full flex-col gap-2">
				<div class="ml-auto hidden gap-2 lg:flex">
					{#if messageControls}
						{@render messageControls(msg)}
					{:else}
						<MessageControls
							{msg}
							{isLastMessage}
							{canRegenerateLastMessage}
							{editChatMessage}
							{hasGeneratingMessage}
							{onEditMessage}
							{onHideMessage}
							{onDeleteMessage}
							{onRegenerateMessage}
							{onContinueMessage}
							{onAbortMessage}
							{onBranchMessage}
							{onStartSummarization}
						/>
					{/if}
				</div>
				<div class="ml-auto lg:hidden">
					<Popover
						open={openMobileMsgControls === msg.id}
						onOpenChange={(e) =>
							(openMobileMsgControls = e.open
								? msg.id
								: undefined)}
						positioning={{
							placement: "bottom"
						}}
						triggerBase="btn btn-sm hover:bg-primary-600-400 {openMobileMsgControls ===
						msg.id
							? 'bg-primary-600-400'
							: ''}"
						contentBase="card bg-primary-200-800 p-4 space-y-4 w-[min(90vw,320px)]"
						arrow
						arrowBackground="!bg-primary-200 dark:!bg-primary-800"
						zIndex="1000"
					>
						{#snippet trigger()}
							<Icons.EllipsisVertical size={20} />
						{/snippet}
						{#snippet content()}
							<header class="flex justify-between">
								<p class="text-xl font-bold">Message Options</p>
							</header>
							<article class="flex flex-col gap-2">
								{#if messageControls}
									{@render messageControls(msg)}
								{:else}
									<MessageControls
										{msg}
										{isLastMessage}
										{canRegenerateLastMessage}
										{editChatMessage}
										{hasGeneratingMessage}
										{onEditMessage}
										{onHideMessage}
										{onDeleteMessage}
										{onRegenerateMessage}
										{onContinueMessage}
										{onAbortMessage}
										{onBranchMessage}
										{onStartSummarization}
									/>
								{/if}
							</article>
						{/snippet}
					</Popover>
				</div>
				{#if showSwipes}
					<div class="ml-auto flex gap-6">
						{#if msg.metadata?.swipes?.currentIdx !== null && msg.metadata?.swipes?.currentIdx !== undefined && msg.metadata?.swipes?.history && msg.metadata?.swipes.history.length > 1}
							<button
								class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
								title="Swipe Left"
								onclick={() => onSwipeLeft(msg)}
								disabled={!!editChatMessage ||
									!msg.metadata.swipes.currentIdx ||
									msg.metadata.swipes.history.length <= 1 ||
									msg.isGenerating}
							>
								<Icons.ChevronLeft size={24} />
							</button>
							<span
								class="text-surface-700-300 mt-[0.2rem] h-fit select-none"
							>
								{(msg.metadata.swipes.currentIdx || 0) + 1}/{msg
									.metadata.swipes.history.length}
							</span>
						{/if}
						<button
							class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
							title="Swipe Right"
							onclick={() => onSwipeRight(msg)}
							disabled={!!editChatMessage || !canSwipeRightVal}
						>
							<Icons.ChevronRight size={24} />
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Pre-Content Section (Reasoning/Thinking) -->
	{#if hasPreContent}
		<div class="mx-2 mt-2">
			<button
				class="flex w-full items-center gap-2 py-2 text-sm opacity-70 transition-opacity hover:opacity-100"
				onclick={togglePreContent}
				title={isPreContentExpanded
					? "Collapse reasoning"
					: "Expand reasoning"}
			>
				<Icons.Brain size={16} />
				<span>Reasoning</span>
				<Icons.ChevronDown
					size={16}
					class={`transition-transform ${isPreContentExpanded ? "rotate-180" : ""}`}
				/>
			</button>
			{#if isPreContentExpanded}
				<div
					class="rendered-chat-message-content pb-2 text-sm opacity-80"
				>
					{@html renderMarkdownWithQuotedText(preContent)}
				</div>
			{/if}
		</div>
	{/if}

	<div class="flex h-fit rounded p-2 text-left">
		{#if msg.content === "" && msg.isGenerating}
			{#if GeneratingAnimationComponent}
				{@render GeneratingAnimationComponent()}
			{:else if generatingAnimation}
				{@render generatingAnimation()}
			{:else}
				<div class="flex items-center gap-2">
					<div class="text-surface-600-400 animate-pulse text-sm">
						Generating...
					</div>
					<div
						class="bg-primary-500 h-2 w-2 animate-bounce rounded-full"
					></div>
				</div>
			{/if}
		{:else if editChatMessage && editChatMessage.id === msg.id}
			<div
				class="chat-input-bar bg-surface-100-900 w-full rounded-xl p-2 pb-2 align-middle lg:pb-4"
			>
				<MessageComposer
					bind:markdown={editChatMessage.content}
					onSend={handleMessageUpdate}
				/>
			</div>
		{:else}
			<div
				class="rendered-chat-message-content {msg.isGenerating &&
				msg.content
					? 'animate-pulse'
					: ''}"
			>
				{@html renderMarkdownWithQuotedText(msg.content)}
			</div>
		{/if}
	</div>
</li>

<style lang="postcss">
	@reference "tailwindcss";

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
