<script lang="ts">
	import { getContext } from "svelte"
	import * as Icons from "@lucide/svelte"
	import { showsAdvancedControls } from "$lib/client/advancedControls"
	import AdvancedHiddenLine from "$lib/client/components/AdvancedHiddenLine.svelte"
	import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
	import EditLorebookForm from "$lib/client/components/lorebookForms/EditLorebookForm.svelte"
	import {
		CHARACTER_LORE_TYPE_ID,
		HISTORY_TYPE_ID
	} from "$lib/shared/entries/types"
	import { bookReadout, nestingOf, READOUT_NOTE } from "./bookReadout"
	import { primerRowLine } from "./starterKitCards"
	import { compareDates, formatDate } from "./sections/historyDates"
	import StoryCalendarEditor from "./time/StoryCalendarEditor.svelte"
	import StoryClockEditor from "./time/StoryClockEditor.svelte"
	import BookRulesCard from "./BookRulesCard.svelte"
	import type { RulesetGenreFit } from "./rulesFitWords"
	import BookWritesCard from "./BookWritesCard.svelte"

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
		/** The owner's sessions that read this book, newest first (`readBy`). */
		readBy?: readonly { id: number; name: string | null }[]
		/** The book's rules (`lorebooks.primary_ruleset`). */
		primaryRuleset: string | null
		/** 🚧 s22-V: how each enabled genre rates the book's rules (`rulesetFitByGenre`); absent for Freeform. */
		rulesFit?: RulesetGenreFit[] | null
		/** The book's own lore write mode (`lorebooks.lore_write_mode`). */
		loreWriteMode: string | null
		/**
		 * 🚧 The book is a starter lorebook (PLAN-lorebook-kinds §B): sessions start
		 * from it and never read or write it, so Writes from sessions and
		 * Reading into a session are not drawn, and This book offers a
		 * lorebook made from it and its delete.
		 */
		isStarterKit?: boolean
		/** 🚧 (M2e) A provided book (comes with the pub or a plugin): no Delete is drawn. */
		isProvided?: boolean
		/**
		 * 🚧 (m2e-F-C) The server's primer-row mark: no edit control is drawn;
		 * the way out is Clone.
		 */
		readOnly?: boolean
		/** The primer row's own line (`primerRowLine(book)`), when read-only. */
		readOnlyLine?: string
		/** 🚧 (m2e-F-C) Clone this primer row into a starter lorebook of the reader's own. */
		onClone?: () => void
		/** 🚧 An admin's ordinary book: copy it as a new starter lorebook. */
		onSaveAsStarterKit?: () => void
		/** 🚧 A starter lorebook: start a lorebook of the reader's own from it. */
		onMakeBookFromKit?: () => void
		hasUnsavedChanges: boolean
		onClose: () => void
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
		readBy = [],
		primaryRuleset,
		rulesFit = null,
		loreWriteMode,
		isStarterKit = false,
		isProvided = false,
		readOnly = false,
		readOnlyLine,
		onClone,
		onSaveAsStarterKit,
		onMakeBookFromKit,
		hasUnsavedChanges = $bindable(false),
		onClose,
		onImport,
		onDuplicate,
		onDelete
	}: Props = $props()

	// 🚧 Advanced controls (2026-11-10): the book's rules and its calendar are
	// hidden, never changed, while this person's switch is off.
	const userSettingsCtx = getContext<UserSettingsCtx | undefined>(
		"userSettingsCtx"
	)
	let advanced = $derived(showsAdvancedControls(userSettingsCtx?.settings))
	// The rules card and the calendar editor are what the switch hides; the
	// line at the foot says so only when one of them would have been drawn.
	// The calendar is drawn on every page that isn't read-only, so that is
	// the whole condition.
	let rulesOrCalendarHidden = $derived(!advanced && !readOnly)

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

	/**
	 * Who reads this book, beside the open session: the owner's other
	 * sessions (`readBy`). "No session" only when none does — it said so
	 * whenever the OPEN session did not, though others read it (audit
	 * 2026-10-21).
	 */
	let otherReaders = $derived(
		readBy
			.map((r) => r.name || "an unnamed session")
			.filter((name) => name !== readingInto)
	)
	const joinNames = (names: string[]) =>
		names.length > 2
			? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
			: names.join(" and ")
	let readingValue = $derived(
		readingInto ??
			(otherReaders.length ? joinNames(otherReaders) : "no session")
	)
	let readingExplain = $derived(
		readingInto
			? otherReaders.length
				? `The open session reads this book as it plays; so does ${joinNames(otherReaders)}.`
				: "The open session reads this book as it plays."
			: otherReaders.length
				? "Those sessions read this book as they play."
				: "No session reads this book."
	)

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
			class="btn btn-sm preset-tonal-surface shrink-0 p-2"
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

	{#if readOnly}
		<div class="flex flex-wrap items-center gap-2">
			<p class="text-surface-600-400 text-xs" data-book-settings-read-only>
				{readOnlyLine ?? primerRowLine(null)}
			</p>
			<button
				class="btn btn-sm preset-tonal-surface"
				type="button"
				data-book-settings-clone
				onclick={onClone}
			>
				<Icons.CopyPlus size={14} aria-hidden="true" /> Clone
			</button>
		</div>
	{:else}
		<EditLorebookForm {lorebookId} bind:hasUnsavedChanges={formUnsaved} />

		{#if advanced && primaryRuleset}
			<BookRulesCard {lorebookId} current={primaryRuleset} fits={rulesFit} />
		{/if}

		{#if !isStarterKit}
			<BookWritesCard {lorebookId} current={loreWriteMode} />
		{/if}

		<StoryClockEditor {branchId} {branchName} {present} {onSetClock} />

		<!-- Hidden, not unmounted, with advanced controls off: the calendar's
		     draft lives inside the editor, so a mid-edit flip keeps it. -->
		<div hidden={!advanced}>
			<StoryCalendarEditor
				{lorebookId}
				sample={present?.date ?? null}
				bind:hasUnsavedChanges={calendarUnsaved}
			/>
		</div>
	{/if}

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-ink flex items-center gap-1.5 text-xs font-semibold"
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

	{#if !isStarterKit}
		<section class="card preset-filled-surface-100-900 space-y-3 p-3">
			{@render behaviour(
				"Reading into a session",
				readingValue,
				readingExplain
			)}
		</section>
	{/if}

	<section class="card preset-filled-surface-100-900 space-y-3 p-3">
		<p
			class="text-primary-ink flex items-center gap-1.5 text-xs font-semibold"
		>
			<Icons.Book size={13} aria-hidden="true" />
			{isStarterKit ? "This starter lorebook" : "This book"}
		</p>
		{#if isStarterKit}
			{#if !readOnly}
				<p class="text-surface-700-300 text-sm" data-book-settings-kit>
					Everyone on the pub can start a lorebook or a session from this
					starter lorebook. Each one started gets its own copy, so what you
					change here reaches the ones started next.
				</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				{#if onMakeBookFromKit}
					<button
						class="btn btn-sm preset-tonal-surface"
						type="button"
						data-book-settings-make-book
						onclick={onMakeBookFromKit}
					>
						<Icons.BookPlus size={14} aria-hidden="true" /> Make a lorebook
						from it
					</button>
				{/if}
				{#if !isProvided}
					<button
						class="btn btn-sm preset-filled-error-500"
						type="button"
						data-book-settings-delete-kit
						onclick={onDelete}
					>
						<Icons.Trash2 size={14} aria-hidden="true" />
						Delete starter lorebook
					</button>
				{/if}
			</div>
		{:else}
			<div class="flex flex-wrap gap-2">
				<button
					class="btn btn-sm preset-tonal-surface"
					type="button"
					onclick={onImport}
				>
					<!-- A NEW book from a file, never into this one (audit
				     2026-10-21: "Import" under This book read as the latter). -->
					<Icons.Upload size={14} aria-hidden="true" /> Import another
					lorebook
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
				{#if onSaveAsStarterKit}
					<button
						class="btn btn-sm preset-tonal-surface"
						type="button"
						title="Copy this book as a starter lorebook everyone on the pub can start from"
						data-book-settings-save-kit
						onclick={onSaveAsStarterKit}
					>
						<Icons.Package size={14} aria-hidden="true" /> Save as starter
						lorebook
					</button>
				{/if}
				{#if !isProvided}
					<button
						class="btn btn-sm preset-filled-error-500"
						type="button"
						onclick={onDelete}
					>
						<Icons.Trash2 size={14} aria-hidden="true" />
						Delete “{bookName}”
					</button>
				{/if}
			</div>
			<p
				id="book-settings-export-paused"
				class="text-surface-600-400 text-xs"
			>
				{LOREBOOK_EXPORT_PAUSED}
			</p>
		{/if}
	</section>

	{#if rulesOrCalendarHidden}
		<AdvancedHiddenLine />
	{/if}
</div>
