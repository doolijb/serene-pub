<script lang="ts">
	/**
	 * A test-only sp element body (`spElement.dom.test.ts`): the machinery
	 * with no Skeleton in the way. Its own markup raises a native `change`
	 * (which must stop at the element); `checked` opens the default slot;
	 * `sp-option` children are read as data.
	 */
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit, slot, items }: SpElementProps = $props()
</script>

<div class="own" data-writes={writes.checked ?? 0}>
	<input class="own-input" />
	<button type="button" class="own-emit" onclick={() => emit("change", { checked: true })}>emit</button>
	<span class="trigger-box" {@attach slot("trigger")}></span>
	{#if flag(attrs.checked)}<div class="body-box" {@attach slot()}></div>{/if}
	<ul class="items">
		{#each items as it, i (i)}<li>{it.attrs.value}:{it.text}</li>{/each}
	</ul>
</div>
