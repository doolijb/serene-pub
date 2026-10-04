<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import * as Icons from "@lucide/svelte"
	import type { Snippet } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import { dndzone } from "svelte-dnd-action"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import type { LoreLens } from "$lib/shared/lorebooks/loreRoute"
	import {
		activeFilterCount,
		buildTree,
		emptyFilters,
		flattenTree,
		hasNesting,
		SCENE_KIND,
		CAST_KIND,
		type PoolFilters,
		type PoolItem
	} from "./poolFilter"
	import { canFileUnder } from "./editor/partOf"
	import { rowDrag } from "./editor/rowDrag"
	import { markerFor, type EntryDecisions } from "./markers"
	import type { FacetCounts } from "./scopes"
	import { nothingMatchesLine, POOL_SORTS } from "./scopes"
	import { kindLabel } from "./sections/kinds"
	import { getLorePoolCtx } from "./sections/poolContext"
	import type { PoolSource, SectionDescriptor } from "./sections/types"

	/**
	 * The one list, under its header.
	 *
	 * Every scope draws this: a scope is a facet over the pool, not a list of
	 * its own, so the search, the kind chips, the state chips and the sort
	 * compose rather than each belonging to somebody. The three reading lenses
	 * are ways of drawing the same rows — List is the row frame with the row's
	 * own kind inside it, Cards is the pool's own shape, and Tree nests by each
	 * row's anchor and falls back to List when nothing in the pool is nested.
	 */
	interface Props {
		items: PoolItem[]
		/** The wire row behind a pool row. */
		sourceOf: (item: PoolItem) => PoolSource | undefined
		/** The door that curates one row, which in the pool varies per row. */
		descriptorOf: (item: PoolItem) => SectionDescriptor
		/** The door the list belongs to, for its empty copy and its New. */
		descriptor: SectionDescriptor
		bindings: BindingWithRelations[]
		vectorizationEnabled: boolean
		selectedKey: string | null
		lens: LoreLens
		filters: PoolFilters
		/** What each chip says, counted over the whole scope. */
		facets: FacetCounts
		/** The scope this list is of, as its heading. */
		scopeTitle: string
		/** "30 entries · 4 reached the last turn". */
		summary: string
		orderBy: string
		mode: "desk" | "compact"
		/** Absent while the list is still arriving. */
		loading?: boolean
		/**
		 * Rows the timeline cursor says are not true yet at the moment being
		 * read. Dimmed rather than hidden: the reader asked to look back, not
		 * to have the book edited out from under them.
		 */
		dimmedKeys?: ReadonlySet<string>
		/**
		 * What the attached session's newest run decided, by entry id. Null
		 * when no session reads this book, which is when the marks are not
		 * drawn at all.
		 */
		decisions?: EntryDecisions | null
		/** Opens a row's retrieval account. Absent leaves the marks inert. */
		onMarker?: (item: PoolItem) => void
		/** The New control, which is a menu when several doors are open. */
		newControl?: Snippet
		/** A door's own list action, beside the sort. */
		toolbarExtra?: Snippet
		onSelect: (item: PoolItem) => void
		onDelete: (item: PoolItem) => void
		/** Starts the door's default create, for the empty state's one button. */
		onNew?: () => void
		onFilters: (filters: PoolFilters) => void
		onOrderBy: (orderBy: string) => void
		onReorder: (items: PoolItem[]) => void
	}

	let {
		items,
		sourceOf,
		descriptorOf,
		descriptor,
		bindings,
		vectorizationEnabled,
		selectedKey,
		lens,
		filters,
		facets,
		scopeTitle,
		summary,
		orderBy,
		mode,
		loading = false,
		dimmedKeys,
		decisions = null,
		onMarker,
		newControl,
		toolbarExtra,
		onSelect,
		onDelete,
		onNew,
		onFilters,
		onOrderBy,
		onReorder
	}: Props = $props()

	const poolCtx = getLorePoolCtx()

	/**
	 * A row dropped on a row is filed under it — the same `anchorEntryId` write
	 * the editor's Part of picker makes, from the other direction. The refusal
	 * is asked of the whole pool rather than of the rows on screen: a
	 * descendant a facet is hiding is still a descendant.
	 */
	const dragOptions = (item: PoolItem) => ({
		key: item.key,
		// A cast member lists in All (note 12) but is never filed or filed
		// under: the people are not lore's parents.
		draggable: item.kind !== SCENE_KIND && item.kind !== CAST_KIND,
		canDrop: (from: string) =>
			item.kind !== CAST_KIND &&
			canFileUnder(from, item.key, poolCtx.pool, poolCtx.newRowBranchId),
		onDrop: (from: string) => poolCtx.reparent(from, item.key)
	})

	let openMenuKey = $state<string | null>(null)
	let filtersOpen = $state(false)
	let isReordering = $state(false)
	let reorderDraft = $state<PoolItem[]>([])
	/** Which rows are folded shut in the tree, by key. */
	const collapsed = new SvelteSet<string>()

	let treeOffered = $derived(hasNesting(items))
	let effectiveLens = $derived<LoreLens>(
		lens === "tree" && !treeOffered ? "list" : lens
	)
	let treeRows = $derived(
		effectiveLens === "tree" ? flattenTree(buildTree(items), collapsed) : []
	)
	let filterCount = $derived(activeFilterCount(filters))
	/**
	 * Reordering renumbers `position` 1..n over the rows it is handed, so it
	 * is offered only where those rows are the whole of one kind: a narrowed
	 * list with nothing filtered out. Reordering a filtered list would
	 * renumber the visible rows on top of the hidden ones.
	 */
	let narrowed = $derived(
		descriptor.roles.has("position") && descriptor.kind != null
	)
	let filtering = $derived(
		filterCount > 0 || filters.search.trim().length > 0
	)
	let reorderable = $derived(
		narrowed && effectiveLens === "list" && !filtering
	)

	function toggleKind(kind: string) {
		const next = filters.kinds.includes(kind)
			? filters.kinds.filter((k) => k !== kind)
			: [...filters.kinds, kind]
		onFilters({ ...filters, kinds: next })
	}

	function toggleCollapsed(key: string) {
		if (collapsed.has(key)) collapsed.delete(key)
		else collapsed.add(key)
	}

	function startReorder() {
		// Presented in position order, which is the order being edited, not
		// whatever ordering the toolbar is currently reading the list in.
		reorderDraft = [...items].sort((a, b) => a.position - b.position)
		isReordering = true
	}

	/**
	 * The mark for one row, or none.
	 *
	 * Gated on the kind as well as on the decision: decisions are keyed by
	 * entry id and a scene's id comes out of another table, so an unguarded
	 * lookup would mark a scene with whatever an entry of the same number was
	 * decided to be.
	 */
	function markerOf(item: PoolItem) {
		if (item.kind === SCENE_KIND) return null
		return markerFor(decisions, item.id)
	}

	/**
	 * Enter or Space on the row itself picks it. ⚠ Only on the row: a key
	 * pressed on a control inside the row's box bubbles here too, and that
	 * key belongs to the control — picking the row would swallow the
	 * control's own press (plan B7).
	 */
	function activate(event: KeyboardEvent, item: PoolItem) {
		if (event.target !== event.currentTarget) return
		if (event.key !== "Enter" && event.key !== " ") return
		event.preventDefault()
		onSelect(item)
	}
</script>

<!-- Every chip stands whatever its figure is: one counting none goes dim and
     says so, because a chip that vanishes teaches the reader the state does
     not exist. -->
{#snippet chip(
	label: string,
	count: number,
	active: boolean,
	onclick: () => void
)}
	<button
		type="button"
		class="chip gap-1 {active
			? 'preset-tonal-primary'
			: 'preset-tonal-surface'}"
		class:opacity-60={count === 0 && !active}
		aria-pressed={active}
		{onclick}
	>
		<span>{label}</span>
		<span class="text-xs opacity-80">{count}</span>
	</button>
{/snippet}

{#snippet filterChips()}
	{#if facets.kinds.length > 1}
		<div class="flex flex-wrap gap-1" role="group" aria-label="Kinds">
			{#each facets.kinds as facet (facet.kind)}
				{@render chip(
					kindLabel(facet.kind),
					facet.count,
					filters.kinds.includes(facet.kind),
					() => toggleKind(facet.kind)
				)}
			{/each}
		</div>
	{/if}
	<div class="flex flex-wrap gap-1" role="group" aria-label="States">
		{@render chip("Read in last turn", facets.readIn, filters.readIn, () =>
			onFilters({ ...filters, readIn: !filters.readIn })
		)}
		{@render chip("Pinned", facets.pinned, filters.pinned, () =>
			onFilters({ ...filters, pinned: !filters.pinned })
		)}
		{@render chip("Off", facets.off, filters.off, () =>
			onFilters({ ...filters, off: !filters.off })
		)}
		{@render chip("Archived", facets.archived, filters.archived, () =>
			onFilters({ ...filters, archived: !filters.archived })
		)}
		{@render chip(
			"Machine-written",
			facets.machineWritten,
			filters.machineWritten,
			() =>
				onFilters({
					...filters,
					machineWritten: !filters.machineWritten
				})
		)}
	</div>
	<!-- Needs keywords stays a filter (note 5, 2026-10-02): the same rule as
	     the Loose ends queue's keyword chore, as a narrowing of this list.
	     The queue itself opens from the rail, or the chip beside the scopes
	     in compact. -->
	<div class="flex flex-wrap gap-1" role="group" aria-label="Chores">
		{@render chip(
			"Needs keywords",
			facets.needsKeywords,
			filters.needsKeywords,
			() =>
				onFilters({
					...filters,
					needsKeywords: !filters.needsKeywords
				})
		)}
	</div>
{/snippet}

{#snippet sortControl()}
	<Select
		label="Sort"
		labelHidden
		class="w-44 text-sm"
		options={POOL_SORTS}
		value={orderBy}
		onValueChange={(v) => {
			// A clear is not an ordering; the pool always has one.
			if (v) onOrderBy(v)
		}}
	/>
{/snippet}

{#snippet retrievalMark(item: PoolItem)}
	{@const mark = markerOf(item)}
	{#if mark}
		<!-- Algolia's medal, not Elasticsearch's explain: the mark says which
		     of three states this row is in, hovering says what it is about,
		     and pressing it opens the account. -->
		<button
			type="button"
			data-retrieval-marker={mark.label.toLowerCase()}
			class="text-primary-500 shrink-0 rounded px-1 text-xs leading-none"
			title={mark.title}
			onclick={(e) => {
				e.stopPropagation()
				onMarker?.(item)
			}}
			onkeydown={(e) => e.stopPropagation()}
		>
			<span aria-hidden="true">{mark.glyph}</span>
			<span class="sr-only">{mark.label} in the newest run</span>
		</button>
	{/if}
{/snippet}

{#snippet rowMenu(item: PoolItem, source: PoolSource)}
	{@const Extra = descriptorOf(item).rowMenu}
	<div role="none" onclick={(e) => e.stopPropagation()}>
		<Popover
			open={openMenuKey === item.key}
			onOpenChange={(e) => (openMenuKey = e.open ? item.key : null)}
			positioning={{ placement: "bottom-end" }}
		>
			<Popover.Trigger
				class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-1"
				title="More options"
				aria-label="More options for {item.name}"
			>
				<Icons.Ellipsis size={16} />
			</Popover.Trigger>
			<Portal>
				<Popover.Positioner class="z-[1000]!">
					<Popover.Content
						class="card bg-surface-100-900 flex min-w-36 flex-col gap-1 p-2 shadow-xl"
					>
						<button
							class="btn btn-sm preset-filled-surface-400-600 w-full justify-start"
							type="button"
							onclick={() => {
								openMenuKey = null
								onSelect(item)
							}}
						>
							{#if item.kind === CAST_KIND}
								<Icons.Users size={14} /> Open in Cast
							{:else}
								<Icons.Pencil size={14} /> Edit
							{/if}
						</button>
						{#if item.kind !== CAST_KIND}
							{#if Extra}
								<Extra
									{source}
									close={() => (openMenuKey = null)}
								/>
							{/if}
							<hr class="border-surface-300-700" />
							<button
								class="btn btn-sm preset-filled-error-500 w-full justify-start"
								type="button"
								onclick={() => {
									openMenuKey = null
									onDelete(item)
								}}
							>
								<Icons.Trash2 size={14} /> Delete
							</button>
						{/if}
					</Popover.Content>
				</Popover.Positioner>
			</Portal>
		</Popover>
	</div>
{/snippet}

{#snippet listRow(
	item: PoolItem,
	depth: number,
	treeToggle?: boolean,
	hasChildren?: boolean
)}
	{@const source = sourceOf(item)}
	{#if source}
		{@const Row = descriptorOf(item).row}
		<!-- The row's box holds the controls BESIDE the part that picks it
		     (plan B7): a control nested in a role=button is a nested
		     interactive, and its keys reached the row instead of it. -->
		<div
			data-entry-row
			data-entry-key={item.key}
			class="preset-filled-surface-100-900 hover:bg-surface-200-800 data-[drop-target]:ring-primary-500 flex items-start gap-2 rounded-lg transition-colors data-[drop-target]:ring-2"
			class:preset-tonal-primary={selectedKey === item.key}
			class:opacity-60={item.archived}
			class:opacity-50={!item.archived && dimmedKeys?.has(item.key)}
			style={depth ? `margin-left:${depth * 16}px` : undefined}
			use:rowDrag={dragOptions(item)}
		>
			{#if treeToggle}
				{#if hasChildren}
					<button
						class="btn btn-sm preset-tonal-surface mt-3 ml-3 shrink-0 p-1"
						type="button"
						aria-label={collapsed.has(item.key)
							? "Expand"
							: "Collapse"}
						aria-expanded={!collapsed.has(item.key)}
						onclick={(e) => {
							e.stopPropagation()
							toggleCollapsed(item.key)
						}}
					>
						{#if collapsed.has(item.key)}
							<Icons.ChevronRight size={14} />
						{:else}
							<Icons.ChevronDown size={14} />
						{/if}
					</button>
				{:else}
					<span class="mt-3 ml-3 w-6 shrink-0" aria-hidden="true"></span>
				{/if}
			{/if}
			<div
				role="button"
				tabindex="0"
				data-entry-pick
				aria-current={selectedKey === item.key ? "true" : undefined}
				class="focus-visible:outline-primary-500 min-w-0 flex-1 cursor-pointer self-stretch rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
				class:pl-3={!treeToggle}
				onclick={() => onSelect(item)}
				onkeydown={(e) => activate(e, item)}
			>
				<Row {item} {source} {bindings} {vectorizationEnabled} />
			</div>
			<div class="flex shrink-0 items-start gap-2 py-3 pr-3">
				{@render retrievalMark(item)}
				{@render rowMenu(item, source)}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet card(item: PoolItem)}
	{@const source = sourceOf(item)}
	{#if source}
		<!-- The retrieval mark stands beside the part that picks the card,
		     never inside it (plan B7: a nested interactive). -->
		<div
			data-entry-row
			data-entry-key={item.key}
			class="preset-filled-surface-100-900 hover:bg-surface-200-800 data-[drop-target]:ring-primary-500 flex items-start gap-1 rounded-lg transition-colors data-[drop-target]:ring-2"
			class:preset-tonal-primary={selectedKey === item.key}
			class:opacity-60={item.archived}
			class:opacity-50={!item.archived && dimmedKeys?.has(item.key)}
			use:rowDrag={dragOptions(item)}
		>
			<div
				role="button"
				tabindex="0"
				data-entry-pick
				aria-current={selectedKey === item.key ? "true" : undefined}
				class="focus-visible:outline-primary-500 flex min-w-0 flex-1 cursor-pointer flex-col gap-2 self-stretch rounded-lg p-3 focus-visible:outline-2 focus-visible:outline-offset-2"
				onclick={() => onSelect(item)}
				onkeydown={(e) => activate(e, item)}
			>
				<div class="flex min-w-0 items-start gap-2">
					<span class="min-w-0 flex-1 truncate text-sm font-semibold">
						{item.name}
					</span>
					{#if item.pinned}
						<Icons.Pin
							size={12}
							class="text-warning-500 shrink-0"
							aria-label="Pinned"
						/>
					{/if}
				</div>
				<p
					class="text-surface-600-400 line-clamp-3 text-xs leading-relaxed"
				>
					{item.content.trim().split("\n")[0] || "No content yet."}
				</p>
				<span class="badge preset-tonal-surface self-start text-[11px]">
					{kindLabel(item.kind)}
				</span>
			</div>
			<div class="shrink-0 pt-3 pr-3 empty:hidden">
				{@render retrievalMark(item)}
			</div>
		</div>
	{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-3" data-lore-pool={effectiveLens}>
	<div class="flex flex-col gap-2">
		<div class="flex min-w-0 items-baseline gap-2">
			<h2 class="min-w-0 shrink-0 text-sm font-semibold">
				{scopeTitle}
			</h2>
			<span
				class="text-surface-700-300 min-w-0 flex-1 truncate text-xs"
				data-lore-pool-summary
			>
				{summary}
			</span>
			{@render newControl?.()}
		</div>
		{#if mode === "desk"}
			<div class="flex flex-wrap items-center gap-2">
				{@render sortControl()}
				{@render toolbarExtra?.()}
				{#if narrowed && effectiveLens === "list"}
					<button
						class="btn btn-sm preset-filled-surface-400-600 shrink-0"
						type="button"
						onclick={startReorder}
						disabled={items.length === 0 || !reorderable}
						title={filtering
							? "Clear the search and filters to reorder"
							: "Reorder entries"}
						aria-label="Reorder entries"
					>
						<Icons.SortAsc size={14} />
					</button>
				{/if}
			</div>
			{@render filterChips()}
		{:else}
			<div class="flex items-center gap-2">
				<Popover
					open={filtersOpen}
					onOpenChange={(e) => (filtersOpen = e.open)}
					positioning={{ placement: "bottom-start" }}
				>
					<Popover.Trigger
						class="btn btn-sm preset-tonal-surface gap-1"
						title="Filters"
					>
						<Icons.Filter size={14} aria-hidden="true" />
						<span>Filter</span>
						{#if filterCount > 0}
							<span class="badge preset-tonal-primary">
								{filterCount}
							</span>
						{/if}
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-100-900 flex w-[min(90vw,300px)] flex-col gap-3 p-4 shadow-xl"
							>
								{@render filterChips()}
								{@render sortControl()}
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
				{@render toolbarExtra?.()}
				{#if narrowed && effectiveLens === "list"}
					<button
						class="btn btn-sm preset-filled-surface-400-600 shrink-0"
						type="button"
						onclick={startReorder}
						disabled={items.length === 0 || !reorderable}
						title={filtering
							? "Clear the search and filters to reorder"
							: "Reorder entries"}
						aria-label="Reorder entries"
					>
						<Icons.SortAsc size={14} />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
		{#if loading}
			<div class="flex items-center justify-center py-8">
				<Icons.Loader2
					size={20}
					class="text-surface-600-400 animate-spin"
				/>
			</div>
		{:else if isReordering}
			<div class="text-surface-600-400 text-xs font-semibold">
				Drag to reorder
			</div>
			<div
				use:dndzone={{
					items: reorderDraft,
					flipDurationMs: 150,
					dropFromOthersDisabled: true
				}}
				onconsider={(e) => (reorderDraft = e.detail.items)}
				onfinalize={(e) => {
					reorderDraft = e.detail.items
					onReorder(reorderDraft)
				}}
				class="flex flex-col gap-1"
			>
				{#each reorderDraft as item (item.key)}
					<div
						class="bg-surface-200-800 hover:bg-surface-300-700 flex cursor-grab items-center gap-2 rounded-md p-2 text-sm"
						data-dnd-handle
					>
						<Icons.GripVertical
							size={16}
							class="text-surface-600-400 shrink-0"
						/>
						<span class="flex-1 truncate font-medium">
							{item.name}
						</span>
					</div>
				{/each}
			</div>
			<button
				class="btn btn-sm preset-filled-primary-500 w-full"
				type="button"
				onclick={() => (isReordering = false)}
			>
				<Icons.Check size={14} /> Done
			</button>
		{:else if items.length === 0 && filtering && facets.total > 0}
			<!-- The scope has rows; the search and filters hid all of them.
			     The first-run copy and its New button would be wrong here. -->
			<div
				class="flex flex-col items-center gap-3 py-8 text-center"
				data-lore-pool-filtered-empty
			>
				<p class="text-surface-700-300 text-sm">
					{nothingMatchesLine(filters.search)}
				</p>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={() => onFilters(emptyFilters())}
				>
					<Icons.FilterX size={14} aria-hidden="true" />
					Clear search and filters
				</button>
			</div>
		{:else if items.length === 0}
			<EmptyState
				icon={descriptor.icon}
				message={descriptor.emptyCopy.body}
				ctaLabel={onNew ? descriptor.emptyCopy.action : undefined}
				onCta={onNew}
			/>
		{:else if effectiveLens === "cards"}
			<div
				class="grid gap-2"
				style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));"
			>
				{#each items as item (item.key)}
					{@render card(item)}
				{/each}
			</div>
		{:else if effectiveLens === "tree"}
			{#each treeRows as row (row.item.key)}
				{@render listRow(row.item, row.depth, true, row.hasChildren)}
			{/each}
		{:else}
			{#each items as item (item.key)}
				{@render listRow(item, 0)}
			{/each}
		{/if}
	</div>
</div>
