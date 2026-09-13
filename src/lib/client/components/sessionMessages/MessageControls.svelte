<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"

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
		// Why Continue is unavailable in this session, when it is — the
		// connection cannot resume a partial reply, or the mode does not offer
		// the verb. DISABLED and explained rather than hidden: a control that
		// vanishes teaches nothing, and this sentence names the switch to change
		// and where it lives. Session-level, so it arrives once (sessions:view)
		// rather than being asked per message.
		//
		// ⚠ It reaches the accessible name as well as the tooltip, not
		// `aria-description`: that attribute is not supported on the implicit
		// `button` role (svelte-check fails the build on it), and a `title` is
		// not reliably announced — least of all on a disabled control, which a
		// screen reader may skip entirely.
		continueRefusal?: string
		onStartSummarization?: (msg: SelectSessionMessage) => void
		// The contributed menu-trigger set (19 §4, `kind: 'menu'`): presence
		// is rows, so a retired contributor takes its entry with it. Fired
		// with this message as the subject.
		menuTriggers?: Array<{
			function: string
			name: string
			icon?: string
			specSlug: string
		}>
		onFireTrigger?: (fn: string, msg: SelectSessionMessage) => void
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
		continueRefusal = undefined,
		onStartSummarization,
		menuTriggers = [],
		onFireTrigger = undefined,
		debugMeta = null,
		onShowDebugMeta = undefined,
		open,
		onOpenChange
	}: Props = $props()

	function closeMenu() {
		onOpenChange(false)
	}

	/* ── which run produced this reply ──────────────────────────────────
	 *
	 * A message is linked to a run through `pipeline_run_artifacts`, read by
	 * `pipelines:artifactRuns` — a message can be the artifact of several runs
	 * (regenerated, continued), and the one worth explaining is the one that
	 * sent something, so a non-preview wins over a newer preview.
	 *
	 * Asked only while this menu is OPEN, and only for a reply. One message's
	 * menu is open at a time (the list enforces it), so this is one listener
	 * and one query rather than one per message in the thread.
	 */

	const socket = useTypedSocket()
	const isReply = $derived(!!msg.characterId || !!msg.isNarratorResponse)
	let runId = $state<string | null>(null)
	/** Plain, not `$state`: the effect writes it and must not depend on it. */
	let askedFor: number | null = null

	const onArtifactRuns = (res: Sockets.Pipelines.ArtifactRuns.Response) => {
		if (res.kind !== "message" || res.entityId !== msg.id) return
		runId =
			res.runs.find((r) => !r.isPreview)?.runId ??
			res.runs[0]?.runId ??
			null
	}

	$effect(() => {
		if (!open || !isReply) return
		socket.on("pipelines:artifactRuns", onArtifactRuns)
		if (askedFor !== msg.id) {
			askedFor = msg.id
			runId = null
			socket.emit("pipelines:artifactRuns", {
				kind: "message",
				entityId: msg.id
			})
		}
		// Named handler, always: `off(event)` with no handler removes every
		// listener on that event, app-wide.
		return () => socket.off("pipelines:artifactRuns", onArtifactRuns)
	})

	/** `book-open-text` → `BookOpenText`, resolved against the lucide set. */
	function triggerIcon(name?: string) {
		const pascal = (name ?? "")
			.split("-")
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join("")
		return (Icons as any)[pascal] ?? Icons.Play
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
								title={continueRefusal ?? "Continue Response"}
								aria-label={continueRefusal
									? `Continue generating this response — unavailable. ${continueRefusal}`
									: "Continue generating this response"}
								disabled={!!editSessionMessage ||
									!canControl ||
									!!continueRefusal}
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
						{#if runId && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
								title="See what the pipeline did for this reply"
								onclick={() => {
									closeMenu()
									runInspector.open(runId!)
								}}
							>
								<Icons.Receipt size={16} aria-hidden="true" />
								<span>Inspect run</span>
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
						{#if onFireTrigger && menuTriggers.length && !msg.isGenerating}
							<!-- The contributed entries (19 §4): after core's
							     actions, separated so a plugin's verb never
							     reads as one of core's. -->
							<hr class="hr" />
							{#each menuTriggers as t (t.specSlug + t.function)}
								{@const TriggerIconComponent = triggerIcon(
									t.icon
								)}
								<button
									class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
									title={t.name}
									disabled={!!editSessionMessage ||
										hasGeneratingMessage}
									onclick={() => {
										closeMenu()
										onFireTrigger!(t.function, msg)
									}}
								>
									<TriggerIconComponent
										size={16}
										aria-hidden="true"
									/>
									<span>{t.name}</span>
								</button>
							{/each}
						{/if}
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
