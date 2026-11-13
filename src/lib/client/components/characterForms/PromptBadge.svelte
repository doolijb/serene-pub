<!-- The prompt-visibility badge, beside the label of every field whose text
     reaches the model. Used by the card editor and the cast member form. -->
<script lang="ts">
	import * as Icons from "@lucide/svelte"

	let { hint }: { hint: string } = $props()
</script>

<span
	class="duration-fast flex items-center opacity-50 transition-opacity hover:opacity-100"
	title={hint}
	aria-label={hint}
>
	<Icons.ScanEye
		size={14}
		class="relative top-[1px] inline"
		aria-hidden="true"
	/>
</span>
