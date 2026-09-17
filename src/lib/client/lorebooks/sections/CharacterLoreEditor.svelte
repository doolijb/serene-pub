<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import { getCharacterLoreVisibility } from "$lib/shared/utils/characterLoreVisibility"
	import type { EntryEditorProps } from "./types"
	import EntryAdvancedFields from "./EntryAdvancedFields.svelte"
	import EntryCoreFields from "./EntryCoreFields.svelte"

	/**
	 * World lore's four fields plus the one this kind declares: who the entry
	 * is private to.
	 *
	 * The helper text under the picker is recomputed as the picker changes, so
	 * it always states what saving right now would do rather than what the
	 * saved row does.
	 */
	let {
		draft = $bindable(),
		bindings = $bindable(),
		vectorizationEnabled
	}: EntryEditorProps = $props()

	let visibility = $derived(
		getCharacterLoreVisibility(draft.lorebookBindingId, bindings)
	)
	let needsAttention = $derived(
		visibility.kind === "orphaned" || visibility.kind === "unbound"
	)

	function bindingLabel(binding: (typeof bindings)[number]): string {
		if (binding.characterId)
			return (
				binding.character?.nickname ||
				binding.character?.name ||
				binding.binding
			)
		return binding.binding
	}
</script>

<EntryCoreFields
	bind:draft
	bind:bindings
	idPrefix="cle"
	{vectorizationEnabled}
	namePlaceholder="Her abilities"
/>

<div class="flex flex-col gap-1">
	<label
		class="flex items-center gap-1 text-sm font-semibold"
		for="cleBinding"
	>
		Cast member
		<Icons.Link2 size={13} class="text-surface-400 relative top-[1px]" />
	</label>
	<select
		id="cleBinding"
		class="select preset-filled-surface-200-800 w-full rounded-lg"
		bind:value={draft.lorebookBindingId}
	>
		<option value={null}>None (Unbound)</option>
		{#each bindings as binding (binding.id)}
			<option value={binding.id}>{bindingLabel(binding)}</option>
		{/each}
	</select>
	<p
		class="text-xs"
		class:text-warning-500={needsAttention}
		class:text-surface-700-300={!needsAttention}
	>
		{#if visibility.kind === "orphaned"}
			<Icons.AlertTriangle size={12} class="inline" />
		{:else if visibility.kind === "unbound"}
			<Icons.LockOpen size={12} class="inline" />
		{:else}
			<Icons.Lock size={12} class="inline" />
		{/if}
		{visibility.description}
	</p>
</div>

<EntryAdvancedFields bind:draft idPrefix="cle" {vectorizationEnabled} />
