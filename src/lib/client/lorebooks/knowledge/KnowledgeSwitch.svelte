<script lang="ts">
	/**
	 * 🚧 The three-way hand switch (Default · Knows · Kept from) of one
	 * member–entry pair. Shared by the Known by list (one per member) and the
	 * Knows pool's Tied zone (one per entry); it only says which was pressed.
	 */
	type Hand = Sockets.EntryKnowledge.Hand

	interface Props {
		/** The id of the element that names the group. */
		labelledBy: string
		/** The member's live hand tie for the entry, or none. */
		hand: Hand | null
		busy: boolean
		onPress: (hand: Hand | null) => void
	}

	let { labelledBy, hand, busy, onPress }: Props = $props()

	const OPTIONS: { label: string; hand: Hand | null; value: string }[] = [
		{ label: "Default", hand: null, value: "default" },
		{ label: "Knows", hand: "knows", value: "knows" },
		{ label: "Kept from", hand: "kept_from", value: "kept_from" }
	]
	const chosen = $derived(hand ?? "default")
</script>

<div role="group" aria-labelledby={labelledBy} class="flex flex-wrap gap-1">
	{#each OPTIONS as option (option.value)}
		<button
			type="button"
			class="btn btn-sm pointer-coarse:min-h-11 {chosen === option.value
				? 'preset-pressed'
				: 'preset-tonal-surface'}"
			aria-pressed={chosen === option.value}
			disabled={busy}
			data-known-by-option={option.value}
			onclick={() => onPress(option.hand)}
		>
			{option.label}
		</button>
	{/each}
</div>
