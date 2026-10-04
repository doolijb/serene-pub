<script lang="ts">
	/**
	 * 🚧 Pick a **lore write mode** (plan A22): Full, Review changes or Off,
	 * each with its one line. With `inheritLabel`, "use the instance default"
	 * is a choice of its own, first — the value null — as the language
	 * picker's server default is.
	 */
	import {
		LORE_WRITE_MODES,
		LORE_WRITE_MODE_CHOICES,
		type LoreWriteMode
	} from "$lib/shared/lorebooks/loreWriteMode"

	interface Props {
		/** The group's name, for a screen reader: the card's heading says it on screen. */
		legend: string
		/** The radios' shared `name`, unique on the page. */
		name: string
		/** The chosen mode; null is the inherit choice (only offered with `inheritLabel`). */
		value: LoreWriteMode | null
		/** Offers following the instance as its own choice, named by what it gives. */
		inheritLabel?: string
		inheritDescription?: string
		/** The id of the sentence explaining the setting. */
		describedBy?: string
		disabled?: boolean
		onValueChange: (mode: LoreWriteMode | null) => void
	}

	let {
		legend,
		name,
		value,
		inheritLabel,
		inheritDescription,
		describedBy,
		disabled = false,
		onValueChange
	}: Props = $props()

	const choices = $derived([
		...(inheritLabel
			? [{ mode: null, label: inheritLabel, description: inheritDescription ?? "" }]
			: []),
		...LORE_WRITE_MODES.map((mode) => ({ mode, ...LORE_WRITE_MODE_CHOICES[mode] }))
	])
</script>

<fieldset class="flex flex-col gap-1" aria-describedby={describedBy} {disabled}>
	<legend class="sr-only">{legend}</legend>
	{#each choices as choice (choice.mode ?? "inherit")}
		<label
			class="hover:preset-tonal-surface flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2"
		>
			<input
				type="radio"
				class="radio mt-0.5 shrink-0"
				{name}
				value={choice.mode ?? ""}
				checked={value === choice.mode}
				onchange={() => onValueChange(choice.mode)}
			/>
			<span class="flex min-w-0 flex-col gap-0.5">
				<span class="text-sm font-medium">{choice.label}</span>
				{#if choice.description}
					<span class="text-surface-600-400 text-sm">{choice.description}</span>
				{/if}
			</span>
		</label>
	{/each}
</fieldset>
