<script lang="ts">
	/**
	 * Core's composer (C0b): the field you write into, the persona you write
	 * as, the lane, the session's action chips and its More panel. It reads
	 * the conversation (`useConversation`) and the dossier's composer part;
	 * sending, the draft and a persona switch are requests core's own widget
	 * may make, a press of an action is `invoke`, and the page's own parts —
	 * the chips, the turn controls, the panels, the run card, the retrieval
	 * notice — are host views it places (`sp-host-view`).
	 */
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
	import { i18nText } from "@serene-pub/sdk"
	import { untrack } from "svelte"
	import { useConversation } from "./conversation.svelte"

	/** The More panel's tab that is not a pane: the turn controls, in the actions row. */
	const TURN_CONTROLS_VIEW = "session-controls"

	interface Props {
		/** How the composer is drawn (a widget setting). */
		composerSkin?: "classic" | "minimal" | "writer"
		/** Hides the Actions label and its row outright. */
		showActions?: boolean
	}

	let { composerSkin = "classic", showActions = true }: Props = $props()

	const conv = useConversation()
	const c = $derived(conv.dossier?.composer)
	const hideCompose = $derived(!!c?.hidden)
	const channels = $derived(c?.channels ?? [])
	const overflowActions = $derived((c?.overflow ?? []) as Sockets.Sessions.Actions.Action[])
	const paletteActions = $derived((c?.palette ?? []) as PaletteAction[])
	const newestItem = $derived((c?.newest ?? null) as ItemValues | null)
	const sendTonal = $derived(!!c?.sendTonal)
	const actionsListed = $derived(!!c?.actions)

	/** The draft: the composer's own, seeded from the host's when the session opens. */
	let draft = $state("")
	let seeded: string | null = null
	let seededFor: number | null = null
	$effect(() => {
		const seed = c?.draft ?? ""
		const session = conv.dossier?.sessionId ?? null
		// Another session: its own draft, never the last one's.
		if (session !== seededFor) {
			seededFor = session
			seeded = seed
			setField(seed)
			return
		}
		if (seed === seeded) return
		seeded = seed
		if (!untrack(() => draft)) setField(seed)
	})
	// The host keeps the draft (and counts its tokens): told as it changes.
	$effect(() => {
		const content = draft
		const t = setTimeout(() => void conv.request("draft", { content }), 150)
		return () => clearTimeout(t)
	})

	/**
	 * What the field is told to show. The field is the host's between writes
	 * (the caret stays on the page), so a write is a reset — and every reset
	 * must arrive, the same text included: the attachment removes the
	 * attribute first, since both Svelte and the renderer skip a write of the
	 * value they last wrote.
	 */
	let fieldValue = $state("")
	let fieldWrites = $state(0)
	function setField(text: string) {
		draft = text
		fieldValue = text
		fieldWrites++
	}
	const writeField = (el: HTMLElement) => {
		void fieldWrites
		const v = fieldValue
		el.removeAttribute("value")
		el.setAttribute("value", v)
	}

	function send() {
		const content = draft
		if (!content.trim()) return
		// Cleared once the host took it: a refused line (no persona) stays put.
		conv.ctx
			.request("send", { content, personaId: c?.personaId ?? null, channel: conv.lane.current })
			.then(
				() => {
					if (draft === content) setField("")
				},
				(e: Error) => console.warn(`Send: ${e.message}`)
			)
		paletteDismissed = null
		paletteHighlight = -1
	}

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

	// Enter submits at desktop widths only; on a touch keyboard it inserts a
	// newline like any other textarea.
	// Enter sends where there is a keyboard to press it on; a narrow box (a
	// phone's) keeps Enter for a new line, as a touch keyboard does.
	const submitOnEnter = $derived(conv.ctx.layout?.v1?.tier !== "compact")
	/** The Enter/Shift+Enter hint: shown once, remembered in the widget's saved state. */
	let hintSeen = $state(true)
	// ⏳ A native widget has no saved state yet: the hint is remembered per
	// mount until it does (a remote's `state` carries it).
	const saved = $derived(
		(conv.ctx as unknown as { state?: { hintSeen?: boolean } }).state
	)
	$effect(() => {
		hintSeen = !!saved?.hintSeen
	})
	let hintVisible = $state(false)

	const activePersona = $derived(
		c?.personas.find((p) => p.personaId === c?.personaId) ?? null
	)
	const personaCount = $derived(c?.personas.length ?? 0)

	const tabs = $derived(c?.tabs ?? [])
	let turnControls = $derived(tabs.find((t) => t.view === TURN_CONTROLS_VIEW))
	let morePanes = $derived(tabs.filter((t) => t.view !== TURN_CONTROLS_VIEW))
	let activePane = $derived(morePanes.find((t) => t.view === activePaneValue))
	let hasActionsRow = $derived(actionsListed || !!turnControls || overflowActions.length > 0)
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
		...(a.reason ? { reason: i18nText(a.reason.i18n, conv.ctx.locale.v1) ?? a.reason.i18n.en } : {}),
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
	const paletteQuery = $derived(slashQueryOf(draft))
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
				: (exactPaletteMatch(paletteActions, draft) ??
					(paletteQuery ? paletteRows[0] : undefined))
	)
	// Opening the palette is meeting its newcomers.
	$effect(() => {
		if (!paletteOpen) return
		const fresh = paletteRows.filter((a) => a.isNew)
		if (fresh.length) void conv.request("actions-seen", { keys: fresh.map(actionIdentity) })
	})

	function invokePalette(action: PaletteAction) {
		// The same gate the chips and the More menu apply (S5): the
		// audience, and nothing while a reply streams.
		if (paletteRowState(action, { generating: isGenerating, newest: newestItem }).disabled)
			return
		setField("")
		paletteDismissed = null
		paletteHighlight = -1
		conv.invoke(actionIdentity(action))
	}

	/**
	 * The keys the palette handles, which the field keeps from itself and
	 * raises as `key`: all four while it is open, Enter alone while the draft
	 * names an action exactly.
	 */
	const capturedKeys = $derived(
		paletteOpen
			? "ArrowUp ArrowDown Escape Enter Tab"
			: exactPaletteMatch(paletteActions, draft)
				? "Enter"
				: ""
	)

	/** True when the key was the palette's to handle. */
	function handlePaletteKey(e: { key: string; shiftKey: boolean; preventDefault: () => void }): boolean {
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
				setField(`/${pick.slash}`)
				return true
			}
			return false
		}
		// Closed: `/name` + Enter still invokes an exact match, so a name
		// typed in full never needs the list.
		if (e.key === "Enter" && !e.shiftKey) {
			const exact = exactPaletteMatch(paletteActions, draft)
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
			void conv.request("actions-seen", { keys: overflowNew.map(actionIdentity) })
	}
	let actionsLabelShown = $derived(showActions && hasActionsRow)

	let tokenCounts = $derived(c?.usage ?? null)
	let usageRatio = $derived(
		tokenCounts && tokenCounts.limit > 0
			? Math.min(tokenCounts.total / tokenCounts.limit, 1)
			: null
	)
	let contextExceeded = $derived(
		tokenCounts ? tokenCounts.total > tokenCounts.limit : false
	)

	const messages = $derived(conv.ctx.messages.v1 as Array<{ isGenerating?: boolean }>)
	let isGenerating = $derived(!!messages[messages.length - 1]?.isGenerating)
	let ragVisible = $derived(!!c?.notice && composerSkin !== "minimal")
	let placeholder = $derived(
		activePersona ? `Write as ${activePersona.name}…` : "Write a message…"
	)

	// A pane that has gone (a lorebook unbound, context debugging switched off)
	// hands the field area back. A mode with no field opens on its first panel,
	// because there is nothing else for the area to show.
	$effect(() => {
		const values = morePanes.map((p) => p.view)
		if (activePaneValue && !values.includes(activePaneValue)) {
			activePaneValue = null
		}
		if (hideCompose && !activePaneValue && values.length) {
			activePaneValue = values[0]
		}
	})

	/** The field raised a key the palette keeps (`keys`). */
	function handleFieldKey(e: CustomEvent<{ key: string; shift: boolean }>) {
		const ev = { key: e.detail.key, shiftKey: e.detail.shift, preventDefault() {} }
		if (handlePaletteKey(ev)) return
		// Enter reached here only as a captured key: the send key, then.
		if (ev.key === "Enter" && !ev.shiftKey && submitOnEnter) send()
	}

	function handleFieldFocus() {
		if (hintSeen || !submitOnEnter) return
		hintVisible = true
		hintSeen = true
		;(conv.ctx as unknown as { saveState?: (s: object) => void }).saveState?.({ ...(saved ?? {}), hintSeen: true })
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
	/** Escape closes the actions row (natively; a remote hears no keys). */
	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape" && actionsOpen && !overflowOpen) actionsOpen = false
	}
</script>

<!-- Escape closes the actions row: a keyboard shortcut over the whole group,
     not an interaction of its own (natively; a remote hears no keys). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="sp-composer px-3 pb-2 lg:pb-4"
	data-composer-skin={composerSkin}
	class:hidden={conv.edit.id !== null}
	onkeydown={handleKeyDown}
	role="group"
	aria-label="Compose"
>
	{#if c?.addPersona}
		<!-- Guests without a persona get the one thing they can do here. -->
		<div class="flex flex-col items-center justify-center gap-4 py-8">
			<div class="text-center">
				<sp-icon name="user-plus" size="48" class="text-surface-700-300 mx-auto mb-2"></sp-icon>
				<h3 class="h3 mb-2">Join the conversation</h3>
				<p class="text-surface-600-400">
					Add a persona to this session to send messages.
				</p>
			</div>
			<button
				class="btn preset-filled-primary-500"
				onclick={() => void conv.request("add-persona", {})}
			>
				<sp-icon name="user-plus" size="20"></sp-icon>
				Add your persona
			</button>
		</div>
	{:else}
		<!-- Above the composer, because a run in flight is about the message you
		     are about to get rather than the ones already there — and because it
		     has to stay visible while the transcript scrolls. -->
		<sp-host-view name="run-progress"></sp-host-view>

		<div class="composer-disclosure">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				{#if actionsLabelShown}
					<button
						type="button"
						class="composer-actions-toggle"
						aria-expanded={actionsOpen}
						aria-controls={actionsId}
						onclick={() => (actionsOpen = !actionsOpen)}
					>
						<span>Actions</span>
						<sp-icon name="chevron-down" size="12" class={actionsOpen ? "rotate-180" : ""}></sp-icon>
					</button>
				{/if}
				{#if ragVisible}
					<div class="rag-notice ml-auto min-w-0">
						<sp-host-view name="retrieval-notice"></sp-host-view>
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
					{#if actionsListed || overflowActions.length}
						<div class="composer-chips composer-chips-tonal">
							{#if actionsListed}
								<sp-host-view name="session-actions"></sp-host-view>
							{/if}
							{#if overflowActions.length}
								<!-- The overflow (R-15, F38): every enabled action
								     the primary row leaves out, never hidden by
								     prominence. A Menu — these are actions, not a
								     field. A newcomer marks the trigger until the
								     menu has been opened once. -->
								<!-- `sp-menu` (§3.5): each `sp-menu-item`'s own content is its row. -->
								<sp-menu
									placement="top-start"
									label="More actions"
									open={overflowOpen}
									onopen-change={(e: CustomEvent<{ open: boolean }>) =>
										handleOverflowOpen(e.detail.open)}
									onselect={(e: CustomEvent<{ value: string }>) => {
										const a = overflowActions.find(
											(x) => actionIdentity(x) === e.detail.value
										)
										// The wire's reason is a locale map; the palette's
										// shape carries a sentence, and the fire needs neither.
										if (a) conv.invoke(actionIdentity(a))
									}}
								>
									<button
										slot="trigger"
										type="button"
										class="btn btn-sm preset-tonal-surface relative"
										title="More actions"
										aria-label={overflowNew.length
											? `More actions (${overflowNew.length} new)`
											: "More actions"}
									>
										<sp-icon name="ellipsis" size="14"></sp-icon>
										More
										{#if overflowNew.length}
											<span class="sp-action-new-dot" aria-hidden="true"></span>
										{/if}
									</button>
									{#each overflowActions as a (actionIdentity(a))}
										{@const iconName = a.icon || "play"}
										{@const row = paletteRowState(overflowRow(a), {
											generating: isGenerating,
											newest: newestItem
										})}
										<!-- Grey, listed, with its reason (R-15, U5e): the
										     audience's word, the declared enabled-when's, or
										     the busy rule — as a second line and to a screen
										     reader, never dropped from the list. -->
										<sp-menu-item
											value={actionIdentity(a)}
											disabled={row.disabled}
											class="flex items-center gap-2 text-xs"
										>
											<sp-icon name={iconName} size="12"></sp-icon>
											<span>
												{a.name}
												<span class="text-surface-500 ml-1 font-mono text-[0.85em]">/{a.slash}</span>
												{#if row.reason}
													<span class="composer-palette-note block">{row.reason}</span>
												{/if}
											</span>
											{#if a.isNew}
												<span class="sp-action-new">New</span>
											{/if}
										</sp-menu-item>
									{/each}
								</sp-menu>
							{/if}
						</div>
					{/if}
					{#if turnControls}
						<div class="composer-chips composer-chips-outlined">
							<sp-host-view name="session-controls"></sp-host-view>
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
						class="composer-meter-fill sp-meter-fill"
						class:is-high={usageRatio > 0.9}
						style="--sp-fill: {(usageRatio * 100).toFixed(1)}%"
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
								<sp-icon name="arrow-left" size="14"></sp-icon>
								Back to compose
							</button>
						{/if}
					</div>
					<div role="region" aria-label="{activePane.title} panel">
						<sp-host-view name={activePane.view}></sp-host-view>
					</div>
				{:else if previewOpen}
					<div
						class="rendered-session-message-content composer-preview"
						role="region"
						aria-label="Message preview"
					>
						<sp-message-body text={draft}></sp-message-body>
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
								{@const iconName = a.icon || "play"}
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
										<sp-icon name={iconName} size="14"></sp-icon>
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
					<!-- The field inside takes focus and carries the ARIA: this is its host element. -->
					<!-- svelte-ignore a11y_aria_activedescendant_has_tabindex -->
					<sp-composer-field
						class="block"
						field-class="composer-field field-sizing-content focus:outline-none focus:ring-0 focus:border-transparent"
						rows="1"
						label="Write a message"
						{placeholder}
						submit-on={submitOnEnter ? "enter" : "none"}
						keys={capturedKeys}
						spellcheck="true"
						aria-describedby={contextExceeded ? warningId : undefined}
						aria-invalid={contextExceeded ? "true" : undefined}
						aria-autocomplete={paletteActions.length ? "list" : undefined}
						aria-controls={paletteOpen ? paletteId : undefined}
						aria-activedescendant={paletteOpen && paletteHighlight >= 0
							? paletteOptionId(paletteHighlight)
							: undefined}
						oninput={(e: CustomEvent<{ value: string }>) => (draft = e.detail.value)}
						onsubmit={(e: CustomEvent<{ value: string }>) => {
							draft = e.detail.value
							send()
						}}
						onkey={handleFieldKey}
						onfocus={handleFieldFocus}
						{@attach writeField}
					></sp-composer-field>
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
								class:preset-tonal-primary={slug === conv.lane.current}
								class:is-active={slug === conv.lane.current}
								aria-pressed={slug === conv.lane.current}
								title="Write on {channelLabel(slug)}"
								onclick={() => conv.lane.set(slug)}
							>
								{channelLabel(slug)}
							</button>
						{/each}
					</div>
				{/if}
				{#if activePersona}
					{#if personaCount > 1}
						<!-- `sp-popover` (§3.5): our button is the trigger, the card the panel. -->
						<sp-popover
							placement="top-start"
							open={personaSwitcherOpen}
							onopen-change={(e: CustomEvent<{ open: boolean }>) => (personaSwitcherOpen = e.detail.open)}
						>
							<button slot="trigger" type="button" class="composer-persona-chip is-button"
								title="Switch persona"
								aria-label="Switch persona (currently {activePersona.name})">
								<sp-avatar ref={`character:${activePersona.personaId}`} size="sm"></sp-avatar>
								<span class="composer-persona-name">
									{activePersona.name}
								</span>
								<sp-icon name="chevron-down" size="14"></sp-icon>
							</button>
							<div class="card preset-filled-surface-100-900-surface min-w-[200px] space-y-1 p-2">
								<p class="text-surface-600 dark:text-surface-400 px-2 pb-1 text-xs">
									Write as
								</p>
								{#each c?.personas ?? [] as p (p.personaId)}
									<button
										type="button"
										class="btn btn-sm popover-menu-btn rounded-lg {p.personaId === c?.personaId
											? 'preset-tonal-primary'
											: 'hover:preset-tonal'}"
										aria-current={p.personaId === c?.personaId ? "true" : undefined}
										onclick={() => {
											void conv.request("switch-persona", { personaId: p.personaId })
											personaSwitcherOpen = false
										}}
									>
										<sp-avatar ref={`character:${p.personaId}`} size="sm"></sp-avatar>
										<span class="truncate">{p.name}</span>
									</button>
								{/each}
							</div>
						</sp-popover>
					{:else}
						<span class="composer-persona-chip">
							<sp-avatar ref={`character:${activePersona.personaId}`} size="sm"></sp-avatar>
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
							<sp-icon name="eye" size="16"></sp-icon>
						</button>
					{/if}

					{#if morePanes.length > 0}
						<!-- `sp-popover` (§3.5): our button is the trigger, the card the panel. -->
						<sp-popover
							placement="top-end"
							open={moreMenuOpen}
							onopen-change={(e: CustomEvent<{ open: boolean }>) => (moreMenuOpen = e.detail.open)}
						>
							<button slot="trigger" type="button" class="composer-icon-btn {activePane
									? 'preset-tonal-primary is-active'
									: ''}"
								title="More"
								aria-label="More composer panels">
								<sp-icon name="ellipsis-vertical" size="16"></sp-icon>
							</button>
							<div class="card bg-surface-100-900 w-[min(90vw,240px)] space-y-3 p-3 shadow-xl">
										<header
											class="popover-menu-title text-sm"
										>
											<sp-icon name="ellipsis-vertical" size="16"></sp-icon>
											<p>More</p>
										</header>
										<div class="flex flex-col gap-1">
											{#each morePanes as pane (pane.view)}
												<button
													type="button"
													class="btn btn-sm popover-menu-btn rounded-lg {activePaneValue ===
													pane.view
														? 'preset-tonal-primary'
														: 'hover:preset-tonal'}"
													onclick={() =>
														openPane(pane.view)}
												>
													<sp-icon name={pane.icon} size="12"></sp-icon>
													<span>{pane.title}</span>
												</button>
											{/each}
										</div>
							</div>
						</sp-popover>
					{/if}

					{#if !hideCompose}
						{#if isGenerating}
							<button
								type="button"
								class="btn composer-send preset-tonal-error"
								title="Stop"
								aria-label="Stop generating"
								onclick={() => conv.invoke("stop")}
							>
								<sp-icon name="square"></sp-icon>
								<span>Stop</span>
							</button>
						{:else}
							<button
								type="button"
								class="btn composer-send {sendTonal
									? 'preset-tonal-primary'
									: 'preset-filled-primary-500'}"
								disabled={!draft.trim()}
								title="Send"
								aria-label="Send message"
								onclick={send}
							>
								<sp-icon name="send"></sp-icon>
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
