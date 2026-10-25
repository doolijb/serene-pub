<!--
	@component
	The page's own views a widget may place (`sp-host-view`, C0b), drawn by
	the page under its own contexts wherever core's composer puts them: the
	banners above the composer, the genre's action chips, the retrieval
	notice, the run in flight, and the composer's tabs — Turn controls, Lore
	and Statistics — and the Extend graph review Chronicle opens. Registers them on mount (`setHostViews`) and
	takes them back on unmount; draws only from the stores it is handed, and
	presses through their verbs.
-->
<script lang="ts">
	import { getAllContexts, getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { setHostViews } from "$lib/client/components/hostElements/context.svelte"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import {
		actionIdentity,
		NARRATE_ACTION
	} from "$lib/shared/actions/identity"
	import { paletteRowState } from "@serene-pub/core-catalog/conversation"
	import {
	composerClosedOn,
	composerClosedPlaceholder,
	composerClosuresFor,
	DEFAULT_CHANNEL,
	parseChannel
} from "@serene-pub/sdk"
	import RunProgressCard from "$lib/client/components/pipelines/RunProgressCard.svelte"
	import { newestRowIdOn } from "$lib/client/components/pipelines/runCardScope"
	import SessionRetrievalPreview from "$lib/client/components/pipelines/workspace/SessionRetrievalPreview.svelte"
	import SessionUsagePanel from "$lib/client/components/pipelines/workspace/SessionUsagePanel.svelte"
	import GraphBuildModal from "$lib/client/components/modals/GraphBuildModal.svelte"
	import RagNotice from "$lib/client/components/sessionPage/RagNotice.svelte"
	import ActionLegend from "$lib/client/components/sessionPage/ActionLegend.svelte"
	import ComposerRoutinesMenu from "$lib/client/components/sessionPage/ComposerRoutinesMenu.svelte"
	import SessionBanners from "$lib/client/components/sessionPage/SessionBanners.svelte"
	import ReadinessStrip from "$lib/client/components/sessionPage/ReadinessStrip.svelte"
	import type { SessionPageData } from "$lib/client/components/sessionPage/sessionPageData.svelte"
	import type { ActionList } from "$lib/client/components/sessionPage/actionList.svelte"
	import type { TurnFlow } from "$lib/client/components/sessionPage/turnFlow.svelte"
	import type { ComposerFlow } from "$lib/client/components/sessionPage/composerFlow.svelte"
	import type { ScenesFlow } from "$lib/client/components/sessionPage/scenesFlow.svelte"
	import type { PressRouting } from "$lib/client/components/sessionPage/pressRouting.svelte"
	import { mayContinue } from "$lib/shared/sessions/carryOn"

	interface Props {
		data: SessionPageData
		actions: ActionList
		turns: TurnFlow
		composer: ComposerFlow
		scenes: ScenesFlow
		press: PressRouting
		/** The composer's draft — what the Lore tab's preview would send. */
		draft: string
		/** The loaded session's primitives (never the streamed object: B8). */
		loadedSessionId: number | null
		sessionUserId: number | null
		sessionLorebookId: number | null
		sessionLorebookBranchId: number | null
	}

	let {
		data,
		actions,
		turns,
		composer,
		scenes,
		press,
		draft,
		loadedSessionId,
		sessionUserId,
		sessionLorebookId,
		sessionLorebookBranchId
	}: Props = $props()

	let userCtx: UserCtx = getContext("userCtx")
	const hostContexts = getAllContexts()

	const session = $derived(data.session)
	const lastMessage = $derived(data.lastMessage)
	const currentUserPersona = $derived(data.currentUserPersona)
	const narratorName = $derived(data.narratorName)
	const needsPersona = $derived(data.needsPersona)
	const sessionActions = $derived(actions.sessionActions)
	const actionLegend = $derived(actions.actionLegend)
	const newestItem = $derived(actions.newestItem)
	/**
	 * 🚧 The lanes the genre closed this viewer's composer on (owner ruling
	 * 2026-10-15): the genre's action chips grey with the composer, saying
	 * what it waits on. The turn controls are the round's and stay.
	 */
	const closedComposers = $derived(
		composerClosuresFor(
			(session as { composerStates?: unknown } | null)?.composerStates,
			userCtx.user?.id ?? null
		)
	)
	const sessionChipClass = $derived(actions.sessionChipClass)
	const NO_PERSONA = $derived(actions.NO_PERSONA)
	/**
	 * 🚧 Why a turn control is grey for a viewer with no seat (2026-10-18, the
	 * 100-turn walk #26): the genre's own words when it closed this channel's
	 * composer on them — the Dungeon Crawler's _Waiting: Make your character
	 * on the Planner tab first._ — never "add a persona first" in a genre
	 * whose seat is not a persona.
	 */
	const noSeatReason = (channel?: string): string => {
		const shut = composerClosedOn(closedComposers, channel ?? "main")
		return shut ? composerClosedPlaceholder(shut) : NO_PERSONA
	}
	/** A member's Continue before they have moved (the server's `sentSinceReply`). */
	const NOT_YOUR_CONTINUE = "send your line first"
	const draftCompiledPrompt = $derived(composer.draftCompiledPrompt)
	const contextExceeded = $derived(composer.contextExceeded)
	const newMessage = $derived(draft)
	const onOtherChannel = (channel?: string): channel is string =>
		actions.onOtherChannel(channel)
	const venueOn = (kind: string, channel?: string) =>
		actions.venueOn(kind, channel)
	const chipVerdict = (t: Sockets.Sessions.Actions.Action) =>
		actions.chipVerdict(t)
	const extraActionOn = (key: string, channel?: string) =>
		actions.extraActionOn(key, channel)
	const extraChip: ActionList["extraChip"] = (t, busy) =>
		actions.extraChip(t, busy)
	const actionIcon = (name?: string) => press.actionIcon(name)
	const fireOfferedAction = (t: Sockets.Sessions.Actions.Action) =>
		press.fireOfferedAction(t)
	/**
	 * Extend graph's review (Chronicle's `extend-graph`, W3 — the Lore tab's
	 * button, moved): the book as a primitive, never `{session.x}` — the
	 * modal's restore effect reads it, and a per-token re-run would reset a
	 * review in progress (B8).
	 */
	const extendCounts = $derived(scenes.extendCounts)
	const extendBookId = $derived(sessionLorebookId)
	const handleAdvance = (e: Event, channel?: string) =>
		turns.handleAdvance(e, channel)
	/**
	 * 🚧 One Continue at a time (PLAN-dc-after-walk2 Q3-4, the walk's #28): the
	 * turn line above the composer already offers one — a voice prepared on
	 * this channel, shown — so this row draws none beside it.
	 */
	const turnLineContinues = (channel?: string): boolean => {
		if (!turns.shouldShowNextCharacterBlock) return false
		const here = (turns.turnOrder?.order ?? []).find(
			(e) => (((e as { channel?: unknown }).channel as string | undefined) ?? "main") === (channel ?? "main")
		)
		if (!here) return false
		if (here.ref === null) return true
		const candidate = (turns.turnOrder?.candidates ?? []).find((c) => c.ref === here.ref)
		return candidate?.kind !== "persona"
	}
	const handlePickSpeaker = (e: Event) => turns.handlePickSpeaker(e)
	const handleFireNarratorTurn = (e: Event, channel?: string) =>
		turns.handleFireNarratorTurn(e, channel)
	const handleRetake = (e: Event) => turns.handleRetake(e)
	const handleRegenerateLastMessage = (e: Event) =>
		turns.handleRegenerateLastMessage(e)
	const handleNarratorResponse = (e: Event) => turns.handleNarratorResponse(e)
</script>

<div
	hidden
	{@attach () => {
		setHostViews(
			{
				"session-banners": conversationBanners,
				"session-actions": sessionActionsRow,
				"retrieval-notice": ragNotice,
				"run-progress": runProgress,
				"session-controls": extraControlsContent,
				"session-workflow": workflowContent,
				// ⏳ "scene-images" (the Pinned images pane) is drawn no more
				// (W6): a Scene Portraits instance chooses its own images.
				"session-statistics": statisticsContent
			},
			hostContexts
		)
		return () => setHostViews(undefined)
	}}
></div>

<!-- Chronicle's Extend graph (`extend-graph`, W3): this session's scenes on
     its line the lorebook's graph has not read. The page's own review, as the
     Lore tab's button opened it. -->
{#if extendBookId}
	<GraphBuildModal
		open={scenes.showExtendGraph}
		onOpenChange={(e) => (scenes.showExtendGraph = e.open)}
		lorebookId={extendBookId}
		mode="extend"
		sessionId={loadedSessionId}
		readySceneCount={extendCounts.ready}
		skippedSceneCount={extendCounts.unsummarized}
		ungraphedHistoryEntryCount={0}
		unresolvedCastSceneCount={extendCounts.unresolvedCast}
		onApplied={() => scenes.refreshScenes()}
	/>
{/if}

{#snippet conversationBanners()}
	<SessionBanners
		typing={[...data.typingPersonas.values()]}
		showTyping={!data.modeMissing && !data.composerHidden}
	/>
{/snippet}

{#snippet workflowContent()}
	<!-- Ids, never `{session.x}`: a bare member chain is a getter over the
	     object a streamed chunk replaces, and would re-run these
	     children's effects per token (B8). -->
	{#if sessionLorebookId && (sessionUserId === userCtx.user?.id || userCtx.user?.isAdmin)}
		<!--
			The Lore tab's history half — the current history entry and its
			scenes, Start new history entry, Summarize scene, Extend graph and
			the recent entries — is the Chronicle widget now (W3, Q3): one
			home per fact. What stays is about the draft and the session:

			· What WOULD fire, if they sent the message currently in the
			  box. On a button, never on a keystroke — a turn is a real run
			  with a real embedding call behind it (`EntryFireTest`'s rule).
			· What HAS fired in this conversation, which is the question no
			  single turn can answer and the one that catches an entry
			  that has never once come in.

			"The answer goes where the question is asked" (ruling
			2026-09-08, 4.4). The persona is the CURRENT one rather than the
			session's first: a persona switch changes which character lore
			is in scope, so answering from the first would answer about
			somebody else.
		-->
		<div class="flex flex-col gap-3 py-1">
			<p class="text-surface-700-300 text-xs">
				History and scenes are in the Chronicle widget.
			</p>
			<SessionRetrievalPreview
				sessionId={loadedSessionId}
				content={newMessage}
				personaId={currentUserPersona?.personaId ||
					session?.sessionPersonas?.[0]?.personaId ||
					null}
				disabledReason={(session?.sessionCharacters ?? []).some(
					(cc) => cc.isActive && !cc.removedAt
				)
					? null
					: "Add a character to this conversation to see what its next reply would pull in."}
			/>
			<SessionUsagePanel sessionId={loadedSessionId} />
		</div>
	{/if}
{/snippet}

{#snippet extraControlsContent(channel?: string)}
	<!-- No box of its own (note 30, 2026-10-02): these chips are drawn
	     straight into the composer's one Actions row, first, ahead of the
	     genre's actions and More — one group, one chip
	     (`sessionChipClass`), the row's spacing. -->
	<!-- Character-response mechanics (19 §2): a mode whose shape has
	     no character system is offered no Continue and no Pick — the
	     SDK's `turnControlDefault`, applied by the server's list. The
	     persona half of the disabled check follows the shape — a
	     persona-less mode's turns need no persona on record. -->
	<!-- The turn controls (R-15, U5c; B7, B8): Continue is core's
	     `advance`, Pick who speaks core's `pick`, Regenerate core's
	     `retry`, all at the extra venue and drawn only when the list
	     carries them. Whether a turn control is here at all is the
	     SERVER's verdict — the genre's `turnControls` and their
	     present-when — and nothing here recomputes it. Continue fires the next turn,
	     never the message's prefill `extend`. The narrator's turn
	     (`narrate`) has no chip: it is the narrator row of the two
	     pickers, and `/narrator`. -->
	<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
	     the tab order and the reason — the listed verdict's, or the
	     newest row's — reaches a screen reader through
	     `aria-describedby`; the click is guarded instead. -->
	{#if extraActionOn("advance", channel) && !turnLineContinues(channel)}
		{@const t = extraActionOn("advance", channel)!}
		{@const chip = extraChip(t, [
			[needsPersona, noSeatReason(channel)],
			[
				!mayContinue({
					isOwner: !data.isGuest,
					userId: userCtx.user?.id,
					channel,
					rows: session?.sessionMessages,
					turnOrder: turns.turnOrderDoc
				}),
				NOT_YOUR_CONTINUE
			]
		])}
		<button
			class={sessionChipClass}
			class:opacity-60={chip.disabled}
			class:cursor-not-allowed={chip.disabled}
			title={chip.reason
				? `Continue — ${chip.reason}`
				: (t.description ?? "Continue the conversation")}
			aria-disabled={chip.disabled}
			aria-describedby={chip.reason
				? `extra-note-advance-${channel ?? "main"}`
				: undefined}
			onclick={(e) =>
				chip.disabled ? e.preventDefault() : handleAdvance(e, channel)}
		>
			<Icons.MessageSquareMore size={14} />
			Continue
		</button>
		{#if chip.reason}
			<span id="extra-note-advance-{channel ?? 'main'}" class="sr-only">
				{chip.reason}
			</span>
		{/if}
	{/if}
	{#if extraActionOn("pick", channel)}
		{@const t = extraActionOn("pick", channel)!}
		{@const pick = extraChip(t, [[needsPersona, noSeatReason(channel)]])}
		<button
			class={sessionChipClass}
			class:opacity-60={pick.disabled}
			class:cursor-not-allowed={pick.disabled}
			title={pick.reason
				? `Pick who speaks — ${pick.reason}`
				: (t.description ?? "Pick who speaks")}
			aria-disabled={pick.disabled}
			aria-describedby={pick.reason
				? `extra-note-pick-${channel ?? "main"}`
				: undefined}
			onclick={(e) =>
				pick.disabled ? e.preventDefault() : handlePickSpeaker(e)}
		>
			<Icons.MessageSquarePlus size={14} />
			Pick who speaks
		</button>
		{#if pick.reason}
			<span id="extra-note-pick-{channel ?? 'main'}" class="sr-only">
				{pick.reason}
			</span>
		{/if}
	{/if}
	<!-- Narrate (S1): where a channel's listing carries the narrator's
	     turn but no Pick — the Sanctum's — the pickers' narrator row
	     is out of reach, so the turn is its own chip there. Elsewhere
	     it stays the pickers' row and `/narrator`. -->
	{#if extraActionOn("narrate", channel) && !extraActionOn("pick", channel)}
		{@const t = extraActionOn("narrate", channel)!}
		{@const chip = extraChip(t)}
		<button
			class={sessionChipClass}
			class:opacity-60={chip.disabled}
			class:cursor-not-allowed={chip.disabled}
			title={chip.reason
				? `${t.name} — ${chip.reason}`
				: (t.description ?? t.name)}
			aria-disabled={chip.disabled}
			aria-describedby={chip.reason
				? `extra-note-narrate-${channel ?? "main"}`
				: undefined}
			onclick={(e) =>
				chip.disabled
					? e.preventDefault()
					: handleFireNarratorTurn(e, channel)}
		>
			<Icons.CloudSun size={14} />
			{t.name}
		</button>
		{#if chip.reason}
			<span id="extra-note-narrate-{channel ?? 'main'}" class="sr-only">
				{chip.reason}
			</span>
		{/if}
	{/if}
	<!-- Regenerate the last turn, as a whole (`retake`, R2): on the
	     story it is the header's, beside Back and Forward (pr-6 D2) —
	     drawn here only for another channel that lists it. -->
	{#if extraActionOn("retake", channel) && channel != null && parseChannel(channel).slug !== DEFAULT_CHANNEL}
		{@const t = extraActionOn("retake", channel)!}
		{@const chip = extraChip(t)}
		<button
			class={sessionChipClass}
			class:opacity-60={chip.disabled}
			class:cursor-not-allowed={chip.disabled}
			title={chip.reason
				? `Regenerate — ${chip.reason}`
				: (t.description ?? "Regenerate the last turn")}
			aria-disabled={chip.disabled}
			aria-describedby={chip.reason
				? `extra-note-retake-${channel ?? "main"}`
				: undefined}
			onclick={(e) =>
				chip.disabled ? e.preventDefault() : handleRetake(e)}
		>
			<Icons.RefreshCw size={14} />
			Regenerate
		</button>
		{#if chip.reason}
			<span id="extra-note-retake-{channel ?? 'main'}" class="sr-only">
				{chip.reason}
			</span>
		{/if}
	{/if}
	<!-- Absent, not disabled, when the genre does not offer retry
	     (R-15): a dice-are-final genre has no reply to redo. -->
	{#if extraActionOn("retry", channel)}
		{@const t = extraActionOn("retry", channel)!}
		{@const chip = extraChip(t)}
		<button
			class={sessionChipClass}
			class:opacity-60={chip.disabled}
			class:cursor-not-allowed={chip.disabled}
			title={chip.reason
				? `Regenerate — ${chip.reason}`
				: (t.description ?? "Regenerate the last reply")}
			aria-disabled={chip.disabled}
			aria-describedby={chip.reason
				? `extra-note-retry-${channel ?? "main"}`
				: undefined}
			onclick={(e) =>
				chip.disabled
					? e.preventDefault()
					: handleRegenerateLastMessage(e)}
		>
			<Icons.RefreshCw size={14} />
			Regenerate
		</button>
		{#if chip.reason}
			<span id="extra-note-retry-{channel ?? 'main'}" class="sr-only">
				{chip.reason}
			</span>
		{/if}
	{/if}
	<!-- 🚧 Routines (R39; lane 7): the session's owner runs an enabled
	     routine now, like an action — on the main conversation's copy
	     only, so a pinned channel's composer does not repeat it. -->
	{#if loadedSessionId && !data.isGuest && (channel ?? "main").split(":")[0] === "main"}
		<ComposerRoutinesMenu
			sessionId={loadedSessionId}
			isOwner={!data.isGuest}
			chipClass={sessionChipClass}
		/>
	{/if}
	<!-- The legend here when the genre lists no chips (so the
	     genre's view, which carries it, is not drawn): a genre with
	     none still has a way to learn what its controls and message
	     menu do. -->
	{#if !sessionActions.length}
		<ActionLegend sections={actionLegend} />
	{/if}
{/snippet}

<!-- The contributed trigger set (19 §4): rendered from rows, so a retired
     contributor takes its button with it. It is the composer's own action
     row rather than a tab panel, because an action the genre contributes is
     how that genre is played and must not need a tab opened first. The
     narrate function keeps its bespoke presentation — the resolved narrator
     name and its instructions modal — mapped on the function key. -->
<!-- The run in flight, above the composer (a host view, C0b). -->
<!-- Above the composer (the composer places `run-progress` there): the
     readiness strip first — no chat model means no run to show — then the
     run in flight. The strip shows where the composer does, the typing
     pill's condition. -->
{#snippet runProgress(channel?: string)}
	<ReadinessStrip show={!data.modeMissing && !data.composerHidden} />
	{#if loadedSessionId}
		<!-- This copy's channel's runs only; a newer row there retires a receipt. -->
		<RunProgressCard
			sessionId={loadedSessionId}
			{channel}
			newestRowId={newestRowIdOn(session?.sessionMessages, channel)}
			rowStops={(session?.sessionMessages ?? []).some(
				(m) => !!m.isGenerating && ((m as { channel?: string | null }).channel || "main").split(":")[0] === (channel ?? "main").split(":")[0]
			)}
		/>
	{/if}
{/snippet}

{#snippet ragNotice()}
	{#if loadedSessionId}
		<RagNotice
			sessionId={loadedSessionId}
			totalMessages={session?.sessionMessages?.length ?? 0}
		/>
	{/if}
{/snippet}

{#snippet sessionActionsRow(channel?: string)}
	<!-- Keyed by the action's identity (W3): two actions on one function
	     — core's and a plugin's `summarize` — are two chips. -->
	<!-- This composer's channel's chips (S1): the Sanctum's on the
	     Sanctum panel, `main`'s elsewhere. -->
	{#each onOtherChannel(channel) ? venueOn("composer", channel).primary : sessionActions as t (actionIdentity(t))}
		{@const shut = composerClosedOn(closedComposers, channel ?? "main")}
		{@const chip = shut
			? { disabled: true, reason: composerClosedPlaceholder(shut) }
			: paletteRowState(chipVerdict(t), {
					generating: data.generating,
					newest: newestItem,
					statusText
				})}
		{@const chipNoteId = `chip-note-${channel ?? "main"}-${actionIdentity(t).replace(/[^a-z0-9-]/g, "-")}`}
		<!-- Greyed, not disabled (S6): `aria-disabled` keeps the chip in
		     the tab order and the reason reaches a screen reader through
		     `aria-describedby`; a native `disabled` is skipped and says
		     nothing. The click is guarded instead. -->
		<!-- `narrate-character` deliberately falls through to the generic
		     branch: `fireOfferedAction` routes it to the same modal, whose first
		     step is the choice between the two. A second bespoke button
		     here would be a second place to keep in step with the
		     narrator's resolved name. -->
		{#if actionIdentity(t) === NARRATE_ACTION}
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `${narratorName} — ${chip.reason}`
					: t.description
						? `${narratorName} — ${t.description}`
						: "Ask the narrator"}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason ? chipNoteId : undefined}
				onclick={(e) =>
					chip.disabled
						? e.preventDefault()
						: handleNarratorResponse(e)}
			>
				<Icons.CloudSun size={14} />
				{narratorName}
			</button>
		{:else}
			{@const ActionIconComponent = actionIcon(t.icon)}
			<!-- Seen by the audience's `see`, pressable by its `act` (R-15):
			     a guest sees the genre's vocabulary and is told, not
			     shown nothing. -->
			<button
				class={sessionChipClass}
				class:opacity-60={chip.disabled}
				class:cursor-not-allowed={chip.disabled}
				title={chip.reason
					? `${t.name} — ${chip.reason}`
					: t.description
						? `${t.name} — ${t.description}`
						: t.name}
				aria-disabled={chip.disabled}
				aria-describedby={chip.reason ? chipNoteId : undefined}
				onclick={(e) =>
					chip.disabled ? e.preventDefault() : fireOfferedAction(t)}
			>
				<ActionIconComponent size={14} />
				{t.name}
			</button>
		{/if}
		{#if chip.reason}
			<span id={chipNoteId} class="sr-only">{chip.reason}</span>
		{/if}
	{/each}
	<!-- The legend (2026-09-28): what every action here does, message
	     menu included, one "?" away. -->
	<ActionLegend sections={actionLegend} />
{/snippet}

{#snippet statisticsContent()}
	<div class="mb-[0.5em] flex flex-wrap items-center gap-3">
		<button
			class="btn btn-sm preset-tonal-primary"
			title="View full prompt details"
			onclick={() => {
				// The draft is the subject again; a message report left
				// standing here would put a finished reply behind a button
				// labelled with the draft's own numbers.
				composer.messageReport = undefined
				composer.showDraftCompiledPromptModal = true
			}}
			disabled={!draftCompiledPrompt?.meta}
		>
			<Icons.Info size={14} />
			Details
		</button>
		{#if draftCompiledPrompt?.meta}
			<div class="flex gap-4 text-xs">
				<div class="flex flex-col gap-0.5">
					<span class="text-surface-700-300 text-meta">Tokens</span>
					<span
						class:text-error-600-400={contextExceeded}
						class="font-medium tabular-nums"
					>
						{draftCompiledPrompt.meta.tokenCounts.total} / {draftCompiledPrompt
							.meta.tokenCounts.limit}
					</span>
				</div>
				<div class="flex flex-col gap-0.5">
					<span class="text-surface-700-300 text-meta">
						Messages
					</span>
					<span class="font-medium tabular-nums">
						{draftCompiledPrompt.meta.sessionMessages.included} /
						{draftCompiledPrompt.meta.sessionMessages.total}
					</span>
				</div>
			</div>
		{:else if draftCompiledPrompt?.error}
			<span class="text-error-600-400 text-xs">
				{draftCompiledPrompt.error}
			</span>
		{:else}
			<span class="text-surface-700-300 text-xs">
				No statistics yet — send a message first.
			</span>
		{/if}
	</div>
{/snippet}
