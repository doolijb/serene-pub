<script lang="ts">
	import * as Icons from "@lucide/svelte"

	let { query = $bindable("") }: { query?: string } = $props()
</script>

<div class="relative flex-1">
	<Icons.Search
		class="text-surface-500 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
	/>
	<input
		type="text"
		class="input w-full pl-9"
		placeholder="Search documentation..."
		bind:value={query}
		aria-label="Search documentation"
	/>
	{#if query}
		<button
			type="button"
			class="text-surface-500 hover:text-surface-700 absolute top-1/2 right-2 -translate-y-1/2"
			onclick={() => (query = "")}
			aria-label="Clear search"
		>
			<Icons.X class="h-4 w-4" />
		</button>
	{/if}
</div>
