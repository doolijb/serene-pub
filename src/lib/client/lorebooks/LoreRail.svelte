<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import LensRow from "./LensRow.svelte"
	import ReadingInto from "./ReadingInto.svelte"
	import { readingLine, type ScopeFacet, type SavedScopeId } from "./scopes"
	import { SAVED_SCOPES } from "./scopes"
	import type { LoreLens, LoreScope } from "$lib/shared/lorebooks/loreRoute"
	import type { PoolItem } from "./poolFilter"
	import { kindLabel } from "./sections/kinds"

	/**
	 * The desk: the book, the search, the lens, the scopes, what is saved, what
	 * is pinned, and which session is reading.
	 *
	 * Nothing here is a mode. The scopes are facets over one pool and every one
	 * of them is offered in every book: an empty facet goes dim and sorts last
	 * rather than disappearing, because a facet that vanishes teaches the
	 * reader the capability does not exist.
	 */
	interface Props {
		/**
		 * The lines and where the reader stands — for the session block alone.
		 *
		 * ⚠ The rail does not SWITCH lines — the World bar above the workspace
		 * is the one control that does. These are read so the session block can
		 * say whether the reader has parted from the session, which is a question
		 * about the session and belongs beside it.
		 */
		branches: readonly Sockets.Amendments.Branch[]
		branchId: number | null
		moment?: string
		/** The session reading this book, when one is. */
		session: {
			id: number
			name: string
			branchId: number | null
			/** Its story clock; null follows the line's present (now). */
			clock: { year: number; month?: number | null; day?: number | null } | null
		} | null
		/** Put the reader on the session's line, at its clock. */
		onMatchSession: () => void
		scopes: ScopeFacet[]
		scope: LoreScope
		lens: LoreLens
		search: string
		savedCounts: Record<SavedScopeId, number>
		saved: SavedScopeId | null
		pinned: PoolItem[]
		/** What the open session is called, when one reads this book. */
		readingInto: string | null
		/** How many entries the newest run read in; null when none reads it. */
		reached: number | null
		onScope: (scope: LoreScope) => void
		onLens: (lens: LoreLens) => void
		onSaved: (saved: SavedScopeId | null) => void
		onSearch: (search: string) => void
		onOpenEntry: (item: PoolItem) => void
	}

	let {
		branches,
		branchId,
		moment,
		session,
		onMatchSession,
		scopes,
		scope,
		lens,
		search,
		savedCounts,
		saved,
		pinned,
		readingInto,
		reached,
		onScope,
		onLens,
		onSaved,
		onSearch,
		onOpenEntry
	}: Props = $props()
</script>

<nav
	class="border-border flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r pr-4"
	aria-label="Lorebook"
	data-lore-rail
>
	<!-- The line moved to the World bar above the workspace (2026-09-24):
	     line and moment are one question and were answered in two corners.
	     The book's name and menu moved to its header (2026-09-27). -->

	<!-- The session first, because the book is only half the picture and the
	     other half can now disagree with what is on screen. -->
	{#if session}
		<ReadingInto
			sessionId={session.id}
			sessionName={session.name}
			{reached}
			sessionBranchId={session.branchId}
			sessionStoryClock={session.clock}
			{branchId}
			{moment}
			{branches}
			onMatch={onMatchSession}
		/>
	{/if}

	<input
		class="input input-sm"
		type="search"
		data-lore-search
		placeholder="Search this book ⌘K"
		aria-label="Search this book"
		value={search}
		oninput={(e) => onSearch(e.currentTarget.value)}
	/>

	<LensRow {lens} onLens={(next) => onLens(next)} />

	<div class="flex flex-col gap-1">
		<span class="text-surface-600-400 text-xs">
			Views
		</span>
		<ul class="flex flex-col gap-1">
			{#each scopes as facet (facet.id)}
				<li>
					<button
						type="button"
						class="btn btn-sm w-full justify-start gap-2 {scope ===
						facet.id
							? 'sidebar-row-active'
							: 'hover:preset-tonal-surface'}"
						class:opacity-60={facet.empty && scope !== facet.id}
						aria-current={scope === facet.id ? "page" : undefined}
						data-lore-scope={facet.id}
						onclick={() => onScope(facet.id)}
					>
						<span class="flex-1 truncate text-left">
							{facet.label}
						</span>
						{#if facet.count !== undefined}
							<span class="badge preset-tonal-surface shrink-0">
								{facet.count}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	</div>

	<div class="flex flex-col gap-1">
		<span class="text-surface-600-400 text-xs">
			Saved
		</span>
		<ul class="flex flex-col gap-1">
			{#each SAVED_SCOPES as s (s.id)}
				{@const count = savedCounts[s.id]}
				<li>
					<button
						type="button"
						class="btn btn-sm w-full justify-start gap-2 {saved ===
						s.id
							? 'sidebar-row-active'
							: 'hover:preset-tonal-surface'}"
						class:opacity-60={count === 0 && saved !== s.id}
						title={s.title}
						aria-pressed={saved === s.id}
						data-lore-saved={s.id}
						onclick={() => onSaved(saved === s.id ? null : s.id)}
					>
						<span class="flex-1 truncate text-left">{s.label}</span>
						<span class="badge preset-tonal-surface shrink-0">
							{count}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>

	{#if pinned.length}
		<ul class="flex flex-col gap-1" aria-label="Pinned entries">
			{#each pinned as item (item.key)}
				<li>
					<button
						type="button"
						class="btn btn-sm hover:preset-tonal-surface w-full justify-start gap-2"
						onclick={() => onOpenEntry(item)}
					>
						<Icons.Pin
							size={12}
							class="text-warning-500 shrink-0"
							aria-hidden="true"
						/>
						<span
							class="text-surface-600-400 shrink-0 text-xs"
						>
							{kindLabel(item.kind)}
						</span>
						<span class="min-w-0 flex-1 truncate text-left">
							{item.name}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- With a session, the block at the top says all of this and more; this
	     line is what an UNREAD book has to say, which is worth saying once. -->
	{#if !session}
		<p class="text-surface-700-300 mt-auto text-xs" data-lore-reading>
			{readingLine(readingInto, reached)}
		</p>
	{/if}
</nav>
