<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import RowMenu from "../menus/RowMenu.svelte"
	import AvatarStack from "../AvatarStack.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import { lastActivityAt, timeAgoShort } from "$lib/client/utils/timeAgo"
	import { statusText } from "$lib/client/i18n/state.svelte"
	import type { StatusText } from "@serene-pub/sdk"

	/**
	 * A session as a card, for the Sessions view's card mode (notes 36,
	 * 2026-10-02; STYLE-GUIDE §6.4). Avatar-forward: the lead's portrait is the
	 * cover, a group's faces stand on its lower edge, then the name, the genre
	 * and the time, whose turn it is, and the last line.
	 *
	 * The same facts as `SessionListItem`'s row, in the same words — the two
	 * are one list in two shapes, and a reader switching between them must not
	 * find a fact in one that the other leaves out.
	 */
	type SessionRow = Sockets.Sessions.List.Response["sessionList"][0]

	interface Props {
		session: SessionRow
		onclick?: (session: SessionRow) => void
		onEdit?: (id: number) => void
		onDelete?: (id: number) => void
		onToggleFavorite?: (id: number, isFavorite: boolean) => void
		/** The open session, or the one whose detail shows beside the grid. */
		active?: boolean
		/** Whether the genre is named (the view decides; see the row). */
		showGenre?: boolean
		/** The run's status as the view last heard it; see the row. */
		runStatus?: StatusText | null
	}

	let {
		session,
		onclick,
		onEdit,
		onDelete,
		onToggleFavorite,
		active = false,
		showGenre = false,
		runStatus
	}: Props = $props()

	const cast = $derived(
		(session.sessionCharacters || [])
			.map((sc) => sc.character)
			.filter(Boolean)
	)
	const coverSrc = $derived(avatarSrc(cast[0], { full: true }))
	const isGroup = $derived(cast.length > 1)
	const name = $derived(session.name || "Untitled Session")
	const status = $derived(
		statusText(runStatus === undefined ? session.runStatus : runStatus)
	)
	const isYourTurn = $derived(
		!!session.lastMessage && !session.lastMessage.isUser && !status
	)
	const relative = $derived(timeAgoShort(new Date(lastActivityAt(session))))
	const castNames = $derived(
		cast
			.map((c) => c?.nickname || c?.name)
			.filter(Boolean)
			.join(", ")
	)
</script>

<!-- Selection is a RING, as on a character card: the selected row's inset
     bar would sit under the cover. -->
<div
	class="group bg-surface-100-900 panel-edge relative flex h-full flex-col overflow-hidden rounded-[12px] border transition-shadow hover:shadow-lg {active
		? 'ring-primary-500 ring-offset-surface-950 ring-2 ring-offset-2'
		: ''}"
	role="listitem"
	aria-current={active ? "true" : undefined}
	data-session-card={session.id}
>
	<button
		type="button"
		class="flex h-full w-full flex-col text-left focus-visible:outline-none"
		onclick={() => onclick?.(session)}
		aria-label="View session: {name}"
		title={castNames || undefined}
	>
		<span class="bg-surface-200-800 relative block aspect-[16/10] w-full">
			{#if coverSrc}
				<img
					src={coverSrc}
					alt=""
					loading="lazy"
					class="absolute inset-0 size-full object-cover object-top"
				/>
			{:else}
				<span class="absolute inset-0 grid place-items-center">
					<Icons.MessageSquare
						size={40}
						class="text-surface-600-400"
						aria-hidden="true"
					/>
				</span>
			{/if}
			{#if isGroup}
				<!-- A group's faces on the cover's lower edge, ringed in the
				     card's ground so they read as standing on it. -->
				<span class="absolute bottom-0 left-3 translate-y-1/2">
					<AvatarStack
						members={cast}
						size="lg"
						ring="ring-surface-100-900"
					/>
				</span>
			{/if}
		</span>
		<span
			class="flex min-w-0 flex-1 flex-col gap-1 p-3 {isGroup ? 'pt-9' : ''}"
		>
			<span class="flex min-w-0 items-center gap-1.5">
				<span class="truncate text-[15px] font-medium">{name}</span>
				{#if session.isFavorite}
					<Icons.Star
						size={13}
						class="text-primary-500 shrink-0 fill-current"
						aria-label="Favorite"
					/>
				{/if}
				{#if session.isGuest}
					<span class="shrink-0 leading-none" title="Shared with you">
						<Icons.Users
							size={14}
							class="text-surface-600-400"
							aria-hidden="true"
						/>
						<span class="sr-only">Shared with you</span>
					</span>
				{/if}
			</span>
			<span
				class="text-surface-600-400 flex min-w-0 items-center gap-1.5 text-xs"
			>
				{#if showGenre && session.genreName}
					<span class="bg-surface-200-800 shrink-0 rounded-md px-1.5 text-[11px]">
						{session.genreName}
					</span>
				{/if}
				{#if isYourTurn}
					<!-- Primary, "waiting on YOU" (§2), with its words: never
					     colour alone. -->
					<span
						class="text-primary-700 dark:text-primary-400 flex shrink-0 items-center gap-1 font-medium"
						data-session-your-turn
					>
						<span class="bg-primary-500 size-1.5 rounded-full" aria-hidden="true"
						></span>
						Your turn
					</span>
				{/if}
				{#if relative}
					<span class="ml-auto shrink-0">{relative}</span>
				{/if}
			</span>
			<span class="text-surface-600-400 line-clamp-2 text-xs leading-snug">
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
			</span>
		</span>
	</button>

	{#if session.canEdit && (onEdit || onDelete || onToggleFavorite)}
		<div class="absolute top-2 right-2">
			<RowMenu
				label="Session"
				triggerClass="btn btn-sm bg-surface-950/60 hover:bg-surface-950/85 data-[state=open]:bg-surface-950/85 p-2 text-white backdrop-blur-sm"
				items={[
					onclick && {
						label: "View",
						icon: Icons.Eye,
						onSelect: () => onclick?.(session)
					},
					onEdit && {
						label: "Edit",
						icon: Icons.Pencil,
						onSelect: () => onEdit?.(session.id!)
					},
					onToggleFavorite &&
						session.isOwner && {
							label: session.isFavorite ? "Unstar" : "Star",
							icon: session.isFavorite ? Icons.StarOff : Icons.Star,
							onSelect: () =>
								onToggleFavorite?.(session.id!, !session.isFavorite)
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
		</div>
	{/if}
</div>
