<script lang="ts">
	/**
	 * A connection form's Select with its one-line help under it: the label
	 * and the help come from `connectionFieldWords`, so Prompt format and
	 * Token counter say the same thing in every form. The help is the
	 * input's `aria-describedby`, so it is read with the field.
	 */
	import Select, {
		type SelectOption
	} from "$lib/client/components/inputs/Select.svelte"
	import type { ConnectionFieldWords } from "./connectionFieldWords"

	interface Props {
		words: ConnectionFieldWords
		options: SelectOption[]
		value: string | null | undefined
		/** Extra classes for the wrapper: margins. */
		class?: string
	}

	let {
		words,
		options,
		value = $bindable(),
		class: className = ""
	}: Props = $props()

	const uid = $props.id()
	const helpId = `${uid}-help`
</script>

<div class="flex flex-col gap-1 {className}">
	<Select
		label={words.label}
		class="w-full"
		{options}
		bind:value
		describedBy={helpId}
	/>
	<p id={helpId} class="text-surface-600-400 text-xs">{words.help}</p>
</div>
