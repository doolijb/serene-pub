<script lang="ts">
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import { lastActivityAt, timeAgoShort } from "$lib/client/utils/timeAgo"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import type { StatusText } from "@serene-pub/sdk"

	interface Props {
		session: Sockets.Sessions.List.Response["sessionList"][0]
		onclick?: (
			session: Sockets.Sessions.List.Response["sessionList"][0]
		) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		showControls?: boolean
		contentTitle?: string
		classes?: string
		/** The currently-open session — highlighted and pinned by the sidebar. */
		active?: boolean
		/**
		 * Whether the genre chip is drawn.
		 *
		 * The VIEW decides, not the row: on an install with one genre every
		 * row would carry the same chip, which is a column of noise saying
		 * nothing. The sidebar knows how many genres its list holds; a row
		 * only knows its own.
		 */
		showGenre?: boolean
		/**
		 * What the session's run in flight is doing (R-19) — *Jasmine is
		 * typing* — as the sidebar has most recently heard it; `null` once the
		 * run ended. Absent, the row reads the list's own `runStatus`.
		 */
		runStatus?: StatusText | null
	}

	let {
		session,
		onclick,
		onEdit,
		onDelete,
		showControls = true,
		contentTitle = "Go to session",
		classes = "",
		active = false,
		showGenre = false,
		runStatus
	}: Props = $props()

	let menuOpen = $state(false)

	function handleClick() {
		onclick?.(session)
	}

	const cast = $derived(
		(session.sessionCharacters || [])
			.map((sc) => sc.character)
			.filter(Boolean)
	)

	/** The session's cover: its first cast member's picture. */
	const coverSrc = $derived(avatarSrc(cast[0]))
	/**
	 * The second cast member, drawn as a badge on the cover — the one glance
	 * that separates a group from a two-hander. Only the second: a stack of
	 * four thumbnails at 40px is four unrecognisable smudges, and the cast is
	 * named in full on the row's second line anyway.
	 */
	const isGroup = $derived(cast.length > 1)
	const badgeSrc = $derived(isGroup ? avatarSrc(cast[1]) : undefined)

	const name = $derived(session.name || "Untitled Session")

	/**
	 * The run's status in the reader's language, or empty. The push's word
	 * wins where the sidebar has one (`runStatus`, `null` included — a run
	 * that ended); the list's `runStatus` is what it said when built.
	 */
	const status = $derived(
		statusText(runStatus === undefined ? session.runStatus : runStatus)
	)

	/**
	 * The model spoke last, so the next line is the reader's. Absent
	 * `lastMessage` means nothing has been said yet, which is not a turn —
	 * and neither is a reply still being written: while a run has a status
	 * the ember dot yields to it.
	 */
	const isYourTurn = $derived(
		!!session.lastMessage && !session.lastMessage.isUser && !status
	)

	const relative = $derived(timeAgoShort(new Date(lastActivityAt(session))))

	/** Who is in the scene, for a session with nothing said in it yet. */
	const castNames = $derived(
		cast
			.map((c) => c?.nickname || c?.name)
			.filter(Boolean)
			.join(", ")
	)
</script>

<SidebarListItem
	itemType="Session"
	onclick={handleClick}
	{contentTitle}
	{classes}
	{active}
	showIndex={false}
>
	{#snippet content()}
		<span class="relative block size-10 shrink-0">
			{#if coverSrc}
				<img
					src={coverSrc}
					alt=""
					loading="lazy"
					class="size-10 rounded-[9px] object-cover object-top"
				/>
			{:else}
				<span
					class="bg-surface-200-800 grid size-10 place-items-center rounded-[9px]"
				>
					<Icons.MessageSquare
						size={18}
						class="text-surface-600-400"
						aria-hidden="true"
					/>
				</span>
			{/if}
			{#if isGroup}
				<!-- The ring is the row's own ground, so the badge reads as a
				     notch cut out of the cover rather than a second sticker
				     sitting on it. -->
				{#if badgeSrc}
					<img
						src={badgeSrc}
						alt=""
						loading="lazy"
						class="ring-surface-200-800 absolute -right-0.5 -bottom-0.5 size-5 rounded-[6px] object-cover object-top ring-2"
					/>
				{:else}
					<span
						class="bg-surface-300-700 ring-surface-200-800 absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-[6px] ring-2"
					>
						<Icons.UsersRound
							size={12}
							class="text-surface-600-400"
							aria-hidden="true"
						/>
					</span>
				{/if}
			{/if}
		</span>
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<div class="flex min-w-0 items-center gap-1.5">
				<span
					class="truncate text-left text-[15px] font-medium"
					id="session-name-{session.id}"
				>
					{name}
				</span>
				{#if showGenre && session.genreName}
					<!-- The session's genre. The open session is already marked
					     by the selected-row treatment (see SidebarListItem's
					     `active`), so there is no extra "open" tag here. -->
					<span
						class="bg-surface-200-800 shrink-0 rounded-md px-1.5 text-[11px]"
					>
						{session.genreName}
					</span>
				{/if}
				{#if session.isGuest}
					<!-- The tooltip hangs on the span, not the glyph: `title`
					     on an `<svg>` is an attribute, not SVG's `<title>`
					     child, so it shows nothing. -->
					<span class="shrink-0 leading-none" title="Shared with you">
						<Icons.Users
							size={14}
							class="text-surface-500"
							aria-hidden="true"
						/>
						<span class="sr-only">Shared with you</span>
					</span>
				{/if}
				<!-- `ml-auto` and not a spacer: the name truncates into
				     whatever room the time and the dot leave, which is what
				     keeps a long name from pushing the timestamp off the row. -->
				<span class="ml-auto flex shrink-0 items-center gap-1">
					{#if isYourTurn}
						<!-- Ember means the model has moved and is waiting on
						     you — the same signal as the generating chip, one
						     step later. Never colour alone: the dot carries a
						     title and an off-screen label. -->
						<span
							class="bg-warning-500 size-1.5 rounded-full"
							title="Your turn"
							aria-hidden="true"
						></span>
						<span class="sr-only">Your turn</span>
					{/if}
					{#if relative}
						<span class="text-surface-500 text-[11px]">
							{relative}
						</span>
					{/if}
				</span>
			</div>
			<!-- The last line, or the cast when there is none: one line either
			     way, so a row never grows taller than its neighbours. While a
			     reply is being written the line is the run's status instead
			     (R-19) — *Jasmine is typing* — with a pulsing dot so the row
			     says "in progress" without colour alone. -->
			<div
				class="text-surface-600-400 truncate text-left text-xs"
				id="session-line-{session.id}"
			>
				{#if status}
					<span
						class="bg-primary-500 mr-1 inline-block size-1.5 animate-pulse rounded-full align-middle"
						aria-hidden="true"
					></span>
					<span class="italic" data-session-run-status>{status}</span>
				{:else if session.lastMessage}
					{#if session.lastMessage.speakerName}
						<span class="text-surface-700-300">
							{session.lastMessage.speakerName}:
						</span>
					{/if}
					<span class="italic">{session.lastMessage.excerpt}</span>
				{:else if castNames}
					{castNames}
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet controls()}
		{#if showControls && session.canEdit && (onclick || onEdit || onDelete)}
			<div role="none" onclick={(e) => e.stopPropagation()}>
				<Popover
					open={menuOpen}
					onOpenChange={(e) => (menuOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn btn-sm hover:bg-primary-600-400 shrink-0 p-3 {menuOpen
							? 'bg-primary-600-400'
							: ''}"
						aria-label="Session options"
					>
						<Icons.EllipsisVertical size={16} />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-200-800 w-[min(90vw,240px)] space-y-4 p-4 shadow-xl"
							>
								<header class="popover-menu-title">
									<Icons.MessageSquare
										size={18}
										aria-hidden="true"
									/>
									<p>Session Options</p>
								</header>
								<article class="flex flex-col gap-2">
									{#if onclick}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
											onclick={() => {
												menuOpen = false
												handleClick()
											}}
											type="button"
										>
											<Icons.Eye
												size={16}
												aria-hidden="true"
											/>
											<span>View</span>
										</button>
									{/if}
									{#if onEdit}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-success-500"
											onclick={() => {
												menuOpen = false
												onEdit?.(session.id!)
											}}
											type="button"
										>
											<Icons.Pencil
												size={16}
												aria-hidden="true"
											/>
											<span>Edit</span>
										</button>
									{/if}
									{#if onDelete && session.isOwner}
										<button
											class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
											onclick={() => {
												menuOpen = false
												onDelete?.(session.id!)
											}}
											type="button"
										>
											<Icons.Trash2
												size={16}
												aria-hidden="true"
											/>
											<span>Delete</span>
										</button>
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
		{/if}
	{/snippet}
</SidebarListItem>
