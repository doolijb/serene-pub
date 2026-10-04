<script lang="ts" generics="Row">
	/**
	 * Django admin's **changelist**, for any admin object: every row of one
	 * kind, with a search box, **changelist filters** (Django's `list_filter`),
	 * sortable column headers, selection checkboxes and **bulk actions**, a
	 * result count, incremental loading, an "Add <thing>" primary, and empty
	 * and loading states. A row opens its change form at its admin address.
	 *
	 * It answers its OWN width with container queries (`@container/changelist`,
	 * STYLE-GUIDE §5.3 — the admin pane is a container; the window says
	 * nothing about it):
	 *
	 * | width    | rows                         | filters                      |
	 * | -------- | ---------------------------- | ---------------------------- |
	 * | < 45rem  | stacked: title + key facts   | a Filter button and popout   |
	 * | ≥ 45rem  | a table                      | a Filter button and popout   |
	 * | ≥ 60rem  | a table                      | a rail beside the table      |
	 *
	 * so the 400px dock never scrolls sideways, Half gets a table, and Focus
	 * gets Django's layout. Search, filters, sort and page ride the section's
	 * query (`?q=…&type=ollama&o=-models&p=2`), so a changelist can be linked
	 * to, and the breadcrumb back from a change form returns to the same view
	 * of the list (`rememberChangelistQuery`).
	 *
	 * Given a `title`, it draws the section's header too (with the "Add
	 * <thing>" primary in it, Django's top-right button), so its "Delete
	 * selected …" confirmation can take the whole pane as a page.
	 *
	 * The mechanics are pure (`changelist.ts`, tested); this file draws them.
	 */
	import { untrack, type Component, type Snippet } from "svelte"
	import { SvelteSet } from "svelte/reactivity"
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"
	import {
		adminGoto,
		adminPage,
		adminRouter
	} from "$lib/client/admin/adminRouter.svelte"
	import PanelFilterInput from "$lib/client/components/panels/PanelFilterInput.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import RowMenu from "$lib/client/components/menus/RowMenu.svelte"
	import EmptyState from "$lib/client/components/EmptyState.svelte"
	import { Pagination } from "@skeletonlabs/skeleton-svelte"
	import AdminDeleteConfirm from "./AdminDeleteConfirm.svelte"
	import AdminPageHeader from "./AdminPageHeader.svelte"
	import { rememberChangelistQuery } from "./breadcrumbs"
	import {
		applyChangelist,
		changelistQuery,
		countNoun,
		facetOptions,
		paginate,
		parseChangelistQuery,
		type AdminBulkAction,
		type AdminChangelistColumn,
		type AdminChangelistFilter,
		type AdminDeletion,
		type ChangelistState,
		type SortDir
	} from "./changelist"

	interface Props {
		rows: readonly Row[]
		rowKey: (row: Row) => string | number
		columns: AdminChangelistColumn<Row>[]
		/** `{ singular: "connection", plural: "connections" }`. */
		noun: { singular: string; plural: string }
		searchText?: (row: Row) => string
		/**
		 * The section's own read matches the search (the rows arrive
		 * searched, as History's logbook does on the server): the box still
		 * writes `q`, but rows are not matched against it here.
		 */
		serverSearch?: boolean
		filters?: AdminChangelistFilter<Row>[]
		bulkActions?: AdminBulkAction<Row>[]
		/** The row's change form. */
		rowHref?: (row: Row) => string
		addHref?: string
		/** Defaults to "Add <singular>". */
		addLabel?: string
		loading?: boolean
		/** When there are no rows at all. */
		emptyMessage?: string
		emptyIcon?: Component<any>
		defaultSort?: string
		defaultSortDir?: SortDir
		/** Rows a page (Django's `list_per_page`); "Show all" lifts it. */
		pageSize?: number
		/** Keep search, filters and sort in the section's query. */
		syncQuery?: boolean
		/** The section's own query keys the changelist carries through untouched (`runs`). */
		keepQuery?: readonly string[]
		/** Draws the columns marked `custom`. */
		cell?: Snippet<[Row, AdminChangelistColumn<Row>]>
		/** The section's title: the changelist then draws the header. */
		title?: string
		purpose?: string
		/** `docsHref(...)` for the header's "?" peek. */
		doc?: string
		/** Tonal header actions beside "Add <thing>". */
		headerActions?: Snippet
		/** Under the header: a status strip. */
		headerExtra?: Snippet
	}
	let {
		rows,
		rowKey,
		columns,
		noun,
		searchText,
		serverSearch = false,
		filters = [],
		bulkActions = [],
		rowHref,
		addHref,
		addLabel,
		loading = false,
		emptyMessage,
		emptyIcon = Icons.Inbox,
		defaultSort,
		defaultSortDir = "asc",
		pageSize = 50,
		syncQuery = true,
		keepQuery = [],
		cell,
		title,
		purpose,
		doc,
		headerActions,
		headerExtra
	}: Props = $props()

	const uid = $props.id()

	// ── state, seeded from the address once ─────────────────────────────
	// svelte-ignore state_referenced_locally
	const fallback = { sortKey: defaultSort ?? null, sortDir: defaultSortDir }
	// svelte-ignore state_referenced_locally
	const seed = syncQuery
		? parseChangelistQuery(
				adminPage.url.search,
				filters.map((f) => f.key),
				fallback
			)
		: { search: "", active: {}, sortKey: fallback.sortKey, sortDir: fallback.sortDir }
	let search = $state(seed.search)
	let active = $state<Record<string, string>>(seed.active)
	let sortKey = $state<string | null>(seed.sortKey)
	let sortDir = $state<SortDir>(seed.sortDir)
	let page = $state(seed.page ?? 1)
	let showAll = $state(false)

	const listState = $derived<ChangelistState>({ search, active, sortKey, sortDir })
	/** What rows are matched against here: none when the server searched. */
	const matchText = $derived(serverSearch ? undefined : searchText)

	// Any new search, filter or sort starts again at page 1 — but not the
	// seed itself, or a linked `?p=3` would never show page 3.
	const signature = (st: ChangelistState) =>
		JSON.stringify([st.search, st.active, st.sortKey, st.sortDir])
	// svelte-ignore state_referenced_locally
	let lastSignature = signature(listState)
	$effect(() => {
		const sig = signature(listState)
		if (sig === lastSignature) return
		lastSignature = sig
		page = 1
	})

	// svelte-ignore state_referenced_locally
	const listPath = adminPage.url.pathname
	$effect(() => {
		if (!syncQuery) return
		let q = changelistQuery({ ...listState, page: paged.page }, fallback)
		if (keepQuery.length) {
			const now = new URLSearchParams(untrack(() => adminPage.url.search))
			const out = new URLSearchParams(q)
			for (const k of keepQuery) {
				const v = now.get(k)
				if (v != null) out.set(k, v)
			}
			const s = out.toString()
			q = s ? `?${s}` : ""
		}
		rememberChangelistQuery(listPath, q)
		if (q !== adminPage.url.search) adminRouter.setQuery(q)
	})

	// ── derived rows ────────────────────────────────────────────────────
	const filtered = $derived(
		applyChangelist(rows, listState, { columns, filters, searchText: matchText })
	)
	const paged = $derived(paginate(filtered, page, showAll ? 0 : pageSize))
	const visible = $derived(paged.rows)
	const primaryCol = $derived(columns.find((c) => c.primary) ?? columns[0])
	const factCols = $derived(
		columns.filter((c) => c !== primaryCol && !c.hideWhenStacked)
	)
	const sortableCols = $derived(columns.filter((c) => !!c.sortValue))
	const activeCount = $derived(Object.values(active).filter(Boolean).length)
	const narrowed = $derived(activeCount > 0 || search.trim() !== "")
	/**
	 * Narrowed HERE, among the rows given — not by a server-applied facet or
	 * search, whose rows arrive narrowed ("100 of 100" would say nothing).
	 */
	const narrowedHere = $derived(
		filters.some((f) => f.counted !== false && active[f.key]) ||
			(!serverSearch && search.trim() !== "")
	)

	/**
	 * Nothing to filter yet: no rail, no Filter button — unless a filter is
	 * what emptied the list (a server-applied one), so it can be cleared.
	 */
	const hasFacets = $derived(filters.length > 0 && (rows.length > 0 || narrowed))

	// ── selection ───────────────────────────────────────────────────────
	// Django's: the header box selects this page; once it is all selected
	// and more rows match, "Select all N" takes the rest of the filter.
	const selected = new SvelteSet<string | number>()
	/** Only rows the filter shows are acted on; a filter hides the rest. */
	const selectedRows = $derived(filtered.filter((r) => selected.has(rowKey(r))))
	const pageSelected = $derived(
		visible.length > 0 && visible.every((r) => selected.has(rowKey(r)))
	)
	const allSelected = $derived(
		filtered.length > 0 && selectedRows.length === filtered.length
	)
	const someSelected = $derived(
		!pageSelected && visible.some((r) => selected.has(rowKey(r)))
	)
	$effect(() => {
		// A row that left the list (deleted elsewhere) leaves the selection.
		const keys = new Set(rows.map(rowKey))
		for (const k of [...selected]) if (!keys.has(k)) selected.delete(k)
	})
	function togglePage() {
		if (pageSelected) for (const r of visible) selected.delete(rowKey(r))
		else for (const r of visible) selected.add(rowKey(r))
	}
	function selectAllMatching() {
		for (const r of filtered) selected.add(rowKey(r))
	}
	function toggle(row: Row) {
		const k = rowKey(row)
		if (selected.has(k)) selected.delete(k)
		else selected.add(k)
	}

	// ── bulk actions ────────────────────────────────────────────────────
	let pendingAction = $state<AdminBulkAction<Row> | null>(null)
	let pendingRows = $state<Row[]>([])
	let pendingDeletion = $state<AdminDeletion | null>(null)
	function runAction(action: AdminBulkAction<Row>) {
		const target = [...selectedRows]
		if (!target.length) return
		if (action.confirm) {
			pendingAction = action
			pendingRows = target
			pendingDeletion = action.confirm(target)
			return
		}
		action.run(target)
		selected.clear()
	}
	function confirmAction() {
		const action = pendingAction
		const target = pendingRows
		pendingAction = null
		pendingDeletion = null
		pendingRows = []
		if (!action) return
		action.run(target)
		for (const r of target) selected.delete(rowKey(r))
	}

	// ── sort and filter presses ─────────────────────────────────────────
	function toggleSort(col: AdminChangelistColumn<Row>) {
		if (!col.sortValue) return
		if (sortKey === col.key) sortDir = sortDir === "asc" ? "desc" : "asc"
		else {
			sortKey = col.key
			sortDir = "asc"
		}
	}
	function pick(key: string, value: string | null) {
		const next = { ...active }
		if (value == null) delete next[key]
		else next[key] = value
		active = next
	}
	function clearAll() {
		active = {}
		search = ""
	}
	const sortOptions = $derived(
		sortableCols.flatMap((c) => [
			{ value: c.key, label: `${c.label} (ascending)` },
			{ value: `-${c.key}`, label: `${c.label} (descending)` }
		])
	)
	const sortValue = $derived(
		sortKey ? (sortDir === "desc" ? "-" : "") + sortKey : ""
	)
	let filterOpen = $state(false)

	const firstShown = $derived(paged.start + 1)
	const lastShown = $derived(paged.start + visible.length)

	function open(row: Row) {
		if (rowHref) void adminGoto(rowHref(row))
	}
	function label(col: AdminChangelistColumn<Row>, row: Row): string {
		return col.text?.(row) ?? ""
	}
	function optionLabel(f: AdminChangelistFilter<Row>, value: string) {
		return (
			f.options?.find((o) => o.value === value)?.label ??
			f.optionLabel?.(value) ??
			value
		)
	}
</script>

{#snippet facetGroups()}
	{#each filters as f (f.key)}
		{@const options = facetOptions(rows, f, listState, { filters, searchText: matchText })}
		<div class="flex flex-col gap-0.5" role="radiogroup" aria-label="By {f.label.toLowerCase()}">
			<h3 class="text-surface-600-400 px-2.5 pt-2 pb-1 text-xs">
				By {f.label.toLowerCase()}
			</h3>
			{#each [{ value: "", label: f.allLabel ?? "All", count: null }, ...options] as option (option.value)}
				{@const checked = (active[f.key] ?? "") === option.value}
				<button
					type="button"
					role="radio"
					aria-checked={checked}
					class="flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] {checked
						? 'sidebar-row-active'
						: 'hover:bg-surface-200-800'}"
					onclick={() => pick(f.key, option.value || null)}
				>
					<span class="min-w-0 flex-1 truncate">{option.label}</span>
					{#if option.count != null}
						<span class="text-surface-600-400 shrink-0 text-xs tabular-nums">
							{option.count}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	{/each}
{/snippet}

{#snippet checkbox(row: Row)}
	<input
		type="checkbox"
		class="checkbox"
		checked={selected.has(rowKey(row))}
		onchange={() => toggle(row)}
		onclick={(e) => e.stopPropagation()}
		aria-label="Select {label(primaryCol, row)}"
	/>
{/snippet}

{#snippet cellContent(row: Row, col: AdminChangelistColumn<Row>)}
	{#if col.custom && cell}
		{@render cell(row, col)}
	{:else}
		{label(col, row)}
	{/if}
{/snippet}

{#snippet titleLink(row: Row, cls: string)}
	{#if rowHref}
		<a href={rowHref(row)} class={cls}>
			{@render cellContent(row, primaryCol)}
		</a>
	{:else}
		<span class={cls}>{@render cellContent(row, primaryCol)}</span>
	{/if}
{/snippet}

{#snippet addButton()}
	{#if addHref}
		<a href={addHref} class="btn btn-sm preset-filled-primary-500 shrink-0">
			<Icons.Plus size={16} aria-hidden="true" />
			{addLabel ?? `Add ${noun.singular}`}
		</a>
	{/if}
{/snippet}

{#if pendingDeletion}
	<AdminDeleteConfirm
		deletion={pendingDeletion}
		onCancel={() => {
			pendingAction = null
			pendingDeletion = null
			pendingRows = []
		}}
		onConfirm={confirmAction}
	/>
{:else}
	{#if title}
		<AdminPageHeader {title} {purpose} {doc}>
			{#snippet actions()}
				{@render headerActions?.()}
				<!-- With no rows the empty state carries the one Add. -->
				{#if rows.length || loading}{@render addButton()}{/if}
			{/snippet}
			{@render headerExtra?.()}
		</AdminPageHeader>
	{/if}

<!-- The container the changelist's own width rules read (§5.3): a
     container cannot query itself, so the rules live one level in. -->
<div class="@container/changelist min-w-0">
<div class="flex min-w-0 flex-col gap-3">
	<!-- ── toolbar: search, filter popout, sort (stacked), add ─────────── -->
	<div class="flex min-w-0 flex-wrap items-center gap-2">
		{#if (searchText || serverSearch) && (rows.length || loading || narrowed)}
			<div class="min-w-0 flex-[1_1_14rem]">
				<PanelFilterInput
					id="{uid}-search"
					bind:value={search}
					placeholder={noun.plural}
					singular={noun.singular}
					count={rows.length}
				/>
			</div>
		{/if}
		{#if hasFacets}
			<div class="shrink-0 @min-[60rem]/changelist:hidden">
				<Popover
					open={filterOpen}
					onOpenChange={(e) => (filterOpen = e.open)}
					positioning={{ placement: "bottom-end" }}
				>
					<Popover.Trigger
						class="btn grid size-10 shrink-0 place-items-center p-0 {activeCount
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
						title="Filter {noun.plural}"
						aria-label="Filter {noun.plural}{activeCount
							? ` (${activeCount} on)`
							: ''}"
						aria-expanded={filterOpen}
					>
						<Icons.ListFilter size={16} aria-hidden="true" />
					</Popover.Trigger>
					<Portal>
						<Popover.Positioner class="z-[1000]!">
							<Popover.Content
								class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,280px)] border p-2 shadow-xl"
							>
								<div class="flex max-h-[min(70vh,440px)] flex-col gap-1 overflow-y-auto">
									{@render facetGroups()}
								</div>
							</Popover.Content>
						</Popover.Positioner>
					</Portal>
				</Popover>
			</div>
		{/if}
		{#if sortOptions.length}
			<div class="w-48 shrink-0 @min-[45rem]/changelist:hidden">
				<Select
					label="Sort {noun.plural} by"
					labelHidden
					options={sortOptions}
					value={sortValue}
					onValueChange={(v) => {
						sortKey = v ? v.replace(/^-/, "") : null
						sortDir = v.startsWith("-") ? "desc" : "asc"
					}}
				/>
			</div>
		{/if}
		{#if !title && (rows.length || loading)}
			<span class="ml-auto">{@render addButton()}</span>
		{/if}
	</div>

	<!-- The narrowing in force, one dismissible chip per facet. -->
	{#if activeCount}
		<div class="flex flex-wrap items-center gap-1.5" aria-label="Filters in use">
			{#each filters.filter((f) => active[f.key]) as f (f.key)}
				<button
					type="button"
					class="preset-tonal-primary inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs"
					onclick={() => pick(f.key, null)}
					aria-label="Remove filter {f.label}: {optionLabel(f, active[f.key])}"
				>
					{f.label}: {optionLabel(f, active[f.key])}
					<Icons.X size={12} aria-hidden="true" />
				</button>
			{/each}
			<button
				type="button"
				class="text-surface-600-400 hover:text-surface-950-50 min-h-8 px-2 text-xs underline underline-offset-2"
				onclick={clearAll}
			>
				Clear all
			</button>
		</div>
	{/if}

	<div class="flex min-w-0 items-start gap-4">
		<div class="flex min-w-0 flex-1 flex-col gap-2">
			<!-- ── the action bar: select all, count, bulk actions ─────── -->
			{#if rows.length}
			<div
				class="text-surface-600-400 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
			>
				{#if bulkActions.length && visible.length}
					<input
						type="checkbox"
						class="checkbox @min-[45rem]/changelist:hidden"
						checked={pageSelected}
						indeterminate={someSelected}
						onchange={togglePage}
						aria-label="Select the {countNoun(visible.length, noun)} on this page"
					/>
				{/if}
				<span aria-live="polite">
					{#if loading}
						Loading {noun.plural}…
					{:else if narrowedHere}
						{filtered.length} of {countNoun(rows.length, noun)}
					{:else}
						{countNoun(rows.length, noun)}
					{/if}
					{#if bulkActions.length && selectedRows.length}
						· {selectedRows.length} of {filtered.length} selected
					{/if}
				</span>
				{#if pageSelected && !allSelected && paged.pageCount > 1}
					<button
						type="button"
						class="text-primary-600-400 underline underline-offset-2"
						onclick={selectAllMatching}
					>
						Select all {countNoun(filtered.length, noun)}
					</button>
				{/if}
				{#if selectedRows.length}
					<button
						type="button"
						class="hover:text-surface-950-50 underline underline-offset-2"
						onclick={() => selected.clear()}
					>
						Clear selection
					</button>
				{/if}
				{#if bulkActions.length}
					<span class="ml-auto">
						<RowMenu
							label="Actions for selected {noun.plural}"
							triggerLabel="Actions for {selectedRows.length} selected {selectedRows.length ===
							1
								? noun.singular
								: noun.plural}"
							triggerClass="btn btn-sm preset-tonal-surface"
							disabled={!selectedRows.length}
							items={bulkActions.map((a) => ({
								label: a.label,
								icon: a.icon,
								destructive: a.destructive,
								onSelect: () => runAction(a)
							}))}
						>
							{#snippet trigger()}
								Actions
								<Icons.ChevronDown size={14} aria-hidden="true" />
							{/snippet}
						</RowMenu>
					</span>
				{/if}
			</div>
			{/if}

			{#if loading && !rows.length}
				<div
					class="panel-card text-surface-600-400 flex items-center justify-center gap-2 py-10 text-sm"
					role="status"
				>
					<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
					Loading {noun.plural}…
				</div>
			{:else if !rows.length && !narrowed}
				<div class="panel-card">
					<EmptyState
						icon={emptyIcon}
						message={emptyMessage ?? `No ${noun.plural} yet.`}
						ctaLabel={addHref ? (addLabel ?? `Add ${noun.singular}`) : undefined}
						onCta={addHref ? () => adminGoto(addHref) : undefined}
					/>
				</div>
			{:else if !filtered.length}
				<div
					class="panel-card text-surface-600-400 flex flex-col items-center gap-2 py-10 text-center text-sm"
					role="status"
				>
					No {noun.plural} match.
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={clearAll}
					>
						Clear search and filters
					</button>
				</div>
			{:else}
				<!-- ── table (from 45rem of changelist) ────────────────── -->
				<div class="panel-card hidden overflow-x-auto p-0! @min-[45rem]/changelist:block">
					<table class="w-full border-collapse text-sm">
						<thead>
							<tr>
								{#if bulkActions.length}
									<th
										class="bg-surface-200-800 border-surface-200-800 w-10 border-b py-2.5 pr-1 pl-3 text-left"
									>
										<input
											type="checkbox"
											class="checkbox"
											checked={pageSelected}
											indeterminate={someSelected}
											onchange={togglePage}
											aria-label="Select the {countNoun(visible.length, noun)} on this page"
										/>
									</th>
								{/if}
								{#each columns as col (col.key)}
									<th
										class="bg-surface-200-800 border-surface-200-800 text-surface-700-300 border-b px-3 py-2.5 text-xs font-semibold {col.numeric
											? 'text-right'
											: 'text-left'} {col.class ?? ''}"
										aria-sort={sortKey === col.key
											? sortDir === "asc"
												? "ascending"
												: "descending"
											: undefined}
									>
										{#if col.sortValue}
											<button
												type="button"
												class="hover:text-surface-950-50 inline-flex items-center gap-1"
												onclick={() => toggleSort(col)}
											>
												{col.label}
												{#if sortKey === col.key}
													{#if sortDir === "asc"}
														<Icons.ChevronUp size={12} aria-hidden="true" />
													{:else}
														<Icons.ChevronDown size={12} aria-hidden="true" />
													{/if}
												{:else}
													<Icons.ChevronsUpDown
														size={12}
														class="text-surface-500"
														aria-hidden="true"
													/>
												{/if}
											</button>
										{:else}
											{col.label}
										{/if}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each visible as row (rowKey(row))}
								{@const isSelected = selected.has(rowKey(row))}
								<tr
									class="border-surface-200-800 hover:bg-surface-200-800 border-b transition-colors last:border-b-0 {isSelected
										? 'bg-primary-500/8'
										: ''}"
									class:cursor-pointer={!!rowHref}
									onclick={() => open(row)}
								>
									{#if bulkActions.length}
										<td class="py-2.5 pr-1 pl-3 align-middle">
											{@render checkbox(row)}
										</td>
									{/if}
									{#each columns as col (col.key)}
										<td
											class="px-3 py-2.5 align-middle {col.numeric
												? 'text-right tabular-nums'
												: ''} {col.class ?? ''}"
										>
											{#if col === primaryCol}
												{@render titleLink(
													row,
													"text-surface-950-50 font-medium hover:underline focus-visible:underline"
												)}
											{:else}
												{@render cellContent(row, col)}
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<!-- ── stacked rows: the dock (under 45rem) ──────────────── -->
				<ul class="flex flex-col gap-1 @min-[45rem]/changelist:hidden">
					{#each visible as row (rowKey(row))}
						{@const isSelected = selected.has(rowKey(row))}
						<li
							class="hover:bg-surface-200-800 flex min-h-11 items-start gap-3 rounded-[10px] px-3 py-2 {isSelected
								? 'bg-primary-500/8'
								: ''}"
						>
							{#if bulkActions.length}
								<span class="pt-0.5">{@render checkbox(row)}</span>
							{/if}
							<div class="min-w-0 flex-1">
								{@render titleLink(
									row,
									"text-surface-950-50 block truncate text-[15px] font-medium hover:underline focus-visible:underline"
								)}
								<div
									class="text-surface-600-400 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"
								>
									{#each factCols as col (col.key)}
										{#if col.custom || label(col, row)}
											<span class="inline-flex min-w-0 items-center gap-1">
												<span class="sr-only">{col.label}:</span>
												{@render cellContent(row, col)}
											</span>
										{/if}
									{/each}
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- ── the paginator (Django's: pages, the range, Show all) ── -->
			{#if filtered.length > pageSize}
				<div
					class="text-surface-600-400 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"
				>
					{#if !showAll}
						<Pagination
							count={filtered.length}
							{pageSize}
							page={paged.page}
							onPageChange={(e) => (page = e.page)}
							siblingCount={1}
						>
							<Pagination.PrevTrigger aria-label="Previous page">
								<Icons.ChevronLeft size={14} aria-hidden="true" />
							</Pagination.PrevTrigger>
							<Pagination.Context>
								{#snippet children(pagination)}
									{#each pagination().pages as p, index (p.type === "page" ? `p${p.value}` : `e${index}`)}
										{#if p.type === "page"}
											<Pagination.Item {...p}>{p.value}</Pagination.Item>
										{:else}
											<Pagination.Ellipsis {index}>&#8230;</Pagination.Ellipsis>
										{/if}
									{/each}
								{/snippet}
							</Pagination.Context>
							<Pagination.NextTrigger aria-label="Next page">
								<Icons.ChevronRight size={14} aria-hidden="true" />
							</Pagination.NextTrigger>
						</Pagination>
						<span>{firstShown}–{lastShown} of {filtered.length}</span>
					{/if}
					<button
						type="button"
						class="hover:text-surface-950-50 underline underline-offset-2"
						onclick={() => (showAll = !showAll)}
					>
						{showAll ? `Show ${pageSize} a page` : `Show all ${filtered.length}`}
					</button>
				</div>
			{/if}
		</div>

		{#if hasFacets}
			<!-- ── the filter rail (Django's list_filter), from 60rem ──── -->
			<aside
				class="panel-card sticky top-0 hidden w-60 shrink-0 flex-col gap-2 p-2! @min-[60rem]/changelist:flex"
				aria-label="Filter {noun.plural}"
			>
				<div class="flex items-center gap-2 px-2.5 pt-1">
					<h2 class="text-surface-950-50 flex-1 text-sm font-medium">Filter</h2>
					{#if activeCount}
						<button
							type="button"
							class="text-surface-600-400 hover:text-surface-950-50 text-xs underline underline-offset-2"
							onclick={() => (active = {})}
						>
							Clear
						</button>
					{/if}
				</div>
				{@render facetGroups()}
			</aside>
		{/if}
	</div>
</div>
</div>
{/if}
