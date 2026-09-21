<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { runInspector } from "$lib/client/stores/runInspector.svelte"
	import { actionIcon } from "$lib/client/components/sessionMessages/actionIcon"
	import {
		coreVerbState,
		verbKeyOf,
		verdictOf,
		type VerbContext
	} from "$lib/client/components/sessionMessages/messageVerbState"
	import { actionIdentity } from "$lib/shared/actions/identity"

	interface Props {
		msg: SelectSessionMessage
		isLastMessage?: boolean
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
		// ⚠ It reaches assistive tech through `aria-describedby` → an sr-only
		// note beside the row, plus the tooltip — the chips' shape (UI nit 2)
		// — not `aria-description`: that attribute is not supported on the
		// implicit `button` role (svelte-check fails the build on it), and a
		// `title` is not reliably announced. The row is `aria-disabled`, not
		// `disabled`, for the same reason the chips are: a natively disabled
		// control is skipped and says nothing.
		continueRefusal?: string
		/**
		 * The `message` venue of `sessions:actions` (R-15, U5c): every verb
		 * this session offers on a message, core's and contributed alike, in
		 * a primary set and an overflow. The ⋮ menu lists the lot — nothing
		 * is reachable only by hovering — and the quick row draws the primary
		 * set. Core's verbs (`specSlug: "core"`) map to the handlers below;
		 * a contributed one fires through `onFireTrigger` with this message
		 * as the subject. Absent (an older server, a standalone mount) reads
		 * as the floors alone.
		 */
		messageActions?: {
			primary: Sockets.Sessions.Actions.Action[]
			overflow: Sockets.Sessions.Actions.Action[]
		}
		onSwipeMessage?: (e: Event, msg: SelectSessionMessage) => void
		onStartSummarization?: (msg: SelectSessionMessage) => void
		/**
		 * A contributed action pressed on this message — the whole
		 * declaration, so the fire can name its identity (W1), with this
		 * message as the subject.
		 */
		onFireTrigger?: (
			action: Sockets.Sessions.Actions.Action,
			msg: SelectSessionMessage
		) => void
		/** The person opened a list showing these newcomers (`sessions:actionsSeen`). */
		onActionsSeen?: (keys: string[]) => void
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
		messageActions = undefined,
		onSwipeMessage = undefined,
		onStartSummarization,
		onFireTrigger = undefined,
		onActionsSeen = undefined,
		debugMeta = null,
		onShowDebugMeta = undefined,
		open,
		onOpenChange
	}: Props = $props()

	function closeMenu() {
		onOpenChange(false)
	}

	/**
	 * The floors, for a mount with no list: stop, edit and branch are present
	 * in every genre, and a server too old to send the list still offers them.
	 */
	const FLOORS: Sockets.Sessions.Actions.Action[] = [
		{ key: "stop", name: "Stop generating", icon: "square", quick: true },
		{ key: "edit", name: "Edit", icon: "pencil", quick: true },
		{ key: "branch", name: "Branch from here", icon: "git-branch", quick: false }
	].map((a) => ({
		...a,
		specSlug: "core",
		slash: a.key,
		audience: { see: ["participant"], act: ["item"] },
		venue: "message",
		origin: "core" as const,
		floor: true,
		canAct: true,
		itemGated: a.key !== "branch",
		isNew: false,
		enabled: true
	}))

	/** The whole list, primary first — the menu is the complete list. */
	const listed = $derived(
		messageActions
			? [...messageActions.primary, ...messageActions.overflow]
			: FLOORS
	)

	/** This message's state, for the verb table. */
	const verbCtx = $derived<
		Omit<VerbContext, "canAct" | "itemGated" | "action" | "enabled" | "reason" | "itemPredicates">
	>({
		msg,
		isLastMessage,
		editing: !!editSessionMessage,
		hasGeneratingMessage,
		canControl,
		continueRefusal
	})
	// `itemGated` rides with `canAct` (W6): a contributed action whose
	// audience is `item` was answered `true` ahead of any message, and this
	// message's ownership rule is what decides. The enabled-when verdict
	// rides beside them (U5e): the list's `enabled`/`reason`, and the
	// `item.*` predicates this row is judged against.
	const stateOf = (a: Sockets.Sessions.Actions.Action) =>
		coreVerbState(verbKeyOf(a), { ...verbCtx, ...verdictOf(a) })

	/** The rows the menu draws: shown by the table, core's before contributed. */
	const rows = $derived(
		listed
			.map((a) => ({ action: a, state: stateOf(a) }))
			.filter((r) => r.state.shown)
	)
	const coreRows = $derived(rows.filter((r) => r.action.specSlug === "core"))
	const contributedRows = $derived(
		rows.filter((r) => r.action.specSlug !== "core")
	)
	const hasNew = $derived(contributedRows.some((r) => r.action.isNew))

	/** Fire a core verb by its key, through the handler the page wired. */
	function fireCore(e: Event, key: string) {
		closeMenu()
		switch (key) {
			case "stop":
				return onAbortMessage(e, msg)
			case "retry":
				return onRegenerateMessage(e, msg)
			case "continue":
				return onContinueMessage?.(e, msg)
			case "edit":
				return onEditMessage(e, msg)
			case "branch":
				return onBranchMessage?.(e, msg)
			case "swipe":
				return onSwipeMessage?.(e, msg)
			case "hide":
				return onHideMessage(e, msg)
			case "delete":
				return onDeleteMessage(e, msg)
		}
	}

	/** The row's name: the verb, with hide's read off the message's state. */
	function nameOf(a: Sockets.Sessions.Actions.Action) {
		return a.key === "hide" && a.specSlug === "core"
			? msg.isHidden
				? "Unhide"
				: "Hide"
			: a.name
	}
	/**
	 * The tooltip for one row, the chips' shape: the name, then the reason
	 * when it is grey (UI nit 2). The reason also reaches assistive tech
	 * through `aria-describedby` → an sr-only note, so the accessible NAME
	 * stays the verb — a name that also carries the reason is read twice.
	 */
	const titleOf = (a: Sockets.Sessions.Actions.Action, reason?: string) =>
		reason ? `${nameOf(a)} — ${reason}` : nameOf(a)
	/** One note id per row; the identity's punctuation is not an id's. */
	const noteIdOf = (a: Sockets.Sessions.Actions.Action) =>
		`msg-${msg.id}-note-${actionIdentity(a).replace(/[^a-z0-9-]/g, "-")}`
	const itemClass = (a: Sockets.Sessions.Actions.Action) =>
		"btn btn-sm popover-menu-btn hover:preset-tonal-surface" +
		(a.key === "delete" && a.specSlug === "core"
			? " text-error-600-400"
			: "") +
		(a.key === "stop" && a.specSlug === "core" ? " text-error-600-400" : "")

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
		// The run that WROTE the reply — a built-in's run (an edit, a hide;
		// R-15) is the newest one naming the row after a person touched it,
		// and its receipt has no prompt to explain.
		const wrote = (r: { actions?: string[] }) =>
			!r.actions ||
			r.actions.some((a) => a === "created" || a === "updated")
		runId =
			res.runs.find((r) => !r.isPreview && wrote(r))?.runId ??
			res.runs.find((r) => !r.isPreview)?.runId ??
			res.runs[0]?.runId ??
			null
	}

	/**
	 * The interest is declared for as long as the menu is open, and the request
	 * only when the message under it changed — which is where the raw listener
	 * and the emit already sat.
	 *
	 * `declareInterest` rather than `requestWithInterest`: this effect re-runs
	 * whenever the parent hands down a fresh `msg` object, and a request-shaped
	 * interest would be released on that re-run without being re-declared (the
	 * ask is guarded by `askedFor`), losing a reply still in flight. Declaring
	 * first and emitting second keeps ruling 3 either way — the typed `emit`
	 * flushes the pending interest sync before the packet leaves.
	 *
	 * BARE: `pipelines:artifactRuns` has no entry in `SCOPED_EVENTS`, and
	 * `onArtifactRuns`'s own kind/entity check stays the filter.
	 */
	$effect(() => {
		if (!open || !isReply) return
		const release = declareInterest<"pipelines:artifactRuns">(
			"pipelines:artifactRuns",
			onArtifactRuns
		)
		if (askedFor !== msg.id) {
			askedFor = msg.id
			runId = null
			socket.emit("pipelines:artifactRuns", {
				kind: "message",
				entityId: msg.id
			})
		}
		return release
	})

	/**
	 * The mark clears the moment the menu that lists the newcomers opens:
	 * the person has now met them.
	 */
	$effect(() => {
		if (!open || !hasNew || !onActionsSeen) return
		onActionsSeen(
			contributedRows
				.filter((r) => r.action.isNew)
				.map((r) => actionIdentity(r.action))
		)
	})
</script>

<!-- The ⋮ menu: every action this message offers, named in words. The row's
     quick icons call the same handlers; this is the complete list. -->
<div class="sp-msg-menu-root">
	<Popover
		{open}
		onOpenChange={(e) => onOpenChange(e.open)}
		positioning={{ placement: "bottom-end" }}
	>
		<Popover.Trigger
			class="sp-msg-icon-btn"
			aria-label="Message options"
			aria-expanded={open}
		>
			<Icons.EllipsisVertical size={16} aria-hidden="true" />
		</Popover.Trigger>
		<Portal>
			<Popover.Positioner class="z-[1000]!">
				<Popover.Content
					class="card bg-surface-200-800 w-[min(90vw,320px)] space-y-4 p-4"
				>
					<header class="popover-menu-title">
						<Icons.EllipsisVertical size={18} aria-hidden="true" />
						<p>Message options</p>
					</header>
					<article class="flex flex-col gap-2">
						<!-- Core's verbs, from the list (R-15, U5c): every one
						     the session offers on this message, primary set
						     first, then the overflow — nothing is reachable
						     only by hovering. Disabled and explained rather
						     than hidden where the message's own state says no. -->
						<!-- Greyed, not disabled, like the chips (S6): `aria-disabled`
						     keeps the row reachable and the reason reaches a screen
						     reader through `aria-describedby`; a native `disabled`
						     is skipped and says nothing. The click is guarded. -->
						{#each coreRows as { action, state } (action.key)}
							{@const Icon = actionIcon(action.icon)}
							<button
								class={itemClass(action)}
								class:preset-tonal-surface={action.key ===
									"hide" && msg.isHidden}
								class:opacity-60={state.disabled}
								class:cursor-not-allowed={state.disabled}
								title={titleOf(action, state.reason)}
								aria-pressed={action.key === "hide"
									? !!msg.isHidden
									: undefined}
								aria-disabled={state.disabled}
								aria-describedby={state.reason
									? noteIdOf(action)
									: undefined}
								onclick={(e) =>
									state.disabled
										? e.preventDefault()
										: fireCore(e, action.key)}
							>
								<Icon size={16} aria-hidden="true" />
								<span>{nameOf(action)}</span>
							</button>
							{#if state.reason}
								<span id={noteIdOf(action)} class="sr-only">
									{state.reason}
								</span>
							{/if}
						{/each}
						{#if onStartSummarization && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="Select for summary"
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
								<span>Select for summary</span>
							</button>
						{/if}
						{#if runId && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
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
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="Prompt details"
								onclick={() => {
									closeMenu()
									onShowDebugMeta!(debugMeta!)
								}}
							>
								<Icons.Info size={16} aria-hidden="true" />
								<span>Prompt details</span>
							</button>
						{/if}
						{#if onFireTrigger && contributedRows.length}
							<!-- The contributed entries (19 §4): after core's
							     verbs, separated so a plugin's never reads as
							     one of core's. A newcomer wears its mark until
							     this menu has been opened once. -->
							<hr class="hr" />
							{#each contributedRows as { action, state } (actionIdentity(action))}
								{@const Icon = actionIcon(action.icon)}
								<button
									class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
									class:opacity-60={state.disabled}
									class:cursor-not-allowed={state.disabled}
									title={titleOf(action, state.reason)}
									aria-disabled={state.disabled}
									aria-describedby={state.reason
										? noteIdOf(action)
										: undefined}
									onclick={(e) => {
										if (state.disabled) {
											e.preventDefault()
											return
										}
										closeMenu()
										onFireTrigger!(action, msg)
									}}
								>
									<Icon size={16} aria-hidden="true" />
									<span>{action.name}</span>
									{#if action.isNew}
										<span class="sp-action-new" aria-label="New">
											New
										</span>
									{/if}
								</button>
								{#if state.reason}
									<span id={noteIdOf(action)} class="sr-only">
										{state.reason}
									</span>
								{/if}
							{/each}
						{/if}
					</article>
					<Popover.Arrow>
						<Popover.ArrowTip
							class="!bg-surface-200 dark:!bg-surface-800"
						/>
					</Popover.Arrow>
				</Popover.Content>
			</Popover.Positioner>
		</Portal>
	</Popover>
</div>
