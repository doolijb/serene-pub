<script lang="ts" module>
	/**
	 * The ids a field's control points `aria-describedby` at, so the help
	 * and the error are read with it: `describedBy(id, !!error)`.
	 */
	export function describedBy(id: string, hasError: boolean): string {
		return hasError ? `${id}-error ${id}-help` : `${id}-help`
	}
</script>

<script lang="ts">
	/**
	 * One row of a change form: the label, the control, the help text under
	 * it (Django's `help_text`) and its error. Without a control it is a
	 * **readonly field** (Django's `readonly_fields`): the label over the
	 * value as text, never a disabled input a reader might try to type in.
	 *
	 * The control is the caller's, so the label is tied to it by `id`; give
	 * the control `id={id}` and `aria-describedby={describedBy(id, !!error)}`.
	 * `data-field` lets an error summary (and the Admin view's landing) find
	 * the row.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		/** The control's id. */
		id: string
		label: string
		help?: string
		error?: string | null
		required?: boolean
		/** Readonly: the value to show when there is no control. */
		value?: string | null
		/** The control. Absent → a readonly field showing `value`. */
		children?: Snippet
		class?: string
	}
	let {
		id,
		label,
		help,
		error,
		required = false,
		value,
		children,
		class: className = ""
	}: Props = $props()
</script>

<div class="flex min-w-0 flex-col gap-1.5 {className}" data-field={id}>
	{#if children}
		<label class="text-surface-950-50 text-sm font-medium" for={id}>
			{label}
			{#if required}
				<span class="text-surface-600-400 font-normal">(required)</span>
			{/if}
		</label>
		{@render children()}
	{:else}
		<span class="text-surface-600-400 text-xs" id="{id}-label">{label}</span>
		<p
			class="text-surface-950-50 min-w-0 text-sm break-words"
			{id}
			aria-labelledby="{id}-label"
		>
			{value || "—"}
		</p>
	{/if}
	{#if error}
		<p
			id="{id}-error"
			class="text-error-600-400 flex items-start gap-1.5 text-xs"
		>
			<Icons.CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" />
			{error}
		</p>
	{/if}
	{#if help}
		<p id="{id}-help" class="text-surface-600-400 text-xs">{help}</p>
	{/if}
</div>
