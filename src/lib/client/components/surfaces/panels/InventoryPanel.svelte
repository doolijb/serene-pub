<script lang="ts">
	/**
	 * The Inventory widget: possession edges, grouped.
	 *
	 * An item is a lorebook ENTRY and "Verity is carrying it" is an edge
	 * pointing at that entry — which is why an item here has prose to open, and
	 * why renaming the entry renames every inventory holding it. The world group
	 * holds what nobody is carrying, and dropping something on it is putting it
	 * down.
	 *
	 * Moving an item is a transfer: one verb, so the two edges can never be left
	 * half-written by a client that managed one call and not the other. Dragging
	 * is the fast path and the buttons inside an opened item are the same move
	 * for anyone not using a mouse.
	 */
	import * as Icons from "@lucide/svelte"
	import { useWidgetContext } from "$lib/shared/widgets/context"
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { declareInterest } from "$lib/client/sockets/interest.svelte"
	import { interestKey } from "$lib/shared/sockets/interest"
	import {
		openSessionState,
		sessionState
	} from "$lib/client/state/sessionState.svelte"
	import {
		groupByItem,
		groupByOwner,
		type InventoryOwner
	} from "$lib/shared/state/inventoryGroups"

	interface Props {
		sessionId: number | null
		session?: unknown
		channels: string[]
	}
	let { sessionId, session }: Props = $props()

	const store = sessionState()
	$effect(() => openSessionState(sessionId))
	const widget = useWidgetContext()
	const socket = useTypedSocket()

	let settings = $derived(
		(widget?.current?.settings?.v1 ?? {}) as Record<string, unknown>
	)
	let showWorld = $derived(settings.showWorld !== false)
	let groupBy = $derived((settings.groupBy as string) ?? "owner")

	/** The world owner is a place, not a person; its own label says so. */
	let owners = $derived<InventoryOwner[]>(
		[...store.owners.values()].map((o) => ({
			key: o.key,
			label: o.key === "world" ? "On the table" : o.label,
			kind: o.kind,
			id: o.id
		}))
	)
	let groups = $derived(
		groupByOwner(store.state.possessions ?? {}, owners, { showWorld })
	)
	let items = $derived(groupByItem(store.state.possessions ?? {}, owners))
	let anything = $derived(
		Object.values(store.state.possessions ?? {}).some((l) => l.length)
	)

	/* ── the item's prose ───────────────────────────────────────────────────
	 * An entry's text is the lorebook's, not the edge's, so it is read from the
	 * lorebook and cached here for the life of the panel. Fetched on the first
	 * expand rather than with the state: an inventory of twenty items should
	 * not cost twenty entry reads nobody asked for. */
	let entryText = $state<Record<number, string>>({})
	let askedBook = false
	let lorebookId = $derived(
		((session as { lorebookId?: number | null } | undefined)?.lorebookId ??
			null) as number | null
	)

	function handleLorebook(res: Sockets.Lorebooks.Get.Response) {
		// The whole app shares one `lorebooks:get`, so a reply for another book
		// is not this panel's, and what this panel already knows is not its to
		// drop: guarded on the id, merged rather than replaced.
		if (lorebookId == null || res?.lorebook?.id !== lorebookId) return
		const next: Record<number, string> = { ...entryText }
		for (const entry of res?.entries ?? [])
			next[entry.id] = (entry as { content?: string }).content ?? ""
		entryText = next
	}

	/**
	 * This session's book, SCOPED to it — the reply carries the id on
	 * `lorebook.id` (`SCOPED_EVENTS` reads that, falling through to
	 * `lorebookId` on a not-found), so this panel is not handed every other
	 * view's book read. No BARE key alongside it: a bare one matches every
	 * book's reply, which on the server means the gate passing for all of them
	 * while this widget is on screen.
	 *
	 * Still an effect keyed on the id, for the same reason it always was: the
	 * session's book can change under the widget, and this releases the old
	 * key as it takes the new one.
	 */
	$effect(() => {
		if (lorebookId == null) return
		return declareInterest<"lorebooks:get">(
			interestKey("lorebooks:get", lorebookId),
			handleLorebook
		)
	})

	function loadProse() {
		if (askedBook || lorebookId == null) return
		askedBook = true
		socket.emit("lorebooks:get", { id: lorebookId })
	}

	let openItem = $state<string | null>(null)
	function toggle(key: string) {
		openItem = openItem === key ? null : key
		if (openItem) loadProse()
	}

	/* ── moving one ─────────────────────────────────────────────────────── */
	let dragging = $state<{ fromKey: string; entryId: number } | null>(null)

	const ownerOf = (key: string) => owners.find((o) => o.key === key) ?? null

	function move(fromKey: string, toKey: string, entryId: number) {
		const from = ownerOf(fromKey)
		const to = ownerOf(toKey)
		if (!from || !to || from.key === to.key) return
		store.transfer(
			{ kind: from.kind, id: from.id },
			{ kind: to.kind, id: to.id },
			entryId
		)
	}

	function onDrop(e: DragEvent, toKey: string) {
		e.preventDefault()
		const held = dragging
		dragging = null
		if (held) move(held.fromKey, toKey, held.entryId)
	}
</script>

<div class="inv" data-state-widget="inventory">
	{#if store.error}
		<p class="text-error-700-300 text-xs" role="alert">{store.error}</p>
	{/if}

	{#if !anything && !groups.length}
		<div class="empty">
			<Icons.Backpack size={20} aria-hidden="true" />
			<span>
				Nobody is carrying anything yet. An item is a lorebook entry, so
				what turns up here is what the story hands somebody.
			</span>
		</div>
	{:else if groupBy === "item"}
		{#each items as item (item.entryId)}
			<section class="row" data-entry-id={item.entryId}>
				<button
					class="row-head"
					onclick={() => toggle(`i${item.entryId}`)}
				>
					<Icons.Package size={12} aria-hidden="true" />
					<span class="truncate">{item.name}</span>
					<span class="qty">×{item.total}</span>
				</button>
				<div class="holders">
					{#each item.holders as holder (holder.key)}
						<span
							class="chip"
							draggable="true"
							role="button"
							tabindex="0"
							aria-label="{item.name} held by {holder.label}"
							ondragstart={() =>
								(dragging = {
									fromKey: holder.key,
									entryId: item.entryId
								})}
							ondragend={() => (dragging = null)}
						>
							{holder.label} ×{holder.quantity}
						</span>
					{/each}
				</div>
				{#if openItem === `i${item.entryId}`}
					<p class="prose">
						{entryText[item.entryId] || "This entry has no text."}
					</p>
				{/if}
			</section>
		{/each}
	{:else}
		{#each groups as group (group.key)}
			<!-- The group is the drop target: dropping on it is giving. A group
			     with no owner behind it (a cast member who has left) takes
			     nothing, because there is no owner a write could name. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<section
				class="group"
				class:droppable={!!dragging && !!group.owner}
				data-owner-key={group.key}
				ondragover={(e) => group.owner && e.preventDefault()}
				ondrop={(e) => group.owner && onDrop(e, group.key)}
			>
				<header class="group-head">
					{#if group.key === "world"}
						<Icons.Table2 size={12} aria-hidden="true" />
					{:else}
						<Icons.UserRound size={12} aria-hidden="true" />
					{/if}
					<span class="truncate font-semibold">{group.label}</span>
				</header>

				{#if !group.items.length}
					<p class="none">nothing</p>
				{:else}
					{#each group.items as line (line.entryId)}
						{@const key = `${group.key}:${line.entryId}`}
						<div class="item" data-entry-id={line.entryId}>
							<button
								class="row-head"
								draggable="true"
								aria-expanded={openItem === key}
								ondragstart={() =>
									(dragging = {
										fromKey: group.key,
										entryId: line.entryId
									})}
								ondragend={() => (dragging = null)}
								onclick={() => toggle(key)}
							>
								<Icons.Package size={12} aria-hidden="true" />
								<span class="truncate">{line.name}</span>
								{#if line.quantity > 1}
									<span class="qty">×{line.quantity}</span>
								{/if}
							</button>
							{#if openItem === key}
								<div class="detail">
									<p class="prose">
										{entryText[line.entryId] ||
											"This entry has no text."}
									</p>
									<div class="moves">
										<span class="moves-label">Give to</span>
										{#each owners.filter((o) => o.key !== group.key && (showWorld || o.kind !== "session")) as target (target.key)}
											<button
												class="chip"
												onclick={() =>
													move(
														group.key,
														target.key,
														line.entryId
													)}
											>
												{target.label}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.inv {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		height: 100%;
		overflow: auto;
		padding: 0.5rem;
		font-size: 0.74rem;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		height: 100%;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.group,
	.row {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.4rem 0.5rem;
		border-radius: 0.5rem;
		background: color-mix(in oklab, currentColor 6%, transparent);
	}
	/* What a drop would land on, while something is being dragged. */
	.droppable {
		outline: 1px dashed color-mix(in oklab, currentColor 45%, transparent);
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	.row-head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		width: 100%;
		text-align: left;
		min-width: 0;
	}
	.qty {
		font-variant-numeric: tabular-nums;
		opacity: 0.7;
	}
	.none {
		opacity: 0.45;
		font-style: italic;
	}
	.holders,
	.moves {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}
	.moves-label {
		opacity: 0.6;
	}
	.chip {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 14%, transparent);
	}
	.chip:hover {
		filter: brightness(1.15);
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding-inline-start: 1rem;
	}
	.prose {
		white-space: pre-wrap;
		opacity: 0.8;
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
</style>
