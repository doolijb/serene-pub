<!-- The delete on one row of an array editor: an icon at the row's top-right,
     so a list of textareas stays a list rather than alternating field, button,
     field, button. Used by the card editor and the cast member form. -->
<script lang="ts">
	import * as Icons from "@lucide/svelte"

	let { label, onRemove }: { label: string; onRemove: () => void } = $props()
</script>

<button
	type="button"
	class="text-surface-600-400 hover:bg-surface-200-800 hover:text-error-600-400 grid size-8 shrink-0 place-items-center rounded-lg"
	onclick={onRemove}
	aria-label={label}
	title={label}
>
	<Icons.X size={14} aria-hidden="true" />
</button>
