<!-- The "+ Add …" button under an array editor. Used by the card editor and
     the cast member form. -->
<script lang="ts">
	let { label, onAdd }: { label: string; onAdd: () => void } = $props()
</script>

<button
	type="button"
	class="text-surface-600-400 hover:text-foreground self-start text-xs"
	onclick={onAdd}
>
	+ {label}
</button>
