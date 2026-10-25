<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import Avatar from "$lib/client/components/Avatar.svelte"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import DetailHero from "$lib/client/components/panels/DetailHero.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest, requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { lastActivityAt, timeAgo } from "$lib/client/utils/timeAgo"
	import { branchOfLabel, branchOfSession } from "$lib/shared/sessions/branchOf"
	import ActionConfirm from "$lib/client/components/sessionPage/ActionConfirm.svelte"
	import { askingOf } from "$lib/client/components/sessionPage/actionConfirmAsking"
	import {
		CLOSE_OUT_CONFIRM,
		CLOSE_OUT_LABEL,
		SESSION_ARCHIVE_CONFIRM,
		SESSION_ARCHIVE_LABELS
	} from "$lib/shared/sessions/archive"
	import { SHARE_CONFIRMS, SHARE_LABELS } from "$lib/shared/lorebooks/sessionNotes"

	interface Props {
		sessionId: number
		/**
		 * Back to the list. Omitted when the list is already on screen beside
		 * this panel (a view in desk mode), where a "back" that goes nowhere
		 * visible is only a button to explain.
		 */
		onBack?: () => void
		onEdit: () => void
		onOpen: () => void
		/** Open the session's connected lorebook, when it has one. */
		onViewLorebook?: (lorebookId: number) => void
		/** Hand the id to the list's own delete flow, confirmation and all. */
		onDelete?: (id: number) => void
		/** Star or unstar it (owner only); `isFavorite` comes from the list row. */
		onToggleFavorite?: (id: number, isFavorite: boolean) => void
		isFavorite?: boolean
		/** Whether this user may change the session. The list row knows; ask it. */
		canEdit?: boolean
		/** Whether this user owns the session — the one who may delete it. */
		isOwner?: boolean
		/**
		 * Three facts `sessions:get` does not carry, taken from the list row
		 * that opened this panel. Each is optional and each is simply left out
		 * of the meta line when it is missing, so a panel opened from anywhere
		 * else still renders.
		 */
		genreName?: string
		messageCount?: number
		lastMessage?: Sockets.Sessions.List.LastMessage
	}

	let {
		sessionId,
		onBack,
		onEdit,
		onOpen,
		onViewLorebook,
		onDelete,
		onToggleFavorite,
		isFavorite = false,
		canEdit = false,
		isOwner = false,
		genreName,
		messageCount,
		lastMessage
	}: Props = $props()

	const socket = useTypedSocket()

	let session = $state<Sockets.Sessions.Get.Response["session"] | null>(null)
	let isLoading = $state(true)

	// The id check stays as belt and braces: the interest key below already
	// narrows the fan-out to this session, and this says the same thing about
	// the payload itself.
	function handleSessionsGet(msg: Sockets.Sessions.Get.Response) {
		if (msg.session?.id === sessionId) {
			session = msg.session
			isLoading = false
		}
	}

	/**
	 * The session this panel is showing, declared as a SCOPED interest
	 * (`sessions:get#<id>`; the payload carries the id on `session.id`, see
	 * `SCOPED_EVENTS`) and asked for in the same effect — so a panel pointed at
	 * another session releases the old key as it takes the new one, rather than
	 * keeping the first id `useInterest` would have read once.
	 *
	 * The declare is safe to make in the same flush as the request: the typed
	 * socket's `emit` flushes the pending interest sync before the packet leaves
	 * (ruling 3), so the request cannot overtake the key its own reply needs.
	 */
	$effect(() => {
		const id = sessionId
		const release = declareInterest<"sessions:get">(
			interestKey("sessions:get", id),
			handleSessionsGet
		)
		const releaseRefresh = declareInterest<"sessions:refresh">(
			interestKey("sessions:refresh", id),
			handleSessionsGet
		)
		socket.emit("sessions:get", {
			id
		} satisfies Sockets.Sessions.Get.Params)
		return () => {
			release()
			releaseRefresh()
		}
	})

	/**
	 * 🚧 The overlay's items (PLAN-rulesets §26): what this session wrote to
	 * its own notes while reading a lorebook it may not write, each "this
	 * session only" until applied to the lorebook. Empty with no lorebook.
	 */
	let overlayItems = $state<Sockets.Sessions.OverlayItems.Item[]>([])
	$effect(() => {
		const id = sessionId
		overlayItems = []
		const onItems = (res: Sockets.Sessions.OverlayItems.Response) => {
			if (res.sessionId === id) overlayItems = res.items ?? []
		}
		const releaseItems = declareInterest<"sessions:overlayItems">("sessions:overlayItems", onItems)
		const releaseApplied = declareInterest<"sessions:applyOverlay">("sessions:applyOverlay", () => {})
		socket.emit("sessions:overlayItems", {
			sessionId: id
		} satisfies Sockets.Sessions.OverlayItems.Params)
		return () => {
			releaseItems()
			releaseApplied()
		}
	})
	function applyOverlay(entryIds?: number[]) {
		socket.emit("sessions:applyOverlay", {
			sessionId,
			...(entryIds ? { entryIds } : {})
		} satisfies Sockets.Sessions.ApplyOverlay.Params)
	}

	let characters = $derived(
		(session as any)?.sessionCharacters
			?.map((cc: any) => cc.character)
			.filter(Boolean) ?? []
	)
	let personas = $derived(
		(session as any)?.sessionPersonas
			?.map((cp: any) => cp.persona)
			.filter(Boolean) ?? []
	)
	let tags = $derived((session as any)?.tags ?? [])
	let lorebookId = $derived((session as any)?.lorebookId ?? null)

	/**
	 * 🚧 Set when Share as a lorebook is confirmed: the server re-sends the
	 * session, and the book it now reads is opened once it lands.
	 */
	let openCreatedBook = $state(false)
	$effect(() => {
		if (!openCreatedBook || lorebookId == null) return
		openCreatedBook = false
		onViewLorebook?.(lorebookId)
	})
	/**
	 * The book's own name, when the payload joined it. `sessions:get` carries
	 * `lorebookId` and no lorebook row, so today this is null and the card is
	 * the action alone.
	 */
	let lorebookName = $derived((session as any)?.lorebook?.name ?? null)
	/**
	 * 🚧 pr-6 (R-p): the attached book's name for Share's two verbs. The
	 * session payload joins no lorebook row, so it is read off the session's
	 * own-book row (`lorebooks:sessionNotes`, its `attached`), the owner's only.
	 */
	let attachedName = $state<string | null>(null)
	$effect(() => {
		if (!isOwner || lorebookId == null) {
			attachedName = null
			return
		}
		const id = sessionId
		return requestWithInterest("lorebooks:sessionNotes", {}, (res) => {
			const row = res.books?.find((b) => b.sessionId === id)
			if (row) attachedName = row.attached?.name ?? null
		})
	})
	let shareBookName = $derived(attachedName ?? lorebookName ?? "its lorebook")
	let archived = $derived(
		!!(session as { archivedAt?: unknown } | null)?.archivedAt
	)
	let closeOutRegistered = $derived(
		(session as { closeOutRegistered?: boolean } | null)
			?.closeOutRegistered === true
	)
	/** The question before a verb; Confirm runs `go`. */
	let asking = $state<{
		asking: { question: string; description?: string; confirmLabel: string }
		go: () => void
	} | null>(null)
	function ask(sentence: string, label: string, go: () => void) {
		asking = { asking: askingOf(sentence, label), go }
	}
	let guests = $derived(
		((session as any)?.sessionGuests ?? [])
			.map((g: any) => g?.user)
			.filter(Boolean)
	)

	/** The session's cover, and the second cast member badged onto it. */
	let coverSrc = $derived(avatarSrc(characters[0], { full: true }))
	let isGroup = $derived(characters.length > 1)
	let badgeSrc = $derived(
		isGroup ? avatarSrc(characters[1], { full: true }) : undefined
	)

	/**
	 * The quiet line under the name: what kind of session, how much of it
	 * there is, and when it last moved. Parts this panel was not told are
	 * simply absent rather than rendered as a blank or a zero.
	 */
	let heroMeta = $derived.by(() => {
		const parts: string[] = []
		if (genreName) parts.push(genreName)
		if (archived) parts.push(SESSION_ARCHIVE_LABELS.mark)
		// 🚧 The branch marker: which session this one was branched from.
		const branchMark = branchOfLabel(branchOfSession(session as any))
		if (branchMark) parts.push(branchMark)
		if (messageCount != null) {
			parts.push(
				`${messageCount} ${messageCount === 1 ? "message" : "messages"}`
			)
		}
		const at = session
			? lastActivityAt({
					lastMessage,
					updatedAt: (session as any).updatedAt
				})
			: 0
		if (at > 0) parts.push(`last active ${timeAgo(new Date(at))}`)
		return parts
	})
</script>

<!-- One flex column with the pane's 12px gap: the space under the header is
     that gap, never a margin or a wrapper (STYLE-GUIDE §6.3). -->
<div class="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
	<!-- Header. Every action this panel offers lives here: a detail screen
	     that repeats its buttons at the foot makes the reader check both. -->
	<PanelNavHeader
		title="Session"
		{onBack}
		backLabel="Back to sessions"
		actionsLabel="Session"
		menuItems={[
			lorebookId != null &&
				onViewLorebook && {
					label: "View lorebook",
					icon: Icons.BookMarked,
					onSelect: () => onViewLorebook?.(lorebookId)
				},
			isOwner &&
				onToggleFavorite && {
					label: isFavorite ? "Unstar" : "Star",
					icon: isFavorite ? Icons.StarOff : Icons.Star,
					onSelect: () => onToggleFavorite?.(sessionId, !isFavorite)
				},
			// Share (pass 11): one verb while the own book overlays nothing,
			// two once it overlays an attached book.
			isOwner &&
				lorebookId == null && {
					label: SHARE_LABELS.asLorebook,
					icon: Icons.BookPlus,
					onSelect: () =>
						ask(SHARE_CONFIRMS.asLorebook, SHARE_LABELS.asLorebook, () => {
							openCreatedBook = true
							socket.emit("sessions:shareAsLorebook", { sessionId })
						})
				},
			isOwner &&
				lorebookId != null && {
					label: SHARE_LABELS.toAttached(shareBookName),
					icon: Icons.BookUp,
					onSelect: () => {
						const book = shareBookName
						ask(SHARE_CONFIRMS.toAttached(book), SHARE_LABELS.toAttached(book), () =>
							socket.emit("sessions:applyOverlay", { sessionId, entryIds: null })
						)
					}
				},
			isOwner &&
				lorebookId != null && {
					label: SHARE_LABELS.cloneWithChanges,
					icon: Icons.CopyPlus,
					onSelect: () => {
						const book = shareBookName
						ask(
							SHARE_CONFIRMS.cloneWithChanges(book),
							SHARE_LABELS.cloneWithChanges,
							() => socket.emit("sessions:cloneWithChanges", { sessionId })
						)
					}
				},
			isOwner &&
				closeOutRegistered && {
					label: CLOSE_OUT_LABEL,
					icon: Icons.ScrollText,
					onSelect: () =>
						ask(CLOSE_OUT_CONFIRM, CLOSE_OUT_LABEL, () =>
							socket.emit("sessions:closeOut", { sessionId })
						)
				},
			isOwner &&
				!archived && {
					label: SESSION_ARCHIVE_LABELS.archive,
					icon: Icons.Archive,
					onSelect: () =>
						ask(
							closeOutRegistered
								? SESSION_ARCHIVE_CONFIRM.withCloseOut
								: SESSION_ARCHIVE_CONFIRM.plain,
							SESSION_ARCHIVE_LABELS.archive,
							() => socket.emit("sessions:archive", { sessionId })
						)
				},
			isOwner &&
				archived && {
					label: SESSION_ARCHIVE_LABELS.unarchive,
					icon: Icons.ArchiveRestore,
					onSelect: () => socket.emit("sessions:unarchive", { sessionId })
				},
			isOwner && onDelete && { separator: true },
			isOwner &&
				onDelete && {
					label: "Delete session",
					icon: Icons.Trash2,
					destructive: true,
					onSelect: () => onDelete?.(sessionId)
				}
		]}
	/>

	{#if isLoading}
		<LoadingState message="Loading session…" />
	{:else if session}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<!-- Hero: the one place this panel says which session it is
			     showing, in the same shape the row used, scaled up. -->
			<DetailHero
				class="pb-4"
				title={session.name || "Untitled session"}
				image={coverSrc}
				icon={Icons.MessageSquare}
				subtitle={heroMeta.length ? heroMeta.join(" · ") : undefined}
				badge={isGroup ? groupBadge : undefined}
				chips={tags.length > 0 ? tagChips : undefined}
				actions={heroActions}
			/>

			<!-- One card per section. A section whose fact this session has
			     none of is not rendered at all: an empty card states a blank
			     where the session simply has none, and the card boundary is
			     the separator, so there is no rule between them. -->
			<!-- Two columns of cards once the detail has the room (notes 14): a
			     wide detail was one column of short cards on an ocean of empty. -->
			<div class="grid items-start gap-3 pb-3 @2xl/detail:grid-cols-2">
				{#if characters.length > 0 || personas.length > 0}
					<section class="panel-card">
						<p class="text-surface-600-400 mb-1.5 text-xs">Cast</p>
						<div class="flex flex-col gap-2">
							{#each characters as c}
								<div class="flex items-center gap-2">
									<Avatar char={c} size="sm" decorative />
									<span class="truncate text-sm font-medium">
										{c.nickname || c.name}
									</span>
								</div>
							{/each}
						</div>
						{#if personas.length > 0}
							<p class="text-surface-600-400 mt-3 mb-1.5 text-xs">
								You
							</p>
							<div class="flex flex-col gap-2">
								{#each personas as p}
									<div class="flex items-center gap-2">
										<Avatar
											char={p}
											size="sm"
											kind="persona"
											decorative
										/>
										<span
											class="truncate text-sm font-medium"
										>
											{p.name}
										</span>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/if}

				{#if lastMessage}
					<section class="panel-card">
						<p class="text-surface-600-400 mb-1.5 text-xs">
							Last line
						</p>
						<p class="text-sm leading-relaxed">
							{#if lastMessage.speakerName}
								<span class="text-surface-700-300">
									{lastMessage.speakerName}:
								</span>
							{/if}
							<span class="text-surface-600-400 italic">
								{lastMessage.excerpt}
							</span>
						</p>
					</section>
				{/if}

				{#if session.scenario}
					<section class="panel-card">
						<p class="text-surface-600-400 mb-1.5 text-xs">
							Scenario
						</p>
						<p class="text-sm leading-relaxed whitespace-pre-wrap">
							{session.scenario}
						</p>
					</section>
				{/if}

				{#if lorebookId != null}
					<section class="panel-card">
						<p class="text-surface-600-400 mb-1.5 text-xs">
							Lorebook
						</p>
						<div class="flex min-w-0 items-center gap-2">
							<Icons.BookMarked
								size={16}
								class="text-surface-600-400 shrink-0"
								aria-hidden="true"
							/>
							{#if lorebookName}
								<span class="min-w-0 flex-1 truncate text-sm">
									{lorebookName}
								</span>
							{/if}
							{#if onViewLorebook}
								<button
									class="btn btn-sm preset-tonal-surface ml-auto shrink-0"
									onclick={() => onViewLorebook?.(lorebookId)}
									type="button"
								>
									View lorebook
								</button>
							{/if}
						</div>
					</section>
				{/if}

				{#if lorebookId != null && overlayItems.length > 0}
					<section class="panel-card" aria-label="This session only">
						<div class="mb-1.5 flex items-center gap-2">
							<p class="text-surface-600-400 text-xs">This session only</p>
							{#if isOwner && overlayItems.length > 1}
								<button
									class="btn btn-sm preset-tonal-surface ml-auto"
									onclick={() => applyOverlay()}
									type="button"
								>
									Apply all to the lorebook
								</button>
							{/if}
						</div>
						<ul class="flex flex-col gap-1.5">
							{#each overlayItems as item (item.entryId)}
								<li class="flex min-w-0 items-center gap-2">
									<span class="min-w-0 flex-1 truncate text-sm">
										{item.title || "Untitled entry"}
									</span>
									{#if isOwner}
										<button
											class="btn btn-sm preset-tonal-surface shrink-0"
											onclick={() => applyOverlay([item.entryId])}
											type="button"
										>
											Apply to the lorebook
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if guests.length > 0}
					<section class="panel-card">
						<p class="text-surface-600-400 mb-1.5 text-xs">
							Shared with
						</p>
						<div class="flex flex-col gap-2">
							{#each guests as guest}
								<div class="flex items-center gap-2">
									<Icons.Users
										size={16}
										class="text-surface-600-400 shrink-0"
										aria-hidden="true"
									/>
									<span class="truncate text-sm">
										{guest.displayName || guest.username}
									</span>
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		</div>
	{:else}
		<EmptyState
			icon={Icons.MessageSquareOff}
			message="Session not found."
		/>
	{/if}
</div>

{#snippet groupBadge()}
	{#if badgeSrc}
		<img
			src={badgeSrc}
			alt=""
			class="ring-surface-100-900 block size-9 rounded-base object-cover object-top ring-2"
		/>
	{:else}
		<span
			class="bg-surface-300-700 ring-surface-100-900 grid size-9 place-items-center rounded-base ring-2"
		>
			<Icons.UsersRound
				size={18}
				class="text-surface-600-400"
				aria-hidden="true"
			/>
		</span>
	{/if}
{/snippet}

<!-- The detail's two things to do, in the open (notes 32, 2026-10-02): going
     into the session is the one primary, and Edit sits beside it as a labelled
     secondary rather than a ⋯ away. The rest — the lorebook, the star, Delete —
     stays in the header's ⋯. -->
{#snippet heroActions()}
	<button
		type="button"
		class="btn btn-sm preset-filled-primary-500"
		onclick={onOpen}
		data-session-open
	>
		<Icons.ArrowRight size={16} aria-hidden="true" />
		Open session
	</button>
	{#if canEdit}
		<button
			type="button"
			class="btn btn-sm preset-tonal-surface"
			onclick={onEdit}
			data-session-edit
		>
			<Icons.Pencil size={16} aria-hidden="true" />
			Edit
		</button>
	{/if}
{/snippet}

<ActionConfirm
	asking={asking?.asking ?? null}
	onConfirm={() => {
		const g = asking?.go
		asking = null
		g?.()
	}}
	onCancel={() => (asking = null)}
/>

{#snippet tagChips()}
	{#each tags as tag}
		<span class="preset-tonal-surface rounded px-2 py-0.5 text-xs">
			{tag}
		</span>
	{/each}
{/snippet}
