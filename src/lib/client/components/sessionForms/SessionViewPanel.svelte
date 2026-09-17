<script lang="ts">
	import { avatarSrc } from "$lib/client/utils/media"
	import { Avatar } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import { lastActivityAt, timeAgo } from "$lib/client/utils/timeAgo"

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
		socket.emit("sessions:get", {
			id
		} satisfies Sockets.Sessions.Get.Params)
		return release
	})

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
	 * The book's own name, when the payload joined it. `sessions:get` carries
	 * `lorebookId` and no lorebook row, so today this is null and the card is
	 * the action alone.
	 */
	let lorebookName = $derived((session as any)?.lorebook?.name ?? null)
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

<div class="flex h-full flex-col gap-0 overflow-hidden">
	<!-- Header. Every action this panel offers lives here: a detail screen
	     that repeats its buttons at the foot makes the reader check both. -->
	<div class="shrink-0 pb-3">
		<PanelNavHeader
			title={session?.name || "Session"}
			{onBack}
			backLabel="Back to sessions"
			actionsLabel="Session"
		>
			{#snippet primaryAction()}
				<button
					class="btn btn-sm preset-filled-primary-500 shrink-0 p-2"
					onclick={onOpen}
					title="Open session"
					aria-label="Open session"
					type="button"
				>
					<Icons.ArrowRight size={16} aria-hidden="true" />
				</button>
			{/snippet}
			<!-- The {#if} lives INSIDE the snippet: a snippet passed as a prop
			     must be a direct child of the component tag. -->
			{#snippet actions()}
				{#if canEdit}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
						onclick={onEdit}
						type="button"
					>
						<Icons.Pencil size={16} aria-hidden="true" />
						<span>Edit session</span>
					</button>
				{/if}
				{#if lorebookId != null && onViewLorebook}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-primary-500"
						onclick={() => onViewLorebook?.(lorebookId)}
						type="button"
					>
						<Icons.BookMarked size={16} aria-hidden="true" />
						<span>View lorebook</span>
					</button>
				{/if}
				{#if isOwner && onDelete}
					<button
						class="btn btn-sm popover-menu-btn hover:preset-filled-error-500"
						onclick={() => onDelete?.(sessionId)}
						type="button"
					>
						<Icons.Trash2 size={16} aria-hidden="true" />
						<span>Delete session</span>
					</button>
				{/if}
			{/snippet}
		</PanelNavHeader>
	</div>

	{#if isLoading}
		<div class="flex flex-1 items-center justify-center">
			<Icons.Loader2 size={24} class="text-surface-400 animate-spin" />
		</div>
	{:else if session}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<!-- Hero: the one place this panel says which session it is
			     showing, in the same shape the row used, scaled up. -->
			<div class="flex shrink-0 items-start gap-3 pb-4">
				<span class="relative block size-[88px] shrink-0">
					{#if coverSrc}
						<img
							src={coverSrc}
							alt=""
							class="size-[88px] rounded-[14px] object-cover object-top"
						/>
					{:else}
						<span
							class="bg-surface-200-800 grid size-[88px] place-items-center rounded-[14px]"
						>
							<Icons.MessageSquare
								size={40}
								class="text-surface-600-400"
								aria-hidden="true"
							/>
						</span>
					{/if}
					{#if isGroup}
						{#if badgeSrc}
							<img
								src={badgeSrc}
								alt=""
								class="ring-surface-100-900 absolute -right-1 -bottom-1 size-11 rounded-[10px] object-cover object-top ring-2"
							/>
						{:else}
							<span
								class="bg-surface-300-700 ring-surface-100-900 absolute -right-1 -bottom-1 grid size-11 place-items-center rounded-[10px] ring-2"
							>
								<Icons.UsersRound
									size={20}
									class="text-surface-600-400"
									aria-hidden="true"
								/>
							</span>
						{/if}
					{/if}
				</span>
				<div class="min-w-0 flex-1">
					<!-- The heading font without a heading element:
					     PanelNavHeader above already owns this panel's heading,
					     and a second one saying the same name would put two
					     entries in the outline for one thing. -->
					<p class="funnel-display truncate text-lg font-semibold">
						{session.name || "Untitled Session"}
					</p>
					{#if heroMeta.length}
						<p class="text-surface-500 truncate text-xs">
							{heroMeta.join(" · ")}
						</p>
					{/if}
					{#if tags.length > 0}
						<div class="mt-1.5 flex flex-wrap gap-1">
							{#each tags as tag}
								<span
									class="preset-tonal-surface rounded px-2 py-0.5 text-xs"
								>
									{tag}
								</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- One card per section. A section whose fact this session has
			     none of is not rendered at all: an empty card states a blank
			     where the session simply has none, and the card boundary is
			     the separator, so there is no rule between them. -->
			<div class="flex flex-col gap-3 pb-3">
				{#if characters.length > 0 || personas.length > 0}
					<section class="panel-card">
						<p class="text-surface-500 mb-1.5 text-xs">Cast</p>
						<div class="flex flex-col gap-2">
							{#each characters as c}
								<div class="flex items-center gap-2">
									<Avatar class="h-8 min-h-8 w-8 min-w-8">
										<Avatar.Image
											src={avatarSrc(c) || ""}
											alt={c.nickname || c.name}
											class="object-cover"
										/>
										<Avatar.Fallback>
											<Icons.UsersRound size={16} />
										</Avatar.Fallback>
									</Avatar>
									<span class="truncate text-sm font-medium">
										{c.nickname || c.name}
									</span>
								</div>
							{/each}
						</div>
						{#if personas.length > 0}
							<p class="text-surface-500 mt-3 mb-1.5 text-xs">
								You
							</p>
							<div class="flex flex-col gap-2">
								{#each personas as p}
									<div class="flex items-center gap-2">
										<Avatar class="h-8 min-h-8 w-8 min-w-8">
											<Avatar.Image
												src={avatarSrc(p) || ""}
												alt={p.name}
												class="object-cover"
											/>
											<Avatar.Fallback>
												<Icons.UserCog size={16} />
											</Avatar.Fallback>
										</Avatar>
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
						<p class="text-surface-500 mb-1.5 text-xs">Last line</p>
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
						<p class="text-surface-500 mb-1.5 text-xs">Scenario</p>
						<p class="text-sm leading-relaxed whitespace-pre-wrap">
							{session.scenario}
						</p>
					</section>
				{/if}

				{#if lorebookId != null}
					<section class="panel-card">
						<p class="text-surface-500 mb-1.5 text-xs">Lorebook</p>
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

				{#if guests.length > 0}
					<section class="panel-card">
						<p class="text-surface-500 mb-1.5 text-xs">
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
		<p class="text-surface-700-300 py-8 text-center text-sm">
			Session not found.
		</p>
	{/if}
</div>
