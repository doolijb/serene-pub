<script lang="ts">
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import MessageComposer from "$lib/client/components/chatMessages/MessageComposer.svelte"
	import MessageControls from "$lib/client/components/chatMessages/MessageControls.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import { animateHeight } from "$lib/client/utils/motion"

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
		onEditMessage: (event: Event, msg: SelectChatMessage) => void
		onDeleteMessage: (event: Event, msg: SelectChatMessage) => void
		onHideMessage: (event: Event, msg: SelectChatMessage) => void
		onRegenerateMessage: (event: Event, msg: SelectChatMessage) => void
		onContinueMessage?: (event: Event, msg: SelectChatMessage) => void
		onAbortMessage: (event: Event, msg: SelectChatMessage) => void
		onBranchMessage?: (event: Event, msg: SelectChatMessage) => void
		onCharacterNameClick: (msg: SelectChatMessage) => void
		onAvatarClick: (
			char: SelectCharacter | SelectPersona | undefined
		) => void
		// Fired when an inline `![alt](url)` image rendered inside the
		// message content is clicked — opens it in a lightbox.
		onImageClick?: (src: string) => void
		// Method-shorthand (not arrow-type) syntax deliberately: these are wired
		// directly as `onclick={onCancelEditMessage}` below (invoked with the
		// click MouseEvent) but also invoked with zero args internally via
		// handleMessageUpdate()/MessageComposer's onSend. Real implementations
		// (eg. +page.svelte's handleCancelEditMessage/handleSaveEditMessage)
		// take the event to call stopPropagation(). Method-shorthand gives this
		// property bivariant parameter checking, which is what lets both a
		// zero-arg and an Event-taking callback satisfy it — an arrow-type
		// property (even with `e?: Event`) is checked strictly/contravariantly
		// and rejects one side or the other.
		onCancelEditMessage(e?: Event): void
		// Takes the edited content rather than reading it off `editChatMessage`
		// itself — this component only owns a local edit buffer, not
		// `editChatMessage` (a prop passed down from +page.svelte), so the
		// actual `editChatMessage.content` write happens in the real
		// implementation (+page.svelte's handleSaveEditMessage), which does
		// own that state.
		onSaveEditMessage(content: string, e?: Event): void
		// Tracks which message's "more actions" popover is open, so only one
		// is ever open at a time in a message list. No longer mobile-only —
		// the popover now replaces the always-visible desktop toolbar too.
		openMsgControlsMenu: number | undefined
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
		onImageClick,
		onCancelEditMessage,
		onSaveEditMessage,
		openMsgControlsMenu = $bindable(),
		editChatMessage,
		canRegenerateLastMessage,
		hasGeneratingMessage,
		isGuest,
		lastPersonaMessage,
		isSummarizationMode = false,
		isSelected = false,
		onStartSummarization,
		GeneratingAnimationComponent,
		messageControls
	}: Props = $props()

	// Derived values
	const character = $derived(getMessageCharacter(msg))
	const narratorDisplayName = $derived(
		msg.metadata?.narratorName || "Narrator"
	)
	const speakerDisplayName = $derived(
		msg.isNarratorResponse
			? narratorDisplayName
			: character
				? resolveCharacterName(character, "") || null
				: null
	)
	const isGreeting = $derived(!!msg.metadata?.isGreeting)
	const canControl = $derived(canControlMessage(msg))
	const showSwipes = $derived(showSwipeControls(msg, isGreeting))
	const canSwipeRightVal = $derived(canSwipeRight(msg, isGreeting))
	// Native model thinking (from Ollama think: true, etc.) — `thinking` is
	// written into chatMessages.metadata at runtime (see generateResponse.ts)
	// but isn't part of the column's `$type<{...}>()` declaration in
	// schema.ts, so it's genuinely absent from SelectChatMessage's inferred
	// type. `as any` here is the accurate escape hatch for that upstream gap.
	const thinkingContent = $derived((msg.metadata as any)?.thinking || "")
	const hasThinking = $derived(thinkingContent.trim().length > 0)

	// Optional per-trigger focus note for a Narrator response (e.g. "Focus on
	// the weather turning stormy") — set once at trigger time, see chats.ts's
	// narratorMessage.metadata.narratorInstructions.
	const narratorInstructionsContent = $derived(
		msg.metadata?.narratorInstructions || ""
	)
	const hasNarratorInstructions = $derived(
		narratorInstructionsContent.trim().length > 0
	)

	let isThinkingExpanded = $state(false)
	let isNarratorInstructionsExpanded = $state(false)

	// Local edit buffer: bound to MessageComposer instead of binding directly
	// into `editChatMessage.content` (a prop this component doesn't own) —
	// mutating it, even via plain assignment, trips Svelte's
	// ownership_invalid_mutation check. Handed to onSaveEditMessage at save
	// time so the actual write happens in the component that owns
	// editChatMessage (+page.svelte).
	let editContent = $state("")
	$effect(() => {
		if (editChatMessage) editContent = editChatMessage.content
	})

	const isEditing = $derived(!!editChatMessage && editChatMessage.id === msg.id)
	const isEditDirty = $derived(
		isEditing && editContent !== (editChatMessage?.content ?? "")
	)
	// Empty is blocked as well as unchanged: clearing a message to nothing
	// leaves an unreadable stub in the thread, and Delete is the control that
	// actually expresses that intent.
	const canSaveEdit = $derived(isEditDirty && editContent.trim().length > 0)

	function handleMessageUpdate(e?: Event) {
		if (!canSaveEdit) return
		onSaveEditMessage(editContent, e)
	}

	function toggleThinking() {
		isThinkingExpanded = !isThinkingExpanded
	}

	function toggleNarratorInstructions() {
		isNarratorInstructionsExpanded = !isNarratorInstructionsExpanded
	}

	// The rendered content below is raw injected HTML ({@html}), so inline
	// `![alt](url)` images can't get their own Svelte click handler —
	// delegate from the container instead.
	function handleContentClick(e: MouseEvent) {
		const target = e.target as HTMLElement
		if (target.tagName === "IMG") {
			onImageClick?.((target as HTMLImageElement).src)
		}
	}
</script>

<!-- A <div>, not an <li>: ChatContainer already wraps each message in its own
     <li> (the scene-bar row), so an <li> here nested a list item inside a list
     item — invalid HTML that confuses assistive-tech list semantics. The
     role="article" below is what actually carries the semantics. -->
<div
	id="message-{msg.id}"
	class="{isSummarizationMode
		? isSelected
			? 'preset-filled-secondary-100-900'
			: 'preset-tonal-surface opacity-60'
		: 'preset-filled-primary-50-950'} {isEditing
		? 'ring-warning-500/70 shadow-lg ring-2'
		: ''} flex flex-col rounded-lg p-2 transition-colors duration-150"
	class:opacity-50={!isSummarizationMode && msg.isHidden && !isEditing}
	tabindex="-1"
	role="article"
	aria-label="Message {index + 1} of {chat.chatMessages
		.length} from {msg.isNarratorResponse
		? narratorDisplayName
		: resolveCharacterName(character, 'Unknown')}: {msg.content.slice(
		0,
		100
	)}{msg.content.length > 100 ? '...' : ''}"
>
	<div class="flex items-start justify-between gap-2">
		<div class="group flex min-w-0 flex-1 gap-2">
			<!-- `flex` rather than the default inline formatting context: the
			     avatar button is inline-block, so in a block wrapper it sat on a
			     text baseline and left ~6px of descender space underneath. That
			     padded every character message's header to 70px against a
			     narrator message's 64px, for no visible reason. -->
			<span class="flex shrink-0">
				{#if msg.isNarratorResponse}
					<span
						class="bg-primary-500/10 text-primary-500 flex h-12 w-12 items-center justify-center rounded-full lg:h-[4em] lg:w-[4em]"
						title={narratorDisplayName}
					>
						<Icons.CloudSun size="1.5em" />
					</span>
				{:else}
					<!-- Make avatar clickable -->
					<button
						class="m-0 w-fit p-0"
						onclick={() => onAvatarClick(character)}
						title="View Avatar"
					>
						<Avatar
							char={character || undefined}
							size="w-12 h-12 lg:w-[4em] lg:h-[4em]"
						/>
					</button>
				{/if}
			</span>
			<div class="flex min-w-0 flex-1 flex-col">
				<!-- msg-ctrl-row pins this line to exactly one control-height and
				     centers its contents, so the name's optical center lands on
				     the same y as the "..." button's. This replaces the two `mt-1`
				     nudges that used to fake it for the adjacent icons only. -->
				<span class="msg-ctrl-row min-w-0 gap-1">
					{#if msg.isNarratorResponse}
						<span
							class="funnel-display mx-0 min-w-0 truncate px-0 text-[1.1em] font-bold"
							title={narratorDisplayName}
						>
							{narratorDisplayName}
						</span>
					{:else}
						<button
							class="funnel-display mx-0 min-w-0 truncate px-0 text-[1.1em] font-bold hover:underline"
							onclick={(e) => onCharacterNameClick(msg)}
							title={resolveCharacterName(character, "Unknown")}
						>
							{resolveCharacterName(character, "Unknown")}
						</button>
					{/if}
					{#if isGreeting}
						<span
							class="text-muted inline-flex shrink-0 items-center text-xs opacity-50"
							title="Greeting message"
						>
							<Icons.Handshake size={16} aria-hidden="true" />
						</span>
					{/if}
					<!-- No wrapper element: EmbeddingStatusIcon renders nothing at
					     all when status is hidden/none (the common case), and a
					     wrapper would still consume a gap-1 for an empty span. Its
					     own root already carries inline-flex/items-center/shrink-0. -->
					<EmbeddingStatusIcon embeddingModel={msg.embeddingModel} />
					{#if isEditing}
						<!-- Carries the state in words, not just colour — the
						     ring around the card is the fast visual cue, this
						     is what makes it unambiguous (and announceable). -->
						<span
							class="preset-tonal-warning text-warning-800-200 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide uppercase"
						>
							<Icons.Pencil size={11} aria-hidden="true" />
							Editing
							{#if isEditDirty}
								<span
									class="bg-warning-500 h-1.5 w-1.5 rounded-full"
									title="Unsaved changes"
									aria-label="Unsaved changes"
								></span>
							{/if}
						</span>
					{/if}
				</span>
			</div>
		</div>

		{#if isEditing}
			<div class="msg-ctrl-col">
				<!-- msg-ctrl-btn-labeled, not msg-ctrl-btn: it is the same
				     fixed box on mobile (so the header height contract in
				     app.css holds) and only widens to fit the word on lg.
				     Icon-only Save/Cancel gave the two most consequential
				     buttons in the app the least identity. -->
				<div class="msg-ctrl-row justify-end gap-2">
					<button
						class="btn msg-ctrl-btn-labeled preset-tonal-surface"
						title="Cancel edit (Esc)"
						aria-label="Cancel edit"
						onclick={onCancelEditMessage}
					>
						<Icons.X aria-hidden="true" />
						<span class="hidden text-sm lg:inline">Cancel</span>
					</button>
					<button
						class="btn msg-ctrl-btn-labeled preset-filled-success-500"
						title={canSaveEdit
							? "Save changes (Ctrl+Enter)"
							: isEditDirty
								? "A message can't be saved empty"
								: "No changes to save"}
						aria-label="Save edit"
						disabled={!canSaveEdit}
						onclick={handleMessageUpdate}
					>
						<Icons.Save aria-hidden="true" />
						<span class="hidden text-sm lg:inline">Save</span>
					</button>
				</div>
			</div>
		{:else}
			<div class="msg-ctrl-col">
				<div class="msg-ctrl-row flex-wrap justify-end gap-2">
					{#if messageControls}
						{@render messageControls(msg)}
					{:else}
						<MessageControls
							{msg}
							{isLastMessage}
							{canRegenerateLastMessage}
							{editChatMessage}
							{hasGeneratingMessage}
							{canControl}
							{onEditMessage}
							{onHideMessage}
							{onDeleteMessage}
							{onRegenerateMessage}
							{onContinueMessage}
							{onAbortMessage}
							{onBranchMessage}
							{onStartSummarization}
							open={openMsgControlsMenu === msg.id}
							onOpenChange={(isOpen) =>
								(openMsgControlsMenu = isOpen
									? msg.id
									: undefined)}
						/>
					{/if}
				</div>
				{#if showSwipes}
					<div class="msg-ctrl-row justify-end gap-2">
						{#if msg.metadata?.swipes?.currentIdx !== null && msg.metadata?.swipes?.currentIdx !== undefined && msg.metadata?.swipes?.history && msg.metadata?.swipes.history.length > 1}
							<button
								class="btn msg-ctrl-btn hover:preset-tonal-success"
								title="Swipe Left"
								aria-label="Previous swipe"
								onclick={() => onSwipeLeft(msg)}
								disabled={!!editChatMessage ||
									!msg.metadata.swipes.currentIdx ||
									msg.metadata.swipes.history.length <= 1 ||
									msg.isGenerating ||
									!canControl}
							>
								<Icons.ChevronLeft aria-hidden="true" />
							</button>
							<!-- tabular-nums + a min width so stepping 9/12 -> 10/12
							     doesn't shove the arrows sideways. -->
							<span
								class="text-surface-700-300 min-w-[3.5ch] text-center text-sm tabular-nums select-none"
								aria-live="polite"
							>
								{(msg.metadata.swipes.currentIdx || 0) + 1}/{msg
									.metadata.swipes.history.length}
							</span>
						{/if}
						<button
							class="btn msg-ctrl-btn hover:preset-tonal-success"
							title="Swipe Right"
							aria-label="Next swipe"
							onclick={() => onSwipeRight(msg)}
							disabled={!!editChatMessage ||
								!canSwipeRightVal ||
								!canControl}
						>
							<Icons.ChevronRight aria-hidden="true" />
						</button>
					</div>
				{:else if isLastMessage}
					<!-- Hold the swipe row's space on the last message only. That
					     is the one place showSwipes still toggles (it follows
					     canRegenerateLastMessage, so it flips off during
					     generation and back on after), and reserving it there
					     stops the message resizing under the reader. Reserving on
					     every message instead would add a dead row to the whole
					     backlog to fix a pop that can no longer happen there. -->
					<div class="msg-ctrl-row" aria-hidden="true"></div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Extra instructions block (Narrator's optional per-trigger focus note) -->
	{#if hasNarratorInstructions}
		<div class="mx-2 mt-2">
			<button
				class="flex w-full items-center gap-2 py-2 text-sm opacity-70 transition-opacity hover:opacity-100"
				onclick={toggleNarratorInstructions}
				title={isNarratorInstructionsExpanded
					? "Collapse extra instructions"
					: "Expand extra instructions"}
				aria-expanded={isNarratorInstructionsExpanded}
				aria-controls="extra-instructions-{msg.id}"
			>
				<Icons.Target size={16} aria-hidden="true" />
				<span>Extra Instructions</span>
				<Icons.ChevronDown
					size={16}
					aria-hidden="true"
					class={`transition-transform ${isNarratorInstructionsExpanded ? "rotate-180" : ""}`}
				/>
			</button>
			<!-- grid 0fr -> 1fr is the only way to transition to/from an auto
			     height in pure CSS. The inner overflow-hidden wrapper is
			     required: the track collapses to 0 but the content keeps its
			     intrinsic height, so without it the text spills out. Content
			     stays mounted while collapsed (rather than the old {#if})
			     because a transition needs both endpoints to exist — hence
			     `inert`, since a 0fr track still contains focusable content. -->
			<div
				id="extra-instructions-{msg.id}"
				class="grid transition-[grid-template-rows] duration-200 ease-out"
				style:grid-template-rows={isNarratorInstructionsExpanded
					? "1fr"
					: "0fr"}
				inert={!isNarratorInstructionsExpanded}
			>
				<div class="overflow-hidden">
					<div
						class="rendered-chat-message-content pb-2 text-sm opacity-80"
					>
						{@html renderMarkdownWithQuotedText(
							narratorInstructionsContent
						)}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Thinking block (native model thinking, e.g. Ollama think: true) -->
	{#if hasThinking}
		<div class="mx-2 mt-2">
			<button
				class="flex w-full items-center gap-2 py-2 text-sm opacity-70 transition-opacity hover:opacity-100"
				onclick={toggleThinking}
				title={isThinkingExpanded
					? "Collapse thinking"
					: "Expand thinking"}
				aria-expanded={isThinkingExpanded}
				aria-controls="thinking-{msg.id}"
			>
				<Icons.BrainCircuit size={16} aria-hidden="true" />
				<span>Thinking</span>
				<Icons.ChevronDown
					size={16}
					aria-hidden="true"
					class={`transition-transform ${isThinkingExpanded ? "rotate-180" : ""}`}
				/>
			</button>
			<!-- See the Extra Instructions block above for why this is a grid
			     rather than an {#if}. -->
			<div
				id="thinking-{msg.id}"
				class="grid transition-[grid-template-rows] duration-200 ease-out"
				style:grid-template-rows={isThinkingExpanded ? "1fr" : "0fr"}
				inert={!isThinkingExpanded}
			>
				<div class="overflow-hidden">
					<div
						class="rendered-chat-message-content pb-2 text-sm opacity-80"
					>
						{@html renderMarkdownWithQuotedText(thinkingContent)}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Padding-free wrapper whose only job is to carry the height animation —
	     see animateHeight, which observes the child and drives this element.
	     Disabled while generating: during streaming the height changes on every
	     token, and an animation would trail the text permanently instead of
	     settling. The discrete swaps are what this is for — swiping between
	     alternatives, entering/leaving edit, an error card replacing content. -->
	<div
		use:animateHeight={{
			enabled: !msg.isGenerating,
			scrollContainer: "#chat-history"
		}}
	>
		<div class="flex h-fit rounded p-2 text-left">
			{#if msg.error}
				{#if msg.content}
					<div class="rendered-chat-message-content mb-2">
						{@html renderMarkdownWithQuotedText(msg.content)}
					</div>
				{/if}
				<div
					class="border-error-500 bg-error-500/10 flex w-full flex-col gap-2 rounded-lg border p-3"
				>
					<div class="text-error-700-300 flex items-center gap-2">
						<Icons.AlertTriangle size={16} />
						<span class="text-sm font-medium">
							{msg.error.message}
						</span>
						{#if msg.error.code}
							<span class="text-xs opacity-60">
								({msg.error.code})
							</span>
						{/if}
					</div>
					<button
						class="btn preset-filled-primary-500 btn-sm w-fit"
						onclick={(e) => onRegenerateMessage(e, msg)}
					>
						<Icons.RotateCcw size={14} />
						Retry
					</button>
				</div>
			{:else if msg.content === "" && msg.isGenerating}
				{#if msg.generationStage === "queued"}
					<div class="flex items-center gap-2">
						<div class="text-surface-700-300 text-sm">Queued</div>
						<div
							class="bg-surface-400-600 h-2 w-2 rounded-full"
						></div>
					</div>
				{:else if msg.generationStage === "loading"}
					<div class="flex items-center gap-2">
						<div class="text-surface-700-300 text-sm">
							Loading model…
						</div>
						<div
							class="bg-surface-400-600 h-2 w-2 animate-pulse rounded-full"
						></div>
					</div>
				{:else if GeneratingAnimationComponent}
					{@render GeneratingAnimationComponent()}
				{:else}
					<div class="flex items-center gap-2">
						<div class="text-surface-600-400 animate-pulse text-sm">
							{speakerDisplayName
								? `${speakerDisplayName} is typing...`
								: "Typing..."}
						</div>
						<div
							class="bg-primary-500 h-2 w-2 animate-bounce rounded-full"
						></div>
					</div>
				{/if}
			{:else if isEditing}
				<!-- One surface, not three. This used to be a rounded-xl
				     `bg-surface-100-900` panel nested in the rounded-lg message
				     card, wrapping a bordered `input` textarea with a third
				     background — three radii and three fills stacked inside
				     each other. The panel now *is* the field: the textarea
				     below drops its own border, radius and fill (see
				     `edit-field`) and simply lays text on this one. -->
				<div
					class="edit-surface bg-surface-100-900 w-full rounded-lg px-2 pt-0.5 pb-1"
				>
					<MessageComposer
						bind:markdown={editContent}
						onSend={handleMessageUpdate}
						onCancel={() => onCancelEditMessage()}
						enterBehavior="newline"
						placeholder="Edit this message…"
						autofocus
						textareaClasses="edit-field field-sizing-content w-full"
					/>
					<!-- Transient, unlike the chat bar's — it only exists while
					     an edit is open, so it can't become the permanent noise
					     that hint was deliberately removed from below. -->
					<div
						class="text-surface-600-400 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-xs"
					>
						<span>
							<kbd class="kbd-hint">Ctrl</kbd>
							+
							<kbd class="kbd-hint">Enter</kbd>
							to save
						</span>
						<span aria-hidden="true" class="opacity-40">·</span>
						<span>
							<kbd class="kbd-hint">Esc</kbd>
							to cancel
						</span>
						{#if isEditDirty}
							<span class="text-warning-600-400 ml-auto font-medium">
								Unsaved changes
							</span>
						{/if}
					</div>
				</div>
			{:else}
				<!-- Click delegation only matters for the inline `<img>` tags
			     inside the rendered markdown, which are individually
			     cursor-pointer and already reachable/described via normal
			     image semantics (alt text) — the div itself is a passive
			     text container, not a single interactive control. -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="rendered-chat-message-content {msg.isGenerating &&
					msg.content
						? 'animate-pulse'
						: ''}"
					onclick={handleContentClick}
				>
					{@html renderMarkdownWithQuotedText(msg.content)}
				</div>
			{/if}
		</div>
	</div>
</div>

<style lang="postcss">
	@reference "tailwindcss";

	/* --- Edit mode --- */

	/* The textarea is a child of MessageComposer, so this has to cross the
	   component boundary — but it stays anchored to `.edit-surface` so it can
	   only ever reach the edit composer's field, never the chat bar's.

	   Every declaration here is colourless on purpose: Skeleton registers its
	   palette through `@theme` in app.css, which a component's
	   `@reference "tailwindcss"` does not pull in, so `@apply bg-warning-500`
	   and friends would fail to resolve at build time. Colour for edit mode is
	   applied as ordinary utility classes in the markup above. */
	.edit-surface :global(.edit-field) {
		background: transparent;
		border: none;
		border-radius: 0;
		padding: 0.5rem 0.25rem;
		color: inherit;
		font: inherit;
		line-height: 1.6;

		/* The native grabber is redundant under `field-sizing-content` (the
		   field already grows to fit) and dragging it only desynchronised the
		   box from its content. */
		resize: none;

		/* Without a cap, editing a long message grew the card unbounded and
		   pushed Save/Cancel — which live in the header — off the top of the
		   viewport. */
		max-height: 45vh;
		overflow-y: auto;

		&:focus {
			outline: none;
			box-shadow: none;
		}

		/* Mouse focus needs no ring — the card's own ring already says which
		   message is open. This is only for keyboard users tabbing back in
		   from Cancel/Save, who would otherwise get no landing cue at all
		   beyond the caret. color-mix keeps it palette-free. */
		&:focus-visible {
			outline: 2px solid color-mix(in srgb, currentColor 30%, transparent);
			outline-offset: -2px;
			border-radius: 0.375rem;
		}

		&::placeholder {
			color: inherit;
			opacity: 0.45;
		}
	}

	/* currentColor keeps these legible in both themes without naming a palette
	   entry (see the note above about `@theme` not being in scope here). */
	.kbd-hint {
		display: inline-block;
		padding: 0.05rem 0.3rem;
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		font-family: inherit;
		font-size: 0.9em;
		line-height: 1.4;
		opacity: 0.75;
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
</style>
