<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import { editBounds, formatDate } from "./historyDates"
	import { dateProblem } from "$lib/shared/lorebooks/storyDate"
	import { openBookTime } from "../time/bookTime.svelte"

	/**
	 * A dated entry: the date, and what happened.
	 *
	 * The scenes it was compiled from are a tab of the inspector rather than a
	 * tab of the editor: two levels of disclosure hold, and a tab strip inside
	 * level one is a third.
	 *
	 * The date is the heading rather than a field beside a name, and it is the
	 * one field with a rule the list depends on — the entry has to stay
	 * between its neighbours, or the story reorders itself with nothing saying
	 * so. A new entry has no neighbours yet, so it has no bounds.
	 */
	let {
		draft = $bindable(),
		source,
		isNew,
		bindings = $bindable(),
		vectorizationEnabled,
		siblings
	}: EntryEditorProps = $props()

	/**
	 * The date as the book's calendar reads it, and why it does not fit —
	 * only when the book declares one. Free-form spells the parts as typed,
	 * so a hint there would say nothing the inputs do not.
	 */
	let calendarHint = $derived.by(() => {
		const cal = openBookTime.calendar
		const year = draft?.year
		if (!cal || typeof year !== "number" || !Number.isFinite(year)) return null
		const date = {
			year,
			month: typeof draft.month === "number" ? draft.month : null,
			day: typeof draft.day === "number" ? draft.day : null
		}
		const problem = dateProblem(date, cal)
		return problem ? { problem } : { reads: formatDate(date, cal) }
	})

	let bounds = $derived(
		isNew
			? { min: null, max: null }
			: editBounds(siblings as any, source?.id)
	)
</script>

<div class="flex flex-col gap-1" data-lore-field="date">
	<span class="text-sm font-semibold">When</span>
	<div class="flex gap-2">
		<div class="flex flex-col gap-1">
			<label
				class="flex items-center gap-1 text-sm font-semibold"
				for="heeYear"
			>
				Year <span class="text-error-500">*</span>
				<Icons.ScanEye
					size={13}
					class="text-surface-600-400 relative top-[1px]"
				/>
			</label>
			<input
				id="heeYear"
				class="input preset-filled-surface-200-800 w-full rounded-lg"
				type="number"
				bind:value={draft.year}
				required
				placeholder="2055"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label
				class="flex items-center gap-1 text-sm font-semibold"
				for="heeMonth"
			>
				Month
				<Icons.ScanEye
					size={13}
					class="text-surface-600-400 relative top-[1px]"
				/>
			</label>
			<input
				id="heeMonth"
				class="input preset-filled-surface-200-800 w-full rounded-lg"
				type="number"
				bind:value={draft.month}
				placeholder="3"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label
				class="flex items-center gap-1 text-sm font-semibold"
				for="heeDay"
			>
				Day
				<Icons.ScanEye
					size={13}
					class="text-surface-600-400 relative top-[1px]"
				/>
			</label>
			<input
				id="heeDay"
				class="input preset-filled-surface-200-800 w-full rounded-lg"
				type="number"
				bind:value={draft.day}
				placeholder="1"
			/>
		</div>
	</div>
	{#if calendarHint}
		<p class="text-xs" aria-live="polite" data-lore-date-reads>
			{#if calendarHint.problem}
				<span class="text-error-700-300">{calendarHint.problem}</span>
			{:else}
				<span class="text-surface-700-300">Reads as</span>
				<span class="font-semibold">{calendarHint.reads}</span>
			{/if}
		</p>
	{/if}
	{#if bounds.min || bounds.max}
		<p class="text-surface-700-300 text-xs">
			{#if bounds.min && bounds.max}
				Must be between {formatDate(bounds.min)} and {formatDate(
					bounds.max
				)}
			{:else if bounds.min}
				Must be after {formatDate(bounds.min)}
			{:else if bounds.max}
				Must be before {formatDate(bounds.max)}
			{/if}
		</p>
	{/if}
</div>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="hee"
	{vectorizationEnabled}
	showName={false}
/>

<EntryAdvancedFields
	bind:draft
	idPrefix="hee"
	{vectorizationEnabled}
	showPriority={false}
>
	{#snippet extra()}
		<Switch
			name="heeCompleted"
			checked={draft.isCompleted || false}
			onCheckedChange={(e) => (draft.isCompleted = e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Completed</Switch.Label>
			<Switch.Control
				class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
			>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
	{/snippet}
</EntryAdvancedFields>
