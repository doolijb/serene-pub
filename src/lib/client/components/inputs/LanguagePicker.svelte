<script lang="ts">
	/**
	 * The language dropdown (R5), shared by the setup wizard and both settings
	 * surfaces so the three cannot drift in what they offer or how they label
	 * it.
	 *
	 * Built on `Select.svelte` — the codebase's `<select>` replacement — rather
	 * than a bare `<select>`, so it inherits the combobox ARIA tree and the
	 * type-to-filter that makes a list of twenty-eight languages usable.
	 */
	import Select from "./Select.svelte"
	import { LANGUAGES } from "$lib/shared/i18n/languages"

	interface Props {
		/** ISO 639-1, or "" for the inherit option when `inheritLabel` is set. */
		value: string
		label: string
		/**
		 * When given, an extra first option carrying the value `""`, meaning
		 * "follow the instance default". Only the per-user picker passes it —
		 * the instance default has nothing to inherit from.
		 */
		inheritLabel?: string
		disabled?: boolean
		describedBy?: string
		class?: string
		onValueChange?: (value: string) => void
	}

	let {
		value,
		label,
		inheritLabel,
		disabled = false,
		describedBy,
		class: className = "",
		onValueChange
	}: Props = $props()

	/**
	 * "Español (Spanish)" — the endonym first, because the person who needs to
	 * find it in this list is the one who reads that name, and they may be
	 * reading a UI still in English while they look. English in parentheses so
	 * an admin setting somebody else's default can still find it.
	 *
	 * English itself would read "English (English)", so it collapses.
	 */
	// `$derived`, not a plain const: `inheritLabel` names the *current* server
	// default, which arrives over a socket after first paint and changes again
	// whenever an admin moves it. A once-computed array would leave the inherit
	// row naming a language the instance has stopped using.
	const options = $derived([
		...(inheritLabel ? [{ value: "", label: inheritLabel }] : []),
		...LANGUAGES.map((l) => ({
			value: l.code,
			label: l.endonym === l.name ? l.name : `${l.endonym} (${l.name})`
		}))
	])
</script>

<Select
	{label}
	{options}
	{value}
	{disabled}
	{describedBy}
	class={className}
	{onValueChange}
/>
