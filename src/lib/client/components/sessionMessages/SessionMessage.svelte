<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { messageEnvoySlug } from "$lib/client/utils/messageSpeaker"
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import MessageComposer from "$lib/client/components/sessionMessages/MessageComposer.svelte"
	import MessageControls from "$lib/client/components/sessionMessages/MessageControls.svelte"
	import { actionIcon } from "$lib/client/components/sessionMessages/actionIcon"
	import { quickRowActions } from "$lib/client/components/sessionMessages/messageVerbState"
	import { actionIdentity } from "$lib/shared/actions/identity"
	import MessagePartsView from "$lib/client/components/sessionMessages/MessagePartsView.svelte"
	import MessageStateLedger from "$lib/client/components/sessionMessages/MessageStateLedger.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
	import { animateHeight } from "$lib/client/utils/motion"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import { statusText, t } from "$lib/client/i18n/state.svelte"

	interface Props {
		msg: SelectSessionMessage
		index: number
		session: Sockets.Sessions.Get.Response["session"] & {
			sessionMessages: SelectSessionMessage[]
		}
		isLastMessage: boolean
		/**
		 * The scene this message belongs to, when it belongs to one —
		 * SessionContainer reads it off its own scene map and passes it with
		 * the rest of the row's arguments. The row also carries the scene's
		 * colour as `--sp-scene`, which the badge below inherits.
		 */
		sceneName?: string | null
		// Functions
		getMessageCharacter: (
			msg: SelectSessionMessage
		) => SelectCharacter | undefined
		canControlMessage: (msg: SelectSessionMessage) => boolean
		showSwipeControls: (
			msg: SelectSessionMessage,
			isGreeting: boolean
		) => boolean
		canSwipeRight: (
			msg: SelectSessionMessage,
			isGreeting: boolean
		) => boolean
		// Event handlers
		onSwipeLeft: (msg: SelectSessionMessage) => void
		onSwipeRight: (msg: SelectSessionMessage) => void
		onEditMessage: (event: Event, msg: SelectSessionMessage) => void
		onDeleteMessage: (event: Event, msg: SelectSessionMessage) => void
		onHideMessage: (event: Event, msg: SelectSessionMessage) => void
		onRegenerateMessage: (event: Event, msg: SelectSessionMessage) => void
		onContinueMessage?: (event: Event, msg: SelectSessionMessage) => void
		onAbortMessage: (event: Event, msg: SelectSessionMessage) => void
		onBranchMessage?: (event: Event, msg: SelectSessionMessage) => void
		onCharacterNameClick: (msg: SelectSessionMessage) => void
		onAvatarClick: (char: SelectCharacter | undefined) => void
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
		// Takes the edited content rather than reading it off `editSessionMessage`
		// itself — this component only owns a local edit buffer, not
		// `editSessionMessage` (a prop passed down from +page.svelte), so the
		// actual `editSessionMessage.content` write happens in the real
		// implementation (+page.svelte's handleSaveEditMessage), which does
		// own that state.
		onSaveEditMessage(content: string, e?: Event): void
		// Tracks which message's "more actions" popover is open, so only one
		// is ever open at a time in a message list.
		openMsgControlsMenu: number | undefined
		// Edit state
		editSessionMessage: SelectSessionMessage | undefined
		canRegenerateLastMessage: boolean
		hasGeneratingMessage: boolean
		/**
		 * Why Continue is unavailable in this session, when it is — the
		 * connection cannot resume a partial reply, or the mode does not offer
		 * the verb. The quick Continue button is withheld while it is set;
		 * MessageControls keeps the explained, disabled row.
		 */
		continueRefusal?: string
		// Summarization mode
		isSummarizationMode?: boolean
		isSelected?: boolean
		onStartSummarization?: (msg: SelectSessionMessage) => void
		/**
		 * The `message` venue of `sessions:actions` (R-15, U5c) — passed
		 * through to MessageControls, and read here for the quick row: the
		 * primary set, one click away on the row itself. Off the widget
		 * envelope (`ctx.actions.v1.message`) when a host provides one, the
		 * prop otherwise.
		 */
		messageActions?: {
			primary: Sockets.Sessions.Actions.Action[]
			overflow: Sockets.Sessions.Actions.Action[]
		}
		/** The person opened a list showing newcomers (`sessions:actionsSeen`). */
		onActionsSeen?: (keys: string[]) => void
		// ⚠ Both of the two below are FALLBACKS, not the primary route: when
		// a `WidgetHost` provides a ctx these fire through `ctx.action` instead
		// (see `fireTrigger`/`fireBlockAction`). They stay for mounts with no
		// host, and are the first two of the ~16 callbacks the PLAN 25 migration
		// collapses onto the envelope.
		onFireTrigger?: (
			action: Sockets.Sessions.Actions.Action,
			msg: SelectSessionMessage
		) => void
		// Declared block actions inside a parts-native body (20 §6), with the
		// block's stamped identity when it carries one (W-E).
		onBlockAction?: (
			fn: string,
			msg: SelectSessionMessage,
			payload?: Record<string, unknown>,
			action?: string,
			blockId?: string
		) => void
		// Snippets
		/**
		 * A caller's own "who is speaking" animation. The generating state
		 * itself is drawn as `.sp-msg-status` beside the name; this renders in
		 * the body while a reply has streamed nothing yet.
		 */
		GeneratingAnimationComponent?: Snippet<[]>
		messageControls?: Snippet<[SelectSessionMessage]>
	}

	let {
		msg,
		index,
		session,
		isLastMessage,
		sceneName = null,
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
		editSessionMessage,
		canRegenerateLastMessage,
		hasGeneratingMessage,
		continueRefusal = undefined,
		isSummarizationMode = false,
		isSelected = false,
		onStartSummarization,
		messageActions = undefined,
		onActionsSeen = undefined,
		onFireTrigger = undefined,
		onBlockAction = undefined,
		GeneratingAnimationComponent,
		messageControls
	}: Props = $props()

	/**
	 * The unified widget envelope (PLAN 25, ruled 2026-08-30). Present at the
	 * one real site — SessionLayout renders the `messages` widget's snippet
	 * inside a `WidgetHost`, and Svelte resolves context where a snippet RENDERS
	 * rather than where it was declared, so the host's ctx reaches down here.
	 * Undefined anywhere else (a standalone mount, a test), which is why every
	 * read below keeps its prop as the fallback.
	 */
	const widget = useWidgetContext()
	const ctx = $derived(widget?.current)

	/**
	 * The first two of this component's ~16 `onXxx` callbacks to move onto the
	 * envelope, because they are the two that were already action-shaped — a
	 * verb plus this message as its subject, which is exactly `ctx.action`'s
	 * signature.
	 *
	 * The two routes are the SAME call, not two spellings of a similar one:
	 * `ctx.action` reaches `WidgetHost`'s `onAction`, which SessionLayout wires
	 * to +page's `handleFrameAction`, which emits `sessions:triggerFunction`
	 * with `{ sessionId, function, action?, messageId, payload? }` — field
	 * for field what `fireMenuTrigger`/`fireBlockAction` emit, so the same
	 * server handler and the same permission check either way. ⏳ `WidgetHost`
	 * (the layouts lane's) still calls `onAction` with three arguments, so
	 * the identity a menu press hands `ctx.action` is dropped on that hop
	 * and the server reads the fire as legacy (owner floor) until the lane
	 * forwards the fourth.
	 */
	/**
	 * A contributed action fired from the options menu or the quick row
	 * (19 §4), its identity riding along (W1) so the server checks THAT
	 * declaration and runs THAT spec.
	 */
	function fireTrigger(
		action: Sockets.Sessions.Actions.Action,
		m: SelectSessionMessage
	) {
		// ⏳ TEMPORARY (U5c review, W1/W4): the prop first, the envelope
		// second — the reverse of `fireBlockAction` below. `WidgetHost` (the
		// layouts lane's) forwards `ctx.action` with three arguments, so the
		// identity would be dropped on that hop and the server would read a
		// guest's press of a plugin's `act: participant` message action as
		// legacy — owner floor — and refuse it. Remove this ordering once
		// `WidgetHost` forwards `action`'s fourth argument; if it outlives
		// that, the envelope route is merely unexercised on the real mount,
		// which passes the prop.
		if (onFireTrigger) onFireTrigger(action, m)
		else if (ctx)
			ctx.action(action.function, m.id, undefined, actionIdentity(action))
	}

	/**
	 * A declared block action inside a parts-native body (20 §6). `action`
	 * is the identity the block was stamped with by the outlet that wrote it
	 * (W-E) — carried, never chosen here — so the server checks THAT
	 * declaration; a block with none fires legacy (the owner floor).
	 */
	function fireBlockAction(
		fn: string,
		m: SelectSessionMessage,
		payload?: Record<string, unknown>,
		action?: string,
		blockId?: string
	) {
		// ⏳ TEMPORARY (U5d, the same shape as `fireTrigger` above): the
		// prop first, the envelope second. `WidgetHost` (the layouts lane's)
		// forwards `ctx.action` with three arguments, so a form's `action`
		// AND `blockId` would be dropped on that hop and the server would
		// read the press as legacy — refusing a guest answering a question
		// put to their own character. Remove this ordering once `WidgetHost`
		// forwards the fourth and fifth arguments; if it outlives that, the
		// envelope route is merely unexercised on the real mount, which
		// passes the prop.
		if (onBlockAction) onBlockAction(fn, m, payload, action, blockId)
		else if (ctx) ctx.action(fn, m.id, payload, action, blockId)
	}

	// Whether a menu trigger has a route at all: the gate MessageControls
	// applies to the contributed section, restated here now that either
	// source can supply one. The real mount passes the prop AND sits inside a
	// host.
	const canFireTrigger = $derived(!!ctx || !!onFireTrigger)

	/**
	 * The one value this component reads off a prop that the envelope already
	 * carries: `session` is touched for exactly one thing — the message count in
	 * the aria-label below — and at the messages widget's host `ctx.messages.v1`
	 * IS `session.sessionMessages`, the same array by reference (the host passes
	 * it verbatim, declares no `channels`, and `scopeMessages` returns its input
	 * untouched when none are declared). Byte-identical, so this is a swap and
	 * not a re-definition.
	 *
	 * ⚠ It stops being identical the day a host mounts this list WITH declared
	 * channels: ctx would then hold the scoped subset while SessionContainer
	 * still renders `session.sessionMessages`, and this count has to describe
	 * what is rendered. Revisit here, not at the host, if that arrives.
	 *
	 * `session.name`/`session.id` (the rest of `session.v1`) are read nowhere in
	 * this component, and the scoped `persona`/`characters` sections are not
	 * projected at this host at all — no grants are passed — so nothing else
	 * here has a ctx counterpart yet.
	 */
	const messageCount = $derived(
		ctx?.messages.v1.length ?? session.sessionMessages.length
	)

	// Derived values
	const character = $derived(getMessageCharacter(msg))
	const narratorDisplayName = $derived(
		msg.metadata?.narratorName || "Narrator"
	)
	/** Who this message is from, as the header prints it. */
	const displayName = $derived(
		msg.isNarratorResponse
			? narratorDisplayName
			: resolveCharacterName(character, "Unknown")
	)
	/** The disc a speaker with no picture gets: their initial. */
	const avatarInitial = $derived(
		displayName.trim().charAt(0).toUpperCase() || "?"
	)
	const isGreeting = $derived(!!msg.metadata?.isGreeting)
	// Two independent classifications the style packs (sessionLayout skins) key
	// off. The one SessionMessage renders every layout; these attributes are
	// what a bubbles/compact/moonlit skin uses for alignment, colour and
	// avatar placement.
	//   data-msg-role   = user | assistant | narration  (who's speaking, by turn)
	//   data-msg-author = persona | character | narrator (which entity kind)
	// They usually agree (a persona speaks as 'user', a character as 'assistant')
	// but are kept separate so a skin can leverage either — e.g. impersonation,
	// or group chats where the split matters.
	const msgRole = $derived(
		msg.isNarratorResponse
			? "narration"
			: msg.role === "user"
				? "user"
				: "assistant"
	)
	/** An envoy's line (U5g): named by reference, no character row behind it. */
	const isEnvoy = $derived(messageEnvoySlug(msg) !== null)
	const msgAuthor = $derived(
		msg.isNarratorResponse
			? "narrator"
			: msg.personaId != null
				? "persona"
				: msg.characterId != null
					? "character"
					: isEnvoy
						? "envoy"
						: "unknown"
	)
	const canControl = $derived(canControlMessage(msg))
	const showSwipes = $derived(showSwipeControls(msg, isGreeting))
	const canSwipeRightVal = $derived(canSwipeRight(msg, isGreeting))
	// Native model thinking (from Ollama think: true, etc.) — `thinking` is
	// written into sessionMessages.metadata by the narrate spec's placeholder outlet
	// but isn't part of the column's `$type<{...}>()` declaration in
	// schema.ts, so it's genuinely absent from SelectSessionMessage's inferred
	// type. `as any` here is the accurate escape hatch for that upstream gap.
	const thinkingContent = $derived((msg.metadata as any)?.thinking || "")
	const hasThinking = $derived(thinkingContent.trim().length > 0)

	// Optional per-trigger focus note for a Narrator response (e.g. "Focus on
	// the weather turning stormy") — set once at trigger time, see sessions.ts's
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
	// into `editSessionMessage.content` (a prop this component doesn't own) —
	// mutating it, even via plain assignment, trips Svelte's
	// ownership_invalid_mutation check. Handed to onSaveEditMessage at save
	// time so the actual write happens in the component that owns
	// editSessionMessage (+page.svelte).
	let editContent = $state("")
	$effect(() => {
		if (editSessionMessage) editContent = editSessionMessage.content
	})

	const isEditing = $derived(
		!!editSessionMessage && editSessionMessage.id === msg.id
	)
	// Parts-native rendering (20 §13 phase 2): when the server attached the
	// message's typed parts and the message is settled, the body — thinking
	// and section collapsibles included — renders from them. Streaming,
	// errors, and unenriched broadcasts fall back to the legacy fields, which
	// are parity-identical by construction.
	const partsNative = $derived(
		!!msg.parts?.length && !msg.isGenerating && !msg.error && !isEditing
	)

	const isEditDirty = $derived(
		isEditing && editContent !== (editSessionMessage?.content ?? "")
	)
	// Empty is blocked as well as unchanged: clearing a message to nothing
	// leaves an unreadable stub in the thread, and Delete is the control that
	// actually expresses that intent.
	const canSaveEdit = $derived(isEditDirty && editContent.trim().length > 0)

	/** A `date` column carries the day only; a time of day needs a timestamp. */
	const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

	/**
	 * The clock beside the name, in the reader's own locale. `createdAt` is a
	 * day-precision `date` column on this row (20 §5), so a value with no time
	 * of day in it reads `updatedAt`, which is a timestamp.
	 */
	const messageTime = $derived.by(() => {
		const created: unknown = msg.createdAt
		const stamp =
			typeof created === "string" && DAY_ONLY.test(created)
				? (msg.updatedAt ?? created)
				: (created ?? msg.updatedAt)
		if (!stamp) return ""
		const at =
			stamp instanceof Date ? stamp : new Date(stamp as string | number)
		if (Number.isNaN(at.getTime())) return ""
		return at.toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit"
		})
	})

	/**
	 * What the ember dot beside the name says while a reply is being made:
	 * the run's own status (R-19) — *Jasmine is thinking*, *Jasmine is
	 * typing*, *loading the model* — resolved in the reader's language. The
	 * retired stage enum is read as a fallback for one release (a row an
	 * older server left mid-flight), and a row with neither says *working*
	 * until its run's first status lands.
	 */
	const generatingStatus = $derived(
		statusText(msg.generationStatus) ||
			(msg.generationStage === "queued"
				? t("queued")
				: msg.generationStage === "loading"
					? t("loading model")
					: msg.generationStage === "generating"
						? t("writing")
						: t("working"))
	)

	// ── the quick actions ────────────────────────────────────────────────
	// The message venue's PRIMARY set (R-15 `quick`, U5c), one click away on
	// the row itself — core's verbs and a plugin's `quick` message action
	// alike (S8) — each shown on exactly the messages the ⋮ menu offers it
	// on and only while the menu would have it enabled, through the one verb
	// table both read (`quickRowActions`). The menu keeps the full list,
	// including the entries that are disabled and explained. Stop is the
	// primary set's too, but it has its own pill below rather than an icon.
	//
	// The list arrives on the widget envelope when a host provides one, the
	// prop otherwise; with neither, the floors alone.
	const venueActions = $derived(
		(ctx?.actions?.v1?.message as typeof messageActions | undefined) ??
			messageActions
	)
	const quickActions = $derived(
		quickRowActions(venueActions?.primary ?? [], {
			msg,
			isLastMessage,
			canRegenerateLastMessage,
			editing: !!editSessionMessage,
			hasGeneratingMessage,
			canControl,
			continueRefusal,
			canSwipe: canSwipeRightVal
		})
	)
	const showQuickActions = $derived(
		!isSummarizationMode && !isEditing && quickActions.length > 0
	)

	/**
	 * A quick icon fires the same handler the menu's row does: core's verbs
	 * to the page's handlers, a contributed action through `fireTrigger`
	 * with this message as the subject.
	 */
	function fireQuick(e: Event, action: Sockets.Sessions.Actions.Action) {
		if (action.specSlug !== "core") return fireTrigger(action, msg)
		switch (action.key) {
			case "retry":
				return onRegenerateMessage(e, msg)
			case "continue":
				return onContinueMessage?.(e, msg)
			case "edit":
				return onEditMessage(e, msg)
			case "branch":
				return onBranchMessage?.(e, msg)
			case "swipe":
				return onSwipeRight(msg)
			case "hide":
				return onHideMessage(e, msg)
			case "delete":
				return onDeleteMessage(e, msg)
		}
	}

	/** The swipe counter is drawn only where there is a history to count. */
	const swipes = $derived(msg.metadata?.swipes)
	const hasSwipeHistory = $derived(
		swipes?.currentIdx !== null &&
			swipes?.currentIdx !== undefined &&
			!!swipes?.history &&
			swipes.history.length > 1
	)

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

<!-- A <div>, not an <li>: SessionContainer already wraps each message in its own
     <li> (the row that carries `--sp-scene`), so an <li> here nests a list item
     inside a list item — invalid HTML that confuses assistive-tech list
     semantics. The role="article" below is what carries the semantics.

     The four cells are the style packs' contract: avatar, identity, controls,
     content, plus the `data-msg-*` attributes a pack keys its look off. -->
<div
	id="message-{msg.id}"
	class="sp-msg"
	data-msg-role={msgRole}
	data-msg-author={msgAuthor}
	data-msg-state={isEditing
		? "editing"
		: isSummarizationMode
			? isSelected
				? "selected"
				: "dim"
			: "normal"}
	data-msg-generating={msg.isGenerating ? "" : undefined}
	data-msg-hidden={msg.isHidden ? "" : undefined}
	data-msg-greeting={isGreeting ? "" : undefined}
	data-msg-newest={isLastMessage ? "" : undefined}
	tabindex="-1"
	role="article"
	aria-label="Message {index +
		1} of {messageCount} from {displayName}: {msg.content.slice(0, 100)}{msg
		.content.length > 100
		? '...'
		: ''}"
>
	<span class="sp-msg-avatar">
		{#if msg.isNarratorResponse}
			<span
				class="sp-msg-avatar-glyph"
				title={narratorDisplayName}
				aria-hidden="true"
			>
				<Icons.CloudSun size="1.25em" />
			</span>
		{:else}
			<!-- Avatar rendered directly (not the reusable Avatar component):
			     Skeleton hard-sizes its avatar root, which fought the layout
			     CSS. A plain img/glyph lets each style pack own size and shape. -->
			<button
				class="sp-msg-avatar-btn"
				onclick={() => onAvatarClick(character)}
				aria-label="View {displayName}'s avatar"
			>
				{#if avatarSrc(character)}
					<img
						class="sp-msg-avatar-img"
						src={avatarSrc(character)}
						alt={displayName}
					/>
				{:else}
					<span class="sp-msg-avatar-glyph" aria-hidden="true">
						{avatarInitial}
					</span>
				{/if}
			</button>
		{/if}
	</span>

	<div class="sp-msg-identity">
		{#if msg.isNarratorResponse}
			<span class="sp-msg-name" title={narratorDisplayName}>
				{narratorDisplayName}
			</span>
		{:else if isEnvoy}
			<!-- Nothing to open: an envoy has no character page. -->
			<span class="sp-msg-name" title={displayName}>
				{displayName}
			</span>
		{:else}
			<button
				class="sp-msg-name"
				onclick={() => onCharacterNameClick(msg)}
				title={displayName}
			>
				{displayName}
			</button>
		{/if}

		<span class="sp-msg-badges">
			{#if isGreeting}
				<span
					class="sp-msg-badge"
					role="img"
					aria-label="Greeting message"
				>
					<Icons.Handshake size={14} aria-hidden="true" />
				</span>
			{/if}
			{#if msg.isHidden}
				<span
					class="sp-msg-badge"
					role="img"
					aria-label="Hidden from the model"
				>
					<Icons.Ghost size={14} aria-hidden="true" />
				</span>
			{/if}
			{#if sceneName}
				<!-- Colour comes from `--sp-scene` on the row this message
				     sits in, so the badge and the pack's scene bar are the
				     same colour by construction. -->
				<span class="sp-msg-badge sp-msg-badge-scene">
					<Icons.Film size={14} aria-hidden="true" />
					<span class="sr-only">In scene:</span>
					<span class="sp-msg-badge-text">{sceneName}</span>
				</span>
			{/if}
			<!-- No wrapper element: EmbeddingStatusIcon renders nothing at
			     all when status is hidden/none (the common case). Its own root
			     already carries inline-flex/items-center/shrink-0. -->
			<EmbeddingStatusIcon embeddingModel={msg.embeddingModel} />
		</span>

		{#if msg.isGenerating}
			<span class="sp-msg-status">
				<span class="sp-dot" aria-hidden="true"></span>
				{generatingStatus}
			</span>
		{:else if isEditing}
			<span class="sp-msg-status">Editing</span>
		{:else if msg.generationOutcome === "stopped"}
			<!-- The explicit outcome (R-15): a reply somebody stopped, holding
			     the partial text. Cleared by the next regenerate or continue on
			     the row, and by a swipe onto another alternative — the stop
			     belongs to the alternative that was streaming, so selecting a
			     different one leaves the mark behind. -->
			<span class="sp-msg-status" title="This reply was stopped before it finished">
				Stopped
			</span>
		{/if}
	</div>

	<div class="sp-msg-controls">
		{#if isEditing}
			<button
				class="sp-msg-quiet-btn"
				title="Cancel edit (Esc)"
				onclick={onCancelEditMessage}
			>
				Cancel
			</button>
			<button
				class="btn btn-sm preset-filled-primary-500"
				title={canSaveEdit
					? "Save changes (Ctrl+Enter)"
					: isEditDirty
						? "A message can't be saved empty"
						: "No changes to save"}
				disabled={!canSaveEdit}
				onclick={handleMessageUpdate}
			>
				Save
			</button>
		{:else}
			{#if messageTime}
				<span class="sp-msg-time">{messageTime}</span>
			{/if}

			{#if showSwipes}
				<div class="sp-msg-swipes">
					{#if hasSwipeHistory}
						<button
							class="sp-msg-icon-btn"
							aria-label="Previous swipe"
							onclick={() => onSwipeLeft(msg)}
							disabled={!!editSessionMessage ||
								!swipes!.currentIdx ||
								swipes!.history.length <= 1 ||
								msg.isGenerating ||
								!canControl}
						>
							<Icons.ChevronLeft size={14} aria-hidden="true" />
						</button>
						<!-- tabular-nums + a min width so stepping 9/12 -> 10/12
						     doesn't shove the arrows sideways. -->
						<span class="sp-msg-swipe-count" aria-live="polite">
							{(swipes!.currentIdx || 0) + 1} / {swipes!.history
								.length}
						</span>
					{/if}
					<button
						class="sp-msg-icon-btn"
						aria-label="Next swipe"
						onclick={() => onSwipeRight(msg)}
						disabled={!!editSessionMessage ||
							!canSwipeRightVal ||
							!canControl}
					>
						<Icons.ChevronRight size={14} aria-hidden="true" />
					</button>
				</div>
			{/if}

			{#if showQuickActions}
				<!-- The icons fade in on hover and focus on a fine pointer and
				     stand permanently on a coarse one — see messageLayouts.css,
				     STYLE-GUIDE §9. -->
				<div
					class="sp-msg-actions"
					role="group"
					aria-label="Message actions"
				>
					{#each quickActions as { action } (actionIdentity(action))}
						{@const Icon = actionIcon(action.icon)}
						<button
							class="sp-msg-icon-btn"
							aria-label={action.name}
							title={action.name}
							onclick={(e) => fireQuick(e, action)}
						>
							<Icon size={14} aria-hidden="true" />
						</button>
					{/each}
				</div>
			{/if}

			<div class="sp-msg-menu">
				{#if messageControls}
					{@render messageControls(msg)}
				{:else}
					<MessageControls
						{msg}
						{isLastMessage}
						{canRegenerateLastMessage}
						{editSessionMessage}
						{hasGeneratingMessage}
						{canControl}
						{continueRefusal}
						{onEditMessage}
						{onHideMessage}
						{onDeleteMessage}
						{onRegenerateMessage}
						{onContinueMessage}
						{onAbortMessage}
						{onBranchMessage}
						{onStartSummarization}
						messageActions={venueActions}
						canSwipe={canSwipeRightVal}
						onSwipeMessage={(_e, m) => onSwipeRight(m)}
						{onActionsSeen}
						onFireTrigger={canFireTrigger ? fireTrigger : undefined}
						open={openMsgControlsMenu === msg.id}
						onOpenChange={(isOpen) =>
							(openMsgControlsMenu = isOpen ? msg.id : undefined)}
					/>
				{/if}
			</div>

			{#if msg.isGenerating}
				<button
					class="sp-msg-stop preset-tonal-error"
					onclick={(e) => onAbortMessage(e, msg)}
				>
					<Icons.Square size={14} aria-hidden="true" />
					Stop
				</button>
			{/if}
		{/if}
	</div>

	<div class="sp-msg-content">
		<!-- The collapsibles a reply can carry: the Narrator's per-trigger
		     focus note and the model's own thinking. Both are suppressed when
		     parts render — the section and thinking parts carry them there. -->
		{#if (hasNarratorInstructions || hasThinking) && !partsNative}
			<div class="sp-msg-disclosures">
				{#if hasNarratorInstructions}
					<div class="sp-disclosure">
						<button
							class="sp-disclosure-toggle"
							onclick={toggleNarratorInstructions}
							aria-expanded={isNarratorInstructionsExpanded}
							aria-controls="extra-instructions-{msg.id}"
						>
							<Icons.Target size={14} aria-hidden="true" />
							<span>Extra instructions</span>
							<Icons.ChevronDown size={14} aria-hidden="true" />
						</button>
						<!-- grid 0fr -> 1fr is the only way to transition to/from an
						     auto height in pure CSS. The inner overflow-hidden
						     wrapper is required: the track collapses to 0 but the
						     content keeps its intrinsic height, so without it the
						     text spills out. Content stays mounted while collapsed
						     because a transition needs both endpoints to exist —
						     hence `inert`, since a 0fr track still contains
						     focusable content. -->
						<div
							id="extra-instructions-{msg.id}"
							class="sp-disclosure-track"
							style:grid-template-rows={isNarratorInstructionsExpanded
								? "1fr"
								: "0fr"}
							inert={!isNarratorInstructionsExpanded}
						>
							<div class="sp-disclosure-clip">
								<div
									class="sp-disclosure-panel rendered-session-message-content"
								>
									{@html renderMarkdownWithQuotedText(
										narratorInstructionsContent
									)}
								</div>
							</div>
						</div>
					</div>
				{/if}

				{#if hasThinking}
					<div class="sp-disclosure">
						<button
							class="sp-disclosure-toggle"
							onclick={toggleThinking}
							aria-expanded={isThinkingExpanded}
							aria-controls="thinking-{msg.id}"
						>
							<Icons.BrainCircuit size={14} aria-hidden="true" />
							<span>Thinking</span>
							<Icons.ChevronDown size={14} aria-hidden="true" />
						</button>
						<!-- See the block above for why this is a grid track. -->
						<div
							id="thinking-{msg.id}"
							class="sp-disclosure-track"
							style:grid-template-rows={isThinkingExpanded
								? "1fr"
								: "0fr"}
							inert={!isThinkingExpanded}
						>
							<div class="sp-disclosure-clip">
								<div
									class="sp-disclosure-panel rendered-session-message-content"
								>
									{@html renderMarkdownWithQuotedText(
										thinkingContent
									)}
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Padding-free wrapper whose only job is to carry the height animation —
	     see animateHeight, which observes the child and drives this element.
	     Disabled while generating: during streaming the height changes on every
	     token, and an animation would trail the text permanently instead of
	     settling. The discrete swaps are what this is for — swiping between
	     alternatives, entering/leaving edit, an error replacing content. -->
		<div
			use:animateHeight={{
				enabled: !msg.isGenerating,
				scrollContainer: "#session-history"
			}}
		>
			<div class="sp-msg-body flex h-fit text-left">
				{#if msg.error}
					<div class="w-full">
						{#if msg.content}
							<div class="rendered-session-message-content mb-2">
								{@html renderMarkdownWithQuotedText(
									msg.content
								)}
							</div>
						{/if}
						<div class="sp-msg-error text-error-600-400">
							<p class="flex items-start gap-1.5">
								<Icons.AlertTriangle
									size={14}
									aria-hidden="true"
									class="mt-0.5 shrink-0"
								/>
								<span>
									{msg.error.message}{#if msg.error.code}
										({msg.error.code}){/if}
								</span>
							</p>
							<!--
						Presence IS permission. `error.connection` is connection
						identity, and the server removes that key from every
						payload a non-admin receives (connections/visibility.ts),
						so a client that renders it whenever it arrives shows it
						only to administrators — no role check here to drift out
						of step with the one on the server.

						The sentence above names no connection by construction,
						which is what lets it be stored and shown to anybody; this
						is where an administrator gets back the half it left out —
						which connection, and what the service actually said.
					-->
							{#if msg.error.connection?.name || msg.error.connection?.detail}
								<p class="sp-msg-error-detail">
									{[
										msg.error.connection.name,
										msg.error.connection.model
									]
										.filter(Boolean)
										.join(" · ")}{msg.error.connection
										.detail
										? `${msg.error.connection.name ? "\n" : ""}${msg.error.connection.detail}`
										: ""}
								</p>
							{/if}
							<button
								class="sp-msg-retry"
								onclick={(e) => onRegenerateMessage(e, msg)}
							>
								Retry
							</button>
						</div>
					</div>
				{:else if msg.content === "" && msg.isGenerating}
					{#if GeneratingAnimationComponent}
						{@render GeneratingAnimationComponent()}
					{/if}
				{:else if isEditing}
					<!-- One surface: the panel IS the field. The textarea below
					     drops its own border, radius and fill (see `edit-field`)
					     and simply lays text on this one. -->
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
						<!-- Transient: it exists only while an edit is open, so
						     it can't become permanent noise. -->
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
								<span
									class="text-warning-600-400 ml-auto font-medium"
								>
									Unsaved changes
								</span>
							{/if}
						</div>
					</div>
				{:else if partsNative}
					<!-- The parts-native body (20 §2): markdown, thinking,
				     sections, steps — everything typed renders from parts. -->
					<div class="w-full">
						<MessagePartsView
							messageId={msg.id}
							parts={msg.parts!}
							activeRevisions={msg.activeRevisions ?? { "0": 0 }}
							onContentClick={handleContentClick}
							bodyText={msg.content ?? ""}
							onAction={(fn, payload, action, blockId) =>
								fireBlockAction(fn, msg, payload, action, blockId)}
						/>
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
						class="rendered-session-message-content {msg.isGenerating &&
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

		<!-- What this turn changed, and what it is still asking for (the stats
		     and states ledger). Renders nothing at all for a message that
		     changed nothing, which is almost every message — and it is outside
		     the height-animated wrapper above, because a decision landing here
		     must not look like the body re-rendering. -->
		<MessageStateLedger
			messageId={msg.id}
			sessionId={session?.id ?? null}
		/>
	</div>
</div>

<style lang="postcss">
	@reference "tailwindcss";

	/* --- Edit mode --- */

	/* The textarea is a child of MessageComposer, so this has to cross the
	   component boundary — but it stays anchored to `.edit-surface` so it can
	   only ever reach the edit composer's field, never the session bar's.

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

		/* Without a cap, editing a long message grows the card unbounded and
		   pushes Save/Cancel — which live in the header — off the top of the
		   viewport. */
		max-height: 45vh;
		overflow-y: auto;

		&:focus {
			outline: none;
			box-shadow: none;
		}

		/* Mouse focus needs no ring — the card's own outline already says which
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
