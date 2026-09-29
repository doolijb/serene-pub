<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import EditLorebookForm from "$lib/client/components/lorebookForms/EditLorebookForm.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	} from "$lib/shared/entries/types"
	import { bookReadout, nestingOf, READOUT_NOTE } from "./bookReadout"
	import { readingActionLabel } from "./scopes"
	import { compareDates, formatDate } from "./sections/historyDates"
	import StoryCalendarEditor from "./time/StoryCalendarEditor.svelte"
	import StoryClockEditor from "./time/StoryClockEditor.svelte"

	/**
	 * Book settings: a readout of what the book holds, and the few behaviours
	 * it chooses.
	 *
	 * There are no feature switches here and there is nothing to turn on: every
	 * capability is available in every lorebook, and what the workspace offers
	 * follows what the book actually holds. So this page counts, and the
	 * counting is the point.
	 *
	 * ⚠ **The rows are the workspace's, on the line being read.** Never fetch
	 * the whole book again and count every line's rows: that counts a fork's
	 * entries on main (#90). The workspace already holds the rows resolved on
	 * the line — the same ones the rail's chips and the pool read — so they
	 * are handed in rather than asked for twice.
	 */
	interface Props {
		lorebookId: number
		bookName: string
		/** The line being read, for the clock; null is main. */
		branchId: number | null
		branchName: string | null
		/** Every line the book has, by name: "main" first, then its branches. */
		branches: string[]
		/** The story's present on that line: its clock, else its newest entry. */
		present: {
			date: Sockets.Lorebooks.StoryClock
			from: "clock" | "history"
		} | null
		onSetClock: (clock: Sockets.Lorebooks.StoryClock | null) => void
		/** The server's figures for this book, shared with the rail. */
		counts: Record<string, number> | null
		/** The book's entries on the line being read, by entry type id. */
		rowsByType: Record<string, any[]>
		/** The book's scenes on the line being read. */
		scenes: readonly any[]
		/** How many relationships the line draws. */
		relationships: number
		/** What the open session is called, when one reads this book. */
		readingInto: string | null
		canChangeReading: boolean
		hasUnsavedChanges: boolean
		onClose: () => void
		onChangeReading: () => void
		onImport: () => void
		/** Asks for a copy of this book; the prompt names it. */
		onDuplicate: () => void
		onDelete: () => void
	}

	let {
		lorebookId,
		bookName,
		branchId,
		branchName,
		branches,
		present,
		onSetClock,
		counts,
		rowsByType,
		scenes,
		relationships,
		readingInto,
		canChangeReading,
		hasUnsavedChanges = $bindable(false),
		onClose,
		onChangeReading,
		onImport,
		onDuplicate,
		onDelete
	}: Props = $props()

	// Two editors on one page, one unsaved flag for the tab.
	let formUnsaved = $state(false)
	let calendarUnsaved = $state(false)
	$effect(() => {
		hasUnsavedChanges = formUnsaved || calendarUnsaved
	})

	/** Archived rows are out of every figure, as they are out of the rail's. */
	let liveRowsByType = $derived(
		Object.fromEntries(
			Object.entries(rowsByType).map(([typeId, rows]) => [
				typeId,
				rows.filter((row) => !row?.archived)
			])
		) as Record<string, any[]>
	)

	let allRows = $derived(Object.values(liveRowsByType).flat())
	let nesting = $derived(nestingOf(allRows))

	let castWithLore = $derived(
		new Set(
			(liveRowsByType[CHARACTER_LORE_TYPE_ID] ?? [])
				.map((row) => row.lorebookBindingId)
				.filter((id) => id != null)
		).size
	)

	let dated = $derived.by(() => {
		const rows = (liveRowsByType[HISTORY_TYPE_ID] ?? []).filter(
			(row) => typeof row.year === "number"
		)
		if (!rows.length) return undefined
		// The one comparator: a local copy is how one calendar gets two.
		const sorted = [...rows].sort(compareDates)
		return {
			earliest: formatDate(sorted[0]),
			latest: formatDate(sorted[sorted.length - 1])
		}
	})

	/** A scene whose history entry nobody has compiled yet. */
	let scenesWaiting = $derived.by(() => {
		const done = new Set(
			(liveRowsByType[HISTORY_TYPE_ID] ?? [])
				.filter((row) => row.isCompleted)
				.map((row) => row.id)
		)
		return scenes.filter((s) => !done.has(s.historyEntryId)).length
	})

	let capturedFrom = $derived.by(() => {
		const names = new Set(
			scenes.map((s) => s.sessionName).filter((n): n is string => !!n)
		)
		if (names.size === 0) return null
		if (names.size === 1) return [...names][0]
		return `${names.size} sessions`
	})

	let lines = $derived(
		bookReadout({
			counts,
			castWithLore,
			relationships,
			dated,
			scenesWaiting,
			capturedFrom,
			nested: nesting.nested,
			depth: nesting.depth,
			branches
		})
	)
</script>

{#snippet behaviour(
	label: string,
	value: string,
	explain: string,
	action?: { label: string; run: () => void; disabled?: boolean }
)}
	<div class="flex flex-wrap items-baseline gap-2">
		<span class="font-semibold">{label}</span>
		<span class="text-surface-700-300 text-sm">{value}</span>
		{#if action}
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled={action.disabled}
				onclick={action.run}
			>
				{action.label}
			</button>
		{/if}
		<p class="text-surface-700-300 w-full text-sm">{explain}</p>
	</div>
{/snippet}

<div
	class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
	data-lore-book-settings
>
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="btn btn-sm preset-filled-surface-400-600 shrink-0 p-2"
			type="button"
			onclick={onClose}
			title="Back to the entries"
			aria-label="Back to the entries"
		>
			<Icons.ChevronLeft size={16} aria-hidden="true" />
		</button>
		<h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
			Book settings · {bookName}
		</h2>
	</div>

	<EditLorebookForm {lorebookId} bind:hasUnsavedChanges={formUnsaved} />

	<StoryClockEditor {branchId} {branchName} {present} {onSetClock} />

	<StoryCalendarEditor
		{lorebookId}
		sample={present?.date ?? null}
		bind:hasUnsavedChanges={calendarUnsaved}
	/>

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold"
		>
			<Icons.ListChecks size={13} aria-hidden="true" />
			What this book holds
		</p>
		<ul class="flex flex-col gap-2">
			{#each lines as line (line.id)}
				<li class="flex flex-wrap items-baseline gap-2">
					<span class="font-semibold">{line.label}</span>
					<span class="badge preset-tonal-surface">{line.count}</span>
					<span class="text-surface-700-300 text-sm">
						{line.detail.join(", ")}
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-surface-700-300 text-sm">{READOUT_NOTE}</p>
	</section>

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		{@render behaviour(
			"Reading into a session",
			readingInto ?? "no session",
			readingInto
				? "The session this book is read into as it plays."
				: "No session reads this book. Open a session you own to read it in.",
			{
				label: readingActionLabel(!!readingInto),
				run: onChangeReading,
				disabled: !canChangeReading
			}
		)}
	</section>

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-700-300 flex items-center gap-1.5 text-xs font-semibold"
		>
			<Icons.Book size={13} aria-hidden="true" />
			This book
		</p>
		<div class="flex flex-wrap gap-2">
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				onclick={onImport}
			>
				<Icons.Upload size={14} aria-hidden="true" /> Import
			</button>
			<!-- Export is paused (owner ruling 2026-09-28): visible, disabled,
			     and the reason sits under the row. -->
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				disabled
				aria-describedby="book-settings-export-paused"
			>
				<Icons.Download size={14} aria-hidden="true" /> Export
			</button>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				title="Copy this book, entries, cast and all"
				onclick={onDuplicate}
			>
				<Icons.Copy size={14} aria-hidden="true" /> Duplicate
			</button>
			<button
				class="btn btn-sm preset-filled-error-500"
				type="button"
				onclick={onDelete}
			>
				<Icons.Trash2 size={14} aria-hidden="true" />
				Delete “{bookName}”
			</button>
		</div>
		<p
			id="book-settings-export-paused"
			class="text-surface-600-400 text-xs"
		>
			{LOREBOOK_EXPORT_PAUSED}
		</p>
	</section>
</div>
