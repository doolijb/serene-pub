<script lang="ts">
	import * as Icons from "@lucide/svelte"

	interface Props {
		msg: SelectChatMessage
		isLastMessage?: boolean
		canRegenerateLastMessage?: boolean
		editChatMessage?: SelectChatMessage
		hasGeneratingMessage?: boolean
		// Event handlers
		onEditMessage: (e: Event, msg: SelectChatMessage) => void
		onHideMessage: (e: Event, msg: SelectChatMessage) => void
		onDeleteMessage: (e: Event, msg: SelectChatMessage) => void
		onRegenerateMessage: (e: Event, msg: SelectChatMessage) => void
		onAbortMessage: (e: Event, msg: SelectChatMessage) => void
		onBranchMessage?: (e: Event, msg: SelectChatMessage) => void
		onContinueMessage?: (e: Event, msg: SelectChatMessage) => void
		onStartSummarization?: (msg: SelectChatMessage) => void
	}

	let {
		msg,
		isLastMessage = false,
		canRegenerateLastMessage = false,
		editChatMessage,
		hasGeneratingMessage = false,
		onEditMessage,
		onHideMessage,
		onDeleteMessage,
		onRegenerateMessage,
		onAbortMessage,
		onBranchMessage,
		onContinueMessage,
		onStartSummarization
	}: Props = $props()
</script>

<div
	role="group"
	aria-label="Message actions"
	class="flex flex-col gap-2 lg:flex-row"
>
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-secondary-500"
		class:preset-filled-secondary-500={msg.isHidden}
		title={msg.isHidden ? "Unhide Message" : "Hide Message"}
		aria-label={msg.isHidden ? "Unhide this message" : "Hide this message"}
		disabled={!!editChatMessage || hasGeneratingMessage}
		onclick={(e) => onHideMessage(e, msg)}
	>
		<Icons.Ghost size={16} aria-hidden="true" />
		<span class="lg:hidden">
			{msg.isHidden ? "Unhide Message" : "Hide Message"}
		</span>
	</button>
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
		title="Edit Message"
		aria-label="Edit this message"
		disabled={!!editChatMessage || hasGeneratingMessage || msg.isHidden}
		onclick={(e) => onEditMessage(e, msg)}
	>
		<Icons.Edit size={16} aria-hidden="true" />
		<span class="lg:hidden">Edit Message</span>
	</button>
	<button
		class="btn btn-sm msg-cntrl-icon hover:preset-filled-error-500"
		title="Delete Message"
		aria-label="Delete this message"
		disabled={!!editChatMessage || hasGeneratingMessage}
		onclick={(e) => onDeleteMessage(e, msg)}
	>
		<Icons.Trash2 size={16} aria-hidden="true" />
		<span class="lg:hidden">Delete Message</span>
	</button>
	{#if onBranchMessage}
		<button
			class="btn btn-sm msg-cntrl-icon hover:preset-filled-primary-500"
			title="Branch Chat"
			aria-label="Create a new chat branch from this message"
			disabled={!!editChatMessage || hasGeneratingMessage}
			onclick={(e) => onBranchMessage(e, msg)}
		>
			<Icons.GitBranch size={16} aria-hidden="true" />
			<span class="lg:hidden">Branch Chat</span>
		</button>
	{/if}
	{#if !!msg.characterId && isLastMessage && !msg.isGenerating}
		<button
			class="btn btn-sm msg-cntrl-icon hover:preset-filled-warning-500"
			title="Regenerate Response"
			disabled={!canRegenerateLastMessage}
			onclick={(e) => onRegenerateMessage(e, msg)}
		>
			<Icons.RefreshCw size={16} />
			<span class="lg:hidden">Regenerate Response</span>
		</button>
	{/if}
	{#if onContinueMessage && !!msg.characterId && isLastMessage && !msg.isGenerating && msg.content}
		<button
			class="btn btn-sm msg-cntrl-icon hover:preset-filled-primary-500"
			title="Continue Response"
			aria-label="Continue generating this response"
			disabled={!!editChatMessage}
			onclick={(e) => onContinueMessage(e, msg)}
		>
			<Icons.ArrowDown size={16} aria-hidden="true" />
			<span class="lg:hidden">Continue Response</span>
		</button>
	{/if}
	{#if msg.isGenerating}
		<button
			class="btn btn-sm msg-cntrl-icon preset-filled-error-500"
			title="Stop Generation"
			onclick={(e) => onAbortMessage(e, msg)}
		>
			<Icons.Square size={16} />
			<span class="lg:hidden">Stop Generation</span>
		</button>
	{/if}
	{#if onStartSummarization && !msg.isGenerating}
		<button
			class="btn btn-sm msg-cntrl-icon hover:preset-filled-warning-500"
			title="Select for Summarization"
			aria-label="Select this message for summarization"
			disabled={!!editChatMessage || hasGeneratingMessage}
			onclick={() => onStartSummarization!(msg)}
		>
			<Icons.BookMarked size={16} aria-hidden="true" />
			<span class="lg:hidden">Select for Summarization</span>
		</button>
	{/if}
</div>

<style lang="postcss">
	@reference "tailwindcss";

	.msg-cntrl-icon {
		@apply h-min px-2 text-[1em] disabled:opacity-25;
		@apply w-full justify-start lg:w-min;
	}
</style>
