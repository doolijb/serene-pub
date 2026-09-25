<script lang="ts">
	/**
	 * A test-only page for `spElement.dom.test.ts`: Svelte blocks INSIDE an sp
	 * element that change after mount — the path a native widget takes.
	 */
	let { showTrigger = false, rows = [] as string[] }: { showTrigger?: boolean; rows?: string[] } = $props()
</script>

<sp-switch checked>
	{#if showTrigger}<p slot="trigger" class="late-trigger">T</p>{/if}
	<p class="body">B</p>
	{#each rows as r (r)}<sp-option value={r}>{r}</sp-option>{/each}
</sp-switch>
