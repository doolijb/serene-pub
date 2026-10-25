<script lang="ts">
	/**
	 * **Messages** — private conversations between people on this pub
	 * (PLAN-private-messages-2026-10-12 §6.3). A list-with-detail view on
	 * `PanelSplit` (380px list, rows carry faces): the list column groups
	 * conversations under **Unread · Recent · Older**; the detail is one
	 * conversation (`ConversationDetail`) or one person (`PersonDetail`).
	 *
	 * Everything it shows and does goes through the conversations context
	 * (`useConversations`), the one subscriber to the `conversations:`
	 * family; this view listens to no socket of its own. It tells the context
	 * what is on screen (`setViewing` / `setViewingPerson`) while it is the
	 * active view, so a message arriving where the reader is looking is not
	 * counted unread and the Focus address follows.
	 *
	 * Ways in from outside: `digest.viewConversationId` and
	 * `digest.viewPersonId` (an address, a notification, a face elsewhere),
	 * consumed once, the `viewCharacterId` pattern.
	 */
	import { getContext, onDestroy } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { ConversationSummary } from "$lib/shared/sockets/conversations"
	import {
		onChanged,
		useConversations
	} from "$lib/client/contexts/conversations.svelte"
	import { ViewModeTracker } from "$lib/client/shell/viewMode.svelte"
	import { timeAgoShort } from "$lib/client/utils/timeAgo"
	import PanelSplit from "../panels/PanelSplit.svelte"
	import ViewToolbar from "../panels/ViewToolbar.svelte"
	import PanelFilterInput from "../panels/PanelFilterInput.svelte"
	import ListGroupLabel from "../panels/ListGroupLabel.svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import EmptyState from "../EmptyState.svelte"
	import LoadingState from "../LoadingState.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import ConversationDetail from "../conversations/ConversationDetail.svelte"
	import PersonDetail from "../conversations/PersonDetail.svelte"
	import {
		conversationMatches,
		conversationTitle,
		groupConversations,
		otherMembers,
		personName
	} from "../conversations/groupMessages"

	interface Props {
		/** The view's close gate. Nothing here is unsaved (drafts are kept),
		 *  so it is never set; bindable to match the shell's other views. */
		onclose?: () => Promise<boolean> | undefined
	}

	let { onclose = $bindable() }: Props = $props()

	const ctx = useConversations()
	const panelsCtx: PanelsCtx = $state(getContext("panelsCtx"))
	const userCtx: { user: SelectUser | undefined } = getContext("userCtx")
	const vm = new ViewModeTracker()

	const meId = $derived(userCtx.user?.id ?? null)
	const isAdmin = $derived(!!userCtx.user?.isAdmin)
	const active = $derived(panelsCtx.activeView === "conversations")

	let search = $state("")
	let conversationId = $state<number | null>(null)
	let personId = $state<number | null>(null)
	let pickerOpen = $state(false)
	let listRefusal = $state<string | null>(null)

	// ── ways in ────────────────────────────────────────────────────────────

	$effect(() => {
		const c = panelsCtx.digest.viewConversationId
		const p = panelsCtx.digest.viewPersonId
		if (c != null) {
			conversationId = c
			personId = null
			delete panelsCtx.digest.viewConversationId
		} else if (p != null) {
			personId = p
			conversationId = null
			delete panelsCtx.digest.viewPersonId
		}
	})

	// What is on screen, for the context: only while this view is the one
	// shown, so a hidden tab never swallows an unread message.
	$effect(() => {
		if (active && conversationId !== null) ctx.setViewing(conversationId)
		else if (active && personId !== null) ctx.setViewingPerson(personId)
		else {
			ctx.setViewing(null)
			ctx.setViewingPerson(null)
		}
	})
	onDestroy(() => {
		ctx.setViewing(null)
		ctx.setViewingPerson(null)
	})

	// The roster, so an empty pub can say so.
	$effect(() => {
		if (!ctx.enabled || ctx.peopleLoaded) return
		ctx.loadPeople().catch(() => {})
	})

	// Removed from the open conversation elsewhere: back to the list.
	onChanged((push) => {
		if (push.removed && push.conversationId === conversationId)
			conversationId = null
	})

	// ── the list ──────────────────────────────────────────────────────────

	const filtered = $derived(
		ctx.conversations.filter((c) => conversationMatches(c, meId, search))
	)
	const groups = $derived(groupConversations(filtered))

	function openConversation(id: number) {
		conversationId = id
		personId = null
	}
	function openPerson(id: number) {
		personId = id
		conversationId = null
	}
	function back() {
		conversationId = null
		personId = null
	}

	/** `Author: excerpt`, the author being "You" for the reader. */
	function lastLine(c: ConversationSummary): { author: string; excerpt: string } | null {
		const last = c.lastMessage
		if (!last) return null
		const author =
			last.authorUserId === null
				? "Former member"
				: last.authorUserId === meId
					? "You"
					: personName(
							c.members.find((m) => m.id === last.authorUserId) ??
								ctx.whoIs(last.authorUserId)
						)
		return { author, excerpt: last.excerpt }
	}

	async function startConversation(ids: number[], name?: string) {
		if (!ids.length) return
		listRefusal = null
		try {
			const reply = await ctx.create(ids, ids.length > 1 ? name : undefined)
			openConversation(reply.conversation.id)
		} catch (err) {
			listRefusal =
				err instanceof Error ? err.message : "Couldn't start that conversation."
		}
	}

	const nobodyElse = $derived(ctx.peopleLoaded && ctx.people.length === 0)
</script>

<div class="flex h-full min-h-0 flex-col" use:vm.observe data-view="conversations">
	<!-- `listFills` (L7, 2026-10-24): nothing open, the list sits centred
	     at its own 560px instead of beside an empty pane. -->
	<PanelSplit
		mode={vm.mode}
		listWidth="380px"
		hasDetail={conversationId !== null || personId !== null}
		listFills
		fillWidth="list"
		emptyMessage="Pick a conversation, or start one with New conversation."
	>
		{#snippet toolbar()}
			<ViewToolbar label="Messages" primary={newButton}>
				{#snippet filter()}
					<PanelFilterInput
						bind:value={search}
						placeholder="conversations"
						singular="conversation"
						count={ctx.conversations.length}
						aria-label="Filter conversations by name or person"
					/>
				{/snippet}
			</ViewToolbar>
			{#if listRefusal}
				<p class="text-error-600-400 mt-2 text-sm" role="alert">{listRefusal}</p>
			{/if}
		{/snippet}

		{#snippet list()}
			{#if !ctx.loaded}
				<LoadingState message="Loading conversations…" />
			{:else if ctx.conversations.length === 0}
				{#if nobodyElse}
					<EmptyState
						icon={Icons.Mail}
						message="Nobody else has an account on this pub yet."
						ctaLabel={isAdmin ? "Open Users" : undefined}
						onCta={isAdmin
							? () => panelsCtx.openView("users", { toggle: false })
							: undefined}
					/>
				{:else}
					<EmptyState
						icon={Icons.Mail}
						message="No messages yet. Start one with New conversation."
						ctaLabel="New conversation"
						onCta={() => (pickerOpen = true)}
					/>
				{/if}
			{:else if filtered.length === 0}
				<EmptyState
					icon={Icons.Search}
					message={`No conversations match "${search.trim()}".`}
				/>
			{:else}
				{#each groups as group (group.key)}
					<ListGroupLabel
						label={group.label}
						id="conversations-group-{group.key}"
					/>
					<div
						class="flex flex-col gap-1"
						role="list"
						aria-labelledby="conversations-group-{group.key}"
					>
						{#each group.rows as c (c.id)}
							{@render row(c)}
						{/each}
					</div>
				{/each}
			{/if}
		{/snippet}

		{#snippet detail()}
			{#if conversationId !== null}
				{#key conversationId}
					<ConversationDetail
						{conversationId}
						{meId}
						{active}
						onBack={vm.mode === "compact" ? back : undefined}
						onOpenPerson={openPerson}
						onGone={back}
					/>
				{/key}
			{:else if personId !== null}
				{#key personId}
					<PersonDetail
						userId={personId}
						onBack={vm.mode === "compact" ? back : undefined}
						onOpenConversation={openConversation}
					/>
				{/key}
			{/if}
		{/snippet}
	</PanelSplit>
</div>

{#snippet newButton()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500 shrink-0"
		onclick={() => (pickerOpen = true)}
		disabled={nobodyElse}
		title={nobodyElse ? "Nobody else has an account on this pub yet" : undefined}
	>
		<Icons.Plus size={16} aria-hidden="true" />
		New conversation
	</button>
{/snippet}

{#snippet row(c: ConversationSummary)}
	{@const others = otherMembers(c, meId)}
	{@const name = conversationTitle(c, meId)}
	{@const line = lastLine(c)}
	{@const when = timeAgoShort(c.lastMessageAt ?? c.createdAt)}
	<SidebarListItem
		itemType="Conversation"
		contentTitle={name}
		showIndex={false}
		active={vm.mode === "desk" && conversationId === c.id}
		onclick={() => openConversation(c.id)}
	>
		{#snippet content()}
			<span class="flex shrink-0" title={others.map(personName).join(", ")}>
				<AvatarStack
					members={others.map((m) => ({
						name: personName(m),
						avatarMediaId: m.avatarMediaId
					}))}
					fallback="initial"
					size="md"
					max={3}
					ring="ring-surface-200-800"
				/>
			</span>
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex min-w-0 items-center gap-1.5">
					<span
						class="truncate text-left text-lead {c.unread > 0
							? 'font-semibold'
							: 'font-medium'}"
					>
						{name}
					</span>
					{#if c.mutedAt}
						<span class="shrink-0 leading-none" title="Muted">
							<Icons.BellOff size={14} class="text-surface-500" aria-hidden="true" />
							<span class="sr-only">Muted</span>
						</span>
					{/if}
					<span class="ml-auto flex shrink-0 items-center gap-1">
						{#if c.unread > 0}
							<span
								class="bg-primary-500 size-1.5 rounded-full"
								title="{c.unread} unread"
								aria-hidden="true"
							></span>
							<span class="sr-only">{c.unread} unread</span>
						{/if}
						{#if when}
							<span class="text-surface-600-400 text-xs">{when}</span>
						{/if}
					</span>
				</div>
				<div class="text-surface-600-400 truncate text-left text-xs">
					{#if line}
						<span class="text-surface-700-300">{line.author}:</span>
						{line.excerpt}
					{:else}
						Nothing said yet
					{/if}
				</div>
			</div>
		{/snippet}
	</SidebarListItem>
{/snippet}

<UserSelectModal
	open={pickerOpen}
	source="conversations:people"
	multiSelect
	askName
	title="New conversation"
	description="Pick one person for a direct conversation, or several for a group."
	confirmLabel={(n) => (n === 1 ? "Start conversation" : `Start with ${n} people`)}
	onclose={() => (pickerOpen = false)}
	onSelect={() => {}}
	onMultiSelect={(ids, _users, name) => void startConversation(ids, name)}
/>
