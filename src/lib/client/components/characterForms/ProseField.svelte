<!-- One labelled prose textarea: label, optional prompt badge, optional
     snippet between label and field, then the textarea. No wrapper element —
     the caller provides any. Used by the card editor and the cast member form. -->
<script lang="ts">
	import type { Snippet } from "svelte"
	import { FIELD_CLASS } from "./fieldClass"
	import PromptBadge from "./PromptBadge.svelte"

	interface Props {
		id: string
		label: string
		/** Prompt-visibility hint: when given, a PromptBadge follows the label text. */
		hint?: string
		/** Appends "*" to the label text and sets aria-required="true" on the textarea. */
		required?: boolean
		value?: string
		rows?: number
		placeholder?: string
		title?: string
		disabled?: boolean
		/** Extra classes on the textarea, after FIELD_CLASS. */
		class?: string
		/** undefined = no aria-invalid attribute at all; boolean = "true"/"false". */
		invalid?: boolean
		describedBy?: string
		oninput?: (value: string) => void
		/** Drawn between the label and the textarea. */
		follow?: Snippet
	}

	let {
		id,
		label,
		hint,
		required = false,
		value = $bindable(""),
		rows,
		placeholder,
		title,
		disabled = false,
		class: extraClass = "",
		invalid,
		describedBy,
		oninput,
		follow
	}: Props = $props()
</script>

<label
	class={hint
		? "text-surface-600-400 mb-1.5 flex items-center gap-1 text-xs"
		: "text-surface-600-400 mb-1.5 text-xs"}
	for={id}
>
	{label}{required ? "*" : ""}
	{#if hint}
		<PromptBadge {hint} />
	{/if}
</label>
{@render follow?.()}
<textarea
	{id}
	{rows}
	bind:value
	class="{FIELD_CLASS} {extraClass} {disabled ? 'opacity-60' : ''}"
	{placeholder}
	{title}
	{disabled}
	aria-required={required ? "true" : undefined}
	aria-invalid={invalid === undefined
		? undefined
		: invalid
			? "true"
			: "false"}
	aria-describedby={describedBy}
	oninput={() => oninput?.(value)}
></textarea>
