<script lang="ts">
	import { realDateTime } from "$lib/client/utils/realTime.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	/**
	 * One conversation in the Messages view (PLAN-private-messages §6.3): the
	 * nav header with its `⋯`, the member strip, the **log** and the composer
	 * pinned under it.
	 *
	 * The log is uniform rows for everybody, the reader included (ruled Q5: no
	 * bubbles, no own-side alignment): a face, the name and the time, the
	 * body rendered from markdown under the STRICT profile, then attachment
	 * cards. One author's follow-ons within five minutes drop the face and
	 * name (`groupMessages`). Oldest at the top; it stays pinned to the
	 * bottom while the reader is there, and **Load earlier** pages back.
	 *
	 * Reading: while this is on screen in the active view, the document is
	 * visible and focused, and something unread has stood for 1.5 s (the
	 * notifications auto-read dwell), it is marked read up to the newest
	 * message.
	 */
	import { onMount, tick, untrack } from "svelte"
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import type { ConversationMessageRow } from "$lib/shared/sockets/conversations"
	import {
		onMessage,
		useConversations
	} from "$lib/client/contexts/conversations.svelte"
	import { onConnect } from "$lib/client/sockets/interest.svelte"
	import { renderStrictMarkdown } from "$lib/client/utils/markdownToHTML"
	import { timeAgo } from "$lib/client/utils/timeAgo"
	import PanelNavHeader from "../panels/PanelNavHeader.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import Avatar from "../Avatar.svelte"
	import EmptyState from "../EmptyState.svelte"
	import LoadingState from "../LoadingState.svelte"
	import UserSelectModal from "../modals/UserSelectModal.svelte"
	import ConversationAttachmentCard from "./ConversationAttachmentCard.svelte"
	import ConversationComposer from "./ConversationComposer.svelte"
	import {
		conversationTitle,
		groupMessages,
		otherMembers,
		personName
	} from "./groupMessages"

	interface Props {
		conversationId: number
		meId: number | null
		/** The Messages view is the one on screen (`panelsCtx.activeView`). */
		active: boolean
		/** Back to the list; only when the list is off screen (compact). */
		onBack?: () => void
		/** Open a member's person detail. */
		onOpenPerson: (userId: number) => void
		/** The reader left, or the conversation is not theirs any more. */
		onGone: () => void
	}

	let { conversationId, meId, active, onBack, onOpenPerson, onGone }: Props =
		$props()

	const ctx = useConversations()

	/** How long something unread must be on screen before it is marked read. */
	const READ_DWELL_MS = 1500
	const STRIP_MAX = 6

	const summary = $derived(ctx.summaryOf(conversationId))
	const page = $derived(ctx.messagesOf(conversationId))
	const rows = $derived(page ? groupMessages(page.messages) : [])
	const title = $derived(
		summary ? conversationTitle(summary, meId) : "Conversation"
	)
	const others = $derived(summary ? otherMembers(summary, meId) : [])
	const isGroup = $derived(summary?.kind === "group")
	const isHost = $derived(
		!!summary && meId !== null && summary.hostUserId === meId
	)
	const muted = $derived(!!summary?.mutedAt)

	let failure = $state<string | null>(null)
	let loadingEarlier = $state(false)

	// ── loading ────────────────────────────────────────────────────────────

	function load(id: number) {
		failure = null
		ctx.open(id).catch((err: unknown) => {
			if (id === conversationId)
				failure =
					err instanceof Error
						? err.message
						: "That conversation isn't available."
		})
	}
	$effect(() => {
		const id = conversationId
		untrack(() => {
			stick = true
			load(id)
		})
	})
	// A socket that came back has missed the pushes: the newest page again.
	onMount(() => onConnect(() => load(conversationId)))

	async function loadEarlier() {
		const first = page?.messages[0]
		if (!first || loadingEarlier || !log) return
		loadingEarlier = true
		const before = log.scrollHeight
		try {
			await ctx.open(conversationId, first.id)
			await tick()
			// Keep the reader's place: the page grew above them.
			if (log) log.scrollTop += log.scrollHeight - before
		} catch {
			// The page stays as it was; the button is there to try again.
		} finally {
			loadingEarlier = false
		}
	}

	// ── the log's scroll ───────────────────────────────────────────────────

	let log: HTMLDivElement | undefined = $state()
	/** The reader is at the bottom, so new messages keep them there. */
	let stick = true

	function onScroll() {
		if (!log) return
		stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48
	}
	function toBottom() {
		if (log) log.scrollTop = log.scrollHeight
	}
	$effect(() => {
		void rows.length
		void page?.messages.at(-1)?.id
		if (!untrack(() => stick)) return
		void tick().then(toBottom)
	})
	onMessage((push) => {
		if (push.conversationId !== conversationId) return
		// One's own send lands at the bottom whatever the scroll said.
		if (push.change === "new" && push.message.authorUserId === meId)
			stick = true
	})

	// ── reading marks ─────────────────────────────────────────────────────

	let visible = $state(true)
	let focused = $state(true)
	onMount(() => {
		visible = document.visibilityState === "visible"
		focused = document.hasFocus()
		const onVisibility = () =>
			(visible = document.visibilityState === "visible")
		const onFocus = () => (focused = true)
		const onBlur = () => setTimeout(() => (focused = document.hasFocus()), 0)
		document.addEventListener("visibilitychange", onVisibility)
		window.addEventListener("focus", onFocus)
		window.addEventListener("blur", onBlur)
		return () => {
			document.removeEventListener("visibilitychange", onVisibility)
			window.removeEventListener("focus", onFocus)
			window.removeEventListener("blur", onBlur)
		}
	})

	/** The highest id this view has marked, per conversation. */
	const markedUpTo = new Map<number, number>()
	$effect(() => {
		if (!active || !visible || !focused) return
		const id = conversationId
		const last = page?.messages.at(-1)
		if (!last) return
		const unread = summary?.unread ?? 0
		const marked = markedUpTo.get(id) ?? 0
		const fromOthers = last.authorUserId !== meId
		if (last.id <= marked) return
		if (unread <= 0 && !fromOthers) return
		const timer = setTimeout(() => {
			markedUpTo.set(id, last.id)
			ctx.markRead(id, last.id)
		}, READ_DWELL_MS)
		return () => clearTimeout(timer)
	})

	// ── message actions ───────────────────────────────────────────────────

	let editingId = $state<number | null>(null)
	let editText = $state("")
	let editRefusal = $state<string | null>(null)

	function startEdit(m: ConversationMessageRow) {
		editingId = m.id
		editText = m.body
		editRefusal = null
	}
	async function saveEdit() {
		const id = editingId
		if (id === null) return
		const body = editText.trim()
		if (!body) return
		try {
			await ctx.edit(id, body)
			editingId = null
		} catch (err) {
			editRefusal = err instanceof Error ? err.message : "That edit wasn't saved."
		}
	}

	/** One question before a verb that only takes away (STYLE-GUIDE §6.6). */
	let confirm = $state<{
		title: string
		body: string
		yes: string
		run: () => Promise<unknown>
	} | null>(null)
	let confirmRefusal = $state<string | null>(null)
	async function answerYes() {
		if (!confirm) return
		confirmRefusal = null
		try {
			await confirm.run()
			confirm = null
		} catch (err) {
			confirmRefusal =
				err instanceof Error ? err.message : "That didn't go through."
		}
	}

	// ── conversation actions ──────────────────────────────────────────────

	let renameOpen = $state(false)
	let renameText = $state("")
	let renameRefusal = $state<string | null>(null)
	let addOpen = $state(false)
	let membersOpen = $state(false)
	let actionRefusal = $state<string | null>(null)

	async function saveRename() {
		const name = renameText.trim()
		if (!name) return
		renameRefusal = null
		try {
			await ctx.rename(conversationId, name)
			renameOpen = false
		} catch (err) {
			renameRefusal = err instanceof Error ? err.message : "That name wasn't saved."
		}
	}

	function act(run: () => Promise<unknown>) {
		actionRefusal = null
		run().catch((err: unknown) => {
			actionRefusal =
				err instanceof Error ? err.message : "That didn't go through."
		})
	}

	const menuItems = $derived([
		isGroup &&
			isHost && {
				label: "Rename",
				icon: Icons.Pencil,
				onSelect: () => {
					renameText = summary?.name ?? ""
					renameRefusal = null
					renameOpen = true
				}
			},
		isGroup &&
			isHost && {
				label: "Add people",
				icon: Icons.UserPlus,
				onSelect: () => (addOpen = true)
			},
		isGroup && {
			label: "People in this conversation",
			icon: Icons.Users,
			onSelect: () => (membersOpen = true)
		},
		{
			label: muted ? "Unmute" : "Mute",
			icon: muted ? Icons.Bell : Icons.BellOff,
			onSelect: () => act(() => ctx.mute(conversationId, !muted))
		},
		isGroup && { separator: true as const },
		isGroup && {
			label: "Leave",
			icon: Icons.LogOut,
			destructive: true,
			onSelect: () => {
				confirmRefusal = null
				confirm = {
					title: "Leave this conversation?",
					body: `You stop getting its messages and it leaves your list. ${
						isHost
							? "Someone else here becomes its host. "
							: ""
					}What you wrote stays for the others.`,
					yes: "Leave",
					run: async () => {
						await ctx.leave(conversationId)
						onGone()
					}
				}
			}
		}
	])

	function authorOf(m: ConversationMessageRow) {
		if (m.authorUserId === null) return null
		return (
			summary?.members.find((p) => p.id === m.authorUserId) ??
			ctx.whoIs(m.authorUserId)
		)
	}
	function fullTime(iso: string): string {
		const d = new Date(iso)
		return Number.isNaN(d.getTime()) ? "" : realDateTime(d)
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3" data-conversation-detail>
	<PanelNavHeader
		{title}
		{onBack}
		backLabel="Back to messages"
		actionsLabel="Conversation"
		{menuItems}
	>
		{#snippet subtitle()}
			{#if others.length}
				<!-- The member strip: xs faces and names, each opening the
				     person's detail; past six, a count. -->
				<ul class="flex min-w-0 flex-wrap items-center gap-1" aria-label="People">
					{#each others.slice(0, STRIP_MAX) as person (person.id)}
						<li>
							<button
								type="button"
								class="hover:bg-surface-200-800 flex min-h-11 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs"
								onclick={() => onOpenPerson(person.id)}
								title="See {personName(person)}"
							>
								<Avatar
									src={avatarSrc(person)}
									name={personName(person)}
									fallback="initial"
									size="xs"
									decorative
								/>
								<span class="max-w-32 truncate">{personName(person)}</span>
							</button>
						</li>
					{/each}
					{#if others.length > STRIP_MAX}
						<li class="text-surface-600-400 px-1 text-xs">
							+{others.length - STRIP_MAX}
						</li>
					{/if}
					{#if muted}
						<li class="text-surface-600-400 flex items-center gap-1 px-1 text-xs">
							<Icons.BellOff size={14} class="text-surface-500" aria-hidden="true" />
							Muted
						</li>
					{/if}
				</ul>
			{/if}
		{/snippet}
	</PanelNavHeader>

	{#if actionRefusal}
		<p class="text-error-600-400 text-sm" role="alert">{actionRefusal}</p>
	{/if}

	{#if failure}
		<EmptyState icon={Icons.MessageSquareOff} message={failure} />
	{:else}
		<!-- The log: the one scroller, with no padding on it (STYLE-GUIDE
		     §5.2) — the inset is the inner wrapper's margin. -->
		<div
			bind:this={log}
			class="min-h-0 flex-1 overflow-y-auto"
			onscroll={onScroll}
			role="log"
			aria-label="Messages with {title}"
			data-conversation-log
		>
			<div class="mx-1 mb-2 flex min-h-full flex-col">
				{#if !page}
					<LoadingState message="Loading messages…" />
				{:else}
					{#if page.hasEarlier}
						<div class="flex justify-center py-2">
							<button
								type="button"
								class="btn btn-sm preset-tonal-surface min-h-11"
								onclick={loadEarlier}
								disabled={loadingEarlier}
								aria-busy={loadingEarlier}
							>
								<Icons.ArrowUp size={14} aria-hidden="true" />
								Load earlier
							</button>
						</div>
					{/if}
					{#if rows.length === 0}
						<p class="text-surface-600-400 m-auto py-8 text-center text-sm">
							Nothing here yet. Say hello below.
						</p>
					{:else}
						<!-- Pushed to the bottom while short, like a page of
						     chat: the newest line sits by the composer. -->
						<div class="mt-auto"></div>
					{/if}
					{#each rows as { message: m, showHead } (m.id)}
						{@const author = authorOf(m)}
						{@const name = author ? personName(author) : "Former member"}
						{@const own = m.authorUserId !== null && m.authorUserId === meId}
						{@const removed = !!m.deletedAt}
						<article
							class="group flex gap-3 {showHead ? 'mt-3' : 'mt-0.5'}"
							aria-label="{name}, {fullTime(m.createdAt)}"
							data-message-id={m.id}
							data-show-head={showHead || undefined}
						>
							<div class="w-11 shrink-0">
								{#if showHead}
									{#if author}
										<button
											type="button"
											class="grid size-11 place-items-center rounded-full"
											onclick={() => onOpenPerson(author.id)}
											aria-label="See {name}"
										>
											<Avatar
												src={avatarSrc(author)}
												{name}
												fallback="initial"
												size="md"
												decorative
											/>
										</button>
									{:else}
										<span class="grid size-11 place-items-center">
											<Avatar
												src={avatarSrc(author)}
												{name}
												fallback="initial"
												size="md"
												decorative
											/>
										</span>
									{/if}
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								{#if showHead}
									<div class="flex items-baseline gap-2">
										{#if author}
											<button
												type="button"
												class="truncate text-sm font-medium hover:underline"
												onclick={() => onOpenPerson(author.id)}
											>
												{name}
											</button>
										{:else}
											<span class="text-sm font-medium">{name}</span>
										{/if}
										<time
											class="text-surface-600-400 shrink-0 text-xs"
											datetime={m.createdAt}
											title={fullTime(m.createdAt)}
										>
											{timeAgo(m.createdAt)}
										</time>
									</div>
								{/if}
								{#if removed}
									<p class="text-surface-600-400 text-sm italic">
										Message removed
									</p>
								{:else if editingId === m.id}
									<div class="flex flex-col gap-2 py-1">
										<textarea
											class="textarea min-h-20 text-sm"
											aria-label="Edit message"
											bind:value={editText}
										></textarea>
										{#if editRefusal}
											<p class="text-error-600-400 text-sm" role="alert">
												{editRefusal}
											</p>
										{/if}
										<div class="flex gap-2">
											<button
												type="button"
												class="btn btn-sm preset-tonal-surface min-h-11"
												onclick={() => (editingId = null)}
											>
												Cancel
											</button>
											<button
												type="button"
												class="btn btn-sm preset-filled-primary-500 min-h-11"
												disabled={!editText.trim()}
												onclick={saveEdit}
											>
												Save
											</button>
										</div>
									</div>
								{:else}
									<div
										class="conversation-message-text text-sm leading-relaxed break-words"
										title={showHead ? undefined : fullTime(m.createdAt)}
									>
										{@html renderStrictMarkdown(m.body)}
									</div>
									{#if m.isEdited}
										<span class="text-surface-600-400 text-xs">edited</span>
									{/if}
								{/if}
								{#if !removed && m.attachments.length}
									<div class="mt-1.5 flex flex-col gap-1.5">
										{#each m.attachments as card (card.id)}
											<ConversationAttachmentCard {card} />
										{/each}
									</div>
								{/if}
							</div>
							{#if own && !removed && editingId !== m.id}
								<div class="shrink-0">
									<RowMenu
										label="Message"
										triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 min-h-11 min-w-11 p-3"
										items={[
											{
												label: "Edit",
												icon: Icons.Pencil,
												onSelect: () => startEdit(m)
											},
											{ separator: true },
											{
												label: "Remove",
												icon: Icons.Trash2,
												destructive: true,
												onSelect: () => {
													confirmRefusal = null
													confirm = {
														title: "Remove this message?",
														body: "Everyone here sees “Message removed” in its place. Its text and attachments go now.",
														yes: "Remove",
														run: () => ctx.remove(m.id)
													}
												}
											}
										]}
									/>
								</div>
							{/if}
						</article>
					{/each}
				{/if}
			</div>
		</div>

		<ConversationComposer
			{conversationId}
			onSent={() => {
				stick = true
				void tick().then(toBottom)
			}}
		/>
	{/if}
</div>

<!-- Rename: a group's name, the host's to change. -->
<Dialog
	open={renameOpen}
	onOpenChange={(e) => {
		if (!e.open) renameOpen = false
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl">
				<header class="flex items-start gap-2">
					<Dialog.Title
						class="min-w-0 flex-1 [font-family:var(--typo-heading--font-family)] text-lg font-semibold"
					>
						Rename
					</Dialog.Title>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal size-11 shrink-0"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<form
					class="space-y-4"
					onsubmit={(e) => {
						e.preventDefault()
						void saveRename()
					}}
				>
					<label class="block space-y-1">
						<span class="text-sm font-medium">Name</span>
						<input class="input w-full" type="text" maxlength="80" bind:value={renameText} />
					</label>
					{#if renameRefusal}
						<p class="text-error-600-400 text-sm" role="alert">{renameRefusal}</p>
					{/if}
					<div class="flex justify-end gap-2">
						<button type="button" class="btn preset-tonal-surface min-h-11" onclick={() => (renameOpen = false)}>
							Cancel
						</button>
						<button type="submit" class="btn preset-filled-primary-500 min-h-11" disabled={!renameText.trim()}>
							Save
						</button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<!-- The members sheet: everyone here; the host may remove anyone else. -->
<Dialog
	open={membersOpen}
	onOpenChange={(e) => {
		if (!e.open) membersOpen = false
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content
				class="card bg-surface-100-900 flex max-h-[90vh] w-full max-w-md flex-col gap-4 p-6 shadow-xl"
			>
				<header class="flex shrink-0 items-start gap-2">
					<div class="min-w-0 flex-1 space-y-1">
						<Dialog.Title
							class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
						>
							People in this conversation
						</Dialog.Title>
						<Dialog.Description class="text-surface-600-400 text-sm">
							{isHost
								? "You're the host: you can add and remove people."
								: "The host adds and removes people."}
						</Dialog.Description>
					</div>
					<Dialog.CloseTrigger
						class="btn-icon hover:preset-tonal size-11 shrink-0"
						aria-label="Close"
					>
						<Icons.X size={16} aria-hidden="true" />
					</Dialog.CloseTrigger>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<ul class="mr-1 flex flex-col gap-1">
						{#each summary?.members ?? [] as person (person.id)}
							<li class="flex items-center gap-2">
								<button
									type="button"
									class="hover:bg-surface-200-800 flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-base px-2 py-1.5 text-left"
									onclick={() => {
										membersOpen = false
										if (person.id !== meId) onOpenPerson(person.id)
									}}
									disabled={person.id === meId}
								>
									<Avatar src={avatarSrc(person)} name={personName(person)} fallback="initial" size="md" decorative />
									<span class="min-w-0 flex-1">
										<span class="block truncate text-lead font-medium">
											{personName(person)}{person.id === meId ? " (you)" : ""}
										</span>
										<span class="text-surface-600-400 block truncate text-xs">
											@{person.username}{summary?.hostUserId === person.id
												? " · Host"
												: ""}
										</span>
									</span>
								</button>
								{#if isHost && person.id !== meId}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface text-error-600-400 min-h-11 shrink-0"
										onclick={() => {
											confirmRefusal = null
											confirm = {
												title: `Remove ${personName(person)}?`,
												body: `${personName(person)} stops getting this conversation's messages and it leaves their list. What they wrote stays.`,
												yes: "Remove",
												run: () => ctx.removeMember(conversationId, person.id)
											}
										}}
									>
										Remove
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
				{#if isHost}
					<button
						type="button"
						class="btn preset-tonal-primary min-h-11 shrink-0 self-start"
						onclick={() => {
							membersOpen = false
							addOpen = true
						}}
					>
						<Icons.UserPlus size={16} aria-hidden="true" />
						Add people
					</button>
				{/if}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<UserSelectModal
	open={addOpen}
	source="conversations:people"
	multiSelect
	excludeUserIds={summary?.members.map((m) => m.id) ?? []}
	title="Add people"
	description="They see the whole conversation, earlier messages included."
	confirmLabel={(n) => `Add ${n} ${n === 1 ? "person" : "people"}`}
	onclose={() => (addOpen = false)}
	onSelect={() => {}}
	onMultiSelect={(ids) => {
		if (ids.length) act(() => ctx.addMembers(conversationId, ids))
	}}
/>

<!-- An alertdialog (STYLE-GUIDE §6.6): answered, never dismissed by a click
     outside; the confirm is filled error because it only takes away. -->
<Dialog
	open={!!confirm}
	role="alertdialog"
	closeOnInteractOutside={false}
	onOpenChange={(e) => {
		if (!e.open) confirm = null
	}}
>
	<Portal>
		<Dialog.Backdrop class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm" />
		<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-4">
			<Dialog.Content class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl">
				<Dialog.Title
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					{confirm?.title}
				</Dialog.Title>
				<Dialog.Description class="text-surface-600-400 text-sm">
					{confirm?.body}
				</Dialog.Description>
				{#if confirmRefusal}
					<p class="text-error-600-400 text-sm" role="alert">{confirmRefusal}</p>
				{/if}
				<div class="flex justify-end gap-2">
					<button type="button" class="btn preset-tonal-surface min-h-11" onclick={() => (confirm = null)}>
						Cancel
					</button>
					<button type="button" class="btn preset-filled-error-500 min-h-11" onclick={answerYes}>
						{confirm?.yes}
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>

<style>
	/* The STRICT-rendered body: plain markdown, read as a message. */
	.conversation-message-text :global(p) {
		margin: 0.15rem 0;
	}
	.conversation-message-text :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.conversation-message-text :global(ul) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.conversation-message-text :global(ol) {
		list-style: decimal;
		padding-left: 1.25rem;
	}
	.conversation-message-text :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.9em;
	}
	.conversation-message-text :global(pre) {
		overflow-x: auto;
		white-space: pre;
	}
	.conversation-message-text :global(img) {
		max-width: min(320px, 100%);
		border-radius: 10px;
	}
	.conversation-message-text :global(blockquote) {
		border-left: 2px solid color-mix(in oklab, currentColor 35%, transparent);
		padding-left: 0.75rem;
	}
</style>
