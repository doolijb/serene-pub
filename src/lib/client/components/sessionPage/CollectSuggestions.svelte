<script lang="ts">
	/**
	 * The chips a collected text offers (`CollectedText.suggestions`): a
	 * short common row, then "More" for the rest. Choosing one hands its
	 * `value` back; the chip whose value the box holds reads pressed
	 * (`preset-pressed` + `aria-pressed`, STYLE-GUIDE 1.10/2.4). Drawn for any
	 * action that declares them.
	 */
	import * as Icons from "@lucide/svelte"

	interface Suggestion {
		value: string
		label: string
		icon?: string
		common?: boolean
	}
	interface Props {
		suggestions: Suggestion[]
		/** What the box holds now, for the pressed chip. */
		current: string
		onPick: (value: string) => void
	}
	let { suggestions, current, onPick }: Props = $props()

	let more = $state(false)
	const pascal = (name: string) =>
		name
			.split("-")
			.filter(Boolean)
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join("")
	const iconOf = (name?: string) =>
		name ? ((Icons as unknown as Record<string, unknown>)[pascal(name)] as typeof Icons.Circle | undefined) : undefined

	const common = $derived(suggestions.filter((s) => s.common))
	const rest = $derived(suggestions.filter((s) => !s.common))
	// With no common row declared, everything shows.
	const first = $derived(common.length ? common : suggestions)
	const others = $derived(common.length ? rest : [])
	const shown = $derived(more ? [...first, ...others] : first)
	const pressed = (v: string) => current.trim().toLowerCase() === v.toLowerCase()
</script>

<div class="space-y-2" data-collect-suggestions>
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Suggestions">
		{#each shown as s (s.value)}
			{@const Icon = iconOf(s.icon)}
			<button
				type="button"
				class="btn btn-sm rounded-full text-chip {pressed(s.value)
					? 'preset-pressed'
					: 'preset-tonal-surface'}"
				aria-pressed={pressed(s.value)}
				data-collect-suggestion={s.value}
				onclick={() => onPick(s.value)}
			>
				{#if Icon}<Icon size={14} aria-hidden="true" />{/if}
				{s.label}
			</button>
		{/each}
		{#if others.length}
			<button
				type="button"
				class="btn btn-sm rounded-full text-chip preset-tonal-surface"
				aria-expanded={more}
				data-collect-more
				onclick={() => (more = !more)}
			>
				{more ? "Fewer" : "More"}
			</button>
		{/if}
	</div>
</div>
