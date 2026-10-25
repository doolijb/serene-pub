<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import SidebarListItem from "../SidebarListItem.svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import MetaLine from "../panels/MetaLine.svelte"
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
		 * Whether the genre is named on the meta line (a chip after the name
		 * until 2026-10-24).
		 *
		 * The VIEW decides, not the row: on an install with one genre every
		 * row would carry the same word, which is a column of noise saying
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
		onToggleFavorite,
		showControls = true,
		contentTitle = "Go to session",
		classes = "",
		active = false,
		showGenre = false,
		runStatus
	}: Props = $props()

	function handleClick() {
		onclick?.(session)
	}

	const cast = $derived(
		(session.sessionCharacters || [])
			.map((sc) => sc.character)
			.filter(Boolean)
	)

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

	const relative = $derived(timeAgoShort(new Date(lastActivityAt(session))))

	/** Who is in the scene, for a session with nothing said in it yet. */
	const castNames = $derived(
		cast
			.map((c) => c?.nickname || c?.name)
			.filter(Boolean)
			.join(", ")
	)

	/** Whether the meta line has a lead at all; a bare one starts with " · ". */
	const hasLead = $derived(
		!!status || !!session.lastMessage || castNames.length > 0
	)
</script>

<!-- The meta line's lead: the run's status while a reply is being written,
     else the last line, else who is in the scene. -->
{#snippet lead()}
	{#if status}
		<span
			class="bg-warning-500 mr-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle"
			aria-hidden="true"
		></span>
		<span data-session-run-status>{status}</span>
	{:else if session.lastMessage}
		{#if session.lastMessage.speakerName}
			<span class="text-surface-700-300">
				{session.lastMessage.speakerName}:
			</span>
		{/if}
		{session.lastMessage.excerpt}
	{:else if castNames}
		{castNames}
	{/if}
{/snippet}

<SidebarListItem
	itemType="Session"
	itemName={session.name || undefined}
	onclick={handleClick}
	{contentTitle}
	{classes}
	{active}
	showIndex={false}
>
	{#snippet content()}
		<!-- The row's anatomy (STYLE-GUIDE §6.4; PLAN-0-5-polish-parity L6,
		     2026-10-24): up to three 44px faces, the 15px name, ONE muted
		     meta line, the kebab. No "your turn" dot: the group label above
		     the row already says it. The one dot left is ember, while a reply
		     is being written. The slot is the width of a full stack whatever
		     the cast, so every name in the list starts at the same x; the
		     ring is the row's own ground. -->
		<span class="flex shrink-0" title={castNames || undefined}>
			<AvatarStack
				members={cast}
				size="md"
				max={STACK_MAX}
				ring="ring-surface-200-800"
				fixedWidth
			/>
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="flex min-w-0 items-center gap-1.5">
				<span
					class="truncate text-left text-lead font-medium"
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
			</span>
			<!-- The meta line: the last line (or the cast, when nothing has
			     been said), upright, giving way first; then the genre where
			     the view has several, then when it last moved. While a reply
			     is being written the lead is the run's status instead (R-19)
			     — *Jasmine is typing* — after a pulsing ember dot, so the row
			     says "in progress" without colour alone. -->
			<MetaLine
				id="session-line-{session.id}"
				items={[showGenre && session.genreName, relative]}
				children={hasLead ? lead : undefined}
			/>
		</span>
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
