<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import EmbeddingStatusIcon from "$lib/client/components/EmbeddingStatusIcon.svelte"
	import { Priorities } from "$lib/shared/constants/Priorities"

	/**
	 * The state marks every entry row carries, in one place.
	 *
	 * Priority, regex and case sensitivity are properties of the keyword
	 * mechanism, so they are shown only where that mechanism is the one
	 * deciding — a badge for a knob the instance does not read is noise. A
	 * pinned entry outranks its priority, so the two never show together.
	 *
	 * Off and archived are words rather than icons at every size: both say the
	 * row will not be read in, and a dimmed row with a glyph on it is not a
	 * sentence anybody reads.
	 */
	interface Props {
		entry: Record<string, any>
		vectorizationEnabled: boolean
		/** Marks sit inside a row (small) or above an editor (large). */
		size?: "sm" | "lg"
		/** Priority is a knob only the kinds that declare one have. */
		showPriority?: boolean
	}

	let {
		entry,
		vectorizationEnabled,
		size = "sm",
		showPriority = true
	}: Props = $props()

	let icon = $derived(size === "sm" ? 11 : 14)
	let pad = $derived(size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1")
</script>

<EmbeddingStatusIcon
	embeddingModel={entry.embeddingModel}
	size={size === "sm" ? 12 : 14}
/>
<!-- Two states and two words: an off row is switched off and kept in front of
     the author, an archived row is put out of the way and kept. The list's
     chips use these words, so the row has to as well. -->
{#if entry.enabled === false}
	<span class="preset-filled-error-500 rounded {pad} text-xs" title="Off">
		<Icons.Ghost size={icon} class="inline" />
		off
	</span>
{/if}
{#if entry.archived}
	<span class="preset-tonal-surface rounded {pad} text-xs" title="Archived">
		<Icons.Archive size={icon} class="inline" />
		archived
	</span>
{/if}
{#if entry.constant}
	<span
		class="preset-filled-warning-500 rounded {pad} text-xs"
		title="Pinned"
	>
		<Icons.Pin size={icon} class="inline" />
		{#if size === "lg"}Pinned{/if}
	</span>
{:else if showPriority && !vectorizationEnabled}
	<span
		class="rounded {pad} text-xs"
		class:preset-filled-success-500={entry.priority === 1}
		class:preset-filled-primary-500={entry.priority === 2}
		class:preset-filled-tertiary-500={entry.priority === 3}
		title="{Priorities[(entry.priority ?? 1) - 1]?.label} Priority"
	>
		{#if size === "lg"}
			{Priorities[(entry.priority ?? 1) - 1]?.label} Priority
		{:else}
			{#each { length: entry.priority ?? 1 } as _}
				<Icons.Plus size={10} class="inline" />
			{/each}
		{/if}
	</span>
{/if}
{#if !vectorizationEnabled && entry.useRegex}
	<span
		class="preset-filled-primary-500 rounded {pad} text-xs"
		title="Regex keywords"
	>
		<Icons.Regex size={icon} class="inline" />
		{#if size === "lg"}Regex{/if}
	</span>
{/if}
{#if size === "lg" && !vectorizationEnabled && entry.caseSensitive}
	<span class="preset-tonal-surface rounded {pad} text-xs">
		Case Sensitive
	</span>
{/if}
