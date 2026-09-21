<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { embeddingsStarred } from "$lib/shared/constants/embeddings"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import RagNotice from "$lib/client/components/sessionMessages/RagNotice.svelte"
	import RunProgressCard from "$lib/client/components/pipelines/RunProgressCard.svelte"
	import { renderMarkdownWithQuotedText } from "$lib/client/utils/markdownToHTML"
	import { getContext, onMount, type Snippet } from "svelte"
	import { Menu } from "@skeletonlabs/skeleton-svelte"
	import { actionIcon } from "$lib/client/components/sessionMessages/actionIcon"
	import { shouldCloseActions } from "$lib/client/components/sessionMessages/actionsDisclosure"
	import {
		exactPaletteMatch,
		filterPaletteActions,
		paletteRowState,
		slashQueryOf,
		stepHighlight,
		type PaletteAction
	} from "$lib/client/components/sessionMessages/slashPalette"
	import { actionIdentity } from "$lib/shared/actions/identity"
	import type { ItemValues } from "$lib/shared/actions/itemValues"
	import { statusText } from "$lib/client/i18n/state.svelte"

	let systemSettingsCtx: SystemSettingsCtx = $state(
		getContext("systemSettingsCtx")
	)

	/**
	 * The `extraTabs` entry carrying the session's own turn controls (Continue,
	 * the character picker, Regenerate). Its buttons belong beside the genre's
	 * contributed actions in the Actions disclosure, so the composer matches it
	 * by value and keeps it out of the More menu.
	 */
	const TURN_CONTROLS_VALUE = "extraControls"

	/** Remembers across reloads that the Enter/Shift+Enter hint has been shown. */
	const HINT_STORAGE_KEY = "serene-pub:composer-hint-seen"

	interface Props {
		newMessage: string
		onSend: () => void
		draftCompiledPrompt?: Sockets.Sessions.PromptTokenCount.Response
		currentUserPersona?: SelectSessionPersona & {
			persona?: SelectCharacter
		}
		userPersonasInSession?: Array<
			SelectSessionPersona & { persona?: SelectCharacter }
		>
		onSwitchPersona?: (personaId: number) => void
		session?: Sockets.Sessions.Get.Response["session"] & {
			sessionPersonas?: Array<
				SelectSessionPersona & { persona?: SelectCharacter }
			>
		}
		lastMessage?: SelectSessionMessage
		editSessionMessage?: SelectSessionMessage
		isGuest: boolean
		showAddPersonaCTA: boolean
		onAddPersonaClick: () => void
		onAbortLastMessage: (e: Event) => void
		/**
		 * The panels the More menu offers (Lore, Pinned images, Statistics), plus
		 * the turn-controls entry the Actions disclosure claims by value.
		 */
		extraTabs?: Array<{
			value: string
			title: string
			control: any
			content: any
		}>
		/**
		 * The genre's contributed session actions (19 §4), as a row of buttons.
		 *
		 * An action the genre contributes IS how that genre is played, so it sits
		 * one click from the field in the Actions disclosure. Passed only when the
		 * genre contributes at least one.
		 */
		actions?: Snippet
		/**
		 * The composer venue's overflow (R-15 `quick`, U5c): every enabled
		 * action the primary row does not show, in a menu beside the chips.
		 * A newcomer wears its mark until the menu has been opened once.
		 */
		overflowActions?: Sockets.Sessions.Actions.Action[]
		/**
		 * What `/` offers: the composer's and the extra tab's actions, by slash
		 * name and label. Empty hides the palette entirely.
		 */
		paletteActions?: PaletteAction[]
		/**
		 * The newest row's `item` document, or `null` with no row (U5e): what
		 * a palette row with `item.*` predicates — `/retry`, `/continue` —
		 * is judged against, so a session with nothing to regenerate greys
		 * them with the newest-row reason as the turn controls are grey.
		 */
		newestItem?: ItemValues | null
		/** Fire one action, from the overflow or the palette. */
		onInvokeAction?: (action: PaletteAction) => void
		/** The person opened a list showing these newcomers (`sessions:actionsSeen`). */
		onActionsSeen?: (keys: string[]) => void
		/** A `composer: 'none'` mode (19 §2): triggers only, no text input. */
		hideCompose?: boolean
		/**
		 * Which composer skin the session's style pack resolves to. `classic`
		 * grows to about six lines; `minimal` is a single-line pill with the
		 * persona name and the retrieval notice dropped; `writer` opens eight
		 * lines in the prose face.
		 */
		composerSkin?: "classic" | "minimal" | "writer"
		/**
		 * Renders Send tonal instead of filled, so the filled treatment belongs
		 * to whatever the page is nudging towards (the ready-to-continue line).
		 */
		sendTonal?: boolean
		/** Hides the Actions label and its row outright. */
		showActions?: boolean
		/**
		 * The session's channels (20 §7; R-C), `main` first — off
		 * `sessions:view`. One channel (every session whose genre declares
		 * none) draws no control at all, which is why nothing moves for the
		 * sessions that exist today.
		 */
		channels?: string[]
		/**
		 * Which of them the next line is written on. Bound, because the page
		 * puts it on the send and the log reads it to decide what to show —
		 * one answer, held where both halves can see it.
		 */
		channel?: string
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
		actions,
		overflowActions = [],
		paletteActions = [],
		newestItem = null,
		onInvokeAction,
		onActionsSeen,
		hideCompose = false,
		composerSkin = "classic",
		sendTonal = false,
		showActions = true,
		channels = [],
		channel = $bindable("main")
	}: Props = $props()

	/**
	 * What a channel is CALLED.
	 *
	 * ⚠ A slug, title-cased, because a slug is all a genre declares: a channel
	 * has no display name and no locale map anywhere in the model (`ChannelDecl`
	 * is `{ slug, role?, voice?, messageVerbs? }`). `manuscript` reads as
	 * "Manuscript", which is right by luck rather than by declaration — the day
	 * a channel wants a name of its own, it gets one on the declaration and
	 * this reads it.
	 */
	const channelLabel = (slug: string) =>
		slug
			.split(/[-_]/)
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" ")

	// Unique per instance: a session page can hold more than one composer on
	// screen at a time, and a shared id sends every `for`/`aria-describedby` to
	// whichever element happens to come first in the DOM.
	const uid = $props.id()
	const inputId = `composer-input-${uid}`
	const warningId = `composer-warning-${uid}`
	const actionsId = `composer-actions-${uid}`
	const paletteId = `composer-palette-${uid}`
	const paletteOptionId = (i: number) => `${paletteId}-option-${i}`

	let personaSwitcherOpen = $state(false)
	let moreMenuOpen = $state(false)
	let actionsOpen = $state(false)
	let previewOpen = $state(false)
	/** The More panel currently filling the field area, or null for the field. */
	let activePaneValue: string | null = $state(null)
	let actionsRegion: HTMLDivElement | undefined = $state()
	let actionsToggle: HTMLButtonElement | undefined = $state()

	// Enter submits at desktop widths only; on a touch keyboard it inserts a
	// newline like any other textarea.
	let submitOnEnter = $state(true)
	let hintSeen = $state(true)
	let hintVisible = $state(false)

	let activePersona = $derived(
		currentUserPersona?.persona ??
			(!isGuest ? session?.sessionPersonas?.[0]?.persona : undefined)
	)

	let turnControls = $derived(
		extraTabs.find((t) => t.value === TURN_CONTROLS_VALUE)
	)
	let morePanes = $derived(
		extraTabs.filter((t) => t.value !== TURN_CONTROLS_VALUE)
	)
	let activePane = $derived(
		morePanes.find((t) => t.value === activePaneValue)
	)
	let hasActionsRow = $derived(
		!!actions || !!turnControls || overflowActions.length > 0
	)
	let overflowNew = $derived(overflowActions.filter((a) => a.isNew))
	let overflowOpen = $state(false)
	/**
	 * The verdict the overflow reads off a listed action (U5e): the same
	 * `paletteRowState` the chips and the palette read, so the three cannot
	 * disagree. The reason arrives as a locale map and is resolved here.
	 */
	const overflowRow = (a: Sockets.Sessions.Actions.Action) => ({
		name: a.name,
		audience: a.audience,
		canAct: a.canAct,
		enabled: a.enabled,
		venue: a.venue,
		...(a.reason ? { reason: statusText(a.reason) || a.reason.i18n.en } : {}),
		...(a.itemPredicates?.length ? { itemPredicates: a.itemPredicates } : {})
	})

	/* ── the `/` palette (R-15 slash names, F38; U5c) ──────────────────────
	 * Typing `/` at the start of an empty draft lists the composer's actions;
	 * the rest of the draft filters them. Escape closes it until the draft
	 * changes; Enter invokes the highlighted row, or the exact match when
	 * the palette is closed. The textarea stays the input — the list is a
	 * listbox it controls (`aria-controls`, `aria-activedescendant`). */
	/** The query Escape was pressed on; the palette stays closed while the draft still says it. */
	let paletteDismissed = $state<string | null>(null)
	let paletteHighlight = $state(-1)
	const paletteQuery = $derived(slashQueryOf(newMessage))
	const paletteRows = $derived(
		paletteQuery === null || !paletteActions.length
			? []
			: filterPaletteActions(paletteActions, paletteQuery)
	)
	const paletteOpen = $derived(
		paletteDismissed !== paletteQuery &&
			paletteRows.length > 0 &&
			!hideCompose
	)
	// The highlight never points past the rows it has.
	$effect(() => {
		if (paletteHighlight >= paletteRows.length)
			paletteHighlight = paletteRows.length ? 0 : -1
	})
	/**
	 * What Enter runs while the palette is open: the highlighted row, else
	 * the name typed in full, else — once the draft has narrowed the list —
	 * its first row. A bare `/` and Enter highlights rather than fires:
	 * nothing was named. ONE derivation, read by the key handler and by the
	 * footer hint, so the hint cannot promise a row Enter would not run.
	 */
	const paletteEnterPick = $derived(
		!paletteOpen
			? undefined
			: paletteHighlight >= 0
				? paletteRows[paletteHighlight]
				: (exactPaletteMatch(paletteActions, newMessage) ??
					(paletteQuery ? paletteRows[0] : undefined))
	)
	// Opening the palette is meeting its newcomers.
	$effect(() => {
		if (!paletteOpen || !onActionsSeen) return
		const fresh = paletteRows.filter((a) => a.isNew)
		if (fresh.length)
			onActionsSeen(fresh.map(actionIdentity))
	})

	function invokePalette(action: PaletteAction) {
		// The same gate the chips and the More menu apply (S5): the
		// audience, and nothing while a reply streams.
		if (paletteRowState(action, { generating: isGenerating, newest: newestItem }).disabled)
			return
		newMessage = ""
		paletteDismissed = null
		paletteHighlight = -1
		onInvokeAction?.(action)
	}

	/** True when the key was the palette's to handle. */
	function handlePaletteKey(e: KeyboardEvent): boolean {
		if (paletteOpen) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault()
				paletteHighlight = stepHighlight(
					paletteHighlight,
					paletteRows.length,
					e.key === "ArrowDown" ? 1 : -1
				)
				return true
			}
			if (e.key === "Escape") {
				e.preventDefault()
				paletteDismissed = paletteQuery
				return true
			}
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault()
				const pick = paletteEnterPick
				if (pick) invokePalette(pick)
				else paletteHighlight = 0
				return true
			}
			if (e.key === "Tab" && paletteRows.length) {
				// Complete to the highlighted (or first) name, like a shell.
				e.preventDefault()
				const pick =
					paletteRows[paletteHighlight >= 0 ? paletteHighlight : 0]!
				newMessage = `/${pick.slash}`
				return true
			}
			return false
		}
		// Closed: `/name` + Enter still invokes an exact match, so a name
		// typed in full never needs the list.
		if (e.key === "Enter" && !e.shiftKey) {
			const exact = exactPaletteMatch(paletteActions, newMessage)
			if (exact) {
				e.preventDefault()
				invokePalette(exact)
				return true
			}
		}
		return false
	}

	function handleOverflowOpen(open: boolean) {
		overflowOpen = open
		if (open && overflowNew.length)
			onActionsSeen?.(overflowNew.map(actionIdentity))
	}
	let actionsLabelShown = $derived(showActions && hasActionsRow)

	let tokenCounts = $derived(draftCompiledPrompt?.meta?.tokenCounts)
	let usageRatio = $derived(
		tokenCounts && tokenCounts.limit > 0
			? Math.min(tokenCounts.total / tokenCounts.limit, 1)
			: null
	)
	let contextExceeded = $derived(
		tokenCounts ? tokenCounts.total > tokenCounts.limit : false
	)

	let isGenerating = $derived(!!lastMessage?.isGenerating)
	let ragVisible = $derived(
		!!session?.id &&
			composerSkin !== "minimal" &&
			embeddingsStarred(systemSettingsCtx.capabilityDefaults)
	)
	let placeholder = $derived(
		activePersona ? `Write as ${activePersona.name}…` : "Write a message…"
	)

	// A pane that has gone (a lorebook unbound, context debugging switched off)
	// hands the field area back. A mode with no field opens on its first panel,
	// because there is nothing else for the area to show.
	$effect(() => {
		const values = morePanes.map((p) => p.value)
		if (activePaneValue && !values.includes(activePaneValue)) {
			activePaneValue = null
		}
		if (hideCompose && !activePaneValue && values.length) {
			activePaneValue = values[0]
		}
	})

	onMount(() => {
		try {
			hintSeen = localStorage.getItem(HINT_STORAGE_KEY) === "1"
		} catch {
			// Storage blocked or full: treat the hint as spent rather than
			// showing it on every visit.
			hintSeen = true
		}
		const mq = window.matchMedia("(min-width: 1024px)")
		const update = () => (submitOnEnter = mq.matches)
		update()
		mq.addEventListener("change", update)
		return () => mq.removeEventListener("change", update)
	})

	function handleSendButton(e: Event) {
		e.stopPropagation()
		onSend()
	}

	function handleAbortLastMessage(e: Event) {
		e.stopPropagation()
		onAbortLastMessage(e)
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (handlePaletteKey(e)) return
		if (e.key !== "Enter") return
		if (!e.shiftKey && submitOnEnter) {
			e.preventDefault()
			onSend()
		}
	}

	function handleFieldFocus() {
		if (hintSeen || !submitOnEnter) return
		hintVisible = true
		hintSeen = true
		try {
			localStorage.setItem(HINT_STORAGE_KEY, "1")
		} catch {
			// The hint still shows for this visit; only the memory of it is lost.
		}
	}

	function openPane(value: string) {
		activePaneValue = value
		previewOpen = false
		moreMenuOpen = false
	}

	function backToCompose() {
		activePaneValue = null
	}

	function togglePreview() {
		previewOpen = !previewOpen
		if (previewOpen) activePaneValue = null
	}

	// The row is a disclosure, not a menu: it closes on its toggle and on
	// Escape, never because focus left it — `actionsDisclosure.ts` has the
	// table and the reason. There is deliberately no `onfocusout` here.
	function closeActions(returnFocus: boolean) {
		if (!actionsOpen) return
		actionsOpen = false
		if (returnFocus) actionsToggle?.focus()
	}

	// Escape is read at the window rather than on the region: the chips are
	// buttons the page renders through a snippet, so the composer cannot put a
	// handler on them, and a handler on the wrapper would make a static element
	// interactive.
	function handleWindowKeyDown(e: KeyboardEvent) {
		if (e.key !== "Escape") return
		if (!actionsOpen) return
		const active = document.activeElement
		const verdict = shouldCloseActions({
			reason: "escape",
			focusInside: active instanceof Node && !!actionsRegion?.contains(active),
			overflowOpen
		})
		if (verdict.close) closeActions(verdict.returnFocus)
	}
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div
	class="sp-composer px-3 pb-2 lg:pb-4"
	data-composer-skin={composerSkin}
	class:hidden={!!editSessionMessage}
>
	{#if showAddPersonaCTA}
		<!-- Guests without a persona get the one thing they can do here. -->
		<div class="flex flex-col items-center justify-center gap-4 py-8">
			<div class="text-center">
				<Icons.UserPlus
					size={48}
					class="text-surface-700-300 mx-auto mb-2"
				/>
				<h3 class="h3 mb-2">Join the conversation</h3>
				<p class="text-surface-600-400">
					Add a persona to this session to send messages.
				</p>
			</div>
			<button
				class="btn preset-filled-primary-500"
				onclick={onAddPersonaClick}
			>
				<Icons.UserPlus size={20} />
				Add your persona
			</button>
		</div>
	{:else}
		<!-- Above the composer, because a run in flight is about the message you
		     are about to get rather than the ones already there — and because it
		     has to stay visible while the transcript scrolls. -->
		{#if session?.id}
			<RunProgressCard sessionId={session.id} />
		{/if}

		<div class="composer-disclosure" bind:this={actionsRegion}>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				{#if actionsLabelShown}
					<button
						type="button"
						class="composer-actions-toggle"
						bind:this={actionsToggle}
						aria-expanded={actionsOpen}
						aria-controls={actionsId}
						onclick={() => (actionsOpen = !actionsOpen)}
					>
						<span>Actions</span>
						<Icons.ChevronDown
							size={12}
							class={actionsOpen ? "rotate-180" : ""}
							aria-hidden="true"
						/>
					</button>
				{/if}
				{#if ragVisible && session?.id}
					<div class="rag-notice ml-auto min-w-0">
						<RagNotice
							sessionId={session.id}
							totalMessages={session.sessionMessages?.length ?? 0}
						/>
					</div>
				{/if}
			</div>

			{#if actionsLabelShown && actionsOpen}
				<div
					id={actionsId}
					class="composer-actions-row"
					role="group"
					aria-label="Session actions"
				>
					{#if actions || overflowActions.length}
						<div class="composer-chips composer-chips-tonal">
							{#if actions}
								{@render actions()}
							{/if}
							{#if overflowActions.length}
								<!-- The overflow (R-15, F38): every enabled action
								     the primary row leaves out, never hidden by
								     prominence. A Menu — these are actions, not a
								     field. A newcomer marks the trigger until the
								     menu has been opened once. -->
								<Menu
									open={overflowOpen}
									onOpenChange={(d) => handleOverflowOpen(d.open)}
									onSelect={(d) => {
										const a = overflowActions.find(
											(x) => actionIdentity(x) === d.value
										)
										// The wire's reason is a locale map; the palette's
										// shape carries a sentence, and the fire needs neither.
										if (a) {
											const { reason: _reason, ...rest } = a
											onInvokeAction?.(rest)
										}
									}}
									positioning={{ placement: "top-start" }}
								>
									<Menu.Trigger
										class="btn btn-sm preset-tonal-surface relative"
										title="More actions"
										aria-label={overflowNew.length
											? `More actions (${overflowNew.length} new)`
											: "More actions"}
									>
										<Icons.Ellipsis size={14} aria-hidden="true" />
										More
										{#if overflowNew.length}
											<span class="sp-action-new-dot" aria-hidden="true"></span>
										{/if}
									</Menu.Trigger>
									<Portal>
										<Menu.Positioner class="z-[1000]!">
											<Menu.Content
												class="card preset-filled-surface-100-900 max-w-[90vw] min-w-52 overflow-y-auto p-1 shadow-xl"
											>
												{#each overflowActions as a (actionIdentity(a))}
													{@const Icon = actionIcon(a.icon)}
													{@const row = paletteRowState(overflowRow(a), {
														generating: isGenerating,
														newest: newestItem
													})}
													<!-- Grey, listed, with its reason (R-15, U5e): the
													     audience's word, the declared enabled-when's, or
													     the busy rule — as a second line and to a screen
													     reader, never dropped from the list. -->
													<Menu.Item
														value={actionIdentity(a)}
														class="hover:preset-tonal-primary data-[highlighted]:preset-tonal-primary flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
														disabled={row.disabled}
														title={row.reason ? `${a.name} — ${row.reason}` : undefined}
													>
														<Icon size={12} aria-hidden="true" />
														<Menu.ItemText>
															{a.name}
															<span class="text-surface-500 ml-1 font-mono text-[0.85em]">/{a.slash}</span>
															{#if row.reason}
																<span class="composer-palette-note block">{row.reason}</span>
															{/if}
														</Menu.ItemText>
														{#if a.isNew}
															<span class="sp-action-new">New</span>
														{/if}
													</Menu.Item>
												{/each}
											</Menu.Content>
										</Menu.Positioner>
									</Portal>
								</Menu>
							{/if}
						</div>
					{/if}
					{#if turnControls}
						<div class="composer-chips composer-chips-outlined">
							{@render turnControls.content?.()}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<div class="composer-card">
			{#if usageRatio !== null}
				<!-- The draft's share of the context window, read along the card's
				     top edge rather than as a number, so it costs no row. -->
				<div
					class="composer-meter"
					role="progressbar"
					aria-label="Context window used"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(usageRatio * 100)}
				>
					<div
						class="composer-meter-fill"
						class:is-high={usageRatio > 0.9}
						style="inline-size: {(usageRatio * 100).toFixed(1)}%"
					></div>
				</div>
			{/if}

			<div class="composer-body">
				{#if activePane}
					<div class="composer-pane-head">
						<span class="composer-pane-title">
							{activePane.title}
						</span>
						{#if !hideCompose}
							<button
								type="button"
								class="composer-quiet-btn"
								onclick={backToCompose}
							>
								<Icons.ArrowLeft size={14} aria-hidden="true" />
								Back to compose
							</button>
						{/if}
					</div>
					<div role="region" aria-label="{activePane.title} panel">
						{@render activePane.content?.()}
					</div>
				{:else if previewOpen}
					<div
						class="rendered-session-message-content composer-preview"
						role="region"
						aria-label="Message preview"
					>
						{@html renderMarkdownWithQuotedText(newMessage)}
					</div>
				{:else if !hideCompose}
					{#if paletteOpen}
						<!-- The `/` palette: the composer's actions by slash
						     name, filtered by the draft. A listbox the field
						     controls; Enter invokes, Escape closes, Tab
						     completes the name. -->
						<ul
							id={paletteId}
							class="composer-palette"
							role="listbox"
							aria-label="Slash commands"
						>
							{#each paletteRows as a, i (a.slash)}
								{@const Icon = actionIcon(a.icon)}
								{@const rowState = paletteRowState(a, {
									generating: isGenerating,
									newest: newestItem
								})}
								<li
									id={paletteOptionId(i)}
									role="option"
									aria-selected={i === paletteHighlight}
									aria-disabled={rowState.disabled}
									class="composer-palette-row"
									class:is-highlighted={i === paletteHighlight}
									class:is-disabled={rowState.disabled}
								>
									<button
										type="button"
										class="composer-palette-btn"
										tabindex="-1"
										disabled={rowState.disabled}
										onmousedown={(e) => e.preventDefault()}
										onmouseenter={() => (paletteHighlight = i)}
										onclick={() => invokePalette(a)}
									>
										<Icon size={14} aria-hidden="true" />
										<span class="composer-palette-slash">/{a.slash}</span>
										<span class="composer-palette-label">{a.name}</span>
										{#if a.isNew}
											<span class="sp-action-new">New</span>
										{/if}
										{#if rowState.reason}
											<span class="composer-palette-note">{rowState.reason}</span>
										{/if}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<label class="sr-only" for={inputId}>Write a message</label>
					<textarea
						id={inputId}
						class="composer-field field-sizing-content focus:outline-none focus:ring-0 focus:border-transparent"
						rows="1"
						{placeholder}
						bind:value={newMessage}
						autocomplete="off"
						spellcheck="true"
						onkeydown={handleKeyDown}
						onfocus={handleFieldFocus}
						aria-describedby={contextExceeded
							? warningId
							: undefined}
						aria-invalid={contextExceeded}
						aria-autocomplete={paletteActions.length ? "list" : undefined}
						aria-controls={paletteOpen ? paletteId : undefined}
						aria-activedescendant={paletteOpen && paletteHighlight >= 0
							? paletteOptionId(paletteHighlight)
							: undefined}
					></textarea>
				{/if}
			</div>

			<div class="composer-footer">
				<!-- Which channel this line lands on. Drawn only when there is
				     a choice: one channel is every session that exists today,
				     and a picker with one option is a control that teaches
				     nothing. -->
				{#if channels.length > 1}
					<div
						class="composer-channels"
						role="group"
						aria-label="Which channel you are writing on"
					>
						{#each channels as slug (slug)}
							<button
								type="button"
								class="composer-channel-btn"
								class:preset-tonal-primary={slug === channel}
								class:is-active={slug === channel}
								aria-pressed={slug === channel}
								title="Write on {channelLabel(slug)}"
								onclick={() => (channel = slug)}
							>
								{channelLabel(slug)}
							</button>
						{/each}
					</div>
				{/if}
				{#if activePersona}
					{#if userPersonasInSession.length > 1}
						<Popover
							open={personaSwitcherOpen}
							onOpenChange={(e) => (personaSwitcherOpen = e.open)}
							positioning={{ placement: "top-start" }}
						>
							<Popover.Trigger
								class="composer-persona-chip is-button"
								title="Switch persona"
								aria-label="Switch persona (currently {activePersona.name})"
							>
								<Avatar char={activePersona} size="w-6 h-6" />
								<span class="composer-persona-name">
									{activePersona.name}
								</span>
								<Icons.ChevronDown
									size={14}
									aria-hidden="true"
								/>
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-[1000]!">
									<Popover.Content
										class="card preset-filled-surface-100-900-surface min-w-[200px] space-y-1 p-2"
									>
										<p
											class="text-surface-600 dark:text-surface-400 px-2 pb-1 text-xs"
										>
											Write as
										</p>
										{#each userPersonasInSession as cp (cp.personaId)}
											{#if cp.persona && cp.personaId != null}
												<button
													type="button"
													class="btn btn-sm popover-menu-btn rounded-lg {cp.personaId ===
													currentUserPersona?.personaId
														? 'preset-tonal-primary'
														: 'hover:preset-tonal'}"
													aria-current={cp.personaId ===
													currentUserPersona?.personaId
														? "true"
														: undefined}
													onclick={() => {
														onSwitchPersona?.(
															cp.personaId!
														)
														personaSwitcherOpen = false
													}}
												>
													<Avatar
														char={cp.persona}
														size="w-5 h-5"
													/>
													<span class="truncate">
														{cp.persona.name}
													</span>
												</button>
											{/if}
										{/each}
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
					{:else}
						<span class="composer-persona-chip">
							<Avatar char={activePersona} size="w-6 h-6" />
							<span class="composer-persona-name">
								{activePersona.name}
							</span>
						</span>
					{/if}
				{/if}

				<div class="composer-footer-end">
					{#if !hideCompose}
						<button
							type="button"
							class="composer-icon-btn"
							class:preset-tonal-primary={previewOpen}
							class:is-active={previewOpen}
							aria-pressed={previewOpen}
							title="Preview"
							aria-label="Preview the formatted draft"
							onclick={togglePreview}
						>
							<Icons.Eye size={16} aria-hidden="true" />
						</button>
					{/if}

					{#if morePanes.length > 0}
						<Popover
							open={moreMenuOpen}
							onOpenChange={(e) => (moreMenuOpen = e.open)}
							positioning={{ placement: "top-end" }}
						>
							<Popover.Trigger
								class="composer-icon-btn {activePane
									? 'preset-tonal-primary is-active'
									: ''}"
								title="More"
								aria-label="More composer panels"
							>
								<Icons.EllipsisVertical
									size={16}
									aria-hidden="true"
								/>
							</Popover.Trigger>
							<Portal>
								<Popover.Positioner class="z-[1000]!">
									<Popover.Content
										class="card bg-surface-100-900 w-[min(90vw,240px)] space-y-3 p-3 shadow-xl"
									>
										<header
											class="popover-menu-title text-sm"
										>
											<Icons.EllipsisVertical
												size={16}
												aria-hidden="true"
											/>
											<p>More</p>
										</header>
										<div class="flex flex-col gap-1">
											{#each morePanes as pane (pane.value)}
												<button
													type="button"
													class="btn btn-sm popover-menu-btn rounded-lg {activePaneValue ===
													pane.value
														? 'preset-tonal-primary'
														: 'hover:preset-tonal'}"
													onclick={() =>
														openPane(pane.value)}
												>
													{@render pane.control?.()}
													<span>{pane.title}</span>
												</button>
											{/each}
										</div>
										<Popover.Arrow>
											<Popover.ArrowTip
												class="!bg-surface-100 dark:!bg-surface-900"
											/>
										</Popover.Arrow>
									</Popover.Content>
								</Popover.Positioner>
							</Portal>
						</Popover>
					{/if}

					{#if !hideCompose}
						{#if isGenerating}
							<button
								type="button"
								class="btn composer-send preset-tonal-error"
								title="Stop"
								aria-label="Stop generating"
								onclick={handleAbortLastMessage}
							>
								<Icons.Square aria-hidden="true" />
								<span>Stop</span>
							</button>
						{:else}
							<button
								type="button"
								class="btn composer-send {sendTonal
									? 'preset-tonal-primary'
									: 'preset-filled-primary-500'}"
								disabled={!newMessage.trim()}
								title="Send"
								aria-label="Send message"
								onclick={handleSendButton}
							>
								<Icons.Send aria-hidden="true" />
								<span>Send</span>
							</button>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		{#if contextExceeded}
			<p
				id={warningId}
				class="text-warning-500 mt-1 text-xs"
				role="alert"
			>
				This draft pushes the prompt past the context limit. Older turns
				will be trimmed.
			</p>
		{/if}

		{#if paletteOpen}
			<!-- While the palette is open Enter does not send: it runs the
			     row it would pick (the same derivation the key handler reads),
			     or — a bare `/` with nothing highlighted — only highlights. -->
			<p class="composer-hint" aria-live="polite">
				<kbd class="composer-kbd">Enter</kbd>
				{#if paletteEnterPick}
					runs /{paletteEnterPick.slash}
				{:else}
					highlights the first ·
					<kbd class="composer-kbd">↑</kbd>
					<kbd class="composer-kbd">↓</kbd>
					to choose
				{/if}
				·
				<kbd class="composer-kbd">Esc</kbd>
				closes.
			</p>
		{:else if hintVisible && submitOnEnter}
			<p class="composer-hint">
				<kbd class="composer-kbd">Enter</kbd>
				sends.
				<kbd class="composer-kbd">Shift</kbd>
				<kbd class="composer-kbd">Enter</kbd>
				for a new line.
			</p>
		{/if}
	{/if}
</div>
