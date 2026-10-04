<script lang="ts" generics="Row">
	/**
	 * Django admin's **inline** (`TabularInline`) for a change form: the
	 * objects related to this one, as a small table inside an
	 * `AdminFieldset` — a genre's presets, the pipelines a prompt is used by.
	 *
	 * Two modes:
	 *
	 * - **Editable** (`editable`, owner ruling 2026-10-02): Django's formset.
	 *   The related rows are edited in place — the caller's `cell` snippet
	 *   draws each `custom` column's control, bound to the parent form's
	 *   unsaved edits — with **Add another <thing>** appending a row ("Ready
	 *   to add" until saved), a **Delete** tick per saved row, and a
	 *   **Change** link to the row's own change form where it has one. Nothing
	 *   writes here: the parent's Save / Save and continue / Save and add
	 *   another commits the rows with the rest of the form (`inlineRows.ts`
	 *   works out what to send), and leaving without saving drops them.
	 * - **Read-and-link** (default): for relations this object does not own
	 *   (the pipelines that pick a prompt — the choice is the pipeline's), each
	 *   row links to its own change form and "Add another" links to that
	 *   kind's add form.
	 *
	 * Container-responsive (§5.3, the admin pane's `content` container): a
	 * table from 36rem of pane; below it each row stacks — the title, then
	 * the other columns (as a facts line, or labelled controls when editable).
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import AdminFieldset from "./AdminFieldset.svelte"
	import type { AdminChangelistColumn } from "./changelist"

	interface Props {
		title: string
		description?: string
		rows: readonly Row[]
		rowKey: (row: Row) => string | number
		/** `primary` marks the title column; `text` draws a cell, `custom` uses `cell`. */
		columns: AdminChangelistColumn<Row>[]
		/** Read-and-link: the title links here. */
		rowHref?: (row: Row) => string | undefined
		/** Read-and-link: "Add another" opens this add form. */
		addHref?: string
		/** "preset" → "Add another preset". */
		addNoun?: string
		/** When there are no related rows. */
		emptyMessage?: string
		cell?: Snippet<[Row, AdminChangelistColumn<Row>]>
		collapsible?: boolean
		open?: boolean
		id?: string

		/** Edit the rows in place, committed by the parent form's Save. */
		editable?: boolean
		/** Editable: append a new row to the parent's unsaved edits. */
		onAdd?: () => void
		/** Editable: the row was added on this form and is not saved yet. */
		isNew?: (row: Row) => boolean
		/** Editable: the row's Delete tick. */
		isDeleted?: (row: Row) => boolean
		/** Editable: tick or untick Delete on a saved row. */
		onDeleteChange?: (row: Row, deleted: boolean) => void
		/** Editable: drop a row added on this form. */
		onRemove?: (row: Row) => void
		/**
		 * Editable: whether a saved row may be deleted — `true`, or the reason
		 * it may not ("Built-in"), shown in the Delete column instead of a tick.
		 */
		canDelete?: (row: Row) => true | string
		/** Editable: Django's `show_change_link` — the row's own change form. */
		changeHref?: (row: Row) => string | undefined
		/** Nothing can be edited (a read-only parent). */
		readonly?: boolean
		/** Tonal buttons beside "Add another" (Show all / Hide all). */
		actions?: Snippet
	}
	let {
		title,
		description,
		rows,
		rowKey,
		columns,
		rowHref,
		addHref,
		addNoun,
		emptyMessage = "None yet.",
		cell,
		collapsible = false,
		open = false,
		id,
		editable = false,
		onAdd,
		isNew,
		isDeleted,
		onDeleteChange,
		onRemove,
		canDelete,
		changeHref,
		readonly = false,
		actions
	}: Props = $props()

	const primary = $derived(columns.find((c) => c.primary) ?? columns[0])
	const facts = $derived(columns.filter((c) => c !== primary && !c.hideWhenStacked))
	const others = $derived(columns.filter((c) => c !== primary))
	const showDelete = $derived(editable && !readonly && !!onDeleteChange)
	const showChange = $derived(editable && !!changeHref)
	const thing = $derived(addNoun ?? "row")

	const rowNew = (row: Row) => !!isNew?.(row)
	const rowDeleted = (row: Row) => !!isDeleted?.(row)
	const deletable = (row: Row): true | string => canDelete?.(row) ?? true
	const nameOf = (row: Row) => primary.text?.(row) || thing
</script>

{#snippet content(row: Row, col: AdminChangelistColumn<Row>)}
	{#if col.custom && cell}{@render cell(row, col)}{:else}{col.text?.(row) ?? ""}{/if}
{/snippet}

{#snippet titleOf(row: Row, cls: string)}
	{@const href = editable ? undefined : rowHref?.(row)}
	{#if href}
		<a {href} class="{cls} hover:underline focus-visible:underline">{@render content(row, primary)}</a>
	{:else if editable && primary.custom}
		{@render content(row, primary)}
	{:else}
		<span class={cls}>{@render content(row, primary)}</span>
	{/if}
{/snippet}

{#snippet marks(row: Row)}
	{#if rowNew(row)}
		<span class="preset-tonal-primary shrink-0 rounded-full px-2 py-0.5 text-[11px]">Ready to add</span>
	{:else if rowDeleted(row)}
		<span class="preset-tonal-error shrink-0 rounded-full px-2 py-0.5 text-[11px]">Deleted on save</span>
	{/if}
{/snippet}

{#snippet changeLink(row: Row)}
	{@const href = rowNew(row) ? undefined : changeHref?.(row)}
	{#if href}
		<a {href} class="anchor inline-flex items-center gap-1 text-xs whitespace-nowrap">
			<Icons.Pencil size={12} aria-hidden="true" />
			Change<span class="sr-only"> {nameOf(row)}</span>
		</a>
	{/if}
{/snippet}

{#snippet deleteControl(row: Row)}
	{#if rowNew(row)}
		<button
			type="button"
			class="btn-icon btn-icon-sm hover:preset-tonal-error"
			aria-label="Remove the new {thing} {nameOf(row)}"
			title="Remove — it was never saved"
			onclick={() => onRemove?.(row)}
		>
			<Icons.X size={14} aria-hidden="true" />
		</button>
	{:else}
		{@const ok = deletable(row)}
		{#if ok === true}
			<label class="inline-flex min-h-8 items-center gap-1.5 text-xs">
				<input
					type="checkbox"
					class="checkbox"
					checked={rowDeleted(row)}
					onchange={(e) => onDeleteChange?.(row, e.currentTarget.checked)}
				/>
				<span class="sr-only">Delete {nameOf(row)}</span>
			</label>
		{:else}
			<span class="text-surface-600-400 text-[11px]" title={ok}>{ok}</span>
		{/if}
	{/if}
{/snippet}

{#snippet add()}
	{@render actions?.()}
	{#if editable}
		{#if onAdd && !readonly}
			<button type="button" class="btn btn-sm preset-tonal-surface shrink-0" onclick={onAdd}>
				<Icons.Plus size={14} aria-hidden="true" />
				Add another {thing}
			</button>
		{/if}
	{:else if addHref}
		<a href={addHref} class="btn btn-sm preset-tonal-surface shrink-0">
			<Icons.Plus size={14} aria-hidden="true" />
			Add another {thing}
		</a>
	{/if}
{/snippet}

<AdminFieldset {title} {description} {collapsible} {open} {id} aside={add}>
	{#if !rows.length}
		<p class="text-surface-600-400 text-sm">{emptyMessage}</p>
	{:else}
		<div class="hidden overflow-x-auto @min-[36rem]/content:block">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr>
						{#each columns as col (col.key)}
							<th
								class="border-surface-200-800 text-surface-600-400 border-b px-2 py-1.5 text-xs font-medium {col.numeric
									? 'text-right'
									: 'text-left'} {col.class ?? ''}"
							>
								{col.label}
							</th>
						{/each}
						{#if showChange}
							<th class="border-surface-200-800 border-b px-2 py-1.5"><span class="sr-only">Change</span></th>
						{/if}
						{#if showDelete}
							<th
								class="border-surface-200-800 text-surface-600-400 w-px border-b px-2 py-1.5 text-left text-xs font-medium"
							>
								Delete?
							</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (rowKey(row))}
						<tr
							class="border-surface-200-800 border-b last:border-b-0 {rowDeleted(row)
								? 'opacity-60'
								: ''}"
						>
							{#each columns as col (col.key)}
								<td
									class="px-2 py-2 align-middle {col.numeric
										? 'text-right tabular-nums'
										: ''} {col.class ?? ''}"
								>
									{#if col === primary}
										<span class="flex min-w-0 items-center gap-2">
											{@render titleOf(row, "text-surface-950-50 font-medium")}
											{#if editable}{@render marks(row)}{/if}
										</span>
									{:else}
										{@render content(row, col)}
									{/if}
								</td>
							{/each}
							{#if showChange}
								<td class="w-px px-2 py-2 align-middle">{@render changeLink(row)}</td>
							{/if}
							{#if showDelete}
								<td class="w-px px-2 py-2 align-middle">{@render deleteControl(row)}</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<ul class="flex flex-col gap-2 @min-[36rem]/content:hidden">
			{#each rows as row (rowKey(row))}
				<li
					class="min-w-0 {editable
						? 'border-surface-200-800 flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0'
						: ''} {rowDeleted(row) ? 'opacity-60' : ''}"
				>
					{#if editable}
						<div class="flex min-w-0 items-center gap-2">
							<div class="min-w-0 flex-1">
								{@render titleOf(row, "text-surface-950-50 block truncate text-sm font-medium")}
							</div>
							{@render marks(row)}
						</div>
						{#each others as col (col.key)}
							<div class="flex min-w-0 flex-col gap-1 text-sm">
								<span class="text-surface-600-400 text-xs">{col.label}</span>
								<div class="min-w-0">{@render content(row, col)}</div>
							</div>
						{/each}
						{#if showChange || showDelete}
							<div class="flex flex-wrap items-center gap-3">
								{#if showChange}{@render changeLink(row)}{/if}
								{#if showDelete}
									<span class="ml-auto inline-flex items-center gap-1.5 text-xs">
										{#if !rowNew(row) && deletable(row) === true}
											<span class="text-surface-600-400" aria-hidden="true">Delete?</span>
										{/if}
										{@render deleteControl(row)}
									</span>
								{/if}
							</div>
						{/if}
					{:else}
						{@render titleOf(row, "text-surface-950-50 block truncate text-sm font-medium")}
						<div class="text-surface-600-400 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
							{#each facts as col (col.key)}
								{#if col.custom || col.text?.(row)}
									<span class="inline-flex items-center gap-1">
										<span class="sr-only">{col.label}:</span>
										{@render content(row, col)}
									</span>
								{/if}
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</AdminFieldset>
