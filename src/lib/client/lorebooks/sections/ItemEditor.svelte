<script lang="ts">
	import { SegmentedControl } from "@skeletonlabs/skeleton-svelte"
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"
	import {
		ITEM_SUPPLY_HINTS,
		ITEM_SUPPLY_LABELS,
		ITEM_SUPPLY_MODES,
		setSupplyMode,
		supplyModeOf,
		supplyProblem,
		type ItemSupplyMode
	} from "./itemSupply"

	/**
	 * 🚧 An item (attributes phase 3c): world lore's four fields, plus how
	 * many of it the world has — its **supply**. One of a kind, a limited
	 * number, or unlimited; a limited supply asks how many. The supply sits
	 * at level one, under the name, because it is what makes a row an item
	 * rather than a paragraph about one.
	 *
	 * How many each holder has is the holder's, not this row's: a stat's list
	 * item carries its own count.
	 */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled
	}: EntryEditorProps = $props()

	let mode = $derived(supplyModeOf(draft))
	let problem = $derived(supplyProblem(draft))

	function onModeChange(details: { value: string | null }) {
		if (details.value && (ITEM_SUPPLY_MODES as readonly string[]).includes(details.value))
			setSupplyMode(draft, details.value as ItemSupplyMode)
	}
</script>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="ite"
	{vectorizationEnabled}
	namePlaceholder="Rusty key"
/>

<div class="flex flex-col gap-2" data-item-supply={mode}>
	<SegmentedControl value={mode} onValueChange={onModeChange} class="items-start">
		<SegmentedControl.Label class="text-sm font-semibold">Supply</SegmentedControl.Label>
		<SegmentedControl.Control>
			<SegmentedControl.Indicator />
			{#each ITEM_SUPPLY_MODES as option (option)}
				<SegmentedControl.Item value={option}>
					<SegmentedControl.ItemText>{ITEM_SUPPLY_LABELS[option]}</SegmentedControl.ItemText>
					<SegmentedControl.ItemHiddenInput />
				</SegmentedControl.Item>
			{/each}
		</SegmentedControl.Control>
	</SegmentedControl>
	<p class="text-surface-600-400 text-xs" id="iteSupplyHint">{ITEM_SUPPLY_HINTS[mode]}</p>
	{#if mode === "limited"}
		<div class="flex flex-col gap-1">
			<label class="text-sm font-semibold" for="iteSupplyLimit">
				How many exist <span class="text-error-500">*</span>
			</label>
			<input
				id="iteSupplyLimit"
				class="input preset-filled-surface-200-800 w-32 rounded-lg"
				type="number"
				min="1"
				step="1"
				required
				aria-describedby={problem ? "iteSupplyProblem" : "iteSupplyHint"}
				aria-invalid={problem ? "true" : undefined}
				bind:value={draft.supplyLimit}
			/>
			{#if problem}
				<p class="text-error-700-300 text-xs" id="iteSupplyProblem" role="alert">{problem}</p>
			{/if}
		</div>
	{/if}
</div>

<EntryAdvancedFields bind:draft idPrefix="ite" {vectorizationEnabled} />
