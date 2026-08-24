<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		msg: SelectSessionMessage
		isLastMessage?: boolean
		canRegenerateLastMessage?: boolean
		editSessionMessage?: SelectSessionMessage
		hasGeneratingMessage?: boolean
		// Whether the current user owns the character/persona behind this
		// message (or is the session owner, for character messages) — gates
		// edit/regenerate/continue/hide/delete. Defaults true for callers that
		// don't pass it (eg. sessions with no guest concept).
		canControl?: boolean
		// Event handlers
		onEditMessage: (e: Event, msg: SelectSessionMessage) => void
		onHideMessage: (e: Event, msg: SelectSessionMessage) => void
		onDeleteMessage: (e: Event, msg: SelectSessionMessage) => void
		onRegenerateMessage: (e: Event, msg: SelectSessionMessage) => void
		onAbortMessage: (e: Event, msg: SelectSessionMessage) => void
		onBranchMessage?: (e: Event, msg: SelectSessionMessage) => void
		onContinueMessage?: (e: Event, msg: SelectSessionMessage) => void
		onStartSummarization?: (msg: SelectSessionMessage) => void
		debugMeta?: Record<string, any> | null
		onShowDebugMeta?: (meta: Record<string, any>) => void
		// The "more actions" popover is opened/closed by the parent list so
		// only one message's menu is open at a time — see openMsgControlsMenu
		// in SessionMessage.svelte.
		open: boolean
		onOpenChange: (open: boolean) => void
	}

	let {
		msg,
		isLastMessage = false,
		canRegenerateLastMessage = false,
		editSessionMessage,
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

<div role="group" aria-label="Message actions" class="flex items-center gap-2">
	{#if msg.isGenerating}
		<!-- Label is hidden below lg: so the button stays the same square box as
		     every other message control on mobile, where the extra ~110px would
		     wrap the header onto a second line mid-generation. aria-label covers
		     the icon-only case. -->
		<button
			class="btn msg-ctrl-btn-labeled preset-filled-error-500"
			title="Stop Generation"
			aria-label="Stop Generation"
			onclick={(e) => onAbortMessage(e, msg)}
		>
			<Icons.Square aria-hidden="true" />
			<span class="hidden lg:inline">Stop Generation</span>
		</button>
	{/if}
	<Popover
		{open}
		onOpenChange={(e) => onOpenChange(e.open)}
		positioning={{ placement: "bottom" }}
	>
		<Popover.Trigger
			class="btn msg-ctrl-btn hover:bg-primary-600-400 {open
				? 'bg-primary-600-400'
				: ''}"
			aria-label="Message options"
		>
			<Icons.EllipsisVertical aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-primary-200-800 w-[min(90vw,320px)] space-y-4 p-4"
				>
					<header class="popover-menu-title">
						<Icons.EllipsisVertical size={18} aria-hidden="true" />
						<p>Message Options</p>
					</header>
					<article class="flex flex-col gap-2">
						{#if (!!msg.characterId || msg.isNarratorResponse) && isLastMessage && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-warning-500"
								title="Regenerate Response"
								disabled={!canRegenerateLastMessage ||
									!canControl}
								onclick={(e) => {
									closeMenu()
									onRegenerateMessage(e, msg)
								}}
							>
								<Icons.RefreshCw size={16} />
								<span>Regenerate Response</span>
							</button>
						{/if}
						{#if onContinueMessage && (!!msg.characterId || msg.isNarratorResponse) && isLastMessage && !msg.isGenerating && msg.content}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								title="Continue Response"
								aria-label="Continue generating this response"
								disabled={!!editSessionMessage || !canControl}
								onclick={(e) => {
									closeMenu()
									onContinueMessage(e, msg)
								}}
							>
								<Icons.ArrowDown size={16} aria-hidden="true" />
								<span>Continue Response</span>
							</button>
						{/if}
						<button
							class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
							title="Edit Message"
							aria-label="Edit this message"
							disabled={!!editSessionMessage ||
								hasGeneratingMessage ||
								msg.isHidden ||
								!canControl}
							onclick={(e) => {
								closeMenu()
								onEditMessage(e, msg)
							}}
						>
							<Icons.Edit size={16} aria-hidden="true" />
							<span>Edit Message</span>
						</button>
						{#if onBranchMessage}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								title="Branch Session"
								aria-label="Create a new session branch from this message"
								disabled={!!editSessionMessage ||
									hasGeneratingMessage}
								onclick={(e) => {
									closeMenu()
									onBranchMessage(e, msg)
								}}
							>
								<Icons.GitBranch size={16} aria-hidden="true" />
								<span>Branch Session</span>
							</button>
						{/if}
						{#if onStartSummarization && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-warning-500"
								title="Select for Summarization"
								aria-label="Select this message for summarization"
								disabled={!!editSessionMessage ||
									hasGeneratingMessage}
								onclick={() => {
									closeMenu()
									onStartSummarization!(msg)
								}}
							>
								<Icons.BookMarked
									size={16}
									aria-hidden="true"
								/>
								<span>Select for Summarization</span>
							</button>
						{/if}
						{#if onShowDebugMeta && debugMeta && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								title="View Prompt Details"
								onclick={() => {
									closeMenu()
									onShowDebugMeta!(debugMeta!)
								}}
							>
								<Icons.Info size={16} />
								<span>Prompt Details</span>
							</button>
						{/if}
						<button
							class="btn btn-sm popover-menu-btn hover:preset-filled-secondary-500"
							class:preset-filled-secondary-500={msg.isHidden}
							title={msg.isHidden
								? "Unhide Message"
								: "Hide Message"}
							aria-label={msg.isHidden
								? "Unhide this message"
								: "Hide this message"}
							disabled={!!editSessionMessage ||
								hasGeneratingMessage ||
								!canControl}
							onclick={(e) => {
								closeMenu()
								onHideMessage(e, msg)
							}}
						>
							<Icons.Ghost size={16} aria-hidden="true" />
							<span>
								{msg.isHidden
									? "Unhide Message"
									: "Hide Message"}
							</span>
						</button>
						<button
							class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
							title="Delete Message"
							aria-label="Delete this message"
							disabled={!!editSessionMessage ||
								hasGeneratingMessage ||
								!canControl}
							onclick={(e) => {
								closeMenu()
								onDeleteMessage(e, msg)
							}}
						>
							<Icons.Trash2 size={16} aria-hidden="true" />
							<span>Delete Message</span>
						</button>
					</article>
					<Popover.Arrow>
						<Popover.ArrowTip
							class="!bg-primary-200 dark:!bg-primary-800"
						/>
					</Popover.Arrow>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
</div>
