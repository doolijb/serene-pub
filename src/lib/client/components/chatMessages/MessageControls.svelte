<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		msg: SelectChatMessage
		isLastMessage?: boolean
		canRegenerateLastMessage?: boolean
		editChatMessage?: SelectChatMessage
		hasGeneratingMessage?: boolean
		// Whether the current user owns the character/persona behind this
		// message (or is the chat owner, for character messages) — gates
		// edit/regenerate/continue/hide/delete. Defaults true for callers that
		// don't pass it (eg. assistant chats, which have no guest concept).
		canControl?: boolean
		// Event handlers
		onEditMessage: (e: Event, msg: SelectChatMessage) => void
		onHideMessage: (e: Event, msg: SelectChatMessage) => void
		onDeleteMessage: (e: Event, msg: SelectChatMessage) => void
		onRegenerateMessage: (e: Event, msg: SelectChatMessage) => void
		onAbortMessage: (e: Event, msg: SelectChatMessage) => void
		onBranchMessage?: (e: Event, msg: SelectChatMessage) => void
		onContinueMessage?: (e: Event, msg: SelectChatMessage) => void
		onStartSummarization?: (msg: SelectChatMessage) => void
		debugMeta?: Record<string, any> | null
		onShowDebugMeta?: (meta: Record<string, any>) => void
		// The "more actions" popover is opened/closed by the parent list so
		// only one message's menu is open at a time — see openMsgControlsMenu
		// in ChatMessage.svelte.
		open: boolean
		onOpenChange: (open: boolean) => void
	}

	let {
		msg,
		isLastMessage = false,
		canRegenerateLastMessage = false,
		editChatMessage,
		hasGeneratingMessage = false,
		canControl = true,
		onEditMessage,
		onHideMessage,
		onDeleteMessage,
		onRegenerateMessage,
		onAbortMessage,
		onBranchMessage,
		onContinueMessage,
		onStartSummarization,
		debugMeta = null,
		onShowDebugMeta = undefined,
		open,
		onOpenChange
	}: Props = $props()

	function closeMenu() {
		onOpenChange(false)
	}
</script>

<div role="group" aria-label="Message actions" class="ml-auto flex items-center gap-2">
	{#if msg.isGenerating}
		<button
			class="btn btn-sm preset-filled-error-500 h-min px-3 py-2 text-[1em] lg:px-2 lg:py-1"
			title="Stop Generation"
			onclick={(e) => onAbortMessage(e, msg)}
		>
			<Icons.Square size={16} />
			<span>Stop Generation</span>
		</button>
	{/if}
	<Popover
		{open}
		onOpenChange={(e) => onOpenChange(e.open)}
		positioning={{ placement: "bottom" }}
		triggerBase="btn btn-sm p-3 hover:bg-primary-600-400 {open ? 'bg-primary-600-400' : ''}"
		contentBase="card bg-primary-200-800 p-4 space-y-4 w-[min(90vw,320px)]"
		arrow
		arrowBackground="!bg-primary-200 dark:!bg-primary-800"
		triggerAriaLabel="Message options"
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
				{#if !!msg.characterId && isLastMessage && !msg.isGenerating}
					<button
						class="btn btn-sm msg-cntrl-icon hover:preset-filled-warning-500"
						title="Regenerate Response"
						disabled={!canRegenerateLastMessage || !canControl}
						onclick={(e) => { closeMenu(); onRegenerateMessage(e, msg) }}
					>
						<Icons.RefreshCw size={16} />
						<span>Regenerate Response</span>
					</button>
				{/if}
				{#if onContinueMessage && !!msg.characterId && isLastMessage && !msg.isGenerating && msg.content}
					<button
						class="btn btn-sm msg-cntrl-icon hover:preset-filled-primary-500"
						title="Continue Response"
						aria-label="Continue generating this response"
						disabled={!!editChatMessage || !canControl}
						onclick={(e) => { closeMenu(); onContinueMessage(e, msg) }}
					>
						<Icons.ArrowDown size={16} aria-hidden="true" />
						<span>Continue Response</span>
					</button>
				{/if}
				<button
					class="btn btn-sm msg-cntrl-icon hover:preset-filled-success-500"
					title="Edit Message"
					aria-label="Edit this message"
					disabled={!!editChatMessage || hasGeneratingMessage || msg.isHidden || !canControl}
					onclick={(e) => { closeMenu(); onEditMessage(e, msg) }}
				>
					<Icons.Edit size={16} aria-hidden="true" />
					<span>Edit Message</span>
				</button>
				{#if onBranchMessage}
					<button
						class="btn btn-sm msg-cntrl-icon hover:preset-filled-primary-500"
						title="Branch Chat"
						aria-label="Create a new chat branch from this message"
						disabled={!!editChatMessage || hasGeneratingMessage}
						onclick={(e) => { closeMenu(); onBranchMessage(e, msg) }}
					>
						<Icons.GitBranch size={16} aria-hidden="true" />
						<span>Branch Chat</span>
					</button>
				{/if}
				{#if onStartSummarization && !msg.isGenerating}
					<button
						class="btn btn-sm msg-cntrl-icon hover:preset-filled-warning-500"
						title="Select for Summarization"
						aria-label="Select this message for summarization"
						disabled={!!editChatMessage || hasGeneratingMessage}
						onclick={() => { closeMenu(); onStartSummarization!(msg) }}
					>
						<Icons.BookMarked size={16} aria-hidden="true" />
						<span>Select for Summarization</span>
					</button>
				{/if}
				{#if onShowDebugMeta && debugMeta && !msg.isGenerating}
					<button
						class="btn btn-sm msg-cntrl-icon hover:preset-filled-primary-500"
						title="View Prompt Details"
						onclick={() => { closeMenu(); onShowDebugMeta!(debugMeta!) }}
					>
						<Icons.Info size={16} />
						<span>Prompt Details</span>
					</button>
				{/if}
				<button
					class="btn btn-sm msg-cntrl-icon hover:preset-filled-secondary-500"
					class:preset-filled-secondary-500={msg.isHidden}
					title={msg.isHidden ? "Unhide Message" : "Hide Message"}
					aria-label={msg.isHidden ? "Unhide this message" : "Hide this message"}
					disabled={!!editChatMessage || hasGeneratingMessage || !canControl}
					onclick={(e) => { closeMenu(); onHideMessage(e, msg) }}
				>
					<Icons.Ghost size={16} aria-hidden="true" />
					<span>
						{msg.isHidden ? "Unhide Message" : "Hide Message"}
					</span>
				</button>
				<button
					class="btn btn-sm msg-cntrl-icon hover:preset-filled-error-500"
					title="Delete Message"
					aria-label="Delete this message"
					disabled={!!editChatMessage || hasGeneratingMessage || !canControl}
					onclick={(e) => { closeMenu(); onDeleteMessage(e, msg) }}
				>
					<Icons.Trash2 size={16} aria-hidden="true" />
					<span>Delete Message</span>
				</button>
			</article>
		{/snippet}
	</Popover>
</div>

<style lang="postcss">
	@reference "tailwindcss";

	.msg-cntrl-icon {
		@apply h-min w-full justify-start px-2 text-[1em] disabled:opacity-25;
	}
</style>
