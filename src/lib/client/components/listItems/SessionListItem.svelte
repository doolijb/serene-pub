<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import Avatar from "../Avatar.svelte"
	import AvatarStack from "../AvatarStack.svelte"
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
		/** Star or unstar the session; offered to its owner only. */
		onToggleFavorite?: (id: number, isFavorite: boolean) => void
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
		/**
		 * How the row draws its cast. `cover` is the 40px picture with the
		 * second member badged on; `stack` is the Sessions sidebar's grouped
		 * list — up to three 40px faces overlapping, a 14px name and a 12px
		 * time — where the row is one of many a reader scans by who is in it.
		 */
		layout?: "cover" | "stack"
	}

	let {
		session,
		onclick,
		onEdit,
		onDelete,
		onToggleFavorite,
		showControls = true,
		contentTitle = "Go to session",
		classes = "",
		active = false,
		showGenre = false,
		runStatus,
		layout = "cover"
	}: Props = $props()


	function handleClick() {
		onclick?.(session)
	}

	const cast = $derived(
		(session.sessionCharacters || [])
			.map((sc) => sc.character)
			.filter(Boolean)
	)

	/**
	 * The second cast member, drawn as a badge on the cover — the one glance
	 * that separates a group from a two-hander.
	 */
	const isGroup = $derived(cast.length > 1)

	/** The stack's faces: the first three of the cast, then a count. */
	const STACK_MAX = 3

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
		{#if layout === "stack"}
			<!-- The avatar scale's row step (STYLE-GUIDE §6.4): 40px faces,
			     up from 26px (notes 36). Fixed width, whatever the cast size,
			     so every name in the list starts at the same x. The ring is the
			     row's own ground, which is what separates one overlapping face
			     from the next. -->
			<span class="flex shrink-0" title={castNames || undefined}>
				<AvatarStack
					members={cast}
					size="md"
					max={STACK_MAX}
					ring="ring-surface-200-800"
					fixedWidth
				/>
			</span>
		{:else}
			<span class="relative block shrink-0">
				{#if cast[0]}
					<Avatar char={cast[0]} size="md" decorative />
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
					<span class="absolute -right-1 -bottom-1">
						<Avatar
							char={cast[1]}
							size="xs"
							decorative
							class="ring-surface-200-800 ring-2"
						/>
					</span>
				{/if}
			</span>
		{/if}
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<div class="flex min-w-0 items-center gap-1.5">
				<span
					class="truncate text-left font-medium {layout === 'stack'
						? 'text-sm'
						: 'text-[15px]'}"
					id="session-name-{session.id}"
				>
					{name}
				</span>
				{#if session.isFavorite}
					<!-- A glyph on the name, as on a character's row: the row's
					     edge is the selected state's. -->
					<Icons.Star
						size={13}
						class="text-primary-500 shrink-0 fill-current"
						aria-label="Favorite"
					/>
				{/if}
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
						<!-- Primary, the app's "waiting on YOU" colour
						     (STYLE-GUIDE §2): the model has moved and nothing
						     has failed. Never colour alone: the dot carries a
						     title and an off-screen label. -->
						<span
							class="bg-primary-500 size-1.5 rounded-full"
							title="Your turn"
							aria-hidden="true"
						></span>
						<span class="sr-only">Your turn</span>
					{/if}
					{#if relative}
						<!-- Muted, not quiet: a time is text the reader
						     came for, and quiet text fails AA (§6.4). -->
						<span
							class="text-surface-600-400 {layout === 'stack'
								? 'text-xs'
								: 'text-[11px]'}"
						>
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
			<RowMenu
				label="Session"
				triggerClass="btn btn-sm hover:bg-surface-200-800 data-[state=open]:bg-surface-200-800 shrink-0 p-3"
				items={[
					onclick && {
						label: "View",
						icon: Icons.Eye,
						onSelect: handleClick
					},
					onEdit && {
						label: "Edit",
						icon: Icons.Pencil,
						onSelect: () => onEdit?.(session.id!)
					},
					onToggleFavorite &&
						session.isOwner && {
							label: session.isFavorite ? "Unstar" : "Star",
							icon: session.isFavorite
								? Icons.StarOff
								: Icons.Star,
							onSelect: () =>
								onToggleFavorite?.(
									session.id!,
									!session.isFavorite
								)
						},
					onDelete && session.isOwner && { separator: true },
					onDelete &&
						session.isOwner && {
							label: "Delete",
							icon: Icons.Trash2,
							destructive: true,
							onSelect: () => onDelete?.(session.id!)
						}
				]}
			/>
		{/if}
	{/snippet}
</SidebarListItem>
