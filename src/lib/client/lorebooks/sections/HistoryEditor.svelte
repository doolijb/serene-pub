<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import { editBounds, formatDate } from "./historyDates"

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

	let bounds = $derived(
		isNew
			? { min: null, max: null }
			: editBounds(siblings as any, source?.id)
	)
</script>

<div class="flex flex-col gap-1">
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
					class="text-surface-400 relative top-[1px]"
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
					class="text-surface-400 relative top-[1px]"
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
					class="text-surface-400 relative top-[1px]"
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
