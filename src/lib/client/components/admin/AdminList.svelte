<script module lang="ts">
	/** One changelist column. Exported for pages to type their column lists. */
	export interface AdminColumn<R> {
		key: string
		label: string
		/** Sort/compare value. Absent → the column is not sortable. */
		value?: (row: R) => string | number | boolean | null | undefined
		/** Extra classes on both th and td (e.g. text-right, w-px). */
		class?: string
	}
</script>

<script lang="ts" generics="Row">
	/**
	 * The admin changelist (Django-admin style): one component for every
	 * sortable, real-time-searchable, paginated list in the admin area, in two
	 * view modes — table and cards — with the choice persisted per page
	 * (`storageKey` → localStorage) like the character cards on the home page.
	 * A narrow content pane forces card view (tables don't fit phones); the
	 * check is the component's own measured width, never the viewport.
	 *
	 * The parent owns the data (rows arrive over sockets and are small — tens,
	 * not thousands) so sort/search/pagination are client-side: search filters
	 * as you type, headers (or the card-view sort control) toggle asc/desc,
	 * and the footer pages the result. Cells render through the `cell` snippet
	 * so each page controls its own markup; the component owns the mechanics.
	 * Card view reuses the same snippet: first column as the card title,
	 * labeled columns as rows, unlabeled (action) columns as the card footer.
	 */
	import type { Snippet } from "svelte"
	import { onMount } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import {
		createViewMode,
		type ViewMode
	} from "$lib/client/utils/viewMode.svelte"

	interface Props {
		rows: Row[]
		columns: AdminColumn<Row>[]
		/** The haystack for the search box. Absent → no search box. */
		searchText?: (row: Row) => string
		searchPlaceholder?: string
		pageSize?: number
		loading?: boolean
		emptyMessage?: string
		/** Initial sort column key (must be a sortable column). */
		defaultSort?: string
		defaultSortDir?: "asc" | "desc"
		/** localStorage key for the table/cards choice. Absent → not persisted. */
		storageKey?: string
		/** Renders one cell. */
		cell: Snippet<[Row, AdminColumn<Row>]>
		/** Optional per-row click (Django's "row opens the change form"). */
		onRowClick?: (row: Row) => void
		/**
		 * The compact list (a pane beside a detail): one row per item (title, a meta
		 * line, an optional badge) instead of a table or cards, sized for a
		 * ~360px column. `rowTitle` is required in this mode.
		 */
		compact?: boolean
		rowTitle?: (row: Row) => string
		rowMeta?: (row: Row) => string | undefined
		rowBadge?: (row: Row) => string | undefined
		/** The row the detail pane is showing. */
		isSelected?: (row: Row) => boolean
	}

	let {
		rows,
		columns,
		searchText,
		searchPlaceholder = "Search…",
		pageSize = 25,
		loading = false,
		emptyMessage = "Nothing here yet.",
		defaultSort,
		defaultSortDir = "asc",
		storageKey,
		cell,
		onRowClick,
		compact = false,
		rowTitle,
		rowMeta,
		rowBadge,
		isSelected
	}: Props = $props()

	let search = $state("")
	// Deliberate initial-value captures: defaults seed the state once; the
	// user's clicks own it from then on.
	// svelte-ignore state_referenced_locally
	let sortKey = $state(defaultSort ?? null)
	// svelte-ignore state_referenced_locally
	let sortDir = $state<"asc" | "desc">(defaultSortDir)
	let page = $state(0)

	// ── view mode: table ("list") / cards, persisted per page ───────
	// svelte-ignore state_referenced_locally
	const viewPref = storageKey
		? createViewMode(storageKey, "list")
		: (() => {
				let v = $state<ViewMode>("list")
				return {
					get value() {
						return v
					},
					set value(next: ViewMode) {
						v = next
					}
				}
			})()

	// A narrow pane forces cards; measured on this component, not the window.
	let rootEl: HTMLDivElement | null = $state(null)
	let narrow = $state(false)
	onMount(() => {
		if (!rootEl) return
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width
			if (w) narrow = w < 640
		})
		ro.observe(rootEl)
		narrow = rootEl.clientWidth < 640
		return () => ro.disconnect()
	})
	let effectiveView = $derived<ViewMode>(narrow ? "cards" : viewPref.value)
	let rowsMode = $derived(compact && !!rowTitle)

	// Card layout roles derived from the columns themselves: the first labeled
	// column titles the card, unlabeled columns are actions.
	let titleCol = $derived(columns.find((c) => c.label !== ""))
	let bodyCols = $derived(
		columns.filter((c) => c.label !== "" && c !== titleCol)
	)
	let actionCols = $derived(columns.filter((c) => c.label === ""))
	let sortableCols = $derived(columns.filter((c) => !!c.value))

	function toggleSort(col: AdminColumn<Row>) {
		if (!col.value) return
		if (sortKey === col.key) {
			sortDir = sortDir === "asc" ? "desc" : "asc"
		} else {
			sortKey = col.key
			sortDir = "asc"
		}
	}

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase()
		let out = rows
		if (q && searchText)
			out = out.filter((r) => searchText(r).toLowerCase().includes(q))
		if (sortKey) {
			const col = columns.find((c) => c.key === sortKey)
			if (col?.value) {
				const dir = sortDir === "asc" ? 1 : -1
				out = [...out].sort((a, b) => {
					const av = col.value!(a)
					const bv = col.value!(b)
					// nulls last, numbers numeric, everything else string
					if (av == null && bv == null) return 0
					if (av == null) return 1
					if (bv == null) return -1
					if (typeof av === "number" && typeof bv === "number")
						return (av - bv) * dir
					return (
						String(av).localeCompare(String(bv), undefined, {
							sensitivity: "base",
							numeric: true
						}) * dir
					)
				})
			}
		}
		return out
	})

	// Search or sort changes reset to the first page; a shrunk result set
	// clamps the page instead of showing an empty tail.
	$effect(() => {
		void search
		void sortKey
		void sortDir
		page = 0
	})
	// ── page size: selectable, persisted per page beside the view mode ──
	const PAGE_SIZES = [10, 25, 50, 100]
	// Deliberate initial capture: the storage key never changes at runtime.
	// svelte-ignore state_referenced_locally
	const sizeKey = storageKey ? `${storageKey}:pageSize` : null
	// svelte-ignore state_referenced_locally
	let perPage = $state(
		(() => {
			if (sizeKey && typeof localStorage !== "undefined") {
				const v = Number(localStorage.getItem(sizeKey))
				if (PAGE_SIZES.includes(v)) return v
			}
			return pageSize
		})()
	)
	function setPerPage(n: number) {
		perPage = n
		page = 0
		if (sizeKey)
			try {
				localStorage.setItem(sizeKey, String(n))
			} catch {}
	}

	let pageCount = $derived(Math.max(1, Math.ceil(filtered.length / perPage)))
	$effect(() => {
		if (page >= pageCount) page = pageCount - 1
	})
	let pageRows = $derived(
		filtered.slice(page * perPage, (page + 1) * perPage)
	)
	let showingFrom = $derived(filtered.length === 0 ? 0 : page * perPage + 1)
	let showingTo = $derived(Math.min((page + 1) * perPage, filtered.length))
</script>

<div bind:this={rootEl} class="flex flex-col gap-3">
	<!-- Toolbar: search on the left, sort (cards) + view toggle on the right -->
	<div class="flex flex-wrap items-center gap-2">
		{#if searchText}
			<div class="relative max-w-sm min-w-40 flex-1">
				<Icons.Search
					size={14}
					class="text-surface-600-400 absolute top-1/2 left-2.5 -translate-y-1/2"
				/>
				<input
					class="input pl-8 text-sm"
					placeholder={searchPlaceholder}
					bind:value={search}
					aria-label={searchPlaceholder}
				/>
			</div>
		{/if}

		<!-- Sort (card view) + view toggle, anchored to the right edge. -->
		<div class="ml-auto flex shrink-0 items-center gap-2">
			{#if effectiveView === "cards" && sortableCols.length && !rowsMode}
				<div class="flex items-center gap-1 text-xs">
					<span class="text-surface-600-400" aria-hidden="true">Sort</span>
					<Select
						class="w-40"
						label="Sort cards by"
						labelHidden
						options={sortableCols.map((col) => ({
							value: col.key,
							label: col.label
						}))}
						bind:value={sortKey}
					/>
				</div>
				<button
					class="btn btn-sm preset-tonal-surface p-2"
					onclick={() =>
						(sortDir = sortDir === "asc" ? "desc" : "asc")}
					title="Toggle sort direction"
					aria-label="Toggle sort direction"
				>
					{#if sortDir === "asc"}
						<Icons.ArrowUpNarrowWide size={14} />
					{:else}
						<Icons.ArrowDownWideNarrow size={14} />
					{/if}
				</button>
			{/if}

			{#if !narrow && !rowsMode}
				<div class="flex gap-1" role="group" aria-label="View mode">
					<button
						class="btn btn-sm p-2 {effectiveView === 'list'
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
						onclick={() => (viewPref.value = "list")}
						title="Table view"
						aria-label="Table view"
						aria-pressed={effectiveView === "list"}
					>
						<Icons.Table2 size={14} />
					</button>
					<button
						class="btn btn-sm p-2 {effectiveView === 'cards'
							? 'preset-tonal-primary'
							: 'preset-tonal-surface'}"
						onclick={() => (viewPref.value = "cards")}
						title="Card view"
						aria-label="Card view"
						aria-pressed={effectiveView === "cards"}
					>
						<Icons.LayoutGrid size={14} />
					</button>
				</div>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
			<span class="inline-flex items-center gap-2">
				<Icons.Loader2 size={14} class="animate-spin" /> Loading…
			</span>
		</div>
	{:else if !pageRows.length}
		<div class="panel-card text-surface-600-400 py-8 text-center text-sm">
			{search ? "No matches." : emptyMessage}
		</div>
	{:else if rowsMode}
		<!-- ── rows: the compact list pane ───────────────────────── -->
		<ul class="flex flex-col gap-1">
			{#each pageRows as row, i (i)}
				{@const selected = isSelected?.(row) ?? false}
				{@const meta = rowMeta?.(row)}
				{@const badge = rowBadge?.(row)}
				<li>
					<button
						type="button"
						class="hover:bg-surface-200-800 focus-visible:outline-primary-500 flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left focus-visible:outline-2 {selected
							? 'sidebar-row-active'
							: ''}"
						aria-current={selected ? "true" : undefined}
						onclick={() => onRowClick?.(row)}
					>
						<span class="min-w-0 flex-1">
							<span
								class="text-surface-950-50 block truncate text-sm font-medium"
							>
								{rowTitle!(row)}
							</span>
							{#if meta}
								<span
									class="text-surface-600-400 block truncate text-xs"
								>
									{meta}
								</span>
							{/if}
						</span>
						{#if badge}
							<span
								class="text-surface-600-400 border-surface-200-800 shrink-0 rounded-full border px-2 py-0.5 text-[11px]"
							>
								{badge}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{:else if effectiveView === "list"}
		<!-- ── table view ─────────────────────────────────────────── -->
		<div class="panel-card overflow-x-auto p-0!">
			<table class="w-full min-w-[560px] border-collapse text-sm">
				<thead>
					<tr>
						{#each columns as col (col.key)}
							<th
								class="bg-surface-200-800 border-surface-200-800 text-surface-700-300 border-b px-3 py-2.5 text-left text-xs font-semibold {col.class ??
									''}"
							>
								{#if col.value}
									<button
										class="hover:text-surface-950-50 inline-flex items-center gap-1"
										onclick={() => toggleSort(col)}
										aria-label="Sort by {col.label}"
									>
										{col.label}
										{#if sortKey === col.key}
											{#if sortDir === "asc"}
												<Icons.ChevronUp size={12} />
											{:else}
												<Icons.ChevronDown size={12} />
											{/if}
										{:else}
											<Icons.ChevronsUpDown
												size={12}
												class="opacity-40"
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
					{#each pageRows as row, i (i)}
						<tr
							class="border-surface-200-800 even:bg-surface-950/4 dark:even:bg-surface-50/4 hover:bg-surface-200-800 border-b transition-colors last:border-b-0"
							class:cursor-pointer={!!onRowClick}
							onclick={() => onRowClick?.(row)}
						>
							{#each columns as col (col.key)}
								<td
									class="px-3 py-2.5 align-middle {col.class ??
										''}"
								>
									<!-- The row's click is a mouse convenience; the
									     title cell is the keyboard's way in, as a
									     real button (a <tr> is not focusable). -->
									{#if onRowClick && col === titleCol}
										<button
											type="button"
											class="text-left hover:underline focus-visible:underline"
											onclick={(e) => {
												e.stopPropagation()
												onRowClick(row)
											}}
										>
											{@render cell(row, col)}
										</button>
									{:else}
										{@render cell(row, col)}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<!-- ── card view ──────────────────────────────────────────── -->
		<div class="card-grid">
			{#each pageRows as row, i (i)}
				<!-- role/tabindex are conditional on onRowClick, which the
				     linter can't see; a card is only interactive when the page
				     wired a row action. It stays a div (not a <button>)
				     because action-column buttons render inside it. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="panel-card flex flex-col gap-2 transition-colors"
					class:cursor-pointer={!!onRowClick}
					class:admin-card-link={!!onRowClick}
					onclick={() => onRowClick?.(row)}
					role={onRowClick ? "button" : undefined}
					tabindex={onRowClick ? 0 : undefined}
					onkeydown={(e) => {
						if (
							onRowClick &&
							(e.key === "Enter" || e.key === " ")
						) {
							e.preventDefault()
							onRowClick(row)
						}
					}}
				>
					{#if titleCol}
						<div class="text-sm font-semibold">
							{@render cell(row, titleCol)}
						</div>
					{/if}
					{#if bodyCols.length}
						<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
							{#each bodyCols as col (col.key)}
								<dt
									class="text-surface-600-400 text-xs font-semibold"
								>
									{col.label}
								</dt>
								<dd class="min-w-0 text-xs">
									{@render cell(row, col)}
								</dd>
							{/each}
						</dl>
					{/if}
					{#if actionCols.length}
						<div class="mt-auto flex justify-end gap-1.5 pt-1">
							{#each actionCols as col (col.key)}
								{@render cell(row, col)}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div
		class="text-surface-600-400 flex flex-wrap items-center justify-between gap-2 text-xs"
	>
		<span class="flex items-center gap-2">
			<span>
				Showing {showingFrom}–{showingTo} of {filtered.length}
				{#if filtered.length !== rows.length}(filtered from {rows.length}){/if}
			</span>
			<span class="flex items-center gap-1">
				<span aria-hidden="true">· Per page</span>
				<Select
					class="w-24"
					label="Rows per page"
					labelHidden
					options={PAGE_SIZES.map((n) => ({
						value: String(n),
						label: String(n)
					}))}
					value={String(perPage)}
					onValueChange={(v) => {
						if (v) setPerPage(Number(v))
					}}
				/>
			</span>
		</span>
		{#if pageCount > 1}
			<span class="flex items-center gap-2">
				<button
					class="btn btn-sm preset-tonal-surface"
					disabled={page === 0}
					onclick={() => (page = Math.max(0, page - 1))}
				>
					<Icons.ChevronLeft size={14} /> Prev
				</button>
				<span>{page + 1} / {pageCount}</span>
				<button
					class="btn btn-sm preset-tonal-surface"
					disabled={page >= pageCount - 1}
					onclick={() => (page = Math.min(pageCount - 1, page + 1))}
				>
					Next <Icons.ChevronRight size={14} />
				</button>
			</span>
		{/if}
	</div>
</div>

<style>
	/* A clickable card's hover edge. Plain CSS rather than a `hover:` utility:
	   `panel-card` sets its border under a `dark:` variant, which would win
	   over a bare `hover:border-*` in dark mode. */
	.admin-card-link:hover,
	.admin-card-link:focus-visible {
		border-color: color-mix(
			in oklab,
			var(--color-primary-500) 50%,
			transparent
		);
	}
	/* Intrinsically container-responsive: auto-fill needs no breakpoints. */
	.card-grid {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
	}
	/* A pane too narrow for the wide minimum falls back to one full column. */
	@container content (max-width: 520px) {
		.card-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
