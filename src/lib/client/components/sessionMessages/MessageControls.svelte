<script lang="ts">
	import {
		coreVerbState,
		verbKeyOf,
		verdictOf,
		type VerbContext
	} from "$lib/client/components/sessionMessages/messageVerbState"
	import { actionIdentity } from "$lib/shared/actions/identity"
	import { useConversation } from "./conversation.svelte"

	/**
	 * A message's ⋮ menu: every verb the session offers on it, named in words.
	 * Everything else — whose menu is open, what the viewer controls, the
	 * session's list, why Continue is refused — is the conversation's
	 * (`useConversation`), and every press is one of its verbs (C0b).
	 */
	interface Props {
		msg: SelectSessionMessage
		isLastMessage?: boolean
	}

	let { msg, isLastMessage = false }: Props = $props()

	const conv = useConversation()
	const open = $derived(conv.menu.open === msg.id)
	const onOpenChange = (next: boolean) => conv.menu.set(next ? msg.id : undefined)
	const canControl = $derived(conv.line(msg.id).controllable)
	const continueRefusal = $derived(conv.dossier?.continueRefusal)
	const hasGeneratingMessage = $derived(
		(conv.ctx.messages.v1 as Array<{ isGenerating?: boolean }>).some((m) => m.isGenerating)
	)
	const messageActions = $derived(
		conv.ctx.actions?.v1?.message as
			| { primary: Sockets.Sessions.Actions.Action[]; overflow: Sockets.Sessions.Actions.Action[] }
			| undefined
	)
	const isAdmin = $derived(conv.ctx.viewer.v1.isAdmin)

	function closeMenu() {
		onOpenChange(false)
	}

	/**
	 * **Change sprite** (DESIGN-sprites §6): a character's settled line, and a
	 * person who may act on it. The picker is the host's (`change-sprite`
	 * request, C0b): it loads the sprites and sends the pick itself.
	 */
	let canChangeSprite = $derived(
		canControl &&
			!!msg.characterId &&
			!msg.isNarratorResponse &&
			!msg.isGenerating
	)

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
		editing: conv.edit.id !== null,
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

	/** Fire a core verb by its key: the conversation's verb, or its own edit. */
	function fireCore(_e: Event, key: string) {
		closeMenu()
		if (key === "edit") return conv.edit.start(msg)
		if (key === "swipe") return conv.swipe(msg, "right")
		conv.invoke(key, msg)
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

	/**
	 * "Inspect run" (R55: administrators only): the host finds the run that
	 * wrote this reply and opens the inspector (`inspect-run`), or says there
	 * is none.
	 */
	const isReply = $derived(!!msg.characterId || !!msg.isNarratorResponse)

	/**
	 * The mark clears the moment the menu that lists the newcomers opens:
	 * the person has now met them.
	 */
	$effect(() => {
		if (!open || !hasNew) return
		void conv.request("actions-seen", {
			keys: contributedRows.filter((r) => r.action.isNew).map((r) => actionIdentity(r.action))
		})
	})
</script>

<!-- The ⋮ menu: every action this message offers, named in words. The row's
     quick icons call the same handlers; this is the complete list. -->
<div class="sp-msg-menu-root">
	<!-- `sp-popover` (§3.5): the host's positioned panel. The trigger slot is
	     our own button; the body is the panel. -->
	<sp-popover
		placement="bottom-end"
		label="Message options"
		{open}
		onopen-change={(e: CustomEvent<{ open: boolean }>) => onOpenChange(e.detail.open)}
	>
		<button slot="trigger" type="button" class="sp-msg-icon-btn" aria-label="Message options">
			<sp-icon name="ellipsis-vertical" size="16"></sp-icon>
		</button>
				<div class="card bg-surface-200-800 w-[min(90vw,320px)] space-y-4 p-4">
					<header class="popover-menu-title">
						<sp-icon name="ellipsis-vertical" size="18"></sp-icon>
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
							{@const iconName = action.icon || "play"}
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
								<sp-icon name={iconName} size="16"></sp-icon>
								<span>{nameOf(action)}</span>
							</button>
							{#if state.reason}
								<span id={noteIdOf(action)} class="sr-only">
									{state.reason}
								</span>
							{/if}
						{/each}
						{#if conv.dossier?.writes.lore && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="Select for summary"
								aria-label="Select this message for summarization"
								disabled={conv.edit.id !== null || hasGeneratingMessage}
								onclick={() => {
									closeMenu()
									conv.select.start(msg)
								}}
							>
								<sp-icon name="book-marked" size="16"></sp-icon>
								<span>Select for summary</span>
							</button>
						{/if}
						{#if canChangeSprite}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="Choose the face this line shows"
								onclick={() => {
									closeMenu()
									void conv.request("change-sprite", { messageId: msg.id })
								}}
							>
								<sp-icon name="drama" size="16"></sp-icon>
								<span>Change sprite</span>
							</button>
						{/if}
						{#if isAdmin && isReply && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="See what the pipeline did for this reply"
								onclick={() => {
									closeMenu()
									void conv.request("inspect-run", { messageId: msg.id })
								}}
							>
								<sp-icon name="receipt" size="16"></sp-icon>
								<span>Inspect run</span>
							</button>
						{/if}
						{#if conv.dossier?.debugPrompts && (msg as any).debugMeta && !msg.isGenerating}
							<button
								class="btn btn-sm popover-menu-btn hover:preset-tonal-surface"
								title="Prompt details"
								onclick={() => {
									closeMenu()
									void conv.request("prompt-details", { messageId: msg.id })
								}}
							>
								<sp-icon name="info" size="16"></sp-icon>
								<span>Prompt details</span>
							</button>
						{/if}
						{#if contributedRows.length}
							<!-- The contributed entries (19 §4): after core's
							     verbs, separated so a plugin's never reads as
							     one of core's. A newcomer wears its mark until
							     this menu has been opened once. -->
							<hr class="hr" />
							{#each contributedRows as { action, state } (actionIdentity(action))}
								{@const iconName = action.icon || "play"}
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
										conv.invoke(actionIdentity(action), msg)
									}}
								>
									<sp-icon name={iconName} size="16"></sp-icon>
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
				</div>
	</sp-popover>
</div>

